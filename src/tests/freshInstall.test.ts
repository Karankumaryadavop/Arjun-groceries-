/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryLocalDbAdapter,
  LEGACY_STORAGE_KEYS,
  listLocalBackups,
  LocalDbAdapter,
  migrateLegacyLocalStorageToLocalDb,
} from '../utils/localDatabase';
import {
  analyzeDemoVsRealDataset,
  createEmptyBusinessDataset,
  createEmptyStoreProfile,
  removeDemoRecordsOnly,
  shouldRequireFirstTimeSetup,
} from '../utils/freshInstall';
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
} from '../utils/initialData';
import { StoreBusinessDataset } from '../types';

function makeDemoDataset(): StoreBusinessDataset {
  return {
    profile: { ...initialStoreProfile },
    customers: initialCustomers.map((c) => ({ ...c })),
    customerTransactions: initialCustomerTransactions.map((t) => ({ ...t })),
    suppliers: initialSuppliers.map((s) => ({ ...s })),
    supplierTransactions: initialSupplierTransactions.map((t) => ({ ...t })),
    sales: initialSales.map((s) => ({ ...s })),
    expenses: initialExpenses.map((e) => ({ ...e })),
    cashbookEntries: initialCashbookEntries.map((c) => ({ ...c })),
    products: initialProducts.map((p) => ({ ...p })),
    stockAdjustments: initialStockAdjustments.map((a) => ({ ...a })),
    auditLogs: initialAuditLogs.map((l) => ({ ...l })),
    whatsappBatches: [],
    whatsappAuditLogs: [],
    billDocuments: [],
    recurringExpenses: [],
    dailySalesTarget: null,
    lastClosedDate: null,
  };
}

test('Phase 3 (1): Fresh installation starts completely empty with zero demo records or fake profile fields', async () => {
  const db = createMemoryLocalDbAdapter();

  const { dataset, report } = await migrateLegacyLocalStorageToLocalDb(
    db,
    undefined,
    null
  );

  assert.equal(report.source, 'fresh_install');
  assert.equal(report.migrated, true);
  assert.equal(report.alreadyMigrated, false);

  assert.equal(dataset.customers.length, 0);
  assert.equal(dataset.customerTransactions.length, 0);
  assert.equal(dataset.suppliers.length, 0);
  assert.equal(dataset.supplierTransactions.length, 0);
  assert.equal(dataset.products.length, 0);
  assert.equal(dataset.sales.length, 0);
  assert.equal(dataset.expenses.length, 0);
  assert.equal(dataset.cashbookEntries.length, 0);
  assert.equal(dataset.stockAdjustments.length, 0);
  assert.equal(dataset.auditLogs.length, 0);
  assert.equal(dataset.billDocuments?.length || 0, 0);

  // No fake owner, phone, UPI, GSTIN, or address
  assert.equal(dataset.profile.storeName, '');
  assert.equal(dataset.profile.ownerName, '');
  assert.equal(dataset.profile.phone, '');
  assert.equal(dataset.profile.upiId, '');
  assert.equal(dataset.profile.address, '');
  assert.equal(dataset.profile.gstin, undefined);

  const initFlag = await db.getMeta<boolean>('installInitialized');
  const setupDoneFlag = await db.getMeta<boolean>('firstTimeSetupCompleted');
  assert.equal(initFlag, true);
  assert.equal(setupDoneFlag, false);

  assert.equal(
    shouldRequireFirstTimeSetup({
      firstTimeSetupCompleted: setupDoneFlag,
      dataset,
    }),
    true
  );
});

test('Phase 3 (2): Existing installation retains 100% of records and never injects demo data into empty collections', async () => {
  const db = createMemoryLocalDbAdapter();

  // Existing real shop that has suppliers + expenses + profile, while customers and products are legitimately empty []
  const realShop: StoreBusinessDataset = {
    ...createEmptyBusinessDataset(),
    profile: {
      ...createEmptyStoreProfile(),
      storeName: 'Shree Laxmi Kirana',
      ownerName: 'Mahesh Kadam',
      phone: '9890011223',
      upiId: 'laxmikirana@okicici',
      address: 'Main Road, Pune',
    },
    suppliers: [
      {
        id: 'sup-real-1',
        name: 'Pune Grain Depot',
        phone: '9823000111',
        openingBalance: 1000,
        currentBalance: 1000,
        totalPurchases: 0,
        totalPaid: 0,
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    ],
    expenses: [
      {
        id: 'exp-real-1',
        title: 'Shop Rent',
        category: 'SHOP',
        amount: 5000,
        isPersonalWithdrawal: false,
        paymentMethod: 'BANK',
        date: '2026-11-05',
        createdAt: '2026-11-05T09:00:00.000Z',
      },
    ],
  };

  await db.commitBusinessDatasetAtomic(realShop, [
    { key: 'schemaVersion', value: '4.0.0-local-v2', updatedAt: '2026-11-05T09:00:00.000Z' },
  ]);

  const { dataset } = await migrateLegacyLocalStorageToLocalDb(db, makeDemoDataset(), null);

  // Must preserve existing records and keep empty collections strictly empty (never inject demo customers/products)
  assert.equal(dataset.profile.storeName, 'Shree Laxmi Kirana');
  assert.equal(dataset.suppliers.length, 1);
  assert.equal(dataset.suppliers[0].id, 'sup-real-1');
  assert.equal(dataset.expenses.length, 1);
  assert.equal(dataset.customers.length, 0);
  assert.equal(dataset.products.length, 0);
  assert.equal(dataset.sales.length, 0);

  // Existing installation must NEVER be forced through first-time setup screen
  assert.equal(
    shouldRequireFirstTimeSetup({
      firstTimeSetupCompleted: null,
      dataset,
    }),
    false
  );
});

test('Phase 3 (3): Repeated app restarts are idempotent and do not duplicate records or trigger redundant upgrades', async () => {
  const db = createMemoryLocalDbAdapter();

  const boot1 = await migrateLegacyLocalStorageToLocalDb(db, undefined, null);
  assert.equal(boot1.report.source, 'fresh_install');
  assert.equal(boot1.report.alreadyMigrated, false);

  // User saves real shop profile and adds 1 real product
  const populated: StoreBusinessDataset = {
    ...boot1.dataset,
    profile: {
      ...boot1.dataset.profile,
      storeName: 'Narmada Super Market',
      ownerName: 'Suresh Jain',
      phone: '9826012345',
    },
    products: [
      {
        id: 'prod-real-1',
        name: 'Toor Dal Premium',
        category: 'Pulses & Dals',
        purchasePrice: 130,
        sellingPrice: 155,
        stockQty: 25,
        unit: 'kg',
        minStockAlert: 5,
        updatedAt: '2026-11-10T10:00:00.000Z',
      },
    ],
  };
  await db.commitBusinessDatasetAtomic(populated, [
    { key: 'firstTimeSetupCompleted', value: true, updatedAt: '2026-11-10T10:00:00.000Z' },
  ]);

  // Simulate 2 subsequent app restarts (no PIN configured)
  const boot2 = await migrateLegacyLocalStorageToLocalDb(db, undefined, null);
  const boot3 = await migrateLegacyLocalStorageToLocalDb(db, undefined, null);

  assert.equal(boot2.report.alreadyMigrated, true);
  assert.equal(boot2.report.source, 'existing_idb');
  assert.equal(boot3.report.alreadyMigrated, true);
  assert.equal(boot3.report.source, 'existing_idb');

  assert.equal(boot3.dataset.products.length, 1);
  assert.equal(boot3.dataset.products[0].id, 'prod-real-1');
  assert.equal(boot3.dataset.customers.length, 0);

  // Confirm no spurious PRE_MIGRATION snapshots were generated across v2 restarts
  const backups = await listLocalBackups(db);
  assert.equal(
    backups.filter((b) => b.trigger === 'PRE_MIGRATION').length,
    0
  );
});

test('Phase 3 (4): Existing shop profile is preserved accurately across boots and v1->v2 upgrades', async () => {
  const db = createMemoryLocalDbAdapter();

  const customProfile = {
    id: 'store-1',
    storeName: 'Annapurna Kirana Mart',
    ownerName: 'Kishore Tiwari',
    phone: '9425011122',
    upiId: 'annapurna@ybl',
    address: 'Gandhi Chowk, Bhopal',
    gstin: '23ABCDE1234F1Z5',
    currencySymbol: '₹',
    isPinEnabled: false,
  };

  await db.commitBusinessDatasetAtomic({
    ...createEmptyBusinessDataset(),
    profile: customProfile,
    customers: [
      {
        id: 'cust-real-1',
        name: 'Deepak Sharma',
        phone: '9988776655',
        openingBalance: 0,
        currentBalance: 300,
        totalCreditGiven: 300,
        totalPaymentReceived: 0,
        overdueDays: 1,
        category: 'REGULAR',
        createdAt: '2026-11-01',
      },
    ],
  });

  // No schemaVersion meta yet -> triggers v1_upgrade path
  const upgraded = await migrateLegacyLocalStorageToLocalDb(db, makeDemoDataset(), null);
  assert.equal(upgraded.report.source, 'v1_upgrade');
  assert.equal(upgraded.dataset.profile.storeName, 'Annapurna Kirana Mart');
  assert.equal(upgraded.dataset.profile.ownerName, 'Kishore Tiwari');
  assert.equal(upgraded.dataset.profile.phone, '9425011122');
  assert.equal(upgraded.dataset.profile.upiId, 'annapurna@ybl');
  assert.equal(upgraded.dataset.profile.gstin, '23ABCDE1234F1Z5');
  assert.equal(upgraded.dataset.customers.length, 1);
  assert.equal(upgraded.dataset.products.length, 0);
});

test('Phase 3 (5): Failed or partial initialization throws cleanly and does not corrupt pre-existing DB data', async () => {
  const baseDb = createMemoryLocalDbAdapter();

  const existingShop: StoreBusinessDataset = {
    ...createEmptyBusinessDataset(),
    profile: {
      ...createEmptyStoreProfile(),
      storeName: 'Protected Real Shop',
      ownerName: 'Vikram Singh',
    },
    customers: [
      {
        id: 'cust-real-safe',
        name: 'Harish Verma',
        phone: '9812345678',
        openingBalance: 500,
        currentBalance: 500,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: '2026-11-01',
      },
    ],
  };
  await baseDb.commitBusinessDatasetAtomic(existingShop);

  // Wrap DB to fail atomic commit during v1->v2 upgrade
  const failingDb: LocalDbAdapter = {
    ...baseDb,
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
      throw new Error('Simulated IndexedDB transaction abort during initialization');
    },
  };

  await assert.rejects(
    () => migrateLegacyLocalStorageToLocalDb(failingDb, undefined, null),
    /Simulated IndexedDB transaction abort/
  );

  // Pre-existing DB records must remain 100% intact after failed init
  const survived = await baseDb.loadBusinessDataset();
  assert.equal(survived.profile?.storeName, 'Protected Real Shop');
  assert.equal(survived.customers?.length, 1);
  assert.equal(survived.customers?.[0].id, 'cust-real-safe');

  // Fresh install with partial commit (missing meta verification) also fails loudly
  const freshBase = createMemoryLocalDbAdapter();
  const partialCommitDb: LocalDbAdapter = {
    ...freshBase,
    isIndexedDB: freshBase.isIndexedDB,
    getAll: freshBase.getAll.bind(freshBase),
    getByKey: freshBase.getByKey.bind(freshBase),
    putOne: freshBase.putOne.bind(freshBase),
    deleteOne: freshBase.deleteOne.bind(freshBase),
    replaceStoreAtomic: freshBase.replaceStoreAtomic.bind(freshBase),
    loadBusinessDataset: freshBase.loadBusinessDataset.bind(freshBase),
    getBillDocuments: freshBase.getBillDocuments.bind(freshBase),
    saveBillDocumentRecord: freshBase.saveBillDocumentRecord.bind(freshBase),
    deleteBillDocumentRecord: freshBase.deleteBillDocumentRecord.bind(freshBase),
    getMeta: async () => null,
    setMeta: freshBase.setMeta.bind(freshBase),
    commitBusinessDatasetAtomic: freshBase.commitBusinessDatasetAtomic.bind(freshBase),
  };

  await assert.rejects(
    () => migrateLegacyLocalStorageToLocalDb(partialCommitDb, undefined, null),
    /verification failed/i
  );
});

test('Phase 3 (6): Demo data is never mixed during localStorage migration, and manual demo-only cleanup preserves real & referenced records', async () => {
  // 6a: Legacy localStorage migration with only customers + profile must NOT inject demo products or demo expenses
  const legacyMap = new Map<string, string>();
  legacyMap.set(
    LEGACY_STORAGE_KEYS.PROFILE,
    JSON.stringify({ ...createEmptyStoreProfile(), storeName: 'Ganpati Kirana' })
  );
  legacyMap.set(
    LEGACY_STORAGE_KEYS.CUSTOMERS,
    JSON.stringify([
      {
        id: 'cust-ls-1',
        name: 'Mohan Lal',
        phone: '9827000011',
        openingBalance: 250,
        currentBalance: 250,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: '2026-10-15',
      },
    ])
  );
  const mockStorage = {
    getItem: (k: string) => legacyMap.get(k) ?? null,
  };

  const db = createMemoryLocalDbAdapter();
  const migrated = await migrateLegacyLocalStorageToLocalDb(db, makeDemoDataset(), mockStorage);
  assert.equal(migrated.report.source, 'localStorage');
  assert.equal(migrated.dataset.profile.storeName, 'Ganpati Kirana');
  assert.equal(migrated.dataset.customers.length, 1);
  assert.equal(migrated.dataset.products.length, 0);
  assert.equal(migrated.dataset.expenses.length, 0);
  assert.equal(migrated.dataset.sales.length, 0);

  // 6b: Mixed pre-existing demo + real dataset analysis & manual demo-only cleanup
  const mixedDataset: StoreBusinessDataset = {
    ...makeDemoDataset(),
    profile: {
      ...initialStoreProfile,
      storeName: 'My Real Store Name',
    },
    customers: [
      ...initialCustomers,
      {
        id: 'cust-real-only',
        name: 'Real Customer Anita',
        phone: '9911223344',
        openingBalance: 0,
        currentBalance: 750,
        totalCreditGiven: 750,
        totalPaymentReceived: 0,
        overdueDays: 2,
        category: 'REGULAR',
        createdAt: '2026-11-12',
      },
    ],
    customerTransactions: [
      ...initialCustomerTransactions,
      // Real transaction referencing a real customer
      {
        id: 'ctx-real-1',
        customerId: 'cust-real-only',
        type: 'CREDIT',
        amount: 750,
        date: '2026-11-12T10:00:00.000Z',
        description: 'Real ration order',
        createdAt: '2026-11-12T10:00:00.000Z',
      },
      // Real transaction referencing pre-existing demo customer 'cust-1' -> cust-1 must NOT be deleted!
      {
        id: 'ctx-real-2',
        customerId: 'cust-1',
        type: 'PAYMENT',
        amount: 500,
        date: '2026-11-13T10:00:00.000Z',
        description: 'Real cash payment recorded by shopkeeper',
        paymentMethod: 'CASH',
        createdAt: '2026-11-13T10:00:00.000Z',
      },
    ],
  };

  const analysis = analyzeDemoVsRealDataset(mixedDataset);
  assert.equal(analysis.hasMixedData, true);
  assert.equal(analysis.hasDemoRecords, true);
  assert.equal(analysis.hasRealRecords, true);
  assert.ok(analysis.referencedDemoCustomerIds.includes('cust-1'));

  const cleaned = removeDemoRecordsOnly(mixedDataset);
  assert.ok(cleaned.removedCount > 0);
  // Real store name preserved, fake demo owner/phone/UPI/GSTIN cleared
  assert.equal(cleaned.cleanedDataset.profile.storeName, 'My Real Store Name');
  assert.equal(cleaned.cleanedDataset.profile.ownerName, '');
  assert.equal(cleaned.cleanedDataset.profile.upiId, '');
  assert.equal(cleaned.cleanedDataset.profile.gstin, undefined);

  // Real customer + referenced demo customer survived; unreferenced demo customers & demo sales removed
  assert.ok(cleaned.cleanedDataset.customers.some((c) => c.id === 'cust-real-only'));
  assert.ok(cleaned.cleanedDataset.customers.some((c) => c.id === 'cust-1'));
  assert.ok(!cleaned.cleanedDataset.customers.some((c) => c.id === 'cust-2'));
  assert.equal(cleaned.cleanedDataset.sales.length, 0);
  assert.equal(cleaned.cleanedDataset.products.length, 0);
  assert.ok(cleaned.cleanedDataset.customerTransactions.some((t) => t.id === 'ctx-real-1'));
  assert.ok(cleaned.cleanedDataset.customerTransactions.some((t) => t.id === 'ctx-real-2'));
});
