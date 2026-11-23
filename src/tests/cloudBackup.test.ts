import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BillAttachment,
  CloudAuthUser,
  CloudBackupConfig,
  CloudBackupRemoteEntry,
  CloudBackupStatus,
  StoreBusinessDataset,
} from '../types';
import {
  initialCashbookEntries,
  initialCustomers,
  initialCustomerTransactions,
  initialExpenses,
  initialProducts,
  initialSales,
  initialStockAdjustments,
  initialStoreProfile,
  initialSuppliers,
  initialSupplierTransactions,
} from '../utils/initialData';
import {
  assertZeroPlaintextLeakage,
  buildEncryptedCloudBackupPayload,
  createPassphraseVerifier,
  decryptAndInspectCloudBackup,
  validateCloudPassphrase,
  verifyPassphraseVerifier,
} from '../utils/cloudBackupCrypto';
import {
  buildCloudBackupPath,
  CloudBackupOwnerMismatchError,
  CloudBackupStorageTransport,
  computeCloudRetentionPrunePaths,
  createMemoryCloudBackupTransport,
  DEFAULT_CLOUD_BACKUP_CONFIG,
  downloadAndInspectCloudBackup,
  getIstDateKey,
  getIstIsoWeekKey,
  listUserCloudBackups,
  MAX_CLOUD_BACKUP_BYTES,
  restoreCloudBackupSafely,
  shouldRunDailyCloudBackup,
  uploadEncryptedCloudBackup,
} from '../utils/cloudBackupManager';
import { createEmptyBusinessDataset } from '../utils/freshInstall';
import { CriticalRestoreRollbackError } from '../utils/localBackupManager';
import { createMemoryLocalDbAdapter, LocalDbAdapter } from '../utils/localDatabase';

const OWNER_USER: CloudAuthUser = {
  uid: 'owner-uid-arjun-001',
  email: 'arjun.owner@example.com',
  displayName: 'Arjun Patel',
  emailVerified: true,
};

const OTHER_USER: CloudAuthUser = {
  uid: 'intruder-uid-999',
  email: 'other.person@example.com',
  displayName: 'Other User',
  emailVerified: true,
};

const STRONG_PASSPHRASE = 'ArjunKirana@2026!Vault';

function makeRichDataset(): StoreBusinessDataset {
  const billDoc: BillAttachment = {
    id: 'bill-doc-cloud-1',
    name: 'wholesale-flour-invoice.pdf',
    type: 'PDF',
    dataUrl: 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDw+PgplbmRvYmoK',
    size: 42,
    uploadedAt: '2026-11-16T05:30:00.000Z',
    transactionId: initialSales[0]?.id,
    transactionType: 'SALE',
  };

  const salesWithAttachment = initialSales.map((s, idx) =>
    idx === 0 ? { ...s, attachments: [billDoc] } : s
  );

  return {
    profile: { ...initialStoreProfile, storeName: 'Arjun Groceries', ownerName: 'Arjun Sharma', phone: '9876543210' },
    customers: [...initialCustomers],
    customerTransactions: [...initialCustomerTransactions],
    suppliers: [...initialSuppliers],
    supplierTransactions: [...initialSupplierTransactions],
    sales: salesWithAttachment,
    expenses: [...initialExpenses],
    cashbookEntries: [...initialCashbookEntries],
    products: [...initialProducts],
    stockAdjustments: [...initialStockAdjustments],
    auditLogs: [],
    billDocuments: [billDoc],
    whatsappBatches: [],
    whatsappAuditLogs: [],
    recurringExpenses: [],
    dailySalesTarget: { amount: 6500, updatedAt: '2026-11-16T05:00:00.000Z' },
    lastClosedDate: '2026-11-15',
  };
}

test('storage.rules enforces deny-by-default, verified single-owner UID paths, create-only immutability (no update), SHA-256 metadata, and protected manual/pre-restore buckets', () => {
  const rulesPath = path.resolve(process.cwd(), 'storage.rules');
  const rulesText = fs.readFileSync(rulesPath, 'utf8');

  assert.match(rulesText, /rules_version\s*=\s*'2'/);
  assert.match(rulesText, /match \/users\/\{userId\}\/backups\/\{bucketType\}\/\{fileName\}/);
  assert.match(rulesText, /request\.auth != null/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesText, /request\.auth\.uid == userId/);
  assert.match(rulesText, /request\.resource\.metadata\.format == 'SKPRO_ENC_V1'/);
  assert.match(rulesText, /request\.resource\.metadata\.cipher == 'AES-256-GCM'/);
  assert.match(rulesText, /request\.resource\.metadata\.ciphertextSha256/);
  assert.match(rulesText, /!\('storeName' in request\.resource\.metadata\)/);
  assert.match(rulesText, /50 \* 1024 \* 1024/);
  assert.match(rulesText, /allow create:/);
  assert.match(rulesText, /allow update:\s*if false;/);
  assert.match(rulesText, /allow delete:\s*if isSignedInVerifiedOwner\(userId\)\s*&& bucketType in \['daily', 'weekly'\];/);
  assert.match(rulesText, /match \/\{allPaths=\*\*\}\s*\{\s*allow read, write: if false;/);
});

test('Cloud passphrase policy & PBKDF2 verifier reject weak/wrong passphrases without storing plaintext', async () => {
  assert.equal(validateCloudPassphrase('short').valid, false);
  assert.equal(validateCloudPassphrase('1234567').valid, false);
  assert.equal(validateCloudPassphrase(STRONG_PASSPHRASE).valid, true);
  assert.equal(validateCloudPassphrase(STRONG_PASSPHRASE).strength, 'STRONG');

  const verifier = await createPassphraseVerifier(STRONG_PASSPHRASE);
  assert.equal(verifier.algorithm, 'PBKDF2-SHA256');
  assert.ok(!JSON.stringify(verifier).includes(STRONG_PASSPHRASE));
  assert.equal(await verifyPassphraseVerifier(STRONG_PASSPHRASE, verifier), true);
  assert.equal(await verifyPassphraseVerifier('WrongPassphrase@99', verifier), false);
});

test('Encrypted cloud payload leaks zero store names, customer names, phone numbers, or financial totals', async () => {
  const dataset = makeRichDataset();
  const built = await buildEncryptedCloudBackupPayload(dataset, STRONG_PASSPHRASE, {
    createdAt: '2026-11-16T06:00:00.000Z',
  });

  // Ensure outer JSON parses safely and contains zero plaintext shop or customer terms
  const outer = JSON.parse(built.jsonString) as Record<string, unknown>;
  assert.equal(outer.format, 'SKPRO_ENC_V1');
  assert.equal(outer.cipher, 'AES-256-GCM');
  assert.equal(outer.kdf, 'PBKDF2-SHA256');

  const metaJson = JSON.stringify(built.customMetadata);
  assert.ok(!built.jsonString.includes('Arjun Groceries'));
  assert.ok(!built.jsonString.includes('Arjun Sharma'));
  assert.ok(!built.jsonString.includes('9876543210'));
  assert.ok(!metaJson.includes('Arjun Groceries'));
  assert.ok(!metaJson.includes('storeName'));
  assert.ok(!metaJson.includes('recordCounts'));

  assert.doesNotThrow(() =>
    assertZeroPlaintextLeakage(built.jsonString, built.customMetadata, dataset)
  );
});

test('IST Asia/Kolkata date key and ISO week key handle midnight IST boundary accurately', () => {
  // 2026-11-16 00:00:01 IST == 2026-11-15T18:30:01Z
  const justAfterIstMidnight = new Date('2026-11-15T18:30:01.000Z');
  const justBeforeIstMidnight = new Date('2026-11-15T18:29:59.000Z');

  assert.equal(getIstDateKey(justBeforeIstMidnight), '2026-11-15');
  assert.equal(getIstDateKey(justAfterIstMidnight), '2026-11-16');
  assert.equal(getIstIsoWeekKey(justBeforeIstMidnight), '2026-W46');
  assert.equal(getIstIsoWeekKey(justAfterIstMidnight), '2026-W47');
});

test('Daily IST scheduler enforces once-per-IST-day idempotency, offline skip, and reconnect eligibility', () => {
  const now = new Date('2026-11-16T05:00:00.000Z'); // 10:30 AM IST on 2026-11-16
  const baseStatus: CloudBackupStatus = { state: 'IDLE' };

  assert.equal(
    shouldRunDailyCloudBackup({
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      status: baseStatus,
      authUser: OWNER_USER,
      sessionPassphrase: STRONG_PASSPHRASE,
      isOnline: false,
      now,
    }),
    false
  );

  assert.equal(
    shouldRunDailyCloudBackup({
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      status: baseStatus,
      authUser: OWNER_USER,
      sessionPassphrase: STRONG_PASSPHRASE,
      isOnline: true,
      now,
    }),
    true
  );

  assert.equal(
    shouldRunDailyCloudBackup({
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      status: { ...baseStatus, lastSuccessDateKeyIst: '2026-11-16' },
      authUser: OWNER_USER,
      sessionPassphrase: STRONG_PASSPHRASE,
      isOnline: true,
      now,
    }),
    false
  );

  // New IST day triggers cleanly
  const nextIstDay = new Date('2026-11-16T18:45:00.000Z'); // 2026-11-17 00:15 IST
  assert.equal(
    shouldRunDailyCloudBackup({
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      status: { ...baseStatus, lastSuccessDateKeyIst: '2026-11-16' },
      authUser: OWNER_USER,
      sessionPassphrase: STRONG_PASSPHRASE,
      isOnline: true,
      now: nextIstDay,
    }),
    true
  );
});

test('Retention policy retains latest 7 daily & 4 weekly snapshots, and strictly preserves ALL manual and pre-restore snapshots', async () => {
  const transport = createMemoryCloudBackupTransport();
  const dataset = makeRichDataset();

  // Upload 9 consecutive daily snapshots spanning multiple weeks
  const dailyTimestamps = [
    '2026-10-12T06:00:00.000Z', // W42
    '2026-10-19T06:00:00.000Z', // W43
    '2026-10-26T06:00:00.000Z', // W44
    '2026-11-02T06:00:00.000Z', // W45
    '2026-11-09T06:00:00.000Z', // W46
    '2026-11-10T06:00:00.000Z',
    '2026-11-11T06:00:00.000Z',
    '2026-11-12T06:00:00.000Z',
    '2026-11-13T06:00:00.000Z',
    '2026-11-14T06:00:00.000Z',
    '2026-11-15T06:00:00.000Z',
    '2026-11-16T06:00:00.000Z', // W47
  ];

  for (const ts of dailyTimestamps) {
    await uploadEncryptedCloudBackup({
      transport,
      authUser: OWNER_USER,
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      dataset,
      passphrase: STRONG_PASSPHRASE,
      bucket: 'daily',
      isOnline: true,
      now: new Date(ts),
    });
  }

  for (let i = 0; i < 7; i++) {
    await uploadEncryptedCloudBackup({
      transport,
      authUser: OWNER_USER,
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      dataset,
      passphrase: STRONG_PASSPHRASE,
      bucket: 'manual',
      isOnline: true,
      now: new Date(`2026-11-16T06:0${i}:00.000Z`),
    });
  }

  await uploadEncryptedCloudBackup({
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    dataset,
    passphrase: STRONG_PASSPHRASE,
    bucket: 'pre-restore',
    isOnline: true,
    now: new Date('2026-11-16T06:15:00.000Z'),
  });

  const remaining = await listUserCloudBackups(transport, OWNER_USER.uid);
  const daily = remaining.filter((e) => e.bucket === 'daily');
  const weekly = remaining.filter((e) => e.bucket === 'weekly');
  const manual = remaining.filter((e) => e.bucket === 'manual');
  const preRestore = remaining.filter((e) => e.bucket === 'pre-restore');

  assert.equal(daily.length, 7);
  assert.equal(weekly.length, 4);
  assert.equal(manual.length, 7); // ALL manual backups preserved
  assert.equal(preRestore.length, 1); // pre-restore backup preserved
  assert.equal(daily[0].dateKey, '2026-11-16');

  // Verify pure retention calculation consistency
  const entries: CloudBackupRemoteEntry[] = [
    ...Array.from({ length: 9 }, (_, i) => ({
      fullPath: `users/u1/backups/daily/backup-2026-11-0${i + 1}-100000-id00000${i}.skbackup.json`,
      name: `backup-2026-11-0${i + 1}-100000-id00000${i}.skbackup.json`,
      bucket: 'daily' as const,
      dateKey: `2026-11-0${i + 1}`,
      createdAt: `2026-11-0${i + 1}T10:00:00.000Z`,
      sizeBytes: 100,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      fullPath: `users/u1/backups/manual/backup-2026-11-0${i + 1}-110000-man0000${i}.skbackup.json`,
      name: `backup-2026-11-0${i + 1}-110000-man0000${i}.skbackup.json`,
      bucket: 'manual' as const,
      dateKey: `2026-11-0${i + 1}`,
      createdAt: `2026-11-0${i + 1}T11:00:00.000Z`,
      sizeBytes: 100,
    })),
    {
      fullPath: `users/u1/backups/pre-restore/backup-2026-11-01-120000-prerest1.skbackup.json`,
      name: `backup-2026-11-01-120000-prerest1.skbackup.json`,
      bucket: 'pre-restore' as const,
      dateKey: '2026-11-01',
      createdAt: '2026-11-01T12:00:00.000Z',
      sizeBytes: 100,
    },
  ];
  const { keep, prunePaths } = computeCloudRetentionPrunePaths(entries, DEFAULT_CLOUD_BACKUP_CONFIG);
  assert.equal(keep.filter((e) => e.bucket === 'daily').length, 7);
  assert.equal(keep.filter((e) => e.bucket === 'manual').length, 8);
  assert.equal(keep.filter((e) => e.bucket === 'pre-restore').length, 1);
  assert.equal(prunePaths.length, 2); // Only the 2 oldest daily backups pruned
  assert.ok(prunePaths.every((p) => p.includes('/backups/daily/')));
});

test('Owner UID binding blocks mismatched Google account access unless explicitly rebound', async () => {
  const transport = createMemoryCloudBackupTransport();
  const dataset = makeRichDataset();
  const boundConfig: CloudBackupConfig = {
    ...DEFAULT_CLOUD_BACKUP_CONFIG,
    boundOwnerUid: OWNER_USER.uid,
    boundOwnerEmail: OWNER_USER.email,
  };

  await assert.rejects(
    () =>
      uploadEncryptedCloudBackup({
        transport,
        authUser: OTHER_USER,
        config: boundConfig,
        dataset,
        passphrase: STRONG_PASSPHRASE,
        bucket: 'manual',
        isOnline: true,
      }),
    (err: unknown) => err instanceof CloudBackupOwnerMismatchError
  );
});

test('Wrong passphrase and tampered cloud ciphertext are rejected without modifying IndexedDB', async () => {
  const transport = createMemoryCloudBackupTransport();
  const dataset = makeRichDataset();

  const uploaded = await uploadEncryptedCloudBackup({
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    dataset,
    passphrase: STRONG_PASSPHRASE,
    bucket: 'daily',
    isOnline: true,
    now: new Date('2026-11-16T06:00:00.000Z'),
  });

  // Wrong passphrase rejected cleanly
  await assert.rejects(
    () =>
      downloadAndInspectCloudBackup({
        transport,
        uid: OWNER_USER.uid,
        fullPath: uploaded.uploadedEntry.fullPath,
        passphrase: 'WrongPassword@123',
      }),
    /Incorrect passphrase|tampered/i
  );

  // Tamper ciphertext byte in cloud storage
  const stored = transport._objects.get(uploaded.uploadedEntry.fullPath);
  assert.ok(stored);
  const tamperedText = new TextDecoder()
    .decode(stored.bytes)
    .replace('"ciphertextBase64":"', '"ciphertextBase64":"AAAA');
  stored.bytes = new TextEncoder().encode(tamperedText);

  await assert.rejects(
    () =>
      downloadAndInspectCloudBackup({
        transport,
        uid: OWNER_USER.uid,
        fullPath: uploaded.uploadedEntry.fullPath,
        passphrase: STRONG_PASSPHRASE,
      }),
    /SHA-256 verification|Incorrect passphrase|tampered/i
  );

  // Verify direct decrypt helper requires passphrase
  const missingPass = await decryptAndInspectCloudBackup(tamperedText, '');
  assert.equal(missingPass.valid, false);
  assert.equal(missingPass.requiresPassphrase, true);
});

test('Replacement-phone Disaster Recovery restores full dataset + billDocuments into empty IndexedDB via atomic rollback guard', async () => {
  const transport = createMemoryCloudBackupTransport();
  const originalDataset = makeRichDataset();

  // Phone A uploads encrypted snapshot
  const uploadRes = await uploadEncryptedCloudBackup({
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    dataset: originalDataset,
    passphrase: STRONG_PASSPHRASE,
    bucket: 'daily',
    isOnline: true,
    now: new Date('2026-11-16T06:00:00.000Z'),
  });

  // Phone B starts completely fresh empty IndexedDB
  const phoneBDb = createMemoryLocalDbAdapter();
  const freshEmptyDataset = createEmptyBusinessDataset();
  await phoneBDb.commitBusinessDatasetAtomic(freshEmptyDataset);

  // Phone B lists owner backups, downloads, decrypts, and restores cleanly
  const remoteList = await listUserCloudBackups(transport, OWNER_USER.uid);
  assert.ok(remoteList.some((e) => e.fullPath === uploadRes.uploadedEntry.fullPath));

  const restoreRes = await restoreCloudBackupSafely({
    db: phoneBDb,
    currentDataset: freshEmptyDataset,
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    fullPath: uploadRes.uploadedEntry.fullPath,
    passphrase: STRONG_PASSPHRASE,
  });

  assert.equal(restoreRes.success, true);
  assert.ok(restoreRes.verifiedCounts?.verified);
  assert.equal(restoreRes.verifiedCounts?.sales, originalDataset.sales.length);
  assert.equal(restoreRes.verifiedCounts?.customers, originalDataset.customers.length);
  assert.equal(restoreRes.verifiedCounts?.billDocuments, 1);

  const hydratedPhoneB = await phoneBDb.loadBusinessDataset();
  assert.equal(hydratedPhoneB.profile?.storeName, 'Arjun Groceries');
  assert.equal(hydratedPhoneB.dailySalesTarget?.amount, 6500);
  assert.equal(hydratedPhoneB.lastClosedDate, '2026-11-15');
  assert.equal(hydratedPhoneB.billDocuments?.length, 1);
  assert.equal(
    hydratedPhoneB.billDocuments?.[0]?.dataUrl,
    originalDataset.billDocuments?.[0]?.dataUrl
  );
});

test('Double-fault rollback failure during cloud restore throws CriticalRestoreRollbackError instead of false success', async () => {
  const transport = createMemoryCloudBackupTransport();
  const originalDataset = makeRichDataset();
  const uploadRes = await uploadEncryptedCloudBackup({
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    dataset: originalDataset,
    passphrase: STRONG_PASSPHRASE,
    bucket: 'manual',
    isOnline: true,
    now: new Date('2026-11-16T06:00:00.000Z'),
  });

  const baseDb = createMemoryLocalDbAdapter();
  await baseDb.commitBusinessDatasetAtomic(originalDataset);

  let commitCount = 0;
  const doubleFaultDb: LocalDbAdapter = {
    isIndexedDB: baseDb.isIndexedDB,
    getAll: baseDb.getAll.bind(baseDb),
    getByKey: baseDb.getByKey.bind(baseDb),
    putOne: baseDb.putOne.bind(baseDb),
    deleteOne: baseDb.deleteOne.bind(baseDb),
    replaceStoreAtomic: baseDb.replaceStoreAtomic.bind(baseDb),
    loadBusinessDataset: baseDb.loadBusinessDataset.bind(baseDb),
    getBillDocuments: baseDb.getBillDocuments.bind(baseDb),
    saveBillDocumentRecord: baseDb.saveBillDocumentRecord.bind(baseDb),
    deleteBillDocumentRecord: baseDb.deleteBillDocumentRecord.bind(baseDb),
    getMeta: baseDb.getMeta.bind(baseDb),
    setMeta: baseDb.setMeta.bind(baseDb),
    async commitBusinessDatasetAtomic() {
      commitCount++;
      if (commitCount === 1) throw new Error('Simulated cloud restore IDB write failure');
      throw new Error('Simulated rollback IDB write failure');
    },
  };

  await assert.rejects(
    () =>
      restoreCloudBackupSafely({
        db: doubleFaultDb,
        currentDataset: originalDataset,
        transport,
        authUser: OWNER_USER,
        config: DEFAULT_CLOUD_BACKUP_CONFIG,
        fullPath: uploadRes.uploadedEntry.fullPath,
        passphrase: STRONG_PASSPHRASE,
      }),
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.code, 'CRITICAL_RECOVERY_FAILURE');
      return true;
    }
  );
});

test('Phase 6.1: Cloud backups generate unique immutable IDs per upload and never overwrite existing objects', async () => {
  const transport = createMemoryCloudBackupTransport();
  const dataset = makeRichDataset();
  const sameMoment = new Date('2026-11-16T06:00:00.000Z');

  // Same timestamp daily/weekly/manual path generation must produce distinct immutable backup IDs
  const d1 = buildCloudBackupPath(OWNER_USER.uid, 'daily', sameMoment);
  const d2 = buildCloudBackupPath(OWNER_USER.uid, 'daily', sameMoment);
  const w1 = buildCloudBackupPath(OWNER_USER.uid, 'weekly', sameMoment);
  const w2 = buildCloudBackupPath(OWNER_USER.uid, 'weekly', sameMoment);
  const m1 = buildCloudBackupPath(OWNER_USER.uid, 'manual', sameMoment);
  const m2 = buildCloudBackupPath(OWNER_USER.uid, 'manual', sameMoment);

  assert.notEqual(d1.fullPath, d2.fullPath);
  assert.notEqual(w1.fullPath, w2.fullPath);
  assert.notEqual(m1.fullPath, m2.fullPath);

  // Regex compatibility with storage.rules
  assert.match(d1.fileName, /^backup-\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{6,20}\.skbackup\.json$/);
  assert.match(w1.fileName, /^backup-\d{4}-W\d{2}-\d{6}-[a-z0-9]{6,20}\.skbackup\.json$/);
  assert.match(m1.fileName, /^backup-\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{6,20}\.skbackup\.json$/);

  // Two daily uploads on the exact same IST day must coexist without overwriting each other
  const firstUpload = await uploadEncryptedCloudBackup({
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    dataset,
    passphrase: STRONG_PASSPHRASE,
    bucket: 'daily',
    isOnline: true,
    now: sameMoment,
  });

  const secondUpload = await uploadEncryptedCloudBackup({
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    dataset,
    passphrase: STRONG_PASSPHRASE,
    bucket: 'daily',
    isOnline: true,
    now: sameMoment,
  });

  assert.notEqual(firstUpload.uploadedEntry.fullPath, secondUpload.uploadedEntry.fullPath);
  assert.ok(transport._objects.has(firstUpload.uploadedEntry.fullPath));
  assert.ok(transport._objects.has(secondUpload.uploadedEntry.fullPath));

  // Direct transport write collision must be rejected
  await assert.rejects(
    () =>
      transport.uploadEncryptedObject({
        path: firstUpload.uploadedEntry.fullPath,
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'application/json',
        customMetadata: {
          format: 'SKPRO_ENC_V1',
          cipher: 'AES-256-GCM',
          ciphertextSha256: 'a'.repeat(64),
        },
      }),
    /Immutable backup collision/i
  );

  // Confirm production Firebase transport uses uploadBytesResumable
  const managerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/utils/cloudBackupManager.ts'),
    'utf8'
  );
  assert.match(managerSource, /uploadBytesResumable/);
});

test('Phase 6.1: Failed or SHA-256-mismatched upload aborts immediately before any retention pruning runs', async () => {
  const baseTransport = createMemoryCloudBackupTransport();
  const dataset = makeRichDataset();

  // Seed 8 daily backups + 2 manual backups so pruning WOULD normally happen on next verified upload
  for (let i = 1; i <= 8; i++) {
    await uploadEncryptedCloudBackup({
      transport: baseTransport,
      authUser: OWNER_USER,
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      dataset,
      passphrase: STRONG_PASSPHRASE,
      bucket: 'daily',
      isOnline: true,
      now: new Date(`2026-11-0${i}T06:00:00.000Z`),
    });
  }
  for (let i = 1; i <= 2; i++) {
    await uploadEncryptedCloudBackup({
      transport: baseTransport,
      authUser: OWNER_USER,
      config: DEFAULT_CLOUD_BACKUP_CONFIG,
      dataset,
      passphrase: STRONG_PASSPHRASE,
      bucket: 'manual',
      isOnline: true,
      now: new Date(`2026-11-0${i}T08:00:00.000Z`),
    });
  }

  const pathsBeforeFailure = Array.from(baseTransport._objects.keys()).sort();
  let deleteAttempted = false;

  // Case 1: Metadata SHA-256 mismatch detected after upload -> must abort without pruning
  const tamperedMetaTransport: CloudBackupStorageTransport = {
    uploadEncryptedObject: baseTransport.uploadEncryptedObject,
    listObjects: baseTransport.listObjects,
    downloadObjectBytes: baseTransport.downloadObjectBytes,
    async getObjectMetadata(fullPath) {
      const meta = await baseTransport.getObjectMetadata!(fullPath);
      if (!meta) return null;
      return {
        ...meta,
        customMetadata: {
          ...meta.customMetadata,
          ciphertextSha256: '0'.repeat(64),
        },
      };
    },
    async deleteObject(fullPath) {
      deleteAttempted = true;
      return baseTransport.deleteObject(fullPath);
    },
  };

  await assert.rejects(
    () =>
      uploadEncryptedCloudBackup({
        transport: tamperedMetaTransport,
        authUser: OWNER_USER,
        config: DEFAULT_CLOUD_BACKUP_CONFIG,
        dataset,
        passphrase: STRONG_PASSPHRASE,
        bucket: 'daily',
        isOnline: true,
        now: new Date('2026-11-09T06:00:00.000Z'),
      }),
    /SHA-256 mismatch/i
  );
  assert.equal(deleteAttempted, false);
  for (const p of pathsBeforeFailure) {
    assert.ok(baseTransport._objects.has(p));
  }

  // Case 2: Truncated/corrupted read-back bytes -> must abort without pruning
  const truncatedDownloadTransport: CloudBackupStorageTransport = {
    uploadEncryptedObject: baseTransport.uploadEncryptedObject,
    listObjects: baseTransport.listObjects,
    getObjectMetadata: baseTransport.getObjectMetadata,
    async downloadObjectBytes(fullPath) {
      const res = await baseTransport.downloadObjectBytes(fullPath);
      return {
        ...res,
        bytes: res.bytes.slice(0, Math.max(1, res.bytes.byteLength - 10)),
      };
    },
    async deleteObject(fullPath) {
      deleteAttempted = true;
      return baseTransport.deleteObject(fullPath);
    },
  };

  await assert.rejects(
    () =>
      uploadEncryptedCloudBackup({
        transport: truncatedDownloadTransport,
        authUser: OWNER_USER,
        config: DEFAULT_CLOUD_BACKUP_CONFIG,
        dataset,
        passphrase: STRONG_PASSPHRASE,
        bucket: 'daily',
        isOnline: true,
        now: new Date('2026-11-10T06:00:00.000Z'),
      }),
    /size mismatch|SHA-256/i
  );
  assert.equal(deleteAttempted, false);
  for (const p of pathsBeforeFailure) {
    assert.ok(baseTransport._objects.has(p));
  }
});

test('Consolidated Repair: storage.rules forbids updates, download rejects missing integrity metadata, success marks VERIFIED, and >50 MB rejects cleanly without omitting billDocuments', async () => {
  // 1) storage.rules must strictly forbid object updates
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf8');
  assert.match(rulesText, /allow\s+update\s*:\s*if\s+false\s*;/);
  assert.match(rulesText, /50\s*\*\s*1024\s*\*\s*1024/);

  // 2) Successful upload populates verificationStatus: 'VERIFIED' + verifiedAt
  const transport = createMemoryCloudBackupTransport();
  const dataset = makeRichDataset();
  const okRes = await uploadEncryptedCloudBackup({
    transport,
    authUser: OWNER_USER,
    config: DEFAULT_CLOUD_BACKUP_CONFIG,
    dataset,
    passphrase: STRONG_PASSPHRASE,
    bucket: 'manual',
    isOnline: true,
    now: new Date('2026-11-16T07:00:00.000Z'),
  });
  assert.equal(okRes.status.verificationStatus, 'VERIFIED');
  assert.ok(okRes.status.verifiedAt);

  // 3) Download & restore MUST reject if customMetadata / ciphertextSha256 is missing
  const missingMetaTransport: CloudBackupStorageTransport = {
    ...transport,
    async downloadObjectBytes(fullPath) {
      const res = await transport.downloadObjectBytes(fullPath);
      return {
        bytes: res.bytes,
        customMetadata: {},
      };
    },
  };
  await assert.rejects(
    () =>
      downloadAndInspectCloudBackup({
        transport: missingMetaTransport,
        uid: OWNER_USER.uid,
        fullPath: okRes.uploadedEntry.fullPath,
        passphrase: STRONG_PASSPHRASE,
      }),
    /metadata verification failed/i
  );

  // 4) Payload exceeding MAX_CLOUD_BACKUP_BYTES (50 MB) rejects before upload WITHOUT dropping billDocuments
  const hugeAttachment: BillAttachment = {
    id: 'att-huge-50mb',
    name: 'huge-scan.pdf',
    type: 'PDF',
    // Random/incompressible-enough or raw JSON > 50MB
    dataUrl: `data:application/pdf;base64,${'A'.repeat(MAX_CLOUD_BACKUP_BYTES + 1024)}`,
    size: MAX_CLOUD_BACKUP_BYTES + 1024,
    uploadedAt: '2026-11-16T07:00:00.000Z',
  };
  const oversizedDataset: StoreBusinessDataset = {
    ...dataset,
    billDocuments: [...(dataset.billDocuments || []), hugeAttachment],
  };

  let uploadCalled = false;
  const spyTransport: CloudBackupStorageTransport = {
    ...transport,
    async uploadEncryptedObject(params) {
      uploadCalled = true;
      return transport.uploadEncryptedObject(params);
    },
  };

  await assert.rejects(
    () =>
      uploadEncryptedCloudBackup({
        transport: spyTransport,
        authUser: OWNER_USER,
        config: DEFAULT_CLOUD_BACKUP_CONFIG,
        dataset: oversizedDataset,
        passphrase: STRONG_PASSPHRASE,
        bucket: 'manual',
        isOnline: true,
      }),
    /exceeds the 50 MB Firebase Storage object limit/i
  );
  assert.equal(uploadCalled, false);
  // Original dataset still retains all billDocuments intact
  assert.ok(oversizedDataset.billDocuments?.some((b) => b.id === 'att-huge-50mb'));
});

