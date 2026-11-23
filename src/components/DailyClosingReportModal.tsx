import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import {
  calculateDailyClosingReport,
  formatINR,
  getLocalTodayKey,
  isSaleActive,
  toLocalDayKey,
} from '../utils/accounting';
import {
  X,
  MoonStar,
  Printer,
  Copy,
  Check,
  CheckCircle2,
  Calendar,
  Wallet,
  ShoppingCart,
  Receipt,
  AlertTriangle,
  Boxes,
  ArrowRight,
} from 'lucide-react';

export const DailyClosingReportModal: React.FC = () => {
  const {
    isDailyClosingOpen,
    setIsDailyClosingOpen,
    lastClosedDate,
    markDayClosed,
    profile,
    sales,
    customerTransactions,
    expenses,
    supplierTransactions,
    cashbookEntries,
    products,
    setActiveTab,
  } = useStore();

  const todayKey = getLocalTodayKey();
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [closingNote, setClosingNote] = useState('');
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => {
    return calculateDailyClosingReport({
      dateKey: selectedDate,
      sales,
      customerTransactions,
      expenses,
      supplierTransactions,
      cashbookEntries,
      products,
    });
  }, [
    selectedDate,
    sales,
    customerTransactions,
    expenses,
    supplierTransactions,
    cashbookEntries,
    products,
  ]);

  const latestActiveSaleDate = useMemo(() => {
    const activeSales = sales.filter(isSaleActive);
    if (activeSales.length === 0) return null;
    const sorted = [...activeSales].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return sorted[0]?.date ? toLocalDayKey(sorted[0].date) || null : null;
  }, [sales]);

  if (!isDailyClosingOpen) return null;

  const isAlreadyClosedForDate = lastClosedDate === selectedDate;

  const buildPlainTextSummary = () => {
    return [
      `*${profile.storeName} - Daily Closing Report*`,
      `Date: ${selectedDate}`,
      `-----------------------------`,
      `Total Sales (${report.billsCount} bills): ${formatINR(report.totalSales)}`,
      `• Cash Sales: ${formatINR(report.cashSales)}`,
      `• UPI / Bank Sales: ${formatINR(report.upiSales)}`,
      `• Credit (Udhar) Sales: ${formatINR(report.creditSales)}`,
      `• Udhar Jama Collected: ${formatINR(report.udharCollections)}`,
      `-----------------------------`,
      `Operating Expenses: ${formatINR(report.operatingExpenses)}`,
      `Personal Drawings: ${formatINR(report.personalDrawings)}`,
      `Supplier Payments: ${formatINR(report.supplierPayments)}`,
      `-----------------------------`,
      `Today's Cash Movement: ${report.netCashMovementToday >= 0 ? '+' : ''}${formatINR(report.netCashMovementToday)}`,
      `Expected Cash in Drawer (Galla): ${formatINR(report.expectedCashInDrawer)}`,
      `Low Stock Items: ${report.lowStockCount} | Nearing Limit: ${report.approachingReorderCount}`,
      closingNote.trim() ? `Note: ${closingNote.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainTextSummary());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleConfirmDayClosing = () => {
    markDayClosed(selectedDate, closingNote.trim() || undefined);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full my-auto flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-emerald-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-800 rounded-xl text-emerald-300">
              <MoonStar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base sm:text-lg leading-tight">
                  Daily Closing Report (Dukan Band Hisab)
                </h3>
                {isAlreadyClosedForDate && (
                  <span className="text-[10px] font-bold bg-emerald-500 text-emerald-950 px-2 py-0.5 rounded-full">
                    Day Closed
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-300/85">
                {profile.storeName} · End-of-day sales, collections, expenses &amp; cash drawer summary
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsDailyClosingOpen(false)}
            className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-900 transition-colors cursor-pointer"
            aria-label="Close Daily Closing Report"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Date Selector Toolbar */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <Calendar className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">Closing Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || todayKey)}
              className="border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          {report.billsCount === 0 &&
            latestActiveSaleDate &&
            latestActiveSaleDate !== selectedDate && (
              <button
                type="button"
                onClick={() => setSelectedDate(latestActiveSaleDate)}
                className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-lg hover:bg-emerald-100 cursor-pointer"
              >
                Jump to Latest Active Day ({latestActiveSaleDate})
              </button>
            )}
        </div>

        {/* Report Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Top 4 KPI Tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
              <div className="text-[11px] font-bold uppercase text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Total Sales</span>
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-emerald-950 dark:text-emerald-100 mt-1 tabular-nums">
                {formatINR(report.totalSales)}
              </div>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                {report.billsCount} {report.billsCount === 1 ? 'Bill' : 'Bills'} generated
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
              <div className="text-[11px] font-bold uppercase text-blue-800 dark:text-blue-300">
                Total Collections
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-blue-950 dark:text-blue-100 mt-1 tabular-nums">
                {formatINR(report.totalCollections)}
              </div>
              <div className="text-[11px] text-blue-700 dark:text-blue-400 mt-0.5">
                Cash + UPI + Udhar Jama
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-red-50/70 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
              <div className="text-[11px] font-bold uppercase text-red-700 dark:text-red-300 flex items-center gap-1">
                <Receipt className="w-3.5 h-3.5" />
                <span>Day Expenses</span>
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-red-800 dark:text-red-200 mt-1 tabular-nums">
                {formatINR(report.operatingExpenses)}
              </div>
              <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 tabular-nums">
                Drawings: {formatINR(report.personalDrawings)}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-emerald-900/60 border border-slate-800 dark:border-emerald-700 text-white">
              <div className="text-[11px] font-bold uppercase text-emerald-300 flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5" />
                <span>Cash Drawer (Galla)</span>
              </div>
              <div className="text-lg sm:text-xl font-black text-white mt-1 tabular-nums">
                {formatINR(report.expectedCashInDrawer)}
              </div>
              <div className="text-[11px] text-emerald-300/90 mt-0.5 tabular-nums">
                Today: {report.netCashMovementToday >= 0 ? '+' : ''}
                {formatINR(report.netCashMovementToday)}
              </div>
            </div>
          </div>

          {/* Breakdown Two Columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Sales & Collections Breakdown */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5 text-xs">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide text-[11px] border-b border-slate-200 dark:border-slate-700 pb-1.5">
                Sales &amp; Collection Breakdown
              </h4>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Cash Sales (Nagad Bikri)</span>
                <strong className="text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatINR(report.cashSales)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">UPI / Bank Sales</span>
                <strong className="text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatINR(report.upiSales)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Credit Sales (Udhar Diya)</span>
                <strong className="text-amber-700 dark:text-amber-400 tabular-nums">
                  {formatINR(report.creditSales)}
                </strong>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200 dark:border-slate-700">
                <span className="text-slate-600 dark:text-slate-400">
                  Old Khata Collections (Udhar Jama)
                </span>
                <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">
                  + {formatINR(report.udharCollections)}
                </strong>
              </div>
            </div>

            {/* Outflows & Cash Drawer Breakdown */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5 text-xs">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide text-[11px] border-b border-slate-200 dark:border-slate-700 pb-1.5">
                Outflows &amp; Galla Cash Movement
              </h4>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Cash Inflows Today</span>
                <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">
                  + {formatINR(report.cashInflowsToday)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Cash Outflows Today</span>
                <strong className="text-red-600 dark:text-red-400 tabular-nums">
                  - {formatINR(report.cashOutflowsToday)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Supplier Payments</span>
                <strong className="text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatINR(report.supplierPayments)}
                </strong>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200 dark:border-slate-700">
                <span className="text-slate-700 dark:text-slate-300 font-semibold">
                  Net Day Operating Margin
                </span>
                <strong
                  className={`tabular-nums ${
                    report.netOperatingPosition >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatINR(report.netOperatingPosition)}
                </strong>
              </div>
            </div>
          </div>

          {/* Stock Health Alert Strip */}
          {(report.lowStockCount > 0 || report.approachingReorderCount > 0) && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2.5 text-amber-900 dark:text-amber-200">
                <Boxes className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                <span>
                  Stock Check Before Closing:{' '}
                  <strong>{report.lowStockCount}</strong> below limit,{' '}
                  <strong>{report.approachingReorderCount}</strong> approaching reorder limit.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsDailyClosingOpen(false);
                  setActiveTab('INVENTORY');
                }}
                className="inline-flex items-center gap-1 font-bold text-amber-900 dark:text-amber-200 hover:underline shrink-0 cursor-pointer"
              >
                <span>Review Stock</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Optional Owner Verification Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Counter Closing Verification Note (Optional)
            </label>
            <input
              type="text"
              value={closingNote}
              onChange={(e) => setClosingNote(e.target.value)}
              placeholder="e.g. Galla physical cash matched, shutter locked by owner"
              className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Summary</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Slip</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDailyClosingOpen(false)}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleConfirmDayClosing}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isAlreadyClosedForDate ? 'Day Already Closed' : 'Confirm End Day Closing'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
