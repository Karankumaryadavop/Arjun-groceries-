import { ExpenseRecord } from '../types';

export interface MonthlyOperatingExpensePoint {
  monthKey: string; // YYYY-MM
  monthShort: string; // e.g. "Nov '26"
  monthFull: string; // e.g. "November 2026"
  operatingTotal: number;
  drawingsTotal: number;
  entriesCount: number;
  shop: number;
  staff: number;
  electricity: number;
  transport: number;
  meals: number;
  other: number;
}

export interface SixMonthExpenseSummary {
  monthlyData: MonthlyOperatingExpensePoint[];
  sixMonthOperatingTotal: number;
  sixMonthDrawingsTotal: number;
  averageMonthlyOperating: number;
  peakMonth: MonthlyOperatingExpensePoint;
  currentMonthTotal: number;
  previousMonthTotal: number;
  momChangePct: number;
  totalEntriesCount: number;
}

function toMonthKey(dateStr?: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 7);
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return '';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Aggregates business operating expenses (strictly excluding owner personal drawings)
 * over the trailing `monthsCount` calendar months ending in `referenceDate`'s month.
 */
export function calculateMonthlyOperatingExpensesChart(
  expenses: ExpenseRecord[],
  referenceDate: Date = new Date(),
  monthsCount = 6
): SixMonthExpenseSummary {
  const safeCount = Math.max(1, Math.min(24, Math.floor(monthsCount)));
  const ref = isNaN(referenceDate.getTime()) ? new Date() : referenceDate;

  const buckets: MonthlyOperatingExpensePoint[] = [];
  const bucketMap = new Map<string, MonthlyOperatingExpensePoint>();

  for (let i = safeCount - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const year = d.getFullYear();
    const monthIdx = d.getMonth();
    const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    const shortMon = d.toLocaleDateString('en-IN', { month: 'short' });
    const shortYr = String(year).slice(-2);
    const monthShort = `${shortMon} '${shortYr}`;
    const monthFull = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    const point: MonthlyOperatingExpensePoint = {
      monthKey,
      monthShort,
      monthFull,
      operatingTotal: 0,
      drawingsTotal: 0,
      entriesCount: 0,
      shop: 0,
      staff: 0,
      electricity: 0,
      transport: 0,
      meals: 0,
      other: 0,
    };
    buckets.push(point);
    bucketMap.set(monthKey, point);
  }

  for (const exp of expenses) {
    const key = toMonthKey(exp.date || exp.createdAt);
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    const amt = Math.max(0, Number(exp.amount) || 0);
    if (exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING') {
      bucket.drawingsTotal = Math.round((bucket.drawingsTotal + amt) * 100) / 100;
      continue;
    }

    bucket.operatingTotal = Math.round((bucket.operatingTotal + amt) * 100) / 100;
    bucket.entriesCount += 1;

    switch (exp.category) {
      case 'SHOP':
        bucket.shop = Math.round((bucket.shop + amt) * 100) / 100;
        break;
      case 'STAFF':
        bucket.staff = Math.round((bucket.staff + amt) * 100) / 100;
        break;
      case 'ELECTRICITY':
        bucket.electricity = Math.round((bucket.electricity + amt) * 100) / 100;
        break;
      case 'TRANSPORT':
        bucket.transport = Math.round((bucket.transport + amt) * 100) / 100;
        break;
      case 'BREAKFAST':
      case 'LUNCH':
      case 'DINNER':
        bucket.meals = Math.round((bucket.meals + amt) * 100) / 100;
        break;
      default:
        bucket.other = Math.round((bucket.other + amt) * 100) / 100;
        break;
    }
  }

  const sixMonthOperatingTotal =
    Math.round(buckets.reduce((s, b) => s + b.operatingTotal, 0) * 100) / 100;
  const sixMonthDrawingsTotal =
    Math.round(buckets.reduce((s, b) => s + b.drawingsTotal, 0) * 100) / 100;
  const averageMonthlyOperating =
    Math.round((sixMonthOperatingTotal / buckets.length) * 100) / 100;
  const totalEntriesCount = buckets.reduce((s, b) => s + b.entriesCount, 0);

  let peakMonth = buckets[0];
  for (const b of buckets) {
    if (b.operatingTotal > peakMonth.operatingTotal) {
      peakMonth = b;
    }
  }

  const currentMonthTotal = buckets[buckets.length - 1]?.operatingTotal ?? 0;
  const previousMonthTotal =
    buckets.length >= 2 ? buckets[buckets.length - 2]?.operatingTotal ?? 0 : 0;

  let momChangePct = 0;
  if (previousMonthTotal > 0) {
    momChangePct = Math.round(((currentMonthTotal - previousMonthTotal) / previousMonthTotal) * 1000) / 10;
  } else if (currentMonthTotal > 0) {
    momChangePct = 100;
  }

  return {
    monthlyData: buckets,
    sixMonthOperatingTotal,
    sixMonthDrawingsTotal,
    averageMonthlyOperating,
    peakMonth,
    currentMonthTotal,
    previousMonthTotal,
    momChangePct,
    totalEntriesCount,
  };
}
