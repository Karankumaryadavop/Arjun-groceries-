import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialCashbookEntries,
  initialCustomers,
  initialCustomerTransactions,
  initialExpenses,
  initialProducts,
  initialSales,
  initialStockAdjustments,
  initialStoreProfile,
  initialSuppliers,
  initialSupplierTransactions,
} from '../utils/initialData';
import { Product, SaleItem, StockAdjustmentRecord, StoreBusinessDataset } from '../types';
import {
  applyManualStockAdjustment,
  applyPurchaseReturnStockDecrease,
  applyPurchaseStockIncrease,
  applySaleStockDeduction,
  applySalesReturnStockIncrease,
  validateSaleStock,
} from '../utils/inventoryEngine';
import {
  commitAtomicTransitionWithDb,
  prepareAtomicCancelSale,
  prepareAtomicCustomerTransaction,
  prepareAtomicProductPurchase,
  prepareAtomicSale,
} from '../utils/atomicTransactions';
import { generateAccountingReconciliationReport } from '../utils/accountingReconciliation';
import { createEmptyBusinessDataset } from '../utils/freshInstall';
import { createMemoryLocalDbAdapter } from '../utils/localDatabase';

function makeTestProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-sugar',
    name: 'Refined Sugar',
    category: 'Staples',
    unit: 'KG',
    purchasePrice: 40,
    sellingPrice: 46,
    stockQty: 10,
    minStockAlert: 5,
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeSaleItem(overrides: Partial<SaleItem> = {}): SaleItem {
  return {
    productId: 'prod-sugar',
    productName: 'Refined Sugar',
    quantity: 2,
    unit: 'KG',
    rate: 46,
    total: 92,
    ...overrides,
  };
}

function makeDisposableDataset(
  products: Product[],
  stockAdjustments: StockAdjustmentRecord[],
  allowNegativeStock = false
): StoreBusinessDataset {
  return {
    profile: { ...initialStoreProfile, allowNegativeStock },
    customers: [...initialCustomers],
    customerTransactions: [...initialCustomerTransactions],
    suppliers: [...initialSuppliers],
    supplierTransactions: [...initialSupplierTransactions],
    sales: [...initialSales],
    expenses: [...initialExpenses],
    cashbookEntries: [...initialCashbookEntries],
    products,
    stockAdjustments,
    auditLogs: [],
    billDocuments: [],
    whatsappBatches: [],
    whatsappAuditLogs: [],
    recurringExpenses: [],
    dailySalesTarget: { amount: 4500, updatedAt: '2026-11-15T00:00:00.000Z' },
    lastClosedDate: '2026-11-14',
  };
}

test('1. Normal sale with sufficient stock deducts exact quantity and records adjustment', () => {
  const products = [makeTestProduct({ stockQty: 10 })];
  const res = applySaleStockDeduction({
    products,
    stockAdjustments: [],
    items: [makeSaleItem({ quantity: 3, unit: 'KG' })],
    saleId: 'sale-1',
    invoiceNo: 'INV-101',
    date: '2026-11-15',
    allowNegativeStock: false,
    idempotencyKey: 'key-sale-1',
  });

  assert.equal(res.success, true);
  assert.equal(res.products[0].stockQty, 7);
  assert.equal(res.addedAdjustments.length, 1);
  assert.equal(res.addedAdjustments[0].source, 'SALE');
  assert.equal(res.addedAdjustments[0].previousStock, 10);
  assert.equal(res.addedAdjustments[0].newStock, 7);
  assert.equal(res.addedAdjustments[0].quantityChange, -3);
});

test('2. Insufficient stock blocks sale with available/requested warning and never silently clamps to 0', () => {
  const products = [makeTestProduct({ stockQty: 2 })];
  const adjustments: StockAdjustmentRecord[] = [];

  const blocked = applySaleStockDeduction({
    products,
    stockAdjustments: adjustments,
    items: [makeSaleItem({ quantity: 5, unit: 'KG' })],
    saleId: 'sale-over-1',
    invoiceNo: 'INV-102',
    date: '2026-11-15',
    allowNegativeStock: false,
  });

  assert.equal(blocked.success, false);
  assert.match(blocked.error || '', /Insufficient stock/i);
  assert.match(blocked.error || '', /Available:\s*2 KG/i);
  assert.match(blocked.error || '', /Requested:\s*5 KG/i);
  assert.equal(blocked.issues?.[0].shortageQty, 3);
  assert.equal(blocked.products[0].stockQty, 2);
  assert.equal(blocked.addedAdjustments.length, 0);

  // When allowNegativeStock is explicitly enabled, deduction records exact negative balance without clamping
  const allowedNegative = applySaleStockDeduction({
    products,
    stockAdjustments: adjustments,
    items: [makeSaleItem({ quantity: 5, unit: 'KG' })],
    saleId: 'sale-over-2',
    invoiceNo: 'INV-103',
    date: '2026-11-15',
    allowNegativeStock: true,
  });

  assert.equal(allowedNegative.success, true);
  assert.equal(allowedNegative.products[0].stockQty, -3);
  assert.equal(allowedNegative.addedAdjustments[0].previousStock, 2);
  assert.equal(allowedNegative.addedAdjustments[0].newStock, -3);
  assert.equal(allowedNegative.addedAdjustments[0].quantityChange, -5);
});

test('3. Purchase increases stock accurately, supports unit conversion, and recovers negative stock', () => {
  const products = [makeTestProduct({ stockQty: -2 })];
  const res = applyPurchaseStockIncrease({
    products,
    stockAdjustments: [],
    productId: 'prod-sugar',
    quantity: 5000,
    unit: 'GM',
    unitPrice: 41,
    supplierName: 'Laxmi Wholesalers',
    invoiceNo: 'PUR-900',
    referenceId: 'stx-1',
    date: '2026-11-15',
    preferredSupplierPatch: {
      preferredSupplierId: 'sup-1',
      preferredSupplierName: 'Laxmi Wholesalers',
      preferredSupplierPhone: '9876543210',
    },
    idempotencyKey: 'key-pur-1',
  });

  assert.equal(res.success, true);
  assert.equal(res.products[0].stockQty, 3);
  assert.equal(res.products[0].lastPurchasePrice, 41);
  assert.equal(res.products[0].preferredSupplierId, 'sup-1');
  assert.equal(res.addedAdjustments[0].source, 'PURCHASE');
  assert.equal(res.addedAdjustments[0].quantityChange, 5);
  assert.equal(res.addedAdjustments[0].previousStock, -2);
  assert.equal(res.addedAdjustments[0].newStock, 3);
});

test('4. Sales return increases stock accurately and converts units', () => {
  const products = [makeTestProduct({ stockQty: 4 })];
  const res = applySalesReturnStockIncrease({
    products,
    stockAdjustments: [],
    items: [
      {
        productId: 'prod-sugar',
        productName: 'Refined Sugar',
        quantity: 500,
        unit: 'GM',
      },
    ],
    customerName: 'Ramesh Patel',
    invoiceNo: 'RET-11',
    referenceId: 'ctx-ret-1',
    date: '2026-11-15',
    idempotencyKey: 'key-sret-1',
  });

  assert.equal(res.success, true);
  assert.equal(res.products[0].stockQty, 4.5);
  assert.equal(res.addedAdjustments[0].source, 'SALES_RETURN');
  assert.equal(res.addedAdjustments[0].previousStock, 4);
  assert.equal(res.addedAdjustments[0].newStock, 4.5);
  assert.equal(res.addedAdjustments[0].quantityChange, 0.5);
});

test('5. Purchase return decreases stock accurately and blocks return exceeding available stock', () => {
  const products = [makeTestProduct({ stockQty: 3 })];

  const blocked = applyPurchaseReturnStockDecrease({
    products,
    stockAdjustments: [],
    productId: 'prod-sugar',
    quantity: 4,
    unit: 'KG',
    supplierName: 'Laxmi Wholesalers',
    referenceId: 'stx-ret-over',
    date: '2026-11-15',
    allowNegativeStock: false,
  });

  assert.equal(blocked.success, false);
  assert.match(blocked.error || '', /Insufficient stock to return/i);
  assert.equal(blocked.products[0].stockQty, 3);

  const ok = applyPurchaseReturnStockDecrease({
    products,
    stockAdjustments: [],
    productId: 'prod-sugar',
    quantity: 1500,
    unit: 'GM',
    supplierName: 'Laxmi Wholesalers',
    invoiceNo: 'PR-22',
    referenceId: 'stx-ret-1',
    date: '2026-11-15',
    allowNegativeStock: false,
    idempotencyKey: 'key-pret-1',
  });

  assert.equal(ok.success, true);
  assert.equal(ok.products[0].stockQty, 1.5);
  assert.equal(ok.addedAdjustments[0].source, 'PURCHASE_RETURN');
  assert.equal(ok.addedAdjustments[0].quantityChange, -1.5);
});

test('6. Manual and edit stock adjustments require clear reason and enforce negative-stock guard', () => {
  const products = [makeTestProduct({ stockQty: 5 })];

  const missingReason = applyManualStockAdjustment({
    products,
    stockAdjustments: [],
    productId: 'prod-sugar',
    qtyChange: -1,
    reason: '  ',
    source: 'MANUAL',
  });
  assert.equal(missingReason.success, false);
  assert.match(missingReason.error || '', /at least 3 characters/i);

  const shortReason = applyManualStockAdjustment({
    products,
    stockAdjustments: [],
    productId: 'prod-sugar',
    qtyChange: 2,
    reason: 'ok',
    source: 'EDIT',
  });
  assert.equal(shortReason.success, false);

  const negativeBlocked = applyManualStockAdjustment({
    products,
    stockAdjustments: [],
    productId: 'prod-sugar',
    qtyChange: -8,
    reason: 'Damaged torn sack',
    source: 'MANUAL',
    allowNegativeStock: false,
  });
  assert.equal(negativeBlocked.success, false);
  assert.match(negativeBlocked.error || '', /Insufficient stock/i);
  assert.equal(negativeBlocked.products[0].stockQty, 5);

  const validManual = applyManualStockAdjustment({
    products,
    stockAdjustments: [],
    productId: 'prod-sugar',
    qtyChange: -2,
    reason: 'Damaged torn sack during storage',
    source: 'MANUAL',
    allowNegativeStock: false,
    idempotencyKey: 'key-man-1',
  });
  assert.equal(validManual.success, true);
  assert.equal(validManual.products[0].stockQty, 3);
  assert.equal(validManual.addedAdjustments[0].reason, 'Damaged torn sack during storage');
});

test('7. Duplicate transaction prevention (idempotencyKey) across sale, purchase, returns, and manual adjustment', () => {
  const initProducts = [makeTestProduct({ stockQty: 10 })];

  // Sale retry
  const s1 = applySaleStockDeduction({
    products: initProducts,
    stockAdjustments: [],
    items: [makeSaleItem({ quantity: 2 })],
    saleId: 'sale-dup',
    invoiceNo: 'INV-DUP',
    date: '2026-11-15',
    idempotencyKey: 'dup-sale-key',
  });
  assert.equal(s1.success, true);
  assert.equal(s1.products[0].stockQty, 8);

  const s2 = applySaleStockDeduction({
    products: s1.products,
    stockAdjustments: s1.stockAdjustments,
    items: [makeSaleItem({ quantity: 2 })],
    saleId: 'sale-dup',
    invoiceNo: 'INV-DUP',
    date: '2026-11-15',
    idempotencyKey: 'dup-sale-key',
  });
  assert.equal(s2.success, false);
  assert.equal(s2.duplicate, true);
  assert.equal(s2.products[0].stockQty, 8);

  // Purchase retry
  const p1 = applyPurchaseStockIncrease({
    products: s1.products,
    stockAdjustments: s1.stockAdjustments,
    productId: 'prod-sugar',
    quantity: 4,
    supplierName: 'Laxmi',
    referenceId: 'pur-dup',
    date: '2026-11-15',
    idempotencyKey: 'dup-pur-key',
  });
  assert.equal(p1.success, true);
  assert.equal(p1.products[0].stockQty, 12);

  const p2 = applyPurchaseStockIncrease({
    products: p1.products,
    stockAdjustments: p1.stockAdjustments,
    productId: 'prod-sugar',
    quantity: 4,
    supplierName: 'Laxmi',
    referenceId: 'pur-dup',
    date: '2026-11-15',
    idempotencyKey: 'dup-pur-key',
  });
  assert.equal(p2.success, false);
  assert.equal(p2.duplicate, true);
  assert.equal(p2.products[0].stockQty, 12);

  // Sales return retry
  const sr1 = applySalesReturnStockIncrease({
    products: p1.products,
    stockAdjustments: p1.stockAdjustments,
    items: [{ productId: 'prod-sugar', productName: 'Refined Sugar', quantity: 1, unit: 'KG' }],
    customerName: 'Ramesh',
    referenceId: 'sr-dup',
    date: '2026-11-15',
    idempotencyKey: 'dup-sr-key',
  });
  assert.equal(sr1.success, true);
  assert.equal(sr1.products[0].stockQty, 13);

  const sr2 = applySalesReturnStockIncrease({
    products: sr1.products,
    stockAdjustments: sr1.stockAdjustments,
    items: [{ productId: 'prod-sugar', productName: 'Refined Sugar', quantity: 1, unit: 'KG' }],
    customerName: 'Ramesh',
    referenceId: 'sr-dup',
    date: '2026-11-15',
    idempotencyKey: 'dup-sr-key',
  });
  assert.equal(sr2.success, false);
  assert.equal(sr2.duplicate, true);
  assert.equal(sr2.products[0].stockQty, 13);

  // Purchase return retry
  const pr1 = applyPurchaseReturnStockDecrease({
    products: sr1.products,
    stockAdjustments: sr1.stockAdjustments,
    productId: 'prod-sugar',
    quantity: 2,
    supplierName: 'Laxmi',
    referenceId: 'pr-dup',
    date: '2026-11-15',
    idempotencyKey: 'dup-pr-key',
  });
  assert.equal(pr1.success, true);
  assert.equal(pr1.products[0].stockQty, 11);

  const pr2 = applyPurchaseReturnStockDecrease({
    products: pr1.products,
    stockAdjustments: pr1.stockAdjustments,
    productId: 'prod-sugar',
    quantity: 2,
    supplierName: 'Laxmi',
    referenceId: 'pr-dup',
    date: '2026-11-15',
    idempotencyKey: 'dup-pr-key',
  });
  assert.equal(pr2.success, false);
  assert.equal(pr2.duplicate, true);
  assert.equal(pr2.products[0].stockQty, 11);

  // Manual adjustment retry
  const m1 = applyManualStockAdjustment({
    products: pr1.products,
    stockAdjustments: pr1.stockAdjustments,
    productId: 'prod-sugar',
    qtyChange: -1,
    reason: 'Spillage loss',
    idempotencyKey: 'dup-man-key',
  });
  assert.equal(m1.success, true);
  assert.equal(m1.products[0].stockQty, 10);

  const m2 = applyManualStockAdjustment({
    products: m1.products,
    stockAdjustments: m1.stockAdjustments,
    productId: 'prod-sugar',
    qtyChange: -1,
    reason: 'Spillage loss',
    idempotencyKey: 'dup-man-key',
  });
  assert.equal(m2.success, false);
  assert.equal(m2.duplicate, true);
  assert.equal(m2.products[0].stockQty, 10);
});

test('8. App restart & stock persistence via disposable localDb preserves exact stockQty, movements, and setting', async () => {
  const db = createMemoryLocalDbAdapter();
  const baseProducts = initialProducts.map((p, idx) =>
    idx === 0 ? { ...p, stockQty: 20 } : { ...p }
  );
  const targetProd = baseProducts[0];

  const afterPurchase = applyPurchaseStockIncrease({
    products: baseProducts,
    stockAdjustments: [...initialStockAdjustments],
    productId: targetProd.id,
    quantity: 2.5,
    unit: targetProd.unit,
    supplierName: 'Test Wholesale',
    referenceId: 'stx-persist-1',
    date: '2026-11-15',
    idempotencyKey: 'persist-pur-1',
  });
  assert.equal(afterPurchase.success, true);

  const afterSale = applySaleStockDeduction({
    products: afterPurchase.products,
    stockAdjustments: afterPurchase.stockAdjustments,
    items: [
      {
        productId: targetProd.id,
        productName: targetProd.name,
        quantity: 7.25,
        unit: targetProd.unit,
        rate: targetProd.sellingPrice,
        total: 7.25 * targetProd.sellingPrice,
      },
    ],
    saleId: 'sale-persist-1',
    invoiceNo: 'INV-PERSIST-1',
    date: '2026-11-15',
    idempotencyKey: 'persist-sale-1',
  });
  assert.equal(afterSale.success, true);
  const expectedStock = 15.25;

  const dataset = makeDisposableDataset(afterSale.products, afterSale.stockAdjustments, true);
  await db.commitBusinessDatasetAtomic(dataset);

  // Simulate closing and reopening the app cleanly from persisted storage
  const reloaded = await db.loadBusinessDataset();
  const reloadedProd = reloaded.products?.find((p) => p.id === targetProd.id);

  assert.ok(reloadedProd);
  assert.equal(reloadedProd.stockQty, expectedStock);
  assert.equal(reloaded.profile?.allowNegativeStock, true);
  assert.ok(
    reloaded.stockAdjustments?.some(
      (a) => a.referenceId === 'sale-persist-1' && a.newStock === expectedStock
    )
  );
  assert.ok(
    reloaded.stockAdjustments?.some((a) => a.referenceId === 'stx-persist-1' && a.source === 'PURCHASE')
  );
});

test('9. Fractional quantities, unit conversions (KG/GM, LITRE/ML, DOZEN/PCS), and multi-line cart aggregation', () => {
  const flour = makeTestProduct({ id: 'p-flour', name: 'Wheat Flour', unit: 'KG', stockQty: 2 });
  const oil = makeTestProduct({ id: 'p-oil', name: 'Mustard Oil', unit: 'LITRE', stockQty: 1 });
  const eggs = makeTestProduct({ id: 'p-eggs', name: 'Farm Eggs', unit: 'DOZEN', stockQty: 1 });
  const products = [flour, oil, eggs];

  // Deduct 500 GM from 2 KG -> 1.5 KG; 250 ML from 1 LITRE -> 0.75 LITRE; 6 PCS from 1 DOZEN -> 0.5 DOZEN
  const fractionalSale = applySaleStockDeduction({
    products,
    stockAdjustments: [],
    items: [
      { productId: 'p-flour', productName: 'Wheat Flour', quantity: 500, unit: 'GM', rate: 40, total: 20 },
      { productId: 'p-oil', productName: 'Mustard Oil', quantity: 250, unit: 'ML', rate: 160, total: 40 },
      { productId: 'p-eggs', productName: 'Farm Eggs', quantity: 6, unit: 'PCS', rate: 84, total: 42 },
    ],
    saleId: 'sale-frac-1',
    invoiceNo: 'INV-FRAC-1',
    date: '2026-11-15',
  });

  assert.equal(fractionalSale.success, true);
  assert.equal(fractionalSale.products.find((p) => p.id === 'p-flour')?.stockQty, 1.5);
  assert.equal(fractionalSale.products.find((p) => p.id === 'p-oil')?.stockQty, 0.75);
  assert.equal(fractionalSale.products.find((p) => p.id === 'p-eggs')?.stockQty, 0.5);

  // Multi-line cart requesting same SKU in KG + GM totaling 1.75 KG against 1.5 KG remaining must fail!
  const multiLineValidation = validateSaleStock({
    products: fractionalSale.products,
    allowNegativeStock: false,
    items: [
      { productId: 'p-flour', productName: 'Wheat Flour', quantity: 1, unit: 'KG', rate: 40, total: 40 },
      { productId: 'p-flour', productName: 'Wheat Flour', quantity: 750, unit: 'GM', rate: 40, total: 30 },
    ],
  });

  assert.equal(multiLineValidation.valid, false);
  assert.equal(multiLineValidation.aggregatedRequests.get('p-flour'), 1.75);
  assert.equal(multiLineValidation.issues[0].availableQty, 1.5);
  assert.equal(multiLineValidation.issues[0].requestedQty, 1.75);
  assert.equal(multiLineValidation.issues[0].shortageQty, 0.25);

  // Exact exhaustion down to 0 (750 GM + 750 GM = 1.5 KG) succeeds cleanly with exact 0 remaining
  const exactZeroSale = applySaleStockDeduction({
    products: fractionalSale.products,
    stockAdjustments: fractionalSale.stockAdjustments,
    items: [
      { productId: 'p-flour', productName: 'Wheat Flour', quantity: 750, unit: 'GM', rate: 40, total: 30 },
      { productId: 'p-flour', productName: 'Wheat Flour', quantity: 750, unit: 'GM', rate: 40, total: 30 },
    ],
    saleId: 'sale-frac-2',
    invoiceNo: 'INV-FRAC-2',
    date: '2026-11-15',
  });

  assert.equal(exactZeroSale.success, true);
  assert.equal(exactZeroSale.products.find((p) => p.id === 'p-flour')?.stockQty, 0);
});

test('10. Phase 6.1: Removes 500-entry cap and preserves more than 600 stock movement records across all workflows', () => {
  let products: Product[] = [makeTestProduct({ id: 'p-bulk', name: 'Bulk Sugar', unit: 'KG', stockQty: 2000 })];
  let stockAdjustments: StockAdjustmentRecord[] = [];

  // 1) Initial 200 purchases (+10 each)
  for (let i = 0; i < 200; i++) {
    const res = applyPurchaseStockIncrease({
      products,
      stockAdjustments,
      productId: 'p-bulk',
      quantity: 10,
      unit: 'KG',
      supplierName: 'Wholesale Depot',
      referenceId: `pur-${i}`,
      date: '2026-11-10',
    });
    assert.equal(res.success, true);
    products = res.products;
    stockAdjustments = res.stockAdjustments;
  }

  // 2) 300 sales (-5 each)
  for (let i = 0; i < 300; i++) {
    const res = applySaleStockDeduction({
      products,
      stockAdjustments,
      items: [
        {
          productId: 'p-bulk',
          productName: 'Bulk Sugar',
          quantity: 5,
          unit: 'KG',
          rate: 46,
          total: 230,
        },
      ],
      saleId: `sale-600-${i}`,
      invoiceNo: `INV-${i}`,
      date: '2026-11-11',
    });
    assert.equal(res.success, true);
    products = res.products;
    stockAdjustments = res.stockAdjustments;
  }

  // 3) 60 sales returns (+1 each)
  for (let i = 0; i < 60; i++) {
    const res = applySalesReturnStockIncrease({
      products,
      stockAdjustments,
      items: [{ productId: 'p-bulk', productName: 'Bulk Sugar', quantity: 1, unit: 'KG' }],
      customerName: 'Customer',
      referenceId: `sret-${i}`,
      date: '2026-11-12',
    });
    assert.equal(res.success, true);
    products = res.products;
    stockAdjustments = res.stockAdjustments;
  }

  // 4) 40 purchase returns (-2 each)
  for (let i = 0; i < 40; i++) {
    const res = applyPurchaseReturnStockDecrease({
      products,
      stockAdjustments,
      productId: 'p-bulk',
      quantity: 2,
      unit: 'KG',
      supplierName: 'Wholesale Depot',
      referenceId: `pret-${i}`,
      date: '2026-11-13',
    });
    assert.equal(res.success, true);
    products = res.products;
    stockAdjustments = res.stockAdjustments;
  }

  // 5) 50 manual stock adjustments (-1 each) -> total = 650 movements (> 600)
  for (let i = 0; i < 50; i++) {
    const res = applyManualStockAdjustment({
      products,
      stockAdjustments,
      productId: 'p-bulk',
      qtyChange: -1,
      reason: `Audit weighment variance #${i}`,
      source: 'MANUAL',
      date: '2026-11-14',
    });
    assert.equal(res.success, true);
    products = res.products;
    stockAdjustments = res.stockAdjustments;
  }

  // Stock: 2000 + 2000 - 1500 + 60 - 80 - 50 = 2430 KG
  assert.equal(products[0].stockQty, 2430);
  assert.equal(stockAdjustments.length, 650);
  assert.ok(stockAdjustments.some((a) => a.referenceId === 'pur-0'));
  assert.ok(stockAdjustments.some((a) => a.referenceId === 'sale-600-0'));
  assert.ok(stockAdjustments.some((a) => a.reason === 'Audit weighment variance #49'));
});

test('11. Consolidated Repair: More than 600 stock movements save and reload faithfully via LocalDbAdapter', async () => {
  const db = createMemoryLocalDbAdapter();
  const base = createEmptyBusinessDataset();
  let products: Product[] = [makeTestProduct({ id: 'p-620', name: 'Toor Dal', unit: 'KG', stockQty: 1000 })];
  let stockAdjustments: StockAdjustmentRecord[] = [];

  for (let i = 0; i < 620; i++) {
    const res = applyManualStockAdjustment({
      products,
      stockAdjustments,
      productId: 'p-620',
      qtyChange: i % 2 === 0 ? 1 : -0.5,
      reason: `Movement #${i}`,
      source: 'MANUAL',
      date: '2026-11-16',
    });
    assert.equal(res.success, true);
    products = res.products;
    stockAdjustments = res.stockAdjustments;
  }

  await db.commitBusinessDatasetAtomic({
    ...base,
    profile: { ...initialStoreProfile, allowNegativeStock: false },
    products,
    stockAdjustments,
  });

  const reloaded = await db.loadBusinessDataset();
  assert.equal(reloaded.stockAdjustments?.length, 620);
  assert.ok(reloaded.stockAdjustments?.some((a) => a.reason === 'Movement #0'));
  assert.ok(reloaded.stockAdjustments?.some((a) => a.reason === 'Movement #619'));
});

test('12. Consolidated Repair: Rejects incompatible unit conversions (no 1:1 guessing) and keeps compound transactions atomic on failure', async () => {
  const db = createMemoryLocalDbAdapter();
  const baseDataset: StoreBusinessDataset = {
    ...createEmptyBusinessDataset(),
    profile: { ...initialStoreProfile, allowNegativeStock: false },
    products: [makeTestProduct({ id: 'p-rice', name: 'Basmati', unit: 'KG', stockQty: 10 })],
    customers: [
      {
        id: 'c-1',
        name: 'Mohan',
        phone: '9811100001',
        openingBalance: 100,
        currentBalance: 100,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: '2026-11-01T09:00:00Z',
      },
    ],
    suppliers: [
      {
        id: 'sup-1',
        name: 'Kisan Traders',
        phone: '9811100002',
        openingBalance: 500,
        currentBalance: 500,
        totalPurchases: 0,
        totalPaid: 0,
        createdAt: '2026-11-01T09:00:00Z',
      },
    ],
  };
  await db.commitBusinessDatasetAtomic(baseDataset);

  // 1) Incompatible unit sale (BOX against KG product) must fail cleanly without partial state
  const badUnitSale = prepareAtomicSale(baseDataset, {
    amount: 200,
    paymentMethod: 'CREDIT',
    isCredit: true,
    customerId: 'c-1',
    items: [{ productId: 'p-rice', productName: 'Basmati', quantity: 2, unit: 'BOX', rate: 100, total: 200 }],
  });
  assert.equal(badUnitSale.success, false);
  assert.match(badUnitSale.error || '', /Incompatible unit conversion/i);
  assert.equal(badUnitSale.nextDataset, undefined);

  // 2) Credit sale to non-existent customer must abort BEFORE deducting stock or recording cash/sales
  const badCreditSale = prepareAtomicSale(baseDataset, {
    amount: 92,
    paymentMethod: 'CREDIT',
    isCredit: true,
    customerId: 'non-existent-customer',
    items: [{ productId: 'p-rice', productName: 'Basmati', quantity: 2, unit: 'KG', rate: 46, total: 92 }],
  });
  assert.equal(badCreditSale.success, false);
  assert.equal(badCreditSale.nextDataset, undefined);
  assert.equal(baseDataset.products[0].stockQty, 10);
  assert.equal(baseDataset.sales.length, 0);

  // 3) Incompatible unit purchase (LITRE against KG product) must NOT alter supplier payable or cashbook
  const badUnitPurchase = prepareAtomicProductPurchase(baseDataset, {
    supplierId: 'sup-1',
    productId: 'p-rice',
    quantity: 5,
    unit: 'LITRE',
    unitPurchasePrice: 40,
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
  });
  assert.equal(badUnitPurchase.success, false);
  assert.match(badUnitPurchase.error || '', /Incompatible unit conversion/i);
  assert.equal(badUnitPurchase.nextDataset, undefined);

  // 4) Failed customer return with bad unit leaves stock and customer ledger completely unchanged
  const badUnitReturn = prepareAtomicCustomerTransaction(baseDataset, {
    customerId: 'c-1',
    type: 'RETURN',
    amount: 50,
    description: 'Bad return unit',
    productId: 'p-rice',
    quantity: 1,
    unit: 'BOTTLE',
  });
  assert.equal(badUnitReturn.success, false);
  assert.match(badUnitReturn.error || '', /Incompatible unit conversion/i);

  // 5) Simulated IndexedDB / persistence failure mid-commit leaves zero partial records in persisted DB
  const validSale = prepareAtomicSale(baseDataset, {
    amount: 92,
    paymentMethod: 'CREDIT',
    isCredit: true,
    customerId: 'c-1',
    items: [{ productId: 'p-rice', productName: 'Basmati', quantity: 2, unit: 'KG', rate: 46, total: 92 }],
  });
  assert.equal(validSale.success, true);

  const failingDb = {
    ...db,
    async commitBusinessDatasetAtomic(): Promise<void> {
      throw new Error('Simulated IndexedDB transaction abort');
    },
  };
  const failedPersist = await commitAtomicTransitionWithDb(failingDb, validSale);
  assert.equal(failedPersist.success, false);
  assert.match(failedPersist.error || '', /Simulated IndexedDB transaction abort/i);

  const persistedAfterFailure = await db.loadBusinessDataset();
  assert.equal(persistedAfterFailure.sales?.length, 0);
  assert.equal(persistedAfterFailure.stockAdjustments?.length, 0);
  assert.equal(persistedAfterFailure.customerTransactions?.length, 0);
  assert.equal(persistedAfterFailure.products?.[0].stockQty, 10);
  assert.equal(persistedAfterFailure.customers?.[0].currentBalance, 100);
});

test('13. Edge-Case Repair: Return quantity caps across partial returns, cancelled/reversed sales & returns, and incompatible catalog unit stock reconciliation', () => {
  const baseDataset: StoreBusinessDataset = {
    ...createEmptyBusinessDataset(),
    profile: { ...initialStoreProfile, allowNegativeStock: false },
    products: [makeTestProduct({ id: 'p-sugar-cap', name: 'Refined Sugar', unit: 'KG', stockQty: 20, purchasePrice: 40 })],
    customers: [
      {
        id: 'cust-cap-1',
        name: 'Suresh',
        phone: '9833300011',
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

  // Sell 2 KG (Lot A @ ₹40) and 1 KG (Lot B) on the same invoice
  const saleRes = prepareAtomicSale(baseDataset, {
    amount: 138,
    paymentMethod: 'CREDIT',
    isCredit: true,
    customerId: 'cust-cap-1',
    customerName: 'Suresh',
    date: '2026-11-05T10:00:00Z',
    items: [
      { productId: 'p-sugar-cap', productName: 'Refined Sugar', quantity: 2, unit: 'KG', rate: 46, total: 92 },
      { productId: 'p-sugar-cap', productName: 'Refined Sugar', quantity: 1, unit: 'KG', rate: 46, total: 46 },
    ],
  });
  assert.equal(saleRes.success, true);
  let dataset = saleRes.nextDataset!;
  const origSale = dataset.sales[0];
  const invoiceNo = origSale.invoiceNo;
  const lineAId = origSale.items[0].lineId!;
  const lineBId = origSale.items[1].lineId!;
  assert.equal(dataset.products[0].stockQty, 17); // 20 - 3

  // Partial return 1: 500 GM (0.5 KG) from Line A -> 1.5 KG remaining on Line A
  const ret1 = prepareAtomicCustomerTransaction(dataset, {
    customerId: 'cust-cap-1',
    type: 'RETURN',
    amount: 23,
    invoiceNo,
    saleLineId: lineAId,
    description: 'Partial return 1 (500g)',
    productId: 'p-sugar-cap',
    quantity: 500,
    unit: 'GM',
    date: '2026-11-06T10:00:00Z',
  });
  assert.equal(ret1.success, true);
  dataset = ret1.nextDataset!;
  assert.equal(dataset.products[0].stockQty, 17.5);

  // Partial return 2: 1000 GM (1.0 KG) from Line A -> 0.5 KG remaining on Line A
  const ret2 = prepareAtomicCustomerTransaction(dataset, {
    customerId: 'cust-cap-1',
    type: 'RETURN',
    amount: 46,
    invoiceNo,
    saleLineId: lineAId,
    description: 'Partial return 2 (1000g)',
    productId: 'p-sugar-cap',
    quantity: 1000,
    unit: 'GM',
    date: '2026-11-06T11:00:00Z',
  });
  assert.equal(ret2.success, true);
  dataset = ret2.nextDataset!;
  assert.equal(dataset.products[0].stockQty, 18.5);

  // Over-return attempt on Line A: 750 GM (0.75 KG) > 0.5 KG remaining -> MUST be blocked
  const overRet = prepareAtomicCustomerTransaction(dataset, {
    customerId: 'cust-cap-1',
    type: 'RETURN',
    amount: 34.5,
    invoiceNo,
    saleLineId: lineAId,
    description: 'Over-return attempt (750g)',
    productId: 'p-sugar-cap',
    quantity: 750,
    unit: 'GM',
    date: '2026-11-06T12:00:00Z',
  });
  assert.equal(overRet.success, false);
  assert.match(overRet.error || '', /exceeds remaining returnable quantity/i);
  assert.equal(dataset.products[0].stockQty, 18.5);

  // Exact remaining return on Line A: 500 GM (0.5 KG) -> succeeds (0 KG remaining on Line A)
  const exactRet = prepareAtomicCustomerTransaction(dataset, {
    customerId: 'cust-cap-1',
    type: 'RETURN',
    amount: 23,
    invoiceNo,
    saleLineId: lineAId,
    description: 'Exact remaining 500g',
    productId: 'p-sugar-cap',
    quantity: 500,
    unit: 'GM',
    date: '2026-11-06T13:00:00Z',
  });
  assert.equal(exactRet.success, true);
  dataset = exactRet.nextDataset!;
  assert.equal(dataset.products[0].stockQty, 19);

  // Cancelled previous return must restore returnable quota cleanly:
  // Mark ret2 (1000 GM) as CANCELLED -> 1.0 KG becomes returnable again on Line A
  const ret2Id = ret2.extra!.transactionId;
  const datasetWithCancelledRet = {
    ...dataset,
    customerTransactions: dataset.customerTransactions.map((t) =>
      t.id === ret2Id ? { ...t, status: 'CANCELLED' as const, cancelReason: 'Mistake' } : t
    ),
  };
  const afterCancelReReturn = prepareAtomicCustomerTransaction(datasetWithCancelledRet, {
    customerId: 'cust-cap-1',
    type: 'RETURN',
    amount: 46,
    invoiceNo,
    saleLineId: lineAId,
    description: 'Re-return 1 KG after cancelled return',
    productId: 'p-sugar-cap',
    quantity: 1,
    unit: 'KG',
    date: '2026-11-06T14:00:00Z',
  });
  assert.equal(afterCancelReReturn.success, true);

  // Return against a CANCELLED or REVERSED original sale must be blocked
  const secondSale = prepareAtomicSale(baseDataset, {
    amount: 92,
    paymentMethod: 'CASH',
    date: '2026-11-05T12:00:00Z',
    items: [{ productId: 'p-sugar-cap', productName: 'Refined Sugar', quantity: 2, unit: 'KG', rate: 46, total: 92 }],
  });
  assert.equal(secondSale.success, true);
  const cancelledBill = prepareAtomicCancelSale(
    secondSale.nextDataset!,
    secondSale.nextDataset!.sales[0].id,
    'Customer walked away'
  );
  assert.equal(cancelledBill.success, true);
  const returnOnCancelled = prepareAtomicCustomerTransaction(cancelledBill.nextDataset!, {
    customerId: 'cust-cap-1',
    type: 'RETURN',
    amount: 46,
    invoiceNo: secondSale.nextDataset!.sales[0].invoiceNo,
    description: 'Return on cancelled bill',
    productId: 'p-sugar-cap',
    quantity: 1,
    unit: 'KG',
    date: '2026-11-06T15:00:00Z',
  });
  assert.equal(returnOnCancelled.success, false);
  assert.match(returnOnCancelled.error || '', /cancelled or reversed/i);

  // Incompatible catalog unit after sale (KG -> BAG): return succeeds financially for Line B (500 GM),
  // preserves BAG inventory uncorrupted, AND creates a clear reconciliation StockAdjustmentRecord
  const datasetIncompatibleCat: StoreBusinessDataset = {
    ...dataset,
    products: dataset.products.map((p) =>
      p.id === 'p-sugar-cap' ? { ...p, unit: 'BAG', stockQty: 5, purchasePrice: 2000 } : p
    ),
  };
  const incompRet = prepareAtomicCustomerTransaction(datasetIncompatibleCat, {
    customerId: 'cust-cap-1',
    type: 'RETURN',
    amount: 23,
    invoiceNo,
    saleLineId: lineBId,
    description: 'Return 500g after KG -> BAG catalog change',
    productId: 'p-sugar-cap',
    quantity: 500,
    unit: 'GM',
    date: '2026-11-07T10:00:00Z',
  });
  assert.equal(incompRet.success, true);
  const afterIncomp = incompRet.nextDataset!;
  // BAG stock count remains completely uncorrupted (still 5 BAGs)
  assert.equal(afterIncomp.products[0].stockQty, 5);
  assert.equal(afterIncomp.customerTransactions[0].items?.[0].stockReconciliationStatus, 'SKIPPED_INCOMPATIBLE_UNIT');
  assert.equal(afterIncomp.customerTransactions[0].items?.[0].baseUnit, 'KG');
  assert.equal(afterIncomp.customerTransactions[0].items?.[0].unitCostAtSale, 40);

  const skippedAdj = afterIncomp.stockAdjustments.find(
    (a) => a.referenceId === incompRet.extra!.transactionId
  );
  assert.ok(skippedAdj);
  assert.equal(skippedAdj.reconciliationStatus, 'SKIPPED_INCOMPATIBLE_UNIT');
  assert.equal(skippedAdj.quantityChange, 0);
  assert.equal(skippedAdj.previousStock, 5);
  assert.equal(skippedAdj.newStock, 5);
  assert.equal(skippedAdj.historicalUnit, 'KG');
  assert.equal(skippedAdj.historicalQuantity, 0.5);
  assert.equal(skippedAdj.saleLineId, lineBId);

  const recReport = generateAccountingReconciliationReport(afterIncomp);
  assert.equal(recReport.profitAudit.reviewStatus, 'RECONCILED');
  assert.equal(recReport.profitAudit.skippedIncompatibleStockReturnsCount, 1);
  assert.equal(recReport.inventoryAudit.stockAdjustmentDivergenceCount, 0);
  assert.ok(recReport.findings.some((f) => f.code === 'SKIPPED_INCOMPATIBLE_RETURN_STOCK'));
});


