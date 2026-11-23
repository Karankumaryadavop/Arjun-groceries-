import test from 'node:test';
import assert from 'node:assert/strict';
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
} from './initialData';
import { LocalBackupSnapshot, StoreBusinessDataset } from '../types';
import {
  buildVerifiedBackupEnvelope,
  CriticalRestoreRollbackError,
  restoreBackupSafelyWithRollback,
} from './localBackupManager';
import {
  createMemoryLocalDbAdapter,
  listLocalBackups,
  LocalDbAdapter,
  STORE_NAMES,
} from './localDatabase';

function makeDisposableDataset(storeName: string, extraSaleId?: string): StoreBusinessDataset {
  const samplePngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const sales = extraSaleId
    ? [
        ...initialSales,
        {
          ...initialSales[0],
          id: extraSaleId,
          invoiceNo: `INV-${extraSaleId}`,
          amount: 950,
          attachments: [
            {
              id: `att-${extraSaleId}`,
              name: `${extraSaleId}.png`,
              type: 'IMAGE' as const,
              dataUrl: samplePngDataUrl,
              size: 68,
              uploadedAt: '2026-11-15T01:00:00.000Z',
              transactionId: extraSaleId,
              transactionType: 'SALE' as const,
            },
          ],
        },
      ]
    : [...initialSales];

  return {
    profile: { ...initialStoreProfile, storeName },
    customers: [...initialCustomers],
    customerTransactions: [...initialCustomerTransactions],
    suppliers: [...initialSuppliers],
    supplierTransactions: [...initialSupplierTransactions],
    sales,
    expenses: [...initialExpenses],
    cashbookEntries: [...initialCashbookEntries],
    products: [...initialProducts],
    stockAdjustments: [...initialStockAdjustments],
    auditLogs: [],
    billDocuments: extraSaleId
      ? [
          {
            id: `att-${extraSaleId}`,
            name: `${extraSaleId}.png`,
            type: 'IMAGE',
            dataUrl: samplePngDataUrl,
            size: 68,
            uploadedAt: '2026-11-15T01:00:00.000Z',
            transactionId: extraSaleId,
            transactionType: 'SALE',
          },
        ]
      : [],
    whatsappBatches: [],
    whatsappAuditLogs: [],
    recurringExpenses: [],
    dailySalesTarget: { amount: 5000, updatedAt: '2026-11-15T00:00:00.000Z' },
    lastClosedDate: '2026-11-14',
  };
}

function wrapDb(
  baseDb: LocalDbAdapter,
  overrides: Partial<LocalDbAdapter>
): LocalDbAdapter {
  return {
    isIndexedDB: baseDb.isIndexedDB,
    getAll: baseDb.getAll.bind(baseDb),
    getByKey: baseDb.getByKey.bind(baseDb),
    putOne: baseDb.putOne.bind(baseDb),
    deleteOne: baseDb.deleteOne.bind(baseDb),
    replaceStoreAtomic: baseDb.replaceStoreAtomic.bind(baseDb),
    commitBusinessDatasetAtomic: baseDb.commitBusinessDatasetAtomic.bind(baseDb),
    loadBusinessDataset: baseDb.loadBusinessDataset.bind(baseDb),
    getBillDocuments: baseDb.getBillDocuments.bind(baseDb),
    saveBillDocumentRecord: baseDb.saveBillDocumentRecord.bind(baseDb),
    deleteBillDocumentRecord: baseDb.deleteBillDocumentRecord.bind(baseDb),
    getMeta: baseDb.getMeta.bind(baseDb),
    setMeta: baseDb.setMeta.bind(baseDb),
    ...overrides,
  };
}

test('1. Successful backup restore verifies read-back counts, hydrates attachments, and preserves pre-restore snapshot', async () => {
  const db = createMemoryLocalDbAdapter();
  const currentDataset = makeDisposableDataset('Live Shop Before Restore');
  await db.commitBusinessDatasetAtomic(currentDataset);

  const backupDataset = makeDisposableDataset('Arjun Groceries Restored', 'sale-backup-99');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  const result = await restoreBackupSafelyWithRollback(
    db,
    currentDataset,
    envelope.jsonString
  );

  assert.equal(result.success, true);
  assert.equal(result.error, undefined);
  assert.equal(result.restoredDataset?.profile.storeName, 'Arjun Groceries Restored');
  assert.equal(result.restoredDataset?.sales.length, backupDataset.sales.length);
  assert.equal(result.restoredDataset?.billDocuments?.length, 1);
  assert.equal(result.verifiedCounts?.verified, true);
  assert.equal(result.verifiedCounts?.sales, backupDataset.sales.length);
  assert.equal(result.verifiedCounts?.billDocuments, 1);
  assert.equal(result.preRestoreSnapshotPreserved, true);
  assert.ok(result.rollbackCheckpointId);

  const persistedSnapshot = await db.getByKey<LocalBackupSnapshot>(
    STORE_NAMES.LOCAL_BACKUPS,
    result.rollbackCheckpointId!
  );
  assert.ok(persistedSnapshot);
  assert.equal(persistedSnapshot.trigger, 'PRE_RESTORE');
  assert.equal(persistedSnapshot.bucket, 'RECOVERY');
});

test('2. Failed restore with successful rollback restores prior data, verifies rollback, and preserves pre-restore snapshot', async () => {
  const db = createMemoryLocalDbAdapter();
  const currentDataset = makeDisposableDataset('Pre-Restore Live Shop');
  await db.commitBusinessDatasetAtomic(currentDataset);

  const backupDataset = makeDisposableDataset('Incoming Backup Shop', 'sale-incoming-1');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let commitCalls = 0;
  const failingFirstCommitDb = wrapDb(db, {
    async commitBusinessDatasetAtomic(dataset, extraMeta) {
      commitCalls++;
      if (commitCalls === 1) {
        throw new Error('Simulated IndexedDB write failure during restore');
      }
      return db.commitBusinessDatasetAtomic(dataset, extraMeta);
    },
  });

  const result = await restoreBackupSafelyWithRollback(
    failingFirstCommitDb,
    currentDataset,
    envelope.jsonString
  );

  assert.equal(result.success, false);
  assert.equal(result.restoredDataset, undefined);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(result.criticalRecoveryFailure, false);
  assert.equal(result.preRestoreSnapshotPreserved, true);
  assert.match(result.restoreError || '', /Simulated IndexedDB write failure during restore/);
  assert.equal(result.rollbackError, undefined);
  assert.match(result.error || '', /rolled back safely/i);
  assert.ok(result.rollbackCheckpointId);

  const loadedAfter = await db.loadBusinessDataset();
  assert.equal(loadedAfter.profile?.storeName, 'Pre-Restore Live Shop');
  assert.equal(loadedAfter.sales?.length, currentDataset.sales.length);

  const snap = await db.getByKey<LocalBackupSnapshot>(
    STORE_NAMES.LOCAL_BACKUPS,
    result.rollbackCheckpointId!
  );
  assert.ok(snap);
});

test('3a. Failed restore with failed rollback write never claims safe rollback, preserves both errors, and keeps pre-restore snapshot', async () => {
  const db = createMemoryLocalDbAdapter();
  const currentDataset = makeDisposableDataset('Pre-Restore Shop Double Fault');
  await db.commitBusinessDatasetAtomic(currentDataset);

  const backupDataset = makeDisposableDataset('Incoming Backup', 'sale-incoming-2');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let commitCalls = 0;
  const doubleFaultDb = wrapDb(db, {
    async commitBusinessDatasetAtomic() {
      commitCalls++;
      if (commitCalls === 1) {
        throw new Error('Primary restore transaction aborted');
      }
      throw new Error('Rollback transaction QuotaExceededError');
    },
  });

  let capturedCheckpointId = '';
  await assert.rejects(
    () => restoreBackupSafelyWithRollback(doubleFaultDb, currentDataset, envelope.jsonString),
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.code, 'CRITICAL_RECOVERY_FAILURE');
      assert.equal(err.preRestoreSnapshotPreserved, true);
      assert.match(err.restoreError, /Primary restore transaction aborted/);
      assert.match(err.rollbackError, /QuotaExceededError.*roll back to pre-restore shop data/i);
      assert.match(err.message, /CRITICAL RECOVERY FAILURE/i);
      assert.match(err.message, /Primary restore transaction aborted/);
      assert.match(err.message, /QuotaExceededError/i);
      assert.doesNotMatch(err.message, /rolled back safely/i);
      assert.ok(err.rollbackCheckpointId);
      assert.ok(err.message.includes(err.rollbackCheckpointId));
      capturedCheckpointId = err.rollbackCheckpointId;
      return true;
    }
  );

  const preservedSnapshot = await db.getByKey<LocalBackupSnapshot>(
    STORE_NAMES.LOCAL_BACKUPS,
    capturedCheckpointId
  );
  assert.ok(preservedSnapshot);
  assert.match(preservedSnapshot.payloadJson, /Pre-Restore Shop Double Fault/);
});

test('3b. Failed restore with failed post-rollback verification throws CriticalRestoreRollbackError and preserves both errors', async () => {
  const db = createMemoryLocalDbAdapter();
  const currentDataset = makeDisposableDataset('Pre-Restore Shop Readback Fail');
  await db.commitBusinessDatasetAtomic(currentDataset);

  const backupDataset = makeDisposableDataset('Incoming Backup', 'sale-incoming-3');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let loadCalls = 0;
  const corruptedRollbackReadbackDb = wrapDb(db, {
    async loadBusinessDataset() {
      loadCalls++;
      const real = await db.loadBusinessDataset();
      if (loadCalls === 1) {
        return { ...real, customers: [] }; // post-restore mismatch
      }
      return { ...real, profile: undefined }; // post-rollback missing profile
    },
  });

  let capturedCheckpointId = '';
  await assert.rejects(
    () =>
      restoreBackupSafelyWithRollback(
        corruptedRollbackReadbackDb,
        currentDataset,
        envelope.jsonString
      ),
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.code, 'CRITICAL_RECOVERY_FAILURE');
      assert.equal(err.preRestoreSnapshotPreserved, true);
      assert.match(err.restoreError, /Post-restore verification mismatch.*customers/i);
      assert.match(err.rollbackError, /Post-rollback verification failed: store profile is missing/i);
      assert.match(err.message, /CRITICAL RECOVERY FAILURE/i);
      assert.doesNotMatch(err.message, /rolled back safely/i);
      capturedCheckpointId = err.rollbackCheckpointId;
      return true;
    }
  );

  const preservedSnapshot = await db.getByKey<LocalBackupSnapshot>(
    STORE_NAMES.LOCAL_BACKUPS,
    capturedCheckpointId
  );
  assert.ok(preservedSnapshot);
});

test('4. Post-restore verification mismatch (counts and missing hydrated attachments) triggers verified rollback and rejects restore', async () => {
  const db = createMemoryLocalDbAdapter();
  const currentDataset = makeDisposableDataset('Shop Before Mismatch');
  await db.commitBusinessDatasetAtomic(currentDataset);

  const backupDataset = makeDisposableDataset('Target Backup With Attachment', 'sale-doc-77');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let loadCalls = 0;
  const strippedAttachmentDb = wrapDb(db, {
    async loadBusinessDataset() {
      loadCalls++;
      const real = await db.loadBusinessDataset();
      if (loadCalls === 1) {
        return {
          ...real,
          billDocuments: (real.billDocuments || []).map((d) => ({ ...d, dataUrl: '' })),
        };
      }
      return real;
    },
  });

  const result = await restoreBackupSafelyWithRollback(
    strippedAttachmentDb,
    currentDataset,
    envelope.jsonString
  );

  assert.equal(result.success, false);
  assert.equal(result.restoredDataset, undefined);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(result.criticalRecoveryFailure, false);
  assert.match(result.restoreError || '', /hydrated bill documents/i);
  assert.match(result.error || '', /rolled back safely/i);

  const actualState = await db.loadBusinessDataset();
  assert.equal(actualState.profile?.storeName, 'Shop Before Mismatch');
  assert.equal(actualState.sales?.length, currentDataset.sales.length);
});

test('5 & 6. Pre-restore snapshot preservation across multiple recovery backups and accurate error reporting for snapshot/validation failures', async () => {
  const db = createMemoryLocalDbAdapter();
  const currentDataset = makeDisposableDataset('Live Kirana Store');
  await db.commitBusinessDatasetAtomic(currentDataset);

  // Seed an existing recovery snapshot before attempting restore
  const olderSnapshot: LocalBackupSnapshot = {
    id: 'bak-pre_restore-older-1',
    createdAt: '2026-11-10T08:00:00.000Z',
    dateKey: '2026-11-10',
    weekKey: '2026-W46',
    trigger: 'PRE_RESTORE',
    bucket: 'RECOVERY',
    reason: 'Earlier recovery snapshot',
    schemaVersion: '2.2.0',
    checksum: 'older-checksum',
    sizeBytes: 512,
    status: 'SUCCESS',
    summary: {
      totalTransactions: 1,
      salesCount: 1,
      salesTotalVolume: 100,
      customerTransactionsCount: 0,
      supplierTransactionsCount: 0,
      expenseCount: 0,
      expenseTotalVolume: 0,
      cashbookCount: 0,
      customersCount: 1,
      suppliersCount: 0,
      productsCount: 1,
    },
    payloadJson: '{}',
  };
  await db.putOne(STORE_NAMES.LOCAL_BACKUPS, olderSnapshot);

  // A) Invalid/tampered JSON reports validation error without touching DB or creating snapshot
  const invalidRes = await restoreBackupSafelyWithRollback(
    db,
    currentDataset,
    '{"invalid":true}'
  );
  assert.equal(invalidRes.success, false);
  assert.equal(invalidRes.restoredDataset, undefined);
  assert.match(invalidRes.error || '', /store profile/i);

  // B) Snapshot creation failure aborts before touching business dataset
  const validEnvelope = await buildVerifiedBackupEnvelope(
    makeDisposableDataset('Target Store', 'sale-valid-1')
  );
  const failingSnapshotDb = wrapDb(db, {
    async putOne(storeName, record) {
      if (storeName === STORE_NAMES.LOCAL_BACKUPS) {
        throw new Error('Snapshot storage write failed');
      }
      return db.putOne(storeName, record);
    },
  });
  const snapFailRes = await restoreBackupSafelyWithRollback(
    failingSnapshotDb,
    currentDataset,
    validEnvelope.jsonString
  );
  assert.equal(snapFailRes.success, false);
  assert.equal(snapFailRes.restoredDataset, undefined);
  assert.equal(snapFailRes.preRestoreSnapshotPreserved, false);
  assert.match(snapFailRes.error || '', /Snapshot storage write failed/);
  assert.match(snapFailRes.error || '', /Existing shop data was not modified/i);

  // Live shop data remains untouched
  const intact = await db.loadBusinessDataset();
  assert.equal(intact.profile?.storeName, 'Live Kirana Store');

  // C) Double-fault restore still preserves BOTH older recovery snapshot and new PRE_RESTORE snapshot
  let commitCalls = 0;
  const doubleFaultDb = wrapDb(db, {
    async commitBusinessDatasetAtomic() {
      commitCalls++;
      if (commitCalls === 1) throw new Error('Restore commit error');
      throw new Error('Rollback commit error');
    },
  });
  let doubleFaultCheckpointId = '';
  await assert.rejects(
    () =>
      restoreBackupSafelyWithRollback(
        doubleFaultDb,
        currentDataset,
        validEnvelope.jsonString
      ),
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.preRestoreSnapshotPreserved, true);
      doubleFaultCheckpointId = err.rollbackCheckpointId;
      return true;
    }
  );

  const backups = await listLocalBackups(db);
  assert.ok(backups.some((b) => b.id === 'bak-pre_restore-older-1'));
  assert.ok(backups.some((b) => b.id === doubleFaultCheckpointId));
});
