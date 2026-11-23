import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerLoyaltyLedger,
  buildStoreLoyaltySummary,
  calculateLoyaltyRedemption,
  calculatePointsEarned,
  DEFAULT_LOYALTY_CONFIG,
} from './loyalty';
import { prepareAtomicCancelSale, prepareAtomicSale } from './atomicTransactions';
import { StoreBusinessDataset } from '../types';

function makeLoyaltyDataset(): StoreBusinessDataset {
  const now = '2026-11-21T08:00:00.000Z';
  return {
    profile: {
      id: 'store-1',
      storeName: 'Arjun Groceries',
      ownerName: 'Arjun Verma',
      phone: '9876543210',
      upiId: 'arjun@upi',
      address: 'Shop 12',
      currencySymbol: '₹',
      isPinEnabled: false,
      loyaltyConfig: { ...DEFAULT_LOYALTY_CONFIG },
    },
    customers: [
      {
        id: 'cust-1',
        name: 'Ramesh Sharma',
        phone: '9876500001',
        openingBalance: 0,
        currentBalance: 0,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: now,
      },
      {
        id: 'cust-2',
        name: 'Meena Devi',
        phone: '9876500002',
        openingBalance: 0,
        currentBalance: 0,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: now,
      },
    ],
    customerTransactions: [],
    suppliers: [],
    supplierTransactions: [],
    sales: [],
    expenses: [],
    cashbookEntries: [],
    products: [],
    stockAdjustments: [],
    auditLogs: [],
    whatsappBatches: [],
    whatsappAuditLogs: [],
  };
}

test('calculatePointsEarned and calculateLoyaltyRedemption enforce rules and caps', () => {
  // Default: 5 points per ₹100, ₹1/pt, min 10 pts, max 50% discount
  assert.equal(calculatePointsEarned(600, DEFAULT_LOYALTY_CONFIG), 30);
  assert.equal(calculatePointsEarned(199, DEFAULT_LOYALTY_CONFIG), 9);

  // Below minRedeemPoints fails
  const tooLow = calculateLoyaltyRedemption({
    availablePoints: 30,
    requestedPoints: 5,
    grossBillAmount: 200,
    config: DEFAULT_LOYALTY_CONFIG,
  });
  assert.equal(tooLow.valid, false);
  assert.match(tooLow.error || '', /Minimum 10/i);

  // Exceeding 50% cap fails
  const overCap = calculateLoyaltyRedemption({
    availablePoints: 200,
    requestedPoints: 120,
    grossBillAmount: 200,
    config: DEFAULT_LOYALTY_CONFIG,
  });
  assert.equal(overCap.valid, false);
  assert.equal(overCap.maxRedeemablePoints, 100);

  // Valid redemption of 20 pts on ₹200 bill => ₹20 discount, ₹180 payable
  const ok = calculateLoyaltyRedemption({
    availablePoints: 30,
    requestedPoints: 20,
    grossBillAmount: 200,
    config: DEFAULT_LOYALTY_CONFIG,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.discountAmount, 20);
  assert.equal(ok.netPayableAmount, 180);
});

test('prepareAtomicSale earns points, redeems points for discount, updates tracking summary, and reverses cleanly on sale cancel', () => {
  let ds = makeLoyaltyDataset();

  // Sale 1: ₹600 CASH -> earns 30 points
  const s1 = prepareAtomicSale(ds, {
    amount: 600,
    paymentMethod: 'CASH',
    customerId: 'cust-1',
    customerName: 'Ramesh Sharma',
    date: '2026-11-21',
  });
  assert.equal(s1.success, true);
  assert.equal(s1.extra?.loyaltyPointsEarned, 30);
  ds = s1.nextDataset!;
  assert.equal(ds.customers.find((c) => c.id === 'cust-1')?.loyaltyPointsBalance, 30);

  // Sale 2: ₹200 UPI redeeming 20 points => ₹20 off, net ₹180, earns 9 new points -> balance = 30 - 20 + 9 = 19 pts
  const s2 = prepareAtomicSale(ds, {
    amount: 200,
    grossAmount: 200,
    loyaltyPointsRedeemed: 20,
    paymentMethod: 'UPI',
    customerId: 'cust-1',
    customerName: 'Ramesh Sharma',
    date: '2026-11-21',
  });
  assert.equal(s2.success, true);
  assert.equal(s2.extra?.loyaltyPointsRedeemed, 20);
  assert.equal(s2.extra?.loyaltyDiscountAmount, 20);
  assert.equal(s2.extra?.loyaltyPointsEarned, 9);
  ds = s2.nextDataset!;

  const sale2Record = ds.sales.find((s) => s.id === s2.extra!.saleId)!;
  assert.equal(sale2Record.grossAmount, 200);
  assert.equal(sale2Record.amount, 180);
  assert.equal(sale2Record.loyaltyDiscountAmount, 20);

  const ledger = buildCustomerLoyaltyLedger(
    ds.customers.find((c) => c.id === 'cust-1')!,
    ds.sales,
    DEFAULT_LOYALTY_CONFIG
  );
  assert.equal(ledger.totalEarned, 39);
  assert.equal(ledger.totalRedeemed, 20);
  assert.equal(ledger.availablePoints, 19);
  assert.equal(ledger.totalDiscountSaved, 20);
  assert.equal(ledger.status, 'REDEEM_READY');

  const summary = buildStoreLoyaltySummary(ds.customers, ds.sales, DEFAULT_LOYALTY_CONFIG);
  assert.equal(summary.activeEarnersCount, 1);
  assert.equal(summary.redeemReadyCount, 1);
  assert.equal(summary.totalAvailablePoints, 19);
  assert.equal(summary.totalDiscountsGivenRs, 20);

  // Cancelling Sale 2 automatically restores the 20 redeemed points and removes the 9 earned points => back to 30 pts!
  const cancelRes = prepareAtomicCancelSale(ds, s2.extra!.saleId, 'Customer returned');
  assert.equal(cancelRes.success, true);
  const afterCancel = cancelRes.nextDataset!;
  assert.equal(afterCancel.customers.find((c) => c.id === 'cust-1')?.loyaltyPointsBalance, 30);
});
