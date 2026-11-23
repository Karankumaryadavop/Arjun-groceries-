import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCustomerUdharStatementPDF,
  generateDailySalesReportPDF,
  generateSaleInvoicePDF,
  generatePurchaseInvoicePDF,
} from './pdfGenerator.ts';
import {
  initialCustomers,
  initialCustomerTransactions,
  initialStoreProfile,
  initialSales,
  initialSuppliers,
  initialSupplierTransactions,
} from './initialData.ts';

test('generateCustomerUdharStatementPDF produces valid jsPDF document with pages', () => {
  const customer = initialCustomers[0]; // Ramesh Bhai Patel
  const transactions = initialCustomerTransactions.filter((tx) => tx.customerId === customer.id);

  const doc = generateCustomerUdharStatementPDF(customer, transactions, initialStoreProfile);
  assert.ok(doc);
  assert.equal(doc.getNumberOfPages() >= 1, true);

  const pdfOutput = doc.output('arraybuffer');
  assert.ok(pdfOutput.byteLength > 1000);
});

test('generateDailySalesReportPDF generates valid sales document with revenue KPIs', () => {
  const doc = generateDailySalesReportPDF(initialSales, initialStoreProfile, 'This Month', {
    totalSales: 12100,
    totalCOGS: 10166,
    grossProfit: 1934,
    grossMarginPct: 15.98,
  });

  assert.ok(doc);
  assert.equal(doc.getNumberOfPages() >= 1, true);

  const pdfOutput = doc.output('arraybuffer');
  assert.ok(pdfOutput.byteLength > 1000);
});

test('generateDailySalesReportPDF marks 0% COGS coverage as UNVERIFIED and avoids 100% margin', () => {
  const doc = generateDailySalesReportPDF(initialSales, initialStoreProfile, '2026-11-16', {
    totalSales: 5000,
    totalCOGS: 0,
    grossProfit: 5000,
    grossMarginPct: 0,
    costCoveragePct: 0,
    uncostedRevenue: 5000,
    hasCompleteCogs: false,
    reviewStatus: 'UNCOSTED',
    isProfitVerified: false,
    knownCostGrossProfit: null,
    knownCostGrossMarginPct: null,
  });

  const rawPdfText = doc.output();
  assert.match(rawPdfText, /UNVERIFIED/);
  assert.match(rawPdfText, /0% COGS coverage/);
  assert.doesNotMatch(rawPdfText, /Gross Margin: 100%/);
});

test('generateSaleInvoicePDF generates official Tax Invoice PDF for an existing sale record', () => {
  const sale = initialSales[0];
  const customer = initialCustomers.find((c) => c.id === sale.customerId);
  const doc = generateSaleInvoicePDF(sale, initialStoreProfile, customer);

  assert.ok(doc);
  assert.equal(doc.getNumberOfPages() >= 1, true);

  const pdfOutput = doc.output('arraybuffer');
  assert.ok(pdfOutput.byteLength > 1000);
});

test('generatePurchaseInvoicePDF generates official Inward Purchase Voucher PDF for supplier record', () => {
  const purchase = initialSupplierTransactions[0];
  const supplier = initialSuppliers.find((s) => s.id === purchase.supplierId);
  const doc = generatePurchaseInvoicePDF(purchase, initialStoreProfile, supplier);

  assert.ok(doc);
  assert.equal(doc.getNumberOfPages() >= 1, true);

  const pdfOutput = doc.output('arraybuffer');
  assert.ok(pdfOutput.byteLength > 1000);
});

