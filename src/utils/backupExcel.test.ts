/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  buildExcelSummaryPreview,
  computeBackupFinancialMetrics,
  EXCEL_WORKSHEET_NAMES,
  generateBackupExcelBuffer,
} from './backupExcel';
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

function makeEmptyDataset(): StoreBusinessDataset {
  return {
    profile: { ...initialStoreProfile, storeName: 'Arjun Groceries Test' },
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
}

test('backupExcel: generates all 11 required worksheets with frozen headers, auto-filters, INR formats, and preserved IDs', async () => {
  const dataset = makeSeedDataset();
  const buffer = await generateBackupExcelBuffer(dataset);
  assert.ok(buffer instanceof Uint8Array);
  assert.ok(buffer.byteLength > 3000);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const actualSheetNames = wb.worksheets.map((ws) => ws.name);
  assert.deepEqual(actualSheetNames, [...EXCEL_WORKSHEET_NAMES]);

  // Verify frozen header rows and auto-filters on all 11 worksheets
  for (const ws of wb.worksheets) {
    assert.ok(ws.views.length > 0 && ws.views[0].state === 'frozen', `${ws.name} should have frozen header`);
    assert.equal(ws.views[0].ySplit, 1, `${ws.name} ySplit should be 1`);
    assert.ok(ws.autoFilter, `${ws.name} should have autoFilter enabled`);
  }

  // Verify row counts match live dataset
  const customersSheet = wb.getWorksheet('Customers')!;
  assert.equal(customersSheet.rowCount, dataset.customers.length + 1);
  // Check INR currency formatting and ID preservation on row 2
  const firstCustRow = customersSheet.getRow(2);
  assert.equal(firstCustRow.getCell(1).value, dataset.customers[0].id);
  assert.equal(firstCustRow.getCell(9).numFmt, '₹#,##0.00');

  const salesSheet = wb.getWorksheet('Sales Bills')!;
  assert.equal(salesSheet.rowCount, dataset.sales.length + 1);
  assert.equal(salesSheet.getRow(2).getCell(1).value, dataset.sales[0].id);
  assert.equal(salesSheet.getRow(2).getCell(2).value, dataset.sales[0].invoiceNo);
  assert.equal(salesSheet.getRow(2).getCell(8).numFmt, '₹#,##0.00');
  assert.ok(salesSheet.getRow(2).getCell(3).value instanceof Date);

  const expectedPurchaseBills = dataset.supplierTransactions.filter(
    (st) => st.type === 'PURCHASE' || st.type === 'OPENING'
  );
  const purchaseSheet = wb.getWorksheet('Purchase Bills')!;
  assert.equal(purchaseSheet.rowCount, expectedPurchaseBills.length + 1);

  const auditSheet = wb.getWorksheet('Audit Logs')!;
  assert.equal(auditSheet.rowCount, dataset.auditLogs.length + 1);
  assert.equal(auditSheet.getRow(2).getCell(1).value, dataset.auditLogs[0].id);
});

test('backupExcel: handles empty dataset safely without throwing or omitting headers', async () => {
  const empty = makeEmptyDataset();
  const metrics = computeBackupFinancialMetrics(empty);
  assert.equal(metrics.totalSales, 0);
  assert.equal(metrics.totalCustomerOutstanding, 0);
  assert.equal(metrics.availableCash, 0);

  const preview = buildExcelSummaryPreview(empty);
  assert.equal(preview.sheets.length, 11);
  assert.equal(preview.sheets[1].rowCount, 0);

  const buffer = await generateBackupExcelBuffer(empty);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  assert.equal(wb.worksheets.length, 11);
  assert.equal(wb.getWorksheet('Customers')!.rowCount, 1);
});

test('backupExcel: exports 1,200+ sales rows accurately without truncating records', async () => {
  const base = makeSeedDataset();
  const bulkSales = Array.from({ length: 1205 }, (_, i) => ({
    ...base.sales[0],
    id: `bulk-sale-${i}`,
    invoiceNo: `INV-B-${1000 + i}`,
    amount: 100 + (i % 50),
    date: '2026-11-12T10:15:00.000Z',
  }));
  const largeDataset: StoreBusinessDataset = {
    ...base,
    sales: bulkSales,
  };

  const buffer = await generateBackupExcelBuffer(largeDataset);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const salesSheet = wb.getWorksheet('Sales Bills')!;
  assert.equal(salesSheet.rowCount, 1206); // 1 header + 1205 rows
  assert.equal(salesSheet.getRow(1206).getCell(1).value, 'bulk-sale-1204');
});
