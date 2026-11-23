import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerTransaction, Product, SaleRecord } from '../types';
import { buildStockVelocityMonitorReport } from './stockVelocity';
import {
  buildWeeklySalesTrendData,
  computeStockCoverGaugePct,
  getCriticalStockWidgetData,
} from './dashboardTrends';

function makeLocalDateIso(base: Date, offsetDays: number): string {
  const d = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + offsetDays,
    11,
    30,
    0,
    0
  );
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}T11:30:00`;
}

function makeSale(
  id: string,
  date: string,
  amount: number,
  status: SaleRecord['status'] = 'COMPLETED'
): SaleRecord {
  return {
    id,
    invoiceNo: `INV-${id}`,
    date,
    amount,
    paymentMethod: 'CASH',
    isCredit: false,
    items: [],
    status,
    createdAt: date,
  };
}

test('buildWeeklySalesTrendData computes 7 daily sales points and exact 30-day moving average', () => {
  const now = new Date(2026, 10, 21, 14, 0, 0); // 21 Nov 2026
  const sales: SaleRecord[] = [];

  // Seed ₹300/day for days -35..-7 (29 days prior to the 7-day window)
  for (let offset = -35; offset <= -7; offset++) {
    sales.push(makeSale(`prior-${offset}`, makeLocalDateIso(now, offset), 300));
  }
  // Seed ₹600/day for the last 7 days (-6..0)
  for (let offset = -6; offset <= 0; offset++) {
    sales.push(makeSale(`week-${offset}`, makeLocalDateIso(now, offset), 600));
  }
  // Cancelled sale should be ignored
  sales.push(makeSale('cancelled-today', makeLocalDateIso(now, 0), 9999, 'CANCELLED'));

  // Active customer return of ₹100 today should reduce today's net sales to ₹500
  const customerTransactions: CustomerTransaction[] = [
    {
      id: 'ret-1',
      customerId: 'c-1',
      type: 'RETURN',
      amount: 100,
      date: makeLocalDateIso(now, 0),
      description: 'Damaged packet return',
      paymentMethod: 'CASH',
      status: 'COMPLETED',
      createdAt: makeLocalDateIso(now, 0),
    },
  ];

  const report = buildWeeklySalesTrendData({ sales, customerTransactions, now });

  assert.equal(report.points.length, 7);
  assert.equal(report.hasAnySales, true);

  // Day 0 of 7-day window (offset -6): 29 prior days * 300 + 1 day * 600 = 9300 / 30 = 310
  assert.equal(report.points[0].dailySales, 600);
  assert.equal(report.points[0].movingAvg30d, 310);

  // Last day (today, offset 0): 23 prior days * 300 (6900) + 6 days * 600 (3600) + today 500 = 11000 / 30 = 366.67
  const todayPoint = report.points[6];
  assert.equal(todayPoint.dailySales, 500);
  assert.equal(todayPoint.billsCount, 1);
  assert.equal(todayPoint.movingAvg30d, 366.67);

  // Weekly total: 6 * 600 + 500 = 4100
  assert.equal(report.weeklyTotal, 4100);
  assert.equal(report.weeklyDailyAvg, 585.71);
  assert.equal(report.currentMovingAvg30d, 366.67);
  assert.ok((report.vsMovingAvgPct ?? 0) > 50);
});

test('buildWeeklySalesTrendData handles empty sales cleanly with 7 zeroed days', () => {
  const now = new Date(2026, 10, 21, 14, 0, 0);
  const report = buildWeeklySalesTrendData({ sales: [], now });
  assert.equal(report.points.length, 7);
  assert.equal(report.weeklyTotal, 0);
  assert.equal(report.currentMovingAvg30d, 0);
  assert.equal(report.vsMovingAvgPct, null);
  assert.equal(report.peakDay, null);
  assert.equal(report.hasAnySales, false);
});

test('getCriticalStockWidgetData highlights REORDER items from 30-day velocity and computes cover gauges', () => {
  const now = new Date(2026, 10, 21, 14, 0, 0);
  const updatedAt = makeLocalDateIso(now, -1);
  const products: Product[] = [
    {
      id: 'p-rice',
      name: 'Basmati Rice',
      category: 'Grains',
      unit: 'kg',
      purchasePrice: 90,
      sellingPrice: 120,
      stockQty: 3, // sells 2 kg/day => 1.5 days cover => REORDER
      minStockAlert: 10,
      isArchived: false,
      updatedAt,
    },
    {
      id: 'p-oil',
      name: 'Mustard Oil',
      category: 'Oils',
      unit: 'litre',
      purchasePrice: 140,
      sellingPrice: 170,
      stockQty: 0, // out of stock => REORDER
      minStockAlert: 5,
      isArchived: false,
      updatedAt,
    },
    {
      id: 'p-sugar',
      name: 'Refined Sugar',
      category: 'Staples',
      unit: 'kg',
      purchasePrice: 40,
      sellingPrice: 48,
      stockQty: 10, // sells 1 kg/day => 10 days cover => LOW_STOCK
      minStockAlert: 5,
      isArchived: false,
      updatedAt,
    },
    {
      id: 'p-salt',
      name: 'Iodized Salt',
      category: 'Staples',
      unit: 'pkt',
      purchasePrice: 20,
      sellingPrice: 25,
      stockQty: 100, // HEALTHY
      minStockAlert: 10,
      isArchived: false,
      updatedAt,
    },
  ];

  const sales: SaleRecord[] = [
    {
      id: 's-1',
      invoiceNo: 'INV-1',
      date: makeLocalDateIso(now, -2),
      amount: 8640,
      paymentMethod: 'CASH',
      isCredit: false,
      status: 'COMPLETED',
      createdAt: makeLocalDateIso(now, -2),
      items: [
        {
          productId: 'p-rice',
          productName: 'Basmati Rice',
          quantity: 60,
          baseQuantity: 60,
          unit: 'kg',
          rate: 120,
          total: 7200,
        },
        {
          productId: 'p-sugar',
          productName: 'Refined Sugar',
          quantity: 30,
          baseQuantity: 30,
          unit: 'kg',
          rate: 48,
          total: 1440,
        },
      ],
    },
  ];

  const velocityReport = buildStockVelocityMonitorReport({ products, sales, now });
  const widgetData = getCriticalStockWidgetData(velocityReport, 5);

  assert.equal(widgetData.criticalCount, 2);
  assert.equal(widgetData.lowStockCount, 1);
  assert.equal(widgetData.outOfStockCount, 1);
  assert.equal(widgetData.displayItems.length, 3);
  assert.equal(widgetData.displayItems[0].product.id, 'p-oil');
  assert.equal(widgetData.displayItems[1].product.id, 'p-rice');
  assert.equal(computeStockCoverGaugePct(widgetData.displayItems[0]), 0);
  assert.ok(computeStockCoverGaugePct(widgetData.displayItems[1]) > 0);
  assert.ok(computeStockCoverGaugePct(widgetData.displayItems[1]) < 25);
  assert.ok(widgetData.estimatedCriticalReorderCost > 0);
});
