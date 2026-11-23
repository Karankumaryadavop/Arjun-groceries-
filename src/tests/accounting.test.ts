import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCashbookSummary,
  calculateCategoryProfitMargins,
  calculateCustomerLedgerWithRunningBalance,
  calculateDailyProfitMarginTrend,
  calculateDetailedCashFlow,
  calculateMonthlyProfitTrend,
  calculateMonthlySalesGrowth,
  calculateNonCashBankUpiSummary,
  calculateOpeningCashBeforeRange,
  calculateProfitAndLoss,
  calculateSupplierLedgerWithRunningBalance,
  getLocalTodayKey,
  isCashbookEntryActive,
  isSaleActive,
  matchesLedgerDateFilter,
  resolveSupplierPurchaseUpfrontPaid,
  toLocalDateTimeIso,
  toLocalDayKey,
} from '../utils/accounting';
import { calculateCategoryProfitability } from '../utils/analyticsMetrics';
import { generateAccountingReconciliationReport } from '../utils/accountingReconciliation';
import {
  buildSnapshottedSaleItems,
  enrichCustomerReturnItemsWithSaleCost,
  matchOriginalSaleLine,
} from '../utils/inventoryEngine';
import {
  prepareAtomicCancelSale,
  prepareAtomicCustomerTransaction,
  prepareAtomicSale,
} from '../utils/atomicTransactions';
import {
  createMemoryLocalDbAdapter,
  recalculateLedgerBalancesFromHistory,
} from '../utils/localDatabase';
import { createEmptyBusinessDataset } from '../utils/freshInstall';
import {
  generateDailySalesReportPDF,
  generateSupplierLedgerPDF,
} from '../utils/pdfGenerator';
import type {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  Product,
  SaleRecord,
  StoreBusinessDataset,
  StoreProfile,
  Supplier,
  SupplierTransaction,
} from '../types';

const TEST_PROFILE: StoreProfile = {
  id: 'store-profile',
  storeName: 'Arjun Groceries Test Mart',
  ownerName: 'Arjun Verma',
  phone: '9876543210',
  address: 'Main Market Road',
  upiId: 'arjungroceries@upi',
  currencySymbol: '₹',
  isPinEnabled: false,
};

test('Customer accounting: handles opening balance, multi-payments, returns, advance, and cancellations cleanly', () => {
  const customer: Customer = {
    id: 'cust-1',
    name: 'Ramesh Kirana',
    phone: '9876500001',
    openingBalance: 1500,
    currentBalance: 0,
    totalCreditGiven: 0,
    totalPaymentReceived: 0,
    overdueDays: 0,
    category: 'REGULAR',
    createdAt: '2026-10-01T09:00:00+05:30',
  };

  const txs: CustomerTransaction[] = [
    {
      id: 'ctx-1',
      customerId: 'cust-1',
      type: 'CREDIT',
      amount: 2000,
      invoiceNo: 'INV-101',
      date: '2026-10-05T10:00:00+05:30',
      description: 'Monthly ration bill',
      status: 'COMPLETED',
      createdAt: '2026-10-05T10:00:00+05:30',
    },
    {
      id: 'ctx-2',
      customerId: 'cust-1',
      type: 'PAYMENT',
      amount: 800,
      paymentMethod: 'CASH',
      date: '2026-10-07T11:00:00+05:30',
      description: 'First partial payment',
      status: 'COMPLETED',
      createdAt: '2026-10-07T11:00:00+05:30',
    },
    {
      id: 'ctx-3',
      customerId: 'cust-1',
      type: 'PAYMENT',
      amount: 700,
      paymentMethod: 'UPI',
      date: '2026-10-08T11:00:00+05:30',
      description: 'Second partial payment',
      status: 'COMPLETED',
      createdAt: '2026-10-08T11:00:00+05:30',
    },
    {
      id: 'ctx-4',
      customerId: 'cust-1',
      type: 'RETURN',
      amount: 500,
      date: '2026-10-09T12:00:00+05:30',
      description: 'Returned damaged oil tin',
      status: 'COMPLETED',
      createdAt: '2026-10-09T12:00:00+05:30',
    },
    {
      id: 'ctx-5',
      customerId: 'cust-1',
      type: 'CREDIT',
      amount: 9999,
      date: '2026-10-10T12:00:00+05:30',
      description: 'Cancelled wrong entry',
      status: 'CANCELLED',
      createdAt: '2026-10-10T12:00:00+05:30',
    },
  ];

  // Opening 1500 + Credit 2000 - Payment 800 - Payment 700 - Return 500 = 1500
  const ledger = calculateCustomerLedgerWithRunningBalance(customer, txs);
  assert.equal(ledger.openingBalance, 1500);
  assert.equal(ledger.totalCreditGiven, 2000);
  assert.equal(ledger.totalPaymentReceived, 1500);
  assert.equal(ledger.salesReturns, 500);
  assert.equal(ledger.closingBalance, 1500);
  assert.equal(ledger.cancelledCount, 1);
  assert.equal(ledger.accountStatus, 'DUE');

  // Advance overpayment (-300 => ADVANCE 300)
  const overpaid = calculateCustomerLedgerWithRunningBalance(customer, [
    ...txs,
    {
      id: 'ctx-6',
      customerId: 'cust-1',
      type: 'PAYMENT',
      amount: 1800,
      paymentMethod: 'UPI',
      date: '2026-10-12T10:00:00+05:30',
      description: 'Advance settlement',
      status: 'COMPLETED',
      createdAt: '2026-10-12T10:00:00+05:30',
    },
  ]);
  assert.equal(overpaid.closingBalance, -300);
  assert.equal(overpaid.isAdvance, true);
  assert.equal(overpaid.advanceAmount, 300);
  assert.equal(overpaid.accountStatus, 'ADVANCE');
});

test('recalculateLedgerBalancesFromHistory resets balances to 0 when all transactions are cancelled while preserving imported zero-tx records', () => {
  const base = createEmptyBusinessDataset();
  const cWithCancelled: Customer = {
    id: 'c-cancelled',
    name: 'Cancelled Only Customer',
    phone: '9000000001',
    openingBalance: 0,
    currentBalance: 1200, // stale before recalc
    totalCreditGiven: 1200,
    totalPaymentReceived: 0,
    overdueDays: 0,
    category: 'REGULAR',
    createdAt: '2026-11-01T10:00:00+05:30',
  };
  const cLegacyImported = {
    id: 'c-imported',
    name: 'Imported Without Opening Field',
    phone: '9000000002',
    currentBalance: 850,
    totalCreditGiven: 850,
    totalPaymentReceived: 0,
    overdueDays: 10,
    category: 'REGULAR',
    createdAt: '2026-11-01T10:00:00+05:30',
  } as unknown as Customer;

  const dataset: StoreBusinessDataset = {
    ...base,
    customers: [cWithCancelled, cLegacyImported],
    customerTransactions: [
      {
        id: 'tx-c1',
        customerId: 'c-cancelled',
        type: 'CREDIT',
        amount: 1200,
        date: '2026-11-02T10:00:00+05:30',
        description: 'Cancelled bill',
        status: 'CANCELLED',
        createdAt: '2026-11-02T10:00:00+05:30',
      },
    ],
  };

  const recalculated = recalculateLedgerBalancesFromHistory(dataset);
  const first = recalculated.customers.find((c) => c.id === 'c-cancelled')!;
  const second = recalculated.customers.find((c) => c.id === 'c-imported')!;

  assert.equal(first.currentBalance, 0);
  assert.equal(first.category, 'CLEARED');
  assert.equal(second.currentBalance, 850);
});

test('Supplier accounting: resolves UNPAID, PAID, explicit PARTIAL, and legacy PARTIAL without paidAmount accurately', () => {
  const supplier: Supplier = {
    id: 'sup-1',
    name: 'Balaji Wholesale',
    phone: '9888877777',
    openingBalance: 1000,
    currentBalance: 0,
    totalPurchases: 0,
    totalPaid: 0,
    createdAt: '2026-10-01T08:00:00+05:30',
  };

  const explicitPartialTx: SupplierTransaction = {
    id: 'stx-1',
    supplierId: 'sup-1',
    type: 'PURCHASE',
    amount: 10000,
    paidAmount: 2500, // explicit 25%, NOT 50%
    paymentMethod: 'CASH',
    paymentStatus: 'PARTIAL',
    date: '2026-10-02T10:00:00+05:30',
    description: 'Explicit 2500 paid purchase',
    status: 'COMPLETED',
    createdAt: '2026-10-02T10:00:00+05:30',
  };

  const legacyPartialTx: SupplierTransaction = {
    id: 'stx-2',
    supplierId: 'sup-1',
    type: 'PURCHASE',
    amount: 4000,
    // no paidAmount stored (pre-Phase-6 historical record)
    paymentStatus: 'PARTIAL',
    date: '2026-10-03T10:00:00+05:30',
    description: 'Legacy partial purchase',
    status: 'COMPLETED',
    createdAt: '2026-10-03T10:00:00+05:30',
  };

  const fullPaidTx: SupplierTransaction = {
    id: 'stx-3',
    supplierId: 'sup-1',
    type: 'PURCHASE',
    amount: 3000,
    paidAmount: 3000,
    paymentMethod: 'BANK',
    paymentStatus: 'PAID',
    date: '2026-10-04T10:00:00+05:30',
    description: 'Full paid purchase',
    status: 'COMPLETED',
    createdAt: '2026-10-04T10:00:00+05:30',
  };

  const returnTx: SupplierTransaction = {
    id: 'stx-4',
    supplierId: 'sup-1',
    type: 'RETURN',
    amount: 1200,
    paymentStatus: 'PAID',
    date: '2026-10-05T10:00:00+05:30',
    description: 'Purchase return credit note',
    status: 'COMPLETED',
    createdAt: '2026-10-05T10:00:00+05:30',
  };

  const paymentTx: SupplierTransaction = {
    id: 'stx-5',
    supplierId: 'sup-1',
    type: 'PAYMENT',
    amount: 1500,
    paymentMethod: 'UPI',
    paymentStatus: 'PAID',
    date: '2026-10-06T10:00:00+05:30',
    description: 'Later UPI settlement',
    status: 'COMPLETED',
    createdAt: '2026-10-06T10:00:00+05:30',
  };

  assert.equal(resolveSupplierPurchaseUpfrontPaid(explicitPartialTx), 2500);
  assert.equal(resolveSupplierPurchaseUpfrontPaid(legacyPartialTx), 2000);
  assert.equal(resolveSupplierPurchaseUpfrontPaid(fullPaidTx), 3000);

  const ledger = calculateSupplierLedgerWithRunningBalance(supplier, [
    explicitPartialTx,
    legacyPartialTx,
    fullPaidTx,
    returnTx,
    paymentTx,
  ]);

  // Opening 1000 + Purchases (10000 + 4000 + 3000 = 17000)
  // - Paid (2500 + 2000 + 3000 + 1500 = 9000) - Return 1200 = 7800
  assert.equal(ledger.openingBalance, 1000);
  assert.equal(ledger.totalPurchases, 17000);
  assert.equal(ledger.totalPaid, 9000);
  assert.equal(ledger.closingBalance, 7800);
});

test('P&L accuracy: excludes cancelled bills, uses baseQuantity COGS without fake 85% fallback, deducts returns, preserves negative profit', () => {
  const productsMap = new Map<string, Product>([
    [
      'prod-sugar',
      {
        id: 'prod-sugar',
        name: 'Sugar (Cheeni)',
        category: 'Grains',
        unit: 'kg',
        purchasePrice: 40, // ₹40 per kg base unit
        sellingPrice: 48,
        stockQty: 50,
        minStockAlert: 10,
        updatedAt: '2026-11-10T09:00:00+05:30',
      },
    ],
  ]);

  const sales: SaleRecord[] = [
    {
      id: 'sale-active-loose',
      invoiceNo: 'B-001',
      date: '2026-11-10T10:00:00+05:30',
      amount: 24, // 500g Sugar -> baseQuantity = 0.5 kg => COGS = 20
      paymentMethod: 'CASH',
      isCredit: false,
      status: 'COMPLETED',
      items: [
        {
          productId: 'prod-sugar',
          productName: 'Sugar (Cheeni)',
          quantity: 500,
          unit: 'g',
          baseQuantity: 0.5,
          baseUnit: 'kg',
          unitCostAtSale: 40,
          rate: 24,
          total: 24,
        },
      ],
      createdAt: '2026-11-10T10:00:00+05:30',
    },
    {
      id: 'sale-bank-uncosted',
      invoiceNo: 'B-002',
      date: '2026-11-10T11:00:00+05:30',
      amount: 100, // quick counter sale with no item cost
      paymentMethod: 'BANK',
      isCredit: false,
      items: [],
      status: 'COMPLETED',
      createdAt: '2026-11-10T11:00:00+05:30',
    },
    {
      id: 'sale-cancelled',
      invoiceNo: 'B-003',
      date: '2026-11-10T12:00:00+05:30',
      amount: 5000,
      paymentMethod: 'CASH',
      isCredit: false,
      items: [],
      status: 'CANCELLED',
      cancelReason: 'Wrong bill',
      createdAt: '2026-11-10T12:00:00+05:30',
    },
  ];

  const returns: CustomerTransaction[] = [
    {
      id: 'ret-1',
      customerId: 'c1',
      type: 'RETURN',
      amount: 12,
      productId: 'prod-sugar',
      quantity: 0.25, // 0.25 kg * ₹40 = ₹10 COGS returned
      unit: 'kg',
      baseUnit: 'kg',
      date: '2026-11-10T14:00:00+05:30',
      description: 'Customer returned 250g sugar',
      status: 'COMPLETED',
      items: [
        {
          productId: 'prod-sugar',
          productName: 'Sugar (Cheeni)',
          quantity: 0.25,
          unit: 'kg',
          baseQuantity: 0.25,
          baseUnit: 'kg',
          unitCostAtSale: 40,
        },
      ],
      createdAt: '2026-11-10T14:00:00+05:30',
    },
  ];

  const expenses: ExpenseRecord[] = [
    {
      id: 'exp-1',
      title: 'Shop Electricity',
      category: 'ELECTRICITY',
      amount: 500,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      date: '2026-11-10T15:00:00+05:30',
      createdAt: '2026-11-10T15:00:00+05:30',
    },
    {
      id: 'exp-draw',
      title: 'Owner Home Expense',
      category: 'PERSONAL_DRAWING',
      amount: 900,
      isPersonalWithdrawal: true,
      paymentMethod: 'CASH',
      date: '2026-11-10T16:00:00+05:30',
      createdAt: '2026-11-10T16:00:00+05:30',
    },
  ];

  assert.equal(isSaleActive(sales[0]), true);
  assert.equal(isSaleActive(sales[2]), false);

  const pnl = calculateProfitAndLoss(sales, expenses, productsMap, returns);
  assert.equal(pnl.grossRevenue, 124); // cancelled 5000 excluded
  assert.equal(pnl.salesReturns, 12);
  assert.equal(pnl.totalRevenue, 112); // 124 - 12
  assert.equal(pnl.bankRevenue, 100);
  assert.equal(pnl.cashRevenue, 24);
  assert.equal(pnl.cogs, 10); // 20 sold - 10 returned (NO 85% fallback on ₹100 quick bill!)
  assert.equal(pnl.costedRevenue, 24);
  assert.equal(pnl.uncostedRevenue, 100);
  assert.equal(pnl.hasCompleteCogs, false);
  assert.equal(pnl.grossProfit, 102); // 112 - 10
  assert.equal(pnl.operatingExpenses, 500);
  assert.equal(pnl.personalDrawings, 900);
  assert.equal(pnl.netOperatingProfit, -398); // negative profit preserved, NOT clamped to 0
});

test('Cashbook carryforward, OWNER_CONTRIBUTION separation, and CANCELLED cashbook exclusion work together', () => {
  const refNow = new Date(2026, 10, 16, 12, 0, 0); // 2026-11-16 local
  const entries: CashbookEntry[] = [
    {
      id: 'cb-prev-1',
      type: 'IN',
      category: 'OWNER_CONTRIBUTION',
      refType: 'OWNER_CONTRIBUTION',
      amount: 5000,
      paymentMode: 'CASH',
      description: 'Owner capital injected yesterday',
      date: '2026-11-15T09:00:00+05:30',
      createdAt: '2026-11-15T09:00:00+05:30',
    },
    {
      id: 'cb-prev-2',
      type: 'OUT',
      category: 'EXPENSE',
      refType: 'EXPENSE',
      amount: 1200,
      paymentMode: 'CASH',
      description: 'Yesterday expense',
      date: '2026-11-15T18:00:00+05:30',
      createdAt: '2026-11-15T18:00:00+05:30',
    },
    {
      id: 'cb-today-sale',
      type: 'IN',
      category: 'SALE',
      refType: 'SALE',
      amount: 2000,
      paymentMode: 'CASH',
      description: 'Today cash counter sale',
      date: '2026-11-16T10:00:00+05:30',
      createdAt: '2026-11-16T10:00:00+05:30',
    },
    {
      id: 'cb-today-cap',
      type: 'IN',
      category: 'OWNER_CONTRIBUTION',
      refType: 'OWNER_CONTRIBUTION',
      amount: 1000,
      paymentMode: 'CASH',
      description: 'Today owner float added',
      date: '2026-11-16T10:30:00+05:30',
      createdAt: '2026-11-16T10:30:00+05:30',
    },
    {
      id: 'cb-today-void',
      type: 'IN',
      category: 'SALE',
      refType: 'SALE',
      amount: 9999,
      paymentMode: 'CASH',
      description: 'Cancelled sale voided cashbook row',
      date: '2026-11-16T11:00:00+05:30',
      status: 'CANCELLED',
      createdAt: '2026-11-16T11:00:00+05:30',
    },
  ];

  assert.equal(isCashbookEntryActive(entries[4]), false);

  const openingForToday = calculateOpeningCashBeforeRange(entries, 'TODAY', undefined, refNow);
  assert.equal(openingForToday, 3800); // 5000 - 1200

  const todayEntries = entries.filter((e) => matchesLedgerDateFilter(e.date, 'TODAY', undefined, undefined, refNow));
  assert.equal(todayEntries.length, 3);

  const summary = calculateCashbookSummary(openingForToday, todayEntries);
  assert.equal(summary.openingCash, 3800);
  assert.equal(summary.totalInflows, 3000); // 2000 + 1000 (9999 CANCELLED excluded)
  assert.equal(summary.closingCash, 6800);

  const detailed = calculateDetailedCashFlow(openingForToday, todayEntries);
  assert.equal(detailed.cashReceived, 2000);
  assert.equal(detailed.ownerContributions, 1000);
  assert.equal(detailed.closingCash, 6800);
});

test('Non-Cash Bank/UPI summary separates digital flows from cash drawer', () => {
  const summary = calculateNonCashBankUpiSummary({
    sales: [
      {
        id: 's-upi',
        invoiceNo: 'U1',
        date: '2026-11-16',
        amount: 1500,
        paymentMethod: 'UPI',
        isCredit: false,
        items: [],
        createdAt: '2026-11-16T10:00:00+05:30',
      },
      {
        id: 's-cash',
        invoiceNo: 'C1',
        date: '2026-11-16',
        amount: 2000,
        paymentMethod: 'CASH',
        isCredit: false,
        items: [],
        createdAt: '2026-11-16T10:05:00+05:30',
      },
    ],
    customerTransactions: [
      {
        id: 'ctx-bank',
        customerId: 'c1',
        type: 'PAYMENT',
        amount: 500,
        paymentMethod: 'BANK',
        date: '2026-11-16',
        description: 'NEFT recovery',
        status: 'COMPLETED',
        createdAt: '2026-11-16T11:00:00+05:30',
      },
    ],
    supplierTransactions: [
      {
        id: 'stx-bank-partial',
        supplierId: 'sup1',
        type: 'PURCHASE',
        amount: 4000,
        paidAmount: 1000,
        paymentMethod: 'BANK',
        paymentStatus: 'PARTIAL',
        date: '2026-11-16',
        description: 'Bank upfront purchase',
        status: 'COMPLETED',
        createdAt: '2026-11-16T12:00:00+05:30',
      },
    ],
    expenses: [
      {
        id: 'exp-upi',
        title: 'Internet bill',
        category: 'SHOP',
        amount: 300,
        isPersonalWithdrawal: false,
        paymentMethod: 'UPI',
        date: '2026-11-16',
        createdAt: '2026-11-16T13:00:00+05:30',
      },
    ],
  });

  assert.equal(summary.bankUpiSales, 1500);
  assert.equal(summary.bankUpiCustomerCollections, 500);
  assert.equal(summary.totalBankUpiInflows, 2000);
  assert.equal(summary.bankUpiSupplierOutflows, 1000);
  assert.equal(summary.bankUpiExpenses, 300);
  assert.equal(summary.totalBankUpiOutflows, 1300);
  assert.equal(summary.netBankUpiFlow, 700);
});

test('Monthly sales growth calculates true MoM percentage and signals missing prior baseline cleanly', () => {
  const refNow = new Date(2026, 10, 16, 12, 0, 0); // Nov 16, 2026
  const emptyPrior = calculateMonthlySalesGrowth(
    [
      {
        id: 's-nov',
        invoiceNo: 'N1',
        date: '2026-11-10',
        amount: 5000,
        paymentMethod: 'CASH',
        isCredit: false,
        items: [],
        createdAt: '2026-11-10T10:00:00+05:30',
      },
    ],
    refNow
  );
  assert.equal(emptyPrior.hasPriorBaseline, false);
  assert.equal(emptyPrior.growthPct, 0);

  const withPrior = calculateMonthlySalesGrowth(
    [
      {
        id: 's-oct',
        invoiceNo: 'O1',
        date: '2026-10-20',
        amount: 10000,
        paymentMethod: 'CASH',
        isCredit: false,
        items: [],
        createdAt: '2026-10-20T10:00:00+05:30',
      },
      {
        id: 's-nov',
        invoiceNo: 'N1',
        date: '2026-11-10',
        amount: 12500,
        paymentMethod: 'CASH',
        isCredit: false,
        items: [],
        createdAt: '2026-11-10T10:00:00+05:30',
      },
      {
        id: 's-nov-cancelled',
        invoiceNo: 'N2',
        date: '2026-11-12',
        amount: 99999,
        paymentMethod: 'CASH',
        isCredit: false,
        items: [],
        status: 'CANCELLED',
        createdAt: '2026-11-12T10:00:00+05:30',
      },
    ],
    refNow
  );
  assert.equal(withPrior.hasPriorBaseline, true);
  assert.equal(withPrior.previousMonthSales, 10000);
  assert.equal(withPrior.currentMonthSales, 12500);
  assert.equal(withPrior.growthPct, 25);
});

test('Local date helpers preserve calendar YYYY-MM-DD formatting without UTC shifts', () => {
  const ref = new Date(2026, 10, 16, 0, 15, 0); // 00:15 local time
  assert.equal(getLocalTodayKey(ref), '2026-11-16');
  assert.equal(toLocalDayKey('2026-11-16'), '2026-11-16');
  const localIso = toLocalDateTimeIso('2026-11-16', ref);
  assert.ok(localIso.startsWith('2026-11-16T00:15:00'));
});

test('PDF generators build Supplier Ledger & Daily Sales Reports cleanly with explicit upfront partial amounts', () => {
  const supplier: Supplier = {
    id: 'sup-pdf',
    name: 'Shree Traders',
    phone: '9999988888',
    openingBalance: 0,
    currentBalance: 7000,
    totalPurchases: 10000,
    totalPaid: 3000,
    createdAt: '2026-11-01',
  };
  const suppDoc = generateSupplierLedgerPDF(
    supplier,
    [
      {
        id: 'stx-pdf',
        supplierId: 'sup-pdf',
        type: 'PURCHASE',
        amount: 10000,
        paidAmount: 3000,
        paymentMethod: 'CASH',
        paymentStatus: 'PARTIAL',
        date: '2026-11-15',
        description: 'Partial purchase',
        status: 'COMPLETED',
        createdAt: '2026-11-15T10:00:00+05:30',
      },
    ],
    TEST_PROFILE
  );
  assert.ok(suppDoc.getNumberOfPages() >= 1);

  const dailyDoc = generateDailySalesReportPDF(
    [],
    TEST_PROFILE,
    '2026-11-16',
    { totalSales: 0, totalCOGS: 0, grossProfit: 0, grossMarginPct: 0 }
  );
  assert.ok(dailyDoc.getNumberOfPages() >= 1);
});

test('Accounting Reconciliation Audit passes clean on reconciled data and catches drift, orphaned cashbook, and missing upfront cash entries without mutating data', () => {
  const cleanBase = createEmptyBusinessDataset();
  const cleanReport = generateAccountingReconciliationReport(cleanBase, new Date('2026-11-16T12:00:00Z'));
  assert.equal(cleanReport.isFullyReconciled, true);
  assert.equal(cleanReport.hasCriticalIssues, false);
  assert.equal(cleanReport.findings.length, 0);

  const dirtyDataset: StoreBusinessDataset = {
    ...cleanBase,
    customers: [
      {
        id: 'c1',
        name: 'Drifted Cust',
        phone: '9111111111',
        openingBalance: 0,
        currentBalance: 900, // ledger sum is 500 -> drift!
        totalCreditGiven: 500,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: '2026-11-01',
      },
    ],
    customerTransactions: [
      {
        id: 'ctx1',
        customerId: 'c1',
        type: 'CREDIT',
        amount: 500,
        date: '2026-11-10',
        description: 'Credit bill',
        status: 'COMPLETED',
        createdAt: '2026-11-10T10:00:00+05:30',
      },
    ],
    suppliers: [
      {
        id: 'sup1',
        name: 'Supplier One',
        phone: '9222222222',
        openingBalance: 0,
        currentBalance: 1500,
        totalPurchases: 2000,
        totalPaid: 500,
        createdAt: '2026-11-01',
      },
    ],
    supplierTransactions: [
      {
        id: 'stx-upfront-missing-cb',
        supplierId: 'sup1',
        type: 'PURCHASE',
        amount: 2000,
        paidAmount: 500,
        paymentMethod: 'CASH',
        paymentStatus: 'PARTIAL',
        date: '2026-11-11',
        description: 'Cash partial purchase without cashbook OUT',
        status: 'COMPLETED',
        createdAt: '2026-11-11T10:00:00+05:30',
      },
    ],
    cashbookEntries: [
      {
        id: 'cb-orphan',
        type: 'OUT',
        category: 'EXPENSE',
        refType: 'EXPENSE',
        refId: 'deleted-exp-id',
        amount: 250,
        paymentMode: 'CASH',
        description: 'Deleted expense leftover cashbook',
        date: '2026-11-12',
        createdAt: '2026-11-12T10:00:00+05:30',
      },
    ],
  };

  const dirtyReport = generateAccountingReconciliationReport(dirtyDataset, new Date('2026-11-16T12:00:00Z'));
  assert.equal(dirtyReport.isFullyReconciled, false);
  assert.equal(dirtyReport.hasCriticalIssues, true);
  const codes = new Set(dirtyReport.findings.map((f) => f.code));
  assert.ok(codes.has('CUSTOMER_BALANCE_DRIFT'));
  assert.ok(codes.has('UPFRONT_CASH_PURCHASES_MISSING_CASHBOOK'));
  assert.ok(codes.has('ORPHANED_CASHBOOK_REFERENCES'));
  assert.ok(codes.has('NEGATIVE_CASHBOOK_BALANCE'));
  // Strictly read-only: customer currentBalance remains untouched on input object
  assert.equal(dirtyDataset.customers[0].currentBalance, 900);
});

test('Local database adapter persists Phase 6 fields (paidAmount, CANCELLED sale, OWNER_CONTRIBUTION cashbook) faithfully', async () => {
  const db = createMemoryLocalDbAdapter();
  const base = createEmptyBusinessDataset();
  const dataset: StoreBusinessDataset = {
    ...base,
    profile: TEST_PROFILE,
    sales: [
      {
        id: 'sale-1',
        invoiceNo: 'INV-P6',
        date: '2026-11-16',
        amount: 450,
        paymentMethod: 'CASH',
        isCredit: false,
        items: [],
        status: 'CANCELLED',
        cancelReason: 'Test cancellation persistence',
        cancelledAt: '2026-11-16T10:00:00+05:30',
        createdAt: '2026-11-16T09:00:00+05:30',
      },
    ],
    supplierTransactions: [
      {
        id: 'stx-1',
        supplierId: 'sup-x',
        type: 'PURCHASE',
        amount: 5000,
        paidAmount: 1500,
        paymentMethod: 'CASH',
        paymentStatus: 'PARTIAL',
        date: '2026-11-16',
        description: 'Partial purchase',
        status: 'COMPLETED',
        createdAt: '2026-11-16T09:30:00+05:30',
      },
    ],
    cashbookEntries: [
      {
        id: 'cb-cap',
        type: 'IN',
        category: 'OWNER_CONTRIBUTION',
        refType: 'OWNER_CONTRIBUTION',
        amount: 2000,
        paymentMode: 'CASH',
        description: 'Counter float',
        date: '2026-11-16',
        createdAt: '2026-11-16T08:00:00+05:30',
      },
    ],
  };

  await db.commitBusinessDatasetAtomic(dataset);
  const loaded = await db.loadBusinessDataset();
  assert.equal(loaded.sales?.[0].status, 'CANCELLED');
  assert.equal(loaded.sales?.[0].cancelReason, 'Test cancellation persistence');
  assert.equal(loaded.supplierTransactions?.[0].paidAmount, 1500);
  assert.equal(loaded.cashbookEntries?.[0].category, 'OWNER_CONTRIBUTION');
});

test('Phase 6.1: Historical COGS uses immutable unitCostAtSale + normalized baseQuantity even after catalog purchasePrice changes, and reports legacy missing historical cost without rewriting old sales', () => {
  const initialRice: Product = {
    id: 'prod-rice-hist',
    name: 'Basmati Rice',
    category: 'Grains',
    unit: 'KG',
    purchasePrice: 80,
    sellingPrice: 110,
    stockQty: 50,
    minStockAlert: 10,
    updatedAt: '2026-11-01T09:00:00+05:30',
  };

  // New sale of 500 GM @ ₹55 when purchasePrice = ₹80/KG -> snapshots unitCostAtSale = 80, baseQuantity = 0.5, baseUnit = KG
  const snapshottedItems = buildSnapshottedSaleItems(
    [
      {
        productId: 'prod-rice-hist',
        productName: 'Basmati Rice',
        quantity: 500,
        unit: 'GM',
        rate: 110,
        total: 55,
      },
    ],
    [initialRice],
    '2026-11-05T10:00:00.000Z'
  );

  assert.equal(snapshottedItems[0].baseUnit, 'KG');
  assert.equal(snapshottedItems[0].baseQuantity, 0.5);
  assert.equal(snapshottedItems[0].unitCostAtSale, 80);
  assert.equal(snapshottedItems[0].costSnapshotSource, 'PRODUCT_PURCHASE_PRICE');

  const newSaleWithSnapshot: SaleRecord = {
    id: 'sale-hist-new',
    invoiceNo: 'INV-NEW',
    date: '2026-11-05T10:00:00+05:30',
    amount: 55,
    paymentMethod: 'CASH',
    isCredit: false,
    items: snapshottedItems,
    status: 'COMPLETED',
    createdAt: '2026-11-05T10:00:00+05:30',
  };

  // Old legacy sale recorded before unitCostAtSale existed (no snapshot)
  const legacySaleWithoutSnapshot: SaleRecord = {
    id: 'sale-hist-legacy',
    invoiceNo: 'INV-OLD',
    date: '2026-10-15T10:00:00+05:30',
    amount: 220,
    paymentMethod: 'CASH',
    isCredit: false,
    items: [
      {
        productId: 'prod-rice-hist',
        productName: 'Basmati Rice',
        quantity: 2,
        unit: 'KG',
        rate: 110,
        total: 220,
      },
    ],
    status: 'COMPLETED',
    createdAt: '2026-10-15T10:00:00+05:30',
  };

  // Catalog purchasePrice jumps from ₹80 -> ₹150 later!
  const updatedRice: Product = {
    ...initialRice,
    purchasePrice: 150,
    updatedAt: '2026-11-16T09:00:00+05:30',
  };
  const updatedMap = new Map<string, Product>([[updatedRice.id, updatedRice]]);

  const pnl = calculateProfitAndLoss(
    [newSaleWithSnapshot, legacySaleWithoutSnapshot],
    [],
    updatedMap
  );

  // Historical COGS for newSaleWithSnapshot MUST still be 0.5 * 80 = ₹40 (NOT 0.5 * 150 = ₹75!)
  // Legacy sale without snapshot MUST NOT use current catalog ₹150; must report as missing historical cost
  assert.equal(pnl.cogs, 40);
  assert.equal(pnl.costedRevenue, 55);
  assert.equal(pnl.uncostedRevenue, 220);
  assert.equal(pnl.missingHistoricalCostItemsCount, 1);
  assert.equal(pnl.missingHistoricalCostRevenue, 220);
  assert.equal(pnl.hasCompleteCogs, false);
  // Old transaction record preserved completely untouched
  assert.equal(legacySaleWithoutSnapshot.items[0].unitCostAtSale, undefined);

  const report = generateAccountingReconciliationReport({
    ...createEmptyBusinessDataset(),
    profile: TEST_PROFILE,
    products: [updatedRice],
    sales: [newSaleWithSnapshot, legacySaleWithoutSnapshot],
  });

  assert.equal(report.profitAudit.knownCogs, 40);
  assert.equal(report.profitAudit.missingHistoricalCostCount, 1);
  assert.equal(report.profitAudit.missingHistoricalCostRevenue, 220);
  assert.ok(report.findings.some((f) => f.code === 'MISSING_HISTORICAL_ITEM_COST'));
});

test('Consolidated Repair: Customer sales return reverses original historical COGS while unlinked return & incompatible unit items report NEEDS_REVIEW cleanly without altering old records', () => {
  const sugar: Product = {
    id: 'prod-sugar-ret',
    name: 'Sugar',
    category: 'Staples',
    unit: 'KG',
    purchasePrice: 40,
    sellingPrice: 50,
    stockQty: 20,
    minStockAlert: 5,
    updatedAt: '2026-11-01T09:00:00Z',
  };

  const baseDataset: StoreBusinessDataset = {
    ...createEmptyBusinessDataset(),
    profile: TEST_PROFILE,
    products: [sugar],
    customers: [
      {
        id: 'cust-ret-1',
        name: 'Ramesh',
        phone: '9800011122',
        openingBalance: 0,
        currentBalance: 0,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: '2026-11-01T09:00:00Z',
      },
    ],
  };

  // 1) Sell 4 KG Sugar when historical purchase cost = ₹40/KG (COGS = ₹160, Revenue = ₹200)
  const saleRes = prepareAtomicSale(baseDataset, {
    amount: 200,
    paymentMethod: 'CREDIT',
    isCredit: true,
    customerId: 'cust-ret-1',
    customerName: 'Ramesh',
    date: '2026-11-05T10:00:00Z',
    items: [
      {
        productId: 'prod-sugar-ret',
        productName: 'Sugar',
        quantity: 4,
        unit: 'KG',
        rate: 50,
        total: 200,
      },
    ],
  });
  assert.equal(saleRes.success, true);
  let datasetAfterSale = saleRes.nextDataset!;
  const invoiceNo = saleRes.extra!.invoiceNo;

  // 2) Catalog purchasePrice later doubles from ₹40 -> ₹95/KG
  datasetAfterSale = {
    ...datasetAfterSale,
    products: datasetAfterSale.products.map((p) =>
      p.id === 'prod-sugar-ret' ? { ...p, purchasePrice: 95 } : p
    ),
  };

  // 3) Customer returns 500 GM (= 0.5 KG) linked to original invoiceNo -> must capture unitCostAtSale = 40 (returned COGS = ₹20, NOT ₹47.50)
  const returnRes = prepareAtomicCustomerTransaction(datasetAfterSale, {
    customerId: 'cust-ret-1',
    type: 'RETURN',
    amount: 25,
    invoiceNo,
    description: 'Returned 500 GM sugar',
    productId: 'prod-sugar-ret',
    quantity: 500,
    unit: 'GM',
    date: '2026-11-06T11:00:00Z',
  });
  assert.equal(returnRes.success, true);
  const afterLinkedReturn = returnRes.nextDataset!;
  const returnTx = afterLinkedReturn.customerTransactions[0];
  assert.equal(returnTx.items?.[0].unitCostAtSale, 40);
  assert.equal(returnTx.items?.[0].baseUnit, 'KG');
  assert.equal(returnTx.items?.[0].baseQuantity, 0.5);

  const prodMap = new Map(afterLinkedReturn.products.map((p) => [p.id, p]));
  const pnlLinked = calculateProfitAndLoss(
    afterLinkedReturn.sales,
    afterLinkedReturn.expenses,
    prodMap,
    afterLinkedReturn.customerTransactions
  );
  // Gross Revenue = 200, Return = 25 -> Net = 175; COGS = (4 * 40) - (0.5 * 40) = 140; Gross Profit = 35
  assert.equal(pnlLinked.totalRevenue, 175);
  assert.equal(pnlLinked.cogs, 140);
  assert.equal(pnlLinked.grossProfit, 35);
  assert.equal(pnlLinked.reviewStatus, 'RECONCILED');

  // 4) Unlinked historical return (no original invoice) + incompatible unit historical sale item (BOX vs KG)
  // Must stay intact on disk and report NEEDS_REVIEW without fabricating values
  const dirtyDataset: StoreBusinessDataset = {
    ...afterLinkedReturn,
    sales: [
      ...afterLinkedReturn.sales,
      {
        id: 'sale-bad-unit',
        invoiceNo: 'INV-BAD-UNIT',
        date: '2026-10-01T10:00:00Z',
        amount: 300,
        paymentMethod: 'CASH',
        isCredit: false,
        status: 'COMPLETED',
        createdAt: '2026-10-01T10:00:00Z',
        items: [
          {
            productId: 'prod-sugar-ret',
            productName: 'Sugar',
            quantity: 2,
            unit: 'BOX',
            rate: 150,
            total: 300,
            unitCostAtSale: 40,
          },
        ],
      },
    ],
    customerTransactions: [
      ...afterLinkedReturn.customerTransactions,
      {
        id: 'ctx-unlinked-ret',
        customerId: 'cust-ret-1',
        type: 'RETURN',
        amount: 50,
        date: '2026-10-02T10:00:00Z',
        description: 'Old unlinked cash return',
        status: 'COMPLETED',
        createdAt: '2026-10-02T10:00:00Z',
      },
    ],
  };

  const dirtyReport = generateAccountingReconciliationReport(dirtyDataset);
  assert.equal(dirtyReport.profitAudit.reviewStatus, 'NEEDS_REVIEW');
  assert.equal(dirtyReport.profitAudit.uncostedReturnsCount, 1);
  assert.equal(dirtyReport.profitAudit.unreconstructibleUnitItemsCount, 1);
  assert.ok(dirtyReport.profitAudit.uncostedReturnIds?.includes('ctx-unlinked-ret'));
  assert.ok(dirtyReport.profitAudit.unreconstructibleUnitItemIds?.includes('sale-bad-unit'));
  assert.ok(dirtyReport.findings.some((f) => f.code === 'UNCOSTED_RETURN_NEEDS_REVIEW'));
  assert.ok(dirtyReport.findings.some((f) => f.code === 'UNRECONSTRUCTIBLE_UNIT_CONVERSION'));
  // Original bad-unit historical line stays completely untouched
  assert.equal(dirtyDataset.sales[dirtyDataset.sales.length - 1].items[0].unit, 'BOX');
});

test('Historical Unit Immutability: changing catalog unit after completed sales & returns preserves historical COGS, KG/GM & LITRE/ML conversions, and marks legacy missing baseUnit as NEEDS_REVIEW', () => {
  const rice: Product = {
    id: 'p-rice-imm',
    name: 'Sona Masoori Rice',
    category: 'Grains',
    unit: 'KG',
    purchasePrice: 80, // ₹80/KG
    sellingPrice: 110,
    stockQty: 100,
    minStockAlert: 10,
    updatedAt: '2026-11-01T09:00:00Z',
  };

  const oil: Product = {
    id: 'p-oil-imm',
    name: 'Mustard Oil',
    category: 'Oils',
    unit: 'LITRE',
    purchasePrice: 120, // ₹120/LITRE
    sellingPrice: 160,
    stockQty: 50,
    minStockAlert: 5,
    updatedAt: '2026-11-01T09:00:00Z',
  };

  let dataset: StoreBusinessDataset = {
    ...createEmptyBusinessDataset(),
    profile: TEST_PROFILE,
    products: [rice, oil],
    customers: [
      {
        id: 'cust-imm-1',
        name: 'Sita Devi',
        phone: '9812345678',
        openingBalance: 0,
        currentBalance: 0,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: '2026-11-01T09:00:00Z',
      },
    ],
  };

  // Sale 1: 2 KG Rice (₹220 rev, ₹160 COGS) + 500 GM Rice (₹55 rev, ₹40 COGS)
  const saleRiceRes = prepareAtomicSale(dataset, {
    amount: 275,
    paymentMethod: 'CREDIT',
    isCredit: true,
    customerId: 'cust-imm-1',
    customerName: 'Sita Devi',
    date: '2026-11-05T10:00:00Z',
    items: [
      {
        productId: 'p-rice-imm',
        productName: 'Sona Masoori Rice',
        quantity: 2,
        unit: 'KG',
        rate: 110,
        total: 220,
      },
      {
        productId: 'p-rice-imm',
        productName: 'Sona Masoori Rice',
        quantity: 500,
        unit: 'GM',
        rate: 110,
        total: 55,
      },
    ],
  });
  assert.equal(saleRiceRes.success, true);
  dataset = saleRiceRes.nextDataset!;
  const riceInvoiceNo = saleRiceRes.extra!.invoiceNo;

  // Sale 2: 250 ML Oil (0.25 LITRE -> ₹40 rev, ₹30 COGS), also verify without explicit baseQuantity
  const saleOilRes = prepareAtomicSale(dataset, {
    amount: 40,
    paymentMethod: 'CASH',
    date: '2026-11-06T10:00:00Z',
    items: [
      {
        productId: 'p-oil-imm',
        productName: 'Mustard Oil',
        quantity: 250,
        unit: 'ML',
        rate: 160,
        total: 40,
      },
    ],
  });
  assert.equal(saleOilRes.success, true);
  dataset = saleOilRes.nextDataset!;

  // Remove explicit baseQuantity on one sale line copy to prove conversion uses historical baseUnit ('LITRE') rather than edited catalog unit
  const oilSaleWithoutExplicitBaseQty: SaleRecord = {
    ...dataset.sales[0],
    items: dataset.sales[0].items.map((it) => ({
      ...it,
      baseQuantity: undefined,
    })),
  };
  dataset = {
    ...dataset,
    sales: [oilSaleWithoutExplicitBaseQty, ...dataset.sales.slice(1)],
  };

  // Now edit catalog products BOTH incompatibly (KG -> BAG, LITRE -> BOTTLE) AND compatibly in another check (KG -> GM)
  const editedIncompatibleProducts: Product[] = dataset.products.map((p) =>
    p.id === 'p-rice-imm'
      ? { ...p, unit: 'BAG', purchasePrice: 2400, stockQty: 10 }
      : { ...p, unit: 'BOTTLE', purchasePrice: 300, stockQty: 12 }
  );
  dataset = { ...dataset, products: editedIncompatibleProducts };

  // Record a linked customer return of 500 GM Rice AFTER catalog unit changed KG -> BAG
  // Must resolve historical baseUnit = 'KG', baseQuantity = 0.5, unitCostAtSale = 80 (COGS reversal = ₹40),
  // AND must NOT corrupt BAG stock count (stays 10 BAGs).
  const enrichedPreview = enrichCustomerReturnItemsWithSaleCost({
    items: [{ productId: 'p-rice-imm', productName: 'Sona Masoori Rice', quantity: 500, unit: 'GM' }],
    sales: dataset.sales,
    products: dataset.products,
    invoiceNo: riceInvoiceNo,
  });
  assert.equal(enrichedPreview[0].baseUnit, 'KG');
  assert.equal(enrichedPreview[0].baseQuantity, 0.5);
  assert.equal(enrichedPreview[0].unitCostAtSale, 80);

  const returnRes = prepareAtomicCustomerTransaction(dataset, {
    customerId: 'cust-imm-1',
    type: 'RETURN',
    amount: 55,
    invoiceNo: riceInvoiceNo,
    description: 'Returned 500 GM rice after catalog unit edit',
    productId: 'p-rice-imm',
    quantity: 500,
    unit: 'GM',
    date: '2026-11-08T11:00:00Z',
  });
  assert.equal(returnRes.success, true);
  dataset = returnRes.nextDataset!;
  assert.equal(dataset.customerTransactions[0].items?.[0].baseUnit, 'KG');
  assert.equal(dataset.customerTransactions[0].items?.[0].baseQuantity, 0.5);
  assert.equal(dataset.customerTransactions[0].items?.[0].unitCostAtSale, 80);
  // Incompatible BAG stock count must remain uncorrupted
  assert.equal(dataset.products.find((p) => p.id === 'p-rice-imm')?.stockQty, 10);

  const incompMap = new Map(dataset.products.map((p) => [p.id, p]));
  const pnlIncomp = calculateProfitAndLoss(
    dataset.sales,
    dataset.expenses,
    incompMap,
    dataset.customerTransactions
  );
  // Sales COGS = (2 * 80) + (0.5 * 80) + (0.25 * 120) = 160 + 40 + 30 = 230
  // Return COGS = 0.5 * 80 = 40 -> Net COGS = 190
  // Revenue = (275 + 40) - 55 = 260 -> Gross Profit = 70
  assert.equal(pnlIncomp.cogs, 190);
  assert.equal(pnlIncomp.totalRevenue, 260);
  assert.equal(pnlIncomp.grossProfit, 70);
  assert.equal(pnlIncomp.reviewStatus, 'RECONCILED');
  assert.equal(pnlIncomp.unreconstructibleUnitItemsCount, 0);

  // Also test compatible catalog unit edit (KG -> GM, LITRE -> ML): must NOT re-interpret historical baseQuantity=2 as 2 GM or divide by 1000
  const editedCompatibleProducts: Product[] = dataset.products.map((p) =>
    p.id === 'p-rice-imm'
      ? { ...p, unit: 'GM', purchasePrice: 0.08 }
      : { ...p, unit: 'ML', purchasePrice: 0.12 }
  );
  const compMap = new Map(editedCompatibleProducts.map((p) => [p.id, p]));
  const pnlComp = calculateProfitAndLoss(
    dataset.sales,
    dataset.expenses,
    compMap,
    dataset.customerTransactions
  );
  assert.equal(pnlComp.cogs, 190);
  assert.equal(pnlComp.reviewStatus, 'RECONCILED');

  // Verify analytics & trend helpers also preserve historical COGS after catalog unit edits
  const dailyTrend = calculateDailyProfitMarginTrend(dataset.sales, dataset.expenses, incompMap, 14);
  const totalTrendCogs = dailyTrend.reduce((s, d) => s + d.cogs, 0);
  assert.equal(totalTrendCogs, 230); // gross sales COGS before return deduction

  const heatmap = calculateCategoryProfitMargins(editedIncompatibleProducts, dataset.sales);
  const grainsHeat = heatmap.find((h) => h.category === 'Grains')!;
  const oilsHeat = heatmap.find((h) => h.category === 'Oils')!;
  assert.equal(grainsHeat.realizedRevenue - grainsHeat.realizedProfit, 200);
  assert.equal(oilsHeat.realizedRevenue - oilsHeat.realizedProfit, 30);

  const catProf = calculateCategoryProfitability({
    products: editedIncompatibleProducts,
    sales: dataset.sales,
    expenses: [],
  });
  assert.equal(catProf.totalCogs, 230);

  const cleanRec = generateAccountingReconciliationReport(dataset);
  assert.equal(cleanRec.profitAudit.knownCogs, 190);
  assert.equal(cleanRec.profitAudit.reviewStatus, 'RECONCILED');
  assert.equal(cleanRec.profitAudit.unreconstructibleUnitItemsCount, 0);

  // Legacy transaction WITHOUT historical baseUnit (even if unitCostAtSale is present, AND a legacy return without baseUnit)
  // Must NOT guess baseUnit from catalog product.unit; must keep original record intact and flag NEEDS_REVIEW
  const legacySaleMissingBaseUnit: SaleRecord = {
    id: 'sale-legacy-no-baseunit',
    invoiceNo: 'INV-LEGACY-NOBU',
    date: '2026-10-01T10:00:00Z',
    amount: 160,
    paymentMethod: 'CASH',
    isCredit: false,
    status: 'COMPLETED',
    createdAt: '2026-10-01T10:00:00Z',
    items: [
      {
        productId: 'p-rice-imm',
        productName: 'Sona Masoori Rice',
        quantity: 2,
        unit: 'KG',
        unitCostAtSale: 80,
        rate: 80,
        total: 160,
      },
    ],
  };

  const legacyReturnMissingBaseUnit: CustomerTransaction = {
    id: 'ctx-legacy-ret-no-baseunit',
    customerId: 'cust-imm-1',
    type: 'RETURN',
    amount: 55,
    date: '2026-10-02T10:00:00Z',
    description: 'Legacy return missing baseUnit',
    status: 'COMPLETED',
    productId: 'p-rice-imm',
    quantity: 1,
    unit: 'KG',
    unitCostAtSale: 80,
    createdAt: '2026-10-02T10:00:00Z',
  };

  const legacyDataset: StoreBusinessDataset = {
    ...dataset,
    sales: [...dataset.sales, legacySaleMissingBaseUnit],
    customerTransactions: [...dataset.customerTransactions, legacyReturnMissingBaseUnit],
  };

  const legacyReport = generateAccountingReconciliationReport(legacyDataset);
  assert.equal(legacyReport.profitAudit.knownCogs, 190); // historical reconciled COGS untouched
  assert.equal(legacyReport.profitAudit.uncostedRevenue, 160);
  assert.equal(legacyReport.profitAudit.reviewStatus, 'NEEDS_REVIEW');
  assert.equal(legacyReport.profitAudit.unreconstructibleUnitItemsCount, 2);
  assert.ok(legacyReport.profitAudit.unreconstructibleUnitItemIds?.includes('sale-legacy-no-baseunit'));
  assert.ok(legacyReport.profitAudit.unreconstructibleUnitItemIds?.includes('ctx-legacy-ret-no-baseunit'));
  assert.ok(legacyReport.profitAudit.uncostedSaleIds?.includes('sale-legacy-no-baseunit'));
  assert.ok(legacyReport.profitAudit.uncostedReturnIds?.includes('ctx-legacy-ret-no-baseunit'));
  assert.ok(legacyReport.findings.some((f) => f.code === 'UNRECONSTRUCTIBLE_UNIT_CONVERSION'));
  assert.ok(legacyReport.findings.some((f) => f.code === 'UNCOSTED_RETURN_NEEDS_REVIEW'));
  // Original legacy records stay unmodified
  assert.equal(legacySaleMissingBaseUnit.items[0].baseUnit, undefined);
  assert.equal(legacyReturnMissingBaseUnit.baseUnit, undefined);
});

test('Customer Return Matching Edge Cases: multi-line invoice ambiguity, stable saleLineId matching, cancelled/reversed sale & return handling, partial returns, and immutable historical COGS', () => {
  const basmati: Product = {
    id: 'p-basmati-ret',
    name: 'Basmati Rice',
    category: 'Grains',
    unit: 'KG',
    purchasePrice: 80,
    sellingPrice: 120,
    stockQty: 50,
    minStockAlert: 5,
    updatedAt: '2026-11-01T09:00:00Z',
  };

  let dataset: StoreBusinessDataset = {
    ...createEmptyBusinessDataset(),
    profile: TEST_PROFILE,
    products: [basmati],
    customers: [
      {
        id: 'cust-edge-1',
        name: 'Vikram',
        phone: '9822200011',
        openingBalance: 0,
        currentBalance: 0,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: '2026-11-01T09:00:00Z',
      },
    ],
  };

  // Create a multi-line invoice where the SAME product appears twice with different historical costs:
  // Line 1: 2 KG @ cost ₹80/KG; Line 2: 1 KG @ cost ₹110/KG
  const multiLineSale: SaleRecord = {
    id: 'sale-multi-1',
    invoiceNo: 'INV-MULTI-1',
    date: '2026-11-05T10:00:00Z',
    customerId: 'cust-edge-1',
    customerName: 'Vikram',
    amount: 360,
    paymentMethod: 'CREDIT',
    isCredit: true,
    status: 'COMPLETED',
    createdAt: '2026-11-05T10:00:00Z',
    items: [
      {
        lineId: 'line-rice-lotA',
        productId: 'p-basmati-ret',
        productName: 'Basmati Rice',
        quantity: 2,
        unit: 'KG',
        baseUnit: 'KG',
        baseQuantity: 2,
        unitCostAtSale: 80,
        rate: 120,
        total: 240,
      },
      {
        lineId: 'line-rice-lotB',
        productId: 'p-basmati-ret',
        productName: 'Basmati Rice',
        quantity: 1,
        unit: 'KG',
        baseUnit: 'KG',
        baseQuantity: 1,
        unitCostAtSale: 110,
        rate: 120,
        total: 120,
      },
    ],
  };

  // Also test prepareAtomicSale assigns unique stable lineIds across duplicate-product lines
  const autoSaleRes = prepareAtomicSale(dataset, {
    amount: 360,
    paymentMethod: 'CASH',
    date: '2026-11-04T10:00:00Z',
    items: [
      { productId: 'p-basmati-ret', productName: 'Basmati Rice', quantity: 2, unit: 'KG', rate: 120, total: 240 },
      { productId: 'p-basmati-ret', productName: 'Basmati Rice', quantity: 1, unit: 'KG', rate: 120, total: 120 },
    ],
  });
  assert.equal(autoSaleRes.success, true);
  const autoSaleItems = autoSaleRes.nextDataset!.sales[0].items;
  assert.ok(autoSaleItems[0].lineId && autoSaleItems[1].lineId);
  assert.notEqual(autoSaleItems[0].lineId, autoSaleItems[1].lineId);

  // Edit catalog product AFTER sale (incompatible unit KG -> BAG and inflated purchasePrice 3000)
  const editedProduct: Product = {
    ...basmati,
    unit: 'BAG',
    purchasePrice: 3000,
    stockQty: 12,
  };
  dataset = {
    ...dataset,
    products: [editedProduct],
    sales: [multiLineSale],
  };

  // 1) Ambiguous return WITHOUT saleLineId: must NOT silently pick line 1 (₹80)
  const ambigMatch = matchOriginalSaleLine({
    sales: dataset.sales,
    invoiceNo: 'INV-MULTI-1',
    productId: 'p-basmati-ret',
    productName: 'Basmati Rice',
  });
  assert.equal(ambigMatch.status, 'AMBIGUOUS_SALE_LINE');
  assert.equal(ambigMatch.matchedLine, undefined);

  const ambigEnriched = enrichCustomerReturnItemsWithSaleCost({
    items: [{ productId: 'p-basmati-ret', productName: 'Basmati Rice', quantity: 0.5, unit: 'KG' }],
    sales: dataset.sales,
    products: dataset.products,
    invoiceNo: 'INV-MULTI-1',
  });
  assert.equal(ambigEnriched[0].returnMatchStatus, 'AMBIGUOUS_SALE_LINE');
  assert.equal(ambigEnriched[0].unitCostAtSale, undefined);
  assert.equal(ambigEnriched[0].baseUnit, undefined);

  // Recording an ambiguous return without saleLineId flags needsManualReview and triggers NEEDS_REVIEW in P&L & reconciliation
  const ambigTxRes = prepareAtomicCustomerTransaction(dataset, {
    customerId: 'cust-edge-1',
    type: 'RETURN',
    amount: 60,
    invoiceNo: 'INV-MULTI-1',
    description: 'Ambiguous return without line ID',
    productId: 'p-basmati-ret',
    quantity: 500,
    unit: 'GM',
    date: '2026-11-06T10:00:00Z',
  });
  assert.equal(ambigTxRes.success, true);
  const ambigDataset = ambigTxRes.nextDataset!;
  assert.equal(ambigDataset.customerTransactions[0].needsManualReview, true);
  assert.equal(ambigDataset.customerTransactions[0].returnMatchStatus, 'AMBIGUOUS_SALE_LINE');
  assert.equal(ambigDataset.customerTransactions[0].items?.[0].unitCostAtSale, undefined);

  const ambigReport = generateAccountingReconciliationReport(ambigDataset);
  assert.equal(ambigReport.profitAudit.reviewStatus, 'NEEDS_REVIEW');
  assert.equal(ambigReport.profitAudit.ambiguousReturnsCount, 1);
  assert.ok(ambigReport.findings.some((f) => f.code === 'AMBIGUOUS_RETURN_MATCH'));
  // Original multi-line COGS = (2*80) + (1*110) = 270; ambiguous return must NOT invent COGS deduction
  assert.equal(ambigReport.profitAudit.knownCogs, 270);

  // 2) Targeted return WITH stable saleLineId = 'line-rice-lotB' (500 GM of Lot B @ ₹110/KG => COGS reversal = ₹55)
  // Catalog unit = BAG and purchasePrice = 3000 must NEVER alter historical return COGS
  const targetedReturnRes = prepareAtomicCustomerTransaction(dataset, {
    customerId: 'cust-edge-1',
    type: 'RETURN',
    amount: 60,
    invoiceNo: 'INV-MULTI-1',
    saleLineId: 'line-rice-lotB',
    description: 'Partial return from Lot B',
    productId: 'p-basmati-ret',
    quantity: 500,
    unit: 'GM',
    date: '2026-11-06T11:00:00Z',
  });
  assert.equal(targetedReturnRes.success, true);
  const targetedDataset = targetedReturnRes.nextDataset!;
  const targetedTx = targetedDataset.customerTransactions[0];
  assert.equal(targetedTx.needsManualReview, undefined);
  assert.equal(targetedTx.returnMatchStatus, 'MATCHED_LINE');
  assert.equal(targetedTx.saleLineId, 'line-rice-lotB');
  assert.equal(targetedTx.items?.[0].baseUnit, 'KG');
  assert.equal(targetedTx.items?.[0].baseQuantity, 0.5);
  assert.equal(targetedTx.items?.[0].unitCostAtSale, 110);

  const pnlTargeted = calculateProfitAndLoss(
    targetedDataset.sales,
    targetedDataset.expenses,
    new Map(targetedDataset.products.map((p) => [p.id, p])),
    targetedDataset.customerTransactions
  );
  // Gross COGS = 270; Returned COGS = 0.5 * 110 = 55 -> Net COGS = 215
  assert.equal(pnlTargeted.cogs, 215);
  assert.equal(pnlTargeted.totalRevenue, 300); // 360 - 60
  assert.equal(pnlTargeted.reviewStatus, 'RECONCILED');

  // 3) Cancelled/Reversed return must be excluded from P&L COGS & revenue, and active return pointing to cancelled sale is flagged NEEDS_REVIEW
  const cancelledSaleRes = prepareAtomicCancelSale(
    {
      ...dataset,
      sales: [{ ...multiLineSale, id: 'sale-to-cancel', invoiceNo: 'INV-CANC-1' }],
    },
    'sale-to-cancel',
    'Wrong invoice'
  );
  assert.equal(cancelledSaleRes.success, true);

  const legacyReturnOnCancelledSale: CustomerTransaction = {
    id: 'ctx-ret-on-cancelled',
    customerId: 'cust-edge-1',
    type: 'RETURN',
    amount: 120,
    invoiceNo: 'INV-CANC-1',
    date: '2026-11-07T10:00:00Z',
    description: 'Return linked to cancelled bill',
    status: 'COMPLETED',
    productId: 'p-basmati-ret',
    quantity: 1,
    unit: 'KG',
    baseUnit: 'KG',
    baseQuantity: 1,
    unitCostAtSale: 80,
    createdAt: '2026-11-07T10:00:00Z',
  };
  const reversedReturnTx: CustomerTransaction = {
    id: 'ctx-ret-reversed',
    customerId: 'cust-edge-1',
    type: 'RETURN',
    amount: 60,
    invoiceNo: 'INV-MULTI-1',
    saleLineId: 'line-rice-lotB',
    date: '2026-11-07T11:00:00Z',
    description: 'Reversed return',
    status: 'REVERSED',
    items: [
      {
        productId: 'p-basmati-ret',
        productName: 'Basmati Rice',
        quantity: 0.5,
        unit: 'KG',
        baseUnit: 'KG',
        baseQuantity: 0.5,
        saleLineId: 'line-rice-lotB',
        unitCostAtSale: 110,
      },
    ],
    createdAt: '2026-11-07T11:00:00Z',
  };

  const pnlCancelledCheck = calculateProfitAndLoss(
    [multiLineSale, ...cancelledSaleRes.nextDataset!.sales],
    [],
    new Map(targetedDataset.products.map((p) => [p.id, p])),
    [...targetedDataset.customerTransactions, reversedReturnTx, legacyReturnOnCancelledSale]
  );
  // Cancelled sale excluded; reversed return excluded; active return on cancelled sale flagged NEEDS_REVIEW and does not deduct COGS
  assert.equal(pnlCancelledCheck.cogs, 215);
  assert.equal(pnlCancelledCheck.reviewStatus, 'NEEDS_REVIEW');
  assert.equal(pnlCancelledCheck.ambiguousReturnsCount, 1);
  assert.ok(pnlCancelledCheck.ambiguousReturnIds.includes('ctx-ret-on-cancelled'));
});

test('Dashboard Accounting Accuracy Repair: 0% coverage, partial coverage, 100% verified, ambiguous returns, 6-month trends, and missing cost != 0', () => {
  const rice: Product = {
    id: 'p-dash-rice',
    name: 'Sonamasoori Rice',
    category: 'Grains',
    unit: 'KG',
    purchasePrice: 60,
    sellingPrice: 100,
    stockQty: 100,
    minStockAlert: 10,
    updatedAt: '2026-06-01T00:00:00Z',
  };
  const productsMap = new Map<string, Product>([[rice.id, rice]]);

  // 1) 0% cost coverage & 6) Missing historical cost must NEVER be interpreted as ₹0 purchase cost or 100% margin
  const uncostedSale: SaleRecord = {
    id: 'sale-zero-cov',
    invoiceNo: 'INV-Z-01',
    date: '2026-11-10T10:00:00Z',
    amount: 5000,
    paymentMethod: 'CASH',
    isCredit: false,
    status: 'COMPLETED',
    createdAt: '2026-11-10T10:00:00Z',
    items: [
      {
        lineId: 'line-z-1',
        productId: rice.id,
        productName: rice.name,
        quantity: 50,
        unit: 'KG',
        baseUnit: 'KG',
        baseQuantity: 50,
        // unitCostAtSale intentionally missing
        rate: 100,
        total: 5000,
      },
    ],
  };
  const opExpense: ExpenseRecord = {
    id: 'exp-z-1',
    title: 'Shop Electricity',
    category: 'ELECTRICITY',
    amount: 500,
    isPersonalWithdrawal: false,
    paymentMethod: 'CASH',
    date: '2026-11-10T12:00:00Z',
    createdAt: '2026-11-10T12:00:00Z',
  };

  const zeroPnl = calculateProfitAndLoss([uncostedSale], [opExpense], productsMap, []);
  assert.equal(zeroPnl.costCoveragePct, 0);
  assert.equal(zeroPnl.uncostedRevenue, 5000);
  assert.equal(zeroPnl.cogs, 0);
  assert.equal(zeroPnl.hasCompleteCogs, false);
  assert.equal(zeroPnl.isProfitVerified, false);
  assert.equal(zeroPnl.reviewStatus, 'UNCOSTED');
  assert.equal(zeroPnl.profitStatus, 'UNCOSTED');
  assert.equal(zeroPnl.verifiedGrossProfit, null);
  assert.equal(zeroPnl.verifiedGrossMarginPct, null);
  assert.equal(zeroPnl.verifiedNetOperatingProfit, null);
  assert.equal(zeroPnl.verifiedNetMarginPct, null);
  assert.equal(zeroPnl.knownCostGrossProfit, null);
  assert.equal(zeroPnl.knownCostGrossMarginPct, null);
  assert.equal(zeroPnl.grossMarginPct, 0); // NEVER 100%

  const zeroDaily = calculateDailyProfitMarginTrend([uncostedSale], [opExpense], productsMap, 14);
  assert.equal(zeroDaily.length, 1);
  assert.equal(zeroDaily[0].costCoveragePct, 0);
  assert.equal(zeroDaily[0].reviewStatus, 'UNCOSTED');
  assert.equal(zeroDaily[0].isProfitVerified, false);
  assert.equal(zeroDaily[0].verifiedGrossProfit, null);
  assert.equal(zeroDaily[0].knownCostGrossProfit, null);
  assert.equal(zeroDaily[0].grossMarginPct, 0);

  const zeroCat = calculateCategoryProfitability({
    products: [rice],
    sales: [uncostedSale],
    expenses: [opExpense],
  });
  assert.equal(zeroCat.isProfitVerified, false);
  assert.equal(zeroCat.reviewStatus, 'UNCOSTED');
  assert.equal(zeroCat.costCoveragePct, 0);
  assert.equal(zeroCat.verifiedTotalGrossProfit, null);
  assert.equal(zeroCat.verifiedTotalNetProfit, null);
  assert.equal(zeroCat.categories[0].grossMarginPct, 0);

  // 2) Partial cost coverage must be visibly identified and separate known-cost profit from uncosted revenue
  const costedSale400: SaleRecord = {
    id: 'sale-part-1',
    invoiceNo: 'INV-P-01',
    date: '2026-11-11T10:00:00Z',
    amount: 400,
    paymentMethod: 'CASH',
    isCredit: false,
    status: 'COMPLETED',
    createdAt: '2026-11-11T10:00:00Z',
    items: [
      {
        lineId: 'line-p-1',
        productId: rice.id,
        productName: rice.name,
        quantity: 4,
        unit: 'KG',
        baseUnit: 'KG',
        baseQuantity: 4,
        unitCostAtSale: 75, // COGS = 300, margin on costed = 100 / 400 = 25%
        rate: 100,
        total: 400,
      },
    ],
  };
  const uncostedSale600: SaleRecord = {
    id: 'sale-part-2',
    invoiceNo: 'INV-P-02',
    date: '2026-11-11T11:00:00Z',
    amount: 600,
    paymentMethod: 'UPI',
    isCredit: false,
    status: 'COMPLETED',
    createdAt: '2026-11-11T11:00:00Z',
    items: [], // quick bill without cost
  };
  const partialPnl = calculateProfitAndLoss([costedSale400, uncostedSale600], [], productsMap, []);
  assert.equal(partialPnl.totalRevenue, 1000);
  assert.equal(partialPnl.costedRevenue, 400);
  assert.equal(partialPnl.uncostedRevenue, 600);
  assert.equal(partialPnl.costCoveragePct, 40);
  assert.equal(partialPnl.hasCompleteCogs, false);
  assert.equal(partialPnl.isProfitVerified, false);
  assert.equal(partialPnl.reviewStatus, 'UNCOSTED');
  assert.equal(partialPnl.profitStatus, 'PROVISIONAL_PARTIAL');
  assert.equal(partialPnl.verifiedGrossProfit, null);
  assert.equal(partialPnl.verifiedGrossMarginPct, null);
  assert.equal(partialPnl.knownCostGrossProfit, 100);
  assert.equal(partialPnl.knownCostGrossMarginPct, 25);

  // 3) 100% cost coverage with no unresolved returns may display verified profit
  const verifiedSale: SaleRecord = {
    id: 'sale-ver-1',
    invoiceNo: 'INV-V-01',
    date: '2026-11-12T10:00:00Z',
    amount: 1000,
    paymentMethod: 'CASH',
    isCredit: false,
    status: 'COMPLETED',
    createdAt: '2026-11-12T10:00:00Z',
    items: [
      {
        lineId: 'line-v-1',
        productId: rice.id,
        productName: rice.name,
        quantity: 10,
        unit: 'KG',
        baseUnit: 'KG',
        baseQuantity: 10,
        unitCostAtSale: 75, // COGS = 750
        rate: 100,
        total: 1000,
      },
    ],
  };
  const verifiedExpense: ExpenseRecord = {
    id: 'exp-v-1',
    title: 'Packing Bags',
    category: 'SHOP',
    amount: 100,
    isPersonalWithdrawal: false,
    paymentMethod: 'CASH',
    date: '2026-11-12T11:00:00Z',
    createdAt: '2026-11-12T11:00:00Z',
  };
  const verifiedPnl = calculateProfitAndLoss([verifiedSale], [verifiedExpense], productsMap, []);
  assert.equal(verifiedPnl.costCoveragePct, 100);
  assert.equal(verifiedPnl.uncostedRevenue, 0);
  assert.equal(verifiedPnl.hasCompleteCogs, true);
  assert.equal(verifiedPnl.reviewStatus, 'RECONCILED');
  assert.equal(verifiedPnl.profitStatus, 'VERIFIED');
  assert.equal(verifiedPnl.isProfitVerified, true);
  assert.equal(verifiedPnl.verifiedGrossProfit, 250);
  assert.equal(verifiedPnl.verifiedGrossMarginPct, 25);
  assert.equal(verifiedPnl.verifiedNetOperatingProfit, 150);
  assert.equal(verifiedPnl.verifiedNetMarginPct, 15);

  // 4) Ambiguous returns must prevent verified profit status even when sales are 100% costed
  const ambiguousRet: CustomerTransaction = {
    id: 'ctx-ambig-dash',
    customerId: 'cust-dash-1',
    type: 'RETURN',
    amount: 200,
    invoiceNo: 'INV-V-01',
    date: '2026-11-12T14:00:00Z',
    description: 'Ambiguous return without clear saleLineId',
    status: 'COMPLETED',
    needsManualReview: true,
    returnMatchStatus: 'AMBIGUOUS_SALE_LINE',
    createdAt: '2026-11-12T14:00:00Z',
  };
  const ambigPnl = calculateProfitAndLoss([verifiedSale], [verifiedExpense], productsMap, [ambiguousRet]);
  assert.equal(ambigPnl.costCoveragePct, 100);
  assert.equal(ambigPnl.hasCompleteCogs, false);
  assert.equal(ambigPnl.reviewStatus, 'NEEDS_REVIEW');
  assert.equal(ambigPnl.profitStatus, 'NEEDS_REVIEW');
  assert.equal(ambigPnl.isProfitVerified, false);
  assert.equal(ambigPnl.verifiedGrossProfit, null);
  assert.equal(ambigPnl.verifiedGrossMarginPct, null);
  assert.equal(ambigPnl.verifiedNetOperatingProfit, null);
  assert.equal(ambigPnl.ambiguousReturnsCount, 1);

  // 5) Monthly 6-month calculations must preserve incomplete-cost & review warnings
  const septVerifiedSale: SaleRecord = {
    ...verifiedSale,
    id: 'sale-sept',
    invoiceNo: 'INV-SEP',
    date: '2026-09-15T10:00:00Z',
    createdAt: '2026-09-15T10:00:00Z',
  };
  const octUncostedSale: SaleRecord = {
    ...uncostedSale,
    id: 'sale-oct',
    invoiceNo: 'INV-OCT',
    amount: 2000,
    date: '2026-10-15T10:00:00Z',
    createdAt: '2026-10-15T10:00:00Z',
    items: [
      {
        ...uncostedSale.items![0],
        quantity: 20,
        baseQuantity: 20,
        total: 2000,
      },
    ],
  };
  const novPartialSales = [costedSale400, uncostedSale600];

  const monthlyTrend = calculateMonthlyProfitTrend(
    [septVerifiedSale, octUncostedSale, ...novPartialSales],
    [verifiedExpense],
    productsMap,
    [],
    6,
    new Date('2026-11-16T12:00:00Z')
  );
  assert.equal(monthlyTrend.length, 6);

  const septPoint = monthlyTrend.find((m) => m.prefix === '2026-09')!;
  assert.equal(septPoint.isProfitVerified, true);
  assert.equal(septPoint.reviewStatus, 'RECONCILED');
  assert.equal(septPoint.costCoveragePct, 100);
  assert.equal(septPoint.uncostedRevenue, 0);
  assert.equal(septPoint.verifiedGrossProfit, 250);

  const octPoint = monthlyTrend.find((m) => m.prefix === '2026-10')!;
  assert.equal(octPoint.totalSales, 2000);
  assert.equal(octPoint.costCoveragePct, 0);
  assert.equal(octPoint.uncostedRevenue, 2000);
  assert.equal(octPoint.hasCompleteCogs, false);
  assert.equal(octPoint.isProfitVerified, false);
  assert.equal(octPoint.reviewStatus, 'UNCOSTED');
  assert.equal(octPoint.verifiedGrossProfit, null);
  assert.equal(octPoint.knownCostGrossProfit, null);

  const novPoint = monthlyTrend.find((m) => m.prefix === '2026-11')!;
  assert.equal(novPoint.totalSales, 1000);
  assert.equal(novPoint.costCoveragePct, 40);
  assert.equal(novPoint.uncostedRevenue, 600);
  assert.equal(novPoint.hasCompleteCogs, false);
  assert.equal(novPoint.isProfitVerified, false);
  assert.equal(novPoint.reviewStatus, 'UNCOSTED');
  assert.equal(novPoint.profitStatus, 'PROVISIONAL_PARTIAL');
  assert.equal(novPoint.verifiedGrossProfit, null);
  assert.equal(novPoint.knownCostGrossProfit, 100);
});




