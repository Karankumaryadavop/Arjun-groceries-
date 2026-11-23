import {
  CustomerTransaction,
  ExpenseRecord,
  Product,
  SaleRecord,
  SupplierTransaction,
} from '../types';
import { resolveHistoricalBaseQuantityStrict } from './inventoryEngine';

export interface CategoryProfitabilityItem {
  category: string;
  skuCount: number;
  unitsSold: number;
  billsCount: number;
  hasSalesHistory: boolean;
  avgPurchasePrice: number;
  avgSellingPrice: number;
  salesRevenue: number;
  cogs: number;
  costedRevenue: number;
  uncostedRevenue: number;
  costCoveragePct: number;
  hasCompleteCogs: boolean;
  isProfitVerified: boolean;
  reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
  grossProfit: number;
  grossMarginPct: number;
  knownCostGrossProfit: number | null;
  knownCostGrossMarginPct: number | null;
  verifiedGrossProfit: number | null;
  verifiedGrossMarginPct: number | null;
  allocatedExpenses: number;
  netProfit: number;
  netMarginPct: number;
  verifiedNetProfit: number | null;
  verifiedNetMarginPct: number | null;
  catalogMarginPct: number;
  avgHistoricalPurchaseCost: number;
}

export interface CategoryProfitabilitySummary {
  categories: CategoryProfitabilityItem[];
  totalRevenue: number;
  totalCogs: number;
  totalCostedRevenue: number;
  totalUncostedRevenue: number;
  costCoveragePct: number;
  hasCompleteCogs: boolean;
  isProfitVerified: boolean;
  reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
  totalGrossProfit: number;
  verifiedTotalGrossProfit: number | null;
  totalOperatingExpenses: number;
  totalNetProfit: number;
  overallNetMarginPct: number;
  verifiedTotalNetProfit: number | null;
  verifiedOverallNetMarginPct: number | null;
  topNetMarginCategory: CategoryProfitabilityItem | null;
  lowestNetMarginCategory: CategoryProfitabilityItem | null;
}

export interface CustomerMonthlyPaymentPoint {
  monthKey: string;
  monthShort: string;
  monthFull: string;
  paymentsReceived: number;
  creditGiven: number;
  returnsAmount: number;
  netFlow: number; // paymentsReceived - creditGiven (positive = paying down dues)
  paymentCount: number;
  creditCount: number;
}

export type CustomerCreditTrendStatus =
  | 'IMPROVING'
  | 'STEADY'
  | 'GROWING_DUES'
  | 'NO_ACTIVITY';

export interface Customer6MonthPaymentSummary {
  monthlyData: CustomerMonthlyPaymentPoint[];
  totalPayments6M: number;
  totalCredit6M: number;
  recoveryRatePct: number;
  averageMonthlyPayment: number;
  bestPaymentMonth: CustomerMonthlyPaymentPoint | null;
  creditTrend: CustomerCreditTrendStatus;
  creditTrendLabel: string;
}

export interface HistoricalDailySaleSummary {
  dateKey: string;
  displayDate: string;
  dayName: string;
  amount: number;
  billsCount: number;
}

export interface SalesForecastInputPayload {
  referenceDateKey: string;
  historyDays: HistoricalDailySaleSummary[];
  recent7DayTotal: number;
  prior7DayTotal: number;
  growthPct: number;
  avgDailySales30D: number;
  dayOfWeekAverages: Array<{ dayName: string; avgSales: number; sampleDays: number }>;
  topCategories: Array<{ category: string; revenue: number }>;
  monthlyOperatingExpenses: number;
  activeDaysCount: number;
}

export interface SalesForecastDayPoint {
  date: string;
  displayDate: string;
  dayName: string;
  predictedAmount: number;
  lowEstimate: number;
  highEstimate: number;
  driver: string;
}

export interface SalesForecastResult {
  generatedAt: string;
  source: 'GEMINI_AI';
  model: string;
  summary: string;
  trendDirection: 'UP' | 'DOWN' | 'STABLE';
  expected7DayTotal: number;
  expectedDailyAverage: number;
  confidenceNote: string;
  dailyForecast: SalesForecastDayPoint[];
  recommendations: string[];
}

function toDayKey(dateStr?: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return '';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/**
 * Calculates per-category profitability & net profit margin using historical sales lines,
 * product purchase/sale prices, weighted supplier purchase cost history, and proportional operating expenses.
 */
export function calculateCategoryProfitability(params: {
  products: Product[];
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  supplierTransactions?: SupplierTransaction[];
}): CategoryProfitabilitySummary {
  const { products, sales, expenses, supplierTransactions = [] } = params;

  const productById = new Map<string, Product>();
  const productByName = new Map<string, Product>();
  for (const p of products) {
    productById.set(p.id, p);
    if (p.name) {
      productByName.set(p.name.trim().toLowerCase(), p);
    }
  }

  // Build weighted historical purchase unit cost per product from supplier purchase history
  const purchaseHistoryCostMap = new Map<string, { totalSpend: number; totalQty: number }>();
  for (const st of supplierTransactions) {
    if (st.status === 'CANCELLED' || st.status === 'REVERSED') continue;
    if (st.type !== 'PURCHASE' || !st.productId) continue;
    const qty = Number(st.quantity) || 0;
    const unitPrice = Number(st.unitPrice);
    if (qty > 0 && Number.isFinite(unitPrice) && unitPrice >= 0) {
      const prev = purchaseHistoryCostMap.get(st.productId) || { totalSpend: 0, totalQty: 0 };
      prev.totalSpend += qty * unitPrice;
      prev.totalQty += qty;
      purchaseHistoryCostMap.set(st.productId, prev);
    }
  }

  const getEffectiveCostPrice = (prod: Product): number => {
    const hist = purchaseHistoryCostMap.get(prod.id);
    if (hist && hist.totalQty > 0) {
      return hist.totalSpend / hist.totalQty;
    }
    if (prod.lastPurchasePrice !== undefined && Number.isFinite(Number(prod.lastPurchasePrice))) {
      return Math.max(0, Number(prod.lastPurchasePrice));
    }
    return Math.max(0, Number(prod.purchasePrice) || 0);
  };

  interface Bucket {
    products: Product[];
    revenue: number;
    cogs: number;
    costedRevenue: number;
    uncostedRevenue: number;
    unreconstructibleCount: number;
    unitsSold: number;
    saleIds: Set<string>;
    unitSellSum: number;
    unitCostSum: number;
    costedItemsCount: number;
    lineItemsCount: number;
  }

  const buckets = new Map<string, Bucket>();
  const getOrCreateBucket = (categoryName: string): Bucket => {
    const clean = categoryName.trim() || 'Uncategorized';
    let b = buckets.get(clean);
    if (!b) {
      b = {
        products: [],
        revenue: 0,
        cogs: 0,
        costedRevenue: 0,
        uncostedRevenue: 0,
        unreconstructibleCount: 0,
        unitsSold: 0,
        saleIds: new Set<string>(),
        unitSellSum: 0,
        unitCostSum: 0,
        costedItemsCount: 0,
        lineItemsCount: 0,
      };
      buckets.set(clean, b);
    }
    return b;
  };

  for (const p of products) {
    if (p.isArchived) continue;
    getOrCreateBucket(p.category || 'Uncategorized').products.push(p);
  }

  for (const sale of sales) {
    if (sale.status === 'CANCELLED' || sale.status === 'REVERSED') continue;
    const items = sale.items || [];
    if (items.length === 0) {
      const saleAmt = Math.max(0, Number(sale.amount) || 0);
      if (saleAmt > 0) {
        const b = getOrCreateBucket('General Counter Sales');
        b.revenue += saleAmt;
        b.uncostedRevenue += saleAmt;
        b.unitsSold += 1;
        b.saleIds.add(sale.id);
      }
      continue;
    }

    for (const item of items) {
      const matchedProduct =
        (item.productId ? productById.get(item.productId) : undefined) ||
        (item.productName ? productByName.get(item.productName.trim().toLowerCase()) : undefined);

      const categoryName = matchedProduct?.category || 'General Counter Sales';
      const b = getOrCreateBucket(categoryName);

      const lineRevenue = Math.max(0, Number(item.total) || 0);
      const strictQty = resolveHistoricalBaseQuantityStrict({
        quantity: Number(item.quantity) || 0,
        selectedUnit: item.unit,
        historicalBaseUnit: item.baseUnit,
        explicitBaseQuantity: item.baseQuantity,
      });
      const qtyDisplay = Math.max(0, Number(item.quantity) || 1);

      const hasHistoricalSnapshot =
        item.unitCostAtSale !== undefined &&
        item.unitCostAtSale !== null &&
        Number.isFinite(Number(item.unitCostAtSale));

      b.revenue += lineRevenue;
      b.unitsSold += qtyDisplay;
      b.saleIds.add(sale.id);
      b.unitSellSum += Math.max(0, Number(item.rate) || matchedProduct?.sellingPrice || 0);
      b.lineItemsCount += 1;

      const unitCost = hasHistoricalSnapshot ? Number(item.unitCostAtSale) : NaN;
      if (!strictQty.valid) {
        b.unreconstructibleCount += 1;
        b.uncostedRevenue += lineRevenue;
      } else if (hasHistoricalSnapshot && unitCost > 0 && strictQty.baseQuantity > 0) {
        b.cogs += unitCost * strictQty.baseQuantity;
        b.costedRevenue += lineRevenue;
        b.unitCostSum += unitCost;
        b.costedItemsCount += 1;
      } else {
        b.uncostedRevenue += lineRevenue;
      }
    }
  }

  const totalOperatingExpenses = expenses.reduce((sum, exp) => {
    if (exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING') return sum;
    return sum + Math.max(0, Number(exp.amount) || 0);
  }, 0);

  const totalRevenueAll = Array.from(buckets.values()).reduce((sum, b) => sum + b.revenue, 0);

  const items: CategoryProfitabilityItem[] = Array.from(buckets.entries()).map(([category, b]) => {
    const revenue = round2(b.revenue);
    const cogs = round2(b.cogs);
    const costedRevenue = round2(b.costedRevenue);
    const uncostedRevenue = round2(Math.max(0, b.uncostedRevenue));
    const grossProfit = round2(revenue - cogs);
    const rawGrossMarginPct = revenue > 0 ? round1((grossProfit / revenue) * 100) : 0;

    const allocatedExpenses =
      totalRevenueAll > 0 && revenue > 0
        ? round2(totalOperatingExpenses * (revenue / totalRevenueAll))
        : 0;

    const netProfit = round2(grossProfit - allocatedExpenses);
    const rawNetMarginPct = revenue > 0 ? round1((netProfit / revenue) * 100) : 0;

    const hasUncosted = uncostedRevenue > 0;
    const reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW' =
      b.unreconstructibleCount > 0
        ? 'NEEDS_REVIEW'
        : hasUncosted
        ? 'UNCOSTED'
        : 'RECONCILED';
    const hasCompleteCogs = !hasUncosted && b.unreconstructibleCount === 0;
    const isProfitVerified = hasCompleteCogs && reviewStatus === 'RECONCILED';

    const rawCoveragePct = revenue > 0 ? Math.min(100, (costedRevenue / revenue) * 100) : 100;
    const costCoveragePct =
      hasUncosted && rawCoveragePct >= 100 ? 99.9 : round1(rawCoveragePct);

    const knownCostGrossProfit = costedRevenue > 0 ? round2(costedRevenue - cogs) : null;
    const knownCostGrossMarginPct =
      costedRevenue > 0 && knownCostGrossProfit !== null
        ? round1((knownCostGrossProfit / costedRevenue) * 100)
        : null;

    const verifiedGrossProfit = isProfitVerified ? grossProfit : null;
    const verifiedGrossMarginPct = isProfitVerified ? rawGrossMarginPct : null;
    const verifiedNetProfit = isProfitVerified ? netProfit : null;
    const verifiedNetMarginPct = isProfitVerified ? rawNetMarginPct : null;

    // Never report 100% gross margin from uncosted sales
    const grossMarginPct = isProfitVerified
      ? rawGrossMarginPct
      : knownCostGrossMarginPct !== null
      ? knownCostGrossMarginPct
      : 0;
    const netMarginPct = isProfitVerified ? rawNetMarginPct : 0;

    let catalogCost = 0;
    let catalogSell = 0;
    for (const p of b.products) {
      const cost = getEffectiveCostPrice(p);
      const sell = Math.max(0, Number(p.sellingPrice) || 0);
      catalogCost += cost;
      catalogSell += sell;
    }
    const catalogMarginPct =
      catalogSell > 0 ? round1(((catalogSell - catalogCost) / catalogSell) * 100) : 0;

    const avgPurchasePrice =
      b.costedItemsCount > 0
        ? round2(b.unitCostSum / b.costedItemsCount)
        : b.products.length > 0
        ? round2(catalogCost / b.products.length)
        : 0;

    const avgSellingPrice =
      b.lineItemsCount > 0
        ? round2(b.unitSellSum / b.lineItemsCount)
        : b.products.length > 0
        ? round2(catalogSell / b.products.length)
        : 0;

    const avgHistoricalPurchaseCost =
      b.products.length > 0 ? round2(catalogCost / b.products.length) : avgPurchasePrice;

    return {
      category,
      skuCount: b.products.length,
      unitsSold: round2(b.unitsSold),
      billsCount: b.saleIds.size,
      hasSalesHistory: revenue > 0,
      avgPurchasePrice,
      avgSellingPrice,
      salesRevenue: revenue,
      cogs,
      costedRevenue,
      uncostedRevenue,
      costCoveragePct,
      hasCompleteCogs,
      isProfitVerified,
      reviewStatus,
      grossProfit,
      grossMarginPct,
      knownCostGrossProfit,
      knownCostGrossMarginPct,
      verifiedGrossProfit,
      verifiedGrossMarginPct,
      allocatedExpenses,
      netProfit,
      netMarginPct,
      verifiedNetProfit,
      verifiedNetMarginPct,
      catalogMarginPct,
      avgHistoricalPurchaseCost,
    };
  });

  // Sort by netProfit descending, then netMarginPct descending, then catalogMarginPct
  items.sort((a, b) => {
    if (b.hasSalesHistory !== a.hasSalesHistory) return a.hasSalesHistory ? -1 : 1;
    if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
    return b.netMarginPct - a.netMarginPct;
  });

  const totalRevenue = round2(items.reduce((s, c) => s + c.salesRevenue, 0));
  const totalCogs = round2(items.reduce((s, c) => s + c.cogs, 0));
  const totalCostedRevenue = round2(items.reduce((s, c) => s + c.costedRevenue, 0));
  const totalUncostedRevenue = round2(items.reduce((s, c) => s + c.uncostedRevenue, 0));
  const totalGrossProfit = round2(totalRevenue - totalCogs);
  const totalNetProfit = round2(totalGrossProfit - totalOperatingExpenses);
  const rawOverallNetMarginPct =
    totalRevenue > 0 ? round1((totalNetProfit / totalRevenue) * 100) : 0;

  const totalHasUncosted = totalUncostedRevenue > 0;
  const anyNeedsReview = items.some((c) => c.reviewStatus === 'NEEDS_REVIEW');
  const reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW' = anyNeedsReview
    ? 'NEEDS_REVIEW'
    : totalHasUncosted
    ? 'UNCOSTED'
    : 'RECONCILED';
  const hasCompleteCogs = !totalHasUncosted && !anyNeedsReview;
  const isProfitVerified = hasCompleteCogs && reviewStatus === 'RECONCILED';
  const rawTotalCoverage =
    totalRevenue > 0 ? Math.min(100, (totalCostedRevenue / totalRevenue) * 100) : 100;
  const costCoveragePct =
    totalHasUncosted && rawTotalCoverage >= 100 ? 99.9 : round1(rawTotalCoverage);

  const verifiedTotalGrossProfit = isProfitVerified ? totalGrossProfit : null;
  const verifiedTotalNetProfit = isProfitVerified ? totalNetProfit : null;
  const verifiedOverallNetMarginPct = isProfitVerified ? rawOverallNetMarginPct : null;
  const overallNetMarginPct = isProfitVerified ? rawOverallNetMarginPct : 0;

  const withSales = items.filter((c) => c.hasSalesHistory);
  const verifiedWithSales = withSales.filter((c) => c.isProfitVerified);
  const rankedPool =
    verifiedWithSales.length > 0
      ? verifiedWithSales
      : withSales.length > 0
      ? withSales
      : items;
  const byMargin = [...rankedPool].sort((a, b) => {
    const mA = a.hasSalesHistory ? (a.verifiedNetMarginPct ?? a.knownCostGrossMarginPct ?? 0) : a.catalogMarginPct;
    const mB = b.hasSalesHistory ? (b.verifiedNetMarginPct ?? b.knownCostGrossMarginPct ?? 0) : b.catalogMarginPct;
    return mB - mA;
  });

  return {
    categories: items,
    totalRevenue,
    totalCogs,
    totalCostedRevenue,
    totalUncostedRevenue,
    costCoveragePct,
    hasCompleteCogs,
    isProfitVerified,
    reviewStatus,
    totalGrossProfit,
    verifiedTotalGrossProfit,
    totalOperatingExpenses: round2(totalOperatingExpenses),
    totalNetProfit,
    overallNetMarginPct,
    verifiedTotalNetProfit,
    verifiedOverallNetMarginPct,
    topNetMarginCategory: byMargin[0] || null,
    lowestNetMarginCategory: byMargin.length > 0 ? byMargin[byMargin.length - 1] : null,
  };
}

/**
 * Aggregates a customer's trailing 6 months of Payments Received vs Credit Given
 * (ignoring cancelled/reversed entries) to visualize credit repayment behavior.
 */
export function calculateCustomer6MonthPaymentHistory(
  customerId: string,
  transactions: CustomerTransaction[],
  referenceDate: Date = new Date(),
  monthsCount = 6
): Customer6MonthPaymentSummary {
  const safeCount = Math.max(1, Math.min(12, Math.floor(monthsCount)));
  const ref = isNaN(referenceDate.getTime()) ? new Date() : referenceDate;

  const monthlyData: CustomerMonthlyPaymentPoint[] = [];
  const bucketMap = new Map<string, CustomerMonthlyPaymentPoint>();

  for (let i = safeCount - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const yr = d.getFullYear();
    const mo = d.getMonth();
    const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;
    const shortMon = d.toLocaleDateString('en-IN', { month: 'short' });
    const monthShort = `${shortMon} '${String(yr).slice(-2)}`;
    const monthFull = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    const point: CustomerMonthlyPaymentPoint = {
      monthKey,
      monthShort,
      monthFull,
      paymentsReceived: 0,
      creditGiven: 0,
      returnsAmount: 0,
      netFlow: 0,
      paymentCount: 0,
      creditCount: 0,
    };
    monthlyData.push(point);
    bucketMap.set(monthKey, point);
  }

  for (const tx of transactions) {
    if (tx.customerId !== customerId) continue;
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') continue;
    const key = toMonthKey(tx.date || tx.createdAt);
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    const amt = Math.max(0, Number(tx.amount) || 0);
    if (tx.type === 'PAYMENT') {
      bucket.paymentsReceived = round2(bucket.paymentsReceived + amt);
      bucket.paymentCount += 1;
    } else if (tx.type === 'CREDIT') {
      bucket.creditGiven = round2(bucket.creditGiven + amt);
      bucket.creditCount += 1;
    } else if (tx.type === 'RETURN') {
      bucket.returnsAmount = round2(bucket.returnsAmount + amt);
    }
  }

  let bestPaymentMonth: CustomerMonthlyPaymentPoint | null = null;
  for (const b of monthlyData) {
    b.netFlow = round2(b.paymentsReceived - b.creditGiven);
    if (b.paymentsReceived > 0 && (!bestPaymentMonth || b.paymentsReceived > bestPaymentMonth.paymentsReceived)) {
      bestPaymentMonth = b;
    }
  }

  const totalPayments6M = round2(monthlyData.reduce((s, m) => s + m.paymentsReceived, 0));
  const totalCredit6M = round2(monthlyData.reduce((s, m) => s + m.creditGiven, 0));
  const recoveryRatePct =
    totalCredit6M > 0
      ? round1((totalPayments6M / totalCredit6M) * 100)
      : totalPayments6M > 0
      ? 100
      : 0;
  const averageMonthlyPayment = round2(totalPayments6M / monthlyData.length);

  let creditTrend: CustomerCreditTrendStatus = 'NO_ACTIVITY';
  let creditTrendLabel = 'No payment or credit activity in last 6 months';

  if (totalPayments6M > 0 || totalCredit6M > 0) {
    if (totalCredit6M === 0 && totalPayments6M > 0) {
      creditTrend = 'IMPROVING';
      creditTrendLabel = 'Clearing old dues (100% repayment, zero new credit)';
    } else if (recoveryRatePct >= 95) {
      creditTrend = 'IMPROVING';
      creditTrendLabel = 'Strong repayment discipline (clearing dues on time)';
    } else if (recoveryRatePct >= 65) {
      creditTrend = 'STEADY';
      creditTrendLabel = 'Moderate credit repayment (steady partial settlements)';
    } else {
      creditTrend = 'GROWING_DUES';
      creditTrendLabel = 'Credit outpacing payments — follow up recommended';
    }
  }

  return {
    monthlyData,
    totalPayments6M,
    totalCredit6M,
    recoveryRatePct,
    averageMonthlyPayment,
    bestPaymentMonth,
    creditTrend,
    creditTrendLabel,
  };
}

/**
 * Builds a compact 30-day statistical sales summary for Gemini 7-day forecast analysis.
 */
export function buildSalesForecastInputSummary(
  sales: SaleRecord[],
  expenses: ExpenseRecord[],
  products: Product[],
  referenceDateInput?: Date | string
): SalesForecastInputPayload {
  let refDate: Date;
  if (referenceDateInput) {
    refDate = new Date(referenceDateInput);
    if (isNaN(refDate.getTime())) refDate = new Date();
  } else if (sales.length > 0) {
    const timestamps = sales
      .map((s) => new Date(s.date || s.createdAt).getTime())
      .filter((t) => !isNaN(t));
    refDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();
  } else {
    refDate = new Date();
  }

  const productById = new Map<string, Product>();
  for (const p of products) productById.set(p.id, p);

  const days: Date[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(refDate);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const dayMap = new Map<string, { amount: number; billsCount: number }>();
  for (const d of days) {
    const key = toDayKey(d.toISOString());
    dayMap.set(key, { amount: 0, billsCount: 0 });
  }

  const categoryRevMap = new Map<string, number>();

  for (const s of sales) {
    if (s.status === 'CANCELLED' || s.status === 'REVERSED') continue;
    const key = toDayKey(s.date || s.createdAt);
    const amt = Math.max(0, Number(s.amount) || 0);
    if (dayMap.has(key)) {
      const bucket = dayMap.get(key)!;
      bucket.amount += amt;
      bucket.billsCount += 1;
    }
    for (const item of s.items || []) {
      const prod = item.productId ? productById.get(item.productId) : undefined;
      const cat = prod?.category || 'General';
      categoryRevMap.set(cat, (categoryRevMap.get(cat) || 0) + (Number(item.total) || 0));
    }
  }

  const historyDays: HistoricalDailySaleSummary[] = days.map((d) => {
    const key = toDayKey(d.toISOString());
    const entry = dayMap.get(key) || { amount: 0, billsCount: 0 };
    return {
      dateKey: key,
      displayDate: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      dayName: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      amount: Math.round(entry.amount),
      billsCount: entry.billsCount,
    };
  });

  const recent7DayTotal = Math.round(
    historyDays.slice(-7).reduce((s, d) => s + d.amount, 0)
  );
  const prior7DayTotal = Math.round(
    historyDays.slice(-14, -7).reduce((s, d) => s + d.amount, 0)
  );
  const growthPct =
    prior7DayTotal > 0
      ? round1(((recent7DayTotal - prior7DayTotal) / prior7DayTotal) * 100)
      : recent7DayTotal > 0
      ? 100
      : 0;

  const total30 = historyDays.reduce((s, d) => s + d.amount, 0);
  const activeDaysCount = historyDays.filter((d) => d.amount > 0).length;
  const avgDailySales30D = Math.round(total30 / 30);

  const dowBuckets = new Map<string, { total: number; count: number }>();
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (const dn of dayNames) dowBuckets.set(dn, { total: 0, count: 0 });
  for (const h of historyDays) {
    const b = dowBuckets.get(h.dayName) || { total: 0, count: 0 };
    b.total += h.amount;
    b.count += 1;
    dowBuckets.set(h.dayName, b);
  }
  const dayOfWeekAverages = dayNames.map((dayName) => {
    const b = dowBuckets.get(dayName) || { total: 0, count: 0 };
    return {
      dayName,
      avgSales: b.count > 0 ? Math.round(b.total / b.count) : 0,
      sampleDays: b.count,
    };
  });

  const topCategories = Array.from(categoryRevMap.entries())
    .map(([category, revenue]) => ({ category, revenue: Math.round(revenue) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  const monthlyOperatingExpenses = Math.round(
    expenses.reduce((s, e) => {
      if (e.isPersonalWithdrawal || e.category === 'PERSONAL_DRAWING') return s;
      return s + Math.max(0, Number(e.amount) || 0);
    }, 0)
  );

  return {
    referenceDateKey: toDayKey(refDate.toISOString()),
    historyDays,
    recent7DayTotal,
    prior7DayTotal,
    growthPct,
    avgDailySales30D,
    dayOfWeekAverages,
    topCategories,
    monthlyOperatingExpenses,
    activeDaysCount,
  };
}

/**
 * Generates the exact next 7 YYYY-MM-DD calendar slots after `referenceDateKey`.
 */
export function getNext7ForecastDates(referenceDateKey: string): Array<{
  date: string;
  displayDate: string;
  dayName: string;
}> {
  const parts = referenceDateKey.split('-').map(Number);
  const base =
    parts.length === 3 && !isNaN(parts[0])
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date();

  const out: Array<{ date: string; displayDate: string; dayName: string }> = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push({
      date: `${y}-${m}-${day}`,
      displayDate: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      dayName: d.toLocaleDateString('en-IN', { weekday: 'short' }),
    });
  }
  return out;
}

/**
 * Normalizes and validates structured Gemini 7-day sales forecast output.
 */
export function normalizeSalesForecastResponse(
  raw: Record<string, unknown>,
  referenceDateKey: string,
  model = 'gemini-4-hydrogen'
): SalesForecastResult {
  const slots = getNext7ForecastDates(referenceDateKey);
  const rawDaily = Array.isArray(raw?.dailyForecast) ? raw.dailyForecast : [];

  const dailyForecast: SalesForecastDayPoint[] = slots.map((slot, idx) => {
    const item = (rawDaily[idx] && typeof rawDaily[idx] === 'object'
      ? rawDaily[idx]
      : {}) as Record<string, unknown>;

    const predictedAmount = Math.max(0, Math.round(Number(item.predictedAmount) || 0));
    const lowEstimate = Math.max(
      0,
      Math.min(
        predictedAmount,
        Math.round(Number(item.lowEstimate) || predictedAmount * 0.85)
      )
    );
    const highEstimate = Math.max(
      predictedAmount,
      Math.round(Number(item.highEstimate) || predictedAmount * 1.15)
    );
    const driver =
      typeof item.driver === 'string' && item.driver.trim()
        ? item.driver.trim()
        : `${slot.dayName} counter demand`;

    return {
      date: slot.date,
      displayDate: slot.displayDate,
      dayName: slot.dayName,
      predictedAmount,
      lowEstimate,
      highEstimate,
      driver,
    };
  });

  const computedTotal = dailyForecast.reduce((s, d) => s + d.predictedAmount, 0);
  const expected7DayTotal =
    Number(raw?.expected7DayTotal) > 0
      ? Math.round(Number(raw.expected7DayTotal))
      : computedTotal;
  const expectedDailyAverage = Math.round(expected7DayTotal / 7);

  const rawTrend = String(raw?.trendDirection || '').toUpperCase();
  const trendDirection: 'UP' | 'DOWN' | 'STABLE' =
    rawTrend === 'UP' || rawTrend === 'DOWN' || rawTrend === 'STABLE'
      ? rawTrend
      : 'STABLE';

  const summary =
    typeof raw?.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : '7-day retail demand forecast derived from recent sales velocity and day-of-week patterns.';

  const confidenceNote =
    typeof raw?.confidenceNote === 'string' && raw.confidenceNote.trim()
      ? raw.confidenceNote.trim()
      : 'Based on historical daily counter revenue and weekly shopping cycle.';

  const recommendations = Array.isArray(raw?.recommendations)
    ? raw.recommendations
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .slice(0, 4)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    source: 'GEMINI_AI',
    model,
    summary,
    trendDirection,
    expected7DayTotal,
    expectedDailyAverage,
    confidenceNote,
    dailyForecast,
    recommendations,
  };
}
