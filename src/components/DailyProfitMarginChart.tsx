import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { TrendingUp, Percent, IndianRupee, Calendar, Sparkles } from 'lucide-react';
import { SaleRecord, ExpenseRecord, Product } from '../types';
import {
  formatINR,
  calculateDailyProfitMarginTrend,
  DailyProfitMarginPoint,
} from '../utils/accounting';

interface DailyProfitMarginChartProps {
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  products: Product[];
}

export const DailyProfitMarginChart: React.FC<DailyProfitMarginChartProps> = ({
  sales,
  expenses,
  products,
}) => {
  const [daysLimit, setDaysLimit] = useState<number>(14);
  const [metricMode, setMetricMode] = useState<'MARGIN_PCT' | 'PROFIT_INR'>('MARGIN_PCT');

  // Build product lookup map for accurate purchase/cost price lookup
  const productsMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Generate daily trend data points
  const trendData: DailyProfitMarginPoint[] = useMemo(() => {
    const calculated = calculateDailyProfitMarginTrend(sales, expenses, productsMap, daysLimit);
    // If no sales exist yet in this timeframe, generate friendly placeholder preview trend
    if (calculated.length === 0) {
      const today = new Date();
      return Array.from({ length: 5 }).map((_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (4 - i));
        const dateKey = d.toISOString().split('T')[0];
        const displayDate = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        return {
          dateKey,
          displayDate,
          salesRevenue: 0,
          cogs: 0,
          costedRevenue: 0,
          uncostedRevenue: 0,
          costCoveragePct: 100,
          hasCompleteCogs: true,
          isProfitVerified: true,
          reviewStatus: 'RECONCILED' as const,
          profitStatus: 'VERIFIED' as const,
          grossProfit: 0,
          grossMarginPct: 0,
          knownCostGrossProfit: null,
          knownCostGrossMarginPct: null,
          verifiedGrossProfit: 0,
          verifiedGrossMarginPct: 0,
          expenses: 0,
          netProfit: 0,
          netMarginPct: 0,
          billsCount: 0,
        };
      });
    }
    return calculated;
  }, [sales, expenses, productsMap, daysLimit]);

  // Overall aggregate stats across the displayed trend window
  const aggregates = useMemo(() => {
    const totalRev = trendData.reduce((acc, d) => acc + d.salesRevenue, 0);
    const totalCogs = trendData.reduce((acc, d) => acc + d.cogs, 0);
    const totalCosted = trendData.reduce((acc, d) => acc + d.costedRevenue, 0);
    const totalUncosted = trendData.reduce((acc, d) => acc + d.uncostedRevenue, 0);
    const totalGross = trendData.reduce((acc, d) => acc + d.grossProfit, 0);
    const totalExp = trendData.reduce((acc, d) => acc + d.expenses, 0);
    const totalNet = trendData.reduce((acc, d) => acc + d.netProfit, 0);
    const totalBills = trendData.reduce((acc, d) => acc + d.billsCount, 0);
    const hasNeedsReview = trendData.some((d) => d.reviewStatus === 'NEEDS_REVIEW');
    const hasUncosted = totalUncosted > 0 || trendData.some((d) => !d.hasCompleteCogs);
    const isProfitVerified = !hasNeedsReview && !hasUncosted;
    const reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW' = hasNeedsReview
      ? 'NEEDS_REVIEW'
      : hasUncosted
      ? 'UNCOSTED'
      : 'RECONCILED';
    const rawCoverage = totalRev > 0 ? Math.min(100, (totalCosted / totalRev) * 100) : 100;
    const coveragePct =
      totalUncosted > 0 && rawCoverage >= 100 ? 99.9 : Math.round(rawCoverage * 10) / 10;
    const knownCostGross = totalCosted > 0 ? Math.round((totalCosted - totalCogs) * 100) / 100 : null;
    const knownCostMarginPct =
      totalCosted > 0 && knownCostGross !== null
        ? Math.round(((knownCostGross / totalCosted) * 100) * 10) / 10
        : null;
    const avgGrossMargin = isProfitVerified
      ? totalRev > 0
        ? Math.round(((totalGross / totalRev) * 100) * 10) / 10
        : 0
      : knownCostMarginPct;
    const avgNetMargin = isProfitVerified
      ? totalRev > 0
        ? Math.round(((totalNet / totalRev) * 100) * 10) / 10
        : 0
      : null;

    return {
      totalRev,
      totalCogs,
      totalCosted,
      totalUncosted,
      coveragePct,
      isProfitVerified,
      reviewStatus,
      knownCostGross,
      knownCostMarginPct,
      totalGross,
      totalExp,
      totalNet,
      totalBills,
      avgGrossMargin,
      avgNetMargin,
    };
  }, [trendData]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      {/* Card Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              <TrendingUp className="w-5 h-5" />
            </span>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              Daily Profit Margin Trend (Dainik Nafa Margin Trend)
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Visual comparison of sales revenue vs. inventory cost price (COGS) & operating expenses
          </p>
        </div>

        {/* Metric Mode & Range Pickers */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle between Margin % and Profit in INR */}
          <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex items-center text-xs">
            <button
              type="button"
              onClick={() => setMetricMode('MARGIN_PCT')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1 ${
                metricMode === 'MARGIN_PCT'
                  ? 'bg-emerald-800 text-white shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Percent className="w-3.5 h-3.5" />
              Margin %
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('PROFIT_INR')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1 ${
                metricMode === 'PROFIT_INR'
                  ? 'bg-emerald-800 text-white shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <IndianRupee className="w-3.5 h-3.5" />
              Profit (₹)
            </button>
          </div>

          {/* Days range selector */}
          <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex items-center text-xs">
            <button
              type="button"
              onClick={() => setDaysLimit(7)}
              className={`px-2 py-1 rounded-lg font-medium transition cursor-pointer ${
                daysLimit === 7
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => setDaysLimit(14)}
              className={`px-2 py-1 rounded-lg font-medium transition cursor-pointer ${
                daysLimit === 14
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              14 Days
            </button>
            <button
              type="button"
              onClick={() => setDaysLimit(30)}
              className={`px-2 py-1 rounded-lg font-medium transition cursor-pointer ${
                daysLimit === 30
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              30 Days
            </button>
          </div>
        </div>
      </div>

      {/* KPI Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
        <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/60">
          <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
            {aggregates.isProfitVerified ? 'Avg Gross Margin' : 'Known-Cost Margin'}
          </div>
          <div className="text-xl font-extrabold text-emerald-900 dark:text-emerald-200 mt-0.5">
            {aggregates.avgGrossMargin !== null ? `${aggregates.avgGrossMargin}%` : 'N/A'}
          </div>
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
            {aggregates.isProfitVerified
              ? 'Verified gross profit / Sales'
              : `${aggregates.reviewStatus} · ${aggregates.coveragePct}% costed`}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/60">
          <div className="text-[11px] font-bold text-blue-800 dark:text-blue-300 uppercase">Avg Net Margin</div>
          <div className="text-xl font-extrabold text-blue-900 dark:text-blue-200 mt-0.5">
            {aggregates.avgNetMargin !== null ? `${aggregates.avgNetMargin}%` : 'Unverified'}
          </div>
          <div className="text-[10px] text-blue-700 dark:text-blue-400">
            {aggregates.isProfitVerified
              ? 'After shop operating expenses'
              : `Uncosted Rev: ${formatINR(aggregates.totalUncosted)}`}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
            {aggregates.isProfitVerified ? 'Verified Gross Profit' : 'Known-Cost Gross'}
          </div>
          <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">
            {aggregates.isProfitVerified
              ? formatINR(aggregates.totalGross)
              : aggregates.knownCostGross !== null
              ? formatINR(aggregates.knownCostGross)
              : 'Unverified'}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {aggregates.isProfitVerified
              ? 'Revenue - Wholesale COGS'
              : 'Excludes uncosted sales'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800/60">
          <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase">
            Wholesale COGS ({aggregates.coveragePct}%)
          </div>
          <div className="text-xl font-extrabold text-amber-900 dark:text-amber-200 mt-0.5">
            {formatINR(aggregates.totalCogs)}
          </div>
          <div className="text-[10px] text-amber-700 dark:text-amber-400">
            {aggregates.totalUncosted > 0
              ? `Uncosted: ${formatINR(aggregates.totalUncosted)}`
              : 'Cost of inventory sold'}
          </div>
        </div>
      </div>

      {/* Recharts Chart Container */}
      <div className="w-full h-72 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={trendData}
            margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.25)" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
            />
            {metricMode === 'MARGIN_PCT' ? (
              <>
                <YAxis
                  yAxisId="pct"
                  unit="%"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
                  domain={[0, 'auto']}
                />
                <YAxis
                  yAxisId="sales"
                  orientation="right"
                  tickFormatter={(val) => `₹${Math.round(val / 1000)}k`}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  iconType="circle"
                />
                {/* Background bars for sales context */}
                <Bar
                  yAxisId="sales"
                  dataKey="salesRevenue"
                  name="Sales Revenue (₹)"
                  fill="#94a3b8"
                  radius={[4, 4, 0, 0]}
                  opacity={0.35}
                  maxBarSize={30}
                />
                {/* Trend Lines */}
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="grossMarginPct"
                  name="Gross Margin %"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#ffffff' }}
                  activeDot={{ r: 6, fill: '#059669' }}
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="netMarginPct"
                  name="Net Margin %"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3, fill: '#3b82f6', strokeWidth: 1, stroke: '#ffffff' }}
                  activeDot={{ r: 5, fill: '#2563eb' }}
                />
              </>
            ) : (
              <>
                <YAxis
                  tickFormatter={(val) => `₹${Math.round(val)}`}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  iconType="circle"
                />
                <Bar
                  dataKey="salesRevenue"
                  name="Sales Revenue (₹)"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                />
                <Bar
                  dataKey="cogs"
                  name="Cost Price COGS (₹)"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                />
                <Line
                  type="monotone"
                  dataKey="grossProfit"
                  name="Gross Profit (₹)"
                  stroke="#059669"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#059669', strokeWidth: 1.5, stroke: '#ffffff' }}
                />
                <Line
                  type="monotone"
                  dataKey="netProfit"
                  name="Net Profit (₹)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#3b82f6' }}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Helpful Kirana Margin Insight */}
      <div className="bg-emerald-50/50 dark:bg-emerald-950/30 rounded-xl p-3 border border-emerald-100 dark:border-emerald-800/60 flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
        <Sparkles className="w-4 h-4 text-emerald-800 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-emerald-950 dark:text-emerald-200">Kirana Accounting Rule:</span> Gross
          Margin is derived directly from each item sold in sales bills minus its inventory wholesale
          cost price (`purchasePrice`). Operating expenses (electricity, tea, shop wages) are deducted
          to arrive at True Net Profit.
        </div>
      </div>
    </div>
  );
};

interface TooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

const CustomTooltip: React.FC<TooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const data: DailyProfitMarginPoint = payload[0].payload;

  return (
    <div className="bg-slate-900 text-white rounded-xl p-3 shadow-lg text-xs space-y-1.5 border border-slate-700 min-w-44">
      <div className="font-bold text-slate-200 border-b border-slate-700 pb-1 flex justify-between items-center">
        <span>{data.displayDate}</span>
        <span className="text-[10px] text-slate-400 font-normal">
          {data.billsCount} {data.billsCount === 1 ? 'bill' : 'bills'}
        </span>
      </div>
      <div className="flex justify-between items-center text-slate-300">
        <span>Sales Revenue:</span>
        <span className="font-semibold text-white">{formatINR(data.salesRevenue)}</span>
      </div>
      <div className="flex justify-between items-center text-amber-300">
        <span>Cost Price (COGS · {data.costCoveragePct}%):</span>
        <span className="font-semibold">{formatINR(data.cogs)}</span>
      </div>
      {!data.isProfitVerified && (
        <div className="flex justify-between items-center text-amber-200 text-[11px]">
          <span>Status ({data.reviewStatus}):</span>
          <span>Uncosted {formatINR(data.uncostedRevenue)}</span>
        </div>
      )}
      <div className="flex justify-between items-center text-emerald-300 border-t border-slate-800 pt-1">
        <span>{data.isProfitVerified ? 'Verified Gross Profit:' : 'Known-Cost Gross:'}</span>
        <span className="font-bold">
          {data.isProfitVerified
            ? formatINR(data.verifiedGrossProfit ?? 0)
            : data.knownCostGrossProfit !== null
            ? formatINR(data.knownCostGrossProfit)
            : 'Unverified'}
        </span>
      </div>
      <div className="flex justify-between items-center text-emerald-400">
        <span>{data.isProfitVerified ? 'Gross Margin:' : 'Known-Cost Margin:'}</span>
        <span className="font-extrabold">
          {data.isProfitVerified
            ? `${data.verifiedGrossMarginPct ?? 0}%`
            : data.knownCostGrossMarginPct !== null
            ? `${data.knownCostGrossMarginPct}% (Prov.)`
            : 'N/A'}
        </span>
      </div>
      {data.expenses > 0 && (
        <div className="flex justify-between items-center text-red-300">
          <span>Operating Expenses:</span>
          <span>- {formatINR(data.expenses)}</span>
        </div>
      )}
      <div className="flex justify-between items-center text-blue-300 border-t border-slate-800 pt-1">
        <span>{data.isProfitVerified ? 'Net Operating Profit:' : 'Net Profit Status:'}</span>
        <span className="font-bold">
          {data.isProfitVerified ? formatINR(data.netProfit) : 'Provisional'}
        </span>
      </div>
      <div className="flex justify-between items-center text-blue-400">
        <span>Net Margin:</span>
        <span className="font-extrabold">
          {data.isProfitVerified ? `${data.netMarginPct}%` : 'Unverified'}
        </span>
      </div>
    </div>
  );
};
