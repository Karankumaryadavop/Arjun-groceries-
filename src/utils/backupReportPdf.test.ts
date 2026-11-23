/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPdfExportPreviewSummary,
  exportBackupReportPdfBytes,
  generateBackupReportPDF,
} from './backupReportPdf';
import {
  initialAuditLogs,
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
} from './initialData';
import { StoreBusinessDataset } from '../types';

function makeSeedDataset(): StoreBusinessDataset {
  return {
    profile: initialStoreProfile,
    customers: initialCustomers,
    customerTransactions: initialCustomerTransactions,
    suppliers: initialSuppliers,
    supplierTransactions: initialSupplierTransactions,
    sales: initialSales,
    expenses: initialExpenses,
    cashbookEntries: initialCashbookEntries,
    products: initialProducts,
    stockAdjustments: initialStockAdjustments,
    auditLogs: initialAuditLogs,
    whatsappBatches: [],
    whatsappAuditLogs: [],
    billDocuments: [],
    recurringExpenses: [],
    dailySalesTarget: null,
    lastClosedDate: null,
  };
}

test('backupReportPdf: generates valid multi-page PDF with summary, sections, page numbers, and zero data mutation', async () => {
  const dataset = makeSeedDataset();
  const snapshotBefore = JSON.stringify(dataset);

  const preview = buildPdfExportPreviewSummary(dataset);
  assert.equal(preview.sections.length, 10);
  assert.ok(preview.metrics.totalSales > 0);
  assert.ok(preview.estimatedPages >= 2);

  const doc = generateBackupReportPDF(dataset, { logoDataUrl: null });
  assert.ok(doc.getNumberOfPages() >= 2);

  const bytes = await exportBackupReportPdfBytes(dataset, { logoDataUrl: null });
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 2000);

  // Verify PDF binary header "%PDF-"
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  assert.equal(header, '%PDF-');

  // Ensure live dataset was never mutated
  assert.equal(JSON.stringify(dataset), snapshotBefore);
});

test('backupReportPdf: handles empty dataset safely and generates multi-page PDF on large dataset', async () => {
  const emptyDataset: StoreBusinessDataset = {
    profile: { ...initialStoreProfile, storeName: 'Arjun Groceries' },
    customers: [],
    customerTransactions: [],
    suppliers: [],
    supplierTransactions: [],
    sales: [],
    expenses: [],
    cashbookEntries: [],
    products: [],
    stockAdjustments: [],
    auditLogs: [],
    whatsappBatches: [],
    whatsappAuditLogs: [],
    billDocuments: [],
    recurringExpenses: [],
    dailySalesTarget: null,
    lastClosedDate: null,
  };

  const emptyBytes = await exportBackupReportPdfBytes(emptyDataset, { logoDataUrl: null });
  assert.equal(new TextDecoder().decode(emptyBytes.slice(0, 5)), '%PDF-');

  const seed = makeSeedDataset();
  const largeDataset: StoreBusinessDataset = {
    ...seed,
    sales: Array.from({ length: 120 }, (_, i) => ({
      ...seed.sales[0],
      id: `pdf-sale-${i}`,
      invoiceNo: `INV-PDF-${100 + i}`,
    })),
    customerTransactions: Array.from({ length: 90 }, (_, i) => ({
      ...seed.customerTransactions[0],
      id: `pdf-ctx-${i}`,
    })),
  };

  const doc = generateBackupReportPDF(largeDataset, { logoDataUrl: null });
  assert.ok(doc.getNumberOfPages() >= 5, `Expected >=5 pages for paginated large dataset, got ${doc.getNumberOfPages()}`);
});
