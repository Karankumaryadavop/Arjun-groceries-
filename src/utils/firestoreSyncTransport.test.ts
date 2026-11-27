import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFirestoreUpdatePatch,
  FIRESTORE_ALLOWED_UPDATE_KEYS,
  isTerminalTransactionStatus,
  mapFirestoreDocsToDatasetPatch,
  parseFirestoreErrorInfo,
  type FirestoreCollectionKey,
} from './firestoreSyncTransport';
import {
  buildCustomerCloudPayload,
  buildProductCloudPayload,
  buildSaleCloudPayload,
  buildStoreWorkspacePayload,
} from './firestorePayload';

test('buildFirestoreUpdatePatch strips immutable fields and enforces exact firestore.rules allowlists', () => {
  const ownerId = 'uid-owner-123';
  const customerPayload = buildCustomerCloudPayload(ownerId, {
    id: 'cust-1',
    name: 'Ramesh Kirana',
    phone: '9876543210',
    address: 'Main Market',
    openingBalance: 100,
    currentBalance: 450,
    totalCreditGiven: 500,
    totalPaymentReceived: 150,
    overdueDays: 0,
    category: 'REGULAR',
    whatsappConsent: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const customerPatch = buildFirestoreUpdatePatch('customers', {
    ...customerPayload,
    createdAt: '2026-01-01T00:00:00.000Z',
    isAdmin: true,
  });

  assert.equal('id' in customerPatch, false);
  assert.equal('ownerId' in customerPatch, false);
  assert.equal('createdAt' in customerPatch, false);
  assert.equal('isAdmin' in customerPatch, false);
  assert.equal(customerPatch.name, 'Ramesh Kirana');
  assert.equal(customerPatch.currentBalance, 450);

  // Verify every collection patch only contains allowlisted keys
  const collections = Object.keys(FIRESTORE_ALLOWED_UPDATE_KEYS) as FirestoreCollectionKey[];
  for (const col of collections) {
    const allowed = new Set(FIRESTORE_ALLOWED_UPDATE_KEYS[col]);
    const sample = {
      id: 'doc-1',
      ownerId: 'uid-1',
      createdAt: 'ts',
      shadowField: 'nope',
      storeName: 'Arjun Groceries',
      name: 'Sample',
      description: 'Desc',
      amount: 100,
      localUpdatedAt: '2026-01-01T00:00:00.000Z',
    };
    const patch = buildFirestoreUpdatePatch(col, sample);
    for (const key of Object.keys(patch)) {
      assert.equal(allowed.has(key), true, `Unexpected key "${key}" in ${col} update patch`);
    }
    assert.equal('id' in patch, false);
    assert.equal('ownerId' in patch, false);
    assert.equal('createdAt' in patch, false);
    assert.equal('shadowField' in patch, false);
  }
});

test('isTerminalTransactionStatus identifies CANCELLED and REVERSED transactions', () => {
  assert.equal(isTerminalTransactionStatus('CANCELLED'), true);
  assert.equal(isTerminalTransactionStatus('REVERSED'), true);
  assert.equal(isTerminalTransactionStatus('COMPLETED'), false);
  assert.equal(isTerminalTransactionStatus(undefined), false);
});

test('parseFirestoreErrorInfo parses structured JSON errors and flags permission-denied cleanly', () => {
  const structured = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'write',
      path: 'stores/uid-1/sales/s1',
      authInfo: { userId: 'uid-1', email: 'owner@example.com', emailVerified: true },
    })
  );
  const parsed = parseFirestoreErrorInfo(structured);
  assert.equal(parsed.permissionDenied, true);
  assert.equal(parsed.info?.path, 'stores/uid-1/sales/s1');
  assert.match(parsed.message, /firestore\.rules/i);

  const networkErr = parseFirestoreErrorInfo(new Error('Network unavailable'));
  assert.equal(networkErr.permissionDenied, false);
  assert.equal(networkErr.message, 'Network unavailable');
});

test('mapFirestoreDocsToDatasetPatch maps Firestore workspace and records safely into local types', () => {
  const uid = 'uid-1';
  const ws = buildStoreWorkspacePayload(
    uid,
    {
      id: 'store-profile',
      storeName: 'Arjun Groceries',
      ownerName: 'Arjun',
      phone: '9876543210',
      address: 'Market Road',
      upiId: 'arjun@upi',
      gstin: '27ABCDE1234F1Z5',
      currencySymbol: '₹',
      isPinEnabled: false,
    },
    '2026-05-01'
  );
  const prod = buildProductCloudPayload(uid, {
    id: 'prod-1',
    name: 'Basmati Rice',
    category: 'Grains',
    unit: 'kg',
    purchasePrice: 80,
    sellingPrice: 110,
    mrp: 120,
    stockQty: 25,
    minStockAlert: 5,
    updatedAt: '2026-05-01T10:00:00.000Z',
  });
  const sale = buildSaleCloudPayload(uid, {
    id: 'sale-1',
    invoiceNo: 'INV-101',
    date: '2026-05-01',
    amount: 220,
    paymentMethod: 'CASH',
    isCredit: false,
    items: [
      {
        productId: 'prod-1',
        productName: 'Basmati Rice',
        quantity: 2,
        unit: 'kg',
        rate: 110,
        total: 220,
      },
    ],
    createdAt: '2026-05-01T10:05:00.000Z',
  });

  const mapped = mapFirestoreDocsToDatasetPatch({
    workspace: ws,
    customers: [],
    customerTransactions: [],
    suppliers: [],
    supplierTransactions: [],
    sales: [sale],
    expenses: [],
    cashbookEntries: [],
    products: [prod],
  });

  assert.equal(mapped.profilePatch.storeName, 'Arjun Groceries');
  assert.equal(mapped.lastClosedDate, '2026-05-01');
  assert.equal(mapped.products.length, 1);
  assert.equal(mapped.products[0].purchasePrice, 80);
  assert.equal(mapped.products[0].stockQty, 25);
  assert.equal(mapped.sales.length, 1);
  assert.equal(mapped.sales[0].invoiceNo, 'INV-101');
  assert.equal(mapped.sales[0].items?.length, 1);
});
