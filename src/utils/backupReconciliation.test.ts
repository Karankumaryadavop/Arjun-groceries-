/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBackupReconciliationReport } from './backupReconciliation.ts';
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
} from './initialData.ts';
import { recalculateLedgerBalancesFromHistory } from './localDatabase.ts';
import { StoreBusinessDataset } from '../types/index.ts';

function makeCleanDataset(): StoreBusinessDataset {
  const base: StoreBusinessDataset = {
    profile: { ...initialStoreProfile },
    customers: initialCustomers.map((c) => ({ ...c })),
    customerTransactions: initialCustomerTransactions.map((t) => ({ ...t })),
    suppliers: initialSuppliers.map((s) => ({ ...s })),
    supplierTransactions: initialSupplierTransactions.map((t) => ({ ...t })),
    sales: initialSales.map((s) => ({ ...s })),
    expenses: initialExpenses.map((e) => ({ ...e })),
    cashbookEntries: initialCashbookEntries.map((cb) => ({ ...cb })),
    products: initialProducts.map((p) => ({ ...p })),
    stockAdjustments: initialStockAdjustments.map((a) => ({ ...a })),
    auditLogs: initialAuditLogs.map((l) => ({ ...l })),
    whatsappBatches: [],
    whatsappAuditLogs: [],
    billDocuments: [],
  };
  return recalculateLedgerBalancesFromHistory(base);
}

test('generateBackupReconciliationReport detects customer Udhar and supplier payable drift accurately', () => {
  const dataset = makeCleanDataset();
  const baselineReport = generateBackupReconciliationReport(dataset);
  assert.equal(baselineReport.customerSummary.driftedCustomers.length, 0);
  assert.equal(baselineReport.supplierSummary.driftedSuppliers.length, 0);

  // Introduce balance drift on first customer & first supplier
  dataset.customers[0].currentBalance = Number(dataset.customers[0].currentBalance) + 350;
  dataset.suppliers[0].currentBalance = Number(dataset.suppliers[0].currentBalance) - 200;

  const report = generateBackupReconciliationReport(dataset);

  assert.equal(report.hasDiscrepancies, true);
  assert.ok(
    report.customerSummary.driftedCustomers.some(
      (d) => d.customerId === dataset.customers[0].id && Math.abs(d.difference + 350) < 0.02
    )
  );
  assert.ok(
    report.supplierSummary.driftedSuppliers.some(
      (d) => d.supplierId === dataset.suppliers[0].id && Math.abs(d.difference - 200) < 0.02
    )
  );
  assert.ok(report.issues.some((i) => i.code === 'CUSTOMER_BALANCE_DRIFT'));
  assert.ok(report.issues.some((i) => i.code === 'SUPPLIER_BALANCE_DRIFT'));
});

test('generateBackupReconciliationReport detects orphaned references, negative cashbook, and missing attachment data', () => {
  const dataset = makeCleanDataset();

  dataset.customerTransactions.push({
    id: 'ctx-orphan-1',
    customerId: 'cust-missing-999',
    type: 'CREDIT',
    amount: 500,
    date: '2026-11-12T10:00:00.000Z',
    description: 'Orphaned credit entry',
    createdAt: '2026-11-12T10:00:00.000Z',
  });

  dataset.cashbookEntries.push({
    id: 'cb-huge-out-1',
    date: '2026-11-12T11:00:00.000Z',
    type: 'OUT',
    category: 'EXPENSE',
    description: 'Large cash payout',
    amount: 999999,
    paymentMode: 'CASH',
    refType: 'EXPENSE',
    createdAt: '2026-11-12T11:00:00.000Z',
  });

  dataset.sales[0] = {
    ...dataset.sales[0],
    attachments: [
      {
        id: 'att-broken-1',
        name: 'missing-bill.jpg',
        type: 'IMAGE',
        dataUrl: '',
        size: 1024,
        uploadedAt: '2026-11-12T11:00:00.000Z',
      },
    ],
  };

  const report = generateBackupReconciliationReport(dataset);

  assert.equal(report.hasDiscrepancies, true);
  assert.equal(report.hasCriticalIssues, true);
  assert.equal(report.customerSummary.orphanedTransactionsCount, 1);
  assert.equal(report.cashbookSummary.negativeCashBalance, true);
  assert.equal(report.inventorySummary.missingAttachmentDataCount, 1);
  assert.ok(report.issues.some((i) => i.code === 'ORPHANED_CUSTOMER_TX'));
  assert.ok(report.issues.some((i) => i.code === 'NEGATIVE_CASHBOOK_CLOSING'));
  assert.ok(report.issues.some((i) => i.code === 'MISSING_ATTACHMENT_BINARY'));
});
