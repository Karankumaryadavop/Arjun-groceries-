import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Scale, TrendingUp } from 'lucide-react';
import { ExpenseRecord, SaleRecord } from '../types';
import {
  calculate30DaySalesVsExpenses,
  DailySalesVsExpensePoint,
  formatINR,
} from '../utils/accounting';

interface SalesVsExpensesChartProps {
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
}

export const SalesVsExpensesChart: React.FC<SalesVsExpensesChartProps> = ({
  sales,
  expenses,
}) => {
  const [chartType, setChartType] = useState<'BAR' | 'AREA'>('BAR');

  const summary = useMemo(
    () => calculate30DaySalesVsExpenses(sales, expenses),
    [sales, expenses]
  );

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              <Scale className="w-5 h-5" />
            </span>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              Sales vs. Expenses — Last 30 Days
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Daily comparison of store sales revenue against shop operating expenses (excluding owner personal drawings)
          </p>
        </div>

        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex items-center text-xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setChartType('BAR')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
              chartType === 'BAR'
                ? 'bg-emerald-800 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Bar Comparison</span>
          </button>
          <button
            type="button"
            onClick={() => setChartType('AREA')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
              chartType === 'AREA'
                ? 'bg-emerald-800 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Area Trend</span>
          </button>
        </div>
      </div>

      {/* 30-Day KPI Chips */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
          <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
            30-Day Total Sales
          </div>
          <div className="text-xl font-extrabold text-emerald-950 dark:text-emerald-100 mt-0.5 tabular-nums">
            {formatINR(summary.totalSales)}
          </div>
          <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
            Across {summary.activeDaysCount} active counter days
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60">
          <div className="text-[11px] font-bold text-rose-800 dark:text-rose-300 uppercase">
            30-Day Operating Expenses
          </div>
          <div className="text-xl font-extrabold text-rose-950 dark:text-rose-100 mt-0.5 tabular-nums">
            {formatINR(summary.totalExpenses)}
          </div>
          <div className="text-[11px] text-rose-700 dark:text-rose-400 tabular-nums">
            {summary.expenseRatioPct}% of sales revenue
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
            Net Gap (Sales - Expenses)
          </div>
          <div
            className={`text-xl font-extrabold mt-0.5 tabular-nums ${
              summary.netDifference >= 0 ? 'text-emerald-800 dark:text-emerald-400' : 'text-red-700 dark:text-rose-400'
            }`}
          >
            {formatINR(summary.netDifference)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Before wholesale inventory COGS
          </div>
        </div>
      </div>

      {/* Recharts 30-Day Comparison Chart */}
      <div className="w-full h-72 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'BAR' ? (
            <BarChart
              data={summary.points}
              margin={{ top: 10, right: 12, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.25)" />
              <XAxis
                dataKey="displayDate"
                interval="preserveStartEnd"
                minTickGap={28}
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
              <Tooltip content={<SalesVsExpenseTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} iconType="circle" />
              <Bar
                dataKey="sales"
                name="Daily Sales (₹)"
                fill="#059669"
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
              />
              <Bar
                dataKey="expenses"
                name="Operating Expenses (₹)"
                fill="#e11d48"
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
              />
            </BarChart>
          ) : (
            <AreaChart
              data={summary.points}
              margin={{ top: 10, right: 12, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.25)" />
              <XAxis
                dataKey="displayDate"
                interval="preserveStartEnd"
                minTickGap={28}
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
              <Tooltip content={<SalesVsExpenseTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} iconType="circle" />
              <Area
                type="monotone"
                dataKey="sales"
                name="Daily Sales (₹)"
                stroke="#059669"
                fill="#10b981"
                fillOpacity={0.22}
                strokeWidth={2.5}
              />
              <Area
                type="monotone"
                dataKey="expenses"
                name="Operating Expenses (₹)"
                stroke="#e11d48"
                fill="#f43f5e"
                fillOpacity={0.18}
                strokeWidth={2}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DailySalesVsExpensePoint }>;
}

const SalesVsExpenseTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="bg-slate-900 text-white rounded-xl p-3 shadow-lg text-xs space-y-1.5 border border-slate-700 min-w-48 tabular-nums">
      <div className="font-bold text-slate-200 border-b border-slate-700 pb-1 flex justify-between">
        <span>{point.displayDate}</span>
        <span className="text-[10px] text-slate-400 font-normal">{point.dateKey}</span>
      </div>
      <div className="flex justify-between text-emerald-300 font-semibold">
        <span>Sales ({point.salesCount} bills):</span>
        <span>{formatINR(point.sales)}</span>
      </div>
      <div className="flex justify-between text-rose-300 font-semibold">
        <span>Expenses ({point.expensesCount} entries):</span>
        <span>{formatINR(point.expenses)}</span>
      </div>
      <div className="flex justify-between border-t border-slate-800 pt-1 font-bold text-slate-100">
        <span>Daily Net Gap:</span>
        <span className={point.netGap >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {formatINR(point.netGap)}
        </span>
      </div>
    </div>
  );
};
