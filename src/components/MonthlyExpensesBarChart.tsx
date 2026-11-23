import React, { useMemo, useState } from 'react';
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
import { BarChart3, Layers, IndianRupee, TrendingDown, TrendingUp } from 'lucide-react';
import { ExpenseRecord } from '../types';
import { formatINR } from '../utils/accounting';
import {
  calculateMonthlyOperatingExpensesChart,
  MonthlyOperatingExpensePoint,
} from '../utils/expenseAnalytics';
import { useStore } from '../context/StoreContext';

interface MonthlyExpensesBarChartProps {
  expenses: ExpenseRecord[];
}

export const MonthlyExpensesBarChart: React.FC<MonthlyExpensesBarChartProps> = ({ expenses }) => {
  const { accentRamp } = useStore();
  const [viewMode, setViewMode] = useState<'TOTAL' | 'CATEGORY'>('TOTAL');

  const summary = useMemo(
    () => calculateMonthlyOperatingExpensesChart(expenses, new Date(), 6),
    [expenses]
  );

  const {
    monthlyData,
    sixMonthOperatingTotal,
    averageMonthlyOperating,
    peakMonth,
    currentMonthTotal,
    momChangePct,
    totalEntriesCount,
  } = summary;

  const isHigherThanLastMonth = momChangePct > 0;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              <BarChart3 className="w-5 h-5" />
            </span>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              Monthly Operating Expenses (Last 6 Months)
            </h3>
            <span
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md tabular-nums ${
                isHigherThanLastMonth
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              }`}
            >
              {isHigherThanLastMonth ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              <span>
                {momChangePct > 0 ? '+' : ''}
                {momChangePct}% vs Last Month
              </span>
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Tracks business operating spend (rent, electricity, staff, freight &amp; counter costs) excluding owner personal drawings.
          </p>
        </div>

        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex items-center text-xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('TOTAL')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap press-scale ${
              viewMode === 'TOTAL'
                ? 'bg-emerald-700 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <IndianRupee className="w-3.5 h-3.5" />
            <span>Monthly Total</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('CATEGORY')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap press-scale ${
              viewMode === 'CATEGORY'
                ? 'bg-emerald-700 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>By Category</span>
          </button>
        </div>
      </div>

      {/* 6-Month Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/60">
          <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
            6-Month Operating
          </div>
          <div className="text-lg sm:text-xl font-extrabold text-emerald-950 dark:text-emerald-100 mt-0.5 tabular-nums">
            {formatINR(sixMonthOperatingTotal)}
          </div>
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 tabular-nums">
            {totalEntriesCount} operating entries
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
            Monthly Average
          </div>
          <div className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
            {formatINR(averageMonthlyOperating)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">6-month rolling avg</div>
        </div>

        <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800/60">
          <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase">
            Peak Spend Month
          </div>
          <div className="text-lg sm:text-xl font-extrabold text-amber-950 dark:text-amber-100 mt-0.5 tabular-nums">
            {formatINR(peakMonth.operatingTotal)}
          </div>
          <div className="text-[10px] text-amber-700 dark:text-amber-400">
            {peakMonth.operatingTotal > 0 ? peakMonth.monthFull : 'No expenses yet'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/60">
          <div className="text-[11px] font-bold text-blue-800 dark:text-blue-300 uppercase">
            Current Month
          </div>
          <div className="text-lg sm:text-xl font-extrabold text-blue-950 dark:text-blue-100 mt-0.5 tabular-nums">
            {formatINR(currentMonthTotal)}
          </div>
          <div className="text-[10px] text-blue-700 dark:text-blue-400">
            {monthlyData[monthlyData.length - 1]?.monthFull}
          </div>
        </div>
      </div>

      {/* Recharts BarChart */}
      <div className="w-full h-72 pt-1" data-testid="expenses-6month-barchart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.25)" />
            <XAxis
              dataKey="monthShort"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
            />
            <YAxis
              tickFormatter={(val) => `₹${Math.round(val)}`}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
            />
            <Tooltip content={<MonthlyExpenseTooltip />} />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} iconType="circle" />

            {viewMode === 'TOTAL' ? (
              <Bar
                dataKey="operatingTotal"
                name="Operating Expenses (₹)"
                fill={accentRamp[600]}
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
              >
                {monthlyData.map((entry, idx) => {
                  const isPeak =
                    entry.operatingTotal === peakMonth.operatingTotal && entry.operatingTotal > 0;
                  return (
                    <Cell
                      key={`exp-bar-${entry.monthKey}-${idx}`}
                      fill={isPeak ? accentRamp[700] : accentRamp[500]}
                    />
                  );
                })}
              </Bar>
            ) : (
              <>
                <Bar
                  dataKey="shop"
                  name="Shop & Supplies"
                  stackId="expCat"
                  fill={accentRamp[600]}
                  maxBarSize={44}
                />
                <Bar
                  dataKey="staff"
                  name="Staff Wages"
                  stackId="expCat"
                  fill="#2563eb"
                  maxBarSize={44}
                />
                <Bar
                  dataKey="electricity"
                  name="Electricity"
                  stackId="expCat"
                  fill="#d97706"
                  maxBarSize={44}
                />
                <Bar
                  dataKey="transport"
                  name="Transport"
                  stackId="expCat"
                  fill="#0891b2"
                  maxBarSize={44}
                />
                <Bar
                  dataKey="meals"
                  name="Tea / Meals"
                  stackId="expCat"
                  fill="#7c3aed"
                  maxBarSize={44}
                />
                <Bar
                  dataKey="other"
                  name="Other"
                  stackId="expCat"
                  fill="#64748b"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={44}
                />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: MonthlyOperatingExpensePoint }>;
}

const MonthlyExpenseTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;

  return (
    <div className="bg-slate-900 text-white rounded-xl p-3 shadow-xl text-xs space-y-1.5 border border-slate-700 min-w-52">
      <div className="font-bold text-slate-200 border-b border-slate-700 pb-1 flex justify-between items-center">
        <span>{item.monthFull}</span>
        <span className="text-[10px] text-slate-400 font-normal">
          {item.entriesCount} {item.entriesCount === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <div className="flex justify-between items-center text-emerald-400 font-bold text-sm pt-0.5 tabular-nums">
        <span>Operating Spend:</span>
        <span>{formatINR(item.operatingTotal)}</span>
      </div>
      <div className="border-t border-slate-800 pt-1 space-y-0.5 tabular-nums text-[11px]">
        {item.shop > 0 && (
          <div className="flex justify-between text-slate-300">
            <span>Shop &amp; Supplies:</span>
            <span>{formatINR(item.shop)}</span>
          </div>
        )}
        {item.staff > 0 && (
          <div className="flex justify-between text-blue-300">
            <span>Staff Wages:</span>
            <span>{formatINR(item.staff)}</span>
          </div>
        )}
        {item.electricity > 0 && (
          <div className="flex justify-between text-amber-300">
            <span>Electricity:</span>
            <span>{formatINR(item.electricity)}</span>
          </div>
        )}
        {item.transport > 0 && (
          <div className="flex justify-between text-cyan-300">
            <span>Transport &amp; Freight:</span>
            <span>{formatINR(item.transport)}</span>
          </div>
        )}
        {item.meals > 0 && (
          <div className="flex justify-between text-violet-300">
            <span>Tea &amp; Meals:</span>
            <span>{formatINR(item.meals)}</span>
          </div>
        )}
        {item.other > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>Other Sundry:</span>
            <span>{formatINR(item.other)}</span>
          </div>
        )}
      </div>
      {item.drawingsTotal > 0 && (
        <div className="border-t border-slate-800 pt-1 flex justify-between items-center text-amber-300 text-[10px] tabular-nums">
          <span>Excluded Personal Drawings:</span>
          <span>{formatINR(item.drawingsTotal)}</span>
        </div>
      )}
    </div>
  );
};
