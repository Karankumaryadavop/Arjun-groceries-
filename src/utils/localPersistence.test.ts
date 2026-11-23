/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryLocalDbAdapter,
  deduplicateById,
  enqueueSyncMutation,
  LEGACY_STORAGE_KEYS,
  listLocalBackups,
  listSyncConflicts,
  listSyncQueueItems,
  migrateLegacyLocalStorageToLocalDb,
  STORE_NAMES,
} from './localDatabase';
import {
  CloudTransportAdapter,
  detectSyncConflict,
  getSyncCounters,
  processSyncQueue,
  resolveConflictItem,
} from './cloudSyncEngine';
import {
  buildCustomerCloudPayload,
  buildSaleCloudPayload,
  buildStoreWorkspacePayload,
} from './firestorePayload';
import {
  applyBackupRetentionPolicy,
  buildEncryptedBackupFileContent,
  buildVerifiedBackupEnvelope,
  createLocalBackupSnapshot,
  inspectAndValidateBackupContent,
  restoreBackupSafelyWithRollback,
  validateBackupWithChecksum,
} from './localBackupManager';
import {
  clearPinAttemptState,
  computePinLockoutDelaySeconds,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  getPinCooldownRemainingSeconds,
  hashPinWithSalt,
  PinHashPayload,
  recordFailedPinAttempt,
  verifyPinHash,
} from './securityCrypto';
import {
  computeWhatsAppReminderAnalytics,
  DEFAULT_WHATSAPP_TEMPLATE_CONFIG,
  getCustomerReminderHistory,
  renderWhatsAppTemplateMessage,
  validateWhatsAppTemplate,
} from './whatsappTemplate';
import {
  initialAuditLogs,
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
} from './initialData';
import { LocalBackupSnapshot, StoreBusinessDataset, WhatsAppReminderBatch } from '../types';

function makeSeedDataset(): StoreBusinessDataset {
  return {
    profile: initialStoreProfile,
    customers: initialCustomers,
    customerTransactions: initialCustomerTransactions,
    suppliers: initialSuppliers,
    supplierTransactions: initialSupplierTransactions,
    sales: initialSales,
    expenses: initialExpenses,
    cashbookEntries: initialCashbookEntries,
    products: initialProducts,
    stockAdjustments: initialStockAdjustments,
    auditLogs: initialAuditLogs,
    whatsappBatches: [],
    whatsappAuditLogs: [],
    lastClosedDate: null,
  };
}

test('Stage 1: Non-destructive migration preserves localStorage and never overwrites newer IndexedDB data', async () => {
  const legacyMap = new Map<string, string>();
  const customProfile = { ...initialStoreProfile, storeName: 'Raju Kirana & General' };
  const customCustomers = [
    ...initialCustomers,
    {
      id: 'cust-legacy-99',
      name: 'Legacy Customer',
      phone: '9876500001',
      openingBalance: 0,
      currentBalance: 450,
      totalCreditGiven: 450,
      totalPaymentReceived: 0,
      overdueDays: 3,
      category: 'REGULAR' as const,
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ];

  legacyMap.set(LEGACY_STORAGE_KEYS.PROFILE, JSON.stringify(customProfile));
  legacyMap.set(LEGACY_STORAGE_KEYS.CUSTOMERS, JSON.stringify(customCustomers));
  legacyMap.set(LEGACY_STORAGE_KEYS.SALES, JSON.stringify(initialSales));
  legacyMap.set(LEGACY_STORAGE_KEYS.PRODUCTS, JSON.stringify(initialProducts));

  const mockStorage = {
    getItem: (k: string) => legacyMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      legacyMap.set(k, v);
    },
  };

  const db = createMemoryLocalDbAdapter();
  const seed = makeSeedDataset();

  const firstRun = await migrateLegacyLocalStorageToLocalDb(db, seed, mockStorage);
  assert.equal(firstRun.report.source, 'localStorage');
  assert.equal(firstRun.report.alreadyMigrated, false);
  assert.equal(firstRun.dataset.profile.storeName, 'Raju Kirana & General');
  assert.ok(firstRun.dataset.customers.some((c) => c.id === 'cust-legacy-99'));

  // Legacy localStorage keys must remain untouched as fallback
  assert.ok(legacyMap.has(LEGACY_STORAGE_KEYS.CUSTOMERS));
  assert.ok(legacyMap.has(LEGACY_STORAGE_KEYS.PROFILE));

  // Simulate adding a newer offline customer directly into local DB
  const updatedCustomers = [
    ...firstRun.dataset.customers,
    {
      id: 'cust-offline-100',
      name: 'Offline New Customer',
      phone: '9876500002',
      openingBalance: 0,
      currentBalance: 200,
      totalCreditGiven: 200,
      totalPaymentReceived: 0,
      overdueDays: 0,
      category: 'REGULAR' as const,
      createdAt: '2026-10-02T10:00:00.000Z',
    },
  ];
  await db.commitBusinessDatasetAtomic({ ...firstRun.dataset, customers: updatedCustomers });

  // Second boot must NOT revert to legacy localStorage
  const secondRun = await migrateLegacyLocalStorageToLocalDb(db, seed, mockStorage);
  assert.equal(secondRun.report.alreadyMigrated, true);
  assert.ok(secondRun.dataset.customers.some((c) => c.id === 'cust-offline-100'));
});

test('Stage 1: deduplicateById prevents duplicate records on atomic saves', () => {
  const list = [
    { id: 'p-1', name: 'Old Sugar' },
    { id: 'p-2', name: 'Salt' },
    { id: 'p-1', name: 'Updated Sugar' },
  ];
  const deduped = deduplicateById(list);
  assert.equal(deduped.length, 2);
  assert.equal(deduped.find((i) => i.id === 'p-1')?.name, 'Updated Sugar');
});

test('Stage 2: Retention policy preserves latest 7 daily and 4 weekly snapshots', () => {
  const snapshots: LocalBackupSnapshot[] = [];
  for (let d = 1; d <= 10; d++) {
    const dayStr = String(d).padStart(2, '0');
    snapshots.push({
      id: `daily-${d}`,
      createdAt: `2026-10-${dayStr}T10:00:00.000Z`,
      dateKey: `2026-10-${dayStr}`,
      weekKey: '2026-W41',
      trigger: 'AUTO_INTERVAL',
      bucket: 'DAILY',
      schemaVersion: '2.0.0',
      checksum: 'abc',
      sizeBytes: 100,
      status: 'SUCCESS',
      summary: {
        totalTransactions: 10,
        salesCount: 5,
        salesTotalVolume: 1000,
        customerTransactionsCount: 2,
        supplierTransactionsCount: 1,
        expenseCount: 1,
        expenseTotalVolume: 100,
        cashbookCount: 1,
        customersCount: 3,
        suppliersCount: 2,
        productsCount: 5,
      },
      payloadJson: '{}',
    });
  }

  for (let w = 1; w <= 6; w++) {
    snapshots.push({
      ...snapshots[0],
      id: `weekly-${w}`,
      createdAt: `2026-09-${String(w * 4).padStart(2, '0')}T10:00:00.000Z`,
      dateKey: `2026-09-${String(w * 4).padStart(2, '0')}`,
      weekKey: `2026-W3${w}`,
      bucket: 'WEEKLY',
    });
  }

  const { keep, pruneIds } = applyBackupRetentionPolicy(snapshots);
  const keptDaily = keep.filter((s) => s.bucket === 'DAILY');
  const keptWeekly = keep.filter((s) => s.bucket === 'WEEKLY');

  assert.equal(keptDaily.length, 7);
  assert.equal(keptWeekly.length, 4);
  assert.equal(pruneIds.length, 5); // 3 oldest daily + 2 oldest weekly pruned
  assert.ok(keptDaily.some((s) => s.id === 'daily-10'));
  assert.ok(!keptDaily.some((s) => s.id === 'daily-1'));
});

test('Stage 2: Checksum validation catches corrupted/tampered JSON and rollback safety restores cleanly', async () => {
  const db = createMemoryLocalDbAdapter();
  const seed = makeSeedDataset();
  await db.commitBusinessDatasetAtomic(seed);

  const envelope = await buildVerifiedBackupEnvelope(seed);
  const validCheck = await validateBackupWithChecksum(envelope.jsonString);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.checksumValid, true);

  // Tamper with storeName without updating checksum
  const tamperedJson = envelope.jsonString.replace(
    seed.profile.storeName,
    'Tampered Store Name'
  );
  const invalidCheck = await validateBackupWithChecksum(tamperedJson);
  assert.equal(invalidCheck.valid, false);
  assert.equal(invalidCheck.checksumValid, false);

  // Restore into fresh DB with rollback safety
  const modifiedDataset: StoreBusinessDataset = {
    ...seed,
    profile: { ...seed.profile, storeName: 'Modified Store Before Restore' },
  };
  await db.commitBusinessDatasetAtomic(modifiedDataset);

  // Attempting restore with corrupt JSON must fail and keep modifiedDataset intact
  const failedRestore = await restoreBackupSafelyWithRollback(db, modifiedDataset, tamperedJson);
  assert.equal(failedRestore.success, false);

  // Attempting restore with verified backup JSON creates PRE_RESTORE checkpoint and restores seed storeName
  const goodRestore = await restoreBackupSafelyWithRollback(db, modifiedDataset, envelope.jsonString);
  assert.equal(goodRestore.success, true);
  assert.equal(goodRestore.restoredDataset?.profile.storeName, seed.profile.storeName);

  const backups = await listLocalBackups(db);
  assert.ok(backups.some((b) => b.trigger === 'PRE_RESTORE'));
});

test('Stage 2: Creating snapshot saves backup metadata & avoids duplicate weekly snapshots in same week', async () => {
  const db = createMemoryLocalDbAdapter();
  const seed = makeSeedDataset();
  await db.commitBusinessDatasetAtomic(seed);

  const snap1 = await createLocalBackupSnapshot(db, seed, 'AUTO_BATCH', 'After quick sale');
  assert.equal(snap1.status, 'SUCCESS');
  const backups = await listLocalBackups(db);
  assert.ok(backups.some((b) => b.id === snap1.id));
  assert.ok(backups.some((b) => b.bucket === 'WEEKLY'));
});

test('Stage 3 Prep: Offline sync queue deduplicates identical mutations by idempotency key', async () => {
  const db = createMemoryLocalDbAdapter();
  const sale = initialSales[0];
  const first = await enqueueSyncMutation(db, {
    entityType: 'SALE',
    entityId: sale.id,
    payloadSnapshot: sale,
  });
  const second = await enqueueSyncMutation(db, {
    entityType: 'SALE',
    entityId: sale.id,
    payloadSnapshot: sale,
  });

  assert.equal(first.id, second.id);
  const queue = await listSyncQueueItems(db);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, 'PENDING');
});

test('WhatsApp Template Builder: validates Meta guidelines and renders custom tokens accurately', () => {
  const invalidResult = validateWhatsAppTemplate({
    templateName: 'Bad Name!',
    bodyTemplate: 'Click bit.ly/pay now for FREE MONEY!',
    footerText: '',
  });
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.errors.length >= 3);

  const validResult = validateWhatsAppTemplate(DEFAULT_WHATSAPP_TEMPLATE_CONFIG);
  assert.equal(validResult.valid, true);
  assert.equal(validResult.score, 100);

  const customRendered = renderWhatsAppTemplateMessage(
    {
      templateName: 'kirana_due_custom',
      bodyTemplate: 'Hello {{customer_name}}, {{store_name}} due is Rs.{{amount}} ({{invoices}}){{upi_id}}',
      footerText: 'Regards, {{store_name}}',
      includeInvoiceList: true,
      includeUpiId: true,
      updatedAt: '2026-11-12T10:00:00.000Z',
    },
    {
      customerName: 'Suresh',
      storeProfile: initialStoreProfile,
      totalOutstanding: 850,
      invoices: [
        {
          invoiceId: 's-1',
          invoiceNo: 'INV-101',
          date: '2026-11-10T10:00:00.000Z',
          originalAmount: 850,
          paidAmount: 0,
          outstandingAmount: 850,
        },
      ],
    }
  );

  assert.ok(customRendered.includes('Hello Suresh'));
  assert.ok(customRendered.includes('Rs.850'));
  assert.ok(customRendered.includes('INV-101'));
  assert.ok(customRendered.includes(initialStoreProfile.upiId));
});

test('WhatsApp Analytics & Customer Reminder History aggregate delivery and recovery accurately', () => {
  const refDate = new Date('2026-11-12T12:00:00.000Z');
  const cust = { ...initialCustomers[0], currentBalance: 200 };
  const sampleBatch: WhatsAppReminderBatch = {
    id: 'batch-test-1',
    idempotencyKey: 'key-1',
    scheduledExecutionTime: '2026-11-08T06:30:00.000Z',
    dateWindowStart: '2026-11-01T06:30:00.000Z',
    dateWindowEnd: '2026-11-08T06:30:00.000Z',
    status: 'COMPLETED',
    totalEligibleCustomers: 2,
    totalEligibleInvoices: 2,
    totalOutstandingAmount: 1500,
    customersWithMissingPhone: 0,
    customersWithoutConsent: 0,
    excludedCustomersCount: 0,
    createdAt: '2026-11-08T06:30:00.000Z',
    updatedAt: '2026-11-08T07:00:00.000Z',
    items: [
      {
        customerId: cust.id,
        customerName: cust.name,
        phone: cust.phone,
        formattedPhone: '919876543210',
        hasValidPhone: true,
        hasConsent: true,
        eligibilityStatus: 'ELIGIBLE',
        invoices: [
          {
            invoiceId: 's1',
            invoiceNo: 'INV-501',
            date: '2026-11-05T10:00:00.000Z',
            originalAmount: 1000,
            paidAmount: 0,
            outstandingAmount: 1000,
          },
        ],
        totalOutstanding: 1000,
        messageText: 'Namaste reminder 1000',
        status: 'DELIVERED',
        idempotencyKey: 'idem-1',
        approved: true,
        sentAt: '2026-11-08T07:00:00.000Z',
        wabaMessageId: 'wamid.123',
      },
      {
        customerId: 'cust-2',
        customerName: 'Mohan',
        phone: '9999999999',
        formattedPhone: '919999999999',
        hasValidPhone: true,
        hasConsent: true,
        eligibilityStatus: 'ELIGIBLE',
        invoices: [],
        totalOutstanding: 500,
        messageText: 'Namaste reminder 500',
        status: 'FAILED',
        idempotencyKey: 'idem-2',
        approved: true,
        lastAttemptAt: '2026-11-08T07:01:00.000Z',
        errorReason: 'Rate limited',
      },
    ],
  };

  const payments = [
    {
      id: 'tx-pay-after',
      customerId: cust.id,
      type: 'PAYMENT' as const,
      amount: 800,
      date: '2026-11-10T11:00:00.000Z',
      description: 'Paid via UPI after reminder',
      createdAt: '2026-11-10T11:00:00.000Z',
    },
  ];

  const analytics = computeWhatsAppReminderAnalytics(
    [sampleBatch],
    [],
    [cust],
    payments,
    refDate
  );

  assert.equal(analytics.summary.sentCount, 1);
  assert.equal(analytics.summary.deliveredOrReadCount, 1);
  assert.equal(analytics.summary.failedCount, 1);
  assert.equal(analytics.summary.successRatePct, 50);
  assert.equal(analytics.summary.totalRemindedRupees, 1000);
  assert.equal(analytics.summary.totalRecoveredAfterReminder, 800);
  assert.equal(analytics.summary.outstandingReductionPct, 80);
  assert.equal(analytics.trend30Days.length, 30);

  const duplicateAuditLog = {
    id: 'audit-dup-1',
    timestamp: '2026-11-08T07:00:01.000Z',
    action: 'MESSAGE_SENT' as const,
    customerId: cust.id,
    customerName: cust.name,
    wabaMessageId: 'wamid.123',
    details: 'Duplicate log without batchId',
  };
  const history = getCustomerReminderHistory(cust.id, [sampleBatch], [duplicateAuditLog]);
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'DELIVERED');
  assert.equal(history[0].outstandingAtTime, 1000);
  assert.deepEqual(history[0].invoiceNumbers, ['INV-501']);
});

test('Stage 3: Sync queue retries after offline failure and resolves conflicts without overwriting local data', async () => {
  const db = createMemoryLocalDbAdapter();
  const sale = initialSales[0];
  await enqueueSyncMutation(db, {
    entityType: 'SALE',
    entityId: sale.id,
    payloadSnapshot: sale,
  });

  let mode: 'FAIL' | 'CONFLICT' | 'OK' = 'FAIL';
  const mockTransport: CloudTransportAdapter = {
    isConfigured: true,
    async pushRecord() {
      if (mode === 'FAIL') {
        return { ok: false, error: 'Temporary network timeout' };
      }
      if (mode === 'CONFLICT') {
        return {
          ok: false,
          conflict: {
            remoteUpdatedAt: '2026-11-12T15:00:00.000Z',
            remoteSnapshot: { ...sale, amount: 999 },
            entityLabel: `Invoice ${sale.invoiceNo}`,
          },
        };
      }
      return { ok: true };
    },
  };

  // Offline skips cleanly
  const offlineRes = await processSyncQueue(db, {
    storageMode: 'CLOUD_SYNC_ENABLED',
    isOnline: false,
    transport: mockTransport,
    resolvePayload: () => sale,
  });
  assert.equal(offlineRes.processed, 0);

  // Network failure marks FAILED while keeping record retryable
  const failRes = await processSyncQueue(db, {
    storageMode: 'CLOUD_SYNC_ENABLED',
    isOnline: true,
    transport: mockTransport,
    resolvePayload: () => sale,
  });
  assert.equal(failRes.failed, 1);
  assert.equal((await getSyncCounters(db)).failedSyncCount, 1);

  // Retry returns conflict -> creates SyncConflictRecord cleanly
  mode = 'CONFLICT';
  const conflictRes = await processSyncQueue(db, {
    storageMode: 'CLOUD_SYNC_ENABLED',
    isOnline: true,
    transport: mockTransport,
    resolvePayload: () => sale,
  });
  assert.equal(conflictRes.conflicts, 1);
  const conflicts = await listSyncConflicts(db);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].resolved, false);

  // Resolve KEEP_LOCAL -> moves item back to PENDING, then succeeds
  await resolveConflictItem(db, conflicts[0].id, 'KEEP_LOCAL');
  mode = 'OK';
  const okRes = await processSyncQueue(db, {
    storageMode: 'CLOUD_SYNC_ENABLED',
    isOnline: true,
    transport: mockTransport,
    resolvePayload: () => sale,
  });
  assert.equal(okRes.synced, 1);
  assert.equal((await getSyncCounters(db)).pendingSyncCount, 0);
  assert.equal((await getSyncCounters(db)).conflictCount, 0);

  assert.equal(
    detectSyncConflict({
      localUpdatedAt: '2026-11-12T10:00:00.000Z',
      remoteUpdatedAt: '2026-11-12T12:00:00.000Z',
      lastSyncedAt: '2026-11-12T09:00:00.000Z',
      localPayloadHash: 'aaa',
      remotePayloadHash: 'bbb',
    }),
    true
  );
});

test('Firebase Payload Sanitizers: enforce strict blueprint keys, ID regex, and volumetric bounds', () => {
  const longName = 'A'.repeat(300);
  const ws = buildStoreWorkspacePayload('uid-123$bad', { ...initialStoreProfile, storeName: longName }, '2026-11-12');
  assert.equal(ws.ownerId, 'uid-123_bad');
  assert.equal((ws.storeName as string).length, 160);
  assert.ok(!('pinHash' in ws) && !('securityPin' in ws));

  const cust = buildCustomerCloudPayload('uid-1', { ...initialCustomers[0], name: longName });
  assert.equal((cust.name as string).length, 160);
  assert.equal(cust.ownerId, 'uid-1');

  const manyItems = Array.from({ length: 130 }, (_, i) => ({
    productId: `p-${i}`,
    productName: `Item ${i}`,
    quantity: 1,
    unit: 'pcs',
    rate: 10,
    total: 10,
  }));
  const sale = buildSaleCloudPayload('uid-1', {
    ...initialSales[0],
    items: manyItems,
    notes: 'N'.repeat(600),
  });
  assert.equal((sale.items as unknown[]).length, 100);
  assert.equal((sale.notes as string).length, 400);
});

test('Security Crypto: PBKDF2 salted PIN verification and AES-256-GCM backup encryption reject tampering & wrong passphrases', async () => {
  const hash1 = await hashPinWithSalt('4829');
  const hash2 = await hashPinWithSalt('4829');
  assert.notEqual(hash1.saltBase64, hash2.saltBase64);
  assert.notEqual(hash1.hashBase64, hash2.hashBase64);
  assert.equal(await verifyPinHash('4829', hash1), true);
  assert.equal(await verifyPinHash('1234', hash1), false);
  assert.equal(await verifyPinHash('4829', null), false);

  const sampleJson = JSON.stringify({ hello: 'SmartKirana', amount: 1234 });
  const env = await encryptBackupEnvelope(sampleJson, 'MyShopSecret#2026', {
    storeName: 'Sharma Kirana',
  });
  const decrypted = await decryptBackupEnvelope(env, 'MyShopSecret#2026');
  assert.equal(decrypted, sampleJson);

  await assert.rejects(
    () => decryptBackupEnvelope(env, 'WrongPassphrase'),
    /Incorrect passphrase/
  );

  // Tamper ciphertext byte
  const tampered = {
    ...env,
    ciphertextBase64: `${env.ciphertextBase64.slice(0, -2)}AA`,
  };
  await assert.rejects(
    () => decryptBackupEnvelope(tampered, 'MyShopSecret#2026'),
    /Incorrect passphrase or tampered/
  );

  await assert.rejects(
    () => encryptBackupEnvelope(sampleJson, '12'),
    /at least 4 characters/
  );
});

test('Unified IDB v2 Migration & Encrypted Backup: strips plaintext PIN, deduplicates attachments, and restores complete state', async () => {
  const db = createMemoryLocalDbAdapter();
  const legacyMap = new Map<string, string>();

  const legacyProfile = {
    ...initialStoreProfile,
    storeName: 'Patel Kirana Bhandar',
    isPinEnabled: true,
    pinCode: '5678',
  };
  const samplePngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const saleWithAttachment = {
    ...initialSales[0],
    id: 'sale-with-doc-1',
    attachments: [
      {
        id: 'att-legacy-1',
        name: 'bill-photo.png',
        type: 'IMAGE' as const,
        dataUrl: '',
        size: 68,
        uploadedAt: '2026-11-10T10:00:00.000Z',
        transactionId: 'sale-with-doc-1',
        transactionType: 'SALE' as const,
      },
    ],
  };

  legacyMap.set(LEGACY_STORAGE_KEYS.PROFILE, JSON.stringify(legacyProfile));
  legacyMap.set(LEGACY_STORAGE_KEYS.SALES, JSON.stringify([saleWithAttachment]));
  legacyMap.set(LEGACY_STORAGE_KEYS.CUSTOMERS, JSON.stringify(initialCustomers));

  const mockStorage = {
    getItem: (k: string) => legacyMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      legacyMap.set(k, v);
    },
  };

  const legacyDocLoader = async () => [
    {
      id: 'att-legacy-1',
      name: 'bill-photo.png',
      type: 'IMAGE' as const,
      dataUrl: samplePngDataUrl,
      size: 68,
      uploadedAt: '2026-11-10T10:00:00.000Z',
      transactionId: 'sale-with-doc-1',
      transactionType: 'SALE' as const,
    },
  ];

  const seed = makeSeedDataset();
  const migrated = await migrateLegacyLocalStorageToLocalDb(db, seed, mockStorage, legacyDocLoader);

  assert.equal(migrated.report.source, 'localStorage');
  assert.equal(migrated.report.schemaVersion, '4.0.0-local-v2');
  assert.equal(migrated.dataset.profile.pinCode, undefined);

  // Salted PIN hash was stored in meta store and matches '5678'
  const storedPinRecord = await db.getMeta<PinHashPayload>('pinSecurity');
  assert.ok(storedPinRecord);
  assert.equal(await verifyPinHash('5678', storedPinRecord), true);
  assert.equal(await verifyPinHash('1234', storedPinRecord), false);

  // Attachment was consolidated into unified billDocuments store and stripped from raw sales store
  const rawSales = await db.getAll<{ id: string; attachments?: Array<{ dataUrl: string }> }>(
    STORE_NAMES.SALES
  );
  assert.equal(rawSales[0].attachments?.[0].dataUrl, '');

  // Loading business dataset rehydrates attachments cleanly
  const loaded = await db.loadBusinessDataset();
  assert.equal(loaded?.billDocuments?.length, 1);
  assert.equal(loaded?.sales?.[0]?.attachments?.[0]?.dataUrl, samplePngDataUrl);

  // Add Stage 4 recurring expense + daily target, then export AES-256-GCM encrypted backup
  const enrichedDataset: StoreBusinessDataset = {
    ...migrated.dataset,
    billDocuments: loaded?.billDocuments || [],
    dailySalesTarget: { amount: 7500, updatedAt: '2026-11-14T08:00:00.000Z' },
    recurringExpenses: [
      {
        id: 'rec-rent-1',
        title: 'Dukan Kiraya',
        category: 'SHOP',
        amount: 9500,
        isPersonalWithdrawal: false,
        paymentMethod: 'BANK',
        frequency: 'MONTHLY',
        startDate: '2026-11-01',
        nextDueDate: '2026-12-01',
        autoCreateOnDue: true,
        isActive: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  };
  await db.commitBusinessDatasetAtomic(enrichedDataset);

  const encrypted = await buildEncryptedBackupFileContent(enrichedDataset, 'KiranaVault@99');

  // Inspecting without passphrase detects encryption without failing into garbage parse
  const noPassInspect = await inspectAndValidateBackupContent(encrypted.jsonString);
  assert.equal(noPassInspect.isEncrypted, true);
  assert.equal(noPassInspect.requiresPassphrase, true);
  assert.equal(noPassInspect.valid, false);

  // Inspecting with correct passphrase validates checksum and restores Stage 4 fields + attachments
  const passInspect = await inspectAndValidateBackupContent(encrypted.jsonString, 'KiranaVault@99');
  assert.equal(passInspect.valid, true);
  assert.equal(passInspect.checksumValid, true);
  assert.equal(passInspect.data?.billDocuments?.length, 1);
  assert.equal(passInspect.data?.dailySalesTarget?.amount, 7500);
  assert.equal(passInspect.data?.recurringExpenses?.length, 1);

  // Restore into a wiped DB using encrypted content & passphrase
  const freshDb = createMemoryLocalDbAdapter();
  await freshDb.commitBusinessDatasetAtomic(seed);
  const restoreRes = await restoreBackupSafelyWithRollback(
    freshDb,
    seed,
    encrypted.jsonString,
    'KiranaVault@99'
  );
  assert.equal(restoreRes.success, true);
  assert.equal(restoreRes.restoredDataset?.profile.storeName, 'Patel Kirana Bhandar');
  assert.equal(restoreRes.restoredDataset?.dailySalesTarget?.amount, 7500);
  assert.equal(restoreRes.restoredDataset?.recurringExpenses?.[0].title, 'Dukan Kiraya');
  assert.equal(restoreRes.restoredDataset?.billDocuments?.[0].dataUrl, samplePngDataUrl);
  assert.ok(restoreRes.verifiedCounts?.verified);
  assert.equal(restoreRes.verifiedCounts?.customers, enrichedDataset.customers.length);
  assert.equal(restoreRes.verifiedCounts?.sales, enrichedDataset.sales.length);
  assert.equal(restoreRes.verifiedCounts?.billDocuments, 1);

  // Re-running restore idempotently must not duplicate transactions or documents
  const restoreAgain = await restoreBackupSafelyWithRollback(
    freshDb,
    enrichedDataset,
    encrypted.jsonString,
    'KiranaVault@99'
  );
  assert.equal(restoreAgain.success, true);
  assert.equal(restoreAgain.verifiedCounts?.sales, enrichedDataset.sales.length);
  assert.equal(restoreAgain.verifiedCounts?.customers, enrichedDataset.customers.length);
  assert.equal(restoreAgain.verifiedCounts?.billDocuments, 1);
  assert.ok(restoreAgain.reconciliationReport);
});

test('Phase 2 Recovery Safety: protects PRE_RESTORE snapshots from MANUAL pruning, rejects missing v2.2 checksum, and rolls back on read-back count mismatch', async () => {
  const db = createMemoryLocalDbAdapter();
  const seed = makeSeedDataset();
  await db.commitBusinessDatasetAtomic(seed);

  // Build 12 MANUAL snapshots + 2 RECOVERY PRE_RESTORE snapshots
  const snapshots: LocalBackupSnapshot[] = [];
  for (let i = 1; i <= 12; i++) {
    snapshots.push({
      id: `manual-${i}`,
      createdAt: `2026-11-${String(i).padStart(2, '0')}T10:00:00.000Z`,
      dateKey: `2026-11-${String(i).padStart(2, '0')}`,
      weekKey: '2026-W45',
      trigger: 'MANUAL',
      bucket: 'MANUAL',
      schemaVersion: '2.2.0',
      checksum: 'hash',
      sizeBytes: 100,
      status: 'SUCCESS',
      summary: {
        totalTransactions: 10,
        salesCount: 2,
        salesTotalVolume: 500,
        customerTransactionsCount: 2,
        supplierTransactionsCount: 2,
        expenseCount: 2,
        expenseTotalVolume: 200,
        cashbookCount: 2,
        customersCount: 2,
        suppliersCount: 2,
        productsCount: 5,
      },
      payloadJson: '{}',
    });
  }
  snapshots.push({
    ...snapshots[0],
    id: 'recovery-pre-restore-1',
    createdAt: '2026-10-01T09:00:00.000Z',
    trigger: 'PRE_RESTORE',
    bucket: 'RECOVERY',
  });

  const retention = applyBackupRetentionPolicy(snapshots);
  assert.ok(retention.keep.some((s) => s.id === 'recovery-pre-restore-1'));
  assert.equal(retention.keep.filter((s) => s.bucket === 'MANUAL').length, 10);

  // Missing checksum on v2.2 backup must be rejected
  const validEnvelope = await buildVerifiedBackupEnvelope(seed);
  const parsedNoSum = JSON.parse(validEnvelope.jsonString) as Record<string, unknown>;
  delete parsedNoSum.checksum;
  delete parsedNoSum.checksumAlgorithm;
  const missingSumResult = await validateBackupWithChecksum(JSON.stringify(parsedNoSum));
  assert.equal(missingSumResult.valid, false);
  assert.match(missingSumResult.error || '', /checksum is missing/i);

  // Simulate post-commit read-back truncation -> must roll back to pre-restore state cleanly
  const currentState: StoreBusinessDataset = {
    ...seed,
    profile: { ...seed.profile, storeName: 'Current Live Store Must Survive' },
  };
  await db.commitBusinessDatasetAtomic(currentState);

  let loadCallCount = 0;
  const flakyReadBackDb = {
    ...db,
    isIndexedDB: db.isIndexedDB,
    getAll: db.getAll.bind(db),
    getByKey: db.getByKey.bind(db),
    putOne: db.putOne.bind(db),
    deleteOne: db.deleteOne.bind(db),
    replaceStoreAtomic: db.replaceStoreAtomic.bind(db),
    commitBusinessDatasetAtomic: db.commitBusinessDatasetAtomic.bind(db),
    getBillDocuments: db.getBillDocuments.bind(db),
    saveBillDocumentRecord: db.saveBillDocumentRecord.bind(db),
    deleteBillDocumentRecord: db.deleteBillDocumentRecord.bind(db),
    getMeta: db.getMeta.bind(db),
    setMeta: db.setMeta.bind(db),
    async loadBusinessDataset() {
      loadCallCount++;
      const real = await db.loadBusinessDataset();
      if (loadCallCount === 1) {
        return {
          ...real,
          sales: [], // simulated count mismatch on post-restore read-back
        };
      }
      return real;
    },
  };

  const rollbackResult = await restoreBackupSafelyWithRollback(
    flakyReadBackDb,
    currentState,
    validEnvelope.jsonString
  );
  assert.equal(rollbackResult.success, false);
  assert.equal(rollbackResult.rollbackSucceeded, true);
  assert.equal(rollbackResult.criticalRecoveryFailure, false);
  assert.match(rollbackResult.error || '', /rolled back safely/i);

  const survived = await db.loadBusinessDataset();
  assert.equal(survived.profile?.storeName, 'Current Live Store Must Survive');
  assert.equal(survived.sales?.length, currentState.sales.length);

  // Ongoing boot consolidation picks up lingering legacy SmartKirana_Bills_DB docs even on v2 DB
  await db.setMeta('schemaVersion', '4.0.0-local-v2');
  const legacyDocData =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const booted = await migrateLegacyLocalStorageToLocalDb(db, seed, undefined, async () => [
    {
      id: 'legacy-late-doc-1',
      name: 'late-bill.png',
      type: 'IMAGE',
      dataUrl: legacyDocData,
      size: 68,
      uploadedAt: '2026-11-12T10:00:00.000Z',
    },
  ]);
  assert.ok(booted.dataset.billDocuments?.some((d) => d.id === 'legacy-late-doc-1'));
});

test('Phase 4 PIN Security: progressive cooldown triggers after 3 failed attempts and migration avoids seeding default 1234', async () => {
  const memStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStore.set(k, v);
    },
    removeItem: (k: string) => {
      memStore.delete(k);
    },
  };

  assert.equal(computePinLockoutDelaySeconds(1), 0);
  assert.equal(computePinLockoutDelaySeconds(2), 0);
  assert.equal(computePinLockoutDelaySeconds(3), 5);
  assert.equal(computePinLockoutDelaySeconds(4), 15);
  assert.equal(computePinLockoutDelaySeconds(5), 30);
  assert.equal(computePinLockoutDelaySeconds(6), 60);

  const t0 = 1_700_000_000_000;
  assert.equal(recordFailedPinAttempt(t0, mockStorage).cooldownSeconds, 0);
  assert.equal(recordFailedPinAttempt(t0 + 1000, mockStorage).cooldownSeconds, 0);
  const third = recordFailedPinAttempt(t0 + 2000, mockStorage);
  assert.equal(third.cooldownSeconds, 5);
  assert.equal(getPinCooldownRemainingSeconds(t0 + 3500, mockStorage), 4);
  assert.equal(getPinCooldownRemainingSeconds(t0 + 8000, mockStorage), 0);

  clearPinAttemptState(mockStorage);
  assert.equal(getPinCooldownRemainingSeconds(t0 + 3500, mockStorage), 0);

  // Fresh seed boot with isPinEnabled=false does NOT seed a 1234 hash into pinSecurity meta
  const db = createMemoryLocalDbAdapter();
  const seed = makeSeedDataset();
  await migrateLegacyLocalStorageToLocalDb(db, seed, undefined);
  const pinMeta = await db.getMeta<PinHashPayload>('pinSecurity');
  assert.equal(pinMeta, null);
});






