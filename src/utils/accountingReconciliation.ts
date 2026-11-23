/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AccountingReconciliationReport,
  CustomerTransaction,
  Product,
  ReconciliationFinding,
  StoreBusinessDataset,
  SupplierTransaction,
} from '../types';
import {
  calculateCashbookSummary,
  calculateCustomerLedgerWithRunningBalance,
  calculateProfitAndLoss,
  calculateSupplierLedgerWithRunningBalance,
  isCashbookEntryActive,
  isSaleActive,
  resolveSupplierPurchaseUpfrontPaid,
  toLocalDayKey,
} from './accounting';

function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Generates a comprehensive, strictly READ-ONLY Accounting & Financial Reconciliation Audit Report
 * across Customers, Suppliers, Cashbook (Rokad), Inventory Valuation, Profit/COGS, and Data Integrity.
 * Never mutates store state or historical transactions.
 */
export function generateAccountingReconciliationReport(
  dataset: StoreBusinessDataset,
  referenceNow: Date = new Date()
): AccountingReconciliationReport {
  const generatedAt = referenceNow.toISOString();
  const findings: ReconciliationFinding[] = [];
  let seq = 0;
  const pushFinding = (f: Omit<ReconciliationFinding, 'id'>) => {
    seq += 1;
    findings.push({ id: `rec-${seq}-${f.code.toLowerCase()}`, ...f });
  };

  const customers = dataset.customers || [];
  const customerTransactions = dataset.customerTransactions || [];
  const suppliers = dataset.suppliers || [];
  const supplierTransactions = dataset.supplierTransactions || [];
  const sales = dataset.sales || [];
  const expenses = dataset.expenses || [];
  const cashbookEntries = dataset.cashbookEntries || [];
  const products = dataset.products || [];
  const stockAdjustments = dataset.stockAdjustments || [];

  // ==========================================
  // 1. CUSTOMER UDHAR AUDIT
  // ==========================================
  const customerIds = new Set(customers.map((c) => c.id));
  let storedReceivables = 0;
  let recalculatedReceivables = 0;
  let customerDriftedCount = 0;
  const driftedCustomerIds: string[] = [];

  for (const cust of customers) {
    const storedBal = r2(Number(cust.currentBalance) || 0);
    const ledger = calculateCustomerLedgerWithRunningBalance(cust, customerTransactions);
    const calcBal = r2(ledger.closingBalance);

    if (storedBal > 0) storedReceivables += storedBal;
    if (calcBal > 0) recalculatedReceivables += calcBal;

    if (Math.abs(calcBal - storedBal) > 0.01) {
      customerDriftedCount += 1;
      driftedCustomerIds.push(cust.id);
    }
  }
  storedReceivables = r2(storedReceivables);
  recalculatedReceivables = r2(recalculatedReceivables);
  const customerNetDelta = r2(recalculatedReceivables - storedReceivables);

  if (customerDriftedCount > 0) {
    pushFinding({
      code: 'CUSTOMER_BALANCE_DRIFT',
      section: 'CUSTOMERS',
      severity: 'CRITICAL',
      title: `${customerDriftedCount} customer balance(s) differ from ledger history`,
      description: `Stored receivables (₹${storedReceivables.toLocaleString('en-IN')}) differ from ledger-recalculated receivables (₹${recalculatedReceivables.toLocaleString('en-IN')}).`,
      affectedCount: customerDriftedCount,
      financialImpact: Math.abs(customerNetDelta),
      entityIds: driftedCustomerIds,
    });
  }

  const openingStoredAsCredit = customerTransactions.filter(
    (tx) =>
      tx.status !== 'CANCELLED' &&
      tx.status !== 'REVERSED' &&
      tx.type === 'CREDIT' &&
      Boolean(tx.description && tx.description.toLowerCase().includes('opening balance'))
  );
  if (openingStoredAsCredit.length > 0) {
    pushFinding({
      code: 'CUSTOMER_OPENING_STORED_AS_CREDIT',
      section: 'CUSTOMERS',
      severity: 'INFO',
      title: `${openingStoredAsCredit.length} legacy customer opening balance stored as CREDIT`,
      description:
        'Historical opening balance entries were saved with type CREDIT. Ledger calculations separate them from period credit sales without modifying records.',
      affectedCount: openingStoredAsCredit.length,
      entityIds: openingStoredAsCredit.map((t) => t.id),
    });
  }

  const activeCreditTxByCustInvoice = new Set<string>();
  const activeCreditTxByCustId = new Map<string, CustomerTransaction[]>();
  for (const tx of customerTransactions) {
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') continue;
    if (tx.type !== 'CREDIT') continue;
    if (tx.invoiceNo) {
      activeCreditTxByCustInvoice.add(`${tx.customerId}::${tx.invoiceNo}`);
    }
    const list = activeCreditTxByCustId.get(tx.customerId) || [];
    list.push(tx);
    activeCreditTxByCustId.set(tx.customerId, list);
  }

  const activeSales = sales.filter(isSaleActive);
  const creditSalesMissingLedger = activeSales.filter((s) => {
    if (!(s.isCredit || s.paymentMethod === 'CREDIT')) return false;
    if (!s.customerId || !customerIds.has(s.customerId)) return true;
    if (s.invoiceNo && activeCreditTxByCustInvoice.has(`${s.customerId}::${s.invoiceNo}`)) {
      return false;
    }
    const custCredits = activeCreditTxByCustId.get(s.customerId) || [];
    const saleDay = toLocalDayKey(s.date || s.createdAt);
    const hasApproxMatch = custCredits.some(
      (tx) => Math.abs((Number(tx.amount) || 0) - (Number(s.amount) || 0)) < 0.01 && toLocalDayKey(tx.date || tx.createdAt) === saleDay
    );
    return !hasApproxMatch;
  });

  if (creditSalesMissingLedger.length > 0) {
    pushFinding({
      code: 'CREDIT_SALE_MISSING_LEDGER',
      section: 'CUSTOMERS',
      severity: 'CRITICAL',
      title: `${creditSalesMissingLedger.length} credit (Udhar) bill(s) missing customer ledger entry`,
      description: 'Active credit sales were found without a matching active customer profile or CREDIT ledger transaction.',
      affectedCount: creditSalesMissingLedger.length,
      financialImpact: r2(creditSalesMissingLedger.reduce((s, b) => s + (Number(b.amount) || 0), 0)),
      entityIds: creditSalesMissingLedger.map((b) => b.id),
    });
  }

  const orphanedCustomerTx = customerTransactions.filter((tx) => !customerIds.has(tx.customerId));
  if (orphanedCustomerTx.length > 0) {
    pushFinding({
      code: 'ORPHANED_CUSTOMER_TX',
      section: 'CUSTOMERS',
      severity: 'CRITICAL',
      title: `${orphanedCustomerTx.length} orphaned customer transaction(s)`,
      description: 'Customer ledger entries reference a customer ID not present in the active customer list.',
      affectedCount: orphanedCustomerTx.length,
      entityIds: orphanedCustomerTx.map((t) => t.id),
    });
  }

  // ==========================================
  // 2. SUPPLIER PAYABLE AUDIT
  // ==========================================
  const supplierIds = new Set(suppliers.map((s) => s.id));
  let storedPayables = 0;
  let recalculatedPayables = 0;
  let supplierDriftedCount = 0;
  const driftedSupplierIds: string[] = [];

  for (const sup of suppliers) {
    const storedBal = r2(Number(sup.currentBalance) || 0);
    const ledger = calculateSupplierLedgerWithRunningBalance(sup, supplierTransactions);
    const calcBal = r2(ledger.closingBalance);

    if (storedBal > 0) storedPayables += storedBal;
    if (calcBal > 0) recalculatedPayables += calcBal;

    if (Math.abs(calcBal - storedBal) > 0.01) {
      supplierDriftedCount += 1;
      driftedSupplierIds.push(sup.id);
    }
  }
  storedPayables = r2(storedPayables);
  recalculatedPayables = r2(recalculatedPayables);
  const supplierNetDelta = r2(recalculatedPayables - storedPayables);

  if (supplierDriftedCount > 0) {
    pushFinding({
      code: 'SUPPLIER_BALANCE_DRIFT',
      section: 'SUPPLIERS',
      severity: 'CRITICAL',
      title: `${supplierDriftedCount} supplier payable balance(s) differ from ledger history`,
      description: `Stored payables (₹${storedPayables.toLocaleString('en-IN')}) differ from ledger-recalculated payables (₹${recalculatedPayables.toLocaleString('en-IN')}).`,
      affectedCount: supplierDriftedCount,
      financialImpact: Math.abs(supplierNetDelta),
      entityIds: driftedSupplierIds,
    });
  }

  const legacyPartialWithoutPaidAmount = supplierTransactions.filter(
    (tx) =>
      tx.status !== 'CANCELLED' &&
      tx.status !== 'REVERSED' &&
      tx.type === 'PURCHASE' &&
      tx.paymentStatus === 'PARTIAL' &&
      (tx.paidAmount === undefined || !Number.isFinite(Number(tx.paidAmount)))
  );
  if (legacyPartialWithoutPaidAmount.length > 0) {
    pushFinding({
      code: 'LEGACY_PARTIAL_PURCHASE_NO_PAID_AMOUNT',
      section: 'SUPPLIERS',
      severity: 'WARNING',
      title: `${legacyPartialWithoutPaidAmount.length} legacy partial purchase(s) use 50% upfront fallback`,
      description:
        'Older PARTIAL supplier bills without an explicit paidAmount field preserve the legacy 50% settlement rule rather than rewriting history.',
      affectedCount: legacyPartialWithoutPaidAmount.length,
      entityIds: legacyPartialWithoutPaidAmount.map((t) => t.id),
    });
  }

  const openingStoredAsPurchase = supplierTransactions.filter(
    (tx) =>
      tx.status !== 'CANCELLED' &&
      tx.status !== 'REVERSED' &&
      tx.type === 'PURCHASE' &&
      Boolean(tx.description && tx.description.toLowerCase().includes('opening balance'))
  );
  if (openingStoredAsPurchase.length > 0) {
    pushFinding({
      code: 'SUPPLIER_OPENING_STORED_AS_PURCHASE',
      section: 'SUPPLIERS',
      severity: 'INFO',
      title: `${openingStoredAsPurchase.length} legacy supplier opening balance stored as PURCHASE`,
      description:
        'Historical supplier opening balances were saved with type PURCHASE. Ledger summaries exclude them from period purchases automatically.',
      affectedCount: openingStoredAsPurchase.length,
      entityIds: openingStoredAsPurchase.map((t) => t.id),
    });
  }

  const orphanedSupplierTx = supplierTransactions.filter((tx) => !supplierIds.has(tx.supplierId));
  if (orphanedSupplierTx.length > 0) {
    pushFinding({
      code: 'ORPHANED_SUPPLIER_TX',
      section: 'SUPPLIERS',
      severity: 'CRITICAL',
      title: `${orphanedSupplierTx.length} orphaned supplier transaction(s)`,
      description: 'Supplier ledger entries reference a supplier ID missing from the suppliers list.',
      affectedCount: orphanedSupplierTx.length,
      entityIds: orphanedSupplierTx.map((t) => t.id),
    });
  }

  // ==========================================
  // 3. CASHBOOK (ROKAD) AUDIT
  // ==========================================
  const activeCashbook = cashbookEntries.filter(isCashbookEntryActive);
  const cancelledCashbookCount = cashbookEntries.length - activeCashbook.length;
  const cashSummary = calculateCashbookSummary(0, cashbookEntries);

  // Chronological day-end balance check for negative cash days
  const dailyCashDelta = new Map<string, number>();
  for (const cb of activeCashbook) {
    const dayKey = toLocalDayKey(cb.date || cb.createdAt) || '0000-00-00';
    const amt = Number(cb.amount) || 0;
    const signed = cb.type === 'IN' ? amt : -amt;
    dailyCashDelta.set(dayKey, (dailyCashDelta.get(dayKey) || 0) + signed);
  }
  const sortedDays = Array.from(dailyCashDelta.keys()).sort();
  let runningDayCash = 0;
  let negativeCashDaysCount = 0;
  for (const dk of sortedDays) {
    runningDayCash = r2(runningDayCash + (dailyCashDelta.get(dk) || 0));
    if (runningDayCash < -0.01) {
      negativeCashDaysCount += 1;
    }
  }
  if (negativeCashDaysCount > 0 || cashSummary.closingCash < -0.01) {
    pushFinding({
      code: 'NEGATIVE_CASHBOOK_BALANCE',
      section: 'CASHBOOK',
      severity: cashSummary.closingCash < -0.01 ? 'CRITICAL' : 'WARNING',
      title: `Cashbook went negative on ${negativeCashDaysCount} day(s) (Closing ₹${cashSummary.closingCash.toLocaleString('en-IN')})`,
      description: 'Physical cash outflows exceeded recorded cash inflows. Check missing Opening Cash, Owner Capital, or cash sale entries.',
      affectedCount: negativeCashDaysCount,
      financialImpact: cashSummary.closingCash < 0 ? Math.abs(cashSummary.closingCash) : undefined,
    });
  }

  const cashSaleIdsInCb = new Set(
    activeCashbook.filter((c) => c.refType === 'SALE' && c.refId).map((c) => c.refId as string)
  );
  const cashSalesMissingCb = activeSales.filter(
    (s) => s.paymentMethod === 'CASH' && !s.isCredit && !cashSaleIdsInCb.has(s.id)
  );
  if (cashSalesMissingCb.length > 0) {
    pushFinding({
      code: 'CASH_SALES_MISSING_CASHBOOK',
      section: 'CASHBOOK',
      severity: 'WARNING',
      title: `${cashSalesMissingCb.length} cash sale bill(s) missing Cashbook IN entry`,
      description: 'Counter cash sales do not have a linked active SALE entry in the Cashbook (Rokad).',
      affectedCount: cashSalesMissingCb.length,
      financialImpact: r2(cashSalesMissingCb.reduce((s, b) => s + (Number(b.amount) || 0), 0)),
      entityIds: cashSalesMissingCb.map((b) => b.id),
    });
  }

  const custPayCbIds = new Set(
    activeCashbook.filter((c) => c.refType === 'CUSTOMER_PAYMENT' && c.refId).map((c) => c.refId as string)
  );
  const suppPayCbIds = new Set(
    activeCashbook.filter((c) => c.refType === 'SUPPLIER_PAYMENT' && c.refId).map((c) => c.refId as string)
  );
  const suppPurchCbIds = new Set(
    activeCashbook.filter((c) => c.refType === 'PURCHASE' && c.refId).map((c) => c.refId as string)
  );

  const missingCustCashPayments = customerTransactions.filter(
    (tx) =>
      tx.status !== 'CANCELLED' &&
      tx.status !== 'REVERSED' &&
      tx.type === 'PAYMENT' &&
      tx.paymentMethod === 'CASH' &&
      !custPayCbIds.has(tx.id)
  );
  const missingSuppCashPayments = supplierTransactions.filter(
    (tx) =>
      tx.status !== 'CANCELLED' &&
      tx.status !== 'REVERSED' &&
      tx.type === 'PAYMENT' &&
      tx.paymentMethod === 'CASH' &&
      !suppPayCbIds.has(tx.id)
  );
  const cashPaymentsMissingCount = missingCustCashPayments.length + missingSuppCashPayments.length;
  if (cashPaymentsMissingCount > 0) {
    pushFinding({
      code: 'CASH_PAYMENTS_MISSING_CASHBOOK',
      section: 'CASHBOOK',
      severity: 'WARNING',
      title: `${cashPaymentsMissingCount} cash party payment(s) missing Cashbook entry`,
      description: 'Cash payments received from customers or paid to suppliers lack matching active Cashbook links.',
      affectedCount: cashPaymentsMissingCount,
      entityIds: [
        ...missingCustCashPayments.map((t) => t.id),
        ...missingSuppCashPayments.map((t) => t.id),
      ],
    });
  }

  const missingUpfrontCashPurchases = supplierTransactions.filter((tx) => {
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') return false;
    if (tx.type !== 'PURCHASE') return false;
    if (tx.description && tx.description.toLowerCase().includes('opening balance')) return false;
    if (tx.paymentMethod !== 'CASH') return false;
    const upfront = resolveSupplierPurchaseUpfrontPaid(tx);
    return upfront > 0 && !suppPurchCbIds.has(tx.id);
  });
  if (missingUpfrontCashPurchases.length > 0) {
    pushFinding({
      code: 'UPFRONT_CASH_PURCHASES_MISSING_CASHBOOK',
      section: 'CASHBOOK',
      severity: 'WARNING',
      title: `${missingUpfrontCashPurchases.length} cash stock purchase(s) missing Cashbook OUT entry`,
      description:
        'Paid/partial cash purchases from suppliers do not have matching PURCHASE outflow entries in the Cashbook.',
      affectedCount: missingUpfrontCashPurchases.length,
      financialImpact: r2(
        missingUpfrontCashPurchases.reduce((s, t) => s + resolveSupplierPurchaseUpfrontPaid(t), 0)
      ),
      entityIds: missingUpfrontCashPurchases.map((t) => t.id),
    });
  }

  const saleMap = new Map(sales.map((s) => [s.id, s]));
  const expenseMap = new Map(expenses.map((e) => [e.id, e]));
  const custTxMap = new Map(customerTransactions.map((t) => [t.id, t]));
  const suppTxMap = new Map(supplierTransactions.map((t) => [t.id, t]));

  let orphanedExpenseCashbookCount = 0;
  let dateMismatchCount = 0;

  for (const cb of activeCashbook) {
    const cbDay = toLocalDayKey(cb.date || cb.createdAt);
    if (!cb.refId) continue;

    if (cb.refType === 'EXPENSE' || cb.refType === 'DRAWING') {
      const exp = expenseMap.get(cb.refId);
      if (!exp) {
        orphanedExpenseCashbookCount += 1;
      } else if (toLocalDayKey(exp.date || exp.createdAt) !== cbDay) {
        dateMismatchCount += 1;
      }
    } else if (cb.refType === 'SALE') {
      const s = saleMap.get(cb.refId);
      if (!s || !isSaleActive(s)) {
        orphanedExpenseCashbookCount += 1;
      } else if (toLocalDayKey(s.date || s.createdAt) !== cbDay) {
        dateMismatchCount += 1;
      }
    } else if (cb.refType === 'CUSTOMER_PAYMENT') {
      const ctx = custTxMap.get(cb.refId);
      if (!ctx || ctx.status === 'CANCELLED' || ctx.status === 'REVERSED') {
        orphanedExpenseCashbookCount += 1;
      } else if (toLocalDayKey(ctx.date || ctx.createdAt) !== cbDay) {
        dateMismatchCount += 1;
      }
    } else if (cb.refType === 'SUPPLIER_PAYMENT' || cb.refType === 'PURCHASE') {
      const stx = suppTxMap.get(cb.refId);
      if (!stx || stx.status === 'CANCELLED' || stx.status === 'REVERSED') {
        orphanedExpenseCashbookCount += 1;
      } else if (toLocalDayKey(stx.date || stx.createdAt) !== cbDay) {
        dateMismatchCount += 1;
      }
    }
  }

  if (orphanedExpenseCashbookCount > 0) {
    pushFinding({
      code: 'ORPHANED_CASHBOOK_REFERENCES',
      section: 'CASHBOOK',
      severity: 'CRITICAL',
      title: `${orphanedExpenseCashbookCount} active Cashbook entry(s) point to deleted or cancelled sources`,
      description: 'Cashbook entries reference deleted expenses or cancelled sales/party payments and still affect drawer cash.',
      affectedCount: orphanedExpenseCashbookCount,
    });
  }

  if (dateMismatchCount > 0) {
    pushFinding({
      code: 'CASHBOOK_DATE_MISMATCH',
      section: 'CASHBOOK',
      severity: 'WARNING',
      title: `${dateMismatchCount} Cashbook entry(s) have different local dates than source transactions`,
      description: 'A cashbook entry date does not match its originating sale, expense, or payment date.',
      affectedCount: dateMismatchCount,
    });
  }

  // ==========================================
  // 4. INVENTORY & VALUATION AUDIT
  // ==========================================
  const productMap = new Map<string, Product>(products.map((p) => [p.id, p]));
  const activeProducts = products.filter((p) => !p.isArchived);

  // Weighted historical purchase price per product from active supplier PURCHASE rows
  const weightedCostMap = new Map<string, { spend: number; qty: number }>();
  for (const st of supplierTransactions) {
    if (st.status === 'CANCELLED' || st.status === 'REVERSED') continue;
    if (st.type !== 'PURCHASE' || !st.productId) continue;
    const qty = Number(st.quantity) || 0;
    const unitPrice = Number(st.unitPrice);
    if (qty > 0 && Number.isFinite(unitPrice) && unitPrice >= 0) {
      const prev = weightedCostMap.get(st.productId) || { spend: 0, qty: 0 };
      prev.spend += qty * unitPrice;
      prev.qty += qty;
      weightedCostMap.set(st.productId, prev);
    }
  }

  let catalogCostValuation = 0;
  let historicalWeightedValuation = 0;
  let negativeStockCount = 0;

  for (const p of activeProducts) {
    const qty = Number(p.stockQty) || 0;
    const catCost = Number(p.purchasePrice) || 0;
    const hist = weightedCostMap.get(p.id);
    const histCost =
      hist && hist.qty > 0
        ? hist.spend / hist.qty
        : p.lastPurchasePrice !== undefined && Number.isFinite(Number(p.lastPurchasePrice))
        ? Number(p.lastPurchasePrice)
        : catCost;

    catalogCostValuation += qty * catCost;
    historicalWeightedValuation += qty * histCost;
    if (qty < 0) negativeStockCount += 1;
  }

  catalogCostValuation = r2(catalogCostValuation);
  historicalWeightedValuation = r2(historicalWeightedValuation);
  const valuationDifference = r2(historicalWeightedValuation - catalogCostValuation);

  if (negativeStockCount > 0) {
    pushFinding({
      code: 'NEGATIVE_INVENTORY_STOCK',
      section: 'INVENTORY',
      severity: 'CRITICAL',
      title: `${negativeStockCount} product(s) have negative stock quantity`,
      description: 'Physical stock cannot be below zero unless negative-stock override was used. Verify purchase entries.',
      affectedCount: negativeStockCount,
    });
  }

  const zeroCostSoldIds = new Set<string>();
  for (const s of activeSales) {
    for (const it of s.items || []) {
      const hasSnapshot =
        it.unitCostAtSale !== undefined &&
        it.unitCostAtSale !== null &&
        Number.isFinite(Number(it.unitCostAtSale));
      if (hasSnapshot && Number(it.unitCostAtSale) <= 0 && it.productId) {
        zeroCostSoldIds.add(it.productId);
      } else if (!hasSnapshot && it.productId) {
        const p = productMap.get(it.productId);
        if (p && (Number(p.purchasePrice) || 0) <= 0) {
          zeroCostSoldIds.add(p.id);
        }
      }
    }
  }
  const zeroCostSoldProductsCount = zeroCostSoldIds.size;
  if (zeroCostSoldProductsCount > 0) {
    pushFinding({
      code: 'ZERO_COST_SOLD_PRODUCTS',
      section: 'INVENTORY',
      severity: 'WARNING',
      title: `${zeroCostSoldProductsCount} sold product(s) have ₹0 or missing purchase cost`,
      description: 'Items sold without a documented purchase price leave revenue uncosted instead of inflating profit.',
      affectedCount: zeroCostSoldProductsCount,
      entityIds: Array.from(zeroCostSoldIds),
    });
  }

  if (Math.abs(valuationDifference) > 100) {
    pushFinding({
      code: 'CATALOG_VS_HISTORICAL_COST_SPREAD',
      section: 'INVENTORY',
      severity: 'INFO',
      title: `Catalog stock value differs from historical weighted purchase cost by ₹${Math.abs(valuationDifference).toLocaleString('en-IN')}`,
      description: `Catalog purchase valuation is ₹${catalogCostValuation.toLocaleString('en-IN')} vs historical weighted purchase cost ₹${historicalWeightedValuation.toLocaleString('en-IN')}.`,
      financialImpact: Math.abs(valuationDifference),
    });
  }

  const orphanedAdjustments = stockAdjustments.filter((a) => !productMap.has(a.productId));
  const adjustmentsByProduct = new Map<string, typeof stockAdjustments>();
  for (const adj of stockAdjustments) {
    const arr = adjustmentsByProduct.get(adj.productId) || [];
    arr.push(adj);
    adjustmentsByProduct.set(adj.productId, arr);
  }
  let stockAdjustmentDivergenceCount = 0;
  for (const [pid, list] of adjustmentsByProduct.entries()) {
    const p = productMap.get(pid);
    if (!p) continue;
    const sorted = [...list].sort(
      (a, b) => new Date(a.createdAt || a.date).getTime() - new Date(b.createdAt || b.date).getTime()
    );
    const latest = sorted[sorted.length - 1];
    if (latest && Math.abs((Number(latest.newStock) || 0) - (Number(p.stockQty) || 0)) > 0.01) {
      stockAdjustmentDivergenceCount += 1;
    }
  }
  if (stockAdjustmentDivergenceCount > 0) {
    pushFinding({
      code: 'STOCK_ADJUSTMENT_LOG_DIVERGENCE',
      section: 'INVENTORY',
      severity: 'WARNING',
      title: `${stockAdjustmentDivergenceCount} product(s) stock differs from latest stock adjustment log`,
      description: 'Current product stockQty does not match the ending balance on the most recent StockAdjustmentRecord.',
      affectedCount: stockAdjustmentDivergenceCount,
    });
  }

  const skippedIncompatibleAdjustments = stockAdjustments.filter(
    (a) => a.reconciliationStatus === 'SKIPPED_INCOMPATIBLE_UNIT'
  );
  if (skippedIncompatibleAdjustments.length > 0) {
    pushFinding({
      code: 'SKIPPED_INCOMPATIBLE_RETURN_STOCK',
      section: 'INVENTORY',
      severity: 'WARNING',
      title: `${skippedIncompatibleAdjustments.length} return stock movement(s) skipped due to incompatible catalog unit`,
      description:
        'A customer return had a historical base unit incompatible with the product current catalog unit. Current inventory was preserved uncorrupted and a manual stock reconciliation record was saved.',
      affectedCount: skippedIncompatibleAdjustments.length,
      entityIds: skippedIncompatibleAdjustments.map((a) => a.referenceId || a.id),
    });
  }

  // ==========================================
  // 5. PROFIT & COGS AUDIT
  // ==========================================
  const pnl = calculateProfitAndLoss(sales, expenses, productMap, customerTransactions);
  const cancelledSalesCount = sales.length - activeSales.length;

  if (pnl.missingHistoricalCostItemsCount > 0) {
    pushFinding({
      code: 'MISSING_HISTORICAL_ITEM_COST',
      section: 'PROFIT_COGS',
      severity: 'WARNING',
      title: `${pnl.missingHistoricalCostItemsCount} legacy sale item(s) lack sale-time historical cost snapshot (₹${pnl.missingHistoricalCostRevenue.toLocaleString('en-IN')})`,
      description:
        'Older bills created without a recorded unitCostAtSale snapshot cannot reconstruct historical purchase cost safely. Old records are preserved unchanged and marked UNCOSTED rather than using current catalog purchase prices.',
      affectedCount: pnl.missingHistoricalCostItemsCount,
      financialImpact: pnl.missingHistoricalCostRevenue,
      entityIds: pnl.uncostedSaleIds,
    });
  }

  if (pnl.ambiguousReturnsCount > 0) {
    pushFinding({
      code: 'AMBIGUOUS_RETURN_MATCH',
      section: 'PROFIT_COGS',
      severity: 'WARNING',
      title: `${pnl.ambiguousReturnsCount} sales return(s) require manual review (ambiguous or invalid sale-line match)`,
      description:
        'Sales returns without a unique original saleLineId against multi-line invoices with differing unit/cost, or referencing cancelled/unmatched invoice lines, are flagged NEEDS_REVIEW instead of guessing COGS.',
      affectedCount: pnl.ambiguousReturnsCount,
      entityIds: pnl.ambiguousReturnIds,
    });
  }

  if (pnl.uncostedReturnsCount > 0) {
    pushFinding({
      code: 'UNCOSTED_RETURN_NEEDS_REVIEW',
      section: 'PROFIT_COGS',
      severity: 'WARNING',
      title: `${pnl.uncostedReturnsCount} sales return(s) lack linked original sale cost (₹${pnl.uncostedReturnsAmount.toLocaleString('en-IN')})`,
      description:
        'Sales returns not linked to an original billed sale line cost are flagged NEEDS_REVIEW and do not invent COGS deductions from current catalog prices.',
      affectedCount: pnl.uncostedReturnsCount,
      financialImpact: pnl.uncostedReturnsAmount,
      entityIds: pnl.uncostedReturnIds,
    });
  }

  if (pnl.unreconstructibleUnitItemsCount > 0) {
    pushFinding({
      code: 'UNRECONSTRUCTIBLE_UNIT_CONVERSION',
      section: 'PROFIT_COGS',
      severity: 'WARNING',
      title: `${pnl.unreconstructibleUnitItemsCount} historical item(s) have missing base unit or incompatible units`,
      description:
        'Items missing a historical baseUnit or whose selling unit cannot convert cleanly to their historical base unit are marked NEEDS_REVIEW instead of guessing or reinterpreting with current catalog units.',
      affectedCount: pnl.unreconstructibleUnitItemsCount,
      entityIds: pnl.unreconstructibleUnitItemIds,
    });
  }

  if (!pnl.hasCompleteCogs && pnl.uncostedRevenue > 0) {
    pushFinding({
      code: 'PARTIAL_COGS_COVERAGE',
      section: 'PROFIT_COGS',
      severity: 'WARNING',
      title: `${pnl.costCoveragePct}% COGS coverage (₹${pnl.uncostedRevenue.toLocaleString('en-IN')} uncosted revenue)`,
      description:
        'Quick/non-itemized bills, legacy items without historical cost snapshots, or ₹0-cost items cannot determine purchase cost accurately. Reported COGS excludes uncosted items instead of guessing 85% or using current catalog cost.',
      affectedCount: pnl.uncostedItemsCount,
      financialImpact: pnl.uncostedRevenue,
      entityIds: pnl.uncostedSaleIds,
    });
  }

  // ==========================================
  // 6. REFERENTIAL & DUPLICATE ID INTEGRITY
  // ==========================================
  const duplicateIdDetails: string[] = [];
  const checkDuplicateIds = (label: string, list: Array<{ id: string }>) => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const item of list) {
      if (!item?.id) continue;
      if (seen.has(item.id)) dupes.add(item.id);
      else seen.add(item.id);
    }
    if (dupes.size > 0) {
      duplicateIdDetails.push(`${label}: ${Array.from(dupes).join(', ')}`);
    }
  };

  checkDuplicateIds('customers', customers);
  checkDuplicateIds('customerTransactions', customerTransactions);
  checkDuplicateIds('suppliers', suppliers);
  checkDuplicateIds('supplierTransactions', supplierTransactions);
  checkDuplicateIds('sales', sales);
  checkDuplicateIds('expenses', expenses);
  checkDuplicateIds('cashbookEntries', cashbookEntries);
  checkDuplicateIds('products', products);
  checkDuplicateIds('stockAdjustments', stockAdjustments);

  if (duplicateIdDetails.length > 0) {
    pushFinding({
      code: 'DUPLICATE_RECORD_IDS',
      section: 'INTEGRITY',
      severity: 'CRITICAL',
      title: `Duplicate IDs detected in ${duplicateIdDetails.length} collection(s)`,
      description: duplicateIdDetails.join(' | '),
      affectedCount: duplicateIdDetails.length,
    });
  }

  const critical = findings.filter((f) => f.severity === 'CRITICAL').length;
  const warning = findings.filter((f) => f.severity === 'WARNING').length;
  const info = findings.filter((f) => f.severity === 'INFO').length;

  return {
    generatedAt,
    hasCriticalIssues: critical > 0,
    hasWarnings: warning > 0,
    isFullyReconciled: critical === 0 && warning === 0,
    countsBySeverity: {
      critical,
      warning,
      info,
    },
    customerAudit: {
      totalCustomers: customers.length,
      storedReceivables,
      recalculatedReceivables,
      netDelta: customerNetDelta,
      driftedCount: customerDriftedCount,
      openingStoredAsCreditCount: openingStoredAsCredit.length,
      creditSalesMissingLedgerCount: creditSalesMissingLedger.length,
      orphanedTxCount: orphanedCustomerTx.length,
    },
    supplierAudit: {
      totalSuppliers: suppliers.length,
      storedPayables,
      recalculatedPayables,
      netDelta: supplierNetDelta,
      driftedCount: supplierDriftedCount,
      legacyPartialWithoutPaidAmountCount: legacyPartialWithoutPaidAmount.length,
      openingStoredAsPurchaseCount: openingStoredAsPurchase.length,
      orphanedTxCount: orphanedSupplierTx.length,
    },
    cashbookAudit: {
      totalEntries: cashbookEntries.length,
      activeEntries: activeCashbook.length,
      cancelledEntries: cancelledCashbookCount,
      closingCash: cashSummary.closingCash,
      negativeCashDaysCount,
      cashSalesMissingCashbookCount: cashSalesMissingCb.length,
      cashPaymentsMissingCashbookCount: cashPaymentsMissingCount,
      upfrontCashPurchasesMissingCashbookCount: missingUpfrontCashPurchases.length,
      orphanedExpenseCashbookCount,
      dateMismatchCount,
    },
    inventoryAudit: {
      activeProductsCount: activeProducts.length,
      catalogCostValuation,
      historicalWeightedValuation,
      valuationDifference,
      negativeStockCount,
      zeroCostSoldProductsCount,
      stockAdjustmentDivergenceCount,
      orphanedAdjustmentsCount: orphanedAdjustments.length,
    },
    profitAudit: {
      activeSalesCount: activeSales.length,
      cancelledSalesCount,
      grossSalesRevenue: pnl.grossRevenue,
      salesReturnsAmount: pnl.salesReturns,
      netSalesRevenue: pnl.totalRevenue,
      knownCogs: pnl.cogs,
      costedRevenue: pnl.costedRevenue,
      uncostedRevenue: pnl.uncostedRevenue,
      uncostedItemsCount: pnl.uncostedItemsCount,
      missingHistoricalCostCount: pnl.missingHistoricalCostItemsCount,
      missingHistoricalCostRevenue: pnl.missingHistoricalCostRevenue,
      uncostedSaleIds: pnl.uncostedSaleIds,
      uncostedReturnsCount: pnl.uncostedReturnsCount,
      uncostedReturnsAmount: pnl.uncostedReturnsAmount,
      uncostedReturnIds: pnl.uncostedReturnIds,
      unreconstructibleUnitItemsCount: pnl.unreconstructibleUnitItemsCount,
      unreconstructibleUnitItemIds: pnl.unreconstructibleUnitItemIds,
      ambiguousReturnsCount: pnl.ambiguousReturnsCount,
      ambiguousReturnIds: pnl.ambiguousReturnIds,
      skippedIncompatibleStockReturnsCount: skippedIncompatibleAdjustments.length,
      reviewStatus: pnl.reviewStatus,
      costCoveragePct: pnl.costCoveragePct,
    },
    integrityAudit: {
      duplicateIdsCount: duplicateIdDetails.length,
      duplicateIdDetails,
    },
    findings,
  };
}
