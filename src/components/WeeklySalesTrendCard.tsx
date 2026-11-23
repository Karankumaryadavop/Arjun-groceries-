import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ArrowRight, Plus } from 'lucide-react';
import { WeeklySalesTrendPoint, WeeklySalesTrendReport } from '../utils/dashboardTrends';
import { formatINR } from '../utils/accounting';

interface WeeklySalesTrendCardProps {
  report: WeeklySalesTrendReport;
  onOpenAnalytics: () => void;
  onQuickSale: () => void;
  isDark?: boolean;
}

function formatCompactINR(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '₹0';
  if (Math.abs(value) >= 100000) {
    return `₹${(value / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  }
  if (Math.abs(value) >= 1000) {
    return `₹${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `₹${Math.round(value)}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey?: string;
    value?: number;
    payload?: WeeklySalesTrendPoint;
  }>;
}

const SalesTrendTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const diff = point.dailySales - point.movingAvg30d;
  const diffSign = diff > 0 ? '+' : '';

  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg px-3.5 py-2.5 text-xs min-w-[190px]">
      <div className="flex items-center justify-between gap-3 pb-1.5 mb-1.5 border-b border-slate-100 dark:border-slate-800">
        <span className="font-bold text-slate-900 dark:text-slate-100">{point.fullLabel}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          {point.billsCount} {point.billsCount === 1 ? 'bill' : 'bills'}
        </span>
      </div>
      <div className="space-y-1.5 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span className="w-2.5 h-0.5 rounded-full bg-emerald-600 dark:bg-emerald-400 inline-block" />
            Daily Sales
          </span>
          <span className="font-bold text-slate-900 dark:text-slate-100">
            {formatINR(point.dailySales)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span className="w-2.5 h-0.5 border-t-2 border-dashed border-amber-500 inline-block" />
            30-Day Avg
          </span>
          <span className="font-semibold text-amber-700 dark:text-amber-400">
            {formatINR(point.movingAvg30d)}
          </span>
        </div>
        {point.movingAvg30d > 0 && (
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-500 dark:text-slate-400">vs 30d Avg</span>
            <span
              className={`font-semibold ${
                diff > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : diff < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {diffSign}
              {formatINR(diff)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const WeeklySalesTrendCard: React.FC<WeeklySalesTrendCardProps> = ({
  report,
  onOpenAnalytics,
  onQuickSale,
  isDark = false,
}) => {
  const gridColor = isDark ? '#1e293b' : '#e2e8f0';
  const tickColor = isDark ? '#94a3b8' : '#64748b';
  const dailyLineColor = isDark ? '#34d399' : '#059669';
  const avgLineColor = isDark ? '#fbbf24' : '#d97706';

  const vsPct = report.vsMovingAvgPct;
  const TrendIcon =
    vsPct === null || vsPct === 0 ? Minus : vsPct > 0 ? TrendingUp : TrendingDown;
  const trendToneClass =
    vsPct === null || vsPct === 0
      ? 'text-slate-500 dark:text-slate-400'
      : vsPct > 0
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400';

  const maxVal = Math.max(
    100,
    ...report.points.map((p) => Math.max(p.dailySales, p.movingAvg30d))
  );
  const yDomainMax = Math.ceil((maxVal * 1.15) / 100) * 100;

  return (
    <section
      data-testid="weekly-sales-trend-card"
      className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 shadow-2xs flex flex-col justify-between gap-4 h-full min-w-0"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
              Weekly Sales Trend
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            Last 7 days vs 30-day moving average
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAnalytics}
          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer shrink-0 pt-0.5"
        >
          <span>Full Analytics</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tabular KPI Strip */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 pt-1 pb-2.5 border-b border-slate-100 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            7-Day Total
          </p>
          <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5 truncate">
            {formatINR(report.weeklyTotal)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            7-Day Daily Avg
          </p>
          <div className="flex items-baseline gap-1.5 flex-wrap mt-0.5">
            <span className="text-sm sm:text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {formatINR(report.weeklyDailyAvg)}
            </span>
            {vsPct !== null && (
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${trendToneClass}`}
              >
                <TrendIcon className="w-3 h-3 shrink-0" />
                {vsPct > 0 ? '+' : ''}
                {vsPct}%
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            30-Day Moving Avg
          </p>
          <p className="text-sm sm:text-base font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5 truncate">
            {formatINR(report.currentMovingAvg30d)}
          </p>
        </div>
      </div>

      {/* Chart Area */}
      <div className="relative w-full h-[220px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={report.points}
            margin={{ top: 8, right: 12, left: -8, bottom: 2 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
            <XAxis
              dataKey="shortLabel"
              tick={{ fill: tickColor, fontSize: 11 }}
              axisLine={{ stroke: gridColor }}
              tickLine={false}
              dy={4}
            />
            <YAxis
              domain={[0, yDomainMax]}
              tickFormatter={formatCompactINR}
              tick={{ fill: tickColor, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              content={<SalesTrendTooltip />}
              cursor={{ stroke: gridColor, strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="movingAvg30d"
              name="30-Day Moving Avg"
              stroke={avgLineColor}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, fill: avgLineColor, strokeWidth: 0 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="dailySales"
              name="Daily Sales"
              stroke={dailyLineColor}
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: dailyLineColor, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: dailyLineColor, stroke: isDark ? '#0f172a' : '#ffffff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>

        {!report.hasAnySales && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/75 dark:bg-slate-900/75 rounded-xl px-4 text-center">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              No sales recorded in the last 30 days
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-[260px]">
              Your 7-day sales trend and 30-day moving average will plot automatically as bills are saved.
            </p>
            <button
              type="button"
              onClick={onQuickSale}
              className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record First Sale</span>
            </button>
          </div>
        )}
      </div>

      {/* Inline Legend & Peak Metadata */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
            <span className="w-3.5 h-0.5 rounded-full bg-emerald-600 dark:bg-emerald-400 inline-block" />
            Daily Net Sales
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
            <span className="w-3.5 h-0 border-t-2 border-dashed border-amber-500 inline-block" />
            30-Day Moving Avg
          </span>
        </div>
        {report.peakDay && (
          <span className="tabular-nums">
            Peak: <strong className="text-slate-700 dark:text-slate-200">{report.peakDay.shortLabel}</strong> (
            {formatINR(report.peakDay.dailySales)})
          </span>
        )}
      </div>
    </section>
  );
};
