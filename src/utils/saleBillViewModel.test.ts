import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSaleBillCustomerSummary,
  buildSaleBillFinancialSummary,
  formatCompactBillQty,
  getProductBadgeMeta,
  resolveSaleBillStatus,
} from './saleBillViewModel';
import { Customer, SaleItem } from '../types';

const sampleCustomer: Customer = {
  id: 'cust-1',
  name: 'Ramesh Kumar',
  phone: '9876543210',
  openingBalance: 0,
  currentBalance: 1250,
  totalCreditGiven: 1250,
  totalPaymentReceived: 0,
  overdueDays: 0,
  category: 'REGULAR',
  createdAt: '2026-01-01T00:00:00.000Z',
};

test('formatCompactBillQty formats grocery units cleanly', () => {
  assert.equal(formatCompactBillQty(1, 'PACKET'), '1 pkt');
  assert.equal(formatCompactBillQty(2, 'KG'), '2 kg');
  assert.equal(formatCompactBillQty(500, 'GM'), '500 gm');
  assert.equal(formatCompactBillQty(1.5, 'LITRE'), '1.5 L');
  assert.equal(formatCompactBillQty(250, 'ML'), '250 ml');
  assert.equal(formatCompactBillQty(3, 'PCS'), '3 pcs');
});

test('buildSaleBillFinancialSummary computes subtotal, item discount, loyalty discount, paid & outstanding accurately', () => {
  const items: SaleItem[] = [
    { productId: 'p1', productName: 'Maggi Noodles', quantity: 1, unit: 'PACKET', rate: 14, total: 14 },
    { productId: 'p2', productName: 'Parle-G Biscuit', quantity: 2, unit: 'PACKET', rate: 10, discount: 2, total: 18 },
    { productId: 'p3', productName: 'Tata Salt 1kg', quantity: 1, unit: 'PACKET', rate: 28, total: 28 },
  ];

  // Cash discounted sale with loyalty redemption
  const cashSummary = buildSaleBillFinancialSummary({
    items,
    grossAmount: 60,
    netTotal: 55,
    loyaltyDiscount: 5,
    paymentMethod: 'CASH',
  });
  assert.equal(cashSummary.subtotal, 62);
  assert.equal(cashSummary.itemDiscountTotal, 2);
  assert.equal(cashSummary.loyaltyDiscount, 5);
  assert.equal(cashSummary.totalDiscount, 7);
  assert.equal(cashSummary.grandTotal, 55);
  assert.equal(cashSummary.amountPaid, 55);
  assert.equal(cashSummary.remainingOutstanding, 0);

  // Credit sale with partial payment tracked on invoice
  const partialCredit = buildSaleBillFinancialSummary({
    items,
    grossAmount: 60,
    netTotal: 60,
    paymentMethod: 'CREDIT',
    isCredit: true,
    existingOutstandingForSale: 20,
  });
  assert.equal(partialCredit.grandTotal, 60);
  assert.equal(partialCredit.amountPaid, 40);
  assert.equal(partialCredit.remainingOutstanding, 20);
});

test('buildSaleBillCustomerSummary handles draft vs finalized balances and walk-in null safely', () => {
  assert.equal(
    buildSaleBillCustomerSummary({
      customer: null,
      billAmount: 62,
      paymentMethod: 'CASH',
      isFinalized: false,
    }),
    null
  );

  // Draft Credit sale projects previous + bill
  const draftCredit = buildSaleBillCustomerSummary({
    customer: sampleCustomer,
    billAmount: 62,
    paymentMethod: 'CREDIT',
    isFinalized: false,
  });
  assert.equal(draftCredit?.previousOutstanding, 1250);
  assert.equal(draftCredit?.newOutstanding, 1312);
  assert.equal(draftCredit?.isCreditImpact, true);

  // Draft Cash sale leaves outstanding unchanged
  const draftCash = buildSaleBillCustomerSummary({
    customer: sampleCustomer,
    billAmount: 62,
    paymentMethod: 'CASH',
    isFinalized: false,
  });
  assert.equal(draftCash?.previousOutstanding, 1250);
  assert.equal(draftCash?.newOutstanding, 1250);
  assert.equal(draftCash?.isCreditImpact, false);

  // Finalized Credit sale reconstructs previous balance cleanly from updated ledger balance
  const finalizedCredit = buildSaleBillCustomerSummary({
    customer: { ...sampleCustomer, currentBalance: 1312 },
    billAmount: 62,
    paymentMethod: 'CREDIT',
    isFinalized: true,
  });
  assert.equal(finalizedCredit?.previousOutstanding, 1250);
  assert.equal(finalizedCredit?.newOutstanding, 1312);

  // Historical Credit sale viewed after a later ₹30 partial payment shows exact historical ledger Prev -> After Bill + Current balance
  const historicalAfterPayment = buildSaleBillCustomerSummary({
    customer: { ...sampleCustomer, openingBalance: 1250, currentBalance: 1282 },
    billAmount: 62,
    paymentMethod: 'CREDIT',
    isFinalized: true,
    invoiceNo: 'BILL-1044',
    customerTransactions: [
      {
        id: 'tx-credit-1',
        customerId: 'cust-1',
        type: 'CREDIT',
        amount: 62,
        date: '2026-01-02T10:00:00.000Z',
        description: 'Credit Sale #BILL-1044',
        invoiceNo: 'BILL-1044',
        createdAt: '2026-01-02T10:00:00.000Z',
      },
      {
        id: 'tx-pay-1',
        customerId: 'cust-1',
        type: 'PAYMENT',
        amount: 30,
        date: '2026-01-03T10:00:00.000Z',
        description: 'Partial payment',
        createdAt: '2026-01-03T10:00:00.000Z',
      },
    ],
  });
  assert.equal(historicalAfterPayment?.previousOutstanding, 1250);
  assert.equal(historicalAfterPayment?.newOutstanding, 1312);
  assert.equal(historicalAfterPayment?.currentLedgerBalance, 1282);
});

test('resolveSaleBillStatus and getProductBadgeMeta produce clean labels and deterministic badges', () => {
  assert.equal(resolveSaleBillStatus({ isFinalized: false }).label, 'Pending');
  assert.equal(
    resolveSaleBillStatus({ isFinalized: true, paymentStatus: 'PAID' }).label,
    'Completed'
  );
  assert.equal(
    resolveSaleBillStatus({ isFinalized: true, paymentStatus: 'PARTIAL' }).label,
    'Partial'
  );
  assert.equal(
    resolveSaleBillStatus({
      isFinalized: true,
      sale: {
        id: 's1',
        invoiceNo: 'BILL-1044',
        date: '2026-01-01',
        amount: 62,
        paymentMethod: 'CREDIT',
        isCredit: true,
        items: [],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      paymentStatus: 'UNPAID',
    }).label,
    'Credit Due'
  );

  const badge = getProductBadgeMeta('Maggi Noodles');
  assert.equal(badge.initials, 'MN');
  assert.ok(badge.bgClass.startsWith('bg-'));
});
