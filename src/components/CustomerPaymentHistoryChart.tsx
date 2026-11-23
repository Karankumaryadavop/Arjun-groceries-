import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { BarChart3, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Customer, CustomerTransaction } from '../types';
import { formatINR } from '../utils/accounting';
import {
  calculateCustomer6MonthPaymentHistory,
  CustomerMonthlyPaymentPoint,
} from '../utils/analyticsMetrics';

interface CustomerPaymentHistoryChartProps {
  customer: Customer;
  transactions: CustomerTransaction[];
}

export const CustomerPaymentHistoryChart: React.FC<CustomerPaymentHistoryChartProps> = ({
  customer,
  transactions,
}) => {
  const summary = useMemo(
    () => calculateCustomer6MonthPaymentHistory(customer.id, transactions, new Date(), 6),
    [customer.id, transactions]
  );

  const badgeStyle = useMemo(() => {
    switch (summary.creditTrend) {
      case 'IMPROVING':
        return {
          cls: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
          icon: <TrendingUp className="w-3 h-3" />,
          short: 'Good Repayment',
        };
      case 'STEADY':
        return {
          cls: 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
          icon: <Minus className="w-3 h-3" />,
          short: 'Steady Credit',
        };
      case 'GROWING_DUES':
        return {
          cls: 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800',
          icon: <TrendingDown className="w-3 h-3" />,
          short: 'Growing Dues',
        };
      default:
        return {
          cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
          icon: <Minus className="w-3 h-3" />,
          short: 'No Activity',
        };
    }
  }, [summary.creditTrend]);

  return (
    <div
      className="px-4 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 space-y-3"
      data-testid="customer-6month-payment-chart"
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
            <BarChart3 className="w-4 h-4" />
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                6-Month Payment &amp; Credit Trend
              </h4>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${badgeStyle.cls}`}
              >
                {badgeStyle.icon}
                <span>{badgeStyle.short}</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.creditTrendLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
          <div className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/60">
            <span className="text-slate-500 dark:text-slate-400">6M Paid: </span>
            <strong className="text-emerald-800 dark:text-emerald-300">
              {formatINR(summary.totalPayments6M)}
            </strong>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200/70 dark:border-rose-800/60">
            <span className="text-slate-500 dark:text-slate-400">6M Udhar: </span>
            <strong className="text-rose-700 dark:text-rose-300">
              {formatINR(summary.totalCredit6M)}
            </strong>
          </div>
          <div className="hidden sm:block px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400">Recovery: </span>
            <strong className="text-slate-900 dark:text-slate-100">
              {summary.recoveryRatePct}%
            </strong>
          </div>
        </div>
      </div>

      {/* Mini Bar Chart */}
      <div className="w-full h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={summary.monthlyData}
            margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
            barGap={3}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(148, 163, 184, 0.22)"
            />
            <XAxis
              dataKey="monthShort"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.3)' }}
            />
            <YAxis
              tickFormatter={(v) => `₹${Math.round(v)}`}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.3)' }}
            />
            <Tooltip content={<CustomerPaymentTooltip />} />
            <Bar
              dataKey="paymentsReceived"
              name="Payments Received (₹)"
              fill="#059669"
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
            />
            <Bar
              dataKey="creditGiven"
              name="Credit Given (₹)"
              fill="#e11d48"
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CustomerMonthlyPaymentPoint }>;
}

const CustomerPaymentTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="bg-slate-900 text-white rounded-xl p-2.5 shadow-xl text-xs space-y-1 border border-slate-700 min-w-44">
      <div className="font-bold text-slate-200 border-b border-slate-700 pb-1">
        {pt.monthFull}
      </div>
      <div className="flex justify-between items-center text-emerald-400 font-semibold tabular-nums">
        <span>Paid ({pt.paymentCount}):</span>
        <span>{formatINR(pt.paymentsReceived)}</span>
      </div>
      <div className="flex justify-between items-center text-rose-400 font-semibold tabular-nums">
        <span>Udhar ({pt.creditCount}):</span>
        <span>{formatINR(pt.creditGiven)}</span>
      </div>
      <div className="flex justify-between items-center text-slate-300 border-t border-slate-800 pt-1 tabular-nums text-[11px]">
        <span>Net Flow:</span>
        <span className={pt.netFlow >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
          {pt.netFlow >= 0 ? '+' : ''}
          {formatINR(pt.netFlow)}
        </span>
      </div>
    </div>
  );
};
