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
} from '../utils/initialData';
import { LocalBackupSnapshot, StoreBusinessDataset } from '../types';
import {
  buildVerifiedBackupEnvelope,
  CriticalRestoreRollbackError,
  restoreBackupSafelyWithRollback,
} from '../utils/localBackupManager';
import {
  createMemoryLocalDbAdapter,
  LocalDbAdapter,
  STORE_NAMES,
} from '../utils/localDatabase';

function makeDisposableShopDataset(storeName: string, extraSaleId?: string): StoreBusinessDataset {
  const sales = extraSaleId
    ? [
        ...initialSales,
        {
          ...initialSales[0],
          id: extraSaleId,
          invoiceNo: `BILL-${extraSaleId}`,
          amount: 720,
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
    billDocuments: [],
    whatsappBatches: [],
    whatsappAuditLogs: [],
    recurringExpenses: [],
    dailySalesTarget: { amount: 4500, updatedAt: '2026-11-15T00:00:00.000Z' },
    lastClosedDate: '2026-11-14',
  };
}

function wrapDbAdapter(
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

test('Catastrophic double-fault: failed restore followed by failed rollback write throws CriticalRestoreRollbackError instead of false success', async () => {
  const db = createMemoryLocalDbAdapter();
  const liveDataset = makeDisposableShopDataset('Arjun Groceries Live');
  await db.commitBusinessDatasetAtomic(liveDataset);

  const backupDataset = makeDisposableShopDataset('Arjun Groceries Archive', 'sale-double-fault-1');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let commitAttempt = 0;
  const catastrophicDb = wrapDbAdapter(db, {
    async commitBusinessDatasetAtomic() {
      commitAttempt++;
      if (commitAttempt === 1) {
        throw new Error('Restore commit aborted on disk write');
      }
      throw new Error('Rollback commit aborted on disk write');
    },
  });

  let thrownError: unknown = null;
  await assert.rejects(
    async () => {
      try {
        return await restoreBackupSafelyWithRollback(
          catastrophicDb,
          liveDataset,
          envelope.jsonString
        );
      } catch (err) {
        thrownError = err;
        throw err;
      }
    },
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.name, 'CriticalRestoreRollbackError');
      assert.equal(err.code, 'CRITICAL_RECOVERY_FAILURE');
      assert.match(err.restoreError, /Restore commit aborted on disk write/);
      assert.match(err.rollbackError, /Rollback commit aborted on disk write/);
      assert.match(err.message, /CRITICAL RECOVERY FAILURE/i);
      assert.doesNotMatch(err.message, /rolled back safely/i);
      assert.doesNotMatch(err.message, /restored safely/i);
      assert.equal(err.preRestoreSnapshotPreserved, true);
      assert.ok(err.rollbackCheckpointId);
      return true;
    }
  );

  const criticalErr = thrownError as CriticalRestoreRollbackError;
  const persistedSnapshot = await db.getByKey<LocalBackupSnapshot>(
    STORE_NAMES.LOCAL_BACKUPS,
    criticalErr.rollbackCheckpointId
  );
  assert.ok(persistedSnapshot, 'Pre-restore snapshot must survive catastrophic failure');
  assert.match(persistedSnapshot.payloadJson, /Arjun Groceries Live/);
});

test('Catastrophic double-fault: failed post-restore verification followed by failed post-rollback verification throws CriticalRestoreRollbackError', async () => {
  const db = createMemoryLocalDbAdapter();
  const liveDataset = makeDisposableShopDataset('Arjun Groceries Live');
  await db.commitBusinessDatasetAtomic(liveDataset);

  const backupDataset = makeDisposableShopDataset('Arjun Groceries Archive', 'sale-double-fault-2');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let readBackAttempt = 0;
  const brokenReadBackDb = wrapDbAdapter(db, {
    async loadBusinessDataset() {
      readBackAttempt++;
      const real = await db.loadBusinessDataset();
      if (readBackAttempt === 1) {
        return { ...real, sales: [] };
      }
      return { ...real, customers: [] };
    },
  });

  await assert.rejects(
    () =>
      restoreBackupSafelyWithRollback(
        brokenReadBackDb,
        liveDataset,
        envelope.jsonString
      ),
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.code, 'CRITICAL_RECOVERY_FAILURE');
      assert.match(err.restoreError, /Post-restore verification mismatch.*sales/i);
      assert.match(err.rollbackError, /Post-rollback verification mismatch.*customers/i);
      assert.doesNotMatch(err.message, /rolled back safely/i);
      return true;
    }
  );
});

test('Failed restore with verified successful rollback does not throw and reports failure with safe rollback', async () => {
  const db = createMemoryLocalDbAdapter();
  const liveDataset = makeDisposableShopDataset('Arjun Groceries Live');
  await db.commitBusinessDatasetAtomic(liveDataset);

  const backupDataset = makeDisposableShopDataset('Arjun Groceries Archive', 'sale-safe-rollback-1');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let commitAttempt = 0;
  const transientFailDb = wrapDbAdapter(db, {
    async commitBusinessDatasetAtomic(dataset, extraMeta) {
      commitAttempt++;
      if (commitAttempt === 1) {
        throw new Error('Transient restore write interruption');
      }
      return db.commitBusinessDatasetAtomic(dataset, extraMeta);
    },
  });

  const result = await restoreBackupSafelyWithRollback(
    transientFailDb,
    liveDataset,
    envelope.jsonString
  );

  assert.equal(result.success, false);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(result.criticalRecoveryFailure, false);
  assert.equal(result.restoredDataset, undefined);
  assert.match(result.error || '', /rolled back safely/i);
});

test('Catastrophic double-fault: post-restore verification failure followed by QuotaExceededError on rollback throws CriticalRestoreRollbackError', async () => {
  const db = createMemoryLocalDbAdapter();
  const liveDataset = makeDisposableShopDataset('Arjun Groceries Live');
  await db.commitBusinessDatasetAtomic(liveDataset);

  const backupDataset = makeDisposableShopDataset('Arjun Groceries Archive', 'sale-double-fault-3');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let commitAttempt = 0;
  const corruptedThenQuotaDb = wrapDbAdapter(db, {
    async commitBusinessDatasetAtomic(dataset, extraMeta) {
      commitAttempt++;
      if (commitAttempt === 1) {
        // Persist corrupted subset (missing expenses) so post-restore verification triggers rollback
        return db.commitBusinessDatasetAtomic({ ...dataset, expenses: [] }, extraMeta);
      }
      const quotaErr = new Error('Simulated storage quota exceeded');
      quotaErr.name = 'QuotaExceededError';
      throw quotaErr;
    },
  });

  await assert.rejects(
    () =>
      restoreBackupSafelyWithRollback(
        corruptedThenQuotaDb,
        liveDataset,
        envelope.jsonString
      ),
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.code, 'CRITICAL_RECOVERY_FAILURE');
      assert.match(err.restoreError, /Post-restore verification mismatch.*expenses/i);
      assert.match(err.rollbackError, /QuotaExceededError.*roll back to pre-restore shop data/i);
      assert.match(err.message, /CRITICAL RECOVERY FAILURE/i);
      assert.doesNotMatch(err.message, /rolled back safely/i);
      assert.equal(err.preRestoreSnapshotPreserved, true);
      return true;
    }
  );
});

test('Strict ID-level verification: equal record counts with swapped/missing IDs fail both restore and rollback and throw CriticalRestoreRollbackError', async () => {
  const db = createMemoryLocalDbAdapter();
  const liveDataset = makeDisposableShopDataset('Arjun Groceries Live');
  await db.commitBusinessDatasetAtomic(liveDataset);

  const backupDataset = makeDisposableShopDataset('Arjun Groceries Archive', 'sale-id-parity-1');
  const envelope = await buildVerifiedBackupEnvelope(backupDataset);

  let loadAttempt = 0;
  const corruptedIdReadBackDb = wrapDbAdapter(db, {
    async loadBusinessDataset() {
      loadAttempt++;
      const real = await db.loadBusinessDataset();
      const sales = real.sales || [];
      if (loadAttempt === 1 && sales.length > 0) {
        // Keep exact same sales count, but swap one sale ID to simulate silent ID corruption
        return {
          ...real,
          sales: [{ ...sales[0], id: 'corrupted-sale-id-restore' }, ...sales.slice(1)],
        };
      }
      const customers = real.customers || [];
      if (customers.length > 0) {
        // Keep exact same customers count, but swap one customer ID on rollback read-back
        return {
          ...real,
          customers: [{ ...customers[0], id: 'corrupted-customer-id-rollback' }, ...customers.slice(1)],
        };
      }
      return real;
    },
  });

  await assert.rejects(
    () =>
      restoreBackupSafelyWithRollback(
        corruptedIdReadBackDb,
        liveDataset,
        envelope.jsonString
      ),
    (err: unknown) => {
      assert.ok(err instanceof CriticalRestoreRollbackError);
      assert.equal(err.code, 'CRITICAL_RECOVERY_FAILURE');
      assert.match(err.restoreError, /Post-restore verification mismatch.*sales missing expected record IDs/i);
      assert.match(err.rollbackError, /Post-rollback verification mismatch.*customers missing expected record IDs/i);
      assert.doesNotMatch(err.message, /rolled back safely/i);
      assert.equal(err.preRestoreSnapshotPreserved, true);
      return true;
    }
  );
});
