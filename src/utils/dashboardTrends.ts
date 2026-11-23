/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomerTransaction, SaleRecord } from '../types';
import { isSaleActive, toLocalDayKey } from './accounting';
import { StockVelocityItem, StockVelocityMonitorReport } from './stockVelocity';

export interface WeeklySalesTrendPoint {
  dateKey: string; // YYYY-MM-DD (local calendar)
  shortLabel: string; // e.g. "Mon" or "15 Nov"
  fullLabel: string; // e.g. "Mon, 15 Nov"
  dailySales: number;
  movingAvg30d: number;
  billsCount: number;
}

export interface WeeklySalesTrendReport {
  points: WeeklySalesTrendPoint[];
  weeklyTotal: number;
  weeklyDailyAvg: number;
  currentMovingAvg30d: number;
  vsMovingAvgPct: number | null;
  peakDay: WeeklySalesTrendPoint | null;
  hasAnySales: boolean;
}

export interface CriticalStockWidgetData {
  criticalItems: StockVelocityItem[];
  lowStockItems: StockVelocityItem[];
  displayItems: StockVelocityItem[];
  criticalCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalActiveProducts: number;
  estimatedCriticalReorderCost: number;
}

function round2(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val * 100) / 100;
}

function makeLocalDayDate(baseDate: Date, offsetDays: number): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + offsetDays,
    12,
    0,
    0,
    0
  );
}

function formatDayKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Computes a 7-day daily net sales trend paired with each day's trailing 30-day
 * moving average of daily net sales (excluding CANCELLED/REVERSED bills and deducting
 * active customer sales returns).
 */
export function buildWeeklySalesTrendData(params: {
  sales: SaleRecord[];
  customerTransactions?: CustomerTransaction[];
  now?: Date;
}): WeeklySalesTrendReport {
  const { sales, customerTransactions = [], now = new Date() } = params;

  // Build daily net sales map over the 36-day window needed for 7 days of 30-day moving averages
  // Window spans [today - 35 days .. today] (36 days total)
  const netSalesByDay = new Map<string, number>();
  const billsCountByDay = new Map<string, number>();

  for (const sale of sales) {
    if (!isSaleActive(sale)) continue;
    const dayKey = toLocalDayKey(sale.date || sale.createdAt);
    if (!dayKey) continue;
    const amt = Number(sale.amount) || 0;
    netSalesByDay.set(dayKey, (netSalesByDay.get(dayKey) || 0) + amt);
    billsCountByDay.set(dayKey, (billsCountByDay.get(dayKey) || 0) + 1);
  }

  for (const tx of customerTransactions) {
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') continue;
    if (tx.type !== 'RETURN') continue;
    const dayKey = toLocalDayKey(tx.date || tx.createdAt);
    if (!dayKey) continue;
    const retAmt = Math.max(0, Number(tx.amount) || 0);
    netSalesByDay.set(dayKey, (netSalesByDay.get(dayKey) || 0) - retAmt);
  }

  // Generate ordered 36-day sequence: index 0 = today - 35, index 35 = today
  const totalWindowDays = 36;
  const dailySeries: { date: Date; key: string; netSales: number; billsCount: number }[] = [];
  for (let offset = -(totalWindowDays - 1); offset <= 0; offset++) {
    const dt = makeLocalDayDate(now, offset);
    const key = formatDayKeyFromDate(dt);
    const rawNet = netSalesByDay.get(key) || 0;
    dailySeries.push({
      date: dt,
      key,
      netSales: round2(Math.max(0, rawNet)),
      billsCount: billsCountByDay.get(key) || 0,
    });
  }

  // Build prefix sums for O(1) exact 30-day moving average for each of the last 7 days
  const prefixSums: number[] = new Array(totalWindowDays + 1).fill(0);
  for (let i = 0; i < totalWindowDays; i++) {
    prefixSums[i + 1] = prefixSums[i] + dailySeries[i].netSales;
  }

  const points: WeeklySalesTrendPoint[] = [];
  for (let idx = totalWindowDays - 7; idx < totalWindowDays; idx++) {
    const entry = dailySeries[idx];
    const windowStart = Math.max(0, idx - 29);
    const rolling30Sum = prefixSums[idx + 1] - prefixSums[windowStart];
    const movingAvg30d = round2(rolling30Sum / 30);

    const shortLabel = entry.date.toLocaleDateString('en-IN', { weekday: 'short' });
    const fullLabel = entry.date.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

    points.push({
      dateKey: entry.key,
      shortLabel,
      fullLabel,
      dailySales: entry.netSales,
      movingAvg30d,
      billsCount: entry.billsCount,
    });
  }

  const weeklyTotal = round2(points.reduce((sum, p) => sum + p.dailySales, 0));
  const weeklyDailyAvg = round2(weeklyTotal / 7);
  const currentMovingAvg30d = points[points.length - 1]?.movingAvg30d ?? 0;

  let vsMovingAvgPct: number | null = null;
  if (currentMovingAvg30d > 0) {
    vsMovingAvgPct = Math.round(((weeklyDailyAvg - currentMovingAvg30d) / currentMovingAvg30d) * 100);
  }

  let peakDay: WeeklySalesTrendPoint | null = null;
  for (const p of points) {
    if (p.dailySales > 0 && (!peakDay || p.dailySales > peakDay.dailySales)) {
      peakDay = p;
    }
  }

  const hasAnySales = weeklyTotal > 0 || currentMovingAvg30d > 0;

  return {
    points,
    weeklyTotal,
    weeklyDailyAvg,
    currentMovingAvg30d,
    vsMovingAvgPct,
    peakDay,
    hasAnySales,
  };
}

/**
 * Computes a bounded 0–100 stock-cover percentage for visual progress bars inside
 * the Critical Stock dashboard widget.
 */
export function computeStockCoverGaugePct(
  item: StockVelocityItem,
  reorderLeadDays = 7,
  lowStockWarningDays = 14
): number {
  if (item.currentStock <= 0) return 0;
  if (item.daysOfStockLeft !== null && Number.isFinite(item.daysOfStockLeft)) {
    const scaleDays = Math.max(lowStockWarningDays, reorderLeadDays * 2, 14);
    return Math.max(4, Math.min(100, Math.round((item.daysOfStockLeft / scaleDays) * 100)));
  }
  if (item.minStockAlert > 0) {
    return Math.max(4, Math.min(100, Math.round((item.currentStock / (item.minStockAlert * 1.5)) * 100)));
  }
  return item.flag === 'REORDER' ? 15 : item.flag === 'LOW_STOCK' ? 45 : 100;
}

/**
 * Extracts prioritized Critical Stock ('REORDER') and Low Stock items from the
 * 30-day sales velocity report for the Dashboard widget.
 */
export function getCriticalStockWidgetData(
  report: StockVelocityMonitorReport,
  maxDisplayItems = 5
): CriticalStockWidgetData {
  const criticalItems = report.items.filter((i) => i.flag === 'REORDER');
  const lowStockItems = report.items.filter((i) => i.flag === 'LOW_STOCK');

  const displayItems = [...criticalItems, ...lowStockItems].slice(0, maxDisplayItems);
  const estimatedCriticalReorderCost = criticalItems.reduce(
    (sum, item) => sum + item.estimatedReorderCost,
    0
  );

  return {
    criticalItems,
    lowStockItems,
    displayItems,
    criticalCount: criticalItems.length,
    lowStockCount: lowStockItems.length,
    outOfStockCount: report.summary.outOfStockCount,
    totalActiveProducts: report.summary.totalActiveProducts,
    estimatedCriticalReorderCost,
  };
}
