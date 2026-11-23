import React, { useMemo, useState } from 'react';
import {
  LogOut,
  Sun,
  Moon,
  Search,
  Download,
  Phone,
  MapPin,
  ArrowUpRight,
  ArrowDownLeft,
  RotateCcw,
  Receipt,
  Award,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { buildCustomerPortalData, CustomerPortalLedgerEntry } from '../utils/portalAuth';
import { downloadCSVFile, escapeCSVCell } from '../utils/csv';
import { BRAND_NAME } from './BrandLogo';

type FilterKind = 'ALL' | 'BILLS' | 'PAYMENTS' | 'RETURNS';

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDateDisplay(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw || '-';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function sanitizeCsvCell(val: string | number | null | undefined): string {
  const str = val === null || val === undefined ? '' : String(val);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return escapeCSVCell(safe);
}

function formatPaymentMethod(raw?: string): string {
  if (!raw) return '-';
  const map: Record<string, string> = {
    CASH: 'Cash',
    UPI: 'UPI',
    BANK_TRANSFER: 'Bank Transfer',
    CHEQUE: 'Cheque',
    CARD: 'Card',
    CREDIT: 'Store Credit',
    SPLIT: 'Split',
  };
  return map[raw.toUpperCase()] || raw.replace(/_/g, ' ');
}

export const CustomerPortalView: React.FC = () => {
  const {
    profile,
    authSession,
    customers,
    customerTransactions,
    sales,
    theme,
    setTheme,
    logout,
  } = useStore();

  const [filterKind, setFilterKind] = useState<FilterKind>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const customer = useMemo(
    () => customers.find((c) => c.id === authSession?.portalEntityId) || null,
    [customers, authSession?.portalEntityId]
  );

  const summary = useMemo(() => {
    if (!customer) return null;
    return buildCustomerPortalData({
      customer,
      customerTransactions,
      sales,
    });
  }, [customer, customerTransactions, sales]);

  const filteredEntries = useMemo(() => {
    if (!summary) return [];
    const q = searchQuery.trim().toLowerCase();
    return summary.entries.filter((entry) => {
      if (filterKind === 'BILLS' && entry.type !== 'CREDIT' && entry.type !== 'OPENING') {
        return false;
      }
      if (filterKind === 'PAYMENTS' && entry.type !== 'PAYMENT') {
        return false;
      }
      if (filterKind === 'RETURNS' && entry.type !== 'RETURN') {
        return false;
      }
      if (!q) return true;
      const haystack = [
        entry.description,
        entry.invoiceNo || '',
        entry.paymentMethod || '',
        entry.type,
        formatDateDisplay(entry.date),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [summary, filterKind, searchQuery]);

  const handleDownloadStatement = () => {
    if (!summary) return;
    const headers = [
      'Date',
      'Type',
      'Description',
      'Invoice / Ref No',
      'Payment Mode',
      'Amount (INR)',
      'Running Balance (INR)',
      'Status',
    ];
    const rows = filteredEntries.map((entry) => [
      sanitizeCsvCell(formatDateDisplay(entry.date)),
      sanitizeCsvCell(entry.type),
      sanitizeCsvCell(entry.description),
      sanitizeCsvCell(entry.invoiceNo || ''),
      sanitizeCsvCell(entry.paymentMethod || ''),
      sanitizeCsvCell(entry.amount.toFixed(2)),
      sanitizeCsvCell(entry.runningBalance.toFixed(2)),
      sanitizeCsvCell(entry.status),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const safeName = summary.customer.name.replace(/[^a-zA-Z0-9]/g, '_');
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSVFile(`customer_statement_${safeName}_${dateStr}.csv`, csv);
  };

  const storeName = profile.storeName?.trim() || BRAND_NAME;

  if (!customer || !summary) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-amber-600 mx-auto" />
          <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">
            Customer Record Unavailable
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            We could not locate this customer profile in the store database. Please sign in again.
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full min-h-[46px] rounded-xl bg-[#0d7f1f] hover:bg-[#086917] text-white font-bold text-sm cursor-pointer"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  const renderEntryType = (entry: CustomerPortalLedgerEntry) => {
    if (entry.type === 'PAYMENT') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <ArrowDownLeft className="w-3.5 h-3.5" />
          Payment
        </span>
      );
    }
    if (entry.type === 'RETURN') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400">
          <RotateCcw className="w-3.5 h-3.5" />
          Return
        </span>
      );
    }
    if (entry.type === 'ADJUSTMENT') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Adjustment
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
        <ArrowUpRight className="w-3.5 h-3.5" />
        {entry.type === 'OPENING' ? 'Opening' : 'Bill / Udhar'}
      </span>
    );
  };

  return (
    <div
      data-testid="customer-portal-view"
      className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col"
    >
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0d7f1f] text-white flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                {storeName}
              </p>
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Customer Statement Portal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="min-w-[44px] min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              data-testid="portal-logout-btn"
              onClick={() => void logout()}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-200 dark:hover:border-red-900 text-slate-700 dark:text-slate-200 hover:text-red-700 dark:hover:text-red-300 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Account Profile Strip */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {customer.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Phone className="w-3.5 h-3.5 text-[#0d7f1f] dark:text-emerald-400" />
                {customer.phone}
              </span>
              {customer.address && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {customer.address}
                </span>
              )}
              <span>
                {summary.activeTransactionCount}{' '}
                {summary.activeTransactionCount === 1 ? 'entry' : 'entries'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadStatement}
            disabled={filteredEntries.length === 0}
            className="min-h-[44px] px-4 rounded-xl bg-[#0d7f1f] hover:bg-[#086917] disabled:opacity-50 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Download Statement (CSV)</span>
          </button>
        </section>

        {/* KPI Summary Cards */}
        <section
          aria-label="Account Summary"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>{summary.currentBalance > 0 ? 'Balance Due (Udhar)' : 'Account Balance'}</span>
              <Wallet className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <p
              data-testid="customer-kpi-balance"
              className={`mt-2 text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight ${
                summary.currentBalance > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {formatINR(Math.abs(summary.currentBalance))}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {summary.currentBalance > 0
                ? 'Payable to store'
                : summary.currentBalance < 0
                  ? 'Advance credit with store'
                  : 'All dues settled'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>Total Billed</span>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </div>
            <p
              data-testid="customer-kpi-billed"
              className="mt-2 text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-white"
            >
              {formatINR(summary.totalBilled)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Purchases & credit bills
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>Total Paid</span>
              <ArrowDownLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p
              data-testid="customer-kpi-paid"
              className="mt-2 text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400"
            >
              {formatINR(summary.totalPaid)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {summary.totalReturns > 0
                ? `+ ${formatINR(summary.totalReturns)} returns`
                : 'Payments recorded'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>Loyalty Points</span>
              <Award className="w-4 h-4 text-[#0d7f1f] dark:text-emerald-400" />
            </div>
            <p
              data-testid="customer-kpi-loyalty"
              className="mt-2 text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-white"
            >
              {summary.loyaltyPoints.toLocaleString('en-IN')} pts
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {summary.lifetimeLoyaltyPoints.toLocaleString('en-IN')} lifetime earned
            </p>
          </div>
        </section>

        {/* Transaction Ledger Section */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          {/* Filters & Search Toolbar */}
          <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 md:pb-0">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'BILLS', label: 'Bills / Udhar' },
                  { id: 'PAYMENTS', label: 'Payments' },
                  { id: 'RETURNS', label: 'Returns' },
                ] as { id: FilterKind; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterKind(tab.id)}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    filterKind === tab.id
                      ? 'bg-[#0d7f1f] text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search transactions"
                placeholder="Search invoice, note, mode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full min-h-[42px] pl-10 pr-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {filteredEntries.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Receipt className="w-9 h-9 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                No transactions found
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {summary.entries.length === 0
                  ? 'Your store bills and payments will appear here once recorded.'
                  : 'Try clearing your search or selecting a different filter.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Ledger Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-5">Date</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Details</th>
                      <th className="py-3 px-4">Mode</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-5 text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {filteredEntries.map((entry) => {
                      const hasItems = Boolean(entry.items && entry.items.length > 0);
                      const isExpanded = expandedId === entry.id;
                      const isCancelled = entry.status !== 'COMPLETED';
                      return (
                        <React.Fragment key={entry.id}>
                          <tr
                            className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                              isCancelled ? 'opacity-55 line-through' : ''
                            }`}
                          >
                            <td className="py-3.5 px-5 whitespace-nowrap text-xs font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                              {formatDateDisplay(entry.date)}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {renderEntryType(entry)}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {entry.description}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {entry.invoiceNo && (
                                  <span className="tabular-nums">Ref: {entry.invoiceNo}</span>
                                )}
                                {hasItems && (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                                    className="inline-flex items-center gap-1 font-semibold text-[#0d7f1f] dark:text-emerald-400 hover:underline cursor-pointer"
                                  >
                                    {entry.items!.length}{' '}
                                    {entry.items!.length === 1 ? 'item' : 'items'}
                                    {isExpanded ? (
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap text-xs font-medium text-slate-600 dark:text-slate-300">
                              {formatPaymentMethod(entry.paymentMethod)}
                            </td>
                            <td
                              className={`py-3.5 px-4 whitespace-nowrap text-right font-bold tabular-nums ${
                                entry.type === 'PAYMENT' || entry.type === 'RETURN'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-900 dark:text-white'
                              }`}
                            >
                              {entry.type === 'PAYMENT' || entry.type === 'RETURN' ? '-' : '+'}
                              {formatINR(entry.amount)}
                            </td>
                            <td className="py-3.5 px-5 whitespace-nowrap text-right font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                              {formatINR(entry.runningBalance)}
                            </td>
                          </tr>
                          {hasItems && isExpanded && (
                            <tr className="bg-slate-50/90 dark:bg-slate-800/40">
                              <td colSpan={6} className="px-6 py-3">
                                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                                  Bill Items
                                </div>
                                <div className="divide-y divide-slate-200/70 dark:divide-slate-700/70">
                                  {entry.items!.map((item, idx) => (
                                    <div
                                      key={`${entry.id}-item-${idx}`}
                                      className="py-1.5 flex items-center justify-between text-xs"
                                    >
                                      <span className="text-slate-800 dark:text-slate-200 font-medium">
                                        {item.productName}{' '}
                                        <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                                          ({item.quantity} {item.unit} × {formatINR(item.rate)})
                                        </span>
                                      </span>
                                      <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                                        {formatINR(item.total)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Ledger Cards */}
              <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                {filteredEntries.map((entry) => {
                  const hasItems = Boolean(entry.items && entry.items.length > 0);
                  const isExpanded = expandedId === entry.id;
                  const isCancelled = entry.status !== 'COMPLETED';
                  return (
                    <div
                      key={entry.id}
                      className={`p-4 space-y-2 ${isCancelled ? 'opacity-55 line-through' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            {renderEntryType(entry)}
                            <span className="text-xs text-slate-400 tabular-nums">
                              {formatDateDisplay(entry.date)}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {entry.description}
                          </p>
                          {(entry.invoiceNo || entry.paymentMethod) && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {[
                                entry.invoiceNo ? `Ref: ${entry.invoiceNo}` : '',
                                entry.paymentMethod ? formatPaymentMethod(entry.paymentMethod) : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          <p
                            className={`text-sm font-extrabold tabular-nums ${
                              entry.type === 'PAYMENT' || entry.type === 'RETURN'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {entry.type === 'PAYMENT' || entry.type === 'RETURN' ? '-' : '+'}
                            {formatINR(entry.amount)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            Bal: {formatINR(entry.runningBalance)}
                          </p>
                        </div>
                      </div>

                      {hasItems && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                            className="text-xs font-semibold text-[#0d7f1f] dark:text-emerald-400 inline-flex items-center gap-1 min-h-[36px] cursor-pointer"
                          >
                            {isExpanded ? 'Hide items' : `View ${entry.items!.length} items`}
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                              {entry.items!.map((item, idx) => (
                                <div
                                  key={`${entry.id}-m-item-${idx}`}
                                  className="flex items-center justify-between text-xs"
                                >
                                  <span className="text-slate-700 dark:text-slate-300">
                                    {item.productName} ({item.quantity} {item.unit})
                                  </span>
                                  <span className="font-semibold tabular-nums">
                                    {formatINR(item.total)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
};
