import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Cell,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Calendar,
  Layers,
  Sparkles,
  Receipt,
  IndianRupee,
} from 'lucide-react';
import { SaleRecord } from '../types';
import {
  formatINR,
  calculate7DaySalesTrend,
  DailySalesTrendPoint,
} from '../utils/accounting';

interface DailySalesBarChartProps {
  sales: SaleRecord[];
}

export const DailySalesBarChart: React.FC<DailySalesBarChartProps> = ({ sales }) => {
  const [viewMode, setViewMode] = useState<'STACKED' | 'TOTAL'>('TOTAL');

  // Compute 7-day sales trend summary using real sales records
  const summary = useMemo(() => {
    return calculate7DaySalesTrend(sales);
  }, [sales]);

  const { trendData, sevenDayTotal, averageDailySales, peakDay, growthPct, totalBills, priorSevenDayTotal } =
    summary;

  const isGrowthPositive = growthPct >= 0;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      {/* Header with Title and Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              <BarChart3 className="w-5 h-5" />
            </span>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              7-Day Daily Sales Trend (7-Day Bikri Trend)
            </h3>
            {/* Growth indicator badge */}
            <span
              className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full ${
                isGrowthPositive
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-rose-950/60 text-red-800 dark:text-rose-300 border border-red-200 dark:border-rose-800'
              }`}
            >
              {isGrowthPositive ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-red-700 dark:text-rose-400" />
              )}
              <span>
                {isGrowthPositive ? '+' : ''}
                {growthPct}% Growth
              </span>
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Visual bar chart of daily counter sales, revenue growth, and payment method distribution
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex items-center text-xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('TOTAL')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
              viewMode === 'TOTAL'
                ? 'bg-emerald-800 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <IndianRupee className="w-3.5 h-3.5" />
            <span>Total Sales</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('STACKED')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
              viewMode === 'STACKED'
                ? 'bg-emerald-800 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>By Mode (Cash/UPI/Credit)</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
        <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/60">
          <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">7-Day Total Revenue</div>
          <div className="text-xl font-extrabold text-emerald-950 dark:text-emerald-100 mt-0.5">
            {formatINR(sevenDayTotal)}
          </div>
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
            vs {formatINR(priorSevenDayTotal)} prior week
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">Avg Daily Sales</div>
          <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">
            {formatINR(averageDailySales)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Per counter day</div>
        </div>

        <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/60">
          <div className="text-[11px] font-bold text-blue-800 dark:text-blue-300 uppercase">Peak Sales Day</div>
          <div className="text-xl font-extrabold text-blue-950 dark:text-blue-100 mt-0.5">
            {formatINR(peakDay.totalSales)}
          </div>
          <div className="text-[10px] text-blue-700 dark:text-blue-400">
            {peakDay.displayDate || 'N/A'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800/60">
          <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase">Bills Issued</div>
          <div className="text-xl font-extrabold text-amber-950 dark:text-amber-100 mt-0.5">
            {totalBills} Bills
          </div>
          <div className="text-[10px] text-amber-700 dark:text-amber-400">
            Avg {totalBills > 0 ? formatINR(Math.round(sevenDayTotal / totalBills)) : '₹0'}/bill
          </div>
        </div>
      </div>

      {/* Recharts Bar Chart */}
      <div className="w-full h-72 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trendData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.25)" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
              tickFormatter={(value, idx) => {
                const item = trendData[idx];
                return item ? `${item.dayName} ${item.displayDate}` : value;
              }}
            />
            <YAxis
              tickFormatter={(val) => `₹${Math.round(val)}`}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
            />
            <Tooltip content={<DailySalesTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
              iconType="circle"
            />

            {viewMode === 'TOTAL' ? (
              <Bar
                dataKey="totalSales"
                name="Total Daily Sales (₹)"
                fill="#059669"
                radius={[6, 6, 0, 0]}
                maxBarSize={38}
              >
                {trendData.map((entry, index) => {
                  const isPeak = entry.totalSales === peakDay.totalSales && entry.totalSales > 0;
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={isPeak ? '#047857' : '#10b981'}
                    />
                  );
                })}
              </Bar>
            ) : (
              <>
                <Bar
                  dataKey="cashSales"
                  name="Cash (₹)"
                  stackId="salesStack"
                  fill="#059669"
                  radius={[0, 0, 0, 0]}
                  maxBarSize={38}
                />
                <Bar
                  dataKey="upiSales"
                  name="UPI / QR (₹)"
                  stackId="salesStack"
                  fill="#2563eb"
                  radius={[0, 0, 0, 0]}
                  maxBarSize={38}
                />
                <Bar
                  dataKey="creditSales"
                  name="Credit / Udhar (₹)"
                  stackId="salesStack"
                  fill="#dc2626"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={38}
                />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Helpful Revenue Growth Footer */}
      <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-800 dark:text-emerald-400 shrink-0" />
          <span>
            <strong className="text-slate-900 dark:text-slate-100">Revenue Growth Insight:</strong>{' '}
            {isGrowthPositive ? (
              <span>
                Sales increased by <strong>{growthPct}%</strong> over the previous 7-day period. Maintain inventory of fast-moving grocery staples.
              </span>
            ) : (
              <span>
                Sales are <strong>{Math.abs(growthPct)}%</strong> lower than the previous week. Check stock availability and follow up on customer udhar.
              </span>
            )}
          </span>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap self-end sm:self-auto">
          7-Day Rolling Trend
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

const DailySalesTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const data: DailySalesTrendPoint = payload[0].payload;

  return (
    <div className="bg-slate-900 text-white rounded-xl p-3 shadow-xl text-xs space-y-1.5 border border-slate-700 min-w-48">
      <div className="font-bold text-slate-200 border-b border-slate-700 pb-1 flex justify-between items-center">
        <span>
          {data.dayName}, {data.displayDate}
        </span>
        <span className="text-[10px] text-slate-400 font-normal">
          {data.billsCount} {data.billsCount === 1 ? 'bill' : 'bills'}
        </span>
      </div>
      <div className="flex justify-between items-center text-emerald-400 font-bold text-sm pt-0.5">
        <span>Total Sales:</span>
        <span>{formatINR(data.totalSales)}</span>
      </div>
      <div className="border-t border-slate-800 pt-1 space-y-1">
        <div className="flex justify-between items-center text-emerald-300">
          <span>• Cash Sales:</span>
          <span>{formatINR(data.cashSales)}</span>
        </div>
        <div className="flex justify-between items-center text-blue-300">
          <span>• UPI / QR:</span>
          <span>{formatINR(data.upiSales)}</span>
        </div>
        <div className="flex justify-between items-center text-red-300">
          <span>• Udhar / Credit:</span>
          <span>{formatINR(data.creditSales)}</span>
        </div>
      </div>
      {data.billsCount > 0 && (
        <div className="border-t border-slate-800 pt-1 flex justify-between items-center text-slate-400 text-[10px]">
          <span>Average Bill Value:</span>
          <span className="text-slate-200 font-semibold">{formatINR(data.averageBillValue)}</span>
        </div>
      )}
    </div>
  );
};
