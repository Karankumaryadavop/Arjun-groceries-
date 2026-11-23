import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPurchaseReturnSummary,
  generateCreditNoteNumber,
  normalizePurchaseReturnItems,
  validatePurchaseReturnStockAvailability,
} from './purchaseReturns';
import {
  prepareAtomicCancelSupplierTransaction,
  prepareAtomicProductPurchase,
  prepareAtomicPurchaseReturn,
} from './atomicTransactions';
import { StoreBusinessDataset } from '../types';

function makeBaseDataset(): StoreBusinessDataset {
  const now = '2026-11-21T08:00:00.000Z';
  return {
    profile: {
      id: 'store-1',
      storeName: 'Arjun Groceries',
      ownerName: 'Arjun Verma',
      phone: '9876543210',
      upiId: 'arjun@upi',
      address: 'Shop 12, Main Market',
      currencySymbol: '₹',
      isPinEnabled: false,
      allowNegativeStock: false,
    },
    customers: [],
    customerTransactions: [],
    suppliers: [
      {
        id: 'sup-1',
        name: 'Mahalaxmi Agro Traders',
        phone: '9822011223',
        openingBalance: 0,
        currentBalance: 0,
        totalPurchases: 0,
        totalPaid: 0,
        createdAt: now,
      },
    ],
    supplierTransactions: [],
    sales: [],
    expenses: [],
    cashbookEntries: [],
    products: [
      {
        id: 'prod-dal',
        name: 'Toor Dal Premium',
        category: 'Grains',
        purchasePrice: 140,
        sellingPrice: 168,
        stockQty: 10,
        unit: 'kg',
        minStockAlert: 5,
        updatedAt: now,
      },
      {
        id: 'prod-oil',
        name: 'Fortune Sunflower Oil',
        category: 'Oils',
        purchasePrice: 120,
        sellingPrice: 145,
        stockQty: 15,
        unit: 'L',
        minStockAlert: 4,
        updatedAt: now,
      },
    ],
    stockAdjustments: [],
    auditLogs: [],
    whatsappBatches: [],
    whatsappAuditLogs: [],
  };
}

test('generateCreditNoteNumber increments sequential CN-YYYY-NNNN safely', () => {
  const cn1 = generateCreditNoteNumber([], '2026-11-21');
  assert.equal(cn1, 'CN-2026-0001');

  const cn2 = generateCreditNoteNumber(
    [
      {
        id: 'stx-1',
        supplierId: 'sup-1',
        type: 'RETURN',
        amount: 500,
        date: '2026-11-21',
        creditNoteNo: 'CN-2026-0004',
        paymentStatus: 'PAID',
        description: 'Return',
        createdAt: '2026-11-21T09:00:00Z',
      },
    ],
    '2026-11-21'
  );
  assert.equal(cn2, 'CN-2026-0005');
});

test('normalizePurchaseReturnItems and stock availability reject invalid units or excess stock', () => {
  const ds = makeBaseDataset();
  const badUnit = normalizePurchaseReturnItems(
    [{ productId: 'prod-dal', productName: 'Toor Dal Premium', quantity: 2, unit: 'L', unitPrice: 140 }],
    ds.products
  );
  assert.equal(badUnit.valid, false);
  assert.match(badUnit.error || '', /incompatible/i);

  const validNorm = normalizePurchaseReturnItems(
    [{ productId: 'prod-dal', productName: 'Toor Dal Premium', quantity: 12, unit: 'kg', unitPrice: 140 }],
    ds.products
  );
  assert.equal(validNorm.valid, true);
  const stockCheck = validatePurchaseReturnStockAvailability({
    items: validNorm.items,
    products: ds.products,
    allowNegativeStock: false,
  });
  assert.equal(stockCheck.valid, false);
  assert.match(stockCheck.error || '', /Insufficient stock/i);
});

test('prepareAtomicPurchaseReturn deducts multi-item stock, lowers supplier payable, issues credit note, and restores stock on cancel', () => {
  let ds = makeBaseDataset();

  // First record an unpaid inward purchase of 20 kg Toor Dal @ ₹140 = ₹2,800
  const purRes = prepareAtomicProductPurchase(ds, {
    supplierId: 'sup-1',
    productId: 'prod-dal',
    quantity: 20,
    unit: 'kg',
    unitPurchasePrice: 140,
    paymentStatus: 'UNPAID',
    invoiceNo: 'INV-9001',
    date: '2026-11-20',
  });
  assert.equal(purRes.success, true);
  ds = purRes.nextDataset!;
  assert.equal(ds.products.find((p) => p.id === 'prod-dal')?.stockQty, 30);
  assert.equal(ds.suppliers.find((s) => s.id === 'sup-1')?.currentBalance, 2800);

  // Now return 5 kg Toor Dal (₹700) + 2 L Oil (₹240) = ₹940 total Credit Note
  const retRes = prepareAtomicPurchaseReturn(ds, {
    supplierId: 'sup-1',
    reason: 'DAMAGED',
    originalInvoiceNo: 'INV-9001',
    originalPurchaseId: purRes.extra?.transactionId,
    date: '2026-11-21',
    items: [
      {
        productId: 'prod-dal',
        productName: 'Toor Dal Premium',
        quantity: 5,
        unit: 'kg',
        unitPrice: 140,
      },
      {
        productId: 'prod-oil',
        productName: 'Fortune Sunflower Oil',
        quantity: 2,
        unit: 'L',
        unitPrice: 120,
      },
    ],
  });

  assert.equal(retRes.success, true);
  assert.equal(retRes.extra?.creditNoteNo, 'CN-2026-0001');
  ds = retRes.nextDataset!;

  // Automated stock deductions verified
  assert.equal(ds.products.find((p) => p.id === 'prod-dal')?.stockQty, 25);
  assert.equal(ds.products.find((p) => p.id === 'prod-oil')?.stockQty, 13);

  // Supplier payable reduced from ₹2,800 by ₹940 to ₹1,860
  assert.equal(ds.suppliers.find((s) => s.id === 'sup-1')?.currentBalance, 1860);

  // Two PURCHASE_RETURN stock adjustment audit records created
  const prAdjs = ds.stockAdjustments.filter((a) => a.source === 'PURCHASE_RETURN');
  assert.equal(prAdjs.length, 2);

  // Summary metrics match
  const summary = buildPurchaseReturnSummary(ds.supplierTransactions, ds.suppliers);
  assert.equal(summary.activeReturnsCount, 1);
  assert.equal(summary.totalCreditNoteValue, 940);
  assert.equal(summary.damagedOrExpiredValue, 940);
  assert.equal(summary.totalUnitsReturned, 7);

  // Cancelling the purchase return restores stock and supplier payable cleanly
  const cancelRes = prepareAtomicCancelSupplierTransaction(
    ds,
    retRes.extra!.transactionId,
    'Entered by mistake'
  );
  assert.equal(cancelRes.success, true);
  const afterCancel = cancelRes.nextDataset!;
  assert.equal(afterCancel.products.find((p) => p.id === 'prod-dal')?.stockQty, 30);
  assert.equal(afterCancel.products.find((p) => p.id === 'prod-oil')?.stockQty, 15);
  assert.equal(afterCancel.suppliers.find((s) => s.id === 'sup-1')?.currentBalance, 2800);
});

test('generatePurchaseReturnCreditNotePDF generates a valid PDF document for a purchase return', async () => {
  const { generatePurchaseReturnCreditNotePDF } = await import('./pdfGenerator');
  const ds = makeBaseDataset();
  const retRes = prepareAtomicPurchaseReturn(ds, {
    supplierId: 'sup-1',
    reason: 'EXPIRED',
    originalInvoiceNo: 'INV-5520',
    date: '2026-11-21',
    items: [
      {
        productId: 'prod-dal',
        productName: 'Toor Dal Premium',
        quantity: 2,
        unit: 'kg',
        unitPrice: 140,
      },
    ],
  });
  assert.equal(retRes.success, true);
  const returnTx = retRes.nextDataset!.supplierTransactions[0];
  const supplier = retRes.nextDataset!.suppliers[0];
  const doc = generatePurchaseReturnCreditNotePDF(returnTx, ds.profile, supplier);
  const pdfText = doc.output('datauristring');
  assert.ok(pdfText.startsWith('data:application/pdf'), 'Expected PDF data URI output');
  assert.ok(pdfText.length > 500, 'Expected non-empty PDF document');
});
