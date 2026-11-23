import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import {
  formatINR,
  calculateProfitAndLoss,
  calculateCustomerAging,
  calculateWorkingCapital,
  calculateCashbookSummary,
  calculateInventoryValuation,
  calculateOpeningCashBeforeRange,
  isSaleActive,
} from '../utils/accounting';
import {
  TrendingUp,
  Wallet,
  Users,
  Truck,
  ShoppingCart,
  Receipt,
  HeartPulse,
  DollarSign,
  PieChart,
  BarChart3,
  Calendar,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { DailyProfitMarginChart } from './DailyProfitMarginChart';
import { DailySalesBarChart } from './DailySalesBarChart';
import { CategoryMarginHeatmap } from './CategoryMarginHeatmap';
import { SalesVsExpensesChart } from './SalesVsExpensesChart';
import { CategoryProfitabilityCard } from './CategoryProfitabilityCard';
import { SalesForecastCard } from './SalesForecastCard';
import { SalesForecastResult } from '../utils/analyticsMetrics';
import { PeriodFilterBar } from './PeriodFilterBar';

export const AnalyticsView: React.FC = () => {
  const {
    financials,
    dateFilter,
    customDateRange,
    cashbookEntries,
    customerTransactions,
    filteredSales,
    filteredExpenses,
    expenses,
    customers,
    suppliers,
    supplierTransactions,
    products,
    filteredCashbookEntries,
    sales,
    profile,
  } = useStore();

  const [activeSubTab, setActiveSubTab] = useState<
    'PNL' | 'CASHFLOW' | 'CUSTOMERS' | 'SUPPLIERS' | 'SALES' | 'EXPENSES' | 'HEALTH'
  >('PNL');
  const [salesForecast, setSalesForecast] = useState<SalesForecastResult | null>(null);

  // Products lookup map for COGS
  const productsMap = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const activeFilteredSales = useMemo(
    () => filteredSales.filter(isSaleActive),
    [filteredSales]
  );

  // Calculations
  const pnl = useMemo(
    () => calculateProfitAndLoss(filteredSales, filteredExpenses, productsMap, customerTransactions),
    [filteredSales, filteredExpenses, productsMap, customerTransactions]
  );
  const aging = useMemo(() => calculateCustomerAging(customers), [customers]);
  const openingCashForRange = useMemo(
    () => calculateOpeningCashBeforeRange(cashbookEntries, dateFilter, customDateRange.startDate),
    [cashbookEntries, dateFilter, customDateRange.startDate]
  );
  const cashSummary = useMemo(
    () => calculateCashbookSummary(openingCashForRange, filteredCashbookEntries),
    [openingCashForRange, filteredCashbookEntries]
  );
  const inv = useMemo(() => calculateInventoryValuation(products), [products]);
  const totalPayables = suppliers.reduce((sum, s) => sum + Math.max(0, s.currentBalance), 0);
  const health = calculateWorkingCapital(
    cashSummary.closingCash,
    aging.totalReceivables,
    inv.totalCostValue,
    totalPayables
  );

  const subTabs = [
    { id: 'PNL', label: '1. Profit & Loss', hindi: 'Nafa-Nuksan Bahi' },
    { id: 'CASHFLOW', label: '2. Cash Flow', hindi: 'Rokad Aawak-Jaawak' },
    { id: 'CUSTOMERS', label: '3. Customer Credit', hindi: 'Udhar Umra Analysis' },
    { id: 'SUPPLIERS', label: '4. Supplier Payables', hindi: 'Vyapari Denadari' },
    { id: 'SALES', label: '5. Sales Trends', hindi: 'Bikri Trends' },
    { id: 'EXPENSES', label: '6. Expense Analytics', hindi: 'Kharch Analysis' },
    { id: 'HEALTH', label: '7. Business Health', hindi: 'Dukan Financial Health' },
  ] as const;

  return (
    <div className="space-y-4 pb-12">
      {/* Top Navigation Tabs for Analytics */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-2 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-1 overflow-x-auto">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveSubTab(t.id)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === t.id
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <div>{t.label}</div>
            <div className={`text-[10px] font-normal ${activeSubTab === t.id ? 'text-emerald-300' : 'text-slate-400 dark:text-slate-500'}`}>
              {t.hindi}
            </div>
          </button>
        ))}
      </div>

      <PeriodFilterBar label="Analytics Period" />

      {/* DASHBOARD A: Profit and Loss */}
      {activeSubTab === 'PNL' && (
        <div className="space-y-4">
          {!pnl.isProfitVerified && (pnl.grossRevenue > 0 || pnl.salesReturns > 0) && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Provisional P&amp;L — {pnl.reviewStatus} ({pnl.costCoveragePct}% Cost Coverage):</strong>{' '}
                {pnl.uncostedRevenue > 0 &&
                  `${formatINR(pnl.uncostedRevenue)} of revenue came from quick bills, ₹0-cost items, or legacy bills without recorded sale-time purchase cost snapshots. `}
                {(pnl.ambiguousReturnsCount > 0 || pnl.uncostedReturnsCount > 0) &&
                  `${Math.max(pnl.ambiguousReturnsCount, pnl.uncostedReturnsCount)} return(s) require manual review before profit can be marked verified. `}
                {pnl.missingHistoricalCostItemsCount > 0 &&
                  `(${pnl.missingHistoricalCostItemsCount} older item(s) worth ${formatINR(pnl.missingHistoricalCostRevenue)} cannot reconstruct historical cost and are never treated as ₹0 cost.)`}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Net Sales Revenue</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">{formatINR(pnl.totalRevenue)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {pnl.salesReturns > 0
                  ? `Gross ${formatINR(pnl.grossRevenue)} less Returns ${formatINR(pnl.salesReturns)}`
                  : 'Cash, UPI, Bank & Credit billings'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Known COGS ({pnl.costCoveragePct}%)</div>
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1 tabular-nums">{formatINR(pnl.cogs)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                Costed Sales: {formatINR(pnl.costedRevenue)} · Uncosted: {formatINR(pnl.uncostedRevenue)}
              </div>
            </div>

            <div
              className={`p-4 rounded-2xl border shadow-xs ${
                pnl.isProfitVerified
                  ? 'bg-emerald-50/30 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60'
                  : 'bg-amber-50/30 dark:bg-amber-950/25 border-amber-200 dark:border-amber-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div
                  className={`text-xs font-bold uppercase ${
                    pnl.isProfitVerified
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : 'text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {pnl.isProfitVerified ? 'Verified Gross Profit' : 'Provisional Gross Profit'}
                </div>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    pnl.reviewStatus === 'RECONCILED'
                      ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                      : 'bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {pnl.reviewStatus}
                </span>
              </div>
              {pnl.isProfitVerified ? (
                <>
                  <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-300 mt-1 tabular-nums">
                    {formatINR(pnl.verifiedGrossProfit ?? 0)}
                  </div>
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                    Verified Gross Margin: {pnl.verifiedGrossMarginPct ?? 0}%
                  </div>
                </>
              ) : pnl.profitStatus === 'UNCOSTED' || pnl.knownCostGrossProfit === null ? (
                <>
                  <div className="text-xl font-bold text-amber-900 dark:text-amber-200 mt-1">
                    Profit Unverified
                  </div>
                  <div className="text-xs text-amber-800 dark:text-amber-300 mt-1 tabular-nums">
                    Margin N/A · {pnl.costCoveragePct}% costed
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-amber-900 dark:text-amber-200 mt-1 tabular-nums">
                    {formatINR(pnl.knownCostGrossProfit)}
                    <span className="text-xs font-semibold ml-1">(Known-Cost)</span>
                  </div>
                  <div className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    Known-Cost Margin: {pnl.knownCostGrossMarginPct}% (Partial)
                  </div>
                </>
              )}
            </div>

            <div
              className={`p-4 rounded-2xl border shadow-xs ${
                pnl.isProfitVerified
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700/70'
                  : 'bg-amber-50/50 dark:bg-amber-950/35 border-amber-300 dark:border-amber-700/70'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div
                  className={`text-xs font-bold uppercase ${
                    pnl.isProfitVerified
                      ? 'text-emerald-950 dark:text-emerald-200'
                      : 'text-amber-950 dark:text-amber-200'
                  }`}
                >
                  {pnl.isProfitVerified ? 'Verified Net Operating Profit' : 'Provisional Net Profit'}
                </div>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    pnl.reviewStatus === 'RECONCILED'
                      ? 'bg-emerald-200/80 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200'
                      : 'bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {pnl.reviewStatus}
                </span>
              </div>
              {pnl.isProfitVerified ? (
                <>
                  <div
                    className={`text-2xl font-extrabold mt-1 tabular-nums ${
                      (pnl.verifiedNetOperatingProfit ?? 0) >= 0 ? 'text-emerald-950 dark:text-emerald-100' : 'text-red-600 dark:text-rose-400'
                    }`}
                  >
                    {formatINR(pnl.verifiedNetOperatingProfit ?? 0)}
                  </div>
                  <div className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                    Net Margin: {pnl.verifiedNetMarginPct ?? 0}% after operating expenses
                  </div>
                </>
              ) : pnl.profitStatus === 'UNCOSTED' || pnl.knownCostGrossProfit === null ? (
                <>
                  <div className="text-xl font-extrabold text-amber-900 dark:text-amber-200 mt-1">
                    Profit Unverified
                  </div>
                  <div className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    Op. Exp: {formatINR(pnl.operatingExpenses)} · Margin N/A
                  </div>
                </>
              ) : (
                <>
                  <div
                    className={`text-2xl font-extrabold mt-1 tabular-nums ${
                      pnl.knownCostGrossProfit - pnl.operatingExpenses >= 0
                        ? 'text-amber-900 dark:text-amber-200'
                        : 'text-red-600 dark:text-rose-400'
                    }`}
                  >
                    {formatINR(Math.round((pnl.knownCostGrossProfit - pnl.operatingExpenses) * 100) / 100)}
                  </div>
                  <div className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    Known-cost profit less expenses · Margin Unverified
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Recharts Daily Profit Margin Trend Card */}
          <DailyProfitMarginChart sales={sales} expenses={filteredExpenses} products={products} />

          {/* Recharts 30-Day Sales vs. Expenses Comparison Chart */}
          <SalesVsExpensesChart sales={sales} expenses={expenses} />

          {/* Category Profitability (Net Profit Margin) */}
          <CategoryProfitabilityCard
            products={products}
            sales={filteredSales}
            expenses={filteredExpenses}
            supplierTransactions={supplierTransactions}
          />

          {/* Gemini 7-Day AI Sales Forecast */}
          <SalesForecastCard
            sales={sales}
            expenses={expenses}
            products={products}
            storeName={profile.storeName}
            forecast={salesForecast}
            onForecastGenerated={setSalesForecast}
          />

          {/* Category Profit Margin Heatmap */}
          <CategoryMarginHeatmap products={products} sales={sales} />

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Profit &amp; Loss Statement (P&amp;L Ledger)</h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              <div className="py-2.5 flex justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>Total Gross Sales Revenue</span>
                <span className="tabular-nums">{formatINR(pnl.grossRevenue)}</span>
              </div>
              <div className="py-2.5 flex justify-between text-slate-600 dark:text-slate-400 pl-4">
                <span>— Cash Sales</span>
                <span className="tabular-nums">{formatINR(pnl.cashRevenue)}</span>
              </div>
              <div className="py-2.5 flex justify-between text-slate-600 dark:text-slate-400 pl-4">
                <span>— UPI / QR Payments</span>
                <span className="tabular-nums">{formatINR(pnl.upiRevenue)}</span>
              </div>
              {pnl.bankRevenue > 0 && (
                <div className="py-2.5 flex justify-between text-slate-600 dark:text-slate-400 pl-4">
                  <span>— Bank Transfers</span>
                  <span className="tabular-nums">{formatINR(pnl.bankRevenue)}</span>
                </div>
              )}
              <div className="py-2.5 flex justify-between text-slate-600 dark:text-slate-400 pl-4">
                <span>— Credit Sales (Udhar given)</span>
                <span className="tabular-nums">{formatINR(pnl.creditRevenue)}</span>
              </div>
              {pnl.salesReturns > 0 && (
                <div className="py-2.5 flex justify-between text-amber-700 dark:text-amber-400 pl-4">
                  <span>Less: Sales Returns</span>
                  <span className="tabular-nums">- {formatINR(pnl.salesReturns)}</span>
                </div>
              )}
              <div className="py-2.5 flex justify-between font-semibold text-slate-900 dark:text-slate-100">
                <span>Net Sales Revenue (A)</span>
                <span className="tabular-nums">{formatINR(pnl.totalRevenue)}</span>
              </div>
              {pnl.uncostedRevenue > 0 && (
                <div className="py-2.5 flex justify-between text-amber-700 dark:text-amber-400 pl-4">
                  <span>Uncosted Sales Revenue (Excluded from verified profit)</span>
                  <span className="tabular-nums">{formatINR(pnl.uncostedRevenue)}</span>
                </div>
              )}
              <div className="py-2.5 flex justify-between font-semibold text-amber-800 dark:text-amber-400">
                <span>Less: Known Cost of Goods Sold (B · {pnl.costCoveragePct}% costed)</span>
                <span className="tabular-nums">- {formatINR(pnl.cogs)}</span>
              </div>
              <div
                className={`py-2.5 flex justify-between font-bold px-2 rounded ${
                  pnl.isProfitVerified
                    ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/40'
                    : 'text-amber-900 dark:text-amber-200 bg-amber-50/60 dark:bg-amber-950/40'
                }`}
              >
                <span>
                  {pnl.isProfitVerified
                    ? 'Verified Gross Profit = (A - B)'
                    : `Provisional Known-Cost Gross Profit (${pnl.reviewStatus} · ${pnl.costCoveragePct}% costed)`}
                </span>
                <span className="tabular-nums">
                  {pnl.isProfitVerified
                    ? formatINR(pnl.verifiedGrossProfit ?? 0)
                    : pnl.knownCostGrossProfit !== null
                    ? formatINR(pnl.knownCostGrossProfit)
                    : 'Unverified'}
                </span>
              </div>
              <div className="py-2.5 flex justify-between font-semibold text-red-700 dark:text-rose-400">
                <span>Less: Shop Operating Expenses (C)</span>
                <span className="tabular-nums">- {formatINR(pnl.operatingExpenses)}</span>
              </div>
              <div className="py-2.5 flex justify-between font-extrabold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2 rounded text-base">
                <span>
                  {pnl.isProfitVerified
                    ? 'Verified Net Operating Business Profit'
                    : `Provisional Net Result (${pnl.reviewStatus} · Unverified)`}
                </span>
                <span
                  className={`tabular-nums ${
                    !pnl.isProfitVerified
                      ? 'text-amber-800 dark:text-amber-300'
                      : (pnl.verifiedNetOperatingProfit ?? 0) >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-rose-400'
                  }`}
                >
                  {pnl.isProfitVerified
                    ? formatINR(pnl.verifiedNetOperatingProfit ?? 0)
                    : pnl.knownCostGrossProfit !== null
                    ? formatINR(Math.round((pnl.knownCostGrossProfit - pnl.operatingExpenses) * 100) / 100)
                    : 'Unverified'}
                </span>
              </div>
              <div className="py-2.5 flex justify-between text-xs text-slate-500 dark:text-slate-400 italic">
                <span>* Owner Personal Withdrawals (Drawings: {formatINR(pnl.personalDrawings)}) are strictly excluded from business expenses.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD B: Cash Flow */}
      {activeSubTab === 'CASHFLOW' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Total Cash Inflows (Aawak)</div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                + {formatINR(cashSummary.totalInflows)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Cash sales + Customer udhar repayments</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-red-200 dark:border-rose-800/60 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Total Cash Outflows (Jaawak)</div>
              <div className="text-2xl font-bold text-red-600 dark:text-rose-400 mt-1">
                - {formatINR(cashSummary.totalOutflows)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Supplier cash payments, bills & drawings</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Net Drawer Cash Movement</div>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
                {formatINR(cashSummary.closingCash)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">In hand in counter drawer</div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-2">Cash Flow vs Credit Flow Rules</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              In proper Kirana accounting, giving groceries on Udhar (Credit) is not an immediate cash inflow. Only when the customer visits and deposits physical cash or pays via UPI into the store does it register as an inflow. Similarly, buying from wholesalers on 15-day credit does not drain counter cash until actual settlement.
            </p>
          </div>
        </div>
      )}

      {/* DASHBOARD C: Customer Credit Aging */}
      {activeSubTab === 'CUSTOMERS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">0 - 30 Days</div>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">{formatINR(aging.bucket0to30)}</div>
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400">Healthy Credit</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">31 - 60 Days</div>
              <div className="text-lg font-bold text-amber-700 dark:text-amber-400 mt-1">{formatINR(aging.bucket31to60)}</div>
              <div className="text-[10px] text-amber-700 dark:text-amber-400">Needs Reminder</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">61 - 90 Days</div>
              <div className="text-lg font-bold text-orange-600 dark:text-orange-400 mt-1">{formatINR(aging.bucket61to90)}</div>
              <div className="text-[10px] text-orange-600 dark:text-orange-400">Overdue Alert</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">91 - 180 Days</div>
              <div className="text-lg font-bold text-red-600 dark:text-rose-400 mt-1">{formatINR(aging.bucket91to180)}</div>
              <div className="text-[10px] text-red-600 dark:text-rose-400">High Risk</div>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">181+ Days</div>
              <div className="text-lg font-bold text-red-800 dark:text-rose-300 mt-1">{formatINR(aging.bucket181plus)}</div>
              <div className="text-[10px] text-red-800 dark:text-rose-300">Critical Followup</div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-3">Top 10 High-Credit Customers</h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {aging.topOverdueCustomers.map((c, idx) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between text-xs sm:text-sm">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{c.phone} · {c.overdueDays} days unpaid</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-red-600 dark:text-rose-400">{formatINR(c.currentBalance)}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">Total Credit: {formatINR(c.totalCreditGiven)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD D: Supplier Analytics */}
      {activeSubTab === 'SUPPLIERS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-amber-200 dark:border-amber-800/60 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Total Supplier Payables</div>
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1">{formatINR(totalPayables)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Pending payments to distributors</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Total Purchases (YTD)</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {formatINR(suppliers.reduce((s, sup) => s + sup.totalPurchases, 0))}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Wholesale inward inventory volume</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Total Paid to Suppliers</div>
              <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-400 mt-1">
                {formatINR(suppliers.reduce((s, sup) => s + sup.totalPaid, 0))}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Settled invoices via Bank/Cash</div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-3">Distributor-Wise Concentration</h3>
            <div className="space-y-3">
              {suppliers.map((s) => (
                <div key={s.id} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">{s.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Contact: {s.contactPerson || 'Wholesaler'} · {s.phone}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm text-amber-700 dark:text-amber-400">{formatINR(s.currentBalance)} Dues</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Purchases: {formatINR(s.totalPurchases)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD E: Sales Trends */}
      {activeSubTab === 'SALES' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Average Ticket Size</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                {formatINR(activeFilteredSales.length > 0 ? Math.round(pnl.totalRevenue / activeFilteredSales.length) : 0)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Per active completed bill</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Cash vs Credit Ratio</div>
              <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-400 mt-1 tabular-nums">
                {pnl.totalRevenue > 0
                  ? `${Math.round((pnl.cashRevenue / pnl.totalRevenue) * 100)}% Cash`
                  : '100% Cash'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Healthy retail threshold &gt; 70%</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Monthly Sales Growth</div>
              <div
                className={`text-2xl font-bold mt-1 tabular-nums ${
                  !financials.hasPriorGrowthBaseline
                    ? 'text-slate-600 dark:text-slate-300'
                    : financials.salesGrowthPct >= 0
                    ? 'text-emerald-800 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {financials.hasPriorGrowthBaseline
                  ? `${financials.salesGrowthPct >= 0 ? '+' : ''}${financials.salesGrowthPct}%`
                  : 'No prior data'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {financials.hasPriorGrowthBaseline
                  ? 'This month vs last calendar month'
                  : 'Need prior month active bills for baseline'}
              </div>
            </div>
          </div>

          {/* Gemini 7-Day AI Sales Forecast */}
          <SalesForecastCard
            sales={sales}
            expenses={expenses}
            products={products}
            storeName={profile.storeName}
            forecast={salesForecast}
            onForecastGenerated={setSalesForecast}
          />

          {/* 7-Day Total Daily Sales Trend Bar Chart (recharts) */}
          <DailySalesBarChart sales={sales} />

          <DailyProfitMarginChart sales={sales} expenses={filteredExpenses} products={products} />
        </div>
      )}

      {/* DASHBOARD F: Expense Analytics */}
      {activeSubTab === 'EXPENSES' && (
        <div className="space-y-4">
          <SalesVsExpensesChart sales={sales} expenses={expenses} />

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-3">Operating Expense Distribution</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
              Regular expenses categorized by utility, staff wages, freight transport, and refreshments.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredExpenses.map((exp) => (
                <div key={exp.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex justify-between">
                  <div>
                    <div className="font-semibold text-xs text-slate-900 dark:text-slate-100">{exp.title}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{exp.category} · {exp.paymentMethod}</div>
                  </div>
                  <div className="font-bold text-xs text-slate-900 dark:text-slate-100">{formatINR(exp.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD G: Business Health */}
      {activeSubTab === 'HEALTH' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400">Overall Kirana Solvency Status</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-400">
                  {health.solvencyStatus === 'HEALTHY' ? 'Strong & Solvent' : health.solvencyStatus}
                </span>
                <span className="p-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle className="w-5 h-5" />
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Quick Ratio: <strong>{health.quickRatio}</strong> (Standard recommendation is &gt; 1.0)
              </p>
            </div>

            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl border border-emerald-200 dark:border-emerald-800 text-right">
              <div className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold">Net Working Capital</div>
              <div className="text-2xl font-extrabold text-emerald-950 dark:text-emerald-100 mt-0.5">
                {formatINR(health.workingCapital)}
              </div>
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400">Assets minus wholesale debts</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Current Assets (Sampatti)</h4>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-700 dark:text-slate-300">
                <div className="py-2 flex justify-between">
                  <span>Cash In Drawer (Rokad)</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{formatINR(cashSummary.closingCash)}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span>Customer Udhar (Receivables)</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{formatINR(aging.totalReceivables)}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span>Store Inventory Stock Value</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{formatINR(inv.totalCostValue)}</span>
                </div>
                <div className="py-2 flex justify-between font-bold text-emerald-800 dark:text-emerald-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span>Total Current Assets</span>
                  <span>{formatINR(health.currentAssets)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Current Liabilities (Denadari)</h4>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-700 dark:text-slate-300">
                <div className="py-2 flex justify-between">
                  <span>Wholesale Supplier Payables</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400">{formatINR(totalPayables)}</span>
                </div>
                <div className="py-2 flex justify-between font-bold text-amber-800 dark:text-amber-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span>Total Current Liabilities</span>
                  <span>{formatINR(health.currentLiabilities)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
