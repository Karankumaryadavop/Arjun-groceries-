import test from 'node:test';
import assert from 'node:assert/strict';
import { Customer, CustomerTransaction, SaleRecord, Supplier, SupplierTransaction } from '../types';
import {
  lookupCustomerAccount,
  lookupSupplierAccount,
  validateCreateAccountInput,
  verifyOfflineOwnerRecovery,
  buildCustomerPortalData,
  buildSupplierPortalData,
} from './portalAuth';

const sampleCustomers: Customer[] = [
  {
    id: 'cust-1',
    name: 'Ramesh Patel',
    phone: '+91 98112 23344',
    address: 'Sector 4 Market',
    openingBalance: 200,
    currentBalance: 750,
    totalCreditGiven: 1000,
    totalPaymentReceived: 250,
    overdueDays: 0,
    category: 'REGULAR',
    loyaltyPointsBalance: 45,
    totalLoyaltyPointsEarned: 120,
    createdAt: '2026-10-01T10:00:00Z',
  },
];

const sampleSuppliers: Supplier[] = [
  {
    id: 'sup-1',
    name: 'Sharma Wholesale Traders',
    contactPerson: 'Vikram Sharma',
    phone: '09822334455',
    gstin: '09AABCS1429B1Z5',
    openingBalance: 1000,
    currentBalance: 3500,
    totalPurchases: 6000,
    totalPaid: 2000,
    createdAt: '2026-10-01T10:00:00Z',
  },
];

test('lookupCustomerAccount matches normalized phone and case-insensitive name, rejects mismatches', () => {
  const ok = lookupCustomerAccount({
    customers: sampleCustomers,
    name: '  ramesh   patel ',
    phone: '9811223344',
  });
  assert.equal(ok.matched, true);
  assert.equal(ok.customer?.id, 'cust-1');

  const wrongName = lookupCustomerAccount({
    customers: sampleCustomers,
    name: 'Suresh Patel',
    phone: '9811223344',
  });
  assert.equal(wrongName.matched, false);
  assert.match(wrongName.error || '', /No customer record/i);

  const wrongPhone = lookupCustomerAccount({
    customers: sampleCustomers,
    name: 'Ramesh Patel',
    phone: '9999988888',
  });
  assert.equal(wrongPhone.matched, false);
});

test('lookupSupplierAccount matches business name or contact person with normalized phone', () => {
  const byBusiness = lookupSupplierAccount({
    suppliers: sampleSuppliers,
    name: 'sharma wholesale traders',
    phone: '+91-98223-34455',
  });
  assert.equal(byBusiness.matched, true);
  assert.equal(byBusiness.supplier?.id, 'sup-1');

  const byContact = lookupSupplierAccount({
    suppliers: sampleSuppliers,
    name: 'Vikram Sharma',
    phone: '9822334455',
  });
  assert.equal(byContact.matched, true);
  assert.equal(byContact.supplier?.id, 'sup-1');

  const mismatch = lookupSupplierAccount({
    suppliers: sampleSuppliers,
    name: 'Unknown Agro',
    phone: '9822334455',
  });
  assert.equal(mismatch.matched, false);
});

test('validateCreateAccountInput validates store name, owner name, mobile, and matching 4-digit PIN', () => {
  const good = validateCreateAccountInput({
    storeName: 'Arjun Groceries',
    ownerName: 'Arjun Sharma',
    mobile: '+91 9876543210',
    pin: '2580',
    confirmPin: '2580',
  });
  assert.equal(good.valid, true);
  assert.equal(good.normalizedMobile, '9876543210');

  const pinMismatch = validateCreateAccountInput({
    storeName: 'Arjun Groceries',
    ownerName: 'Arjun Sharma',
    mobile: '9876543210',
    pin: '2580',
    confirmPin: '1234',
  });
  assert.equal(pinMismatch.valid, false);
  assert.match(pinMismatch.error || '', /do not match/i);
});

test('verifyOfflineOwnerRecovery requires registered mobile, owner name, store name, and matching new PIN', () => {
  const profile = {
    storeName: 'Arjun Groceries',
    ownerName: 'Arjun Sharma',
    phone: '9876543210',
  };

  const valid = verifyOfflineOwnerRecovery({
    profile,
    enteredMobile: '9876543210',
    enteredOwnerName: 'arjun sharma',
    enteredStoreName: 'ARJUN GROCERIES',
    newPin: '4321',
    confirmNewPin: '4321',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalizedNewPin, '4321');

  const wrongOwner = verifyOfflineOwnerRecovery({
    profile,
    enteredMobile: '9876543210',
    enteredOwnerName: 'Wrong Person',
    enteredStoreName: 'Arjun Groceries',
    newPin: '4321',
    confirmNewPin: '4321',
  });
  assert.equal(wrongOwner.valid, false);
  assert.match(wrongOwner.error || '', /Owner name/i);
});

test('buildCustomerPortalData isolates strictly to the customer and computes totals & running balance', () => {
  const txs: CustomerTransaction[] = [
    {
      id: 'tx-1',
      customerId: 'cust-1',
      type: 'CREDIT',
      amount: 800,
      date: '2026-11-10T10:00:00Z',
      description: 'Monthly Groceries',
      invoiceNo: 'INV-1001',
      status: 'COMPLETED',
      createdAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 'tx-2',
      customerId: 'cust-1',
      type: 'PAYMENT',
      amount: 250,
      date: '2026-11-12T10:00:00Z',
      description: 'UPI Payment',
      paymentMethod: 'UPI',
      status: 'COMPLETED',
      createdAt: '2026-11-12T10:00:00Z',
    },
    {
      id: 'tx-other',
      customerId: 'cust-999',
      type: 'CREDIT',
      amount: 9999,
      date: '2026-11-12T10:00:00Z',
      description: 'Other customer private data',
      status: 'COMPLETED',
      createdAt: '2026-11-12T10:00:00Z',
    },
  ];
  const sales: SaleRecord[] = [
    {
      id: 'sale-1',
      invoiceNo: 'INV-1001',
      date: '2026-11-10T10:00:00Z',
      customerId: 'cust-1',
      amount: 800,
      paymentMethod: 'CREDIT',
      isCredit: true,
      items: [{ productName: 'Basmati Rice', quantity: 5, unit: 'kg', rate: 160, total: 800 }],
      status: 'COMPLETED',
      createdAt: '2026-11-10T10:00:00Z',
    },
  ];

  const portal = buildCustomerPortalData({
    customer: sampleCustomers[0],
    customerTransactions: txs,
    sales,
  });

  assert.equal(portal.entries.length, 2);
  assert.equal(portal.totalBilled, 800);
  assert.equal(portal.totalPaid, 250);
  assert.equal(portal.loyaltyPoints, 45);
  // Newest first: tx-2 balance = 200 opening + 800 - 250 = 750
  assert.equal(portal.entries[0].id, 'tx-2');
  assert.equal(portal.entries[0].runningBalance, 750);
  assert.equal(portal.entries[1].invoiceNo, 'INV-1001');
  assert.equal(portal.entries[1].items?.length, 1);
});

test('buildSupplierPortalData isolates strictly to the supplier and computes payable, purchases, payments & credit notes', () => {
  const txs: SupplierTransaction[] = [
    {
      id: 'stx-1',
      supplierId: 'sup-1',
      type: 'PURCHASE',
      amount: 5000,
      date: '2026-11-05T10:00:00Z',
      description: 'Atta & Oil Stock',
      invoiceNo: 'SUP-501',
      paymentStatus: 'PARTIAL',
      status: 'COMPLETED',
      createdAt: '2026-11-05T10:00:00Z',
    },
    {
      id: 'stx-2',
      supplierId: 'sup-1',
      type: 'PAYMENT',
      amount: 2000,
      date: '2026-11-08T10:00:00Z',
      description: 'Bank transfer',
      paymentMethod: 'BANK',
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      createdAt: '2026-11-08T10:00:00Z',
    },
    {
      id: 'stx-3',
      supplierId: 'sup-1',
      type: 'RETURN',
      amount: 500,
      date: '2026-11-09T10:00:00Z',
      description: 'Damaged oil tins',
      creditNoteNo: 'CN-2026-0001',
      returnReason: 'DAMAGED',
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      createdAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 'stx-other',
      supplierId: 'sup-999',
      type: 'PURCHASE',
      amount: 77777,
      date: '2026-11-09T10:00:00Z',
      description: 'Other supplier data',
      paymentStatus: 'UNPAID',
      status: 'COMPLETED',
      createdAt: '2026-11-09T10:00:00Z',
    },
  ];

  const portal = buildSupplierPortalData({
    supplier: sampleSuppliers[0],
    supplierTransactions: txs,
  });

  assert.equal(portal.entries.length, 3);
  assert.equal(portal.totalPurchases, 5000);
  assert.equal(portal.totalPaid, 2000);
  assert.equal(portal.totalReturns, 500);
  assert.equal(portal.creditNotesCount, 1);
  // Opening 1000 + 5000 - 2000 - 500 = 3500
  assert.equal(portal.entries[0].id, 'stx-3');
  assert.equal(portal.entries[0].runningPayable, 3500);
  assert.equal(portal.entries[0].creditNoteNo, 'CN-2026-0001');
});
