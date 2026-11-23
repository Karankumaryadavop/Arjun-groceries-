import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import {
  calculateCashbookSummary,
  calculateInventoryValuation,
  calculateNonCashBankUpiSummary,
  calculateOpeningCashBeforeRange,
  calculateProfitAndLoss,
  filterStockMovements,
  formatINR,
  getLocalTodayKey,
  isSaleActive,
  matchesLedgerDateFilter,
  toLocalDayKey,
} from '../utils/accounting';
import {
  FileSpreadsheet,
  Download,
  Printer,
  FileDown,
  Receipt,
  ArrowUpDown,
  PackageSearch,
  Search,
  Users,
  ShoppingCart,
  Wallet,
  Database,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { PeriodFilterBar } from './PeriodFilterBar';
import {
  downloadDailySalesReportPDF,
  downloadCustomerUdharStatementPDF,
} from '../utils/pdfGenerator';
import { downloadStockMovementCSV } from '../utils/csv';
import { BrandLogo, BRAND_NAME } from './BrandLogo';

export const ReportsView: React.FC = () => {
  const {
    sales,
    filteredSales,
    filteredExpenses,
    customers,
    customerTransactions,
    suppliers,
    supplierTransactions,
    products,
    stockAdjustments,
    cashbookEntries,
    filteredCashbookEntries,
    accountingReconciliation,
    profile,
    dateFilter,
    customDateRange,
    exportBackupJSON,
    setIsBackupModalOpen,
    getBackupSummary,
    reportsActiveTab,
    setReportsActiveTab,
    stockReportProductFilter,
    setStockReportProductFilter,
  } = useStore();

  const [stockDatePreset, setStockDatePreset] = useState<
    'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'CUSTOM'
  >('ALL');
  const [stockStartDate, setStockStartDate] = useState('');
  const [stockEndDate, setStockEndDate] = useState('');
  const [stockSourceFilter, setStockSourceFilter] = useState<
    'ALL' | 'MANUAL' | 'SALE' | 'PURCHASE' | 'EDIT' | 'SALES_RETURN' | 'PURCHASE_RETURN'
  >('ALL');
  const [stockTypeFilter, setStockTypeFilter] = useState<'ALL' | 'ADD' | 'REDUCE'>('ALL');
  const [stockSearch, setStockSearch] = useState('');
  const [reconciliationSeverityFilter, setReconciliationSeverityFilter] = useState<
    'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'
  >('ALL');

  // PDF report parameters
  const [selectedReportDate, setSelectedReportDate] = useState<string>(getLocalTodayKey());
  const [selectedReportCustId, setSelectedReportCustId] = useState<string>(
    customers[0]?.id || ''
  );

  const effectiveStockDates = useMemo(() => {
    const now = new Date();
    const todayStr = getLocalTodayKey(now);
    if (stockDatePreset === 'ALL') return { startDate: undefined, endDate: undefined };
    if (stockDatePreset === 'TODAY') return { startDate: todayStr, endDate: todayStr };
    if (stockDatePreset === 'LAST_7_DAYS') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return { startDate: toLocalDayKey(d), endDate: todayStr };
    }
    if (stockDatePreset === 'LAST_30_DAYS') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      return { startDate: toLocalDayKey(d), endDate: todayStr };
    }
    if (stockDatePreset === 'THIS_MONTH') {
      return { startDate: `${todayStr.slice(0, 7)}-01`, endDate: todayStr };
    }
    return {
      startDate: stockStartDate || undefined,
      endDate: stockEndDate || undefined,
    };
  }, [stockDatePreset, stockStartDate, stockEndDate]);

  const stockReport = useMemo(
    () =>
      filterStockMovements(stockAdjustments, {
        startDate: effectiveStockDates.startDate,
        endDate: effectiveStockDates.endDate,
        productId: stockReportProductFilter,
        source: stockSourceFilter,
        type: stockTypeFilter,
        searchQuery: stockSearch,
      }),
    [
      stockAdjustments,
      effectiveStockDates,
      stockReportProductFilter,
      stockSourceFilter,
      stockTypeFilter,
      stockSearch,
    ]
  );

  const productsMap = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const filteredCustomerTxsForPeriod = useMemo(
    () =>
      customerTransactions.filter((t) =>
        matchesLedgerDateFilter(t.date || t.createdAt, dateFilter, customDateRange.startDate, customDateRange.endDate)
      ),
    [customerTransactions, dateFilter, customDateRange]
  );

  const filteredSupplierTxsForPeriod = useMemo(
    () =>
      supplierTransactions.filter((t) =>
        matchesLedgerDateFilter(t.date || t.createdAt, dateFilter, customDateRange.startDate, customDateRange.endDate)
      ),
    [supplierTransactions, dateFilter, customDateRange]
  );

  const periodPnl = useMemo(
    () => calculateProfitAndLoss(filteredSales, filteredExpenses, productsMap, filteredCustomerTxsForPeriod),
    [filteredSales, filteredExpenses, productsMap, filteredCustomerTxsForPeriod]
  );

  const periodOpeningCash = useMemo(
    () => calculateOpeningCashBeforeRange(cashbookEntries, dateFilter, customDateRange.startDate),
    [cashbookEntries, dateFilter, customDateRange.startDate]
  );

  const periodCashSummary = useMemo(
    () => calculateCashbookSummary(periodOpeningCash, filteredCashbookEntries),
    [periodOpeningCash, filteredCashbookEntries]
  );

  const periodBankUpiSummary = useMemo(
    () =>
      calculateNonCashBankUpiSummary({
        sales: filteredSales,
        customerTransactions: filteredCustomerTxsForPeriod,
        supplierTransactions: filteredSupplierTxsForPeriod,
        expenses: filteredExpenses,
      }),
    [filteredSales, filteredCustomerTxsForPeriod, filteredSupplierTxsForPeriod, filteredExpenses]
  );

  const inventoryVal = useMemo(() => calculateInventoryValuation(products), [products]);

  const netPeriodPurchases = useMemo(() => {
    let gross = 0;
    let ret = 0;
    for (const st of filteredSupplierTxsForPeriod) {
      if (st.status === 'CANCELLED' || st.status === 'REVERSED') continue;
      if (st.description && st.description.toLowerCase().includes('opening balance')) continue;
      if (st.type === 'PURCHASE') gross += Number(st.amount) || 0;
      else if (st.type === 'RETURN') ret += Number(st.amount) || 0;
    }
    return { gross, returns: ret, net: Math.round((gross - ret) * 100) / 100 };
  }, [filteredSupplierTxsForPeriod]);

  // Daily sales for selected date (active bills only, local calendar match)
  const selectedDaySales = useMemo(() => {
    return sales.filter(
      (s) => isSaleActive(s) && toLocalDayKey(s.date || s.createdAt) === selectedReportDate
    );
  }, [sales, selectedReportDate]);

  const selectedDayReturnTxs = useMemo(() => {
    return customerTransactions.filter(
      (t) =>
        t.status !== 'CANCELLED' &&
        t.status !== 'REVERSED' &&
        t.type === 'RETURN' &&
        toLocalDayKey(t.date || t.createdAt) === selectedReportDate
    );
  }, [customerTransactions, selectedReportDate]);

  const selectedDayTotal = useMemo(() => {
    return selectedDaySales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  }, [selectedDaySales]);

  const handleDownloadDailyPDF = () => {
    const dayPnl = calculateProfitAndLoss(selectedDaySales, [], productsMap, selectedDayReturnTxs);
    downloadDailySalesReportPDF(selectedDaySales, profile, selectedReportDate, {
      totalSales: dayPnl.totalRevenue,
      totalCOGS: Math.round(dayPnl.cogs),
      grossProfit: Math.round(dayPnl.grossProfit),
      grossMarginPct: dayPnl.grossMarginPct,
      costCoveragePct: dayPnl.costCoveragePct,
      uncostedRevenue: dayPnl.uncostedRevenue,
      hasCompleteCogs: dayPnl.hasCompleteCogs,
      reviewStatus: dayPnl.reviewStatus,
      isProfitVerified: dayPnl.isProfitVerified,
      knownCostGrossProfit:
        dayPnl.knownCostGrossProfit !== null ? Math.round(dayPnl.knownCostGrossProfit) : null,
      knownCostGrossMarginPct: dayPnl.knownCostGrossMarginPct,
    });
  };

  const handleDownloadCustomerPDF = () => {
    const cust = customers.find((c) => c.id === selectedReportCustId) || customers[0];
    if (!cust) return;
    const txs = customerTransactions.filter((t) => t.customerId === cust.id);
    downloadCustomerUdharStatementPDF(cust, txs, profile);
  };

  // CSV Generator Helper
  const downloadCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join(
        '\n'
      );
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportSalesCSV = () => {
    const headers = ['Bill No', 'Date', 'Customer Name', 'Payment Mode', 'Status', 'Items', 'Total Amount (INR)'];
    const rows = filteredSales.filter(isSaleActive).map((s) => [
      s.invoiceNo,
      s.date,
      s.customerName || 'Cash Walk-in',
      s.paymentMethod,
      s.status || 'ACTIVE',
      s.items ? s.items.map((i) => `${i.quantity}x ${i.productName}`).join('; ') : s.notes || '',
      s.amount,
    ]);
    downloadCSV(`kirana-sales-report-${getLocalTodayKey()}.csv`, headers, rows);
  };

  const handleExportCustomerUdharCSV = () => {
    const headers = ['Customer Name', 'Mobile', 'Address', 'Current Udhar Due (INR)', 'Overdue Days', 'Category', 'Notes'];
    const rows = customers.map((c) => [
      c.name,
      c.phone,
      c.address || '',
      c.currentBalance,
      c.overdueDays,
      c.category,
      c.notes || '',
    ]);
    downloadCSV(`kirana-customer-udhar-${getLocalTodayKey()}.csv`, headers, rows);
  };

  const handleExportCashbookCSV = () => {
    const headers = ['Date', 'Type (IN/OUT)', 'Category', 'Description', 'Status', 'Amount (INR)'];
    const rows = cashbookEntries.map((cb) => [
      cb.date,
      cb.type,
      cb.category,
      cb.description,
      cb.status || 'ACTIVE',
      cb.amount,
    ]);
    downloadCSV(`kirana-cashbook-rokad-${getLocalTodayKey()}.csv`, headers, rows);
  };

  const handlePrint = () => {
    window.print();
  };

  const reconciliationAlertCount =
    accountingReconciliation.countsBySeverity.critical +
    accountingReconciliation.countsBySeverity.warning;

  const filteredReconciliationFindings = useMemo(() => {
    if (reconciliationSeverityFilter === 'ALL') return accountingReconciliation.findings;
    return accountingReconciliation.findings.filter((f) => f.severity === reconciliationSeverityFilter);
  }, [accountingReconciliation.findings, reconciliationSeverityFilter]);

  return (
    <div className="space-y-4 pb-12">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide">
            Official Statements &amp; Business Reports (Khata Report &amp; Parchi)
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Reports, Reconciliation &amp; Exports
          </h2>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Generate printable PDF statements, Excel/CSV data sheets, and run live accounting reconciliation audits
          </div>
        </div>

        <button
          type="button"
          onClick={handlePrint}
          className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>Print Current Statement</span>
        </button>
      </div>

      {/* Report View Switcher */}
      <div
        role="tablist"
        aria-label="Report views"
        className="flex items-center gap-2 overflow-x-auto pb-1 print:hidden"
      >
        <button
          type="button"
          role="tab"
          aria-selected={reportsActiveTab === 'BUSINESS'}
          onClick={() => setReportsActiveTab('BUSINESS')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
            reportsActiveTab === 'BUSINESS'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>Business Statement &amp; Exports</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={reportsActiveTab === 'STOCK_MOVEMENT'}
          onClick={() => setReportsActiveTab('STOCK_MOVEMENT')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
            reportsActiveTab === 'STOCK_MOVEMENT'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          <span>Stock Movement Report ({stockAdjustments.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={reportsActiveTab === 'RECONCILIATION'}
          onClick={() => setReportsActiveTab('RECONCILIATION')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
            reportsActiveTab === 'RECONCILIATION'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Reconciliation Audit</span>
          {reconciliationAlertCount > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold tabular-nums ${
                reportsActiveTab === 'RECONCILIATION'
                  ? 'bg-white text-emerald-900'
                  : accountingReconciliation.hasCriticalIssues
                  ? 'bg-red-100 dark:bg-red-900/70 text-red-700 dark:text-red-300'
                  : 'bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-300'
              }`}
            >
              {reconciliationAlertCount}
            </span>
          )}
        </button>
      </div>

      {reportsActiveTab === 'RECONCILIATION' ? (
        <div className="space-y-4">
          {/* Status Banner */}
          <div
            className={`rounded-2xl p-4 sm:p-5 border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              accountingReconciliation.isFullyReconciled
                ? 'bg-emerald-50/70 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800'
                : accountingReconciliation.hasCriticalIssues
                ? 'bg-red-50/70 dark:bg-red-950/35 border-red-200 dark:border-red-900'
                : 'bg-amber-50/70 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-xl shrink-0 ${
                  accountingReconciliation.isFullyReconciled
                    ? 'bg-emerald-700 text-white'
                    : accountingReconciliation.hasCriticalIssues
                    ? 'bg-red-600 text-white'
                    : 'bg-amber-600 text-white'
                }`}
              >
                {accountingReconciliation.isFullyReconciled ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                  {accountingReconciliation.isFullyReconciled
                    ? 'All Ledgers & Cashbook Reconciled'
                    : `${reconciliationAlertCount} Accounting Audit Item(s) Detected (Read-Only)`}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Live non-destructive audit across Customer Khata, Supplier Payables, Counter Rokad, Stock Valuation, and COGS Coverage. Historical records are never modified.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-bold tabular-nums shrink-0">
              <span className="px-2.5 py-1 rounded-lg bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300">
                {accountingReconciliation.countsBySeverity.critical} Critical
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300">
                {accountingReconciliation.countsBySeverity.warning} Warnings
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {accountingReconciliation.countsBySeverity.info} Info
              </span>
            </div>
          </div>

          {/* 5 Audit Snapshot Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">Customer Ledgers</div>
              <div className="text-base font-extrabold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                {formatINR(accountingReconciliation.customerAudit.recalculatedReceivables)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                Drift: {accountingReconciliation.customerAudit.driftedCount} accounts · Δ {formatINR(accountingReconciliation.customerAudit.netDelta)}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">Supplier Ledgers</div>
              <div className="text-base font-extrabold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                {formatINR(accountingReconciliation.supplierAudit.recalculatedPayables)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                Drift: {accountingReconciliation.supplierAudit.driftedCount} suppliers · Δ {formatINR(accountingReconciliation.supplierAudit.netDelta)}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">Counter Cashbook</div>
              <div className="text-base font-extrabold text-emerald-800 dark:text-emerald-300 mt-1 tabular-nums">
                {formatINR(accountingReconciliation.cashbookAudit.closingCash)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {accountingReconciliation.cashbookAudit.activeEntries} active · {accountingReconciliation.cashbookAudit.cancelledEntries} voided
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">Stock Valuation</div>
              <div className="text-base font-extrabold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                {formatINR(accountingReconciliation.inventoryAudit.catalogCostValuation)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                Hist. Weighted: {formatINR(accountingReconciliation.inventoryAudit.historicalWeightedValuation)}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="flex items-center justify-between gap-1">
                <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">COGS Coverage</div>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                    (accountingReconciliation.profitAudit.reviewStatus || 'RECONCILED') === 'RECONCILED'
                      ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                      : 'bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {accountingReconciliation.profitAudit.reviewStatus || 'RECONCILED'}
                </span>
              </div>
              <div className="text-base font-extrabold text-amber-700 dark:text-amber-300 mt-1 tabular-nums">
                {accountingReconciliation.profitAudit.costCoveragePct}%
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                Uncosted Rev: {formatINR(accountingReconciliation.profitAudit.uncostedRevenue)}
                {(accountingReconciliation.profitAudit.missingHistoricalCostCount || 0) > 0 &&
                  ` · ${accountingReconciliation.profitAudit.missingHistoricalCostCount} legacy UNCOSTED`}
                {(accountingReconciliation.profitAudit.uncostedReturnsCount || 0) > 0 &&
                  ` · ${accountingReconciliation.profitAudit.uncostedReturnsCount} return(s) NEEDS_REVIEW`}
              </div>
            </div>
          </div>

          {/* Severity Filter + Findings List */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                Audit Findings ({filteredReconciliationFindings.length})
              </h4>
              <div className="flex items-center gap-1.5 text-[11px]">
                {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setReconciliationSeverityFilter(sev)}
                    className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                      reconciliationSeverityFilter === sev
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {filteredReconciliationFindings.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                No findings under the selected severity filter.
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredReconciliationFindings.map((f) => (
                  <div
                    key={f.id}
                    className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                      f.severity === 'CRITICAL'
                        ? 'bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-900'
                        : f.severity === 'WARNING'
                        ? 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                        : 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {f.severity === 'CRITICAL' ? (
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                      ) : f.severity === 'WARNING' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                          {f.title}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold">
                          <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                            {f.section}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded ${
                              f.severity === 'CRITICAL'
                                ? 'bg-red-100 dark:bg-red-900/70 text-red-800 dark:text-red-200'
                                : f.severity === 'WARNING'
                                ? 'bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200'
                                : 'bg-blue-100 dark:bg-blue-900/70 text-blue-800 dark:text-blue-200'
                            }`}
                          >
                            {f.severity}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{f.description}</p>
                      {(f.financialImpact !== undefined || f.affectedCount !== undefined) && (
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                          {f.affectedCount !== undefined && `Records affected: ${f.affectedCount}`}
                          {f.affectedCount !== undefined && f.financialImpact !== undefined && ' · '}
                          {f.financialImpact !== undefined && `Amount involved: ${formatINR(f.financialImpact)}`}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : reportsActiveTab === 'STOCK_MOVEMENT' ? (
        <div className="space-y-4">
          {/* Stock Movement Filters */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 print:hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PackageSearch className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                  Stock Movement Audit Trail
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadStockMovementCSV(
                      stockReport.entries,
                      effectiveStockDates.startDate && effectiveStockDates.endDate
                        ? `${effectiveStockDates.startDate}_to_${effectiveStockDates.endDate}`
                        : stockDatePreset.toLowerCase()
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Movement CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Report</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {(
                [
                  { id: 'ALL', label: 'All Time' },
                  { id: 'TODAY', label: 'Today' },
                  { id: 'LAST_7_DAYS', label: 'Last 7 Days' },
                  { id: 'LAST_30_DAYS', label: 'Last 30 Days' },
                  { id: 'THIS_MONTH', label: 'This Month' },
                  { id: 'CUSTOM', label: 'Custom Range' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setStockDatePreset(preset.id)}
                  className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap cursor-pointer transition-colors ${
                    stockDatePreset === preset.id
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Product Filter
                </label>
                <select
                  aria-label="Filter Stock Movements by Product"
                  value={stockReportProductFilter}
                  onChange={(e) => setStockReportProductFilter(e.target.value)}
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  <option value="ALL">All Products ({products.length})</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Adjustment Source
                </label>
                <select
                  aria-label="Filter Stock Movements by Source"
                  value={stockSourceFilter}
                  onChange={(e) =>
                    setStockSourceFilter(
                      e.target.value as
                        | 'ALL'
                        | 'MANUAL'
                        | 'SALE'
                        | 'PURCHASE'
                        | 'EDIT'
                        | 'SALES_RETURN'
                        | 'PURCHASE_RETURN'
                    )
                  }
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  <option value="ALL">All Sources</option>
                  <option value="MANUAL">Manual Adjustment</option>
                  <option value="SALE">Counter Sale</option>
                  <option value="PURCHASE">Supplier Purchase</option>
                  <option value="SALES_RETURN">Sales Return (+)</option>
                  <option value="PURCHASE_RETURN">Purchase Return (-)</option>
                  <option value="EDIT">Product Edit</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Movement Direction
                </label>
                <select
                  aria-label="Filter Stock Movements by Direction"
                  value={stockTypeFilter}
                  onChange={(e) =>
                    setStockTypeFilter(e.target.value as 'ALL' | 'ADD' | 'REDUCE')
                  }
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  <option value="ALL">All Movements (In &amp; Out)</option>
                  <option value="ADD">Stock Added (+)</option>
                  <option value="REDUCE">Stock Reduced (-)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Search Reason / Item
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Product or reason..."
                    value={stockSearch}
                    onChange={(e) => setStockSearch(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            {stockDatePreset === 'CUSTOM' && (
              <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-slate-600 dark:text-slate-400">From:</label>
                  <input
                    type="date"
                    aria-label="Stock Report Start Date"
                    value={stockStartDate}
                    onChange={(e) => setStockStartDate(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-slate-600 dark:text-slate-400">To:</label>
                  <input
                    type="date"
                    aria-label="Stock Report End Date"
                    value={stockEndDate}
                    onChange={(e) => setStockEndDate(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* KPI Summary Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Total Movements
              </div>
              <div className="text-xl font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                {stockReport.summary.totalCount}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {stockReport.summary.uniqueProductsCount} product(s) affected
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Total Stock Added
              </div>
              <div className="text-xl font-black text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
                +{stockReport.summary.totalAddedQty}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {stockReport.summary.addCount} inward entries
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Total Stock Reduced
              </div>
              <div className="text-xl font-black text-red-600 dark:text-rose-400 mt-1 tabular-nums">
                -{stockReport.summary.totalReducedQty}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {stockReport.summary.reduceCount} outward entries
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Net Qty Change
              </div>
              <div
                className={`text-xl font-black mt-1 tabular-nums ${
                  stockReport.summary.netQtyChange >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-rose-400'
                }`}
              >
                {stockReport.summary.netQtyChange > 0
                  ? `+${stockReport.summary.netQtyChange}`
                  : stockReport.summary.netQtyChange}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Units across selected filter
              </div>
            </div>
          </div>

          {/* Audit Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  Inventory Adjustment Audit Ledger
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {effectiveStockDates.startDate || effectiveStockDates.endDate
                    ? `Period: ${effectiveStockDates.startDate || 'Start'} to ${effectiveStockDates.endDate || 'Today'}`
                    : 'Showing all recorded stock movements'}
                </p>
              </div>
            </div>

            {stockReport.entries.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                No stock movements match the selected date range and filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold uppercase text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Product</th>
                      <th className="py-3 px-4">Source</th>
                      <th className="py-3 px-4">Movement</th>
                      <th className="py-3 px-4 text-right">Qty Change</th>
                      <th className="py-3 px-4 text-right">Prev Stock → New Stock</th>
                      <th className="py-3 px-4">Reason / Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                    {stockReport.entries.map((entry) => {
                      const isAdd = entry.type === 'ADD';
                      return (
                        <tr
                          key={entry.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                        >
                          <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-300">
                            {entry.date}
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">
                            {entry.productName}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-semibold">
                            {entry.source}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`font-bold text-[11px] ${
                                isAdd
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-rose-400'
                              }`}
                            >
                              {isAdd ? 'Inward (+)' : 'Outward (-)'}
                            </span>
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-extrabold whitespace-nowrap ${
                              isAdd
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-600 dark:text-rose-400'
                            }`}
                          >
                            {entry.quantityChange > 0
                              ? `+${entry.quantityChange}`
                              : entry.quantityChange}{' '}
                            {entry.unit}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {entry.previousStock} → <strong>{entry.newStock}</strong> {entry.unit}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-xs">
                            {entry.reason}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
      <PeriodFilterBar label="Statement Period" className="print:hidden" />

      {/* Quick Download Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
        {/* Complete JSON Backup Card */}
        <div className="p-4 bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-2xl border border-emerald-800 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                <Database className="w-4 h-4" />
                <span>Complete JSON Backup</span>
              </div>
              <span className="text-[10px] bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded-full font-bold">
                {getBackupSummary().totalTransactions} Records
              </span>
            </div>
            <p className="text-xs text-emerald-100/80 mt-1">
              Download all sales, customer udhar, supplier bills, expenses & cashbook entries in one local JSON file.
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportBackupJSON()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download JSON</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBackupModalOpen(true)}
              className="py-2 px-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold border border-white/20 transition-colors cursor-pointer"
              title="Open full backup details & preview"
            >
              Details
            </button>
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400 font-bold text-sm">
              <ShoppingCart className="w-4 h-4" />
              <span>Sales Register Excel</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Download itemized sales transactions with invoice numbers and payment methods.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportSalesCSV}
            className="mt-4 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-bold border border-emerald-200 dark:border-emerald-800 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download CSV (Excel)</span>
          </button>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-sm">
              <Users className="w-4 h-4" />
              <span>Customer Udhar Ledger CSV</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Complete list of all customer credit balances, phone numbers and overdue days.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCustomerUdharCSV}
            className="mt-4 flex items-center justify-center gap-1.5 py-2 px-3 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-xl text-xs font-bold border border-red-200 dark:border-red-900/60 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download Udhar Sheet</span>
          </button>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-bold text-sm">
              <Wallet className="w-4 h-4" />
              <span>Cashbook (Rokad) Sheet</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Export daily counter cash inflows, supplier payouts, expenses, and closing balance.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCashbookCSV}
            className="mt-4 flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-xl text-xs font-bold border border-blue-200 dark:border-blue-900/60 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download Rokad CSV</span>
          </button>
        </div>
      </div>

      {/* Official PDF Document Generation Section */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 print:hidden">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              <FileDown className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                Official PDF Statements & Reports (Official PDF Download)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generate clean, branded A4 documents with store letterhead, signatures, and UPI details
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
            A4 Print-Ready PDF
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Card 1: Daily Sales Report PDF */}
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-300 font-bold text-sm">
                  <Receipt className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>Daily Sales Summary PDF (Dainik Bikri Report)</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  {selectedDaySales.length} {selectedDaySales.length === 1 ? 'Sale' : 'Sales'}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                Generates certified daily counter billings, payment breakdown (Cash/UPI/Credit), and estimated wholesale gross profit.
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-emerald-100 dark:border-emerald-900/60">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Select Date:</label>
                <input
                  type="date"
                  value={selectedReportDate}
                  onChange={(e) => setSelectedReportDate(e.target.value)}
                  className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg p-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 bg-white/70 dark:bg-slate-800/70 p-2 rounded-lg border border-emerald-100 dark:border-emerald-900/60">
                <span>Total Recorded Sales:</span>
                <strong className="text-emerald-950 dark:text-emerald-300 font-bold text-sm">
                  {formatINR(selectedDayTotal)}
                </strong>
              </div>

              <button
                type="button"
                onClick={handleDownloadDailyPDF}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Daily Sales PDF Report</span>
              </button>
            </div>
          </div>

          {/* Card 2: Customer Udhar Statement PDF */}
          <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-blue-900 dark:text-blue-300 font-bold text-sm">
                  <Users className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                  <span>Customer Udhar Khata Statement (Grahak Parchi)</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white dark:bg-slate-800 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {customers.length} Customers
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                Download formal customer account statement showing opening balance, ration purchases, payments, and shop UPI QR code.
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-blue-100 dark:border-blue-900/60">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Choose Customer:</label>
                <select
                  value={selectedReportCustId}
                  onChange={(e) => setSelectedReportCustId(e.target.value)}
                  className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg p-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium flex-1 max-w-56 truncate"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.currentBalance > 0 ? `(Due: ${formatINR(c.currentBalance)})` : '(Paid)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 bg-white/70 dark:bg-slate-800/70 p-2 rounded-lg border border-blue-100 dark:border-blue-900/60">
                <span>Current Outstanding Due:</span>
                <strong className="text-red-700 dark:text-red-400 font-bold text-sm">
                  {formatINR(
                    customers.find((c) => c.id === selectedReportCustId)?.currentBalance || 0
                  )}
                </strong>
              </div>

              <button
                type="button"
                onClick={handleDownloadCustomerPDF}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 dark:bg-blue-700 hover:bg-slate-800 dark:hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Customer Statement PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Printable Report Canvas View */}
      <div className="bg-white dark:bg-slate-900 print:bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xs print:p-0 print:border-none print:text-slate-900">
        {/* Printable Letterhead */}
        <div className="border-b-2 border-slate-800 dark:border-slate-700 print:border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandLogo sizeClass="w-12 h-12" roundedClass="rounded-full" />
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 print:text-slate-900 uppercase tracking-tight">
                {profile.storeName || BRAND_NAME}
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 print:text-slate-600 mt-0.5">
                {profile.address} · Phone: {profile.phone}
              </p>
              {profile.gstin && (
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 print:text-slate-500">GSTIN: {profile.gstin}</p>
              )}
            </div>
          </div>
          <div className="sm:text-right text-xs text-slate-600 dark:text-slate-400 print:text-slate-600">
            <div className="font-bold text-slate-900 dark:text-slate-100 print:text-slate-900 text-sm">OFFICIAL BUSINESS STATEMENT</div>
            <div>Generated: {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <div>Period: {dateFilter.replace('_', ' ')}</div>
          </div>
        </div>

        {/* Statement Content */}
        <div className="py-6 space-y-6">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 print:text-slate-900 text-sm uppercase tracking-wider mb-2">
              1. Financial Statement Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 print:bg-slate-50 rounded-xl border border-slate-200 dark:border-slate-700 print:border-slate-200">
                <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">Net Sales (Bikri)</span>
                <span className="text-base font-bold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5 block tabular-nums">
                  {formatINR(periodPnl.totalRevenue)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5 tabular-nums">
                  Gross: {formatINR(periodPnl.grossRevenue)} · Returns: {formatINR(periodPnl.salesReturns)}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 print:bg-slate-50 rounded-xl border border-slate-200 dark:border-slate-700 print:border-slate-200">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">
                    {periodPnl.isProfitVerified ? 'Verified COGS & Net Profit' : 'Provisional COGS & Profit'}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      periodPnl.reviewStatus === 'RECONCILED'
                        ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                        : 'bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200'
                    }`}
                  >
                    {periodPnl.reviewStatus}
                  </span>
                </div>
                {periodPnl.isProfitVerified ? (
                  <span
                    className={`text-base font-bold mt-0.5 block tabular-nums ${
                      (periodPnl.verifiedNetOperatingProfit ?? 0) >= 0
                        ? 'text-emerald-700 dark:text-emerald-400 print:text-emerald-700'
                        : 'text-red-600 dark:text-red-400 print:text-red-600'
                    }`}
                  >
                    {formatINR(periodPnl.verifiedNetOperatingProfit ?? 0)}
                  </span>
                ) : periodPnl.profitStatus === 'UNCOSTED' || periodPnl.knownCostGrossProfit === null ? (
                  <span className="text-sm font-bold mt-0.5 block text-amber-800 dark:text-amber-300 print:text-amber-800">
                    Profit Unverified ({periodPnl.costCoveragePct}% costed)
                  </span>
                ) : (
                  <span className="text-sm font-bold mt-0.5 block tabular-nums text-amber-800 dark:text-amber-300 print:text-amber-800">
                    {formatINR(periodPnl.knownCostGrossProfit)} Known-Cost Gross
                  </span>
                )}
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5 tabular-nums">
                  COGS: {formatINR(periodPnl.cogs)} ({periodPnl.costCoveragePct}% costed)
                  {periodPnl.uncostedRevenue > 0 && ` · Uncosted: ${formatINR(periodPnl.uncostedRevenue)}`}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 print:bg-slate-50 rounded-xl border border-slate-200 dark:border-slate-700 print:border-slate-200">
                <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">Operating Expenses</span>
                <span className="text-base font-bold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5 block tabular-nums">
                  {formatINR(periodPnl.operatingExpenses)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5 tabular-nums">
                  Drawings (Excl.): {formatINR(periodPnl.personalDrawings)}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 print:bg-slate-50 rounded-xl border border-slate-200 dark:border-slate-700 print:border-slate-200">
                <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">Net Purchases &amp; Stock Value</span>
                <span className="text-base font-bold text-slate-900 dark:text-slate-100 print:text-slate-900 mt-0.5 block tabular-nums">
                  {formatINR(netPeriodPurchases.net)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5 tabular-nums">
                  Closing Stock Cost: {formatINR(inventoryVal.totalCostValue)}
                </span>
              </div>

              <div className="p-3 bg-emerald-50/40 dark:bg-emerald-950/30 print:bg-slate-50 rounded-xl border border-emerald-200 dark:border-emerald-800 print:border-slate-200">
                <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">Counter Cash Drawer</span>
                <span className="text-base font-bold text-emerald-900 dark:text-emerald-200 print:text-slate-900 mt-0.5 block tabular-nums">
                  {formatINR(periodCashSummary.closingCash)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5 tabular-nums">
                  Open: {formatINR(periodCashSummary.openingCash)} · In: +{formatINR(periodCashSummary.totalInflows)} · Out: -{formatINR(periodCashSummary.totalOutflows)}
                </span>
              </div>

              <div className="p-3 bg-blue-50/40 dark:bg-blue-950/30 print:bg-slate-50 rounded-xl border border-blue-200 dark:border-blue-800 print:border-slate-200">
                <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">Non-Cash Bank / UPI Flow</span>
                <span className="text-base font-bold text-blue-800 dark:text-blue-300 print:text-slate-900 mt-0.5 block tabular-nums">
                  {formatINR(periodBankUpiSummary.netBankUpiFlow)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5 tabular-nums">
                  Inflows: {formatINR(periodBankUpiSummary.totalBankUpiInflows)} · Outflows: {formatINR(periodBankUpiSummary.totalBankUpiOutflows)}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 print:bg-slate-50 rounded-xl border border-slate-200 dark:border-slate-700 print:border-slate-200">
                <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">Customer Udhar Dues</span>
                <span className="text-base font-bold text-red-600 dark:text-red-400 print:text-red-600 mt-0.5 block tabular-nums">
                  {formatINR(customers.reduce((s, c) => s + Math.max(0, c.currentBalance), 0))}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5">
                  Total receivable
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 print:bg-slate-50 rounded-xl border border-slate-200 dark:border-slate-700 print:border-slate-200">
                <span className="text-slate-500 dark:text-slate-400 print:text-slate-500 block">Supplier Payables</span>
                <span className="text-base font-bold text-amber-700 dark:text-amber-400 print:text-amber-700 mt-0.5 block tabular-nums">
                  {formatINR(suppliers.reduce((s, sup) => s + Math.max(0, sup.currentBalance), 0))}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 print:text-slate-500 block mt-0.5">
                  Total payable
                </span>
              </div>
            </div>
            {!periodPnl.isProfitVerified && (periodPnl.grossRevenue > 0 || periodPnl.salesReturns > 0) && (
              <div className="mt-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200">
                <strong>Provisional P&amp;L Notice ({periodPnl.reviewStatus}):</strong>{' '}
                Cost coverage is {periodPnl.costCoveragePct}% with {formatINR(periodPnl.uncostedRevenue)} in uncosted sales revenue.
                {periodPnl.knownCostGrossMarginPct !== null
                  ? ` Known-cost margin on costed items only: ${periodPnl.knownCostGrossMarginPct}%.`
                  : ' Gross margin and net profit cannot be verified when historical purchase costs are missing.'}
              </div>
            )}
          </div>

          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 print:text-slate-900 text-sm uppercase tracking-wider mb-2">
              2. Outstanding Customer Accounts (Udhar Bahi)
            </h3>
            <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-700 print:border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-100 dark:bg-slate-800 print:bg-slate-100 font-semibold text-slate-700 dark:text-slate-200 print:text-slate-700">
                <tr>
                  <th className="p-2 border-b border-slate-200 dark:border-slate-700 print:border-slate-200">Customer Name</th>
                  <th className="p-2 border-b border-slate-200 dark:border-slate-700 print:border-slate-200">Phone</th>
                  <th className="p-2 border-b border-slate-200 dark:border-slate-700 print:border-slate-200">Category</th>
                  <th className="p-2 border-b border-slate-200 dark:border-slate-700 print:border-slate-200 text-right">Outstanding (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-slate-100">
                {customers
                  .filter((c) => c.currentBalance > 0)
                  .map((c) => (
                    <tr key={c.id}>
                      <td className="p-2 font-medium text-slate-900 dark:text-slate-100 print:text-slate-900">{c.name}</td>
                      <td className="p-2 text-slate-600 dark:text-slate-400 print:text-slate-600">{c.phone}</td>
                      <td className="p-2 text-slate-600 dark:text-slate-400 print:text-slate-600">{c.category} ({c.overdueDays}d)</td>
                      <td className="p-2 text-right font-bold text-red-600 dark:text-red-400 print:text-red-600">
                        {formatINR(c.currentBalance)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Signature Footer */}
        <div className="pt-12 flex justify-between items-end text-xs text-slate-600 dark:text-slate-400 print:text-slate-600 border-t border-slate-200 dark:border-slate-800 print:border-slate-200 mt-8">
          <div>
            <p>Certified accurate as per daily counter records & ledger.</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 print:text-slate-400 mt-0.5">Powered by Arjun Groceries Digital System</p>
          </div>
          <div className="text-right">
            <div className="w-40 border-b border-slate-400 dark:border-slate-600 print:border-slate-400 pb-1 mb-1 font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 text-center">
              {profile.ownerName || 'Store Owner'}
            </div>
            <span>Authorized Signature / Stamp</span>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
};
