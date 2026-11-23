import React, { useMemo, useState } from 'react';
import { BillAttachment, Customer, CustomerLedgerEntry, CustomerTransaction, StoreProfile } from '../types';
import { calculateCustomerLedgerWithRunningBalance, formatINR } from '../utils/accounting';
import { downloadCustomerLedgerCSV } from '../utils/csv';
import { downloadCustomerUdharStatementPDF } from '../utils/pdfGenerator';
import {
  X,
  Phone,
  MapPin,
  FileText,
  Download,
  Printer,
  Search,
  Paperclip,
  Eye,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface CustomerDetailModalProps {
  customer: Customer;
  customerTransactions: CustomerTransaction[];
  profile: StoreProfile;
  isOpen: boolean;
  onClose: () => void;
  onInspectAttachment?: (info: {
    attachment: BillAttachment;
    title: string;
    details?: string;
  }) => void;
  onQuickRecordTransaction?: (type: 'CREDIT' | 'PAYMENT') => void;
}

export const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  customer,
  customerTransactions,
  profile,
  isOpen,
  onClose,
  onInspectAttachment,
  onQuickRecordTransaction,
}) => {
  const [typeFilter, setTypeFilter] = useState<
    'ALL' | 'CREDIT' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT' | 'CANCELLED'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Complete unfiltered chronological ledger to compute exact running totals & opening/closing Udhar
  const fullLedgerSummary = useMemo(
    () =>
      calculateCustomerLedgerWithRunningBalance(customer, customerTransactions, {
        dateRange: 'ALL',
        typeFilter: 'ALL',
      }),
    [customer, customerTransactions]
  );

  // Filtered entries for display
  const filteredSummary = useMemo(
    () =>
      calculateCustomerLedgerWithRunningBalance(customer, customerTransactions, {
        dateRange: 'ALL',
        typeFilter,
        searchQuery,
      }),
    [customer, customerTransactions, typeFilter, searchQuery]
  );

  // Reverse chronological (most recent first) for convenient reading, while keeping runningBalance accurate
  const displayEntries = useMemo(
    () => [...filteredSummary.entries].reverse(),
    [filteredSummary.entries]
  );

  if (!isOpen) return null;

  const closingBal = fullLedgerSummary.closingBalance;
  const isDue = closingBal > 0;
  const isAdvance = closingBal < 0;

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Customer details for ${customer.name}`}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {customer.photoDataUrl ? (
              <img
                src={customer.photoDataUrl}
                alt={`${customer.name} photo`}
                className="w-12 h-12 rounded-full object-cover border-2 border-emerald-200 dark:border-emerald-800 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-black text-sm flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
                {customer.name.trim().slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 truncate">
                  {customer.name}
                </h2>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  · {customer.category.replace('_', ' ')} Account
                </span>
              </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                {customer.phone || 'No phone'}
              </span>
              {customer.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {customer.address}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {customer.overdueDays > 0 ? `${customer.overdueDays} days overdue` : 'Within credit cycle'}
              </span>
              <span>
                WhatsApp Reminders: {customer.whatsappConsent === false ? 'Opted Out' : 'Enabled'}
              </span>
            </div>
            {customer.notes && (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Note: {customer.notes}
              </p>
            )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close customer details"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Outstanding Udhar Hero & Summary Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div
              className={`lg:col-span-5 rounded-xl p-4 border ${
                isDue
                  ? 'bg-red-50/70 dark:bg-rose-950/30 border-red-200 dark:border-rose-900'
                  : isAdvance
                  ? 'bg-teal-50/70 dark:bg-teal-950/30 border-teal-200 dark:border-teal-900'
                  : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Total Outstanding Udhar Balance
                </span>
                {isDue ? (
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                )}
              </div>
              <div
                className={`text-2xl sm:text-3xl font-black tabular-nums mt-1.5 ${
                  isDue
                    ? 'text-red-700 dark:text-rose-400'
                    : isAdvance
                    ? 'text-teal-700 dark:text-teal-300'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {isAdvance ? `Advance ${formatINR(Math.abs(closingBal))}` : formatINR(closingBal)}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {isDue
                  ? 'Net amount receivable from customer across all active ledger entries'
                  : isAdvance
                  ? 'Customer has advance deposit balance with store'
                  : 'All dues cleared (Hisab Nil)'}
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Opening Balance
                </div>
                <div className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                  {formatINR(fullLedgerSummary.openingBalance)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Total Udhar Given
                </div>
                <div className="text-base font-bold text-red-600 dark:text-rose-400 tabular-nums mt-1">
                  {formatINR(fullLedgerSummary.totalCreditGiven)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Payments Received
                </div>
                <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
                  {formatINR(fullLedgerSummary.totalPaymentReceived)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Total Transactions
                </div>
                <div className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                  {fullLedgerSummary.activeCount}
                  {fullLedgerSummary.cancelledCount > 0
                    ? ` (+${fullLedgerSummary.cancelledCount} cancelled)`
                    : ''}
                </div>
              </div>
            </div>
          </div>

          {/* Action & Filter Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'All History' },
                  { id: 'CREDIT', label: 'Udhar Given' },
                  { id: 'PAYMENT', label: 'Payments' },
                  { id: 'RETURN', label: 'Returns' },
                  { id: 'ADJUSTMENT', label: 'Adjustments' },
                  { id: 'CANCELLED', label: 'Cancelled' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTypeFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                    typeFilter === tab.id
                      ? 'bg-emerald-800 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search bill #, items, notes..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
              />
            </div>
          </div>

          {/* Complete Chronological Transaction History Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                <FileText className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Complete Transaction History ({displayEntries.length} entries)</span>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Newest entries shown first · Running balances verified chronologically
              </span>
            </div>

            <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-900/90 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                  <tr>
                    <th className="py-2.5 px-3 whitespace-nowrap">Date &amp; Time</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Type</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Invoice / Ref</th>
                    <th className="py-2.5 px-3 min-w-[200px]">Description &amp; Items</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Mode</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Udhar (+ ₹)</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Jama (- ₹)</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Running Bal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayEntries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-slate-500 dark:text-slate-400"
                      >
                        No transactions found matching the selected filter.
                      </td>
                    </tr>
                  ) : (
                    displayEntries.map((entry: CustomerLedgerEntry) => {
                      const isCredit = entry.type === 'CREDIT';
                      const isOpening = entry.type === 'OPENING';
                      const isCancelled = entry.isCancelled;
                      return (
                        <tr
                          key={entry.id}
                          className={
                            isCancelled
                              ? 'bg-slate-50/70 dark:bg-slate-800/40 opacity-65'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                            {formatDateTime(entry.date)}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-bold">
                            <span
                              className={
                                isCancelled
                                  ? 'text-slate-500 line-through'
                                  : isCredit
                                  ? 'text-red-700 dark:text-rose-400'
                                  : isOpening
                                  ? 'text-slate-700 dark:text-slate-300'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }
                            >
                              {isCancelled ? 'CANCELLED' : entry.type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">
                            {entry.invoiceNo || '-'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
                            <div className={isCancelled ? 'line-through' : ''}>
                              {entry.description}
                            </div>
                            {entry.itemsSummary && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Items: {entry.itemsSummary}
                              </div>
                            )}
                            {isCancelled && entry.cancelReason && (
                              <div className="text-[11px] text-red-600 dark:text-rose-400 mt-0.5">
                                Cancelled: {entry.cancelReason}
                              </div>
                            )}
                            {entry.attachments && entry.attachments.length > 0 && onInspectAttachment && (
                              <button
                                type="button"
                                onClick={() =>
                                  onInspectAttachment({
                                    attachment: entry.attachments![0],
                                    title: `${customer.name} - ${entry.invoiceNo || entry.type}`,
                                    details: `${formatDateTime(entry.date)} · ${formatINR(entry.amount)}`,
                                  })
                                }
                                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                <Paperclip className="w-3 h-3" />
                                <span>View {entry.attachments.length} attachment</span>
                                <Eye className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {entry.paymentMethod || (isCredit ? 'CREDIT' : '-')}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold tabular-nums text-red-600 dark:text-rose-400">
                            {!isCancelled && entry.debitAmount > 0 ? formatINR(entry.debitAmount) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {!isCancelled && entry.creditAmount > 0 ? formatINR(entry.creditAmount) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-black tabular-nums text-slate-900 dark:text-slate-100">
                            {formatINR(entry.runningBalance)}
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {fullLedgerSummary.openingBalance > 0 && typeFilter === 'ALL' && !searchQuery && (
                    <tr className="bg-slate-50/70 dark:bg-slate-800/40 border-t border-dashed border-slate-300 dark:border-slate-700">
                      <td className="py-2 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        Account Start
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap font-bold text-slate-700 dark:text-slate-300">
                        OPENING
                      </td>
                      <td className="py-2 px-3">-</td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                        Opening Balance Carryforward (Purana Hisab)
                      </td>
                      <td className="py-2 px-3">-</td>
                      <td className="py-2 px-3 text-right font-bold tabular-nums text-slate-700 dark:text-slate-300">
                        {formatINR(fullLedgerSummary.openingBalance)}
                      </td>
                      <td className="py-2 px-3 text-right">-</td>
                      <td className="py-2 px-3 text-right font-black tabular-nums text-slate-900 dark:text-slate-100">
                        {formatINR(fullLedgerSummary.openingBalance)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {onQuickRecordTransaction && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onQuickRecordTransaction('CREDIT');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                >
                  + Give Udhar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onQuickRecordTransaction('PAYMENT');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                >
                  + Receive Payment
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                downloadCustomerUdharStatementPDF(customer, fullLedgerSummary, profile)
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download PDF Statement</span>
            </button>
            <button
              type="button"
              onClick={() => downloadCustomerLedgerCSV(customer, fullLedgerSummary)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
