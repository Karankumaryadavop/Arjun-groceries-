import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBackupData,
  serializeBackupJSON,
  validateAndParseBackupJSON,
} from './backup.ts';
import {
  initialStoreProfile,
  initialCustomers,
  initialCustomerTransactions,
  initialSuppliers,
  initialSupplierTransactions,
  initialSales,
  initialExpenses,
  initialCashbookEntries,
  initialProducts,
  initialAuditLogs,
} from './initialData.ts';

test('generateBackupData accurately aggregates transaction counts, schema version and opening balances', () => {
  const backup = generateBackupData({
    profile: initialStoreProfile,
    customers: initialCustomers,
    customerTransactions: initialCustomerTransactions,
    suppliers: initialSuppliers,
    supplierTransactions: initialSupplierTransactions,
    sales: initialSales,
    expenses: initialExpenses,
    cashbookEntries: initialCashbookEntries,
    products: initialProducts,
    auditLogs: initialAuditLogs,
  });

  assert.equal(backup.appName, 'Arjun Groceries');
  assert.equal(backup.version, '2.2');
  assert.equal(backup.schemaVersion, '2.2.0');
  assert.ok(backup.backupDate && typeof backup.backupDate === 'string');
  assert.equal(backup.storeProfile.storeName, initialStoreProfile.storeName);

  // Check counts
  const expectedTotalTransactions =
    initialSales.length +
    initialCustomerTransactions.length +
    initialSupplierTransactions.length +
    initialExpenses.length +
    initialCashbookEntries.length;

  assert.equal(backup.summary.totalTransactions, expectedTotalTransactions);
  assert.equal(backup.summary.salesCount, initialSales.length);
  assert.equal(backup.summary.customerTransactionsCount, initialCustomerTransactions.length);
  assert.equal(backup.summary.supplierTransactionsCount, initialSupplierTransactions.length);
  assert.equal(backup.summary.expenseCount, initialExpenses.length);
  assert.equal(backup.summary.cashbookCount, initialCashbookEntries.length);
  assert.equal(backup.summary.customersCount, initialCustomers.length);
  assert.equal(backup.summary.suppliersCount, initialSuppliers.length);
  assert.equal(backup.summary.productsCount, initialProducts.length);

  // Verify opening balances
  assert.ok(backup.summary.openingBalances);
  const expectedCustomerOpening = initialCustomers.reduce((acc, c) => acc + (c.openingBalance || 0), 0);
  const expectedSupplierOpening = initialSuppliers.reduce((acc, s) => acc + (s.openingBalance || 0), 0);
  assert.equal(backup.summary.openingBalances.totalCustomerOpening, expectedCustomerOpening);
  assert.equal(backup.summary.openingBalances.totalSupplierOpening, expectedSupplierOpening);
  assert.equal(backup.summary.openingBalances.cashOpeningBalance, 14500);

  // Verify transactions array lengths inside backup
  assert.equal(backup.transactions.sales.length, initialSales.length);
  assert.equal(backup.transactions.customerTransactions.length, initialCustomerTransactions.length);
  assert.equal(backup.transactions.supplierTransactions.length, initialSupplierTransactions.length);
  assert.equal(backup.transactions.expenses.length, initialExpenses.length);
  assert.equal(backup.transactions.cashbookEntries.length, initialCashbookEntries.length);
});

test('serializeBackupJSON outputs valid parseable JSON with indentation', () => {
  const backup = generateBackupData({
    profile: initialStoreProfile,
    customers: initialCustomers,
    customerTransactions: initialCustomerTransactions,
    suppliers: initialSuppliers,
    supplierTransactions: initialSupplierTransactions,
    sales: initialSales,
    expenses: initialExpenses,
    cashbookEntries: initialCashbookEntries,
    products: initialProducts,
    auditLogs: initialAuditLogs,
  });

  const jsonStr = serializeBackupJSON(backup, true);
  assert.ok(typeof jsonStr === 'string' && jsonStr.length > 500);

  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.appName, 'Arjun Groceries');
  assert.equal(parsed.version, '2.2');
  assert.equal(parsed.schemaVersion, '2.2.0');
  assert.equal(parsed.transactions.sales.length, initialSales.length);
});

test('validateAndParseBackupJSON parses v2.2, v2.1, and legacy schemas correctly', () => {
  const v2Backup = generateBackupData({
    profile: initialStoreProfile,
    customers: initialCustomers,
    customerTransactions: initialCustomerTransactions,
    suppliers: initialSuppliers,
    supplierTransactions: initialSupplierTransactions,
    sales: initialSales,
    expenses: initialExpenses,
    cashbookEntries: initialCashbookEntries,
    products: initialProducts,
    auditLogs: initialAuditLogs,
  });

  const v2Json = serializeBackupJSON(v2Backup);
  const resultV2 = validateAndParseBackupJSON(v2Json);
  assert.equal(resultV2.valid, true);
  assert.equal(resultV2.metadata?.appName, 'Arjun Groceries');
  assert.equal(resultV2.metadata?.version, '2.2');
  assert.equal(resultV2.metadata?.schemaVersion, '2.2.0');
  assert.equal(resultV2.metadata?.storeName, initialStoreProfile.storeName);
  assert.equal(resultV2.data?.sales.length, initialSales.length);
  assert.equal(resultV2.data?.profile.storeName, initialStoreProfile.storeName);
  assert.equal(resultV2.summary?.totalTransactions, v2Backup.summary.totalTransactions);

  // Legacy v1 schema (flat top-level keys without transactions wrapper & legacy appName)
  const v1Json = JSON.stringify({
    appName: 'SmartKirana Pro',
    version: '1.0',
    exportedAt: '2026-10-01T12:00:00Z',
    profile: initialStoreProfile,
    customers: initialCustomers,
    customerTransactions: initialCustomerTransactions,
    suppliers: initialSuppliers,
    supplierTransactions: initialSupplierTransactions,
    sales: initialSales,
    expenses: initialExpenses,
    cashbookEntries: initialCashbookEntries,
    products: initialProducts,
    auditLogs: initialAuditLogs,
  });

  const resultV1 = validateAndParseBackupJSON(v1Json);
  assert.equal(resultV1.valid, true);
  assert.equal(resultV1.metadata?.appName, 'SmartKirana Pro');
  assert.equal(resultV1.data?.sales.length, initialSales.length);
  assert.equal(resultV1.data?.customers.length, initialCustomers.length);
  assert.equal(resultV1.metadata?.storeName, initialStoreProfile.storeName);
});

test('validateAndParseBackupJSON safely rejects corrupted or empty inputs and non-array collections', () => {
  assert.equal(validateAndParseBackupJSON('').valid, false);
  assert.equal(validateAndParseBackupJSON('   ').valid, false);
  assert.equal(validateAndParseBackupJSON('not a json').valid, false);
  assert.equal(validateAndParseBackupJSON('[]').valid, false);
  assert.equal(validateAndParseBackupJSON('{"someKey": 123}').valid, false); // missing profile
  assert.equal(
    validateAndParseBackupJSON('{"storeProfile": {"storeName": ""}}').valid,
    false
  ); // invalid storeName

  // Invalid non-array sales
  const invalidSalesJson = JSON.stringify({
    storeProfile: initialStoreProfile,
    transactions: { sales: 'not an array' },
  });
  const res = validateAndParseBackupJSON(invalidSalesJson);
  assert.equal(res.valid, false);
  assert.match(res.error || '', /Sales bills collection must be an array/);

  // Incomplete backup missing required suppliers collection must be rejected
  const missingSuppliersJson = JSON.stringify({
    storeProfile: initialStoreProfile,
    transactions: {
      sales: initialSales,
      customerTransactions: initialCustomerTransactions,
      supplierTransactions: initialSupplierTransactions,
      expenses: initialExpenses,
      cashbookEntries: initialCashbookEntries,
    },
    masterData: {
      customers: initialCustomers,
      products: initialProducts,
    },
  });
  const missingSupRes = validateAndParseBackupJSON(missingSuppliersJson);
  assert.equal(missingSupRes.valid, false);
  assert.match(missingSupRes.error || '', /Incomplete backup rejected/i);
});

test('validateAndParseBackupJSON rejects duplicate IDs, negative stock quantities, invalid dates, and mismatched recordCounts', () => {
  const backup = generateBackupData({
    profile: {
      ...initialStoreProfile,
      pinCode: '9999',
      accessToken: 'secret-token-should-strip',
    } as typeof initialStoreProfile,
    customers: initialCustomers,
    customerTransactions: initialCustomerTransactions,
    suppliers: initialSuppliers,
    supplierTransactions: initialSupplierTransactions,
    sales: initialSales,
    expenses: initialExpenses,
    cashbookEntries: initialCashbookEntries,
    products: initialProducts,
    stockAdjustments: [],
    auditLogs: initialAuditLogs,
    billDocuments: [],
  });

  // Ensure secrets/PINs are never exported
  assert.equal((backup.storeProfile as unknown as Record<string, unknown>).pinCode, undefined);
  assert.equal((backup.storeProfile as unknown as Record<string, unknown>).accessToken, undefined);

  // Duplicate product ID rejected
  const dupProduct = {
    ...backup,
    masterData: {
      ...backup.masterData,
      products: [initialProducts[0], { ...initialProducts[0] }],
    },
  };
  const dupRes = validateAndParseBackupJSON(JSON.stringify(dupProduct));
  assert.equal(dupRes.valid, false);
  assert.match(dupRes.error || '', /duplicate record id/i);

  // Negative stockQty rejected
  const negStock = {
    ...backup,
    masterData: {
      ...backup.masterData,
      products: [{ ...initialProducts[0], stockQty: -5 }, ...initialProducts.slice(1)],
    },
  };
  const negRes = validateAndParseBackupJSON(JSON.stringify(negStock));
  assert.equal(negRes.valid, false);
  assert.match(negRes.error || '', /negative value/i);

  // Invalid date rejected
  const badDate = {
    ...backup,
    transactions: {
      ...backup.transactions,
      sales: [{ ...initialSales[0], date: 'not-a-real-date' }, ...initialSales.slice(1)],
    },
  };
  const dateRes = validateAndParseBackupJSON(JSON.stringify(badDate));
  assert.equal(dateRes.valid, false);
  assert.match(dateRes.error || '', /invalid date/i);

  // Mismatched recordCounts rejected
  const badCounts = {
    ...backup,
    recordCounts: {
      ...(backup.recordCounts || {}),
      sales: initialSales.length + 5,
    },
  };
  const countRes = validateAndParseBackupJSON(JSON.stringify(badCounts));
  assert.equal(countRes.valid, false);
  assert.match(countRes.error || '', /record count mismatch/i);
});

