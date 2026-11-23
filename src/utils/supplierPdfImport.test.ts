import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePreferredPaymentMethod,
  parseSuppliersFromExtractedText,
} from './supplierPdfImport';

test('normalizePreferredPaymentMethod normalizes Indian supplier payment modes accurately', () => {
  assert.equal(normalizePreferredPaymentMethod('UPI / GPay'), 'UPI');
  assert.equal(normalizePreferredPaymentMethod('NEFT Bank Transfer'), 'BANK_TRANSFER');
  assert.equal(normalizePreferredPaymentMethod('PDC Cheque'), 'CHEQUE');
  assert.equal(normalizePreferredPaymentMethod('Cash on Delivery'), 'CASH');
  assert.equal(normalizePreferredPaymentMethod('Monthly Credit Ledger'), 'CREDIT');
  assert.equal(normalizePreferredPaymentMethod(''), 'BANK_TRANSFER');
});

test('parseSuppliersFromExtractedText parses labeled key-value supplier directory blocks', () => {
  const text = `
Supplier Name: Shree Ganesh Agro Mills
Contact Person: Mahesh Agarwal
Phone: +91 98201 44556
Address: APMC Grain Market, Vashi
GSTIN: 27ABCDE1234F1Z5
Credit Terms: Net 30 Days
Preferred Payment Method: Bank Transfer
Opening Balance: ₹18,500
Notes: Wheat and Rice bags
---
Supplier Name: Patel Masala Distributors
Contact Person: Kiran Patel
Phone: 9819223344
Credit Terms: Net 7 Days
Preferred Payment Method: UPI
Opening Balance: 4200
`;

  const rows = parseSuppliersFromExtractedText(text);
  assert.equal(rows.length, 2);

  assert.equal(rows[0].name, 'Shree Ganesh Agro Mills');
  assert.equal(rows[0].contactPerson, 'Mahesh Agarwal');
  assert.equal(rows[0].phone, '9820144556');
  assert.equal(rows[0].gstin, '27ABCDE1234F1Z5');
  assert.equal(rows[0].creditTerms, 'Net 30 Days');
  assert.equal(rows[0].preferredPaymentMethod, 'BANK_TRANSFER');
  assert.equal(rows[0].openingBalance, 18500);

  assert.equal(rows[1].name, 'Patel Masala Distributors');
  assert.equal(rows[1].phone, '9819223344');
  assert.equal(rows[1].creditTerms, 'Net 7 Days');
  assert.equal(rows[1].preferredPaymentMethod, 'UPI');
  assert.equal(rows[1].openingBalance, 4200);
});

test('parseSuppliersFromExtractedText parses pipe-delimited tabular supplier lists', () => {
  const tableText = `
Supplier Name | Contact | Phone | Credit Terms | Preferred Payment | GSTIN | Opening Balance
Laxmi Oil Depot | Ramesh | 9876543210 | Cash on Delivery | Cash | 27AAAAA0000A1Z5 | 0
Amul Dairy Agency | Suresh | 9820098200 | Net 15 Days | Cheque | | 7500
`;

  const rows = parseSuppliersFromExtractedText(tableText);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Laxmi Oil Depot');
  assert.equal(rows[0].contactPerson, 'Ramesh');
  assert.equal(rows[0].phone, '9876543210');
  assert.equal(rows[0].creditTerms, 'Cash on Delivery');
  assert.equal(rows[0].preferredPaymentMethod, 'CASH');
  assert.equal(rows[0].gstin, '27AAAAA0000A1Z5');

  assert.equal(rows[1].name, 'Amul Dairy Agency');
  assert.equal(rows[1].creditTerms, 'Net 15 Days');
  assert.equal(rows[1].preferredPaymentMethod, 'CHEQUE');
  assert.equal(rows[1].openingBalance, 7500);
});
