import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTodayActivitySummary } from '../utils/todayActivity';
import type {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  SaleRecord,
  StockAdjustmentRecord,
  Supplier,
  SupplierTransaction,
} from '../types';

test('calculateTodayActivitySummary aggregates only today active records and excludes cancelled/other days', () => {
  const today = '2026-11-17';
  const yesterday = '2026-11-16';

  const customers: Customer[] = [
    {
      id: 'c1',
      name: 'Ramesh Verma',
      phone: '9876543210',
      openingBalance: 0,
      currentBalance: 300,
      totalCreditGiven: 500,
      totalPaymentReceived: 200,
      overdueDays: 2,
      category: 'REGULAR',
      createdAt: `${yesterday}T10:00:00+05:30`,
    },
  ];

  const suppliers: Supplier[] = [
    {
      id: 'sup1',
      name: 'Mahavir Traders',
      phone: '9988776655',
      openingBalance: 0,
      currentBalance: 1000,
      totalPurchases: 2000,
      totalPaid: 1000,
      createdAt: `${yesterday}T10:00:00+05:30`,
    },
  ];

  const sales: SaleRecord[] = [
    {
      id: 's1',
      invoiceNo: 'INV-101',
      date: `${today}T09:15:00+05:30`,
      amount: 450,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      status: 'COMPLETED',
      createdAt: `${today}T09:15:00+05:30`,
    },
    {
      id: 's2',
      invoiceNo: 'INV-102',
      date: `${today}T10:30:00+05:30`,
      customerId: 'c1',
      customerName: 'Ramesh Verma',
      amount: 300,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      status: 'COMPLETED',
      createdAt: `${today}T10:30:00+05:30`,
    },
    {
      id: 's3',
      invoiceNo: 'INV-103',
      date: `${today}T11:00:00+05:30`,
      amount: 999,
      paymentMethod: 'UPI',
      items: [],
      isCredit: false,
      status: 'CANCELLED',
      createdAt: `${today}T11:00:00+05:30`,
    },
    {
      id: 's-old',
      invoiceNo: 'INV-099',
      date: `${yesterday}T18:00:00+05:30`,
      amount: 1200,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      status: 'COMPLETED',
      createdAt: `${yesterday}T18:00:00+05:30`,
    },
  ];

  const customerTransactions: CustomerTransaction[] = [
    {
      id: 'ct1',
      customerId: 'c1',
      type: 'PAYMENT',
      amount: 200,
      date: `${today}T11:15:00+05:30`,
      description: 'Paid UPI',
      paymentMethod: 'UPI',
      status: 'COMPLETED',
      createdAt: `${today}T11:15:00+05:30`,
    },
    {
      id: 'ct2',
      customerId: 'c1',
      type: 'RETURN',
      amount: 50,
      date: `${today}T12:00:00+05:30`,
      description: 'Returned damaged biscuit pack',
      status: 'COMPLETED',
      createdAt: `${today}T12:00:00+05:30`,
    },
    {
      id: 'ct-cancelled',
      customerId: 'c1',
      type: 'PAYMENT',
      amount: 500,
      date: `${today}T12:10:00+05:30`,
      description: 'Cancelled entry',
      status: 'CANCELLED',
      createdAt: `${today}T12:10:00+05:30`,
    },
  ];

  const supplierTransactions: SupplierTransaction[] = [
    {
      id: 'st1',
      supplierId: 'sup1',
      type: 'PURCHASE',
      amount: 2000,
      paidAmount: 600,
      paymentStatus: 'PARTIAL',
      paymentMethod: 'CASH',
      invoiceNo: 'BLJ-1',
      description: 'Atta bags',
      date: `${today}T12:30:00+05:30`,
      status: 'COMPLETED',
      createdAt: `${today}T12:30:00+05:30`,
    },
    {
      id: 'st2',
      supplierId: 'sup1',
      type: 'PAYMENT',
      amount: 400,
      paymentStatus: 'PAID',
      paymentMethod: 'UPI',
      description: 'Old balance cleared',
      date: `${today}T13:00:00+05:30`,
      status: 'COMPLETED',
      createdAt: `${today}T13:00:00+05:30`,
    },
  ];

  const expenses: ExpenseRecord[] = [
    {
      id: 'e1',
      title: 'Tea & Snacks',
      category: 'SHOP',
      amount: 60,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      date: `${today}T13:15:00+05:30`,
      createdAt: `${today}T13:15:00+05:30`,
    },
    {
      id: 'e2',
      title: 'Owner Home Cash',
      category: 'PERSONAL_DRAWING',
      amount: 300,
      isPersonalWithdrawal: true,
      paymentMethod: 'CASH',
      date: `${today}T14:00:00+05:30`,
      createdAt: `${today}T14:00:00+05:30`,
    },
  ];

  const cashbookEntries: CashbookEntry[] = [
    {
      id: 'cb-prev',
      type: 'IN',
      category: 'Opening',
      description: 'Previous day closing',
      amount: 1000,
      paymentMode: 'CASH',
      refType: 'OPENING',
      date: `${yesterday}T08:00:00+05:30`,
      createdAt: `${yesterday}T08:00:00+05:30`,
    },
    {
      id: 'cb-sale',
      type: 'IN',
      category: 'Sales',
      description: 'Bill #INV-101',
      amount: 450,
      paymentMode: 'CASH',
      refType: 'SALE',
      date: `${today}T09:15:00+05:30`,
      createdAt: `${today}T09:15:00+05:30`,
    },
    {
      id: 'cb-manual',
      type: 'IN',
      category: 'Cash Top-up',
      description: 'Small change added to drawer',
      amount: 500,
      paymentMode: 'CASH',
      refType: 'OWNER_CONTRIBUTION',
      date: `${today}T14:15:00+05:30`,
      createdAt: `${today}T14:15:00+05:30`,
    },
    {
      id: 'cb-exp',
      type: 'OUT',
      category: 'Expense',
      description: 'Tea & Snacks',
      amount: 60,
      paymentMode: 'CASH',
      refType: 'EXPENSE',
      date: `${today}T13:15:00+05:30`,
      createdAt: `${today}T13:15:00+05:30`,
    },
  ];

  const stockAdjustments: StockAdjustmentRecord[] = [
    {
      id: 'sa-sale',
      productId: 'p1',
      productName: 'Sugar',
      unit: 'kg',
      type: 'REDUCE',
      quantityChange: 2,
      previousStock: 20,
      newStock: 18,
      reason: 'Sale #INV-101',
      date: `${today}T09:15:00+05:30`,
      source: 'SALE',
      createdAt: `${today}T09:15:00+05:30`,
    },
    {
      id: 'sa-manual',
      productId: 'p2',
      productName: 'Basmati Rice',
      unit: 'kg',
      type: 'ADD',
      quantityChange: 5,
      previousStock: 10,
      newStock: 15,
      reason: 'Shelf recount',
      date: `${today}T14:30:00+05:30`,
      source: 'MANUAL',
      createdAt: `${today}T14:30:00+05:30`,
    },
  ];

  const summary = calculateTodayActivitySummary({
    dateKey: today,
    sales,
    customerTransactions,
    supplierTransactions,
    expenses,
    cashbookEntries,
    stockAdjustments,
    customers,
    suppliers,
  });

  assert.equal(summary.salesAmount, 750);
  assert.equal(summary.billsCount, 2);
  assert.equal(summary.cashSales, 450);
  assert.equal(summary.creditSales, 300);
  assert.equal(summary.collectionsAmount, 200);
  assert.equal(summary.collectionsCount, 1);
  assert.equal(summary.returnsAmount, 50);
  assert.equal(summary.returnsCount, 1);
  assert.equal(summary.purchasesAmount, 2000);
  assert.equal(summary.purchasesCount, 1);
  assert.equal(summary.supplierPaidAmount, 1000); // 600 upfront + 400 payment
  assert.equal(summary.supplierPaidCount, 2);
  assert.equal(summary.operatingExpensesAmount, 60);
  assert.equal(summary.operatingExpensesCount, 1);
  assert.equal(summary.personalDrawingsAmount, 300);
  assert.equal(summary.personalDrawingsCount, 1);
  assert.equal(summary.cashInToday, 950);
  assert.equal(summary.cashOutToday, 60);
  assert.equal(summary.netCashToday, 890);
  assert.equal(summary.expectedCashInDrawer, 1890);
  assert.equal(summary.stockUpdatesCount, 2);
  assert.equal(summary.manualStockUpdatesCount, 1);
  assert.equal(summary.totalActivitiesCount, 10);
  assert.equal(summary.activities[0].id, 'today-stk-sa-manual');
});
