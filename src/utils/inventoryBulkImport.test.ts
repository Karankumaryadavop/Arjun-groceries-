import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchExistingInventoryProduct,
  parseProductsFromCsvText,
  parseProductsFromExtractedPdfText,
} from './inventoryBulkImport';
import { Product } from '../types';

test('parseProductsFromCsvText parses standard and flexible headers with quotes and INR symbols', () => {
  const csv = [
    'Product Name,Hindi Name,Category,Wholesale Cost (INR),Selling Rate (INR),MRP (INR),Available Stock,Base Unit,Reorder Threshold,Preferred Supplier,Description',
    '"Aashirvaad Atta, 10kg",Aata,Grains & Flour,₹380,425,455,24,bags,6,Balaji Grains,Family pack',
    'Fortune Sunflower Oil,Tel,Oils & Ghee,125,145,160,30,Litre,8,Ganesh FMCG,Refined oil',
    ',Empty Name Row,General,10,12,15,5,pcs,2,,Should skip',
  ].join('\n');

  const res = parseProductsFromCsvText(csv);
  assert.equal(res.errors.length, 0);
  assert.equal(res.skipped, 1);
  assert.equal(res.rows.length, 2);

  assert.equal(res.rows[0].name, 'Aashirvaad Atta, 10kg');
  assert.equal(res.rows[0].purchasePrice, 380);
  assert.equal(res.rows[0].sellingPrice, 425);
  assert.equal(res.rows[0].mrp, 455);
  assert.equal(res.rows[0].stockQty, 24);
  assert.equal(res.rows[0].unit, 'bags');
  assert.equal(res.rows[0].minStockAlert, 6);
  assert.equal(res.rows[0].preferredSupplierName, 'Balaji Grains');

  assert.equal(res.rows[1].unit, 'L');
  assert.equal(res.rows[1].sourceFormat, 'CSV');
});

test('parseProductsFromCsvText reports missing required Product Name column', () => {
  const res = parseProductsFromCsvText('Category,Price,Stock\nGrains,100,5');
  assert.equal(res.rows.length, 0);
  assert.ok(res.errors[0].includes('Product Name'));
});

test('parseProductsFromExtractedPdfText parses pipe-delimited tabular PDF catalog', () => {
  const pdfText = [
    'Arjun Groceries - Sample Inventory Product Catalog',
    'Product Name | Category | Unit | Purchase Cost | Selling Rate | MRP | Stock Qty | Reorder Min | Supplier',
    'Tata Salt Iodized 1kg | Spices & Masala | pkt | 21 | 26 | 28 | 60 | 15 | Shree Ganesh FMCG',
    'Toor Dal Premium Loose | Pulses & Dal | kilograms | 132 | 155 | 170 | 32 | 10 | Balaji Grains',
    'Page 1 of 1',
  ].join('\n');

  const rows = parseProductsFromExtractedPdfText(pdfText);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Tata Salt Iodized 1kg');
  assert.equal(rows[0].purchasePrice, 21);
  assert.equal(rows[0].sellingPrice, 26);
  assert.equal(rows[0].stockQty, 60);
  assert.equal(rows[0].minStockAlert, 15);
  assert.equal(rows[0].preferredSupplierName, 'Shree Ganesh FMCG');
  assert.equal(rows[0].sourceFormat, 'PDF');

  assert.equal(rows[1].unit, 'kg');
  assert.equal(rows[1].stockQty, 32);
});

test('parseProductsFromExtractedPdfText parses key-value block format', () => {
  const pdfText = [
    'Product Name: Parle-G Gold',
    'Category: Snacks & Biscuits',
    'Unit: packet',
    'Wholesale Cost: ₹8.5',
    'Selling Rate: ₹10',
    'Stock Qty: 85',
    'Reorder Alert: 20',
    'Supplier: Shree Ganesh FMCG',
  ].join('\n');

  const rows = parseProductsFromExtractedPdfText(pdfText);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Parle-G Gold');
  assert.equal(rows[0].unit, 'pkt');
  assert.equal(rows[0].purchasePrice, 8.5);
  assert.equal(rows[0].sellingPrice, 10);
  assert.equal(rows[0].stockQty, 85);
  assert.equal(rows[0].minStockAlert, 20);
});

test('matchExistingInventoryProduct matches normalized name and unit safely', () => {
  const existing: Product[] = [
    {
      id: 'p-1',
      name: 'Toor Dal',
      category: 'Pulses',
      purchasePrice: 120,
      sellingPrice: 150,
      stockQty: 12,
      unit: 'kg',
      minStockAlert: 5,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const exact = matchExistingInventoryProduct({ name: ' toor dal ', unit: 'kilograms' }, existing);
  assert.equal(exact.matchedProduct?.id, 'p-1');
  assert.equal(exact.matchReason, 'NAME_AND_UNIT');

  const nameOnly = matchExistingInventoryProduct({ name: 'Toor Dal', unit: 'pkt' }, existing);
  assert.equal(nameOnly.matchedProduct?.id, 'p-1');
  assert.equal(nameOnly.matchReason, 'NAME');

  const none = matchExistingInventoryProduct({ name: 'Moong Dal', unit: 'kg' }, existing);
  assert.equal(none.matchedProduct, null);
});

import { parseSuppliersFromCsvText } from './supplierPdfImport';

test('parseSuppliersFromCsvText parses supplier CSV contact database with credit terms and payment mode', () => {
  const csv = [
    'Supplier / Firm Name,Contact Person,Phone,Address,GSTIN,Credit Terms,Preferred Payment Method,Opening Balance (INR),Notes',
    'Balaji Grains Wholesale,Sanjay Agrawal,+91 98223-34455,"Gala 14, APMC Market",27aabcb1234d1z2,"Net 15 Days",BANK_TRANSFER,₹12000,"Main grain distributor"',
    'Shree Ganesh FMCG,Manoj Shah,9811223344,"Plot 88, Wholesale Hub",,"7 Days Credit",UPI,5000,"FMCG items"',
  ].join('\n');

  const res = parseSuppliersFromCsvText(csv);
  assert.equal(res.errors.length, 0);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].name, 'Balaji Grains Wholesale');
  assert.equal(res.rows[0].phone, '9822334455');
  assert.equal(res.rows[0].gstin, '27AABCB1234D1Z2');
  assert.equal(res.rows[0].creditTerms, 'Net 15 Days');
  assert.equal(res.rows[0].preferredPaymentMethod, 'BANK_TRANSFER');
  assert.equal(res.rows[0].openingBalance, 12000);
  assert.equal(res.rows[1].preferredPaymentMethod, 'UPI');
});

