import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyStockStatus,
  resolveDesiredStockLevel,
  calculateSuggestedPurchaseQty,
  resolveLastPurchasePrice,
  buildLowStockItems,
  calculateLowStockSummary,
  filterLowStockItems,
  groupLowStockBySupplier,
  formatSpreadsheetColumnLabel,
  buildHorizontalStorePurchaseMatrix,
  exportHorizontalLowStockCSV,
} from './lowStock.ts';
import { Product, Supplier } from '../types/index.ts';

const sampleSuppliers: Supplier[] = [
  {
    id: 'sup-1',
    name: 'Balaji Grains Wholesale',
    phone: '9822334455',
    openingBalance: 0,
    currentBalance: 12000,
    totalPurchases: 50000,
    totalPaid: 38000,
    createdAt: '2026-01-01',
  },
  {
    id: 'sup-2',
    name: 'Shree Ganesh FMCG',
    phone: '9811223344',
    openingBalance: 0,
    currentBalance: 0,
    totalPurchases: 20000,
    totalPaid: 20000,
    createdAt: '2026-01-01',
  },
];

const baseProduct = (overrides: Partial<Product>): Product => ({
  id: 'p-1',
  name: 'Tata Sampann Toor Dal',
  category: 'Pulses & Dals',
  purchasePrice: 145,
  sellingPrice: 170,
  stockQty: 4,
  unit: 'kg',
  minStockAlert: 10,
  updatedAt: '2026-11-10T10:00:00Z',
  ...overrides,
});

test('classifyStockStatus differentiates OUT_OF_STOCK, CRITICAL_STOCK, LOW_STOCK, OK, and ARCHIVED', () => {
  assert.equal(classifyStockStatus(baseProduct({ stockQty: 0 })), 'OUT_OF_STOCK');
  assert.equal(classifyStockStatus(baseProduct({ stockQty: -1 })), 'OUT_OF_STOCK');
  assert.equal(classifyStockStatus(baseProduct({ stockQty: 4, minStockAlert: 10 })), 'CRITICAL_STOCK');
  assert.equal(classifyStockStatus(baseProduct({ stockQty: 8, minStockAlert: 10 })), 'LOW_STOCK');
  assert.equal(classifyStockStatus(baseProduct({ stockQty: 15, minStockAlert: 10 })), 'OK');
  assert.equal(classifyStockStatus(baseProduct({ stockQty: 0, isArchived: true })), 'ARCHIVED');
});

test('calculateSuggestedPurchaseQty uses desiredStockLevel minus current stock', () => {
  const pWithDesired = baseProduct({ stockQty: 4, minStockAlert: 10, desiredStockLevel: 25 });
  assert.equal(resolveDesiredStockLevel(pWithDesired), 25);
  assert.equal(calculateSuggestedPurchaseQty(pWithDesired), 21);

  const pAlreadyFull = baseProduct({ stockQty: 30, minStockAlert: 10, desiredStockLevel: 25 });
  assert.equal(calculateSuggestedPurchaseQty(pAlreadyFull), 0);

  const pDefaultDesired = baseProduct({ stockQty: 4, minStockAlert: 10, desiredStockLevel: undefined });
  assert.equal(resolveDesiredStockLevel(pDefaultDesired), 20);
  assert.equal(calculateSuggestedPurchaseQty(pDefaultDesired), 16);
});

test('resolveLastPurchasePrice prefers lastPurchasePrice and stays independent from sellingPrice', () => {
  const p = baseProduct({ purchasePrice: 145, lastPurchasePrice: 152, sellingPrice: 180 });
  assert.equal(resolveLastPurchasePrice(p), 152);

  const pFallback = baseProduct({ purchasePrice: 145, lastPurchasePrice: undefined, sellingPrice: 180 });
  assert.equal(resolveLastPurchasePrice(pFallback), 145);
});

test('buildLowStockItems handles assigned and unassigned suppliers accurately without fabricating suppliers', () => {
  const products: Product[] = [
    baseProduct({
      id: 'p-dal',
      name: 'Toor Dal',
      stockQty: 4,
      minStockAlert: 10,
      desiredStockLevel: 20,
      purchasePrice: 145,
      lastPurchasePrice: 150,
      preferredSupplierId: 'sup-1',
    }),
    baseProduct({
      id: 'p-maggi',
      name: 'Maggi Noodles',
      category: 'Packaged Snacks',
      stockQty: 0,
      minStockAlert: 24,
      desiredStockLevel: 48,
      purchasePrice: 11.5,
      preferredSupplierId: undefined, // unassigned
    }),
    baseProduct({
      id: 'p-atta',
      name: 'Atta',
      stockQty: 35,
      minStockAlert: 8,
    }),
  ];

  const items = buildLowStockItems(products, sampleSuppliers);
  assert.equal(items.length, 2);

  // Sorted OUT_OF_STOCK first
  assert.equal(items[0].product.id, 'p-maggi');
  assert.equal(items[0].status, 'OUT_OF_STOCK');
  assert.equal(items[0].hasPreferredSupplier, false);
  assert.equal(items[0].preferredSupplierName, 'Supplier Not Assigned');
  assert.equal(items[0].suggestedPurchaseQty, 48);

  // CRITICAL_STOCK second with assigned supplier
  assert.equal(items[1].product.id, 'p-dal');
  assert.equal(items[1].status, 'CRITICAL_STOCK');
  assert.equal(items[1].hasPreferredSupplier, true);
  assert.equal(items[1].preferredSupplierName, 'Balaji Grains Wholesale');
  assert.equal(items[1].preferredSupplierPhone, '9822334455');
  assert.equal(items[1].suggestedPurchaseQty, 16);
  assert.equal(items[1].lastPurchasePrice, 150);
  assert.equal(items[1].estimatedPurchaseCost, 2400);

  const summary = calculateLowStockSummary(items);
  assert.equal(summary.totalLowStockProducts, 2);
  assert.equal(summary.outOfStockCount, 1);
  assert.equal(summary.criticalStockCount, 1);
  assert.equal(summary.unassignedSupplierCount, 1);
  assert.equal(summary.estimatedReplenishmentCost, 2400 + 48 * 11.5);
});

test('filterLowStockItems and groupLowStockBySupplier work together cleanly', () => {
  const products: Product[] = [
    baseProduct({
      id: 'p-dal',
      name: 'Toor Dal',
      category: 'Pulses & Dals',
      stockQty: 4,
      minStockAlert: 10,
      desiredStockLevel: 20,
      purchasePrice: 145,
      preferredSupplierId: 'sup-1',
    }),
    baseProduct({
      id: 'p-rice',
      name: 'Basmati Rice',
      category: 'Grains & Flour',
      stockQty: 7,
      minStockAlert: 10,
      desiredStockLevel: 25,
      purchasePrice: 90,
      preferredSupplierId: 'sup-1',
    }),
    baseProduct({
      id: 'p-soap',
      name: 'Dettol Soap',
      category: 'Personal Care',
      stockQty: 0,
      minStockAlert: 12,
      desiredStockLevel: 24,
      purchasePrice: 35,
    }),
  ];

  const items = buildLowStockItems(products, sampleSuppliers);

  const onlySup1 = filterLowStockItems(items, {
    statusFilter: 'ALL',
    category: 'ALL',
    supplierFilter: 'sup-1',
    searchQuery: '',
  });
  assert.equal(onlySup1.length, 2);

  const onlyUnassigned = filterLowStockItems(items, {
    statusFilter: 'OUT_OF_STOCK',
    category: 'ALL',
    supplierFilter: 'UNASSIGNED',
    searchQuery: 'dettol',
  });
  assert.equal(onlyUnassigned.length, 1);
  assert.equal(onlyUnassigned[0].product.id, 'p-soap');

  const groups = groupLowStockBySupplier(items, sampleSuppliers);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].isUnassigned, false);
  assert.equal(groups[0].supplierName, 'Balaji Grains Wholesale');
  assert.equal(groups[0].totalItemsCount, 2);
  assert.equal(groups[0].totalSuggestedQty, 16 + 18);
  assert.equal(groups[0].estimatedSupplierTotal, 16 * 145 + 18 * 90);

  assert.equal(groups[1].isUnassigned, true);
  assert.equal(groups[1].supplierName, 'Supplier Not Assigned');
  assert.equal(groups[1].totalItemsCount, 1);
});

test('buildHorizontalStorePurchaseMatrix arranges purchase stores horizontally and exports spreadsheet CSV', () => {
  assert.equal(formatSpreadsheetColumnLabel(0), 'A');
  assert.equal(formatSpreadsheetColumnLabel(25), 'Z');
  assert.equal(formatSpreadsheetColumnLabel(26), 'AA');

  const products: Product[] = [
    baseProduct({
      id: 'p1',
      name: 'Toor Dal',
      stockQty: 2,
      minStockAlert: 10,
      desiredStockLevel: 20,
      purchasePrice: 140,
      preferredSupplierId: 'sup-1',
    }),
    baseProduct({
      id: 'p2',
      name: 'Basmati Rice',
      stockQty: 4,
      minStockAlert: 10,
      desiredStockLevel: 25,
      purchasePrice: 90,
      preferredSupplierId: 'sup-1',
    }),
    baseProduct({
      id: 'p3',
      name: 'Dettol Soap',
      stockQty: 0,
      minStockAlert: 12,
      desiredStockLevel: 24,
      purchasePrice: 35,
    }),
  ];

  const items = buildLowStockItems(products, sampleSuppliers);
  const matrixWithEmpty = buildHorizontalStorePurchaseMatrix({
    items,
    suppliers: sampleSuppliers,
    includeEmptySuppliers: true,
  });

  assert.equal(matrixWithEmpty.totalStoresCount, 3);
  assert.equal(matrixWithEmpty.maxRows, 2);
  assert.equal(matrixWithEmpty.columns[0].colLetter, 'A');
  assert.equal(matrixWithEmpty.columns[0].storeName, 'Balaji Grains Wholesale');
  assert.equal(matrixWithEmpty.columns[0].items.length, 2);
  assert.equal(matrixWithEmpty.columns[1].colLetter, 'B');
  assert.equal(matrixWithEmpty.columns[1].storeName, 'Shree Ganesh FMCG');
  assert.equal(matrixWithEmpty.columns[1].items.length, 0);
  assert.equal(matrixWithEmpty.columns[2].colLetter, 'C');
  assert.equal(matrixWithEmpty.columns[2].isUnassigned, true);
  assert.equal(matrixWithEmpty.columns[2].items[0].product.name, 'Dettol Soap');

  const csv = exportHorizontalLowStockCSV(matrixWithEmpty);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'Balaji Grains Wholesale,Shree Ganesh FMCG,Unassigned Store');
  assert.ok(lines[1].includes('Toor Dal'));
  assert.ok(lines[1].includes('Dettol Soap'));
});

