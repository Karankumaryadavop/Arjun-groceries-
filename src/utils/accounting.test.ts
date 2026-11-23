import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatINR,
  calculateCashbookSummary,
  calculateProfitAndLoss,
  calculateCustomerAging,
  calculateWorkingCapital,
  validateSaleInput,
  validateCustomerTransaction,
  getOldestUnpaidCustomer,
  calculateDetailedCashFlow,
  calculate7DaySalesTrend,
  calculateCustomerLedgerWithRunningBalance,
  calculateSupplierLedgerWithRunningBalance,
  calculateTodaySalesSnapshot,
  getCustomersWithDuePaymentsOlderThanDays,
  buildPurchaseOrderDraftItems,
  calculateCategoryProfitMargins,
  calculate30DaySalesVsExpenses,
  validateProductForm,
  hasProductTransactionHistory,
  getApproachingReorderProducts,
  calculateDailyClosingReport,
  calculateInventoryValuation,
  calculateDailySalesTargetProgress,
  advanceRecurringDueDate,
  getDueRecurringExpenses,
  calculateMonthlyCustomerStatement,
  filterStockMovements,
} from './accounting';
import {
  formatSaleReceiptWhatsAppText,
  buildWhatsAppShareUrl,
  normalizeIndianPhoneForWhatsApp,
} from './whatsappReceipt';
import {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  Product,
  RecurringExpense,
  SaleRecord,
  StoreProfile,
  Supplier,
  SupplierTransaction,
  StockAdjustmentRecord,
} from '../types';

test('formatINR formats positive, negative and zero amounts correctly in Indian numbering', () => {
  assert.equal(formatINR(0), '₹0');
  assert.equal(formatINR(1500), '₹1,500');
  assert.equal(formatINR(125000), '₹1,25,000');
  assert.equal(formatINR(-4500), '- ₹4,500');
});

test('calculateCashbookSummary enforces Closing Cash = Opening + Inflows - Outflows', () => {
  const openingCash = 5000;
  const entries: CashbookEntry[] = [
    {
      id: 'cb-1',
      date: '2026-11-09',
      type: 'IN',
      category: 'CASH_SALE',
      description: 'Morning counter sales',
      amount: 4200,
      paymentMode: 'CASH',
      refType: 'SALE',
      createdAt: '2026-11-09T08:00:00Z',
    },
    {
      id: 'cb-2',
      date: '2026-11-09',
      type: 'IN',
      category: 'CUSTOMER_PAYMENT',
      description: 'Ramesh Bhai Udhar Payment',
      amount: 1500,
      paymentMode: 'CASH',
      refType: 'CUSTOMER_PAYMENT',
      createdAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 'cb-3',
      date: '2026-11-09',
      type: 'OUT',
      category: 'EXPENSE',
      description: 'Shop tea & snacks',
      amount: 180,
      paymentMode: 'CASH',
      refType: 'EXPENSE',
      createdAt: '2026-11-09T11:00:00Z',
    },
    {
      id: 'cb-4',
      date: '2026-11-09',
      type: 'OUT',
      category: 'SUPPLIER_PAYMENT',
      description: 'Payment to Balaji Wholesale',
      amount: 3000,
      paymentMode: 'CASH',
      refType: 'SUPPLIER_PAYMENT',
      createdAt: '2026-11-09T14:00:00Z',
    },
  ];

  const summary = calculateCashbookSummary(openingCash, entries);
  assert.equal(summary.openingCash, 5000);
  assert.equal(summary.totalInflows, 5700);
  assert.equal(summary.totalOutflows, 3180);
  assert.equal(summary.closingCash, 7520); // 5000 + 5700 - 3180 = 7520
});

test('calculateProfitAndLoss strictly excludes personal drawings from operating expenses', () => {
  const sales: SaleRecord[] = [
    {
      id: 's-1',
      invoiceNo: 'INV-101',
      date: '2026-11-09',
      amount: 10000,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-09T10:00:00Z',
    },
  ];

  const expenses: ExpenseRecord[] = [
    {
      id: 'e-1',
      title: 'Shop electricity bill',
      category: 'ELECTRICITY',
      amount: 1200,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      date: '2026-11-09',
      createdAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 'e-2',
      title: 'Shop helper daily wage',
      category: 'STAFF',
      amount: 500,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      date: '2026-11-09',
      createdAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 'e-3',
      title: 'Owner home vegetable purchase (Drawings)',
      category: 'PERSONAL_DRAWING',
      amount: 2000,
      isPersonalWithdrawal: true,
      paymentMethod: 'CASH',
      date: '2026-11-09',
      createdAt: '2026-11-09T10:00:00Z',
    },
  ];

  const productsMap = new Map<string, Product>();
  const pnl = calculateProfitAndLoss(sales, expenses, productsMap);

  assert.equal(pnl.totalRevenue, 10000);
  assert.equal(pnl.operatingExpenses, 1700); // 1200 + 500 (2000 drawings excluded)
  assert.equal(pnl.personalDrawings, 2000);
  assert.equal(pnl.cogs, 0); // Phase 6: no invented 85% fallback when item costs are missing
  assert.equal(pnl.uncostedRevenue, 10000);
  assert.equal(pnl.hasCompleteCogs, false);
  assert.equal(pnl.grossProfit, 10000); // 10000 - 0
  assert.equal(pnl.netOperatingProfit, 8300); // 10000 - 1700
});

test('calculateCustomerAging correctly distributes dues into 0-30, 31-60, 61-90, 91-180, 181+ buckets', () => {
  const refDate = '2026-11-09T12:00:00Z';
  const customers: Customer[] = [
    {
      id: 'c-1',
      name: 'Ramesh Kumar',
      phone: '9876543210',
      openingBalance: 0,
      currentBalance: 1200,
      totalCreditGiven: 1200,
      totalPaymentReceived: 0,
      overdueDays: 15, // 0-30
      category: 'REGULAR',
      createdAt: '2026-10-01',
    },
    {
      id: 'c-2',
      name: 'Suresh Sharma',
      phone: '9876543211',
      openingBalance: 0,
      currentBalance: 3500,
      totalCreditGiven: 3500,
      totalPaymentReceived: 0,
      overdueDays: 45, // 31-60
      category: 'OVERDUE',
      createdAt: '2026-09-01',
    },
    {
      id: 'c-3',
      name: 'Mahesh Patel',
      phone: '9876543212',
      openingBalance: 0,
      currentBalance: 8000,
      totalCreditGiven: 8000,
      totalPaymentReceived: 0,
      overdueDays: 120, // 91-180
      category: 'HIGH_CREDIT',
      createdAt: '2026-07-01',
    },
  ];

  const aging = calculateCustomerAging(customers, refDate);
  assert.equal(aging.totalReceivables, 12700);
  assert.equal(aging.totalCustomersWithDues, 3);
  assert.equal(aging.bucket0to30, 1200);
  assert.equal(aging.bucket31to60, 3500);
  assert.equal(aging.bucket61to90, 0);
  assert.equal(aging.bucket91to180, 8000);
  assert.equal(aging.topOverdueCustomers.length, 3);
  assert.equal(aging.topOverdueCustomers[0].name, 'Mahesh Patel'); // Highest balance first
});

test('calculateWorkingCapital determines solvency status accurately', () => {
  const healthHealthy = calculateWorkingCapital(20000, 35000, 85000, 40000);
  // Assets = 20k + 35k + 85k = 140k. Liabilities = 40k. Working Capital = 100k.
  assert.equal(healthHealthy.currentAssets, 140000);
  assert.equal(healthHealthy.workingCapital, 100000);
  assert.equal(healthHealthy.solvencyStatus, 'HEALTHY');

  const healthCritical = calculateWorkingCapital(2000, 5000, 10000, 50000);
  assert.equal(healthCritical.workingCapital, -33000);
  assert.equal(healthCritical.solvencyStatus, 'CRITICAL');
});

test('validateSaleInput rejects zero/negative amounts and unselected customer on credit', () => {
  assert.equal(validateSaleInput({ amount: 0, paymentMethod: 'CASH' }).valid, false);
  assert.equal(validateSaleInput({ amount: 500, paymentMethod: 'CREDIT' }).valid, false);
  assert.equal(validateSaleInput({ amount: 500, paymentMethod: 'CREDIT', customerId: 'c-1' }).valid, true);
  assert.equal(validateSaleInput({ amount: 500, paymentMethod: 'CASH' }).valid, true);
});

test('getOldestUnpaidCustomer finds customer with highest overdue days among accounts with dues', () => {
  const custs: Customer[] = [
    {
      id: 'c-1',
      name: 'Ramesh',
      phone: '111',
      openingBalance: 0,
      currentBalance: 500,
      totalCreditGiven: 500,
      totalPaymentReceived: 0,
      overdueDays: 12,
      category: 'REGULAR',
      createdAt: '2026-10-01',
    },
    {
      id: 'c-2',
      name: 'Mohammad Ansari',
      phone: '222',
      openingBalance: 0,
      currentBalance: 1850,
      totalCreditGiven: 1850,
      totalPaymentReceived: 0,
      overdueDays: 101, // Oldest!
      category: 'OVERDUE',
      createdAt: '2026-06-01',
    },
    {
      id: 'c-3',
      name: 'Cleared Person',
      phone: '333',
      openingBalance: 0,
      currentBalance: 0, // No dues, should be ignored
      totalCreditGiven: 1000,
      totalPaymentReceived: 1000,
      overdueDays: 200,
      category: 'CLEARED',
      createdAt: '2026-01-01',
    },
  ];

  const oldest = getOldestUnpaidCustomer(custs);
  assert.equal(oldest?.name, 'Mohammad Ansari');
  assert.equal(oldest?.currentBalance, 1850);
});

test('calculateDetailedCashFlow accurately isolates cash movements', () => {
  const entries: CashbookEntry[] = [
    {
      id: 'cb-1',
      date: '2026-11-09',
      type: 'IN',
      category: 'SALE',
      description: 'Cash sale',
      amount: 1000,
      paymentMode: 'CASH',
      refType: 'SALE',
      createdAt: '2026-11-09T08:00:00Z',
    },
    {
      id: 'cb-2',
      date: '2026-11-09',
      type: 'OUT',
      category: 'DRAWING',
      description: 'Owner withdrawal',
      amount: 400,
      paymentMode: 'CASH',
      refType: 'DRAWING',
      createdAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 'cb-3',
      date: '2026-11-09',
      type: 'OUT',
      category: 'EXPENSE',
      description: 'Shop tea',
      amount: 50,
      paymentMode: 'CASH',
      refType: 'EXPENSE',
      createdAt: '2026-11-09T11:00:00Z',
    },
  ];

  const cf = calculateDetailedCashFlow(2000, entries);
  assert.equal(cf.openingCash, 2000);
  assert.equal(cf.cashReceived, 1000);
  assert.equal(cf.cashWithdrawals, 400);
  assert.equal(cf.dailyExpenses, 50);
  assert.equal(cf.closingCash, 2550); // 2000 + 1000 - 450 = 2550
});

test('calculate7DaySalesTrend computes daily breakdown, totals, and growth KPIs correctly', () => {
  const sampleSales: SaleRecord[] = [
    // Prior week sale (2026-11-02)
    {
      id: 's-prior',
      invoiceNo: '100',
      date: '2026-11-02T10:00:00Z',
      amount: 2000,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-02T10:00:00Z',
    },
    // Current 7-day window (2026-11-06 to 2026-11-12)
    {
      id: 's-1',
      invoiceNo: '101',
      date: '2026-11-10T09:00:00Z',
      amount: 1500,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-10T09:00:00Z',
    },
    {
      id: 's-2',
      invoiceNo: '102',
      date: '2026-11-10T14:00:00Z',
      amount: 500,
      paymentMethod: 'UPI',
      items: [],
      isCredit: false,
      createdAt: '2026-11-10T14:00:00Z',
    },
    {
      id: 's-3',
      invoiceNo: '103',
      date: '2026-11-12T11:00:00Z',
      amount: 3000,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      createdAt: '2026-11-12T11:00:00Z',
    },
  ];

  const result = calculate7DaySalesTrend(sampleSales, '2026-11-12');
  assert.equal(result.trendData.length, 7);
  assert.equal(result.sevenDayTotal, 5000); // 1500 + 500 + 3000
  assert.equal(result.priorSevenDayTotal, 2000);
  assert.equal(result.growthPct, 150); // ((5000 - 2000) / 2000) * 100 = 150%
  assert.equal(result.totalBills, 3);
  assert.equal(result.peakDay.dateKey, '2026-11-12');
  assert.equal(result.peakDay.totalSales, 3000);

  // Check 2026-11-10 day
  const day10 = result.trendData.find((d) => d.dateKey === '2026-11-10');
  assert.ok(day10);
  assert.equal(day10.totalSales, 2000);
  assert.equal(day10.cashSales, 1500);
  assert.equal(day10.upiSales, 500);
  assert.equal(day10.billsCount, 2);
  assert.equal(day10.averageBillValue, 1000);
});

test('calculateCustomerLedgerWithRunningBalance accurately matches prompt example and handles cancellations', () => {
  const customer: Customer = {
    id: 'c-test-1',
    name: 'Suresh Kirana Customer',
    phone: '9876543210',
    openingBalance: 200,
    currentBalance: 0,
    totalCreditGiven: 950,
    totalPaymentReceived: 950,
    overdueDays: 0,
    category: 'REGULAR',
    createdAt: '2026-11-01T08:00:00Z',
  };

  // From prompt example:
  // Opening: 200 (Balance = 200)
  // Credit sale: 500 (Balance = 700)
  // Payment received: 300 (Balance = 400)
  // Credit sale: 250 (Balance = 650)
  // Payment received: 650 (Balance = 0)
  // PLUS a cancelled payment that must not affect running balance:
  const transactions: CustomerTransaction[] = [
    {
      id: 'tx-1',
      customerId: 'c-test-1',
      type: 'CREDIT',
      amount: 500,
      date: '2026-11-02T10:00:00Z',
      description: 'Credit sale - Ration',
      invoiceNo: 'BILL-1',
      createdAt: '2026-11-02T10:00:00Z',
    },
    {
      id: 'tx-2',
      customerId: 'c-test-1',
      type: 'PAYMENT',
      amount: 300,
      date: '2026-11-03T11:00:00Z',
      description: 'Cash payment',
      paymentMethod: 'CASH',
      createdAt: '2026-11-03T11:00:00Z',
    },
    {
      id: 'tx-3',
      customerId: 'c-test-1',
      type: 'PAYMENT',
      amount: 1000,
      date: '2026-11-03T12:00:00Z',
      description: 'Bounced cheque payment',
      status: 'CANCELLED',
      cancelReason: 'Cheque returned',
      createdAt: '2026-11-03T12:00:00Z',
    },
    {
      id: 'tx-4',
      customerId: 'c-test-1',
      type: 'CREDIT',
      amount: 250,
      date: '2026-11-04T15:00:00Z',
      description: 'Oil & Sugar',
      invoiceNo: 'BILL-2',
      createdAt: '2026-11-04T15:00:00Z',
    },
    {
      id: 'tx-5',
      customerId: 'c-test-1',
      type: 'PAYMENT',
      amount: 650,
      date: '2026-11-05T18:00:00Z',
      description: 'UPI Full Settlement',
      paymentMethod: 'UPI',
      createdAt: '2026-11-05T18:00:00Z',
    },
  ];

  const ledger = calculateCustomerLedgerWithRunningBalance(customer, transactions);

  // Exactly 6 entries: 1 Opening + 5 Transactions
  assert.equal(ledger.entries.length, 6);

  // Row 0: Opening balance
  assert.equal(ledger.entries[0].type, 'OPENING');
  assert.equal(ledger.entries[0].debitAmount, 200);
  assert.equal(ledger.entries[0].runningBalance, 200);

  // Row 1: Credit sale 500 -> 700
  assert.equal(ledger.entries[1].debitAmount, 500);
  assert.equal(ledger.entries[1].runningBalance, 700);

  // Row 2: Payment received 300 -> 400
  assert.equal(ledger.entries[2].creditAmount, 300);
  assert.equal(ledger.entries[2].runningBalance, 400);

  // Row 3: Cancelled transaction -> runningBalance remains 400
  assert.equal(ledger.entries[3].isCancelled, true);
  assert.equal(ledger.entries[3].runningBalance, 400);

  // Row 4: Credit sale 250 -> 650
  assert.equal(ledger.entries[4].debitAmount, 250);
  assert.equal(ledger.entries[4].runningBalance, 650);

  // Row 5: Payment 650 -> 0 (Cleared)
  assert.equal(ledger.entries[5].creditAmount, 650);
  assert.equal(ledger.entries[5].runningBalance, 0);

  assert.equal(ledger.closingBalance, 0);
  assert.equal(ledger.accountStatus, 'CLEARED');
  assert.equal(ledger.isAdvance, false);
});

test('calculateSupplierLedgerWithRunningBalance accurately tracks purchases, payments, returns and advance', () => {
  const supplier: Supplier = {
    id: 'sup-test-1',
    name: 'Balaji Wholesale Traders',
    phone: '9820098200',
    openingBalance: 1000, // store owes 1000
    currentBalance: 0,
    totalPurchases: 6000,
    totalPaid: 7500,
    createdAt: '2026-11-01T08:00:00Z',
  };

  const transactions: SupplierTransaction[] = [
    {
      id: 'stx-1',
      supplierId: 'sup-test-1',
      type: 'PURCHASE',
      amount: 5000,
      paymentStatus: 'UNPAID',
      date: '2026-11-02T10:00:00Z',
      invoiceNo: 'INV-101',
      description: 'Atta & Sugar bags',
      createdAt: '2026-11-02T10:00:00Z',
    },
    {
      id: 'stx-2',
      supplierId: 'sup-test-1',
      type: 'PAYMENT',
      amount: 4000,
      paymentStatus: 'PAID',
      paymentMethod: 'BANK',
      date: '2026-11-03T11:00:00Z',
      description: 'NEFT Payment',
      createdAt: '2026-11-03T11:00:00Z',
    },
    {
      id: 'stx-3',
      supplierId: 'sup-test-1',
      type: 'RETURN',
      amount: 500,
      paymentStatus: 'PAID',
      date: '2026-11-04T12:00:00Z',
      description: 'Damaged Atta bags returned',
      createdAt: '2026-11-04T12:00:00Z',
    },
    {
      id: 'stx-4',
      supplierId: 'sup-test-1',
      type: 'PAYMENT',
      amount: 2000, // 1500 due - 2000 paid = 500 Advance!
      paymentStatus: 'PAID',
      paymentMethod: 'UPI',
      date: '2026-11-05T14:00:00Z',
      description: 'Advance payment for next order',
      createdAt: '2026-11-05T14:00:00Z',
    },
  ];

  const ledger = calculateSupplierLedgerWithRunningBalance(supplier, transactions);

  // 1 Opening + 4 Transactions = 5
  assert.equal(ledger.entries.length, 5);

  // Row 0: Opening = 1000
  assert.equal(ledger.entries[0].runningBalance, 1000);

  // Row 1: Purchase 5000 -> 6000
  assert.equal(ledger.entries[1].purchaseAmount, 5000);
  assert.equal(ledger.entries[1].runningBalance, 6000);

  // Row 2: Payment 4000 -> 2000
  assert.equal(ledger.entries[2].paymentAmount, 4000);
  assert.equal(ledger.entries[2].runningBalance, 2000);

  // Row 3: Return 500 -> 1500
  assert.equal(ledger.entries[3].paymentAmount, 500);
  assert.equal(ledger.entries[3].runningBalance, 1500);

  // Row 4: Payment 2000 -> -500 (Advance)
  assert.equal(ledger.entries[4].paymentAmount, 2000);
  assert.equal(ledger.entries[4].runningBalance, -500);

  assert.equal(ledger.closingBalance, -500);
  assert.equal(ledger.isAdvance, true);
  assert.equal(ledger.advanceAmount, 500);
  assert.equal(ledger.accountStatus, 'ADVANCE');
});

test('calculateTodaySalesSnapshot accurately calculates Total Sales Today, Cash Received, and Pending Udhar', () => {
  const sales: SaleRecord[] = [
    {
      id: 's1',
      invoiceNo: 'B-101',
      date: '2026-11-13T09:00:00Z',
      amount: 500,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-13T09:00:00Z',
    },
    {
      id: 's2',
      invoiceNo: 'B-102',
      date: '2026-11-13T11:30:00Z',
      amount: 350,
      paymentMethod: 'UPI',
      items: [],
      isCredit: false,
      createdAt: '2026-11-13T11:30:00Z',
    },
    {
      id: 's3',
      invoiceNo: 'B-103',
      date: '2026-11-13T12:15:00Z',
      customerId: 'c1',
      customerName: 'Ramesh',
      amount: 600,
      paymentMethod: 'CREDIT',
      items: [],
      isCredit: true,
      createdAt: '2026-11-13T12:15:00Z',
    },
    {
      id: 's-old',
      invoiceNo: 'B-099',
      date: '2026-11-12T18:00:00Z',
      amount: 1200,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-12T18:00:00Z',
    },
  ];

  const custTx: CustomerTransaction[] = [
    {
      id: 'tx-pay-today',
      customerId: 'c2',
      type: 'PAYMENT',
      amount: 400,
      date: '2026-11-13T10:00:00Z',
      description: 'Old udhar jama',
      createdAt: '2026-11-13T10:00:00Z',
    },
  ];

  const customers: Customer[] = [
    {
      id: 'c1',
      name: 'Ramesh',
      phone: '9876543210',
      openingBalance: 0,
      currentBalance: 1600,
      totalCreditGiven: 1600,
      totalPaymentReceived: 0,
      overdueDays: 2,
      category: 'REGULAR',
      createdAt: '2026-11-01',
    },
  ];

  const snap = calculateTodaySalesSnapshot(sales, custTx, customers, '2026-11-13T15:00:00Z');
  assert.equal(snap.totalSalesToday, 1450);
  assert.equal(snap.cashSalesToday, 500);
  assert.equal(snap.upiSalesToday, 350);
  assert.equal(snap.udharCollectionsToday, 400);
  assert.equal(snap.cashReceivedToday, 1250); // 500 cash + 350 UPI + 400 collection
  assert.equal(snap.pendingUdharToday, 600);
  assert.equal(snap.totalPendingUdharOverall, 1600);
  assert.equal(snap.todayBillsCount, 3);
});

test('getCustomersWithDuePaymentsOlderThanDays detects FIFO unpaid entries older than 7 days', () => {
  const customers: Customer[] = [
    {
      id: 'c-old',
      name: 'Sunita Sharma',
      phone: '9820198765',
      openingBalance: 0,
      currentBalance: 1500,
      totalCreditGiven: 2000,
      totalPaymentReceived: 500,
      lastTransactionDate: '2026-11-10T10:00:00Z', // recent tx added, BUT older entry still unpaid!
      overdueDays: 3,
      category: 'REGULAR',
      createdAt: '2026-10-01',
    },
    {
      id: 'c-recent',
      name: 'Ramesh Patel',
      phone: '9876543210',
      openingBalance: 0,
      currentBalance: 800,
      totalCreditGiven: 800,
      totalPaymentReceived: 0,
      lastTransactionDate: '2026-11-10T10:00:00Z',
      overdueDays: 3,
      category: 'REGULAR',
      createdAt: '2026-11-01',
    },
    {
      id: 'c-cleared',
      name: 'Dr Anita',
      phone: '9819001122',
      openingBalance: 0,
      currentBalance: 0,
      totalCreditGiven: 2000,
      totalPaymentReceived: 2000,
      lastTransactionDate: '2026-10-01T10:00:00Z',
      overdueDays: 40,
      category: 'CLEARED',
      createdAt: '2026-09-01',
    },
  ];

  const tx: CustomerTransaction[] = [
    {
      id: 't1',
      customerId: 'c-old',
      type: 'CREDIT',
      amount: 1200,
      date: '2026-11-01T10:00:00Z', // 12 days old on Nov 13
      description: 'Old ration',
      createdAt: '2026-11-01T10:00:00Z',
    },
    {
      id: 't2',
      customerId: 'c-old',
      type: 'PAYMENT',
      amount: 500,
      date: '2026-11-03T10:00:00Z', // Only partially cleared t1 (700 still unpaid from Nov 1!)
      description: 'Part paid',
      createdAt: '2026-11-03T10:00:00Z',
    },
    {
      id: 't3',
      customerId: 'c-old',
      type: 'CREDIT',
      amount: 800,
      date: '2026-11-10T10:00:00Z',
      description: 'Recent oil',
      createdAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 't4',
      customerId: 'c-recent',
      type: 'CREDIT',
      amount: 800,
      date: '2026-11-10T10:00:00Z', // 3 days old -> should NOT trigger >7 days
      description: 'Recent ration',
      createdAt: '2026-11-10T10:00:00Z',
    },
  ];

  const alerts = getCustomersWithDuePaymentsOlderThanDays(customers, tx, 7, '2026-11-13T12:00:00Z');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].customer.id, 'c-old');
  assert.equal(alerts[0].daysPending, 12);
  assert.equal(alerts[0].amountDue, 1500);
});

test('buildPurchaseOrderDraftItems selects items at or below minStockAlert and calculates restock quantities', () => {
  const products: Product[] = [
    {
      id: 'p1',
      name: 'Toor Dal',
      category: 'Pulses',
      purchasePrice: 140,
      sellingPrice: 170,
      stockQty: 4,
      unit: 'KG',
      minStockAlert: 10,
      updatedAt: '2026-11-13',
    },
    {
      id: 'p2',
      name: 'Sugar',
      category: 'Grains',
      purchasePrice: 38,
      sellingPrice: 44,
      stockQty: 50,
      unit: 'KG',
      minStockAlert: 20,
      updatedAt: '2026-11-13',
    },
    {
      id: 'p3',
      name: 'Maggi Pack',
      category: 'Snacks',
      purchasePrice: 11,
      sellingPrice: 14,
      stockQty: 0,
      unit: 'PCS',
      minStockAlert: 10,
      updatedAt: '2026-11-13',
    },
  ];

  const draft = buildPurchaseOrderDraftItems(products);
  assert.equal(draft.length, 2);
  assert.equal(draft[0].productId, 'p3'); // Out of stock prioritized first
  assert.equal(draft[0].isOutOfStock, true);
  assert.equal(draft[0].suggestedQty, 20);
  assert.equal(draft[1].productId, 'p1');
  assert.equal(draft[1].suggestedQty, 16); // target 20 - current 4
  assert.equal(draft[1].estimatedTotal, 16 * 140);
});

test('calculateCategoryProfitMargins ranks highest and lowest profit margin categories accurately', () => {
  const products: Product[] = [
    {
      id: 'p1',
      name: 'Haldi',
      category: 'Spices',
      purchasePrice: 30,
      sellingPrice: 50, // 40% margin
      stockQty: 10,
      unit: 'PCS',
      minStockAlert: 5,
      updatedAt: '2026-11-13',
    },
    {
      id: 'p2',
      name: 'Ghee',
      category: 'Oils & Ghee',
      purchasePrice: 540,
      sellingPrice: 600, // 10% margin
      stockQty: 10,
      unit: 'LITRE',
      minStockAlert: 3,
      updatedAt: '2026-11-13',
    },
  ];

  const heatmap = calculateCategoryProfitMargins(products);
  assert.equal(heatmap.length, 2);
  assert.equal(heatmap[0].category, 'Spices');
  assert.equal(heatmap[0].marginPct, 40);
  assert.equal(heatmap[0].tier, 'HIGH');
  assert.equal(heatmap[0].heatScore, 100);
  assert.equal(heatmap[1].category, 'Oils & Ghee');
  assert.equal(heatmap[1].marginPct, 10);
  assert.equal(heatmap[1].tier, 'LOW');
  assert.equal(heatmap[1].heatScore, 0);
});

test('calculate30DaySalesVsExpenses builds 30-day window and excludes owner personal drawings', () => {
  const sales: SaleRecord[] = [
    {
      id: 's1',
      invoiceNo: 'B1',
      date: '2026-11-13T10:00:00Z',
      amount: 2500,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-13T10:00:00Z',
    },
    {
      id: 's-outside',
      invoiceNo: 'B-OLD',
      date: '2026-09-01T10:00:00Z',
      amount: 9999,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-09-01T10:00:00Z',
    },
  ];

  const expenses: ExpenseRecord[] = [
    {
      id: 'e1',
      title: 'Electricity',
      category: 'ELECTRICITY',
      amount: 800,
      isPersonalWithdrawal: false,
      paymentMethod: 'UPI',
      date: '2026-11-13',
      createdAt: '2026-11-13T11:00:00Z',
    },
    {
      id: 'e-drawing',
      title: 'Home drawing',
      category: 'PERSONAL_DRAWING',
      amount: 5000,
      isPersonalWithdrawal: true,
      paymentMethod: 'CASH',
      date: '2026-11-13',
      createdAt: '2026-11-13T12:00:00Z',
    },
  ];

  const result = calculate30DaySalesVsExpenses(sales, expenses, '2026-11-13T15:00:00Z');
  assert.equal(result.points.length, 30);
  assert.equal(result.totalSales, 2500);
  assert.equal(result.totalExpenses, 800);
  assert.equal(result.netDifference, 1700);
  assert.equal(result.points[29].dateKey, '2026-11-13');
  assert.equal(result.points[29].sales, 2500);
  assert.equal(result.points[29].expenses, 800);
});

test('WhatsApp sales receipt helpers format Indian phone, itemized text, and URL cleanly', () => {
  const profile: StoreProfile = {
    id: 'st1',
    storeName: 'Mahalaxmi Kirana',
    ownerName: 'Gupta Ji',
    phone: '9820123456',
    upiId: 'mahalaxmi@okaxis',
    address: 'Station Road',
    currencySymbol: '₹',
    isPinEnabled: false,
  };
  const sale: SaleRecord = {
    id: 's1',
    invoiceNo: 'BILL-1010',
    date: '2026-11-13T10:30:00Z',
    customerName: 'Ramesh',
    amount: 453,
    paymentMethod: 'UPI',
    items: [
      { productName: 'Aashirvaad Atta', quantity: 1, unit: 'bag', rate: 425, total: 425 },
      { productName: 'Tata Salt', quantity: 1, unit: 'pkt', rate: 28, total: 28 },
    ],
    isCredit: false,
    createdAt: '2026-11-13T10:30:00Z',
  };

  assert.equal(normalizeIndianPhoneForWhatsApp('09876543210'), '919876543210');
  assert.equal(normalizeIndianPhoneForWhatsApp('+91 98765-43210'), '919876543210');

  const text = formatSaleReceiptWhatsAppText(sale, profile);
  assert.ok(text.includes('Mahalaxmi Kirana'));
  assert.ok(text.includes('#BILL-1010'));
  assert.ok(text.includes('Aashirvaad Atta'));
  assert.ok(text.includes('₹453'));

  const url = buildWhatsAppShareUrl('9876543210', text);
  assert.ok(url.startsWith('https://api.whatsapp.com/send?phone=919876543210&text='));
});

test('validateProductForm rejects empty name, empty unit, and negative prices or stock', () => {
  const invalid = validateProductForm({
    name: '  ',
    purchasePrice: -10,
    sellingPrice: 0,
    mrp: -5,
    stockQty: -1,
    minStockAlert: -2,
    unit: '',
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 7);

  const valid = validateProductForm({
    name: 'Toor Dal',
    purchasePrice: 140,
    sellingPrice: 170,
    mrp: 185,
    stockQty: 15,
    minStockAlert: 10,
    unit: 'kg',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
});

test('hasProductTransactionHistory detects sales/purchase history and excludes archived products from valuation', () => {
  const products: Product[] = [
    {
      id: 'p-active',
      name: 'Basmati Rice',
      category: 'Grains',
      purchasePrice: 90,
      sellingPrice: 115,
      stockQty: 10,
      unit: 'kg',
      minStockAlert: 5,
      updatedAt: '2026-11-13',
    },
    {
      id: 'p-archived',
      name: 'Old Brand Tea',
      category: 'Beverages',
      purchasePrice: 100,
      sellingPrice: 120,
      stockQty: 5,
      unit: 'pkt',
      minStockAlert: 10,
      isArchived: true,
      updatedAt: '2026-11-13',
    },
  ];

  const sales: SaleRecord[] = [
    {
      id: 's1',
      invoiceNo: 'BILL-1',
      date: '2026-11-13',
      amount: 230,
      paymentMethod: 'CASH',
      items: [{ productId: 'p-active', productName: 'Basmati Rice', quantity: 2, unit: 'kg', rate: 115, total: 230 }],
      isCredit: false,
      createdAt: '2026-11-13T10:00:00Z',
    },
  ];

  assert.equal(hasProductTransactionHistory('p-active', 'Basmati Rice', sales, []), true);
  assert.equal(hasProductTransactionHistory('p-unused', 'New Candy', sales, []), false);

  const valuation = calculateInventoryValuation(products);
  assert.equal(valuation.totalItems, 1);
  assert.equal(valuation.totalCostValue, 900);
  assert.equal(valuation.lowStockItemsCount, 0);
});

test('getApproachingReorderProducts detects active items nearing minStockAlert without being below it', () => {
  const products: Product[] = [
    {
      id: 'p-approaching',
      name: 'Surf Excel',
      category: 'Cleaning',
      purchasePrice: 110,
      sellingPrice: 135,
      stockQty: 24, // threshold 20 -> ceiling 30 -> approaching!
      unit: 'pkt',
      minStockAlert: 20,
      updatedAt: '2026-11-13',
    },
    {
      id: 'p-already-low',
      name: 'Toor Dal',
      category: 'Pulses',
      purchasePrice: 145,
      sellingPrice: 170,
      stockQty: 4, // below 10 -> belongs in Low Stock, not Approaching
      unit: 'kg',
      minStockAlert: 10,
      updatedAt: '2026-11-13',
    },
    {
      id: 'p-healthy',
      name: 'Sugar',
      category: 'Grains',
      purchasePrice: 39,
      sellingPrice: 44,
      stockQty: 150,
      unit: 'kg',
      minStockAlert: 40,
      updatedAt: '2026-11-13',
    },
  ];

  const approaching = getApproachingReorderProducts(products);
  assert.equal(approaching.length, 1);
  assert.equal(approaching[0].product.id, 'p-approaching');
  assert.equal(approaching[0].bufferRemaining, 4);
  assert.equal(approaching[0].pctAboveThreshold, 20);
});

test('calculateDailyClosingReport aggregates daily sales, collections, expenses, and cash drawer position', () => {
  const report = calculateDailyClosingReport({
    dateKey: '2026-11-13',
    sales: [
      {
        id: 's1',
        invoiceNo: 'B1',
        date: '2026-11-13T09:00:00Z',
        amount: 1200,
        paymentMethod: 'CASH',
        items: [],
        isCredit: false,
        createdAt: '2026-11-13T09:00:00Z',
      },
      {
        id: 's2',
        invoiceNo: 'B2',
        date: '2026-11-13T11:00:00Z',
        amount: 800,
        paymentMethod: 'UPI',
        items: [],
        isCredit: false,
        createdAt: '2026-11-13T11:00:00Z',
      },
      {
        id: 's3',
        invoiceNo: 'B3',
        date: '2026-11-13T14:00:00Z',
        amount: 500,
        paymentMethod: 'CREDIT',
        items: [],
        isCredit: true,
        createdAt: '2026-11-13T14:00:00Z',
      },
    ],
    customerTransactions: [
      {
        id: 'ctx1',
        customerId: 'c1',
        type: 'PAYMENT',
        amount: 600,
        date: '2026-11-13',
        description: 'Khata payment',
        paymentMethod: 'CASH',
        createdAt: '2026-11-13T15:00:00Z',
      },
    ],
    expenses: [
      {
        id: 'e1',
        title: 'Chai & Helper',
        category: 'BREAKFAST',
        amount: 250,
        isPersonalWithdrawal: false,
        paymentMethod: 'CASH',
        date: '2026-11-13',
        createdAt: '2026-11-13T16:00:00Z',
      },
      {
        id: 'e2',
        title: 'Home Drawing',
        category: 'PERSONAL_DRAWING',
        amount: 1000,
        isPersonalWithdrawal: true,
        paymentMethod: 'CASH',
        date: '2026-11-13',
        createdAt: '2026-11-13T17:00:00Z',
      },
    ],
    supplierTransactions: [],
    cashbookEntries: [
      {
        id: 'cb0',
        date: '2026-11-12',
        type: 'IN',
        category: 'OPENING',
        description: 'Opening',
        amount: 5000,
        paymentMode: 'CASH',
        refType: 'OPENING',
        createdAt: '2026-11-12T08:00:00Z',
      },
      {
        id: 'cb1',
        date: '2026-11-13',
        type: 'IN',
        category: 'SALE',
        description: 'Cash sale + Jama',
        amount: 1800,
        paymentMode: 'CASH',
        refType: 'SALE',
        createdAt: '2026-11-13T15:00:00Z',
      },
      {
        id: 'cb2',
        date: '2026-11-13',
        type: 'OUT',
        category: 'EXPENSE',
        description: 'Chai',
        amount: 250,
        paymentMode: 'CASH',
        refType: 'EXPENSE',
        createdAt: '2026-11-13T16:00:00Z',
      },
    ],
    products: [],
  });

  assert.equal(report.totalSales, 2500);
  assert.equal(report.billsCount, 3);
  assert.equal(report.cashSales, 1200);
  assert.equal(report.upiSales, 800);
  assert.equal(report.creditSales, 500);
  assert.equal(report.udharCollections, 600);
  assert.equal(report.totalCollections, 2600); // 1200 + 800 + 600
  assert.equal(report.operatingExpenses, 250);
  assert.equal(report.personalDrawings, 1000);
  assert.equal(report.expectedCashInDrawer, 6550); // 5000 + 1800 - 250
});

test('Stage 4: calculateDailySalesTargetProgress computes remaining, progress %, and achievement state', () => {
  const sales: SaleRecord[] = [
    {
      id: 's-1',
      invoiceNo: 'B-1',
      date: '2026-11-14T09:00:00Z',
      amount: 3000,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-14T09:00:00Z',
    },
    {
      id: 's-2',
      invoiceNo: 'B-2',
      date: '2026-11-14T15:00:00Z',
      amount: 1500,
      paymentMethod: 'UPI',
      items: [],
      isCredit: false,
      createdAt: '2026-11-14T15:00:00Z',
    },
    {
      id: 's-yesterday',
      invoiceNo: 'B-0',
      date: '2026-11-13T20:00:00Z',
      amount: 9000,
      paymentMethod: 'CASH',
      items: [],
      isCredit: false,
      createdAt: '2026-11-13T20:00:00Z',
    },
  ];

  const partial = calculateDailySalesTargetProgress(sales, 6000, '2026-11-14');
  assert.equal(partial.todaySales, 4500);
  assert.equal(partial.remainingAmount, 1500);
  assert.equal(partial.progressPct, 75);
  assert.equal(partial.isAchieved, false);

  const exceeded = calculateDailySalesTargetProgress(sales, 4000, '2026-11-14');
  assert.equal(exceeded.remainingAmount, 0);
  assert.equal(exceeded.progressPct, 100);
  assert.equal(exceeded.isAchieved, true);

  const unset = calculateDailySalesTargetProgress(sales, 0, '2026-11-14');
  assert.equal(unset.progressPct, 0);
  assert.equal(unset.isAchieved, false);
});

test('Stage 4: advanceRecurringDueDate and getDueRecurringExpenses handle month-end clamping and leap years', () => {
  assert.equal(advanceRecurringDueDate('2026-11-10', 'WEEKLY'), '2026-11-17');
  assert.equal(advanceRecurringDueDate('2026-01-31', 'MONTHLY'), '2026-02-28');
  assert.equal(advanceRecurringDueDate('2024-01-31', 'MONTHLY'), '2024-02-29');
  assert.equal(advanceRecurringDueDate('2024-02-29', 'YEARLY'), '2025-02-28');

  const schedules: RecurringExpense[] = [
    {
      id: 'r1',
      title: 'Shop Rent',
      category: 'SHOP',
      amount: 8000,
      isPersonalWithdrawal: false,
      paymentMethod: 'BANK',
      frequency: 'MONTHLY',
      startDate: '2026-10-14',
      nextDueDate: '2026-11-14',
      autoCreateOnDue: true,
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'r2',
      title: 'Paused WiFi',
      category: 'OTHER',
      amount: 700,
      isPersonalWithdrawal: false,
      paymentMethod: 'UPI',
      frequency: 'MONTHLY',
      startDate: '2026-10-10',
      nextDueDate: '2026-11-10',
      autoCreateOnDue: true,
      isActive: false,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'r3',
      title: 'Future Staff Bonus',
      category: 'STAFF',
      amount: 2000,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      frequency: 'MONTHLY',
      startDate: '2026-10-25',
      nextDueDate: '2026-11-25',
      autoCreateOnDue: false,
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'r4',
      title: 'Overdue Bijli Bill',
      category: 'ELECTRICITY',
      amount: 1400,
      isPersonalWithdrawal: false,
      paymentMethod: 'UPI',
      frequency: 'MONTHLY',
      startDate: '2026-10-12',
      nextDueDate: '2026-11-12',
      autoCreateOnDue: true,
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const due = getDueRecurringExpenses(schedules, '2026-11-14');
  assert.deepEqual(
    due.map((d) => d.id),
    ['r4', 'r1']
  );
});

test('Stage 4: calculateMonthlyCustomerStatement carries forward prior month closing balance and ignores cancelled entries', () => {
  const customer: Customer = {
    id: 'c-month-1',
    name: 'Mahesh Gupta',
    phone: '9876501234',
    openingBalance: 500,
    currentBalance: 1700,
    totalCreditGiven: 2000,
    totalPaymentReceived: 800,
    overdueDays: 4,
    category: 'REGULAR',
    createdAt: '2026-09-15T00:00:00Z',
  };

  const txs: CustomerTransaction[] = [
    {
      id: 'tx-oct-1',
      customerId: 'c-month-1',
      type: 'CREDIT',
      amount: 1200,
      date: '2026-10-10T10:00:00Z',
      description: 'October grocery',
      createdAt: '2026-10-10T10:00:00Z',
    },
    {
      id: 'tx-oct-2',
      customerId: 'c-month-1',
      type: 'PAYMENT',
      amount: 500,
      date: '2026-10-20T10:00:00Z',
      description: 'October partial pay',
      createdAt: '2026-10-20T10:00:00Z',
    },
    {
      id: 'tx-nov-1',
      customerId: 'c-month-1',
      type: 'CREDIT',
      amount: 800,
      date: '2026-11-03T10:00:00Z',
      description: 'Diwali sugar & oil',
      createdAt: '2026-11-03T10:00:00Z',
    },
    {
      id: 'tx-nov-cancelled',
      customerId: 'c-month-1',
      type: 'CREDIT',
      amount: 999,
      date: '2026-11-05T10:00:00Z',
      description: 'Wrong entry',
      status: 'CANCELLED',
      cancelReason: 'Duplicate',
      createdAt: '2026-11-05T10:00:00Z',
    },
    {
      id: 'tx-nov-2',
      customerId: 'c-month-1',
      type: 'PAYMENT',
      amount: 300,
      date: '2026-11-11T10:00:00Z',
      description: 'UPI payment',
      createdAt: '2026-11-11T10:00:00Z',
    },
  ];

  const stmt = calculateMonthlyCustomerStatement(customer, txs, '2026-11');
  assert.equal(stmt.openingBalanceForMonth, 1200); // 500 + 1200 - 500
  assert.equal(stmt.totalMonthlyDebit, 800);
  assert.equal(stmt.totalMonthlyCredit, 300);
  assert.equal(stmt.closingBalanceForMonth, 1700);
  assert.equal(stmt.activeEntriesCount, 2);
  assert.equal(stmt.cancelledEntriesCount, 1);
  assert.equal(stmt.entriesInMonth.length, 3);
});

test('filterStockMovements filters by date range, productId, source, direction, and computes totals', () => {
  const adjustments: StockAdjustmentRecord[] = [
    {
      id: 'sa-1',
      productId: 'p-rice',
      productName: 'Basmati Rice',
      unit: 'kg',
      previousStock: 10,
      quantityChange: 25,
      newStock: 35,
      type: 'ADD',
      reason: 'Wholesale delivery',
      source: 'PURCHASE',
      date: '2026-11-10',
      createdAt: '2026-11-10T09:00:00Z',
    },
    {
      id: 'sa-2',
      productId: 'p-rice',
      productName: 'Basmati Rice',
      unit: 'kg',
      previousStock: 35,
      quantityChange: -5,
      newStock: 30,
      type: 'REDUCE',
      reason: 'Counter sale #101',
      source: 'SALE',
      date: '2026-11-12',
      createdAt: '2026-11-12T12:00:00Z',
    },
    {
      id: 'sa-3',
      productId: 'p-oil',
      productName: 'Mustard Oil',
      unit: 'L',
      previousStock: 20,
      quantityChange: -2,
      newStock: 18,
      type: 'REDUCE',
      reason: 'Leaked bottle damaged',
      source: 'MANUAL',
      date: '2026-11-14',
      createdAt: '2026-11-14T15:00:00Z',
    },
  ];

  const allRice = filterStockMovements(adjustments, { productId: 'p-rice' });
  assert.equal(allRice.entries.length, 2);
  assert.equal(allRice.summary.addCount, 1);
  assert.equal(allRice.summary.reduceCount, 1);
  assert.equal(allRice.summary.totalAddedQty, 25);
  assert.equal(allRice.summary.totalReducedQty, 5);
  assert.equal(allRice.summary.netQtyChange, 20);
  assert.equal(allRice.summary.uniqueProductsCount, 1);

  const dateWindow = filterStockMovements(adjustments, {
    startDate: '2026-11-12',
    endDate: '2026-11-14',
    type: 'REDUCE',
  });
  assert.equal(dateWindow.entries.length, 2);
  assert.equal(dateWindow.entries[0].id, 'sa-3'); // newest first

  const manualOnly = filterStockMovements(adjustments, {
    source: 'MANUAL',
    searchQuery: 'leaked',
  });
  assert.equal(manualOnly.entries.length, 1);
  assert.equal(manualOnly.entries[0].productId, 'p-oil');
});






