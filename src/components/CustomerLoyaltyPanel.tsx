import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { formatINR } from '../utils/accounting';
import {
  buildStoreLoyaltySummary,
  CustomerLoyaltyLedger,
  normalizeLoyaltyConfig,
  resolveLoyaltyConfig,
} from '../utils/loyalty';
import {
  Award,
  CheckCircle2,
  Eye,
  Gift,
  History,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

interface CustomerLoyaltyPanelProps {
  onOpenCustomerKhata: (customerId: string) => void;
}

export const CustomerLoyaltyPanel: React.FC<CustomerLoyaltyPanelProps> = ({
  onOpenCustomerKhata,
}) => {
  const { customers, sales, profile, updateProfile } = useStore();

  const currentConfig = useMemo(() => resolveLoyaltyConfig(profile), [profile]);
  const summary = useMemo(
    () => buildStoreLoyaltySummary(customers, sales, currentConfig),
    [customers, sales, currentConfig]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'REDEEM_READY' | 'EARNING' | 'NEW'>(
    'ALL'
  );
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  // Editable rules state
  const [enabledDraft, setEnabledDraft] = useState(currentConfig.enabled);
  const [pointsPer100Draft, setPointsPer100Draft] = useState(
    String(currentConfig.pointsPer100Rupees)
  );
  const [rupeePerPointDraft, setRupeePerPointDraft] = useState(
    String(currentConfig.rupeeValuePerPoint)
  );
  const [minRedeemDraft, setMinRedeemDraft] = useState(String(currentConfig.minRedeemPoints));
  const [maxDiscountPctDraft, setMaxDiscountPctDraft] = useState(
    String(currentConfig.maxDiscountPercent)
  );
  const [rulesSavedNotice, setRulesSavedNotice] = useState<string | null>(null);

  const [historyRow, setHistoryRow] = useState<CustomerLoyaltyLedger | null>(null);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return summary.customerRows.filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.customerName.toLowerCase().includes(q) || row.phone.toLowerCase().includes(q)
      );
    });
  }, [summary.customerRows, searchQuery, statusFilter]);

  const handleOpenRules = () => {
    setEnabledDraft(currentConfig.enabled);
    setPointsPer100Draft(String(currentConfig.pointsPer100Rupees));
    setRupeePerPointDraft(String(currentConfig.rupeeValuePerPoint));
    setMinRedeemDraft(String(currentConfig.minRedeemPoints));
    setMaxDiscountPctDraft(String(currentConfig.maxDiscountPercent));
    setRulesSavedNotice(null);
    setIsRulesOpen((prev) => !prev);
  };

  const handleSaveRules = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeLoyaltyConfig({
      enabled: enabledDraft,
      pointsPer100Rupees: Number(pointsPer100Draft),
      rupeeValuePerPoint: Number(rupeePerPointDraft),
      minRedeemPoints: Number(minRedeemDraft),
      maxDiscountPercent: Number(maxDiscountPctDraft),
      updatedAt: new Date().toISOString(),
    });
    updateProfile({ loyaltyConfig: normalized });
    setRulesSavedNotice(
      `Loyalty rules saved: ${normalized.pointsPer100Rupees} pts per ₹100 · 1 pt = ₹${normalized.rupeeValuePerPoint} · Min ${normalized.minRedeemPoints} pts`
    );
  };

  return (
    <div data-testid="customer-loyalty-panel" className="space-y-4">
      {/* Program Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Points Issued
          </div>
          <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
            {summary.totalPointsEarned.toLocaleString('en-IN')} pts
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {summary.activeEarnersCount} earning member{summary.activeEarnersCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Points Redeemed
          </div>
          <div className="text-2xl font-black text-blue-700 dark:text-blue-400 mt-1 tabular-nums">
            {summary.totalPointsRedeemed.toLocaleString('en-IN')} pts
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Discounts given: {formatINR(summary.totalDiscountsGivenRs)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Active Unredeemed Points
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {summary.totalAvailablePoints.toLocaleString('en-IN')} pts
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Redeemable value: {formatINR(summary.totalLiabilityRs)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Redeem-Ready Members
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
            {summary.redeemReadyCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Min {currentConfig.minRedeemPoints} pts to redeem
          </div>
        </div>
      </div>

      {/* Rules Bar + Collapsible Config */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Customer Loyalty Points Program
                </h3>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    currentConfig.enabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {currentConfig.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Customers earn <strong>{currentConfig.pointsPer100Rupees} pts</strong> per ₹100 spent ·{' '}
                <strong>1 pt = {formatINR(currentConfig.rupeeValuePerPoint)}</strong> discount · Min{' '}
                <strong>{currentConfig.minRedeemPoints} pts</strong> (up to{' '}
                <strong>{currentConfig.maxDiscountPercent}%</strong> of bill).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenRules}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>{isRulesOpen ? 'Close Rules' : 'Configure Rules'}</span>
          </button>
        </div>

        {rulesSavedNotice && (
          <div className="mx-4 mb-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {rulesSavedNotice}
            </span>
            <button
              type="button"
              onClick={() => setRulesSavedNotice(null)}
              className="text-emerald-700 dark:text-emerald-300 font-bold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {isRulesOpen && (
          <form
            onSubmit={handleSaveRules}
            className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <label className="flex items-center gap-2 sm:col-span-5 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledDraft}
                  onChange={(e) => setEnabledDraft(e.target.checked)}
                  className="w-4 h-4 text-emerald-700 rounded"
                />
                <span>Enable automatic loyalty points earning &amp; redemption in Quick Sale</span>
              </label>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  Points per ₹100
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={pointsPer100Draft}
                  onChange={(e) => setPointsPer100Draft(e.target.value)}
                  className="w-full text-sm font-bold p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  ₹ Value per Point
                </label>
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={rupeePerPointDraft}
                  onChange={(e) => setRupeePerPointDraft(e.target.value)}
                  className="w-full text-sm font-bold p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  Min Points to Redeem
                </label>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  value={minRedeemDraft}
                  onChange={(e) => setMinRedeemDraft(e.target.value)}
                  className="w-full text-sm font-bold p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  Max Bill Discount (%)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={maxDiscountPctDraft}
                  onChange={(e) => setMaxDiscountPctDraft(e.target.value)}
                  className="w-full text-sm font-bold p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                >
                  Save Rules
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Customer Loyalty Points Tracking Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-1.5">
              <Gift className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Loyalty Points Tracking Table</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live points earned, redeemed, available balance, and discount savings per customer
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search loyalty customers"
                placeholder="Search customer or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center gap-1 text-[11px]">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'REDEEM_READY', label: 'Redeem Ready' },
                  { id: 'EARNING', label: 'Earning' },
                  { id: 'NEW', label: 'New' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-emerald-800 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table
            data-testid="loyalty-tracking-table"
            className="w-full text-left text-xs sm:text-sm"
          >
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 uppercase text-[11px] font-semibold">
              <tr>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-3 text-right">Bills</th>
                <th className="py-3 px-3 text-right">Total Spend</th>
                <th className="py-3 px-3 text-right">Earned</th>
                <th className="py-3 px-3 text-right">Redeemed</th>
                <th className="py-3 px-3 text-right">Available Points</th>
                <th className="py-3 px-3 text-right">Discounts Saved</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    {customers.length === 0
                      ? 'Add customers and record sales in Quick Sale to start tracking loyalty points.'
                      : 'No customers match the selected loyalty filter.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr
                    key={row.customerId}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {row.customerName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {row.phone}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {row.eligibleSalesCount}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">
                      {formatINR(row.totalSpend)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                      +{row.totalEarned}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                      {row.totalRedeemed > 0 ? `-${row.totalRedeemed}` : '0'}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums">
                      <div className="font-black text-slate-900 dark:text-slate-100">
                        {row.availablePoints} pts
                      </div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                        {formatINR(row.redeemableValueRs)} value
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                      {formatINR(row.totalDiscountSaved)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          row.status === 'REDEEM_READY'
                            ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                            : row.status === 'EARNING'
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {row.status === 'REDEEM_READY'
                          ? 'Redeem Ready'
                          : row.status === 'EARNING'
                          ? 'Earning'
                          : 'New'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setHistoryRow(row)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold cursor-pointer"
                        >
                          <History className="w-3 h-3" />
                          <span>History</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenCustomerKhata(row.customerId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Khata</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-Customer Loyalty History Modal */}
      {historyRow && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Loyalty Points History for ${historyRow.customerName}`}
        >
          <div
            data-testid="loyalty-history-modal"
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="px-5 py-4 bg-emerald-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-300" />
                <div>
                  <h4 className="font-bold text-base">
                    {historyRow.customerName} · Loyalty Statement
                  </h4>
                  <p className="text-xs text-emerald-300/80">
                    Available: {historyRow.availablePoints} pts ({formatINR(historyRow.redeemableValueRs)}) ·
                    Total Saved: {formatINR(historyRow.totalDiscountSaved)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryRow(null)}
                aria-label="Close loyalty history modal"
                className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 max-h-[65vh] overflow-y-auto">
              {historyRow.entries.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  No loyalty point earn or redeem transactions recorded yet for this customer.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Bill #</th>
                      <th className="py-2 px-3 text-right">Net Bill</th>
                      <th className="py-2 px-3 text-right">Earned</th>
                      <th className="py-2 px-3 text-right">Redeemed</th>
                      <th className="py-2 px-3 text-right">Discount</th>
                      <th className="py-2 px-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historyRow.entries.map((entry) => (
                      <tr key={entry.saleId}>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {new Date(entry.date).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-2 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {entry.invoiceNo}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-800 dark:text-slate-200">
                          {formatINR(entry.netAmount)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                          {entry.pointsEarned > 0 ? `+${entry.pointsEarned}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-bold text-blue-700 dark:text-blue-400">
                          {entry.pointsRedeemed > 0 ? `-${entry.pointsRedeemed}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-amber-700 dark:text-amber-300 font-semibold">
                          {entry.discountAmount > 0 ? `-${formatINR(entry.discountAmount)}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-extrabold text-slate-900 dark:text-slate-100">
                          {entry.runningBalance} pts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const id = historyRow.customerId;
                  setHistoryRow(null);
                  onOpenCustomerKhata(id);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Open Customer Khata Ledger</span>
              </button>
              <button
                type="button"
                onClick={() => setHistoryRow(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
