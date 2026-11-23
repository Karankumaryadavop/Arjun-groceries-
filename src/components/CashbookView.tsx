import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import {
  formatINR,
  calculateCashbookSummary,
  calculateOpeningCashBeforeRange,
  getLocalTodayKey,
  isCashbookEntryActive,
} from '../utils/accounting';
import { BillAttachment } from '../types';
import { FileAttachment } from './FileAttachment';
import { BillViewerModal } from './BillViewerModal';
import { PeriodFilterBar } from './PeriodFilterBar';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Calendar,
  Filter,
  Receipt,
  AlertCircle,
  X,
  History,
  Paperclip,
  Eye,
} from 'lucide-react';

export const CashbookView: React.FC = () => {
  const {
    cashbookEntries,
    filteredCashbookEntries,
    dateFilter,
    customDateRange,
    addCashbookEntry,
  } = useStore();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  useTrackActiveTransaction('cashbook-modal', isAddModalOpen);
  const [entryType, setEntryType] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('OWNER_CONTRIBUTION');
  const [entryDate, setEntryDate] = useState(() => getLocalTodayKey());
  const [description, setDescription] = useState('');
  const [cashAttachments, setCashAttachments] = useState<BillAttachment[]>([]);
  const [viewingAttachment, setViewingAttachment] = useState<{
    attachment: BillAttachment;
    title: string;
    details?: string;
  } | null>(null);

  const openingCash = useMemo(
    () => calculateOpeningCashBeforeRange(cashbookEntries, dateFilter, customDateRange.startDate),
    [cashbookEntries, dateFilter, customDateRange.startDate]
  );

  const cashSummary = useMemo(
    () => calculateCashbookSummary(openingCash, filteredCashbookEntries),
    [openingCash, filteredCashbookEntries]
  );

  const openModal = (type: 'IN' | 'OUT') => {
    setEntryType(type);
    setCategory(type === 'IN' ? 'OWNER_CONTRIBUTION' : 'EXPENSE');
    setEntryDate(getLocalTodayKey());
    setAmount('');
    setDescription('');
    setCashAttachments([]);
    setIsAddModalOpen(true);
  };

  const handleCreateEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (Number(amount) <= 0) return;

    const refType =
      category === 'OWNER_CONTRIBUTION'
        ? 'OWNER_CONTRIBUTION'
        : category === 'OPENING'
        ? 'OPENING'
        : 'OTHER';

    addCashbookEntry({
      type: entryType,
      category,
      description:
        description.trim() ||
        (category === 'OWNER_CONTRIBUTION'
          ? 'Owner Capital / Cash Added to Drawer'
          : `${entryType === 'IN' ? 'Cash Received' : 'Cash Paid'} (${category})`),
      amount: Number(amount),
      refType,
      date: entryDate || getLocalTodayKey(),
      attachments: cashAttachments.length > 0 ? cashAttachments : undefined,
    });

    setAmount('');
    setDescription('');
    setCashAttachments([]);
    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-4 pb-12">
      <PeriodFilterBar label="Rokad Period" />

      {/* Top Rokad Bahi Summary Card */}
      <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 rounded-2xl p-5 sm:p-6 text-white shadow-md border border-emerald-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-emerald-800 rounded-lg text-emerald-300">
                <Wallet className="w-5 h-5" />
              </span>
              <span className="text-xs uppercase font-bold tracking-wider text-emerald-300">
                Daily Cashbook & Drawer (Rokad Bahi)
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold mt-1 tabular-nums">
              Available Cash: {formatINR(cashSummary.closingCash)}
            </h2>
            <p className="text-xs text-emerald-200/80 mt-1 max-w-lg tabular-nums">
              Formula: Opening ({formatINR(cashSummary.openingCash)}) + Inflows ({formatINR(cashSummary.totalInflows)}) - Outflows ({formatINR(cashSummary.totalOutflows)}). Credit udhar is strictly excluded until cash received.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openModal('IN')}
              className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-xs cursor-pointer"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>+ Cash In (Galle me Jama)</span>
            </button>
            <button
              type="button"
              onClick={() => openModal('OUT')}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-xs cursor-pointer"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>- Cash Out (Nikasi)</span>
            </button>
          </div>
        </div>

        {/* Opening + Inflows + Outflows + Closing Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-emerald-800/70 text-center tabular-nums">
          <div className="p-2.5 bg-emerald-900/60 rounded-xl border border-emerald-800">
            <div className="text-[11px] text-emerald-300 uppercase">Opening Cash (Shuruati)</div>
            <div className="text-lg font-bold text-white mt-0.5">
              {formatINR(cashSummary.openingCash)}
            </div>
          </div>
          <div className="p-2.5 bg-emerald-900/60 rounded-xl border border-emerald-800">
            <div className="text-[11px] text-emerald-300 uppercase">Period Inflows (Aawak)</div>
            <div className="text-lg font-bold text-emerald-300 mt-0.5">
              + {formatINR(cashSummary.totalInflows)}
            </div>
          </div>
          <div className="p-2.5 bg-emerald-900/60 rounded-xl border border-emerald-800">
            <div className="text-[11px] text-emerald-300 uppercase">Period Outflows (Jaawak)</div>
            <div className="text-lg font-bold text-red-300 mt-0.5">
              - {formatINR(cashSummary.totalOutflows)}
            </div>
          </div>
          <div className="p-2.5 bg-emerald-900/80 rounded-xl border border-emerald-700">
            <div className="text-[11px] text-emerald-200 uppercase font-bold">Closing Cash Balance</div>
            <div className="text-lg font-extrabold text-white mt-0.5">
              {formatINR(cashSummary.closingCash)}
            </div>
          </div>
        </div>
      </div>

      {/* Cash Movement Ledger Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Cash Movement History (Rokad Entries)</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Every physical rupee in and out of the shop drawer (cancelled entries shown struck through)</p>
          </div>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {filteredCashbookEntries.length} entries
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold uppercase text-[11px]">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Particulars / Description</th>
                <th className="py-3 px-4 text-right">Cash In (₹)</th>
                <th className="py-3 px-4 text-right">Cash Out (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCashbookEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    No cash transactions recorded for this date filter.
                  </td>
                </tr>
              ) : (
                filteredCashbookEntries.map((cb) => {
                  const isIn = cb.type === 'IN';
                  const isActive = isCashbookEntryActive(cb);
                  return (
                    <tr
                      key={cb.id}
                      className={`transition-colors ${
                        !isActive
                          ? 'bg-slate-50/70 dark:bg-slate-900/40 opacity-65'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {new Date(cb.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${
                              !isActive
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                : isIn
                                ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                                : 'bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {isIn ? 'Cash In (Aawak)' : 'Cash Out (Jaawak)'}
                          </span>
                          {!isActive && (
                            <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded">
                              Cancelled
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {cb.category}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                        <div className={!isActive ? 'line-through text-slate-400' : ''}>{cb.description}</div>
                        {!isActive && cb.cancelReason && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Reason: {cb.cancelReason}
                          </div>
                        )}
                        {cb.attachments && cb.attachments.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setViewingAttachment({
                                attachment: cb.attachments![0],
                                title: `Cash ${isIn ? 'Inflow' : 'Outflow'} Receipt`,
                                details: `${cb.description} · Amount: ${formatINR(cb.amount)}`,
                              })
                            }
                            className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                          >
                            <Paperclip className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
                            <span>{cb.attachments.length} {cb.attachments.length === 1 ? 'Receipt' : 'Receipts'}</span>
                            <Eye className="w-3 h-3 text-emerald-600 dark:text-emerald-400 ml-0.5" />
                          </button>
                        )}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-bold tabular-nums ${
                          !isActive
                            ? 'line-through text-slate-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {isIn ? formatINR(cb.amount) : '—'}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-bold tabular-nums ${
                          !isActive
                            ? 'line-through text-slate-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {!isIn ? formatINR(cb.amount) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Cash Entry Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                {entryType === 'IN' ? 'Add Cash In (Galle me Jama)' : 'Add Cash Out (Nikasi)'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateEntry} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Cash Amount (Rupaye ₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold text-lg">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="e.g. 1000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full text-xl font-bold pl-8 pr-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-slate-900 dark:text-slate-100"
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Category (Varg)
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    {entryType === 'IN' ? (
                      <>
                        <option value="OWNER_CONTRIBUTION">Owner Capital (Malik Jama)</option>
                        <option value="OPENING">Opening Cash (Shuruati Galla)</option>
                        <option value="CASH_SALE">Counter Cash Sale (Nagad Bikri)</option>
                        <option value="CUSTOMER_PAYMENT">Customer Udhar Received (Grahak Jama)</option>
                        <option value="OTHER_INFLOW">Other Cash Inflow (Anya Aawak)</option>
                      </>
                    ) : (
                      <>
                        <option value="EXPENSE">Daily Operating Expense (Dukan Kharch)</option>
                        <option value="DRAWING">Owner Personal Withdrawal (Malik Niji Kharch)</option>
                        <option value="SUPPLIER_PAYMENT">Cash to Supplier (Vyapari Bhugtan)</option>
                        <option value="PURCHASE">Cash Purchase / Stock In (Nagad Kharid)</option>
                        <option value="OTHER_OUTFLOW">Other Cash Outflow (Anya Jaawak)</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Entry Date
                  </label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description / Remark
                </label>
                <input
                  type="text"
                  placeholder="e.g. Change from bank, owner cash added to drawer"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                />
              </div>

              <div>
                <FileAttachment
                  attachments={cashAttachments}
                  onChange={setCashAttachments}
                  label="Attach Cash Voucher / Receipt Photo (Voucher ya Receipt Photo Upload)"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2.5 text-white rounded-xl text-xs font-bold cursor-pointer ${
                    entryType === 'IN' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  Confirm Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cash Receipt Viewer Modal */}
      {viewingAttachment && (
        <BillViewerModal
          attachment={viewingAttachment.attachment}
          title={viewingAttachment.title}
          details={viewingAttachment.details}
          onClose={() => setViewingAttachment(null)}
        />
      )}
    </div>
  );
};
