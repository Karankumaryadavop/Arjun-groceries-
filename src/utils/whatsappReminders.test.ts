/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWhatsAppPhoneNumber,
  getWeeklyISTWindow,
  calculateInvoiceOutstanding,
  findEligibleWeeklyInvoices,
  groupInvoicesByCustomer,
  createWeeklyReminderBatch,
  generateReminderMessageText,
} from './whatsappReminders';
import { Customer, CustomerTransaction, SaleRecord, StoreProfile } from '../types';

const mockProfile: StoreProfile = {
  id: 'store-1',
  storeName: 'Mahalaxmi Kirana',
  ownerName: 'Radheshyam Gupta',
  phone: '9820123456',
  upiId: 'mahalaxmi@okaxis',
  address: 'Shop 4, Station Road',
  currencySymbol: '₹',
  isPinEnabled: false,
};

test('formatWhatsAppPhoneNumber validates and normalizes Indian mobile numbers', () => {
  // Valid 10 digits
  const res1 = formatWhatsAppPhoneNumber('9876543210');
  assert.equal(res1.isValid, true);
  assert.equal(res1.formattedE164, '919876543210');

  // Valid with +91 and spaces
  const res2 = formatWhatsAppPhoneNumber('+91 98201-98765');
  assert.equal(res2.isValid, true);
  assert.equal(res2.formattedE164, '919820198765');

  // Valid with leading 0
  const res3 = formatWhatsAppPhoneNumber('09819001122');
  assert.equal(res3.isValid, true);
  assert.equal(res3.formattedE164, '919819001122');

  // Invalid: starts with 5 (not 6-9)
  const res4 = formatWhatsAppPhoneNumber('5876543210');
  assert.equal(res4.isValid, false);

  // Invalid: missing or too short
  const res5 = formatWhatsAppPhoneNumber('12345');
  assert.equal(res5.isValid, false);

  // Empty
  const res6 = formatWhatsAppPhoneNumber('');
  assert.equal(res6.isValid, false);
});

test('getWeeklyISTWindow accurately computes Sunday 12:00 PM IST and 7-day window', () => {
  // Sunday 15 Nov 2026, 14:00:00 IST (UTC 08:30:00)
  const refDate = new Date('2026-11-15T08:30:00.000Z');
  const windowInfo = getWeeklyISTWindow(refDate);

  // Scheduled execution time should be Sunday 15 Nov 2026, 12:00 PM IST (UTC 06:30:00)
  assert.equal(windowInfo.scheduledExecution.toISOString(), '2026-11-15T06:30:00.000Z');

  // Window end is Sunday 12:00 PM IST
  assert.equal(windowInfo.windowEnd.toISOString(), '2026-11-15T06:30:00.000Z');

  // Window start is exactly 7 days prior (Sunday 08 Nov 2026, 12:00 PM IST)
  assert.equal(windowInfo.windowStart.toISOString(), '2026-11-08T06:30:00.000Z');

  // Duration is exactly 7 days = 168 hours = 604,800,000 ms
  const diffMs = windowInfo.windowEnd.getTime() - windowInfo.windowStart.getTime();
  assert.equal(diffMs, 7 * 24 * 60 * 60 * 1000);
});

test('calculateInvoiceOutstanding respects payments and caps at customer ledger balance', () => {
  const customer: Customer = {
    id: 'cust-1',
    name: 'Ramesh Bhai',
    phone: '9876543210',
    openingBalance: 0,
    currentBalance: 1200,
    totalCreditGiven: 2000,
    totalPaymentReceived: 800,
    overdueDays: 5,
    category: 'REGULAR',
    createdAt: '2026-10-01',
  };

  const sale: SaleRecord = {
    id: 'sale-1',
    invoiceNo: 'BILL-101',
    date: '2026-11-10T10:00:00Z',
    customerId: 'cust-1',
    amount: 1500,
    paymentMethod: 'CREDIT',
    items: [],
    isCredit: true,
    createdAt: '2026-11-10T10:00:00Z',
  };

  // 1. Direct payment of 300 on this invoice
  const transactions: CustomerTransaction[] = [
    {
      id: 'tx-1',
      customerId: 'cust-1',
      type: 'PAYMENT',
      amount: 300,
      date: '2026-11-11T12:00:00Z',
      description: 'Partial payment',
      invoiceNo: 'BILL-101',
      createdAt: '2026-11-11T12:00:00Z',
    },
  ];

  const res = calculateInvoiceOutstanding(sale, customer, transactions);
  // Original was 1500, 300 direct payment -> 1200 remaining. Customer current balance is 1200.
  assert.equal(res.outstandingAmount, 1200);
  assert.equal(res.paidAmount, 300);
  assert.equal(res.status, 'PARTIALLY_PAID');

  // 2. If customer's total ledger is now 0 (fully settled elsewhere)
  const clearedCust = { ...customer, currentBalance: 0 };
  const clearedRes = calculateInvoiceOutstanding(sale, clearedCust, transactions);
  assert.equal(clearedRes.outstandingAmount, 0);
  assert.equal(clearedRes.isFullyPaid, true);
  assert.equal(clearedRes.status, 'PAID');
});

test('findEligibleWeeklyInvoices excludes fully paid, cash bills, and outside-window sales', () => {
  const windowStart = new Date('2026-11-08T06:30:00.000Z');
  const windowEnd = new Date('2026-11-15T06:30:00.000Z');

  const customers: Customer[] = [
    {
      id: 'cust-1',
      name: 'Ramesh',
      phone: '9876543210',
      openingBalance: 0,
      currentBalance: 1500,
      totalCreditGiven: 1500,
      totalPaymentReceived: 0,
      overdueDays: 2,
      category: 'REGULAR',
      createdAt: '2026-10-01',
    },
    {
      id: 'cust-2',
      name: 'Sunita (Cleared)',
      phone: '9820198765',
      openingBalance: 0,
      currentBalance: 0, // Cleared!
      totalCreditGiven: 3000,
      totalPaymentReceived: 3000,
      overdueDays: 0,
      category: 'CLEARED',
      createdAt: '2026-10-01',
    },
  ];

  const sales: SaleRecord[] = [
    // 1. In-window credit sale with balance -> ELIGIBLE
    {
      id: 's-1',
      invoiceNo: 'BILL-201',
      date: '2026-11-10T10:00:00Z',
      customerId: 'cust-1',
      amount: 1500,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      createdAt: '2026-11-10T10:00:00Z',
    },
    // 2. In-window counter CASH sale -> INELIGIBLE
    {
      id: 's-2',
      invoiceNo: 'BILL-202',
      date: '2026-11-11T11:00:00Z',
      amount: 600,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-11T11:00:00Z',
    },
    // 3. In-window credit sale but customer has 0 currentBalance -> INELIGIBLE (fully settled)
    {
      id: 's-3',
      invoiceNo: 'BILL-203',
      date: '2026-11-12T14:00:00Z',
      customerId: 'cust-2',
      amount: 800,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      createdAt: '2026-11-12T14:00:00Z',
    },
    // 4. Before-window credit sale (older than 7 days) -> OUTSIDE WINDOW
    {
      id: 's-4',
      invoiceNo: 'BILL-204',
      date: '2026-11-01T10:00:00Z',
      customerId: 'cust-1',
      amount: 500,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      createdAt: '2026-11-01T10:00:00Z',
    },
  ];

  const { eligibleSales } = findEligibleWeeklyInvoices(sales, customers, [], windowStart, windowEnd);

  assert.equal(eligibleSales.length, 1);
  assert.equal(eligibleSales[0].id, 's-1');
  assert.equal(eligibleSales[0].invoiceNo, 'BILL-201');
});

test('groupInvoicesByCustomer groups multiple bills into one reminder per customer', () => {
  const customer: Customer = {
    id: 'cust-rahul',
    name: 'Rahul',
    phone: '9876543210',
    openingBalance: 0,
    currentBalance: 1250,
    totalCreditGiven: 1250,
    totalPaymentReceived: 0,
    overdueDays: 3,
    category: 'REGULAR',
    createdAt: '2026-10-01',
  };

  const eligibleSales: SaleRecord[] = [
    {
      id: 's-1',
      invoiceNo: 'SK-1021',
      date: '2026-11-09T10:00:00Z',
      customerId: 'cust-rahul',
      amount: 500,
      paymentMethod: 'CREDIT',
      items: [{ productName: 'Sugar', quantity: 2, unit: 'kg', rate: 45, total: 90 }],
      isCredit: true,
      createdAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 's-2',
      invoiceNo: 'SK-1025',
      date: '2026-11-11T12:00:00Z',
      customerId: 'cust-rahul',
      amount: 350,
      paymentMethod: 'CREDIT',
      items: [{ productName: 'Tea', quantity: 1, unit: 'box', rate: 120, total: 120 }],
      isCredit: true,
      createdAt: '2026-11-11T12:00:00Z',
    },
    {
      id: 's-3',
      invoiceNo: 'SK-1030',
      date: '2026-11-13T16:00:00Z',
      customerId: 'cust-rahul',
      amount: 400,
      paymentMethod: 'CREDIT',
      items: [{ productName: 'Oil', quantity: 1, unit: 'L', rate: 145, total: 145 }],
      isCredit: true,
      createdAt: '2026-11-13T16:00:00Z',
    },
  ];

  const grouped = groupInvoicesByCustomer(
    eligibleSales,
    [customer],
    [],
    mockProfile,
    '2026-11-08T06:30:00.000Z',
    '2026-11-15T06:30:00.000Z'
  );

  assert.equal(grouped.totalEligibleCustomers, 1);
  assert.equal(grouped.customerItems.length, 1);

  const rahulItem = grouped.customerItems[0];
  assert.equal(rahulItem.customerName, 'Rahul');
  assert.equal(rahulItem.invoices.length, 3);
  assert.equal(rahulItem.totalOutstanding, 1250);
  assert.equal(rahulItem.eligibilityStatus, 'ELIGIBLE');
  assert.ok(rahulItem.messageText.includes('SK-1021'));
  assert.ok(rahulItem.messageText.includes('SK-1025'));
  assert.ok(rahulItem.messageText.includes('SK-1030'));
  assert.ok(rahulItem.messageText.includes('1,250'));
});

test('groupInvoicesByCustomer respects whatsappConsent: false and missing phone numbers', () => {
  const custNoConsent: Customer = {
    id: 'cust-opt-out',
    name: 'Opt-out Customer',
    phone: '9876543210',
    openingBalance: 0,
    currentBalance: 500,
    totalCreditGiven: 500,
    totalPaymentReceived: 0,
    overdueDays: 4,
    category: 'REGULAR',
    whatsappConsent: false, // Opted out
    createdAt: '2026-10-01',
  };

  const custMissingPhone: Customer = {
    id: 'cust-no-phone',
    name: 'No Phone Customer',
    phone: '', // Missing phone
    openingBalance: 0,
    currentBalance: 700,
    totalCreditGiven: 700,
    totalPaymentReceived: 0,
    overdueDays: 4,
    category: 'REGULAR',
    createdAt: '2026-10-01',
  };

  const sales: SaleRecord[] = [
    {
      id: 's-opt',
      invoiceNo: 'BILL-OPT',
      date: '2026-11-10T10:00:00Z',
      customerId: 'cust-opt-out',
      amount: 500,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      createdAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 's-nophone',
      invoiceNo: 'BILL-NOPHONE',
      date: '2026-11-11T10:00:00Z',
      customerId: 'cust-no-phone',
      amount: 700,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      createdAt: '2026-11-11T10:00:00Z',
    },
  ];

  const grouped = groupInvoicesByCustomer(
    sales,
    [custNoConsent, custMissingPhone],
    [],
    mockProfile,
    '2026-11-08T06:30:00.000Z',
    '2026-11-15T06:30:00.000Z'
  );

  // Neither should be marked as ELIGIBLE for automatic selection
  assert.equal(grouped.totalEligibleCustomers, 0);
  assert.equal(grouped.customersWithoutConsent, 1);
  assert.equal(grouped.customersWithMissingPhone, 1);

  const optItem = grouped.customerItems.find((i) => i.customerId === 'cust-opt-out');
  assert.equal(optItem?.eligibilityStatus, 'NO_CONSENT');
  assert.equal(optItem?.status, 'EXCLUDED');

  const phoneItem = grouped.customerItems.find((i) => i.customerId === 'cust-no-phone');
  assert.equal(phoneItem?.eligibilityStatus, 'MISSING_PHONE');
  assert.equal(phoneItem?.status, 'EXCLUDED');
});

test('createWeeklyReminderBatch produces valid batch with deterministic idempotency key', () => {
  const refDate = new Date('2026-11-15T08:30:00.000Z');
  const batch = createWeeklyReminderBatch([], [], [], mockProfile, refDate);

  assert.ok(batch.id.startsWith('batch_store-1'));
  assert.ok(batch.idempotencyKey.startsWith('batch_key_store-1'));
  assert.equal(batch.status, 'COMPLETED'); // No items to review
  assert.equal(batch.totalEligibleCustomers, 0);
});

test('formatWhatsAppPhoneNumber supports valid international E.164 numbers with + country code', () => {
  const us = formatWhatsAppPhoneNumber('+1 415 555 2671');
  assert.equal(us.isValid, true);
  assert.equal(us.formattedE164, '14155552671');

  const uae = formatWhatsAppPhoneNumber('+971501234567');
  assert.equal(uae.isValid, true);
  assert.equal(uae.formattedE164, '971501234567');

  const invalidIntl = formatWhatsAppPhoneNumber('+123');
  assert.equal(invalidIntl.isValid, false);
});

test('calculateInvoiceOutstanding ignores CANCELLED/REVERSED tx and handles returns, credit adjustments, and FIFO unallocated payments', () => {
  const customer: Customer = {
    id: 'cust-fifo',
    name: 'Mahesh Kirana Customer',
    phone: '9876543210',
    openingBalance: 0,
    currentBalance: 1100, // Bill1 (1000) + Bill2 (800) - Payment (500) - Return (200) = 1100
    totalCreditGiven: 1800,
    totalPaymentReceived: 500,
    overdueDays: 2,
    category: 'REGULAR',
    createdAt: '2026-11-01',
  };

  const bill1: SaleRecord = {
    id: 's-b1',
    invoiceNo: 'BILL-501',
    date: '2026-11-09T10:00:00Z',
    customerId: 'cust-fifo',
    amount: 1000,
    paymentMethod: 'CREDIT',
    items: [],
    isCredit: true,
    createdAt: '2026-11-09T10:00:00Z',
  };

  const bill2: SaleRecord = {
    id: 's-b2',
    invoiceNo: 'BILL-502',
    date: '2026-11-11T10:00:00Z',
    customerId: 'cust-fifo',
    amount: 800,
    paymentMethod: 'CREDIT',
    items: [],
    isCredit: true,
    createdAt: '2026-11-11T10:00:00Z',
  };

  const txs: CustomerTransaction[] = [
    // Cancelled payment must NOT reduce outstanding
    {
      id: 'tx-cancelled',
      customerId: 'cust-fifo',
      type: 'PAYMENT',
      amount: 1000,
      date: '2026-11-10T10:00:00Z',
      description: 'Bounced / cancelled',
      invoiceNo: 'BILL-501',
      status: 'CANCELLED',
      createdAt: '2026-11-10T10:00:00Z',
    },
    // Unallocated cash payment of 500 -> FIFO allocates to BILL-501 first
    {
      id: 'tx-pay',
      customerId: 'cust-fifo',
      type: 'PAYMENT',
      amount: 500,
      date: '2026-11-12T10:00:00Z',
      description: 'Cash partial payment',
      status: 'COMPLETED',
      createdAt: '2026-11-12T10:00:00Z',
    },
    // Sales return tagged to BILL-502 of 200
    {
      id: 'tx-ret',
      customerId: 'cust-fifo',
      type: 'RETURN',
      amount: 200,
      date: '2026-11-12T15:00:00Z',
      description: 'Returned damaged flour bag',
      invoiceNo: 'BILL-502',
      status: 'COMPLETED',
      createdAt: '2026-11-12T15:00:00Z',
    },
  ];

  const res1 = calculateInvoiceOutstanding(bill1, customer, txs, [bill1, bill2]);
  assert.equal(res1.outstandingAmount, 500);
  assert.equal(res1.status, 'PARTIALLY_PAID');

  const res2 = calculateInvoiceOutstanding(bill2, customer, txs, [bill1, bill2]);
  assert.equal(res2.outstandingAmount, 600);
  assert.equal(res2.status, 'PARTIALLY_PAID');
});

