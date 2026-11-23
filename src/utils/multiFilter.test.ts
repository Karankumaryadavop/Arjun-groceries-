import test from 'node:test';
import assert from 'node:assert/strict';
import { Customer, CustomerTransaction, SaleRecord } from '../types';
import {
  filterCustomersMultiCriteria,
  filterSalesMultiCriteria,
  getSalePaymentStatus,
} from './multiFilter';

const refNow = new Date('2026-11-14T12:00:00Z');

const sampleCustomers: Customer[] = [
  {
    id: 'c1',
    name: 'Ramesh Bhai Patel',
    phone: '9876543210',
    openingBalance: 0,
    currentBalance: 1450,
    totalCreditGiven: 1450,
    totalPaymentReceived: 0,
    lastTransactionDate: '2026-11-13T10:00:00Z',
    overdueDays: 1,
    category: 'REGULAR',
    createdAt: '2026-09-01',
  },
  {
    id: 'c2',
    name: 'Sunita Sharma',
    phone: '9820198765',
    openingBalance: 0,
    currentBalance: 3200,
    totalCreditGiven: 3200,
    totalPaymentReceived: 0,
    lastTransactionDate: '2026-09-15T10:00:00Z',
    overdueDays: 60,
    category: 'OVERDUE',
    createdAt: '2026-08-01',
  },
  {
    id: 'c3',
    name: 'Dr. Anita Deshmukh',
    phone: '9819001122',
    openingBalance: 0,
    currentBalance: 0,
    totalCreditGiven: 1800,
    totalPaymentReceived: 1800,
    lastTransactionDate: '2026-11-10T18:00:00Z',
    overdueDays: 0,
    category: 'CLEARED',
    createdAt: '2026-09-01',
  },
];

const sampleCustomerTx: CustomerTransaction[] = [
  {
    id: 'tx1',
    customerId: 'c1',
    type: 'CREDIT',
    amount: 1450,
    date: '2026-11-13T10:00:00Z',
    description: 'Atta and Sugar',
    invoiceNo: 'BILL-1003',
    createdAt: '2026-11-13T10:00:00Z',
  },
  {
    id: 'tx2',
    customerId: 'c2',
    type: 'CREDIT',
    amount: 3200,
    date: '2026-09-15T10:00:00Z',
    description: 'Festival Ration',
    invoiceNo: 'BILL-0901',
    createdAt: '2026-09-15T10:00:00Z',
  },
  {
    id: 'tx3',
    customerId: 'c3',
    type: 'CREDIT',
    amount: 1800,
    date: '2026-11-01T10:00:00Z',
    description: 'Clinic pantry',
    invoiceNo: 'BILL-1000',
    createdAt: '2026-11-01T10:00:00Z',
  },
  {
    id: 'tx4',
    customerId: 'c3',
    type: 'PAYMENT',
    amount: 1800,
    date: '2026-11-10T18:00:00Z',
    description: 'Settled via UPI',
    invoiceNo: 'BILL-1000',
    paymentMethod: 'UPI',
    createdAt: '2026-11-10T18:00:00Z',
  },
];

const sampleSales: SaleRecord[] = [
  {
    id: 's1',
    invoiceNo: 'BILL-1001',
    date: '2026-11-14T08:30:00Z',
    amount: 620,
    paymentMethod: 'CASH',
    items: [{ productName: 'Tata Salt', quantity: 2, unit: 'pkt', rate: 28, total: 56 }],
    isCredit: false,
    createdAt: '2026-11-14T08:30:00Z',
  },
  {
    id: 's2',
    invoiceNo: 'BILL-1003',
    date: '2026-11-13T10:00:00Z',
    customerId: 'c1',
    customerName: 'Ramesh Bhai Patel',
    amount: 1450,
    paymentMethod: 'CREDIT',
    items: [{ productName: 'Aashirvaad Atta', quantity: 1, unit: 'bag', rate: 425, total: 425 }],
    isCredit: true,
    createdAt: '2026-11-13T10:00:00Z',
  },
  {
    id: 's3',
    invoiceNo: 'BILL-1000',
    date: '2026-11-01T10:00:00Z',
    customerId: 'c3',
    customerName: 'Dr. Anita Deshmukh',
    amount: 1800,
    paymentMethod: 'CREDIT',
    items: [],
    isCredit: true,
    createdAt: '2026-11-01T10:00:00Z',
  },
];

test('getSalePaymentStatus accurately resolves PAID vs UNPAID for credit sales', () => {
  assert.equal(
    getSalePaymentStatus(sampleSales[0], sampleCustomers, sampleCustomerTx, sampleSales),
    'PAID'
  );
  assert.equal(
    getSalePaymentStatus(sampleSales[1], sampleCustomers, sampleCustomerTx, sampleSales),
    'UNPAID'
  );
  assert.equal(
    getSalePaymentStatus(sampleSales[2], sampleCustomers, sampleCustomerTx, sampleSales),
    'PAID'
  );
});

test('filterSalesMultiCriteria combines dateRange, transactionType, paymentStatus, and search simultaneously', () => {
  const unpaidLast7Days = filterSalesMultiCriteria(sampleSales, sampleCustomers, sampleCustomerTx, {
    searchQuery: 'ramesh',
    dateRange: 'LAST_7_DAYS',
    transactionType: 'CREDIT',
    paymentStatus: 'UNPAID',
    referenceNow: refNow,
  });
  assert.equal(unpaidLast7Days.length, 1);
  assert.equal(unpaidLast7Days[0].invoiceNo, 'BILL-1003');

  const paidCreditThisMonth = filterSalesMultiCriteria(
    sampleSales,
    sampleCustomers,
    sampleCustomerTx,
    {
      searchQuery: '',
      dateRange: 'THIS_MONTH',
      transactionType: 'CREDIT',
      paymentStatus: 'PAID',
      referenceNow: refNow,
    }
  );
  assert.equal(paidCreditThisMonth.length, 1);
  assert.equal(paidCreditThisMonth[0].invoiceNo, 'BILL-1000');

  const impossibleCombo = filterSalesMultiCriteria(sampleSales, sampleCustomers, sampleCustomerTx, {
    searchQuery: 'BILL-1001',
    dateRange: 'TODAY',
    transactionType: 'CASH',
    paymentStatus: 'UNPAID',
    referenceNow: refNow,
  });
  assert.equal(impossibleCombo.length, 0);
});

test('filterCustomersMultiCriteria filters simultaneously by dateRange, transactionType, paymentStatus, and text', () => {
  const overdueCredits = filterCustomersMultiCriteria(sampleCustomers, sampleCustomerTx, {
    searchQuery: 'sunita',
    dateRange: 'ALL',
    transactionType: 'CREDIT',
    paymentStatus: 'OVERDUE',
    referenceNow: refNow,
  });
  assert.equal(overdueCredits.length, 1);
  assert.equal(overdueCredits[0].id, 'c2');

  const recentPaymentsCleared = filterCustomersMultiCriteria(sampleCustomers, sampleCustomerTx, {
    searchQuery: 'BILL-1000',
    dateRange: 'LAST_7_DAYS',
    transactionType: 'PAYMENT',
    paymentStatus: 'CLEARED',
    referenceNow: refNow,
  });
  assert.equal(recentPaymentsCleared.length, 1);
  assert.equal(recentPaymentsCleared[0].id, 'c3');

  const todayPayments = filterCustomersMultiCriteria(sampleCustomers, sampleCustomerTx, {
    searchQuery: '',
    dateRange: 'TODAY',
    transactionType: 'PAYMENT',
    paymentStatus: 'ALL',
    referenceNow: refNow,
  });
  assert.equal(todayPayments.length, 0);
});
