import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSalesForecastInputSummary,
  calculateCategoryProfitability,
  calculateCustomer6MonthPaymentHistory,
  getNext7ForecastDates,
  normalizeSalesForecastResponse,
} from './analyticsMetrics';
import {
  CustomerTransaction,
  ExpenseRecord,
  Product,
  SaleRecord,
  SupplierTransaction,
} from '../types';

test('calculateCategoryProfitability computes gross, allocated expenses, and net profit margin per category', () => {
  const products: Product[] = [
    {
      id: 'p1',
      name: 'Chakki Atta 10kg',
      category: 'Staples & Grains',
      purchasePrice: 340,
      sellingPrice: 400,
      stockQty: 20,
      unit: 'bag',
      minStockAlert: 5,
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'p2',
      name: 'Masala Chai 250g',
      category: 'Beverages',
      purchasePrice: 100,
      sellingPrice: 150,
      stockQty: 15,
      unit: 'pkt',
      minStockAlert: 5,
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  // Historical supplier purchase overrides baseline product cost to ₹320 for p1
  const supplierTransactions: SupplierTransaction[] = [
    {
      id: 'st1',
      supplierId: 'sup1',
      type: 'PURCHASE',
      amount: 3200,
      date: '2026-11-02',
      paymentStatus: 'PAID',
      description: 'Atta restock',
      productId: 'p1',
      quantity: 10,
      unitPrice: 320,
      createdAt: '2026-11-02T10:00:00Z',
    },
  ];

  const sales: SaleRecord[] = [
    {
      id: 's1',
      invoiceNo: 'INV-1',
      date: '2026-11-05',
      amount: 2000,
      paymentMethod: 'CASH',
      isCredit: false,
      createdAt: '2026-11-05T10:00:00Z',
      items: [
        {
          productId: 'p1',
          productName: 'Chakki Atta 10kg',
          quantity: 5,
          unit: 'bag',
          baseUnit: 'BAG',
          baseQuantity: 5,
          unitCostAtSale: 320,
          rate: 400,
          total: 2000,
        },
      ],
    },
    {
      id: 's2',
      invoiceNo: 'INV-2',
      date: '2026-11-06',
      amount: 1000,
      paymentMethod: 'UPI',
      isCredit: false,
      createdAt: '2026-11-06T12:00:00Z',
      items: [
        {
          productId: 'p2',
          productName: 'Masala Chai 250g',
          quantity: 6,
          unit: 'pkt',
          baseUnit: 'PACKET',
          baseQuantity: 6,
          unitCostAtSale: 100,
          rate: 150,
          total: 900,
        },
        {
          productId: 'p2',
          productName: 'Masala Chai 250g',
          quantity: 1,
          unit: 'pkt',
          baseUnit: 'PACKET',
          baseQuantity: 1,
          unitCostAtSale: 100,
          rate: 100,
          total: 100,
        },
      ],
    },
  ];

  // Operating expense = 300; personal drawing = 500 (must be excluded)
  const expenses: ExpenseRecord[] = [
    {
      id: 'e1',
      title: 'Electricity',
      category: 'ELECTRICITY',
      amount: 300,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      date: '2026-11-06',
      createdAt: '2026-11-06T15:00:00Z',
    },
    {
      id: 'e2',
      title: 'Home Drawing',
      category: 'PERSONAL_DRAWING',
      amount: 500,
      isPersonalWithdrawal: true,
      paymentMethod: 'CASH',
      date: '2026-11-06',
      createdAt: '2026-11-06T16:00:00Z',
    },
  ];

  // Mutating current catalog purchasePrice AND unit MUST NOT alter historical realized category COGS
  const inflatedProducts: Product[] = products.map((p) =>
    p.id === 'p1'
      ? { ...p, unit: 'KG', purchasePrice: 999, lastPurchasePrice: 999 }
      : p
  );

  const res = calculateCategoryProfitability({
    products: inflatedProducts,
    sales,
    expenses,
    supplierTransactions,
  });

  assert.equal(res.totalRevenue, 3000);
  assert.equal(res.totalOperatingExpenses, 300);
  // p1 COGS: 5 * 320 = 1600, revenue = 2000, gross = 400, allocExp = 200, net = 200 (10%)
  const staples = res.categories.find((c) => c.category === 'Staples & Grains')!;
  assert.equal(staples.salesRevenue, 2000);
  assert.equal(staples.cogs, 1600);
  assert.equal(staples.uncostedRevenue, 0);
  assert.equal(staples.grossProfit, 400);
  assert.equal(staples.allocatedExpenses, 200);
  assert.equal(staples.netProfit, 200);
  assert.equal(staples.netMarginPct, 10);

  // p2 COGS: 7 * 100 = 700, revenue = 1000, gross = 300, allocExp = 100, net = 200 (20%)
  const beverages = res.categories.find((c) => c.category === 'Beverages')!;
  assert.equal(beverages.salesRevenue, 1000);
  assert.equal(beverages.cogs, 700);
  assert.equal(beverages.grossProfit, 300);
  assert.equal(beverages.allocatedExpenses, 100);
  assert.equal(beverages.netProfit, 200);
  assert.equal(beverages.netMarginPct, 20);
  assert.equal(res.topNetMarginCategory?.category, 'Beverages');

  // Legacy uncosted sales lines must stay uncosted rather than falling back to product.purchasePrice
  const legacyUncostedRes = calculateCategoryProfitability({
    products: inflatedProducts,
    sales: [
      {
        id: 's-legacy',
        invoiceNo: 'INV-OLD',
        date: '2026-10-01',
        amount: 800,
        paymentMethod: 'CASH',
        isCredit: false,
        createdAt: '2026-10-01T10:00:00Z',
        items: [{ productId: 'p1', productName: 'Chakki Atta 10kg', quantity: 2, unit: 'bag', rate: 400, total: 800 }],
      },
    ],
    expenses: [],
  });
  const legacyStaples = legacyUncostedRes.categories.find((c) => c.category === 'Staples & Grains')!;
  assert.equal(legacyStaples.cogs, 0);
  assert.equal(legacyStaples.uncostedRevenue, 800);
});

test('calculateCustomer6MonthPaymentHistory aggregates 6 monthly buckets ignoring cancelled entries', () => {
  const txs: CustomerTransaction[] = [
    {
      id: 't1',
      customerId: 'c1',
      type: 'CREDIT',
      amount: 1200,
      date: '2026-09-10',
      description: 'Groceries',
      status: 'COMPLETED',
      createdAt: '2026-09-10T10:00:00Z',
    },
    {
      id: 't2',
      customerId: 'c1',
      type: 'PAYMENT',
      amount: 1000,
      date: '2026-09-15',
      description: 'Cash payment',
      status: 'COMPLETED',
      createdAt: '2026-09-15T10:00:00Z',
    },
    {
      id: 't3',
      customerId: 'c1',
      type: 'PAYMENT',
      amount: 9999,
      date: '2026-10-05',
      description: 'Wrong entry',
      status: 'CANCELLED',
      createdAt: '2026-10-05T10:00:00Z',
    },
    {
      id: 't4',
      customerId: 'c1',
      type: 'PAYMENT',
      amount: 600,
      date: '2026-11-04',
      description: 'UPI settlement',
      status: 'COMPLETED',
      createdAt: '2026-11-04T10:00:00Z',
    },
    {
      id: 't5',
      customerId: 'c2',
      type: 'PAYMENT',
      amount: 5000,
      date: '2026-11-04',
      description: 'Other customer',
      status: 'COMPLETED',
      createdAt: '2026-11-04T10:00:00Z',
    },
  ];

  const refDate = new Date(2026, 10, 14); // Nov 14, 2026
  const summary = calculateCustomer6MonthPaymentHistory('c1', txs, refDate, 6);

  assert.equal(summary.monthlyData.length, 6);
  assert.equal(summary.monthlyData[0].monthKey, '2026-06');
  assert.equal(summary.monthlyData[5].monthKey, '2026-11');
  assert.equal(summary.totalPayments6M, 1600);
  assert.equal(summary.totalCredit6M, 1200);
  assert.equal(summary.creditTrend, 'IMPROVING');
  assert.equal(summary.bestPaymentMonth?.monthKey, '2026-09');
  assert.equal(summary.monthlyData[4].paymentsReceived, 0); // cancelled Oct payment ignored
});

test('buildSalesForecastInputSummary and normalizeSalesForecastResponse produce valid 7-day forecast structures', () => {
  const sales: SaleRecord[] = [
    {
      id: 's1',
      invoiceNo: 'B1',
      date: '2026-11-10',
      amount: 2100,
      paymentMethod: 'CASH',
      isCredit: false,
      items: [],
      createdAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 's2',
      invoiceNo: 'B2',
      date: '2026-11-14',
      amount: 3500,
      paymentMethod: 'UPI',
      isCredit: false,
      items: [],
      createdAt: '2026-11-14T11:00:00Z',
    },
  ];

  const payload = buildSalesForecastInputSummary(sales, [], [], '2026-11-14');
  assert.equal(payload.referenceDateKey, '2026-11-14');
  assert.equal(payload.historyDays.length, 30);
  assert.equal(payload.recent7DayTotal, 5600);
  assert.equal(payload.dayOfWeekAverages.length, 7);

  const slots = getNext7ForecastDates('2026-11-14');
  assert.equal(slots.length, 7);
  assert.equal(slots[0].date, '2026-11-15');
  assert.equal(slots[6].date, '2026-11-21');

  const normalized = normalizeSalesForecastResponse(
    {
      summary: 'Strong weekend demand ahead.',
      trendDirection: 'UP',
      dailyForecast: [
        { predictedAmount: 3600, lowEstimate: 3100, highEstimate: 4100, driver: 'Sunday family shopping' },
        { predictedAmount: 2900 },
      ],
      recommendations: ['Stock extra Atta before Sunday'],
    },
    '2026-11-14'
  );

  assert.equal(normalized.dailyForecast.length, 7);
  assert.equal(normalized.dailyForecast[0].predictedAmount, 3600);
  assert.equal(normalized.dailyForecast[1].lowEstimate, Math.round(2900 * 0.85));
  assert.equal(normalized.trendDirection, 'UP');
  assert.equal(normalized.recommendations[0], 'Stock extra Atta before Sunday');
});
