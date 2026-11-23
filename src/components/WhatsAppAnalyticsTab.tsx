/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStore } from '../context/StoreContext';
import { formatINR } from '../utils/accounting';
import { computeWhatsAppReminderAnalytics } from '../utils/whatsappTemplate';
import { BarChart3, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';

export const WhatsAppAnalyticsTab: React.FC = () => {
  const { whatsappBatches, whatsappAuditLogs, customers, customerTransactions } = useStore();

  const analytics = useMemo(
    () =>
      computeWhatsAppReminderAnalytics(
        whatsappBatches,
        whatsappAuditLogs,
        customers,
        customerTransactions
      ),
    [whatsappBatches, whatsappAuditLogs, customers, customerTransactions]
  );

  // Show compact 14-day or non-zero 30-day tick spacing cleanly
  const hasAnyTrendData = analytics.trend30Days.some(
    (d) => d.sent > 0 || d.delivered > 0 || d.failed > 0
  );

  return (
    <div className="space-y-6">
      {/* KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Reminder Success Rate
          </div>
          <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
            <span>{analytics.summary.successRatePct}%</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {analytics.summary.sentCount} sent · {analytics.summary.failedCount} failed
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Delivered / Read
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
            {analytics.summary.deliveredOrReadCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Confirmed by Meta webhook / API
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Total Reminded Udhar
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
            {formatINR(analytics.summary.totalRemindedRupees)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Across {whatsappBatches.length} weekly batch(es)
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-xs">
          <div className="text-[11px] font-bold uppercase text-emerald-800 dark:text-emerald-300">
            Recovered After Reminder
          </div>
          <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1">
            <span>{formatINR(analytics.summary.totalRecoveredAfterReminder)}</span>
            <TrendingDown className="w-4 h-4" />
          </div>
          <div className="text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold mt-0.5">
            {analytics.summary.outstandingReductionPct}% balance reduction
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 30-Day Delivery Trend */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>30-Day WhatsApp Delivery Trend</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Daily volume of dispatched reminders, confirmed deliveries, and failures over the last 30 days.
              </p>
            </div>
          </div>

          {!hasAnyTrendData ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              No WhatsApp reminders dispatched in the last 30 days yet. Generate &amp; send a batch to visualize trends.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.trend30Days} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="sent" name="Sent" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delivered" name="Delivered / Read" fill="#047857" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Status Distribution Pie */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
            Delivery Status Breakdown
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
            Success rate across all prepared customer reminders.
          </p>

          {analytics.statusBreakdown.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              No reminder statuses recorded yet.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="48%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                  >
                    {analytics.statusBreakdown.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '10px', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Outstanding Balance Reduction Impact */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Impact on Outstanding Udhar Balance Reduction (By Batch)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compares reminded Udhar amount against payments collected afterward from those customers.
            </p>
          </div>
        </div>

        {analytics.balanceImpactByBatch.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            Send a weekly reminder batch to track Udhar recovery impact over time.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.balanceImpactByBatch}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="batchLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: unknown) => formatINR(Number(value) || 0)}
                  contentStyle={{ borderRadius: '12px', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="remindedAmount" name="Reminded Udhar (Rs.)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recoveredAmount" name="Recovered After Reminder (Rs.)" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
