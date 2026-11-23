/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BackupReconciliationCustomerDrift,
  BackupReconciliationIssue,
  BackupReconciliationReport,
  BackupReconciliationSupplierDrift,
  BillAttachment,
  StoreBusinessDataset,
} from '../types';
import {
  calculateCashbookSummary,
  calculateCustomerLedgerWithRunningBalance,
  calculateSupplierLedgerWithRunningBalance,
} from './accounting';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Performs comprehensive pre-restore financial & referential reconciliation across
 * customers, suppliers, cashbook (Rokad), inventory stock adjustments, and bill attachments.
 */
export function generateBackupReconciliationReport(
  dataset: StoreBusinessDataset
): BackupReconciliationReport {
  const reconciledAt = new Date().toISOString();
  const issues: BackupReconciliationIssue[] = [];

  const customers = dataset.customers || [];
  const customerTransactions = dataset.customerTransactions || [];
  const suppliers = dataset.suppliers || [];
  const supplierTransactions = dataset.supplierTransactions || [];
  const sales = dataset.sales || [];
  const expenses = dataset.expenses || [];
  const cashbookEntries = dataset.cashbookEntries || [];
  const products = dataset.products || [];
  const stockAdjustments = dataset.stockAdjustments || [];
  const billDocuments = dataset.billDocuments || [];

  // 1. Customer Udhar reconciliation
  const customerIds = new Set(customers.map((c) => c.id));
  const driftedCustomers: BackupReconciliationCustomerDrift[] = [];
  let storedTotalOutstanding = 0;
  let recalculatedTotalOutstanding = 0;

  for (const cust of customers) {
    const storedBalance = round2(Number(cust.currentBalance) || 0);
    const ledger = calculateCustomerLedgerWithRunningBalance(cust, customerTransactions);
    const recalculatedBalance = round2(ledger.closingBalance);

    if (storedBalance > 0) storedTotalOutstanding += storedBalance;
    if (recalculatedBalance > 0) recalculatedTotalOutstanding += recalculatedBalance;

    const diff = round2(recalculatedBalance - storedBalance);
    if (Math.abs(diff) > 0.01) {
      driftedCustomers.push({
        customerId: cust.id,
        customerName: cust.name,
        storedBalance,
        recalculatedBalance,
        difference: diff,
        openingBalance: round2(Number(cust.openingBalance) || 0),
        transactionsCount: ledger.activeCount,
      });
    }
  }

  storedTotalOutstanding = round2(storedTotalOutstanding);
  recalculatedTotalOutstanding = round2(recalculatedTotalOutstanding);

  const orphanedCustomerTx = customerTransactions.filter((tx) => !customerIds.has(tx.customerId));
  const creditSalesMissingCustomer = sales.filter(
    (s) => (s.isCredit || s.paymentMethod === 'CREDIT') && (!s.customerId || !customerIds.has(s.customerId))
  );

  if (driftedCustomers.length > 0) {
    issues.push({
      code: 'CUSTOMER_BALANCE_DRIFT',
      severity: 'WARNING',
      message: `${driftedCustomers.length} customer balance(s) differ from ledger transaction history (Stored ₹${storedTotalOutstanding.toLocaleString('en-IN')} vs Recalculated ₹${recalculatedTotalOutstanding.toLocaleString('en-IN')}). Balances will be synchronized during restore.`,
    });
  }

  if (orphanedCustomerTx.length > 0) {
    issues.push({
      code: 'ORPHANED_CUSTOMER_TX',
      severity: 'CRITICAL',
      message: `${orphanedCustomerTx.length} customer transaction(s) reference a customer ID not present in the customers list.`,
    });
  }

  if (creditSalesMissingCustomer.length > 0) {
    issues.push({
      code: 'CREDIT_SALE_MISSING_CUSTOMER',
      severity: 'WARNING',
      message: `${creditSalesMissingCustomer.length} credit (Udhar) sale bill(s) reference a missing or deleted customer.`,
    });
  }

  // 2. Supplier Payable reconciliation
  const supplierIds = new Set(suppliers.map((s) => s.id));
  const driftedSuppliers: BackupReconciliationSupplierDrift[] = [];
  let storedTotalPayable = 0;
  let recalculatedTotalPayable = 0;

  for (const sup of suppliers) {
    const storedBalance = round2(Number(sup.currentBalance) || 0);
    const ledger = calculateSupplierLedgerWithRunningBalance(sup, supplierTransactions);
    const recalculatedBalance = round2(ledger.closingBalance);

    if (storedBalance > 0) storedTotalPayable += storedBalance;
    if (recalculatedBalance > 0) recalculatedTotalPayable += recalculatedBalance;

    const diff = round2(recalculatedBalance - storedBalance);
    if (Math.abs(diff) > 0.01) {
      driftedSuppliers.push({
        supplierId: sup.id,
        supplierName: sup.name,
        storedBalance,
        recalculatedBalance,
        difference: diff,
        openingBalance: round2(Number(sup.openingBalance) || 0),
        transactionsCount: ledger.activeCount,
      });
    }
  }

  storedTotalPayable = round2(storedTotalPayable);
  recalculatedTotalPayable = round2(recalculatedTotalPayable);

  const orphanedSupplierTx = supplierTransactions.filter((tx) => !supplierIds.has(tx.supplierId));

  if (driftedSuppliers.length > 0) {
    issues.push({
      code: 'SUPPLIER_BALANCE_DRIFT',
      severity: 'WARNING',
      message: `${driftedSuppliers.length} supplier payable balance(s) differ from ledger history (Stored ₹${storedTotalPayable.toLocaleString('en-IN')} vs Recalculated ₹${recalculatedTotalPayable.toLocaleString('en-IN')}). Balances will be synchronized during restore.`,
    });
  }

  if (orphanedSupplierTx.length > 0) {
    issues.push({
      code: 'ORPHANED_SUPPLIER_TX',
      severity: 'CRITICAL',
      message: `${orphanedSupplierTx.length} supplier transaction(s) reference a supplier ID not present in the suppliers list.`,
    });
  }

  // 3. Cashbook (Rokad) reconciliation
  const openingEntries = cashbookEntries.filter(
    (cb) => cb.category === 'OPENING' || cb.refType === 'OPENING'
  );
  const openingBalance = round2(
    openingEntries.reduce((sum, entry) => {
      const amt = Number(entry.amount) || 0;
      return entry.type === 'OUT' ? sum - amt : sum + amt;
    }, 0)
  );
  const nonOpeningEntries = cashbookEntries.filter(
    (cb) => !(cb.category === 'OPENING' || cb.refType === 'OPENING')
  );
  const cashSummaryAll = calculateCashbookSummary(0, cashbookEntries);
  const nonOpeningSummary = calculateCashbookSummary(0, nonOpeningEntries);

  const cashSaleRefIds = new Set(
    cashbookEntries
      .filter((cb) => cb.status !== 'CANCELLED' && cb.status !== 'REVERSED' && cb.refType === 'SALE' && cb.refId)
      .map((cb) => cb.refId as string)
  );
  const cashSales = sales.filter(
    (s) => s.status !== 'CANCELLED' && s.status !== 'REVERSED' && s.paymentMethod === 'CASH' && !s.isCredit
  );
  const cashSalesMissingCashbook =
    cashbookEntries.length > 0 && cashSaleRefIds.size > 0
      ? cashSales.filter((s) => !cashSaleRefIds.has(s.id))
      : [];

  if (openingEntries.length > 1) {
    issues.push({
      code: 'MULTIPLE_CASHBOOK_OPENING_ENTRIES',
      severity: 'WARNING',
      message: `Cashbook contains ${openingEntries.length} opening balance entries (total ₹${openingBalance.toLocaleString('en-IN')}). Verify opening Rokad amount.`,
    });
  }

  if (cashSummaryAll.closingCash < 0) {
    issues.push({
      code: 'NEGATIVE_CASHBOOK_CLOSING',
      severity: 'WARNING',
      message: `Calculated closing cash balance is negative (₹${cashSummaryAll.closingCash.toLocaleString('en-IN')}). Check cash inflow/outflow entries.`,
    });
  }

  if (cashSalesMissingCashbook.length > 0) {
    issues.push({
      code: 'CASH_SALES_MISSING_CASHBOOK',
      severity: 'INFO',
      message: `${cashSalesMissingCashbook.length} cash sale bill(s) do not have a matching SALE cashbook entry.`,
    });
  }

  // 4. Inventory & Attachment checks
  const productIds = new Set(products.map((p) => p.id));
  const negativeStockProductsCount = products.filter((p) => (Number(p.stockQty) || 0) < 0).length;
  const orphanedAdjustmentsCount = stockAdjustments.filter((adj) => !productIds.has(adj.productId)).length;

  if (negativeStockProductsCount > 0) {
    issues.push({
      code: 'NEGATIVE_INVENTORY_STOCK',
      severity: 'WARNING',
      message: `${negativeStockProductsCount} product(s) have negative stock quantity.`,
    });
  }

  if (orphanedAdjustmentsCount > 0) {
    issues.push({
      code: 'ORPHANED_STOCK_ADJUSTMENTS',
      severity: 'INFO',
      message: `${orphanedAdjustmentsCount} historical stock adjustment record(s) belong to archived/deleted product IDs.`,
    });
  }

  const docById = new Map<string, BillAttachment>();
  for (const doc of billDocuments) {
    if (doc && doc.id) {
      docById.set(doc.id, doc);
    }
  }

  let inlineAttachmentsTotal = 0;
  let missingAttachmentDataCount = 0;
  const seenAttachmentIds = new Set<string>();

  const inspectList = (list: Array<{ attachments?: BillAttachment[] }>) => {
    for (const rec of list) {
      if (!Array.isArray(rec.attachments)) continue;
      for (const att of rec.attachments) {
        if (!att || !att.id) continue;
        inlineAttachmentsTotal++;
        seenAttachmentIds.add(att.id);
        const resolvedDataUrl = att.dataUrl || docById.get(att.id)?.dataUrl || '';
        if (!resolvedDataUrl.trim()) {
          missingAttachmentDataCount++;
        }
      }
    }
  };

  inspectList(sales);
  inspectList(expenses);
  inspectList(customerTransactions);
  inspectList(supplierTransactions);
  inspectList(cashbookEntries);

  for (const doc of billDocuments) {
    if (!doc || !doc.id) continue;
    if (!doc.dataUrl || !doc.dataUrl.trim()) {
      missingAttachmentDataCount++;
    }
    if (!seenAttachmentIds.has(doc.id)) {
      seenAttachmentIds.add(doc.id);
    }
  }

  const attachmentsTotalCount = Math.max(seenAttachmentIds.size, inlineAttachmentsTotal);

  if (missingAttachmentDataCount > 0) {
    issues.push({
      code: 'MISSING_ATTACHMENT_BINARY',
      severity: 'WARNING',
      message: `${missingAttachmentDataCount} bill image/PDF attachment(s) are missing embedded file data and cannot be previewed.`,
    });
  }

  const hasDiscrepancies =
    driftedCustomers.length > 0 ||
    driftedSuppliers.length > 0 ||
    orphanedCustomerTx.length > 0 ||
    orphanedSupplierTx.length > 0 ||
    creditSalesMissingCustomer.length > 0 ||
    openingEntries.length > 1 ||
    cashSummaryAll.closingCash < 0 ||
    negativeStockProductsCount > 0 ||
    missingAttachmentDataCount > 0;

  const hasCriticalIssues = issues.some((i) => i.severity === 'CRITICAL');

  return {
    reconciledAt,
    hasDiscrepancies,
    hasCriticalIssues,
    customerSummary: {
      totalCustomers: customers.length,
      storedTotalOutstanding,
      recalculatedTotalOutstanding,
      netDelta: round2(recalculatedTotalOutstanding - storedTotalOutstanding),
      driftedCustomers,
      orphanedTransactionsCount: orphanedCustomerTx.length,
      creditSalesMissingCustomerCount: creditSalesMissingCustomer.length,
    },
    supplierSummary: {
      totalSuppliers: suppliers.length,
      storedTotalPayable,
      recalculatedTotalPayable,
      netDelta: round2(recalculatedTotalPayable - storedTotalPayable),
      driftedSuppliers,
      orphanedTransactionsCount: orphanedSupplierTx.length,
    },
    cashbookSummary: {
      entriesCount: cashbookEntries.length,
      openingEntriesCount: openingEntries.length,
      openingBalance,
      totalInflowsExcludingOpening: round2(nonOpeningSummary.totalInflows),
      totalOutflows: round2(cashSummaryAll.totalOutflows),
      closingBalance: round2(cashSummaryAll.closingCash),
      negativeCashBalance: cashSummaryAll.closingCash < 0,
      cashSalesMissingCashbookCount: cashSalesMissingCashbook.length,
    },
    inventorySummary: {
      productsCount: products.length,
      negativeStockProductsCount,
      orphanedAdjustmentsCount,
      attachmentsTotalCount,
      missingAttachmentDataCount,
    },
    issues,
  };
}
