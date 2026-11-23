import {
  CashbookEntry,
  Customer,
  CustomerLedgerEntry,
  CustomerLedgerSummary,
  CustomerTransaction,
  ExpenseRecord,
  LedgerFilterOptions,
  Product,
  RecurringExpense,
  RecurringExpenseFrequency,
  SaleRecord,
  StockAdjustmentRecord,
  Supplier,
  SupplierLedgerEntry,
  SupplierLedgerSummary,
  SupplierTransaction,
} from '../types';
import { matchOriginalSaleLine, resolveHistoricalBaseQuantityStrict } from './inventoryEngine';

/**
 * Formats a number in Indian Numbering System (Lakhs, Crores)
 * e.g. 125000 -> ₹1,25,000
 */
export function formatINR(amount: number, showSymbol = true): string {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(absAmount);

  const prefix = isNegative ? '- ' : '';
  const symbol = showSymbol ? '₹' : '';
  return `${prefix}${symbol}${formatted}`;
}

/**
 * Formats a Date or date-string into a canonical local calendar YYYY-MM-DD key
 * without shifting days across UTC midnight.
 */
export function toLocalDayKey(input: Date | string | undefined | null): string {
  if (!input) return '';
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return '';
    const y = input.getFullYear();
    const m = String(input.getMonth() + 1).padStart(2, '0');
    const d = String(input.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const trimmed = String(input).trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : '';
  }
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getLocalTodayKey(refNow: Date = new Date()): string {
  return toLocalDayKey(refNow);
}

export function getLocalYesterdayKey(refNow: Date = new Date()): string {
  const y = new Date(refNow.getFullYear(), refNow.getMonth(), refNow.getDate() - 1);
  return toLocalDayKey(y);
}

/**
 * Produces a local-timezone ISO-8601 timestamp string (e.g. 2026-11-16T10:30:00+05:30)
 * so leading YYYY-MM-DD always matches the user's local calendar day.
 */
export function toLocalDateTimeIso(dateInput?: string | Date, refNow: Date = new Date()): string {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const base =
    typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())
      ? (() => {
          const [yr, mo, dy] = dateInput.trim().split('-').map(Number);
          return new Date(
            yr,
            (mo || 1) - 1,
            dy || 1,
            refNow.getHours(),
            refNow.getMinutes(),
            refNow.getSeconds()
          );
        })()
      : dateInput instanceof Date
      ? dateInput
      : refNow;

  const d = isNaN(base.getTime()) ? new Date() : base;
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absOff = Math.abs(offsetMin);
  const offH = String(Math.floor(absOff / 60)).padStart(2, '0');
  const offM = String(absOff % 60).padStart(2, '0');
  return `${yr}-${mo}-${dy}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`;
}

export function isSaleActive(sale: Pick<SaleRecord, 'status'>): boolean {
  return sale.status !== 'CANCELLED' && sale.status !== 'REVERSED';
}

export function isCashbookEntryActive(entry: Pick<CashbookEntry, 'status'>): boolean {
  return entry.status !== 'CANCELLED' && entry.status !== 'REVERSED';
}

/**
 * Strictly calculates cash balance across active cashbook entries:
 * Closing Cash = Opening Cash + Cash Inflows - Cash Outflows
 */
export function calculateCashbookSummary(
  openingCash: number,
  entries: CashbookEntry[]
): {
  openingCash: number;
  totalInflows: number;
  totalOutflows: number;
  closingCash: number;
} {
  let totalInflows = 0;
  let totalOutflows = 0;

  for (const entry of entries) {
    if (!isCashbookEntryActive(entry)) continue;
    if (entry.type === 'IN') {
      totalInflows += Number(entry.amount) || 0;
    } else if (entry.type === 'OUT') {
      totalOutflows += Number(entry.amount) || 0;
    }
  }

  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const closingCash = round(openingCash + totalInflows - totalOutflows);

  return {
    openingCash: round(openingCash),
    totalInflows: round(totalInflows),
    totalOutflows: round(totalOutflows),
    closingCash,
  };
}

export function getFilterStartDayKey(
  range: LedgerFilterOptions['dateRange'],
  customStart?: string,
  referenceNow: Date = new Date()
): string | null {
  if (range === 'ALL') return null;
  if (range === 'TODAY') return getLocalTodayKey(referenceNow);
  if (range === 'YESTERDAY') return getLocalYesterdayKey(referenceNow);
  if (range === 'LAST_7_DAYS') {
    return toLocalDayKey(
      new Date(referenceNow.getFullYear(), referenceNow.getMonth(), referenceNow.getDate() - 6)
    );
  }
  if (range === 'LAST_30_DAYS') {
    return toLocalDayKey(
      new Date(referenceNow.getFullYear(), referenceNow.getMonth(), referenceNow.getDate() - 29)
    );
  }
  if (range === 'THIS_MONTH') {
    return `${getLocalTodayKey(referenceNow).slice(0, 7)}-01`;
  }
  if (range === 'LAST_MONTH') {
    const firstLast = new Date(referenceNow.getFullYear(), referenceNow.getMonth() - 1, 1);
    return toLocalDayKey(firstLast);
  }
  if (range === 'CUSTOM') {
    return customStart ? toLocalDayKey(customStart) || null : null;
  }
  return null;
}

/**
 * Sums net active cashbook movements strictly before `startDayKey`
 * so filtered periods always carry forward accurate Opening Cash.
 */
export function calculateOpeningCashBeforeDayKey(
  allEntries: CashbookEntry[],
  startDayKey: string | null
): number {
  if (!startDayKey) return 0;
  let balance = 0;
  for (const entry of allEntries) {
    if (!isCashbookEntryActive(entry)) continue;
    const dayKey = toLocalDayKey(entry.date || entry.createdAt);
    if (!dayKey || dayKey >= startDayKey) continue;
    const amt = Number(entry.amount) || 0;
    if (entry.type === 'IN') balance += amt;
    else if (entry.type === 'OUT') balance -= amt;
  }
  return Math.round((balance + Number.EPSILON) * 100) / 100;
}

export function calculateOpeningCashBeforeRange(
  allEntries: CashbookEntry[],
  range: LedgerFilterOptions['dateRange'],
  customStart?: string,
  referenceNow: Date = new Date()
): number {
  const startDay = getFilterStartDayKey(range, customStart, referenceNow);
  return calculateOpeningCashBeforeDayKey(allEntries, startDay);
}

/**
 * Calculates Profit & Loss accurately without fabricating fake 85% margins:
 * - Excludes CANCELLED / REVERSED bills
 * - Deducts active Customer RETURN credits & returns their mapped COGS
 * - Uses normalized baseQuantity for unit-accurate COGS
 * - Separates costed revenue vs uncosted revenue transparently
 * - Excludes personal drawings from operating expenses
 */
export function calculateProfitAndLoss(
  sales: SaleRecord[],
  expenses: ExpenseRecord[],
  _productsMap: Map<string, Product>,
  customerTransactions: CustomerTransaction[] = []
): {
  grossRevenue: number;
  salesReturns: number;
  totalRevenue: number;
  cashRevenue: number;
  creditRevenue: number;
  upiRevenue: number;
  bankRevenue: number;
  cogs: number;
  costedRevenue: number;
  uncostedRevenue: number;
  uncostedItemsCount: number;
  missingHistoricalCostItemsCount: number;
  missingHistoricalCostRevenue: number;
  uncostedSaleIds: string[];
  uncostedReturnsCount: number;
  uncostedReturnsAmount: number;
  uncostedReturnIds: string[];
  unreconstructibleUnitItemsCount: number;
  unreconstructibleUnitItemIds: string[];
  ambiguousReturnsCount: number;
  ambiguousReturnIds: string[];
  reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
  profitStatus: 'VERIFIED' | 'PROVISIONAL_PARTIAL' | 'UNCOSTED' | 'NEEDS_REVIEW';
  isProfitVerified: boolean;
  costCoveragePct: number;
  hasCompleteCogs: boolean;
  grossProfit: number;
  grossMarginPct: number;
  costedNetRevenue: number;
  knownCostGrossProfit: number | null;
  knownCostGrossMarginPct: number | null;
  verifiedGrossProfit: number | null;
  verifiedGrossMarginPct: number | null;
  operatingExpenses: number;
  personalDrawings: number;
  netOperatingProfit: number;
  netMarginPct: number;
  verifiedNetOperatingProfit: number | null;
  verifiedNetMarginPct: number | null;
} {
  let grossRevenue = 0;
  let cashRevenue = 0;
  let creditRevenue = 0;
  let upiRevenue = 0;
  let bankRevenue = 0;
  let knownCogs = 0;
  let costedRevenue = 0;
  let costedReturnsAmount = 0;
  let uncostedRevenue = 0;
  let uncostedItemsCount = 0;
  let missingHistoricalCostItemsCount = 0;
  let missingHistoricalCostRevenue = 0;
  const uncostedSaleIdSet = new Set<string>();
  let uncostedReturnsCount = 0;
  let uncostedReturnsAmount = 0;
  const uncostedReturnIdSet = new Set<string>();
  let unreconstructibleUnitItemsCount = 0;
  const unreconstructibleUnitItemIdSet = new Set<string>();
  const ambiguousReturnIdSet = new Set<string>();

  for (const sale of sales) {
    if (!isSaleActive(sale)) continue;

    const saleAmt = Number(sale.amount) || 0;
    grossRevenue += saleAmt;

    if (sale.paymentMethod === 'CASH') cashRevenue += saleAmt;
    else if (sale.paymentMethod === 'CREDIT' || sale.isCredit) creditRevenue += saleAmt;
    else if (sale.paymentMethod === 'UPI') upiRevenue += saleAmt;
    else if (sale.paymentMethod === 'BANK') bankRevenue += saleAmt;
    else cashRevenue += saleAmt;

    if (sale.items && sale.items.length > 0) {
      let billLinesCostSum = 0;
      let billLinesRevenueSum = 0;
      let billCostedRevenueSum = 0;
      let billUncostedRevenueSum = 0;

      for (const item of sale.items) {
        const lineRevenue =
          Number(item.total) ||
          Math.max(0, (Number(item.rate) || 0) * (Number(item.quantity) || 1) - (Number(item.discount) || 0));
        billLinesRevenueSum += lineRevenue;

        const hasHistoricalCostSnapshot =
          item.unitCostAtSale !== undefined &&
          item.unitCostAtSale !== null &&
          Number.isFinite(Number(item.unitCostAtSale));
        const unitCost = hasHistoricalCostSnapshot ? Number(item.unitCostAtSale) : NaN;

        const strictBaseQty = resolveHistoricalBaseQuantityStrict({
          quantity: Number(item.quantity) || 0,
          selectedUnit: item.unit,
          historicalBaseUnit: item.baseUnit,
          explicitBaseQuantity: item.baseQuantity,
        });

        if (!strictBaseQty.valid) {
          uncostedItemsCount += 1;
          billUncostedRevenueSum += lineRevenue;
          unreconstructibleUnitItemsCount += 1;
          unreconstructibleUnitItemIdSet.add(sale.id);
          uncostedSaleIdSet.add(sale.id);
          if (!hasHistoricalCostSnapshot) {
            missingHistoricalCostItemsCount += 1;
            missingHistoricalCostRevenue += lineRevenue;
          }
        } else if (hasHistoricalCostSnapshot && unitCost > 0) {
          billLinesCostSum += unitCost * strictBaseQty.baseQuantity;
          billCostedRevenueSum += lineRevenue;
        } else {
          uncostedItemsCount += 1;
          billUncostedRevenueSum += lineRevenue;
          uncostedSaleIdSet.add(sale.id);
          if (!hasHistoricalCostSnapshot) {
            missingHistoricalCostItemsCount += 1;
            missingHistoricalCostRevenue += lineRevenue;
          }
        }
      }

      // Guard if line totals differ slightly from sale.amount
      const unallocatedDiff = saleAmt - billLinesRevenueSum;
      knownCogs += billLinesCostSum;
      costedRevenue += billCostedRevenueSum;
      uncostedRevenue += billUncostedRevenueSum + (Math.abs(unallocatedDiff) > 0.01 ? unallocatedDiff : 0);
    } else {
      // No itemized SKUs -> do NOT fabricate an 85% margin; flag as uncosted revenue
      uncostedItemsCount += 1;
      uncostedRevenue += saleAmt;
      uncostedSaleIdSet.add(sale.id);
    }
  }

  let salesReturns = 0;
  let returnedCogs = 0;

  for (const tx of customerTransactions) {
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') continue;
    if (tx.type !== 'RETURN') continue;
    const retAmt = Math.max(0, Number(tx.amount) || 0);
    salesReturns += retAmt;

    const txFlaggedManualReview =
      Boolean(tx.needsManualReview) ||
      tx.returnMatchStatus === 'AMBIGUOUS_SALE_LINE' ||
      tx.returnMatchStatus === 'UNMATCHED_SALE_LINE' ||
      tx.returnMatchStatus === 'CANCELLED_ORIGINAL_SALE';

    if (txFlaggedManualReview) {
      ambiguousReturnIdSet.add(tx.id);
      uncostedReturnsCount += 1;
      uncostedReturnsAmount += retAmt;
      uncostedReturnIdSet.add(tx.id);
      continue;
    }

    if (tx.items && tx.items.length > 0) {
      let hasAnyUncostedLine = false;
      for (const it of tx.items) {
        const lineFlagged =
          it.returnMatchStatus === 'AMBIGUOUS_SALE_LINE' ||
          it.returnMatchStatus === 'UNMATCHED_SALE_LINE' ||
          it.returnMatchStatus === 'CANCELLED_ORIGINAL_SALE';

        const match = matchOriginalSaleLine({
          sales,
          invoiceNo: tx.invoiceNo,
          saleLineId: it.saleLineId || tx.saleLineId,
          productId: it.productId,
          productName: it.productName,
        });

        const hasUnresolvedInvoiceMatch =
          lineFlagged ||
          match.status === 'AMBIGUOUS_SALE_LINE' ||
          match.status === 'CANCELLED_ORIGINAL_SALE' ||
          (Boolean((tx.invoiceNo || '').trim() || (it.saleLineId || tx.saleLineId || '').trim()) &&
            match.status === 'UNMATCHED_SALE_LINE');

        if (hasUnresolvedInvoiceMatch) {
          ambiguousReturnIdSet.add(tx.id);
          hasAnyUncostedLine = true;
          continue;
        }

        const origLine = match.status === 'MATCHED_LINE' ? match.matchedLine : undefined;
        const rawCost =
          origLine?.unitCostAtSale !== undefined &&
          origLine?.unitCostAtSale !== null &&
          Number.isFinite(Number(origLine.unitCostAtSale))
            ? origLine.unitCostAtSale
            : it.unitCostAtSale;
        const hasReturnSnapshot =
          rawCost !== undefined && rawCost !== null && Number.isFinite(Number(rawCost));
        const cost = hasReturnSnapshot ? Number(rawCost) : NaN;

        const historicalBaseUnit =
          origLine?.baseUnit && origLine.baseUnit.trim()
            ? origLine.baseUnit
            : it.baseUnit && it.baseUnit.trim()
            ? it.baseUnit
            : undefined;

        const strictQty = resolveHistoricalBaseQuantityStrict({
          quantity: Number(it.quantity) || 0,
          selectedUnit: it.unit,
          historicalBaseUnit,
          explicitBaseQuantity: it.baseQuantity,
        });

        if (!strictQty.valid) {
          unreconstructibleUnitItemsCount += 1;
          unreconstructibleUnitItemIdSet.add(tx.id);
          hasAnyUncostedLine = true;
        } else if (hasReturnSnapshot && cost > 0) {
          returnedCogs += cost * strictQty.baseQuantity;
        } else {
          hasAnyUncostedLine = true;
        }
      }
      if (hasAnyUncostedLine) {
        uncostedReturnsCount += 1;
        uncostedReturnsAmount += retAmt;
        uncostedReturnIdSet.add(tx.id);
      } else {
        costedReturnsAmount += retAmt;
      }
    } else if (tx.productId && tx.quantity && tx.quantity > 0) {
      const match = matchOriginalSaleLine({
        sales,
        invoiceNo: tx.invoiceNo,
        saleLineId: tx.saleLineId,
        productId: tx.productId,
      });

      const hasUnresolvedInvoiceMatch =
        match.status === 'AMBIGUOUS_SALE_LINE' ||
        match.status === 'CANCELLED_ORIGINAL_SALE' ||
        (Boolean((tx.invoiceNo || '').trim() || (tx.saleLineId || '').trim()) &&
          match.status === 'UNMATCHED_SALE_LINE');

      if (hasUnresolvedInvoiceMatch) {
        ambiguousReturnIdSet.add(tx.id);
        uncostedReturnsCount += 1;
        uncostedReturnsAmount += retAmt;
        uncostedReturnIdSet.add(tx.id);
        continue;
      }

      const origLine = match.status === 'MATCHED_LINE' ? match.matchedLine : undefined;
      const rawCost =
        origLine?.unitCostAtSale !== undefined &&
        origLine?.unitCostAtSale !== null &&
        Number.isFinite(Number(origLine.unitCostAtSale))
          ? origLine.unitCostAtSale
          : tx.unitCostAtSale;
      const hasReturnSnapshot =
        rawCost !== undefined && rawCost !== null && Number.isFinite(Number(rawCost));
      const cost = hasReturnSnapshot ? Number(rawCost) : NaN;

      const historicalBaseUnit =
        origLine?.baseUnit && origLine.baseUnit.trim()
          ? origLine.baseUnit
          : tx.baseUnit && tx.baseUnit.trim()
          ? tx.baseUnit
          : undefined;

      const strictQty = resolveHistoricalBaseQuantityStrict({
        quantity: Number(tx.quantity),
        selectedUnit: tx.unit,
        historicalBaseUnit,
        explicitBaseQuantity: tx.baseQuantity,
      });

      if (!strictQty.valid) {
        unreconstructibleUnitItemsCount += 1;
        unreconstructibleUnitItemIdSet.add(tx.id);
        uncostedReturnsCount += 1;
        uncostedReturnsAmount += retAmt;
        uncostedReturnIdSet.add(tx.id);
      } else if (hasReturnSnapshot && cost > 0) {
        returnedCogs += cost * strictQty.baseQuantity;
        costedReturnsAmount += retAmt;
      } else {
        uncostedReturnsCount += 1;
        uncostedReturnsAmount += retAmt;
        uncostedReturnIdSet.add(tx.id);
      }
    } else {
      if (tx.invoiceNo && tx.invoiceNo.trim()) {
        const invMatch = matchOriginalSaleLine({ sales, invoiceNo: tx.invoiceNo });
        if (invMatch.status === 'CANCELLED_ORIGINAL_SALE') {
          ambiguousReturnIdSet.add(tx.id);
        }
      }
      uncostedReturnsCount += 1;
      uncostedReturnsAmount += retAmt;
      uncostedReturnIdSet.add(tx.id);
    }
  }

  // Operating Expenses strictly exclude personal drawings
  let operatingExpenses = 0;
  let personalDrawings = 0;

  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0;
    if (exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING') {
      personalDrawings += amt;
    } else {
      operatingExpenses += amt;
    }
  }

  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const netSalesRevenue = r2(grossRevenue - salesReturns);
  const netCogs = r2(Math.max(0, knownCogs - returnedCogs));
  const grossProfit = r2(netSalesRevenue - netCogs);
  const netOperatingProfit = r2(grossProfit - operatingExpenses);
  const ambiguousReturnsCount = ambiguousReturnIdSet.size;
  const hasCompleteCogs =
    uncostedItemsCount === 0 &&
    r2(uncostedRevenue) <= 0 &&
    uncostedReturnsCount === 0 &&
    unreconstructibleUnitItemsCount === 0 &&
    ambiguousReturnsCount === 0;
  const reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW' =
    unreconstructibleUnitItemsCount > 0 || uncostedReturnsCount > 0 || ambiguousReturnsCount > 0
      ? 'NEEDS_REVIEW'
      : uncostedItemsCount > 0 || r2(uncostedRevenue) > 0
      ? 'UNCOSTED'
      : 'RECONCILED';

  const rawCoveragePct =
    grossRevenue > 0 ? Math.min(100, (costedRevenue / grossRevenue) * 100) : 100;
  const costCoveragePct =
    r2(uncostedRevenue) > 0 && rawCoveragePct >= 100
      ? 99.9
      : Number(rawCoveragePct.toFixed(1));

  const isProfitVerified = hasCompleteCogs && reviewStatus === 'RECONCILED';
  const profitStatus: 'VERIFIED' | 'PROVISIONAL_PARTIAL' | 'UNCOSTED' | 'NEEDS_REVIEW' =
    reviewStatus === 'NEEDS_REVIEW'
      ? 'NEEDS_REVIEW'
      : !hasCompleteCogs && (r2(costedRevenue) <= 0 || costCoveragePct <= 0)
      ? 'UNCOSTED'
      : !hasCompleteCogs
      ? 'PROVISIONAL_PARTIAL'
      : 'VERIFIED';

  const costedNetRevenue = r2(Math.max(0, costedRevenue - costedReturnsAmount));
  const knownCostGrossProfit =
    r2(costedRevenue) > 0 ? r2(costedNetRevenue - netCogs) : null;
  const knownCostGrossMarginPct =
    costedNetRevenue > 0 && knownCostGrossProfit !== null
      ? Number(((knownCostGrossProfit / costedNetRevenue) * 100).toFixed(2))
      : null;

  const rawFullGrossMarginPct =
    netSalesRevenue > 0 ? Number(((grossProfit / netSalesRevenue) * 100).toFixed(2)) : 0;
  const rawFullNetMarginPct =
    netSalesRevenue > 0 ? Number(((netOperatingProfit / netSalesRevenue) * 100).toFixed(2)) : 0;

  const verifiedGrossProfit = isProfitVerified ? grossProfit : null;
  const verifiedGrossMarginPct = isProfitVerified ? rawFullGrossMarginPct : null;
  const verifiedNetOperatingProfit = isProfitVerified ? netOperatingProfit : null;
  const verifiedNetMarginPct = isProfitVerified ? rawFullNetMarginPct : null;

  // Never report 100% margin from uncosted sales as if missing historical cost were ₹0
  const grossMarginPct = isProfitVerified
    ? rawFullGrossMarginPct
    : knownCostGrossMarginPct !== null
    ? knownCostGrossMarginPct
    : 0;
  const netMarginPct = isProfitVerified ? rawFullNetMarginPct : 0;

  return {
    grossRevenue: r2(grossRevenue),
    salesReturns: r2(salesReturns),
    totalRevenue: netSalesRevenue,
    cashRevenue: r2(cashRevenue),
    creditRevenue: r2(creditRevenue),
    upiRevenue: r2(upiRevenue),
    bankRevenue: r2(bankRevenue),
    cogs: netCogs,
    costedRevenue: r2(costedRevenue),
    uncostedRevenue: r2(Math.max(0, uncostedRevenue)),
    uncostedItemsCount,
    missingHistoricalCostItemsCount,
    missingHistoricalCostRevenue: r2(missingHistoricalCostRevenue),
    uncostedSaleIds: Array.from(uncostedSaleIdSet),
    uncostedReturnsCount,
    uncostedReturnsAmount: r2(uncostedReturnsAmount),
    uncostedReturnIds: Array.from(uncostedReturnIdSet),
    unreconstructibleUnitItemsCount,
    unreconstructibleUnitItemIds: Array.from(unreconstructibleUnitItemIdSet),
    ambiguousReturnsCount,
    ambiguousReturnIds: Array.from(ambiguousReturnIdSet),
    reviewStatus,
    profitStatus,
    isProfitVerified,
    costCoveragePct,
    hasCompleteCogs,
    grossProfit,
    grossMarginPct,
    costedNetRevenue,
    knownCostGrossProfit,
    knownCostGrossMarginPct,
    verifiedGrossProfit,
    verifiedGrossMarginPct,
    operatingExpenses: r2(operatingExpenses),
    personalDrawings: r2(personalDrawings),
    netOperatingProfit,
    netMarginPct,
    verifiedNetOperatingProfit,
    verifiedNetMarginPct,
  };
}

/**
 * Calculates Customer Receivables & Aging analysis
 * Aging buckets: 0-30 days, 31-60 days, 61-90 days, 91-180 days, 181+ days
 */
export function calculateCustomerAging(
  customers: Customer[],
  referenceDateStr = new Date().toISOString()
): {
  totalReceivables: number;
  totalCustomersWithDues: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket91to180: number;
  bucket181plus: number;
  topOverdueCustomers: Customer[];
} {
  let totalReceivables = 0;
  let totalCustomersWithDues = 0;
  let bucket0to30 = 0;
  let bucket31to60 = 0;
  let bucket61to90 = 0;
  let bucket91to180 = 0;
  let bucket181plus = 0;

  const refDate = new Date(referenceDateStr).getTime();

  const overdueList: Customer[] = [];

  for (const customer of customers) {
    const bal = Number(customer.currentBalance) || 0;
    if (bal > 0) {
      totalReceivables += bal;
      totalCustomersWithDues += 1;
      overdueList.push(customer);

      const days = customer.overdueDays || calculateOverdueDays(customer.lastTransactionDate, referenceDateStr);

      if (days <= 30) bucket0to30 += bal;
      else if (days <= 60) bucket31to60 += bal;
      else if (days <= 90) bucket61to90 += bal;
      else if (days <= 180) bucket91to180 += bal;
      else bucket181plus += bal;
    }
  }

  // Sort descending by current balance
  overdueList.sort((a, b) => b.currentBalance - a.currentBalance);

  return {
    totalReceivables,
    totalCustomersWithDues,
    bucket0to30,
    bucket31to60,
    bucket61to90,
    bucket91to180,
    bucket181plus,
    topOverdueCustomers: overdueList.slice(0, 10),
  };
}

/**
 * Calculates days difference from last transaction or reference date
 */
export function calculateOverdueDays(
  lastDateStr?: string,
  referenceDateStr = new Date().toISOString()
): number {
  if (!lastDateStr) return 0;
  const lastTime = new Date(lastDateStr).getTime();
  const refTime = new Date(referenceDateStr).getTime();
  if (isNaN(lastTime)) return 0;
  const diffDays = Math.floor((refTime - lastTime) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Calculates total inventory valuation:
 * Purchase Value = Σ(stockQty * purchasePrice)
 * Retail Sales Value = Σ(stockQty * sellingPrice)
 * Potential Profit = Retail Value - Purchase Value
 */
export function calculateInventoryValuation(products: Product[]): {
  totalItems: number;
  totalQuantity: number;
  totalCostValue: number;
  totalRetailValue: number;
  potentialProfit: number;
  lowStockItemsCount: number;
} {
  let totalQuantity = 0;
  let totalCostValue = 0;
  let totalRetailValue = 0;
  let lowStockItemsCount = 0;

  const activeProducts = products.filter((p) => !p.isArchived);

  for (const p of activeProducts) {
    const qty = Number(p.stockQty) || 0;
    const cost = Number(p.purchasePrice) || 0;
    const retail = Number(p.sellingPrice) || 0;
    const minAlert = Number(p.minStockAlert) || 5;

    totalQuantity += qty;
    totalCostValue += qty * cost;
    totalRetailValue += qty * retail;

    if (qty <= minAlert) {
      lowStockItemsCount += 1;
    }
  }

  return {
    totalItems: activeProducts.length,
    totalQuantity,
    totalCostValue: Math.round(totalCostValue),
    totalRetailValue: Math.round(totalRetailValue),
    potentialProfit: Math.round(totalRetailValue - totalCostValue),
    lowStockItemsCount,
  };
}

/**
 * Calculates Working Capital and Financial Health
 * Working Capital = Current Assets - Current Liabilities
 * Current Assets = Cash in Hand + Customer Receivables + Inventory Value
 * Current Liabilities = Supplier Payables
 * Quick Ratio = (Cash + Receivables) / Current Liabilities
 */
export function calculateWorkingCapital(
  cashInHand: number,
  customerReceivables: number,
  inventoryValue: number,
  supplierPayables: number
): {
  currentAssets: number;
  currentLiabilities: number;
  workingCapital: number;
  quickRatio: number;
  solvencyStatus: 'HEALTHY' | 'MODERATE' | 'CRITICAL';
} {
  const currentAssets = cashInHand + customerReceivables + inventoryValue;
  const currentLiabilities = Math.max(0, supplierPayables);
  const workingCapital = currentAssets - currentLiabilities;

  const liquidAssets = cashInHand + customerReceivables;
  const quickRatio = currentLiabilities > 0 ? Number((liquidAssets / currentLiabilities).toFixed(2)) : 999;

  let solvencyStatus: 'HEALTHY' | 'MODERATE' | 'CRITICAL' = 'HEALTHY';
  if (workingCapital < 0 || quickRatio < 0.8) {
    solvencyStatus = 'CRITICAL';
  } else if (quickRatio < 1.2 || workingCapital < 25000) {
    solvencyStatus = 'MODERATE';
  }

  return {
    currentAssets,
    currentLiabilities,
    workingCapital,
    quickRatio,
    solvencyStatus,
  };
}

/**
 * Validates a new sale transaction input
 */
export function validateSaleInput(sale: Partial<SaleRecord>): { valid: boolean; error?: string } {
  if (!sale.amount || Number(sale.amount) <= 0) {
    return { valid: false, error: 'Sale amount must be greater than zero.' };
  }
  if (sale.paymentMethod === 'CREDIT' && !sale.customerId) {
    return { valid: false, error: 'Please select a customer for Credit (Udhar) sales.' };
  }
  return { valid: true };
}

/**
 * Finds the customer with the oldest unpaid overdue balance
 */
export function getOldestUnpaidCustomer(customers: Customer[]): Customer | null {
  const withDues = customers.filter((c) => Number(c.currentBalance) > 0);
  if (withDues.length === 0) return null;
  return withDues.reduce((oldest, current) => {
    const currentDays = Number(current.overdueDays) || 0;
    const oldestDays = Number(oldest.overdueDays) || 0;
    return currentDays > oldestDays ? current : oldest;
  }, withDues[0]);
}

/**
 * Calculates Detailed Cash Flow metrics strictly separating active cash movements
 */
export function calculateDetailedCashFlow(
  openingCash: number,
  entries: CashbookEntry[]
): {
  openingCash: number;
  cashReceived: number;
  ownerContributions: number;
  cashPaid: number;
  dailyExpenses: number;
  cashWithdrawals: number;
  closingCash: number;
} {
  let cashReceived = 0;
  let ownerContributions = 0;
  let cashPaid = 0;
  let dailyExpenses = 0;
  let cashWithdrawals = 0;

  for (const entry of entries) {
    if (!isCashbookEntryActive(entry)) continue;
    const amt = Number(entry.amount) || 0;
    if (entry.type === 'IN') {
      if (entry.category === 'OPENING' || entry.refType === 'OPENING') {
        // Opening balance is already reflected via carried-forward or opening entry in totalInflows
      } else if (entry.refType === 'OWNER_CONTRIBUTION' || entry.category === 'OWNER_CONTRIBUTION') {
        ownerContributions += amt;
      } else {
        cashReceived += amt;
      }
    } else if (entry.type === 'OUT') {
      if (entry.refType === 'DRAWING' || entry.category === 'DRAWING') {
        cashWithdrawals += amt;
      } else if (entry.refType === 'EXPENSE' || entry.category === 'EXPENSE') {
        dailyExpenses += amt;
      } else {
        // Supplier payments, upfront cash purchases, sales return cash refunds
        cashPaid += amt;
      }
    }
  }

  const summary = calculateCashbookSummary(openingCash, entries);
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  return {
    openingCash: r2(openingCash),
    cashReceived: r2(cashReceived),
    ownerContributions: r2(ownerContributions),
    cashPaid: r2(cashPaid),
    dailyExpenses: r2(dailyExpenses),
    cashWithdrawals: r2(cashWithdrawals),
    closingCash: summary.closingCash,
  };
}

export interface NonCashBankUpiSummary {
  bankUpiSales: number;
  bankUpiCustomerCollections: number;
  totalBankUpiInflows: number;
  bankUpiSupplierOutflows: number;
  bankUpiExpenses: number;
  bankUpiDrawings: number;
  totalBankUpiOutflows: number;
  netBankUpiFlow: number;
}

/**
 * Separately reconciles non-cash digital / bank movements (UPI + BANK)
 * without polluting physical drawer Cashbook (Rokad).
 */
export function calculateNonCashBankUpiSummary(params: {
  sales: SaleRecord[];
  customerTransactions: CustomerTransaction[];
  supplierTransactions: SupplierTransaction[];
  expenses: ExpenseRecord[];
  startDayKey?: string | null;
  endDayKey?: string | null;
}): NonCashBankUpiSummary {
  const inWindow = (dateStr?: string, createdAt?: string) => {
    const key = toLocalDayKey(dateStr || createdAt);
    if (!key) return !params.startDayKey && !params.endDayKey;
    if (params.startDayKey && key < params.startDayKey) return false;
    if (params.endDayKey && key > params.endDayKey) return false;
    return true;
  };

  let bankUpiSales = 0;
  for (const s of params.sales) {
    if (!isSaleActive(s)) continue;
    if (!inWindow(s.date, s.createdAt)) continue;
    if (s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK') {
      bankUpiSales += Number(s.amount) || 0;
    }
  }

  let bankUpiCustomerCollections = 0;
  for (const tx of params.customerTransactions) {
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') continue;
    if (tx.type !== 'PAYMENT') continue;
    if (!inWindow(tx.date, tx.createdAt)) continue;
    if (tx.paymentMethod === 'UPI' || tx.paymentMethod === 'BANK') {
      bankUpiCustomerCollections += Number(tx.amount) || 0;
    }
  }

  let bankUpiSupplierOutflows = 0;
  for (const st of params.supplierTransactions) {
    if (st.status === 'CANCELLED' || st.status === 'REVERSED') continue;
    if (!inWindow(st.date, st.createdAt)) continue;
    if (st.paymentMethod !== 'UPI' && st.paymentMethod !== 'BANK') continue;

    if (st.type === 'PAYMENT') {
      bankUpiSupplierOutflows += Number(st.amount) || 0;
    } else if (st.type === 'PURCHASE') {
      const amt = Number(st.amount) || 0;
      const upfront =
        st.paidAmount !== undefined && Number.isFinite(Number(st.paidAmount))
          ? Math.min(amt, Math.max(0, Number(st.paidAmount)))
          : st.paymentStatus === 'PAID'
          ? amt
          : st.paymentStatus === 'PARTIAL'
          ? Math.round(amt * 0.5 * 100) / 100
          : 0;
      bankUpiSupplierOutflows += upfront;
    }
  }

  let bankUpiExpenses = 0;
  let bankUpiDrawings = 0;
  for (const exp of params.expenses) {
    if (!inWindow(exp.date, exp.createdAt)) continue;
    if (exp.paymentMethod !== 'UPI' && exp.paymentMethod !== 'BANK') continue;
    const amt = Number(exp.amount) || 0;
    if (exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING') {
      bankUpiDrawings += amt;
    } else {
      bankUpiExpenses += amt;
    }
  }

  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const totalBankUpiInflows = r2(bankUpiSales + bankUpiCustomerCollections);
  const totalBankUpiOutflows = r2(bankUpiSupplierOutflows + bankUpiExpenses + bankUpiDrawings);

  return {
    bankUpiSales: r2(bankUpiSales),
    bankUpiCustomerCollections: r2(bankUpiCustomerCollections),
    totalBankUpiInflows,
    bankUpiSupplierOutflows: r2(bankUpiSupplierOutflows),
    bankUpiExpenses: r2(bankUpiExpenses),
    bankUpiDrawings: r2(bankUpiDrawings),
    totalBankUpiOutflows,
    netBankUpiFlow: r2(totalBankUpiInflows - totalBankUpiOutflows),
  };
}

/**
 * Computes true Month-over-Month sales growth percentage vs prior calendar month.
 */
export function calculateMonthlySalesGrowth(
  sales: SaleRecord[],
  refNow: Date = new Date()
): {
  currentMonthSales: number;
  previousMonthSales: number;
  growthPct: number;
  hasPriorBaseline: boolean;
} {
  const todayKey = getLocalTodayKey(refNow);
  const currentMonthPrefix = todayKey.slice(0, 7);
  const prevMonthDate = new Date(refNow.getFullYear(), refNow.getMonth() - 1, 1);
  const previousMonthPrefix = `${prevMonthDate.getFullYear()}-${String(
    prevMonthDate.getMonth() + 1
  ).padStart(2, '0')}`;

  let currentMonthSales = 0;
  let previousMonthSales = 0;
  for (const s of sales) {
    if (!isSaleActive(s)) continue;
    const dayKey = toLocalDayKey(s.date || s.createdAt);
    const amt = Number(s.amount) || 0;
    if (dayKey.startsWith(currentMonthPrefix)) {
      currentMonthSales += amt;
    } else if (dayKey.startsWith(previousMonthPrefix)) {
      previousMonthSales += amt;
    }
  }

  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  currentMonthSales = r2(currentMonthSales);
  previousMonthSales = r2(previousMonthSales);
  const hasPriorBaseline = previousMonthSales > 0;
  const growthPct = hasPriorBaseline
    ? Math.round(((currentMonthSales - previousMonthSales) / previousMonthSales) * 1000) / 10
    : 0;

  return {
    currentMonthSales,
    previousMonthSales,
    growthPct,
    hasPriorBaseline,
  };
}

/**
 * Validates customer transaction input (Credit given or Payment received)
 */
export function validateCustomerTransaction(
  amount: number,
  type: 'CREDIT' | 'PAYMENT'
): { valid: boolean; error?: string } {
  if (!amount || amount <= 0) {
    return { valid: false, error: 'Amount must be greater than zero.' };
  }
  if (!type || (type !== 'CREDIT' && type !== 'PAYMENT')) {
    return { valid: false, error: 'Transaction type must be CREDIT or PAYMENT.' };
  }
  return { valid: true };
}

export interface DailyProfitMarginPoint {
  dateKey: string;
  displayDate: string;
  salesRevenue: number;
  cogs: number;
  costedRevenue: number;
  uncostedRevenue: number;
  costCoveragePct: number;
  hasCompleteCogs: boolean;
  isProfitVerified: boolean;
  reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
  profitStatus: 'VERIFIED' | 'PROVISIONAL_PARTIAL' | 'UNCOSTED' | 'NEEDS_REVIEW';
  grossProfit: number;
  grossMarginPct: number;
  knownCostGrossProfit: number | null;
  knownCostGrossMarginPct: number | null;
  verifiedGrossProfit: number | null;
  verifiedGrossMarginPct: number | null;
  expenses: number;
  netProfit: number;
  netMarginPct: number;
  billsCount: number;
}

/**
 * Calculates a daily trend series of profit margins by comparing active sales revenue
 * against documented inventory cost price (COGS) without fabricating fake margins or
 * treating missing historical costs as zero purchase cost.
 */
export function calculateDailyProfitMarginTrend(
  sales: SaleRecord[],
  expenses: ExpenseRecord[],
  productsMap: Map<string, Product>,
  daysLimit = 14
): DailyProfitMarginPoint[] {
  const dayMap = new Map<
    string,
    {
      salesRevenue: number;
      cogs: number;
      costedRevenue: number;
      uncostedRevenue: number;
      unreconstructibleCount: number;
      expenses: number;
      billsCount: number;
    }
  >();

  for (const sale of sales) {
    if (!isSaleActive(sale)) continue;
    const dayKey = toLocalDayKey(sale.date || sale.createdAt) || getLocalTodayKey();
    const existing = dayMap.get(dayKey) || {
      salesRevenue: 0,
      cogs: 0,
      costedRevenue: 0,
      uncostedRevenue: 0,
      unreconstructibleCount: 0,
      expenses: 0,
      billsCount: 0,
    };

    const saleAmt = Number(sale.amount) || 0;
    existing.salesRevenue += saleAmt;
    existing.billsCount += 1;

    if (sale.items && sale.items.length > 0) {
      let billLinesRev = 0;
      for (const item of sale.items) {
        const lineRev =
          Number(item.total) ||
          Math.max(0, (Number(item.rate) || 0) * (Number(item.quantity) || 1) - (Number(item.discount) || 0));
        billLinesRev += lineRev;
        const hasHistoricalCostSnapshot =
          item.unitCostAtSale !== undefined &&
          item.unitCostAtSale !== null &&
          Number.isFinite(Number(item.unitCostAtSale));
        const unitCost = hasHistoricalCostSnapshot ? Number(item.unitCostAtSale) : NaN;
        const strictQty = resolveHistoricalBaseQuantityStrict({
          quantity: Number(item.quantity) || 0,
          selectedUnit: item.unit,
          historicalBaseUnit: item.baseUnit,
          explicitBaseQuantity: item.baseQuantity,
        });
        if (!strictQty.valid) {
          existing.unreconstructibleCount += 1;
          existing.uncostedRevenue += lineRev;
        } else if (hasHistoricalCostSnapshot && unitCost > 0 && strictQty.baseQuantity > 0) {
          existing.cogs += unitCost * strictQty.baseQuantity;
          existing.costedRevenue += lineRev;
        } else {
          existing.uncostedRevenue += lineRev;
        }
      }
      const unallocatedDiff = saleAmt - billLinesRev;
      if (Math.abs(unallocatedDiff) > 0.01) {
        existing.uncostedRevenue += unallocatedDiff;
      }
    } else {
      existing.uncostedRevenue += saleAmt;
    }

    dayMap.set(dayKey, existing);
  }

  for (const exp of expenses) {
    if (exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING') continue;
    const dayKey = toLocalDayKey(exp.date || exp.createdAt) || getLocalTodayKey();
    const existing = dayMap.get(dayKey) || {
      salesRevenue: 0,
      cogs: 0,
      costedRevenue: 0,
      uncostedRevenue: 0,
      unreconstructibleCount: 0,
      expenses: 0,
      billsCount: 0,
    };
    existing.expenses += Number(exp.amount) || 0;
    dayMap.set(dayKey, existing);
  }

  const sortedDays = Array.from(dayMap.keys()).sort();
  const targetDays =
    daysLimit > 0 && sortedDays.length > daysLimit ? sortedDays.slice(-daysLimit) : sortedDays;

  return targetDays.map((dayKey) => {
    const data = dayMap.get(dayKey)!;
    const grossProfit = Math.round((data.salesRevenue - data.cogs) * 100) / 100;
    const rawGrossMarginPct =
      data.salesRevenue > 0
        ? Math.round(((grossProfit / data.salesRevenue) * 100) * 10) / 10
        : 0;
    const netProfit = Math.round((grossProfit - data.expenses) * 100) / 100;
    const rawNetMarginPct =
      data.salesRevenue > 0 ? Math.round(((netProfit / data.salesRevenue) * 100) * 10) / 10 : 0;

    const hasUncosted = data.uncostedRevenue > 0.01;
    const reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW' =
      data.unreconstructibleCount > 0
        ? 'NEEDS_REVIEW'
        : hasUncosted
        ? 'UNCOSTED'
        : 'RECONCILED';
    const hasCompleteCogs = !hasUncosted && data.unreconstructibleCount === 0;
    const isProfitVerified = hasCompleteCogs && reviewStatus === 'RECONCILED';

    const rawCoveragePct =
      data.salesRevenue > 0
        ? Math.min(100, (data.costedRevenue / data.salesRevenue) * 100)
        : 100;
    const costCoveragePct =
      hasUncosted && rawCoveragePct >= 100
        ? 99.9
        : Number(rawCoveragePct.toFixed(1));

    const profitStatus: 'VERIFIED' | 'PROVISIONAL_PARTIAL' | 'UNCOSTED' | 'NEEDS_REVIEW' =
      reviewStatus === 'NEEDS_REVIEW'
        ? 'NEEDS_REVIEW'
        : !hasCompleteCogs && (data.costedRevenue <= 0 || costCoveragePct <= 0)
        ? 'UNCOSTED'
        : !hasCompleteCogs
        ? 'PROVISIONAL_PARTIAL'
        : 'VERIFIED';

    const knownCostGrossProfit =
      data.costedRevenue > 0
        ? Math.round((data.costedRevenue - data.cogs) * 100) / 100
        : null;
    const knownCostGrossMarginPct =
      data.costedRevenue > 0 && knownCostGrossProfit !== null
        ? Math.round(((knownCostGrossProfit / data.costedRevenue) * 100) * 10) / 10
        : null;

    const verifiedGrossProfit = isProfitVerified ? Math.round(grossProfit) : null;
    const verifiedGrossMarginPct = isProfitVerified ? rawGrossMarginPct : null;
    const grossMarginPct = isProfitVerified
      ? rawGrossMarginPct
      : knownCostGrossMarginPct !== null
      ? knownCostGrossMarginPct
      : 0;
    const netMarginPct = isProfitVerified ? rawNetMarginPct : 0;

    const parts = dayKey.split('-');
    let displayDate = dayKey;
    if (parts.length === 3) {
      const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(dateObj.getTime())) {
        displayDate = dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      }
    }

    return {
      dateKey: dayKey,
      displayDate,
      salesRevenue: Math.round(data.salesRevenue),
      cogs: Math.round(data.cogs),
      costedRevenue: Math.round(data.costedRevenue),
      uncostedRevenue: Math.round(Math.max(0, data.uncostedRevenue)),
      costCoveragePct,
      hasCompleteCogs,
      isProfitVerified,
      reviewStatus,
      profitStatus,
      grossProfit: Math.round(grossProfit),
      grossMarginPct,
      knownCostGrossProfit,
      knownCostGrossMarginPct,
      verifiedGrossProfit,
      verifiedGrossMarginPct,
      expenses: Math.round(data.expenses),
      netProfit: Math.round(netProfit),
      netMarginPct,
      billsCount: data.billsCount,
    };
  });
}

export interface MonthlyDashboardProfitPoint {
  label: string;
  prefix: string;
  totalSales: number;
  grossRevenue: number;
  salesReturns: number;
  cogs: number;
  costedRevenue: number;
  uncostedRevenue: number;
  costCoveragePct: number;
  hasCompleteCogs: boolean;
  isProfitVerified: boolean;
  reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
  profitStatus: 'VERIFIED' | 'PROVISIONAL_PARTIAL' | 'UNCOSTED' | 'NEEDS_REVIEW';
  grossProfit: number;
  knownCostGrossProfit: number | null;
  knownCostGrossMarginPct: number | null;
  verifiedGrossProfit: number | null;
  verifiedGrossMarginPct: number | null;
  operatingExpenses: number;
  netProfit: number;
  verifiedNetOperatingProfit: number | null;
  uncostedItemsCount: number;
  uncostedReturnsCount: number;
  ambiguousReturnsCount: number;
}

/**
 * Calculates rolling monthly dashboard sales, profit, COGS coverage, and review status
 * (preserving incomplete-cost and NEEDS_REVIEW warnings per month).
 */
export function calculateMonthlyProfitTrend(
  sales: SaleRecord[],
  expenses: ExpenseRecord[],
  productsMap: Map<string, Product>,
  customerTransactions: CustomerTransaction[] = [],
  monthsCount = 6,
  referenceDate = new Date()
): MonthlyDashboardProfitPoint[] {
  const list: MonthlyDashboardProfitPoint[] = [];

  for (let i = Math.max(0, monthsCount - 1); i >= 0; i--) {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
    const monthPrefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

    const monthSales = sales.filter(
      (s) => isSaleActive(s) && toLocalDayKey(s.date || s.createdAt).startsWith(monthPrefix)
    );
    const monthExpenses = expenses.filter((e) =>
      toLocalDayKey(e.date || e.createdAt).startsWith(monthPrefix)
    );
    const monthReturns = customerTransactions.filter(
      (t) =>
        t.status !== 'CANCELLED' &&
        t.status !== 'REVERSED' &&
        t.type === 'RETURN' &&
        toLocalDayKey(t.date || t.createdAt).startsWith(monthPrefix)
    );
    const pnl = calculateProfitAndLoss(monthSales, monthExpenses, productsMap, monthReturns);

    list.push({
      label: monthLabel,
      prefix: monthPrefix,
      totalSales: pnl.totalRevenue,
      grossRevenue: pnl.grossRevenue,
      salesReturns: pnl.salesReturns,
      cogs: pnl.cogs,
      costedRevenue: pnl.costedRevenue,
      uncostedRevenue: pnl.uncostedRevenue,
      costCoveragePct: pnl.costCoveragePct,
      hasCompleteCogs: pnl.hasCompleteCogs,
      isProfitVerified: pnl.isProfitVerified,
      reviewStatus: pnl.reviewStatus,
      profitStatus: pnl.profitStatus,
      grossProfit: pnl.grossProfit,
      knownCostGrossProfit: pnl.knownCostGrossProfit,
      knownCostGrossMarginPct: pnl.knownCostGrossMarginPct,
      verifiedGrossProfit: pnl.verifiedGrossProfit,
      verifiedGrossMarginPct: pnl.verifiedGrossMarginPct,
      operatingExpenses: pnl.operatingExpenses,
      netProfit: pnl.netOperatingProfit,
      verifiedNetOperatingProfit: pnl.verifiedNetOperatingProfit,
      uncostedItemsCount: pnl.uncostedItemsCount,
      uncostedReturnsCount: pnl.uncostedReturnsCount,
      ambiguousReturnsCount: pnl.ambiguousReturnsCount,
    });
  }

  return list;
}

export interface DailySalesTrendPoint {
  dateKey: string;
  displayDate: string;
  dayName: string;
  totalSales: number;
  cashSales: number;
  upiSales: number;
  creditSales: number;
  billsCount: number;
  averageBillValue: number;
}

export interface SevenDaySalesTrendSummary {
  trendData: DailySalesTrendPoint[];
  sevenDayTotal: number;
  averageDailySales: number;
  peakDay: { dateKey: string; displayDate: string; totalSales: number };
  priorSevenDayTotal: number;
  growthPct: number;
  totalBills: number;
}

/**
 * Calculates a rolling 7-day trend of active daily sales revenue and growth KPIs.
 */
export function calculate7DaySalesTrend(
  sales: SaleRecord[],
  referenceDateInput?: Date | string
): SevenDaySalesTrendSummary {
  const activeSales = sales.filter(isSaleActive);
  let refDate: Date;
  if (referenceDateInput) {
    if (typeof referenceDateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(referenceDateInput.trim())) {
      const [y, m, d] = referenceDateInput.trim().split('-').map(Number);
      refDate = new Date(y, (m || 1) - 1, d || 1);
    } else {
      refDate = new Date(referenceDateInput);
    }
    if (isNaN(refDate.getTime())) refDate = new Date();
  } else if (activeSales.length > 0) {
    const timestamps = activeSales
      .map((s) => new Date(s.date || s.createdAt).getTime())
      .filter((t) => !isNaN(t));
    refDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();
  } else {
    refDate = new Date();
  }

  const targetDays: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    targetDays.push(new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() - i));
  }

  const priorDays: Date[] = [];
  for (let i = 13; i >= 7; i--) {
    priorDays.push(new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() - i));
  }

  const priorDateKeys = new Set(priorDays.map(toLocalDayKey));

  const dayMap = new Map<
    string,
    { total: number; cash: number; upi: number; credit: number; count: number }
  >();

  targetDays.forEach((d) => {
    dayMap.set(toLocalDayKey(d), { total: 0, cash: 0, upi: 0, credit: 0, count: 0 });
  });

  let priorSevenDayTotal = 0;

  for (const s of activeSales) {
    const key = toLocalDayKey(s.date || s.createdAt);
    const amount = Number(s.amount) || 0;

    if (dayMap.has(key)) {
      const entry = dayMap.get(key)!;
      entry.total += amount;
      entry.count += 1;
      if (s.paymentMethod === 'CASH') entry.cash += amount;
      else if (s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK') entry.upi += amount;
      else entry.credit += amount;
    } else if (priorDateKeys.has(key)) {
      priorSevenDayTotal += amount;
    }
  }

  let sevenDayTotal = 0;
  let totalBills = 0;
  let peakDay = { dateKey: '', displayDate: '', totalSales: 0 };

  const trendData: DailySalesTrendPoint[] = targetDays.map((d) => {
    const key = toLocalDayKey(d);
    const dayEntry = dayMap.get(key) || { total: 0, cash: 0, upi: 0, credit: 0, count: 0 };
    const displayDate = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const dayName = d.toLocaleDateString('en-IN', { weekday: 'short' });

    sevenDayTotal += dayEntry.total;
    totalBills += dayEntry.count;

    if (dayEntry.total >= peakDay.totalSales) {
      peakDay = {
        dateKey: key,
        displayDate,
        totalSales: dayEntry.total,
      };
    }

    const avgBill = dayEntry.count > 0 ? Math.round(dayEntry.total / dayEntry.count) : 0;

    return {
      dateKey: key,
      displayDate,
      dayName,
      totalSales: Math.round(dayEntry.total),
      cashSales: Math.round(dayEntry.cash),
      upiSales: Math.round(dayEntry.upi),
      creditSales: Math.round(dayEntry.credit),
      billsCount: dayEntry.count,
      averageBillValue: avgBill,
    };
  });

  const averageDailySales = Math.round(sevenDayTotal / 7);

  let growthPct = 0;
  if (priorSevenDayTotal > 0) {
    growthPct = Math.round(((sevenDayTotal - priorSevenDayTotal) / priorSevenDayTotal) * 100 * 10) / 10;
  } else if (sevenDayTotal > 0) {
    growthPct = 100;
  }

  return {
    trendData,
    sevenDayTotal: Math.round(sevenDayTotal),
    averageDailySales,
    peakDay:
      peakDay.totalSales > 0
        ? peakDay
        : {
            dateKey: trendData[6]?.dateKey || '',
            displayDate: trendData[6]?.displayDate || '',
            totalSales: 0,
          },
    priorSevenDayTotal: Math.round(priorSevenDayTotal),
    growthPct,
    totalBills,
  };
}

/**
 * Checks whether a date string falls inside the selected ledger filter range
 * using canonical local-calendar YYYY-MM-DD comparisons.
 */
export function matchesLedgerDateFilter(
  dateStr: string,
  range: LedgerFilterOptions['dateRange'],
  customStart?: string,
  customEnd?: string,
  referenceNow = new Date()
): boolean {
  if (range === 'ALL') return true;
  if (!dateStr) return false;

  const itemDateKey = toLocalDayKey(dateStr);
  if (!itemDateKey) return false;

  const todayKey = getLocalTodayKey(referenceNow);
  const yesterdayKey = getLocalYesterdayKey(referenceNow);

  if (range === 'TODAY') {
    return itemDateKey === todayKey;
  }

  if (range === 'YESTERDAY') {
    return itemDateKey === yesterdayKey;
  }

  if (range === 'LAST_7_DAYS') {
    const startKey = toLocalDayKey(
      new Date(referenceNow.getFullYear(), referenceNow.getMonth(), referenceNow.getDate() - 6)
    );
    return itemDateKey >= startKey && itemDateKey <= todayKey;
  }

  if (range === 'LAST_30_DAYS') {
    const startKey = toLocalDayKey(
      new Date(referenceNow.getFullYear(), referenceNow.getMonth(), referenceNow.getDate() - 29)
    );
    return itemDateKey >= startKey && itemDateKey <= todayKey;
  }

  if (range === 'THIS_MONTH') {
    const thisMonthPrefix = todayKey.substring(0, 7);
    return itemDateKey.startsWith(thisMonthPrefix);
  }

  if (range === 'LAST_MONTH') {
    const lastMonthDate = new Date(referenceNow.getFullYear(), referenceNow.getMonth() - 1, 1);
    const year = lastMonthDate.getFullYear();
    const month = String(lastMonthDate.getMonth() + 1).padStart(2, '0');
    const lastMonthPrefix = `${year}-${month}`;
    return itemDateKey.startsWith(lastMonthPrefix);
  }

  if (range === 'CUSTOM') {
    const sKey = customStart ? toLocalDayKey(customStart) : '';
    const eKey = customEnd ? toLocalDayKey(customEnd) : '';
    if (sKey && itemDateKey < sKey) return false;
    if (eKey && itemDateKey > eKey) return false;
    return true;
  }

  return true;
}

/**
 * Calculates a complete chronological Customer Ledger with running balance after each transaction.
 * Enforces: Opening balance + Period Credit given - Payments received - Returns/Net Adjustments = Closing balance.
 * Cancelled transactions do NOT affect active balance.
 */
export function calculateCustomerLedgerWithRunningBalance(
  customer: Customer,
  transactions: CustomerTransaction[],
  filter?: LedgerFilterOptions
): CustomerLedgerSummary {
  const sortedTx = [...transactions]
    .filter((tx) => tx.customerId === customer.id)
    .sort((a, b) => {
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (diff !== 0) return diff;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

  const isLegacyOpeningCredit = (tx: CustomerTransaction) =>
    tx.type === 'CREDIT' && Boolean(tx.description && tx.description.toLowerCase().includes('opening balance'));

  const hasOpeningTx = sortedTx.some((tx) => tx.type === 'OPENING' || isLegacyOpeningCredit(tx));

  const initialList: CustomerTransaction[] = [...sortedTx];

  if (!hasOpeningTx && Number(customer.openingBalance) > 0) {
    const openingTx: CustomerTransaction = {
      id: `open-${customer.id}`,
      customerId: customer.id,
      type: 'OPENING',
      amount: Number(customer.openingBalance),
      date: customer.createdAt || new Date(0).toISOString(),
      description: 'Opening Balance (Khata Start)',
      status: 'COMPLETED',
      createdAt: customer.createdAt || new Date(0).toISOString(),
    };
    initialList.unshift(openingTx);
  }

  let runningBalance = 0;
  let totalCreditGiven = 0;
  let totalPaymentReceived = 0;
  let salesReturns = 0;
  let netReturnsAndAdjustments = 0;
  let activeCount = 0;
  let cancelledCount = 0;
  let firstDate: string | undefined;
  let lastDate: string | undefined;
  let recordedOpeningAmt = 0;

  const fullCalculatedEntries: CustomerLedgerEntry[] = initialList.map((tx) => {
    const isCancelled = tx.status === 'CANCELLED' || tx.status === 'REVERSED';
    const prevBal = runningBalance;
    const amt = Number(tx.amount) || 0;
    const isOpeningEntry = tx.type === 'OPENING' || isLegacyOpeningCredit(tx);

    let debit = 0;
    let credit = 0;

    if (tx.type === 'CREDIT' || tx.type === 'OPENING') {
      debit = amt;
    } else if (tx.type === 'PAYMENT') {
      credit = amt;
    } else if (tx.type === 'RETURN') {
      credit = amt;
    } else if (tx.type === 'ADJUSTMENT') {
      if (amt >= 0) debit = amt;
      else credit = Math.abs(amt);
    }

    if (!isCancelled) {
      runningBalance = Math.round((runningBalance + debit - credit) * 100) / 100;
      activeCount++;
      if (isOpeningEntry) {
        recordedOpeningAmt += debit;
      } else if (tx.type === 'CREDIT') {
        totalCreditGiven += debit;
      }
      if (tx.type === 'PAYMENT') {
        totalPaymentReceived += credit;
      }
      if (tx.type === 'RETURN') {
        salesReturns += credit;
        netReturnsAndAdjustments += credit;
      }
      if (tx.type === 'ADJUSTMENT') {
        netReturnsAndAdjustments += credit - debit;
      }

      if (!firstDate || tx.date < firstDate) firstDate = tx.date;
      if (!lastDate || tx.date > lastDate) lastDate = tx.date;
    } else {
      cancelledCount++;
    }

    return {
      ...tx,
      debitAmount: debit,
      creditAmount: credit,
      previousBalance: prevBal,
      runningBalance,
      isCancelled,
    };
  });

  const closingBalance = Math.round(runningBalance * 100) / 100;
  const isAdvance = closingBalance < 0;
  const advanceAmount = isAdvance ? Math.abs(closingBalance) : 0;
  let accountStatus: 'DUE' | 'CLEARED' | 'ADVANCE' = 'CLEARED';
  if (closingBalance > 0) accountStatus = 'DUE';
  else if (closingBalance < 0) accountStatus = 'ADVANCE';

  let filteredEntries = fullCalculatedEntries;

  if (filter) {
    if (filter.dateRange && filter.dateRange !== 'ALL') {
      filteredEntries = filteredEntries.filter((e) =>
        matchesLedgerDateFilter(e.date, filter.dateRange, filter.customStartDate, filter.customEndDate)
      );
    }

    if (filter.typeFilter && filter.typeFilter !== 'ALL') {
      filteredEntries = filteredEntries.filter((e) => {
        if (filter.typeFilter === 'CANCELLED') return e.isCancelled;
        if (e.isCancelled) return false;
        if (filter.typeFilter === 'CREDIT_OR_PURCHASE' || filter.typeFilter === 'CREDIT') {
          return e.type === 'CREDIT' || e.type === 'OPENING';
        }
        if (filter.typeFilter === 'PAYMENT') return e.type === 'PAYMENT';
        if (filter.typeFilter === 'RETURN') return e.type === 'RETURN';
        if (filter.typeFilter === 'ADJUSTMENT') return e.type === 'ADJUSTMENT';
        return true;
      });
    }

    if (filter.paymentStatus && filter.paymentStatus !== 'ALL') {
      filteredEntries = filteredEntries.filter((e) => {
        if (filter.paymentStatus === 'CANCELLED') return e.isCancelled;
        if (e.isCancelled) return false;
        if (filter.paymentStatus === 'COMPLETED') return !e.isCancelled;
        if (filter.paymentStatus === 'PAID') {
          return e.type === 'PAYMENT' || e.type === 'RETURN' || (e.type === 'ADJUSTMENT' && e.creditAmount > 0);
        }
        if (filter.paymentStatus === 'DUE') {
          return e.type === 'CREDIT' || e.type === 'OPENING' || (e.type === 'ADJUSTMENT' && e.debitAmount > 0);
        }
        return true;
      });
    }

    if (filter.searchQuery && filter.searchQuery.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      filteredEntries = filteredEntries.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          (e.invoiceNo && e.invoiceNo.toLowerCase().includes(q)) ||
          (e.description && e.description.toLowerCase().includes(q))
      );
    }
  }

  const effectiveOpening =
    recordedOpeningAmt > 0 ? Math.round(recordedOpeningAmt * 100) / 100 : Number(customer.openingBalance) || 0;

  return {
    customer,
    entries: filteredEntries,
    totalCreditGiven: Math.round(totalCreditGiven * 100) / 100,
    totalCredit: Math.round(totalCreditGiven * 100) / 100,
    totalPaymentReceived: Math.round(totalPaymentReceived * 100) / 100,
    totalPayment: Math.round(totalPaymentReceived * 100) / 100,
    netReturnsAndAdjustments: Math.round(netReturnsAndAdjustments * 100) / 100,
    salesReturns: Math.round(salesReturns * 100) / 100,
    openingBalance: effectiveOpening,
    closingBalance,
    isAdvance,
    advanceAmount,
    accountStatus,
    status: accountStatus,
    firstTransactionDate: firstDate,
    lastTransactionDate: lastDate,
    activeCount,
    cancelledCount,
    filteredEntriesCount: filteredEntries.length,
    totalEntriesCount: fullCalculatedEntries.length,
  };
}

/**
 * Resolves exact upfront paid amount on a PURCHASE transaction:
 * - Honors explicit `paidAmount` when supplied
 * - Falls back to 100% for PAID, 0% for UNPAID, and 50% ONLY for legacy PARTIAL rows missing paidAmount
 */
export function resolveSupplierPurchaseUpfrontPaid(tx: SupplierTransaction): number {
  if (tx.type !== 'PURCHASE') return 0;
  const purchaseAmt = Math.max(0, Number(tx.amount) || 0);
  if (tx.paidAmount !== undefined && Number.isFinite(Number(tx.paidAmount))) {
    return Math.round(Math.min(purchaseAmt, Math.max(0, Number(tx.paidAmount))) * 100) / 100;
  }
  if (tx.paymentStatus === 'PAID') return purchaseAmt;
  if (tx.paymentStatus === 'PARTIAL') return Math.round(purchaseAmt * 0.5 * 100) / 100;
  return 0;
}

/**
 * Calculates a complete chronological Supplier Ledger with running balance after each transaction.
 * Enforces: Opening payable + Period Purchases - Payments made (incl. upfront) - Returns/Adj = Closing payable.
 * Cancelled transactions do NOT affect active balance.
 */
export function calculateSupplierLedgerWithRunningBalance(
  supplier: Supplier,
  transactions: SupplierTransaction[],
  filter?: LedgerFilterOptions
): SupplierLedgerSummary {
  const sortedTx = [...transactions]
    .filter((tx) => tx.supplierId === supplier.id)
    .sort((a, b) => {
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (diff !== 0) return diff;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

  const isLegacyOpeningPurchase = (tx: SupplierTransaction) =>
    tx.type === 'PURCHASE' && Boolean(tx.description && tx.description.toLowerCase().includes('opening balance'));

  const hasOpeningTx = sortedTx.some((tx) => tx.type === 'OPENING' || isLegacyOpeningPurchase(tx));

  const initialList: SupplierTransaction[] = [...sortedTx];

  if (!hasOpeningTx && Number(supplier.openingBalance) > 0) {
    const openingTx: SupplierTransaction = {
      id: `open-${supplier.id}`,
      supplierId: supplier.id,
      type: 'OPENING',
      amount: Number(supplier.openingBalance),
      date: supplier.createdAt || new Date(0).toISOString(),
      paymentStatus: 'UNPAID',
      description: 'Opening Balance (Old Bills)',
      status: 'COMPLETED',
      createdAt: supplier.createdAt || new Date(0).toISOString(),
    };
    initialList.unshift(openingTx);
  }

  let runningBalance = 0;
  let totalPurchases = 0;
  let purchaseReturns = 0;
  let totalPaid = 0;
  let netReturnsAndAdjustments = 0;
  let activeCount = 0;
  let cancelledCount = 0;
  let firstDate: string | undefined;
  let lastDate: string | undefined;
  let recordedOpeningAmt = 0;

  const fullCalculatedEntries: SupplierLedgerEntry[] = initialList.map((tx) => {
    const isCancelled = tx.status === 'CANCELLED' || tx.status === 'REVERSED';
    const prevBal = runningBalance;
    const amt = Number(tx.amount) || 0;
    const isOpeningEntry = tx.type === 'OPENING' || isLegacyOpeningPurchase(tx);

    let purchaseAmt = 0;
    let paymentAmt = 0;
    let upfrontPaidAmt = 0;

    if (tx.type === 'PURCHASE' || tx.type === 'OPENING') {
      purchaseAmt = amt;
      if (tx.type === 'PURCHASE' && !isOpeningEntry) {
        upfrontPaidAmt = resolveSupplierPurchaseUpfrontPaid(tx);
      }
    } else if (tx.type === 'PAYMENT') {
      paymentAmt = amt;
    } else if (tx.type === 'RETURN') {
      paymentAmt = amt;
    } else if (tx.type === 'ADJUSTMENT') {
      if (amt >= 0) purchaseAmt = amt;
      else paymentAmt = Math.abs(amt);
    }

    if (!isCancelled) {
      let netPayableImpact = 0;
      if (isOpeningEntry) {
        netPayableImpact = purchaseAmt;
        recordedOpeningAmt += purchaseAmt;
      } else if (tx.type === 'PURCHASE') {
        netPayableImpact = purchaseAmt - upfrontPaidAmt;
      } else {
        netPayableImpact = purchaseAmt - paymentAmt;
      }

      runningBalance = Math.round((runningBalance + netPayableImpact) * 100) / 100;
      activeCount++;

      if (tx.type === 'PURCHASE' && !isOpeningEntry) {
        totalPurchases += purchaseAmt;
        totalPaid += upfrontPaidAmt;
      }
      if (tx.type === 'PAYMENT') {
        totalPaid += paymentAmt;
      }
      if (tx.type === 'RETURN') {
        purchaseReturns += paymentAmt;
        netReturnsAndAdjustments += paymentAmt;
      }
      if (tx.type === 'ADJUSTMENT') {
        netReturnsAndAdjustments += paymentAmt - purchaseAmt;
      }

      if (!firstDate || tx.date < firstDate) firstDate = tx.date;
      if (!lastDate || tx.date > lastDate) lastDate = tx.date;
    } else {
      cancelledCount++;
    }

    return {
      ...tx,
      purchaseAmount: purchaseAmt,
      paymentAmount: paymentAmt,
      upfrontPaidAmount: upfrontPaidAmt,
      previousBalance: prevBal,
      runningBalance,
      isCancelled,
    };
  });

  const closingBalance = Math.round(runningBalance * 100) / 100;
  const isAdvance = closingBalance < 0;
  const advanceAmount = isAdvance ? Math.abs(closingBalance) : 0;
  let accountStatus: 'PAYABLE' | 'CLEARED' | 'ADVANCE' = 'CLEARED';
  if (closingBalance > 0) accountStatus = 'PAYABLE';
  else if (closingBalance < 0) accountStatus = 'ADVANCE';

  let filteredEntries = fullCalculatedEntries;

  if (filter) {
    if (filter.dateRange && filter.dateRange !== 'ALL') {
      filteredEntries = filteredEntries.filter((e) =>
        matchesLedgerDateFilter(e.date, filter.dateRange, filter.customStartDate, filter.customEndDate)
      );
    }

    if (filter.typeFilter && filter.typeFilter !== 'ALL') {
      filteredEntries = filteredEntries.filter((e) => {
        if (filter.typeFilter === 'CANCELLED') return e.isCancelled;
        if (e.isCancelled) return false;
        if (filter.typeFilter === 'CREDIT_OR_PURCHASE' || filter.typeFilter === 'PURCHASE') {
          return e.type === 'PURCHASE' || e.type === 'OPENING';
        }
        if (filter.typeFilter === 'PAYMENT') return e.type === 'PAYMENT';
        if (filter.typeFilter === 'RETURN') return e.type === 'RETURN';
        if (filter.typeFilter === 'ADJUSTMENT') return e.type === 'ADJUSTMENT';
        return true;
      });
    }

    if (filter.searchQuery && filter.searchQuery.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      filteredEntries = filteredEntries.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          (e.invoiceNo && e.invoiceNo.toLowerCase().includes(q)) ||
          (e.description && e.description.toLowerCase().includes(q))
      );
    }
  }

  const effectiveOpening =
    recordedOpeningAmt > 0 ? Math.round(recordedOpeningAmt * 100) / 100 : Number(supplier.openingBalance) || 0;

  return {
    supplier,
    entries: filteredEntries,
    totalPurchases: Math.round(totalPurchases * 100) / 100,
    grossPurchases: Math.round(totalPurchases * 100) / 100,
    purchaseReturns: Math.round(purchaseReturns * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    netReturnsAndAdjustments: Math.round(netReturnsAndAdjustments * 100) / 100,
    openingBalance: effectiveOpening,
    closingBalance,
    isAdvance,
    advanceAmount,
    accountStatus,
    status: accountStatus,
    firstTransactionDate: firstDate,
    lastTransactionDate: lastDate,
    activeCount,
    cancelledCount,
    filteredEntriesCount: filteredEntries.length,
    totalEntriesCount: fullCalculatedEntries.length,
  };
}

export interface TodaySalesSnapshot {
  dateKey: string;
  totalSalesToday: number;
  cashSalesToday: number;
  upiSalesToday: number;
  cashReceivedToday: number;
  pendingUdharToday: number;
  totalPendingUdharOverall: number;
  todayBillsCount: number;
  udharCollectionsToday: number;
}

/**
 * Helper to derive canonical local calendar YYYY-MM-DD key from a Date or ISO timestamp safely.
 */
function toIsoDayKey(input: Date | string): string {
  return toLocalDayKey(input);
}

/**
 * Calculates daily snapshot for SalesView top summary card:
 * Total Sales Today, Cash Received (Cash + UPI settled today + today's Khata collections), and Pending Udhar.
 */
export function calculateTodaySalesSnapshot(
  sales: SaleRecord[],
  customerTransactions: CustomerTransaction[] = [],
  customers: Customer[] = [],
  referenceDateInput: Date | string = new Date()
): TodaySalesSnapshot {
  const refDate =
    typeof referenceDateInput === 'string' ? new Date(referenceDateInput) : referenceDateInput;
  const dateKey = toIsoDayKey(isNaN(refDate.getTime()) ? new Date() : refDate);

  let totalSalesToday = 0;
  let cashSalesToday = 0;
  let upiSalesToday = 0;
  let pendingUdharToday = 0;
  let todayBillsCount = 0;

  for (const s of sales) {
    if (!isSaleActive(s)) continue;
    const saleDay = toIsoDayKey(s.date || s.createdAt);
    if (saleDay !== dateKey) continue;

    const amt = Number(s.amount) || 0;
    totalSalesToday += amt;
    todayBillsCount += 1;

    if (s.paymentMethod === 'CASH') {
      cashSalesToday += amt;
    } else if (s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK') {
      upiSalesToday += amt;
    } else if (s.paymentMethod === 'CREDIT' || s.isCredit) {
      pendingUdharToday += amt;
    } else {
      cashSalesToday += amt;
    }
  }

  let udharCollectionsToday = 0;
  for (const tx of customerTransactions) {
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') continue;
    if (tx.type !== 'PAYMENT') continue;
    const txDay = toIsoDayKey(tx.date || tx.createdAt);
    if (txDay === dateKey) {
      udharCollectionsToday += Number(tx.amount) || 0;
    }
  }

  const cashReceivedToday = cashSalesToday + upiSalesToday + udharCollectionsToday;
  const totalPendingUdharOverall = customers.reduce(
    (sum, c) => sum + Math.max(0, Number(c.currentBalance) || 0),
    0
  );

  return {
    dateKey,
    totalSalesToday: Math.round(totalSalesToday * 100) / 100,
    cashSalesToday: Math.round(cashSalesToday * 100) / 100,
    upiSalesToday: Math.round(upiSalesToday * 100) / 100,
    cashReceivedToday: Math.round(cashReceivedToday * 100) / 100,
    pendingUdharToday: Math.round(pendingUdharToday * 100) / 100,
    totalPendingUdharOverall: Math.round(totalPendingUdharOverall * 100) / 100,
    todayBillsCount,
    udharCollectionsToday: Math.round(udharCollectionsToday * 100) / 100,
  };
}

export interface DuePaymentAlertCustomer {
  customer: Customer;
  amountDue: number;
  daysPending: number;
  oldestPendingDate: string;
  unpaidEntriesCount: number;
}

/**
 * Finds customers who still have pending ledger entries older than `minDays` (default 7 days),
 * using FIFO settlement against their active credit/opening entries and falling back to customer lastTransactionDate/overdueDays.
 */
export function getCustomersWithDuePaymentsOlderThanDays(
  customers: Customer[],
  transactions: CustomerTransaction[],
  minDays = 7,
  referenceDateInput: Date | string = new Date()
): DuePaymentAlertCustomer[] {
  const refDate =
    typeof referenceDateInput === 'string' ? new Date(referenceDateInput) : referenceDateInput;
  const refIso = (isNaN(refDate.getTime()) ? new Date() : refDate).toISOString();

  const results: DuePaymentAlertCustomer[] = [];

  for (const customer of customers) {
    const bal = Number(customer.currentBalance) || 0;
    if (bal <= 0) continue;

    const custTx = transactions
      .filter(
        (tx) =>
          tx.customerId === customer.id &&
          tx.status !== 'CANCELLED' &&
          tx.status !== 'REVERSED'
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let totalCreditsSettled = 0;
    const debitEntries: { date: string; amount: number }[] = [];

    for (const tx of custTx) {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'OPENING' || tx.type === 'CREDIT') {
        debitEntries.push({ date: tx.date, amount: amt });
      } else if (tx.type === 'PAYMENT' || tx.type === 'RETURN') {
        totalCreditsSettled += amt;
      } else if (tx.type === 'ADJUSTMENT') {
        if (amt >= 0) debitEntries.push({ date: tx.date, amount: amt });
        else totalCreditsSettled += Math.abs(amt);
      }
    }

    // FIFO allocation of settled payments against oldest debit entries
    let remainingSettlement = totalCreditsSettled;
    const unpaidEntries: { date: string; remaining: number }[] = [];

    for (const d of debitEntries) {
      if (remainingSettlement >= d.amount) {
        remainingSettlement -= d.amount;
      } else {
        unpaidEntries.push({
          date: d.date,
          remaining: Math.round((d.amount - remainingSettlement) * 100) / 100,
        });
        remainingSettlement = 0;
      }
    }

    let oldestPendingDate = customer.lastTransactionDate || customer.createdAt || refIso;
    let daysPending = Math.max(
      Number(customer.overdueDays) || 0,
      calculateOverdueDays(customer.lastTransactionDate, refIso)
    );
    let unpaidEntriesCount = unpaidEntries.length;

    if (unpaidEntries.length > 0) {
      oldestPendingDate = unpaidEntries[0].date;
      const fifoDays = calculateOverdueDays(oldestPendingDate, refIso);
      daysPending = Math.max(fifoDays, daysPending);
    } else if (unpaidEntriesCount === 0) {
      unpaidEntriesCount = 1; // Balance carried forward via opening/legacy state
    }

    if (daysPending > minDays) {
      results.push({
        customer,
        amountDue: Math.round(bal * 100) / 100,
        daysPending,
        oldestPendingDate,
        unpaidEntriesCount,
      });
    }
  }

  // Sort most overdue first, then highest due amount
  results.sort((a, b) => {
    if (b.daysPending !== a.daysPending) return b.daysPending - a.daysPending;
    return b.amountDue - a.amountDue;
  });

  return results;
}

export interface PurchaseOrderDraftItem {
  productId: string;
  productName: string;
  localName?: string;
  category: string;
  unit: string;
  currentStock: number;
  minStockAlert: number;
  deficitQty: number;
  suggestedQty: number;
  unitCost: number;
  estimatedTotal: number;
  isOutOfStock: boolean;
}

/**
 * Builds suggested Purchase Order line items for products at or below their minimum stock threshold.
 */
export function buildPurchaseOrderDraftItems(
  products: Product[],
  targetMultiplier = 2
): PurchaseOrderDraftItem[] {
  const lowItems = products.filter(
    (p) => !p.isArchived && Number(p.stockQty) <= Number(p.minStockAlert)
  );

  return lowItems
    .map((p) => {
      const currentStock = Number(p.stockQty) || 0;
      const minAlert = Number(p.minStockAlert) || 5;
      const unitCost = Number(p.purchasePrice) || 0;
      const deficitQty = Math.max(0, Math.round((minAlert - currentStock) * 100) / 100);
      const targetStock = Math.max(Math.ceil(minAlert * targetMultiplier), minAlert + 5);
      const suggestedQty = Math.max(1, Math.ceil(targetStock - currentStock));
      const estimatedTotal = Math.round(suggestedQty * unitCost * 100) / 100;

      return {
        productId: p.id,
        productName: p.name,
        localName: p.localName,
        category: p.category || 'General Kirana',
        unit: p.unit || 'PCS',
        currentStock,
        minStockAlert: minAlert,
        deficitQty,
        suggestedQty,
        unitCost,
        estimatedTotal,
        isOutOfStock: currentStock <= 0,
      };
    })
    .sort((a, b) => {
      if (a.isOutOfStock !== b.isOutOfStock) return a.isOutOfStock ? -1 : 1;
      const ratioA = a.minStockAlert > 0 ? a.currentStock / a.minStockAlert : 0;
      const ratioB = b.minStockAlert > 0 ? b.currentStock / b.minStockAlert : 0;
      return ratioA - ratioB;
    });
}

export interface CategoryProfitMarginStat {
  category: string;
  skuCount: number;
  totalStockCostValue: number;
  totalStockRetailValue: number;
  potentialProfitValue: number;
  marginPct: number;
  realizedRevenue: number;
  realizedProfit: number;
  heatScore: number; // 0 (lowest margin) to 100 (highest margin)
  tier: 'HIGH' | 'MEDIUM' | 'LOW';
  topMarginProductName: string;
  topMarginProductPct: number;
  lowestMarginProductName: string;
  lowestMarginProductPct: number;
}

/**
 * Calculates profit margin metrics per product category for the Analytics Category Heatmap.
 * Combines inventory cost/retail spread and realized sales margin when available.
 */
export function calculateCategoryProfitMargins(
  products: Product[],
  sales: SaleRecord[] = []
): CategoryProfitMarginStat[] {
  const productById = new Map<string, Product>();
  products.forEach((p) => productById.set(p.id, p));

  const categoryMap = new Map<
    string,
    {
      products: Product[];
      realizedRevenue: number;
      realizedCost: number;
    }
  >();

  for (const p of products) {
    if (p.isArchived) continue;
    const cat = (p.category || 'Uncategorized').trim();
    const bucket = categoryMap.get(cat) || { products: [], realizedRevenue: 0, realizedCost: 0 };
    bucket.products.push(p);
    categoryMap.set(cat, bucket);
  }

  for (const sale of sales) {
    if (!isSaleActive(sale)) continue;
    if (!sale.items || sale.items.length === 0) continue;
    for (const item of sale.items) {
      if (!item.productId || !productById.has(item.productId)) continue;
      const prod = productById.get(item.productId)!;
      const cat = (prod.category || 'Uncategorized').trim();
      const bucket = categoryMap.get(cat);
      if (!bucket) continue;
      bucket.realizedRevenue += Number(item.total) || 0;
      const strictQty = resolveHistoricalBaseQuantityStrict({
        quantity: Number(item.quantity) || 0,
        selectedUnit: item.unit,
        historicalBaseUnit: item.baseUnit,
        explicitBaseQuantity: item.baseQuantity,
      });
      const snapshotCost =
        item.unitCostAtSale !== undefined &&
        item.unitCostAtSale !== null &&
        Number.isFinite(Number(item.unitCostAtSale))
          ? Math.max(0, Number(item.unitCostAtSale))
          : 0;
      if (snapshotCost > 0 && strictQty.valid && strictQty.baseQuantity > 0) {
        bucket.realizedCost += snapshotCost * strictQty.baseQuantity;
      }
    }
  }

  const rawStats = Array.from(categoryMap.entries()).map(([category, bucket]) => {
    let totalStockCostValue = 0;
    let totalStockRetailValue = 0;
    let sumUnitSelling = 0;
    let sumUnitCost = 0;

    let topMarginProductName = '';
    let topMarginProductPct = -Infinity;
    let lowestMarginProductName = '';
    let lowestMarginProductPct = Infinity;

    for (const p of bucket.products) {
      const qty = Math.max(0, Number(p.stockQty) || 0);
      const cost = Math.max(0, Number(p.purchasePrice) || 0);
      const sell = Math.max(0, Number(p.sellingPrice) || 0);

      totalStockCostValue += qty * cost;
      totalStockRetailValue += qty * sell;
      sumUnitSelling += sell;
      sumUnitCost += cost;

      const skuMargin = sell > 0 ? ((sell - cost) / sell) * 100 : 0;
      if (skuMargin > topMarginProductPct) {
        topMarginProductPct = skuMargin;
        topMarginProductName = p.name;
      }
      if (skuMargin < lowestMarginProductPct) {
        lowestMarginProductPct = skuMargin;
        lowestMarginProductName = p.name;
      }
    }

    const potentialProfitValue = totalStockRetailValue - totalStockCostValue;
    const realizedProfit = bucket.realizedRevenue - bucket.realizedCost;

    // Primary margin percentage: stock-weighted margin when stock > 0, else catalog unit average margin
    let marginPct = 0;
    if (totalStockRetailValue > 0) {
      marginPct = (potentialProfitValue / totalStockRetailValue) * 100;
    } else if (sumUnitSelling > 0) {
      marginPct = ((sumUnitSelling - sumUnitCost) / sumUnitSelling) * 100;
    }

    marginPct = Math.round(marginPct * 10) / 10;

    let tier: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    if (marginPct >= 20) tier = 'HIGH';
    else if (marginPct < 14) tier = 'LOW';

    return {
      category,
      skuCount: bucket.products.length,
      totalStockCostValue: Math.round(totalStockCostValue),
      totalStockRetailValue: Math.round(totalStockRetailValue),
      potentialProfitValue: Math.round(potentialProfitValue),
      marginPct,
      realizedRevenue: Math.round(bucket.realizedRevenue),
      realizedProfit: Math.round(realizedProfit),
      heatScore: 50,
      tier,
      topMarginProductName,
      topMarginProductPct: topMarginProductPct === -Infinity ? 0 : Math.round(topMarginProductPct * 10) / 10,
      lowestMarginProductName,
      lowestMarginProductPct: lowestMarginProductPct === Infinity ? 0 : Math.round(lowestMarginProductPct * 10) / 10,
    };
  });

  if (rawStats.length === 0) return [];

  const margins = rawStats.map((s) => s.marginPct);
  const minMargin = Math.min(...margins);
  const maxMargin = Math.max(...margins);
  const span = maxMargin - minMargin;

  return rawStats
    .map((s) => ({
      ...s,
      heatScore: span > 0 ? Math.round(((s.marginPct - minMargin) / span) * 100) : 50,
    }))
    .sort((a, b) => b.marginPct - a.marginPct);
}

export interface DailySalesVsExpensePoint {
  dateKey: string;
  displayDate: string;
  sales: number;
  expenses: number;
  netGap: number;
  salesCount: number;
  expensesCount: number;
}

export interface ThirtyDaySalesVsExpensesSummary {
  points: DailySalesVsExpensePoint[];
  totalSales: number;
  totalExpenses: number;
  netDifference: number;
  expenseRatioPct: number;
  activeDaysCount: number;
}

/**
 * Computes a 30-day rolling daily comparison between Sales revenue and Operating Expenses
 * (strictly excluding owner personal drawings).
 */
export function calculate30DaySalesVsExpenses(
  sales: SaleRecord[],
  expenses: ExpenseRecord[],
  referenceDateInput: Date | string = new Date()
): ThirtyDaySalesVsExpensesSummary {
  let refDate =
    typeof referenceDateInput === 'string' ? new Date(referenceDateInput) : new Date(referenceDateInput);
  if (isNaN(refDate.getTime())) refDate = new Date();

  const days: Date[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(refDate);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const dayMap = new Map<
    string,
    { sales: number; expenses: number; salesCount: number; expensesCount: number }
  >();

  const toLocalYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  days.forEach((d) => {
    dayMap.set(toLocalYMD(d), { sales: 0, expenses: 0, salesCount: 0, expensesCount: 0 });
  });

  for (const s of sales) {
    if (!isSaleActive(s)) continue;
    const key = toIsoDayKey(s.date || s.createdAt);
    if (!key || !dayMap.has(key)) continue;
    const entry = dayMap.get(key)!;
    entry.sales += Number(s.amount) || 0;
    entry.salesCount += 1;
  }

  for (const exp of expenses) {
    if (exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING') continue;
    const key = toIsoDayKey(exp.date || exp.createdAt);
    if (!key || !dayMap.has(key)) continue;
    const entry = dayMap.get(key)!;
    entry.expenses += Number(exp.amount) || 0;
    entry.expensesCount += 1;
  }

  let totalSales = 0;
  let totalExpenses = 0;
  let activeDaysCount = 0;

  const points: DailySalesVsExpensePoint[] = days.map((d) => {
    const key = toLocalYMD(d);
    const entry = dayMap.get(key)!;
    const daySales = Math.round(entry.sales);
    const dayExpenses = Math.round(entry.expenses);
    if (daySales > 0 || dayExpenses > 0) activeDaysCount += 1;
    totalSales += daySales;
    totalExpenses += dayExpenses;

    return {
      dateKey: key,
      displayDate: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      sales: daySales,
      expenses: dayExpenses,
      netGap: daySales - dayExpenses,
      salesCount: entry.salesCount,
      expensesCount: entry.expensesCount,
    };
  });

  const netDifference = totalSales - totalExpenses;
  const expenseRatioPct =
    totalSales > 0 ? Math.round(((totalExpenses / totalSales) * 100) * 10) / 10 : 0;

  return {
    points,
    totalSales,
    totalExpenses,
    netDifference,
    expenseRatioPct,
    activeDaysCount,
  };
}

export interface ProductValidationInput {
  name: string;
  purchasePrice: number;
  sellingPrice: number;
  mrp?: number;
  stockQty: number;
  minStockAlert: number;
  unit: string;
}

export function validateProductForm(input: ProductValidationInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!input.name || !input.name.trim()) {
    errors.push('Product name is required.');
  }
  if (!input.unit || !input.unit.trim()) {
    errors.push('Selling unit is required.');
  }
  if (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0) {
    errors.push('Purchase price cannot be negative.');
  }
  if (!Number.isFinite(input.sellingPrice) || input.sellingPrice <= 0) {
    errors.push('Selling price must be greater than zero.');
  }
  if (input.mrp !== undefined && (!Number.isFinite(input.mrp) || input.mrp < 0)) {
    errors.push('MRP cannot be negative.');
  }
  if (!Number.isFinite(input.stockQty) || input.stockQty < 0) {
    errors.push('Current stock cannot be negative.');
  }
  if (!Number.isFinite(input.minStockAlert) || input.minStockAlert < 0) {
    errors.push('Low stock alert limit cannot be negative.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Checks whether a product has existing sales or purchase/stock transaction history,
 * so shopkeepers archive rather than permanently deleting historical catalog items.
 */
export function hasProductTransactionHistory(
  productId: string,
  productName: string,
  sales: SaleRecord[],
  stockAdjustments: StockAdjustmentRecord[] = []
): boolean {
  const normalizedTargetName = (productName || '').trim().toLowerCase();

  for (const sale of sales) {
    if (!isSaleActive(sale)) continue;
    for (const item of sale.items || []) {
      if (item.productId && item.productId === productId) {
        return true;
      }
      if (
        normalizedTargetName &&
        item.productName &&
        item.productName.trim().toLowerCase() === normalizedTargetName
      ) {
        return true;
      }
    }
  }

  for (const adj of stockAdjustments) {
    if (adj.productId === productId && (adj.source === 'SALE' || adj.source === 'PURCHASE')) {
      return true;
    }
  }

  return false;
}

export interface ApproachingReorderItem {
  product: Product;
  bufferRemaining: number;
  pctAboveThreshold: number;
}

/**
 * Identifies active products whose stock is still above their minimum alert limit
 * (`stockQty > minStockAlert`) but approaching the reorder threshold
 * (`stockQty <= Math.max(minStockAlert + 1, Math.ceil(minStockAlert * bufferMultiplier))`).
 */
export function getApproachingReorderProducts(
  products: Product[],
  bufferMultiplier = 1.5
): ApproachingReorderItem[] {
  const results: ApproachingReorderItem[] = [];

  for (const product of products) {
    if (product.isArchived) continue;
    const stock = Number(product.stockQty) || 0;
    const threshold = Number(product.minStockAlert) || 0;
    if (threshold <= 0) continue;

    const warningCeiling = Math.max(threshold + 1, Math.ceil(threshold * bufferMultiplier));
    if (stock > threshold && stock <= warningCeiling) {
      const bufferRemaining = Math.round((stock - threshold) * 100) / 100;
      const pctAboveThreshold = Math.round(((stock - threshold) / threshold) * 100);
      results.push({
        product,
        bufferRemaining,
        pctAboveThreshold,
      });
    }
  }

  return results.sort((a, b) => a.pctAboveThreshold - b.pctAboveThreshold);
}

export interface DailyClosingReportData {
  dateKey: string;
  totalSales: number;
  billsCount: number;
  cashSales: number;
  upiSales: number;
  creditSales: number;
  udharCollections: number;
  totalCollections: number;
  operatingExpenses: number;
  cashExpenses: number;
  upiBankExpenses: number;
  personalDrawings: number;
  supplierPayments: number;
  cashPaidToSuppliers: number;
  cashInflowsToday: number;
  cashOutflowsToday: number;
  netCashMovementToday: number;
  expectedCashInDrawer: number;
  netOperatingPosition: number;
  lowStockCount: number;
  approachingReorderCount: number;
}

/**
 * Computes the Daily Closing Report snapshot for a given calendar date (`YYYY-MM-DD`).
 */
export function calculateDailyClosingReport(params: {
  dateKey?: string;
  sales: SaleRecord[];
  customerTransactions: CustomerTransaction[];
  expenses: ExpenseRecord[];
  supplierTransactions: SupplierTransaction[];
  cashbookEntries: CashbookEntry[];
  products: Product[];
}): DailyClosingReportData {
  const dateKey = params.dateKey || getLocalTodayKey();

  let totalSales = 0;
  let billsCount = 0;
  let cashSales = 0;
  let upiSales = 0;
  let creditSales = 0;

  for (const s of params.sales) {
    if (!isSaleActive(s)) continue;
    if (toIsoDayKey(s.date || s.createdAt) !== dateKey) continue;
    const amt = Number(s.amount) || 0;
    totalSales += amt;
    billsCount += 1;
    if (s.paymentMethod === 'CASH') cashSales += amt;
    else if (s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK') upiSales += amt;
    else if (s.paymentMethod === 'CREDIT' || s.isCredit) creditSales += amt;
    else cashSales += amt;
  }

  let udharCollections = 0;
  for (const tx of params.customerTransactions) {
    if (tx.status === 'CANCELLED' || tx.status === 'REVERSED') continue;
    if (tx.type !== 'PAYMENT') continue;
    if (toIsoDayKey(tx.date || tx.createdAt) !== dateKey) continue;
    udharCollections += Number(tx.amount) || 0;
  }

  let operatingExpenses = 0;
  let cashExpenses = 0;
  let upiBankExpenses = 0;
  let personalDrawings = 0;

  for (const exp of params.expenses) {
    if (toIsoDayKey(exp.date || exp.createdAt) !== dateKey) continue;
    const amt = Number(exp.amount) || 0;
    if (exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING') {
      personalDrawings += amt;
    } else {
      operatingExpenses += amt;
      if (exp.paymentMethod === 'CASH') cashExpenses += amt;
      else upiBankExpenses += amt;
    }
  }

  let supplierPayments = 0;
  let cashPaidToSuppliers = 0;
  for (const st of params.supplierTransactions) {
    if (st.status === 'CANCELLED' || st.status === 'REVERSED') continue;
    if (toIsoDayKey(st.date || st.createdAt) !== dateKey) continue;
    if (st.type === 'PAYMENT') {
      const amt = Number(st.amount) || 0;
      supplierPayments += amt;
      if (st.paymentMethod === 'CASH') cashPaidToSuppliers += amt;
    } else if (st.type === 'PURCHASE') {
      const upfront = resolveSupplierPurchaseUpfrontPaid(st);
      if (upfront > 0) {
        supplierPayments += upfront;
        if (st.paymentMethod === 'CASH') cashPaidToSuppliers += upfront;
      }
    }
  }

  let cashInflowsToday = 0;
  let cashOutflowsToday = 0;
  for (const cb of params.cashbookEntries) {
    if (!isCashbookEntryActive(cb)) continue;
    if (toIsoDayKey(cb.date || cb.createdAt) !== dateKey) continue;
    const amt = Number(cb.amount) || 0;
    if (cb.type === 'IN') cashInflowsToday += amt;
    else cashOutflowsToday += amt;
  }

  const cashSummaryOverall = calculateCashbookSummary(0, params.cashbookEntries);
  const totalCollections = cashSales + upiSales + udharCollections;

  const activeProducts = params.products.filter((p) => !p.isArchived);
  const lowStockCount = activeProducts.filter(
    (p) => Number(p.stockQty) <= Number(p.minStockAlert)
  ).length;
  const approachingReorderCount = getApproachingReorderProducts(activeProducts).length;

  return {
    dateKey,
    totalSales: Math.round(totalSales * 100) / 100,
    billsCount,
    cashSales: Math.round(cashSales * 100) / 100,
    upiSales: Math.round(upiSales * 100) / 100,
    creditSales: Math.round(creditSales * 100) / 100,
    udharCollections: Math.round(udharCollections * 100) / 100,
    totalCollections: Math.round(totalCollections * 100) / 100,
    operatingExpenses: Math.round(operatingExpenses * 100) / 100,
    cashExpenses: Math.round(cashExpenses * 100) / 100,
    upiBankExpenses: Math.round(upiBankExpenses * 100) / 100,
    personalDrawings: Math.round(personalDrawings * 100) / 100,
    supplierPayments: Math.round(supplierPayments * 100) / 100,
    cashPaidToSuppliers: Math.round(cashPaidToSuppliers * 100) / 100,
    cashInflowsToday: Math.round(cashInflowsToday * 100) / 100,
    cashOutflowsToday: Math.round(cashOutflowsToday * 100) / 100,
    netCashMovementToday: Math.round((cashInflowsToday - cashOutflowsToday) * 100) / 100,
    expectedCashInDrawer: Math.round(cashSummaryOverall.closingCash * 100) / 100,
    netOperatingPosition: Math.round((totalSales - operatingExpenses) * 100) / 100,
    lowStockCount,
    approachingReorderCount,
  };
}

// ==========================================
// STAGE 4: DAILY TARGET, RECURRING EXPENSES & MONTHLY STATEMENT HELPERS
// ==========================================

export interface DailySalesTargetProgress {
  dateKey: string;
  targetAmount: number;
  todaySales: number;
  remainingAmount: number;
  progressPct: number;
  isAchieved: boolean;
}

export function calculateDailySalesTargetProgress(
  sales: SaleRecord[],
  targetAmount: number,
  referenceDateInput?: string
): DailySalesTargetProgress {
  const dateKey =
    (referenceDateInput ? toIsoDayKey(referenceDateInput) : '') ||
    getLocalTodayKey();

  const safeTarget = Math.max(0, Math.round((Number(targetAmount) || 0) * 100) / 100);

  let todaySales = 0;
  for (const s of sales) {
    if (!isSaleActive(s)) continue;
    if (toIsoDayKey(s.date || s.createdAt) === dateKey) {
      todaySales += Number(s.amount) || 0;
    }
  }
  todaySales = Math.round(todaySales * 100) / 100;

  const remainingAmount = safeTarget > 0 ? Math.max(0, Math.round((safeTarget - todaySales) * 100) / 100) : 0;
  const rawPct = safeTarget > 0 ? (todaySales / safeTarget) * 100 : 0;
  const progressPct = Math.min(100, Math.round(rawPct * 10) / 10);

  return {
    dateKey,
    targetAmount: safeTarget,
    todaySales,
    remainingAmount,
    progressPct,
    isAchieved: safeTarget > 0 && todaySales >= safeTarget,
  };
}

function formatUtcIsoDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function advanceRecurringDueDate(
  dateStr: string,
  frequency: RecurringExpenseFrequency
): string {
  const clean = toIsoDayKey(dateStr) || getLocalTodayKey();
  const [yStr, mStr, dStr] = clean.split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1-12
  const day = Number(dStr); // 1-31

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return getLocalTodayKey();
  }

  if (frequency === 'WEEKLY') {
    return formatUtcIsoDate(new Date(Date.UTC(year, month - 1, day + 7)));
  }

  if (frequency === 'MONTHLY') {
    const lastDayNextMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return formatUtcIsoDate(new Date(Date.UTC(year, month, Math.min(day, lastDayNextMonth))));
  }

  // YEARLY
  const nextYear = year + 1;
  const lastDaySameMonthNextYear = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  return formatUtcIsoDate(
    new Date(Date.UTC(nextYear, month - 1, Math.min(day, lastDaySameMonthNextYear)))
  );
}

export function getDueRecurringExpenses(
  schedules: RecurringExpense[],
  referenceDateKey = getLocalTodayKey()
): RecurringExpense[] {
  const targetDay = toIsoDayKey(referenceDateKey) || getLocalTodayKey();
  return schedules
    .filter((s) => s.isActive && toIsoDayKey(s.nextDueDate) <= targetDay)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

export interface MonthlyCustomerStatement {
  customer: Customer;
  monthKey: string;
  monthLabel: string;
  openingBalanceForMonth: number;
  entriesInMonth: CustomerLedgerEntry[];
  activeEntriesCount: number;
  cancelledEntriesCount: number;
  totalMonthlyDebit: number;
  totalMonthlyCredit: number;
  closingBalanceForMonth: number;
}

export function calculateMonthlyCustomerStatement(
  customer: Customer,
  transactions: CustomerTransaction[],
  monthKey: string
): MonthlyCustomerStatement {
  const normalizedMonth = /^\d{4}-\d{2}$/.test(monthKey)
    ? monthKey
    : new Date().toISOString().slice(0, 7);
  const monthStartDay = `${normalizedMonth}-01`;

  const fullLedger = calculateCustomerLedgerWithRunningBalance(customer, transactions);
  const allEntries = fullLedger.entries;

  const entriesBeforeMonth = allEntries.filter((e) => {
    const day = toIsoDayKey(e.date || e.createdAt);
    return day !== '' && day < monthStartDay;
  });

  const entriesInMonth = allEntries.filter((e) => {
    const day = toIsoDayKey(e.date || e.createdAt);
    return day.startsWith(normalizedMonth);
  });

  const openingBalanceForMonth =
    entriesInMonth.length > 0
      ? Math.round(entriesInMonth[0].previousBalance * 100) / 100
      : entriesBeforeMonth.length > 0
      ? Math.round(entriesBeforeMonth[entriesBeforeMonth.length - 1].runningBalance * 100) / 100
      : 0;

  let totalMonthlyDebit = 0;
  let totalMonthlyCredit = 0;
  let activeEntriesCount = 0;
  let cancelledEntriesCount = 0;

  for (const entry of entriesInMonth) {
    if (entry.isCancelled) {
      cancelledEntriesCount++;
      continue;
    }
    activeEntriesCount++;
    totalMonthlyDebit += entry.debitAmount;
    totalMonthlyCredit += entry.creditAmount;
  }

  totalMonthlyDebit = Math.round(totalMonthlyDebit * 100) / 100;
  totalMonthlyCredit = Math.round(totalMonthlyCredit * 100) / 100;

  const closingBalanceForMonth =
    entriesInMonth.length > 0
      ? Math.round(entriesInMonth[entriesInMonth.length - 1].runningBalance * 100) / 100
      : openingBalanceForMonth;

  const [yr, mo] = normalizedMonth.split('-').map(Number);
  const labelDate = new Date(Date.UTC(yr, (mo || 1) - 1, 1));
  const monthLabel = isNaN(labelDate.getTime())
    ? normalizedMonth
    : labelDate.toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });

  return {
    customer,
    monthKey: normalizedMonth,
    monthLabel,
    openingBalanceForMonth,
    entriesInMonth,
    activeEntriesCount,
    cancelledEntriesCount,
    totalMonthlyDebit,
    totalMonthlyCredit,
    closingBalanceForMonth,
  };
}

export interface StockMovementFilterOptions {
  startDate?: string;
  endDate?: string;
  productId?: string;
  source?: 'ALL' | 'MANUAL' | 'SALE' | 'PURCHASE' | 'EDIT' | 'SALES_RETURN' | 'PURCHASE_RETURN';
  type?: 'ALL' | 'ADD' | 'REDUCE';
  searchQuery?: string;
}

export interface StockMovementSummary {
  totalCount: number;
  addCount: number;
  reduceCount: number;
  totalAddedQty: number;
  totalReducedQty: number;
  netQtyChange: number;
  uniqueProductsCount: number;
}

export function filterStockMovements(
  adjustments: StockAdjustmentRecord[],
  options: StockMovementFilterOptions = {}
): { entries: StockAdjustmentRecord[]; summary: StockMovementSummary } {
  const startDay = options.startDate ? toIsoDayKey(options.startDate) : '';
  const endDay = options.endDate ? toIsoDayKey(options.endDate) : '';
  const productFilter = options.productId && options.productId !== 'ALL' ? options.productId : null;
  const sourceFilter = options.source && options.source !== 'ALL' ? options.source : null;
  const typeFilter = options.type && options.type !== 'ALL' ? options.type : null;
  const q = (options.searchQuery || '').trim().toLowerCase();

  const sorted = [...adjustments].sort((a, b) => {
    const tA = new Date(a.date || a.createdAt).getTime();
    const tB = new Date(b.date || b.createdAt).getTime();
    if (tB !== tA) return tB - tA;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const entries = sorted.filter((entry) => {
    const day = toIsoDayKey(entry.date || entry.createdAt);
    if (startDay && (!day || day < startDay)) return false;
    if (endDay && (!day || day > endDay)) return false;
    if (productFilter && entry.productId !== productFilter) return false;
    if (sourceFilter && entry.source !== sourceFilter) return false;
    if (typeFilter && entry.type !== typeFilter) return false;
    if (q) {
      const hay = `${entry.productName} ${entry.reason} ${entry.source} ${entry.unit}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  let addCount = 0;
  let reduceCount = 0;
  let totalAddedQty = 0;
  let totalReducedQty = 0;
  const productIds = new Set<string>();

  for (const e of entries) {
    productIds.add(e.productId);
    const qty = Math.abs(Number(e.quantityChange) || 0);
    if (e.type === 'ADD') {
      addCount++;
      totalAddedQty += qty;
    } else {
      reduceCount++;
      totalReducedQty += qty;
    }
  }

  return {
    entries,
    summary: {
      totalCount: entries.length,
      addCount,
      reduceCount,
      totalAddedQty: Math.round(totalAddedQty * 100) / 100,
      totalReducedQty: Math.round(totalReducedQty * 100) / 100,
      netQtyChange: Math.round((totalAddedQty - totalReducedQty) * 100) / 100,
      uniqueProductsCount: productIds.size,
    },
  };
}







