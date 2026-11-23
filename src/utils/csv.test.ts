import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeCSVCell,
  parseCSVRows,
  exportCustomersToCSV,
  parseCustomersCSV,
  exportSuppliersToCSV,
  parseSuppliersCSV,
  exportProductsToCSV,
  parseProductsCSV,
  getSampleCustomerCSV,
  getSampleSupplierCSV,
  getSampleProductCSV,
} from './csv.ts';
import { initialCustomers, initialSuppliers, initialProducts } from './initialData.ts';

test('escapeCSVCell handles quotes, commas, newlines and nulls properly', () => {
  assert.equal(escapeCSVCell(null), '');
  assert.equal(escapeCSVCell(undefined), '');
  assert.equal(escapeCSVCell('Plain text'), 'Plain text');
  assert.equal(escapeCSVCell('Hello, World'), '"Hello, World"');
  assert.equal(escapeCSVCell('Said "Hello"'), '"Said ""Hello"""');
  assert.equal(escapeCSVCell('Multi\nLine'), '"Multi\nLine"');
  assert.equal(escapeCSVCell(123.45), '123.45');
});

test('parseCSVRows handles complex multiline and escaped commas', () => {
  const sample = 'Name,Address,Notes\n"Ramesh, Patel","Room 12, Station Road","Line 1\nLine 2"\n"Sunita",Apt 4,Normal';
  const rows = parseCSVRows(sample);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Name', 'Address', 'Notes']);
  assert.equal(rows[1][0], 'Ramesh, Patel');
  assert.equal(rows[1][1], 'Room 12, Station Road');
  assert.equal(rows[1][2], 'Line 1\nLine 2');
  assert.equal(rows[2][0], 'Sunita');
});

test('exportCustomersToCSV and parseCustomersCSV roundtrip accurately', () => {
  const csv = exportCustomersToCSV(initialCustomers);
  assert.ok(csv.includes('Customer Name,Phone,Address'));
  assert.ok(csv.includes('Ramesh Bhai Patel'));

  const parsed = parseCustomersCSV(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.valid.length, initialCustomers.length);
  assert.equal(parsed.valid[0].name, initialCustomers[0].name);
  assert.equal(parsed.valid[0].phone, initialCustomers[0].phone);
});

test('parseCustomersCSV parses sample template correctly', () => {
  const sample = getSampleCustomerCSV();
  const parsed = parseCustomersCSV(sample);
  assert.equal(parsed.valid.length, 2);
  assert.equal(parsed.valid[0].name, 'Ramesh Bhai Patel');
  assert.equal(parsed.valid[0].openingBalance, 1200);
});

test('exportSuppliersToCSV and parseSuppliersCSV roundtrip accurately including Credit Terms and Preferred Payment Method', () => {
  const customSuppliers = initialSuppliers.map((s, idx) =>
    idx === 0
      ? { ...s, creditTerms: 'Net 15 Days', preferredPaymentMethod: 'UPI' as const }
      : s
  );
  const csv = exportSuppliersToCSV(customSuppliers);
  assert.ok(csv.includes('Balaji Grains & Agro Wholesale'));
  assert.ok(csv.includes('Credit Terms'));
  assert.ok(csv.includes('Preferred Payment Method'));

  const parsed = parseSuppliersCSV(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.valid.length, customSuppliers.length);
  assert.equal(parsed.valid[0].name, customSuppliers[0].name);
  assert.equal(parsed.valid[0].creditTerms, 'Net 15 Days');
  assert.equal(parsed.valid[0].preferredPaymentMethod, 'UPI');
});

test('exportProductsToCSV and parseProductsCSV roundtrip accurately with units and thresholds', () => {
  const csv = exportProductsToCSV(initialProducts);
  assert.ok(csv.includes('ALU (Fresh Potatoes)'));
  assert.ok(csv.includes('Reorder Threshold'));

  const parsed = parseProductsCSV(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.valid.length, initialProducts.length);
  const alu = parsed.valid.find((p) => p.name.includes('ALU'));
  assert.ok(alu);
  assert.equal(alu?.unit, 'KG');
  assert.equal(alu?.purchasePrice, 22);
  assert.equal(alu?.sellingPrice, 30);
  assert.equal(alu?.minStockAlert, 5);
});
