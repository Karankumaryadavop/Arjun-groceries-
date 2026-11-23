import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStockVelocityMonitorReport } from './stockVelocity';
import { Product, SaleRecord } from '../types';

const NOW = new Date('2026-11-20T12:00:00.000Z');

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const sampleProducts: Product[] = [
  {
    id: 'p-fast-reorder',
    name: 'Amul Taaza Milk 1L',
    category: 'Dairy',
    purchasePrice: 54,
    sellingPrice: 60,
    stockQty: 12,
    unit: 'L',
    minStockAlert: 5, // Still above static minStockAlert, but 30-day velocity is 3/day => 4 days left => REORDER!
    updatedAt: daysAgoIso(1),
  },
  {
    id: 'p-medium-low',
    name: 'Toor Dal Premium',
    category: 'Pulses',
    purchasePrice: 130,
    sellingPrice: 155,
    stockQty: 10,
    unit: 'kg',
    minStockAlert: 4, // Velocity 1 kg/day => 10 days left (<= 14 days warning) => LOW_STOCK!
    updatedAt: daysAgoIso(1),
  },
  {
    id: 'p-healthy',
    name: 'Tata Salt 1kg',
    category: 'Spices',
    purchasePrice: 20,
    sellingPrice: 26,
    stockQty: 60,
    unit: 'pkt',
    minStockAlert: 10, // Velocity 1/day => 60 days left => HEALTHY!
    updatedAt: daysAgoIso(1),
  },
  {
    id: 'p-out',
    name: 'Fortune Mustard Oil',
    category: 'Oils',
    purchasePrice: 140,
    sellingPrice: 165,
    stockQty: 0,
    unit: 'L',
    minStockAlert: 6,
    updatedAt: daysAgoIso(1),
  },
];

const sampleSales: SaleRecord[] = [
  // 90 L sold over last 30 days => 3 L/day for Amul Milk
  {
    id: 's-1',
    invoiceNo: 'INV-1',
    date: daysAgoIso(5),
    createdAt: daysAgoIso(5),
    amount: 3600,
    paymentMethod: 'CASH',
    isCredit: false,
    items: [
      {
        productId: 'p-fast-reorder',
        productName: 'Amul Taaza Milk 1L',
        quantity: 60,
        unit: 'L',
        baseQuantity: 60,
        rate: 60,
        total: 3600,
      },
    ],
  },
  {
    id: 's-2',
    invoiceNo: 'INV-2',
    date: daysAgoIso(15),
    createdAt: daysAgoIso(15),
    amount: 1800,
    paymentMethod: 'UPI',
    isCredit: false,
    items: [
      {
        productId: 'p-fast-reorder',
        productName: 'Amul Taaza Milk 1L',
        quantity: 30,
        unit: 'L',
        baseQuantity: 30,
        rate: 60,
        total: 1800,
      },
    ],
  },
  // Cancelled sale should be IGNORED
  {
    id: 's-cancelled',
    invoiceNo: 'INV-VOID',
    date: daysAgoIso(2),
    createdAt: daysAgoIso(2),
    amount: 2600,
    paymentMethod: 'CASH',
    isCredit: false,
    status: 'CANCELLED',
    items: [
      {
        productId: 'p-healthy',
        productName: 'Tata Salt 1kg',
        quantity: 100,
        unit: 'pkt',
        baseQuantity: 100,
        rate: 26,
        total: 2600,
      },
    ],
  },
  // Old sale > 30 days ago should be IGNORED
  {
    id: 's-old',
    invoiceNo: 'INV-OLD',
    date: daysAgoIso(45),
    createdAt: daysAgoIso(45),
    amount: 2600,
    paymentMethod: 'CASH',
    isCredit: false,
    items: [
      {
        productId: 'p-healthy',
        productName: 'Tata Salt 1kg',
        quantity: 100,
        unit: 'pkt',
        baseQuantity: 100,
        rate: 26,
        total: 2600,
      },
    ],
  },
  // Toor dal sold in grams (30,000 gm = 30 kg over 30 days => 1 kg/day)
  {
    id: 's-3',
    invoiceNo: 'INV-3',
    date: daysAgoIso(8),
    createdAt: daysAgoIso(8),
    amount: 4650,
    paymentMethod: 'CASH',
    isCredit: false,
    items: [
      {
        productId: 'p-medium-low',
        productName: 'Toor Dal Premium',
        quantity: 30000,
        unit: 'GM',
        rate: 155,
        total: 4650,
      },
    ],
  },
  // Tata Salt 30 pkts in last 30 days => 1/day
  {
    id: 's-4',
    invoiceNo: 'INV-4',
    date: daysAgoIso(10),
    createdAt: daysAgoIso(10),
    amount: 780,
    paymentMethod: 'CASH',
    isCredit: false,
    items: [
      {
        productId: 'p-healthy',
        productName: 'Tata Salt 1kg',
        quantity: 30,
        unit: 'pkt',
        baseQuantity: 30,
        rate: 26,
        total: 780,
      },
    ],
  },
];

test('buildStockVelocityMonitorReport flags Reorder and Low Stock based on 30-day sales velocity', () => {
  const report = buildStockVelocityMonitorReport({
    products: sampleProducts,
    sales: sampleSales,
    now: NOW,
  });

  const byId = new Map(report.items.map((it) => [it.product.id, it]));

  const milk = byId.get('p-fast-reorder')!;
  assert.equal(milk.soldLast30Days, 90);
  assert.equal(milk.dailySalesVelocity, 3);
  assert.equal(milk.daysOfStockLeft, 4);
  assert.equal(milk.flag, 'REORDER');
  assert.equal(milk.flagLabel, 'Reorder');
  // targetCoverDays = 21 => 21*3 = 63 target - 12 stock = 51
  assert.equal(milk.recommendedReorderQty, 51);

  const dal = byId.get('p-medium-low')!;
  assert.equal(dal.soldLast30Days, 30);
  assert.equal(dal.dailySalesVelocity, 1);
  assert.equal(dal.daysOfStockLeft, 10);
  assert.equal(dal.flag, 'LOW_STOCK');
  assert.equal(dal.flagLabel, 'Low Stock');
  // targetCoverDays = 21 => 21 - 10 = 11
  assert.equal(dal.recommendedReorderQty, 11);

  const salt = byId.get('p-healthy')!;
  // Cancelled and >30d sales excluded!
  assert.equal(salt.soldLast30Days, 30);
  assert.equal(salt.dailySalesVelocity, 1);
  assert.equal(salt.daysOfStockLeft, 60);
  assert.equal(salt.flag, 'HEALTHY');
  assert.equal(salt.recommendedReorderQty, 0);

  const oil = byId.get('p-out')!;
  assert.equal(oil.daysOfStockLeft, 0);
  assert.equal(oil.flag, 'REORDER');
  assert.equal(oil.recommendedReorderQty, 12); // max(minStockAlert*2=12, 10)

  assert.equal(report.summary.reorderCount, 2);
  assert.equal(report.summary.lowStockCount, 1);
  assert.equal(report.summary.healthyCount, 1);
  assert.equal(report.summary.outOfStockCount, 1);
  assert.equal(report.summary.fastMovingAtRiskCount, 2); // milk + dal
});
