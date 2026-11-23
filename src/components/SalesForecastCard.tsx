import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertTriangle,
  Calendar,
  Lightbulb,
} from 'lucide-react';
import { ExpenseRecord, Product, SaleRecord } from '../types';
import { formatINR } from '../utils/accounting';
import {
  buildSalesForecastInputSummary,
  SalesForecastResult,
} from '../utils/analyticsMetrics';
import { apiFetch } from '../utils/apiClient';

interface SalesForecastCardProps {
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  products: Product[];
  storeName?: string;
  forecast: SalesForecastResult | null;
  onForecastGenerated: (result: SalesForecastResult) => void;
}

interface CombinedTimelinePoint {
  label: string;
  dateKey: string;
  dayName: string;
  actualSales: number | null;
  predictedSales: number | null;
  lowEstimate: number | null;
  highEstimate: number | null;
  driver?: string;
  kind: 'HISTORICAL' | 'FORECAST';
}

export const SalesForecastCard: React.FC<SalesForecastCardProps> = ({
  sales,
  expenses,
  products,
  storeName = 'Arjun Groceries',
  forecast,
  onForecastGenerated,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputSummary = useMemo(
    () => buildSalesForecastInputSummary(sales, expenses, products),
    [sales, expenses, products]
  );

  const handleGenerateForecast = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const response = await apiFetch('/api/analytics/sales-forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: inputSummary,
          storeName,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success || !data?.forecast) {
        throw new Error(
          data?.error || `Forecast request failed with status ${response.status}.`
        );
      }

      onForecastGenerated(data.forecast as SalesForecastResult);
    } catch (err: any) {
      setErrorMsg(
        err?.message || 'Unable to generate AI sales forecast right now. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const timelineData: CombinedTimelinePoint[] = useMemo(() => {
    const recentActuals: CombinedTimelinePoint[] = inputSummary.historyDays
      .slice(-7)
      .map((d) => ({
        label: `${d.dayName} ${d.displayDate}`,
        dateKey: d.dateKey,
        dayName: d.dayName,
        actualSales: d.amount,
        predictedSales: null,
        lowEstimate: null,
        highEstimate: null,
        kind: 'HISTORICAL',
      }));

    if (!forecast) return recentActuals;

    const predictedPoints: CombinedTimelinePoint[] = forecast.dailyForecast.map((f) => ({
      label: `${f.dayName} ${f.displayDate}`,
      dateKey: f.date,
      dayName: f.dayName,
      actualSales: null,
      predictedSales: f.predictedAmount,
      lowEstimate: f.lowEstimate,
      highEstimate: f.highEstimate,
      driver: f.driver,
      kind: 'FORECAST',
    }));

    return [...recentActuals, ...predictedPoints];
  }, [inputSummary.historyDays, forecast]);

  const trendBadge = useMemo(() => {
    if (!forecast) return null;
    if (forecast.trendDirection === 'UP') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Upward Trend</span>
        </span>
      );
    }
    if (forecast.trendDirection === 'DOWN') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <TrendingDown className="w-3.5 h-3.5" />
          <span>Softer Demand</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
        <Minus className="w-3.5 h-3.5" />
        <span>Steady Demand</span>
      </span>
    );
  }, [forecast]);

  return (
    <section
      aria-label="Gemini 7-Day Sales Forecast"
      className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              <Sparkles className="w-5 h-5" />
            </span>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              7-Day AI Sales Forecast (Gemini Forecast)
            </h3>
            {trendBadge}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Analyzes your 30-day sales history, weekday shopping peaks, and category demand using Gemini to project the next 7 days
          </p>
        </div>

        <button
          type="button"
          onClick={handleGenerateForecast}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-bold shadow-xs cursor-pointer press-scale shrink-0"
        >
          {isLoading ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Analyzing Sales Patterns...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>{forecast ? 'Refresh 7-Day Forecast' : 'Generate 7-Day AI Forecast'}</span>
            </>
          )}
        </button>
      </div>

      {/* Baseline Historical Snapshot Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Last 7 Days Actual
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
            {formatINR(inputSummary.recent7DayTotal)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
            {inputSummary.growthPct >= 0 ? '+' : ''}
            {inputSummary.growthPct}% vs prior week
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
            30-Day Daily Avg
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
            {formatINR(inputSummary.avgDailySales30D)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {inputSummary.activeDaysCount} active billing days
          </div>
        </div>

        <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
          <div className="text-[11px] font-bold uppercase text-emerald-800 dark:text-emerald-300">
            Next 7 Days Forecast
          </div>
          <div className="text-lg font-extrabold text-emerald-950 dark:text-emerald-100 mt-0.5 tabular-nums">
            {forecast ? formatINR(forecast.expected7DayTotal) : '—'}
          </div>
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
            {forecast ? `Avg ${formatINR(forecast.expectedDailyAverage)}/day` : 'Click Generate above'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60">
          <div className="text-[11px] font-bold uppercase text-blue-800 dark:text-blue-300">
            Projected Peak Day
          </div>
          <div className="text-lg font-extrabold text-blue-950 dark:text-blue-100 mt-0.5 tabular-nums">
            {forecast && forecast.dailyForecast.length > 0
              ? formatINR(
                  Math.max(...forecast.dailyForecast.map((d) => d.predictedAmount))
                )
              : '—'}
          </div>
          <div className="text-[10px] text-blue-700 dark:text-blue-400 truncate">
            {forecast && forecast.dailyForecast.length > 0
              ? (() => {
                  const peak = forecast.dailyForecast.reduce((best, cur) =>
                    cur.predictedAmount > best.predictedAmount ? cur : best
                  );
                  return `${peak.dayName}, ${peak.displayDate}`;
                })()
              : 'Awaiting AI projection'}
          </div>
        </div>
      </div>

      {/* Error State */}
      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">Forecast could not be generated</div>
            <div>{errorMsg}</div>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="p-6 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-emerald-700 dark:text-emerald-400 animate-spin mx-auto" />
          <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
            Analyzing 30-day counter billing velocity with Gemini...
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Evaluating weekday peaks, category mix, and week-over-week momentum
          </div>
        </div>
      )}

      {/* Forecast Chart & Breakdown */}
      {!isLoading && forecast && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs text-slate-800 dark:text-slate-200 space-y-1">
            <div className="font-bold text-emerald-950 dark:text-emerald-200">
              AI Forecast Summary
            </div>
            <p className="leading-relaxed">{forecast.summary}</p>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {forecast.confidenceNote}
            </div>
          </div>

          <div className="w-full h-72" data-testid="gemini-sales-forecast-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={timelineData}
                margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(148, 163, 184, 0.25)"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickLine={false}
                  interval={1}
                />
                <YAxis
                  tickFormatter={(val) => `₹${Math.round(val)}`}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                />
                <Tooltip content={<ForecastTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Bar
                  dataKey="actualSales"
                  name="Actual Sales (Last 7 Days)"
                  fill="#059669"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="predictedSales"
                  name="Gemini Forecast (Next 7 Days)"
                  fill="#2563eb"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  type="monotone"
                  dataKey="highEstimate"
                  name="High Estimate"
                  stroke="#93c5fd"
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 7-Day Daily Breakdown Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {forecast.dailyForecast.map((day) => (
              <div
                key={day.date}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 space-y-1"
              >
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  <span>{day.dayName}</span>
                  <span>{day.displayDate}</span>
                </div>
                <div className="text-sm font-black text-blue-700 dark:text-blue-400 tabular-nums">
                  {formatINR(day.predictedAmount)}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {formatINR(day.lowEstimate)} – {formatINR(day.highEstimate)}
                </div>
                <div className="text-[10px] text-slate-600 dark:text-slate-300 line-clamp-2">
                  {day.driver}
                </div>
              </div>
            ))}
          </div>

          {forecast.recommendations.length > 0 && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <span>Recommended Actions for Upcoming Week</span>
              </div>
              <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                {forecast.recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Initial Pre-Generation Guidance */}
      {!isLoading && !forecast && !errorMsg && (
        <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-start gap-2.5">
            <Calendar className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              Click <strong>Generate 7-Day AI Forecast</strong> to run Gemini demand analysis across your{' '}
              <strong>{sales.length}</strong> recorded sales bills and view day-by-day revenue projections.
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

interface ForecastTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CombinedTimelinePoint }>;
}

const ForecastTooltip: React.FC<ForecastTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="bg-slate-900 text-white rounded-xl p-3 shadow-xl text-xs space-y-1 border border-slate-700 min-w-48">
      <div className="font-bold text-slate-200 border-b border-slate-700 pb-1">
        {pt.label}
      </div>
      {pt.kind === 'HISTORICAL' ? (
        <div className="flex justify-between items-center text-emerald-400 font-bold tabular-nums">
          <span>Actual Sales:</span>
          <span>{formatINR(pt.actualSales || 0)}</span>
        </div>
      ) : (
        <div className="space-y-1 tabular-nums">
          <div className="flex justify-between items-center text-blue-300 font-bold">
            <span>Predicted Sales:</span>
            <span>{formatINR(pt.predictedSales || 0)}</span>
          </div>
          <div className="flex justify-between items-center text-slate-300 text-[11px]">
            <span>Expected Range:</span>
            <span>
              {formatINR(pt.lowEstimate || 0)} – {formatINR(pt.highEstimate || 0)}
            </span>
          </div>
          {pt.driver && (
            <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800">
              {pt.driver}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
