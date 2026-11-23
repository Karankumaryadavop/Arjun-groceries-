import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { calculateTodaySalesSnapshot, formatINR, isSaleActive } from '../utils/accounting';
import { downloadSaleInvoicePDF } from '../utils/pdfGenerator';
import { BillAttachment, LedgerDateRange, SaleRecord } from '../types';
import {
  filterSalesMultiCriteria,
  getSalePaymentStatus,
  SalePaymentStatusFilter,
  SaleTransactionTypeFilter,
} from '../utils/multiFilter';
import { BillViewerModal } from './BillViewerModal';
import { WhatsAppReceiptModal } from './WhatsAppReceiptModal';
import { ThermalReceiptPreview, triggerCustomThermalPrint } from './ThermalReceiptPreview';
import { buildThermalReceiptFromSale } from '../utils/thermalPrint';
import { calculateInvoiceOutstanding } from '../utils/whatsappReminders';
import {
  buildSaleBillCustomerSummary,
  buildSaleBillFinancialSummary,
  resolveSaleBillStatus,
} from '../utils/saleBillViewModel';
import {
  SaleBillCard,
  SaleBillHeaderBar,
  SaleBillSubHeader,
} from './SaleBillCard';
import { getDateFilterLabel } from './PeriodFilterBar';
import {
  Search,
  Plus,
  Printer,
  Download,
  Banknote,
  QrCode,
  Users,
  Paperclip,
  Eye,
  MessageCircle,
  TrendingUp,
  Clock,
  Filter,
  X,
  RotateCcw,
  Ban,
} from 'lucide-react';

export const SalesView: React.FC = () => {
  const {
    sales,
    filteredSales,
    customerTransactions,
    setIsQuickSaleOpen,
    cancelSale,
    profile,
    customers,
    dateFilter,
    customDateRange,
    openThermalPrintSettings,
  } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<LedgerDateRange>('ALL');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [transactionType, setTransactionType] = useState<SaleTransactionTypeFilter>('ALL');
  const [paymentStatus, setPaymentStatus] = useState<SalePaymentStatusFilter>('ALL');
  const [selectedSaleForPrint, setSelectedSaleForPrint] = useState<SaleRecord | null>(null);
  const [showThermalInModal, setShowThermalInModal] = useState(false);
  const [saleForWhatsApp, setSaleForWhatsApp] = useState<SaleRecord | null>(null);
  const [saleToCancel, setSaleToCancel] = useState<SaleRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [viewingAttachment, setViewingAttachment] = useState<{
    attachment: BillAttachment;
    title: string;
    details?: string;
  } | null>(null);

  const todaySnapshot = useMemo(
    () => calculateTodaySalesSnapshot(sales, customerTransactions, customers),
    [sales, customerTransactions, customers]
  );

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    dateRange !== 'ALL' ||
    transactionType !== 'ALL' ||
    paymentStatus !== 'ALL';

  const resetFilters = () => {
    setSearchQuery('');
    setDateRange('ALL');
    setCustomStartDate('');
    setCustomEndDate('');
    setTransactionType('ALL');
    setPaymentStatus('ALL');
  };

  const displaySales = useMemo(
    () =>
      filterSalesMultiCriteria(sales, customers, customerTransactions, {
        searchQuery,
        dateRange,
        customStartDate: customStartDate || undefined,
        customEndDate: customEndDate || undefined,
        transactionType,
        paymentStatus,
      }),
    [
      sales,
      customers,
      customerTransactions,
      searchQuery,
      dateRange,
      customStartDate,
      customEndDate,
      transactionType,
      paymentStatus,
    ]
  );

  const activeFilteredSales = useMemo(() => filteredSales.filter(isSaleActive), [filteredSales]);
  const activeDisplaySales = useMemo(() => displaySales.filter(isSaleActive), [displaySales]);

  const totalSalesAmount = activeFilteredSales.reduce((sum, s) => sum + s.amount, 0);
  const displayTotalAmount = activeDisplaySales.reduce((sum, s) => sum + s.amount, 0);
  const cashSalesAmount = activeDisplaySales
    .filter((s) => s.paymentMethod === 'CASH')
    .reduce((sum, s) => sum + s.amount, 0);
  const upiSalesAmount = activeDisplaySales
    .filter((s) => s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK')
    .reduce((sum, s) => sum + s.amount, 0);
  const creditSalesAmount = activeDisplaySales
    .filter((s) => s.paymentMethod === 'CREDIT' || s.isCredit)
    .reduce((sum, s) => sum + s.amount, 0);

  const handleConfirmCancelSale = (e: React.FormEvent) => {
    e.preventDefault();
    if (!saleToCancel) return;
    const trimmed = cancelReason.trim();
    if (trimmed.length < 3) {
      setCancelError('Please enter a clear cancellation reason (minimum 3 characters).');
      return;
    }
    const ok = cancelSale(saleToCancel.id, trimmed);
    if (!ok) {
      setCancelError('Unable to cancel this bill. It may already be cancelled.');
      return;
    }
    setSaleToCancel(null);
    setCancelReason('');
    setCancelError(null);
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Daily Performance Snapshot Summary Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-emerald-200 dark:border-emerald-900/70 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="text-xs uppercase font-bold text-emerald-800 dark:text-emerald-300 tracking-wide">
              Today&apos;s Daily Performance Snapshot (Aaj Ka Hisab)
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {new Date().toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}{' '}
              · {todaySnapshot.todayBillsCount} bills recorded today
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsQuickSaleOpen(true)}
            className="press-scale flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-sm cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>+ New Counter Sale (Naya Bill)</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300 uppercase">Total Sales Today</div>
              <div className="text-2xl font-extrabold text-emerald-950 dark:text-emerald-100 mt-0.5 tabular-nums">
                {formatINR(todaySnapshot.totalSalesToday)}
              </div>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                {todaySnapshot.todayBillsCount} {todaySnapshot.todayBillsCount === 1 ? 'bill' : 'bills'} · {getDateFilterLabel(dateFilter, customDateRange)}: {formatINR(totalSalesAmount)}
              </div>
            </div>
            <div className="p-2.5 bg-emerald-700 text-white rounded-xl shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Cash Received</div>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                {formatINR(todaySnapshot.cashReceivedToday)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                Cash {formatINR(todaySnapshot.cashSalesToday)} · UPI {formatINR(todaySnapshot.upiSalesToday)}
                {todaySnapshot.udharCollectionsToday > 0 && ` · Jama ${formatINR(todaySnapshot.udharCollectionsToday)}`}
              </div>
            </div>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-800 shrink-0">
              <Banknote className="w-5 h-5" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-red-50/50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-red-800 dark:text-red-300 uppercase">Pending Udhar</div>
              <div className="text-2xl font-extrabold text-red-700 dark:text-red-400 mt-0.5 tabular-nums">
                {formatINR(todaySnapshot.pendingUdharToday)}
              </div>
              <div className="text-[11px] text-red-700 dark:text-red-400 mt-0.5 tabular-nums">
                Today&apos;s credit · Total Khata Due: {formatINR(todaySnapshot.totalPendingUdharOverall)}
              </div>
            </div>
            <div className="p-2.5 bg-red-100 dark:bg-red-900/70 text-red-700 dark:text-red-300 rounded-xl shrink-0">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Filtered Cash vs UPI vs Credit breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/70 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Cash Sales {hasActiveFilters ? '(Filtered)' : '(All Bills)'}
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">{formatINR(cashSalesAmount)}</div>
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
              {displayTotalAmount > 0 ? Math.round((cashSalesAmount / displayTotalAmount) * 100) : 0}% of matching sales
            </div>
          </div>
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded-xl">
            <Banknote className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/70 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              UPI / QR Sales {hasActiveFilters ? '(Filtered)' : '(All Bills)'}
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">{formatINR(upiSalesAmount)}</div>
            <div className="text-[10px] text-blue-700 dark:text-blue-400 mt-0.5 tabular-nums">
              {displayTotalAmount > 0 ? Math.round((upiSalesAmount / displayTotalAmount) * 100) : 0}% of matching sales
            </div>
          </div>
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 rounded-xl">
            <QrCode className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-red-200 dark:border-red-900/70 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Credit Sales {hasActiveFilters ? '(Filtered)' : '(All Bills)'}
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">{formatINR(creditSalesAmount)}</div>
            <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 tabular-nums">
              {displayTotalAmount > 0 ? Math.round((creditSalesAmount / displayTotalAmount) * 100) : 0}% of matching sales
            </div>
          </div>
          <div className="p-2.5 bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 rounded-xl">
            <Users className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Multi-Filter Search Bar & Sales Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
              <Filter className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              <span>Multi-Filter Sales Search</span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                ({displaySales.length} of {sales.length} bills · {formatINR(displayTotalAmount)})
              </span>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="press-scale inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Clear Filters</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
            {/* 1. Text Search */}
            <div className="relative lg:col-span-5">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                aria-label="Search sales bills"
                placeholder="Search Bill #, customer, item, or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs sm:text-sm pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search query"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 2. Date Range */}
            <div className="lg:col-span-3">
              <select
                aria-label="Sales Date Range"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as LedgerDateRange)}
                className="w-full text-xs sm:text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold focus:outline-emerald-600 cursor-pointer"
              >
                <option value="ALL">Date: All Time</option>
                <option value="TODAY">Date: Today</option>
                <option value="YESTERDAY">Date: Yesterday</option>
                <option value="LAST_7_DAYS">Date: Last 7 Days</option>
                <option value="LAST_30_DAYS">Date: Last 30 Days</option>
                <option value="THIS_MONTH">Date: This Month</option>
                <option value="LAST_MONTH">Date: Last Month</option>
                <option value="CUSTOM">Date: Custom Range</option>
              </select>
            </div>

            {/* 3. Transaction Type */}
            <div className="lg:col-span-2">
              <select
                aria-label="Sales Transaction Type"
                value={transactionType}
                onChange={(e) => setTransactionType(e.target.value as SaleTransactionTypeFilter)}
                className="w-full text-xs sm:text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold focus:outline-emerald-600 cursor-pointer"
              >
                <option value="ALL">Type: All Modes</option>
                <option value="CASH">Type: Cash</option>
                <option value="UPI">Type: UPI / QR</option>
                <option value="BANK">Type: Bank</option>
                <option value="CREDIT">Type: Credit (Udhar)</option>
              </select>
            </div>

            {/* 4. Payment Status */}
            <div className="lg:col-span-2">
              <select
                aria-label="Sales Payment Status"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as SalePaymentStatusFilter)}
                className="w-full text-xs sm:text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold focus:outline-emerald-600 cursor-pointer"
              >
                <option value="ALL">Status: All</option>
                <option value="PAID">Status: Paid</option>
                <option value="PARTIAL">Status: Partial</option>
                <option value="UNPAID">Status: Unpaid Due</option>
              </select>
            </div>
          </div>

          {dateRange === 'CUSTOM' && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-semibold">From:</span>
              <input
                type="date"
                aria-label="Custom start date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-xs"
              />
              <span className="text-slate-500 dark:text-slate-400 font-semibold">To:</span>
              <input
                type="date"
                aria-label="Custom end date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-xs"
              />
            </div>
          )}
        </div>

        {/* Sales Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold uppercase text-[11px]">
              <tr>
                <th className="py-3 px-4">Bill No</th>
                <th className="py-3 px-4">Date &amp; Time</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Mode &amp; Status</th>
                <th className="py-3 px-4">Items / Details</th>
                <th className="py-3 px-4 text-right">Amount (₹)</th>
                <th className="py-3 px-4 text-center">Actions &amp; Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {displaySales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    {hasActiveFilters
                      ? 'No sales bills match all selected filters. Try adjusting or clearing filters.'
                      : "No sales recorded yet. Click '+ New Counter Sale' to record one!"}
                  </td>
                </tr>
              ) : (
                displaySales.map((s) => {
                  const isCancelled = !isSaleActive(s);
                  const status = getSalePaymentStatus(s, customers, customerTransactions, sales);
                  return (
                  <tr
                    key={s.id}
                    className={`transition-colors ${
                      isCancelled
                        ? 'opacity-60 bg-slate-50/70 dark:bg-slate-800/30'
                        : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            setShowThermalInModal(false);
                            setSelectedSaleForPrint(s);
                          }}
                          className={`hover:underline text-left cursor-pointer ${
                            isCancelled
                              ? 'line-through text-slate-500'
                              : 'text-emerald-900 dark:text-emerald-300'
                          }`}
                          title="Open Sale Bill"
                        >
                          #{s.invoiceNo}
                        </button>
                        {isCancelled && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 font-sans">
                            Cancelled
                          </span>
                        )}
                      </div>
                      {s.attachments && s.attachments.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setViewingAttachment({
                              attachment: s.attachments![0],
                              title: `Sale Bill #${s.invoiceNo}`,
                              details: `Customer: ${s.customerName || 'Walk-in'} · Amount: ${formatINR(s.amount)}`,
                            })
                          }
                          className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                        >
                          <Paperclip className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
                          <span>{s.attachments.length} {s.attachments.length === 1 ? 'Bill' : 'Bills'}</span>
                          <Eye className="w-3 h-3 text-emerald-600 dark:text-emerald-400 ml-0.5" />
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                      {new Date(s.date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                      {s.customerName ? (
                        <span className="text-emerald-950 dark:text-emerald-200 font-semibold">{s.customerName}</span>
                      ) : (
                        <span className="text-slate-400 italic">Walk-in Cash Customer</span>
                      )}
                      {isCancelled && s.cancelReason && (
                        <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 font-normal">
                          Reason: {s.cancelReason}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${
                            s.paymentMethod === 'CASH'
                              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                              : s.paymentMethod === 'UPI'
                              ? 'bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300'
                              : s.paymentMethod === 'BANK'
                              ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300'
                              : 'bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300'
                          }`}
                        >
                          {s.paymentMethod}
                        </span>
                        {!isCancelled && (
                          <span
                            className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              status === 'PAID'
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                : status === 'PARTIAL'
                                ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                            }`}
                          >
                            {status === 'PAID' ? 'Paid' : status === 'PARTIAL' ? 'Partial' : 'Unpaid'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {s.items && s.items.length > 0 ? (
                        <span className="truncate max-w-[200px] block">
                          {s.items.map((it) => `${it.quantity}x ${it.productName}`).join(', ')}
                        </span>
                      ) : (
                        <span>{s.notes || 'Counter grocery ration'}</span>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right font-extrabold tabular-nums ${isCancelled ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'}`}>
                      {formatINR(s.amount)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => setSaleForWhatsApp(s)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold transition-colors cursor-pointer"
                            title="Share Receipt on WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                            <span className="hidden xl:inline">WhatsApp</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const cust = customers.find((c) => c.id === s.customerId);
                            downloadSaleInvoicePDF(s, profile, cust);
                          }}
                          className="p-1.5 rounded-lg text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 transition-colors cursor-pointer"
                          title="Download Formatted PDF Invoice"
                        >
                          <Download className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowThermalInModal(false);
                            setSelectedSaleForPrint(s);
                          }}
                          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-emerald-800 dark:hover:text-emerald-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="View & Print Sale Bill"
                          aria-label={`View Sale Bill ${s.invoiceNo}`}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => {
                              setSaleToCancel(s);
                              setCancelReason('');
                              setCancelError(null);
                            }}
                            className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors cursor-pointer"
                            title="Cancel / Reverse Bill (Restore Stock & Ledger)"
                            aria-label={`Cancel Bill ${s.invoiceNo}`}
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Redesigned Sale Bill View & Print Modal */}
      {selectedSaleForPrint &&
        (() => {
          const billCustomer =
            customers.find((c) => c.id === selectedSaleForPrint.customerId) || null;
          const paymentStatusForBill = getSalePaymentStatus(
            selectedSaleForPrint,
            customers,
            customerTransactions,
            sales
          );
          const outstandingCalc =
            billCustomer &&
            (selectedSaleForPrint.isCredit || selectedSaleForPrint.paymentMethod === 'CREDIT')
              ? calculateInvoiceOutstanding(
                  selectedSaleForPrint,
                  billCustomer,
                  customerTransactions,
                  sales.filter((item) => item.customerId === billCustomer.id)
                )
              : null;

          const billFinancials = buildSaleBillFinancialSummary({
            items: selectedSaleForPrint.items || [],
            grossAmount: selectedSaleForPrint.grossAmount ?? selectedSaleForPrint.amount,
            netTotal: selectedSaleForPrint.amount,
            loyaltyDiscount: selectedSaleForPrint.loyaltyDiscountAmount || 0,
            paymentMethod: selectedSaleForPrint.paymentMethod,
            isCredit: selectedSaleForPrint.isCredit,
            isCancelled: !isSaleActive(selectedSaleForPrint),
            existingOutstandingForSale: outstandingCalc?.outstandingAmount,
          });

          const billCustomerSummary = buildSaleBillCustomerSummary({
            customer: billCustomer,
            billAmount: selectedSaleForPrint.amount,
            paymentMethod: selectedSaleForPrint.paymentMethod,
            isCredit: selectedSaleForPrint.isCredit,
            isFinalized: true,
            isCancelled: !isSaleActive(selectedSaleForPrint),
            invoiceNo: selectedSaleForPrint.invoiceNo,
            customerTransactions,
          });

          const billStatusMeta = resolveSaleBillStatus({
            isFinalized: true,
            sale: selectedSaleForPrint,
            paymentStatus: paymentStatusForBill,
          });

          const receiptPayload = buildThermalReceiptFromSale(
            selectedSaleForPrint,
            billCustomer?.currentBalance
          );

          const handlePrintThisBill = () => {
            void triggerCustomThermalPrint({
              profile,
              receipt: receiptPayload,
            });
          };

          const handleDownloadThisPdf = () => {
            downloadSaleInvoicePDF(selectedSaleForPrint, profile, billCustomer || undefined);
          };

          const handleWhatsAppThisBill = () => {
            const target = selectedSaleForPrint;
            setSelectedSaleForPrint(null);
            setShowThermalInModal(false);
            setSaleForWhatsApp(target);
          };

          return (
            <div
              className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center sm:p-4 overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-label={`Sale Bill #${selectedSaleForPrint.invoiceNo}`}
              data-testid="saved-sale-bill-modal"
            >
              <div
                className={`w-full h-full sm:h-auto sm:max-h-[94vh] ${
                  showThermalInModal ? 'sm:max-w-4xl' : 'sm:max-w-lg'
                } bg-[#f4f7f4] dark:bg-slate-950 sm:rounded-[28px] sm:shadow-2xl sm:border sm:border-emerald-900/20 dark:sm:border-emerald-800/40 flex flex-col overflow-hidden transition-all`}
              >
                <SaleBillHeaderBar
                  profile={profile}
                  onBack={() => {
                    setSelectedSaleForPrint(null);
                    setShowThermalInModal(false);
                  }}
                  onPrint={handlePrintThisBill}
                  canPrint={true}
                  onDownloadPdf={handleDownloadThisPdf}
                  canDownloadPdf={true}
                  onShareWhatsApp={
                    isSaleActive(selectedSaleForPrint) ? handleWhatsAppThisBill : undefined
                  }
                  canShareWhatsApp={isSaleActive(selectedSaleForPrint)}
                  onToggleThermalPreview={() => setShowThermalInModal((v) => !v)}
                  showThermalPreview={showThermalInModal}
                  onCustomizePrint={() => {
                    setSelectedSaleForPrint(null);
                    setShowThermalInModal(false);
                    openThermalPrintSettings();
                  }}
                />

                <div className="flex-1 overflow-y-auto px-3.5 sm:px-5 py-4 space-y-4">
                  <SaleBillSubHeader
                    invoiceNo={selectedSaleForPrint.invoiceNo}
                    statusKind={billStatusMeta.kind}
                    statusLabel={billStatusMeta.label}
                    dateIso={selectedSaleForPrint.date}
                  />

                  <div
                    className={
                      showThermalInModal
                        ? 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-start'
                        : 'w-full'
                    }
                  >
                    <div className={showThermalInModal ? 'lg:col-span-7' : 'w-full'}>
                      <SaleBillCard
                        profile={profile}
                        items={selectedSaleForPrint.items || []}
                        directAmountFallback={
                          !selectedSaleForPrint.items || selectedSaleForPrint.items.length === 0
                            ? selectedSaleForPrint.amount
                            : 0
                        }
                        notes={selectedSaleForPrint.notes}
                        financials={billFinancials}
                        paymentMethod={selectedSaleForPrint.paymentMethod}
                        customerSummary={billCustomerSummary}
                        isFinalized={true}
                        loyaltyEarned={selectedSaleForPrint.loyaltyPointsEarned || 0}
                        loyaltyRedeemed={selectedSaleForPrint.loyaltyPointsRedeemed || 0}
                        onPreviewThermal={() => setShowThermalInModal((v) => !v)}
                        showThermalPreview={showThermalInModal}
                        onDownloadPdf={handleDownloadThisPdf}
                        onPrintBill={handlePrintThisBill}
                        onShareWhatsApp={
                          isSaleActive(selectedSaleForPrint) ? handleWhatsAppThisBill : undefined
                        }
                        onDoneOrNewBill={() => {
                          setSelectedSaleForPrint(null);
                          setShowThermalInModal(false);
                        }}
                        doneButtonLabel="Close Sale Bill"
                      />
                    </div>

                    {showThermalInModal && (
                      <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                          <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                            Thermal Receipt Slip
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSaleForPrint(null);
                              setShowThermalInModal(false);
                              openThermalPrintSettings();
                            }}
                            className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                          >
                            Customize &rarr;
                          </button>
                        </div>
                        <ThermalReceiptPreview profile={profile} receipt={receiptPayload} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Share Receipt on WhatsApp Modal */}
      {saleForWhatsApp && (
        <WhatsAppReceiptModal
          sale={saleForWhatsApp}
          profile={profile}
          customer={customers.find((c) => c.id === saleForWhatsApp.customerId)}
          onClose={() => setSaleForWhatsApp(null)}
        />
      )}

      {/* Attached Bill Previewer Modal */}
      {viewingAttachment && (
        <BillViewerModal
          attachment={viewingAttachment.attachment}
          title={viewingAttachment.title}
          details={viewingAttachment.details}
          onClose={() => setViewingAttachment(null)}
        />
      )}

      {/* Cancel / Reverse Sale Modal */}
      {saleToCancel && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <Ban className="w-5 h-5" />
                <h3 className="font-bold text-base">Cancel Bill #{saleToCancel.invoiceNo}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSaleToCancel(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCancelSale} className="pt-4 space-y-3">
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                <div className="font-bold">Reversal Impact ({formatINR(saleToCancel.amount)} · {saleToCancel.paymentMethod}):</div>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>Bill stays visible in history marked as <strong>Cancelled</strong> (never silently deleted).</li>
                  <li>Billed item quantities are automatically restored to inventory stock.</li>
                  {saleToCancel.paymentMethod === 'CASH' && (
                    <li>Linked Cashbook IN entry is voided so physical counter cash matches.</li>
                  )}
                  {(saleToCancel.isCredit || saleToCancel.paymentMethod === 'CREDIT') && (
                    <li>Customer Udhar balance is reduced back via reversed ledger entry.</li>
                  )}
                </ul>
              </div>

              {cancelError && (
                <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300">
                  {cancelError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Cancellation Reason (Radd karne ka kaaran) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Wrong quantity billed / customer changed items"
                  value={cancelReason}
                  onChange={(e) => {
                    setCancelReason(e.target.value);
                    if (cancelError) setCancelError(null);
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-2.5"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSaleToCancel(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Keep Bill
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Confirm Cancel &amp; Reverse
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

