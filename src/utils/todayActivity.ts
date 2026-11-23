import {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  NavTab,
  SaleRecord,
  StockAdjustmentRecord,
  Supplier,
  SupplierTransaction,
} from '../types';
import {
  calculateCashbookSummary,
  getLocalTodayKey,
  isCashbookEntryActive,
  isSaleActive,
  resolveSupplierPurchaseUpfrontPaid,
  toLocalDayKey,
} from './accounting';

export type TodayActivityKind =
  | 'SALE'
  | 'KHATA_PAYMENT'
  | 'RETURN'
  | 'PURCHASE'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE'
  | 'CASHBOOK'
  | 'STOCK';

export interface TodayActivityItem {
  id: string;
  kind: TodayActivityKind;
  title: string;
  subtitle: string;
  amount?: number;
  amountDirection?: 'IN' | 'OUT' | 'NEUTRAL';
  timestamp: string;
  targetTab: NavTab;
  customerId?: string;
  supplierId?: string;
}

export interface TodayActivitySummary {
  dateKey: string;
  salesAmount: number;
  billsCount: number;
  cashSales: number;
  upiSales: number;
  creditSales: number;
  collectionsAmount: number;
  collectionsCount: number;
  returnsAmount: number;
  returnsCount: number;
  purchasesAmount: number;
  purchasesCount: number;
  supplierPaidAmount: number;
  supplierPaidCount: number;
  operatingExpensesAmount: number;
  operatingExpensesCount: number;
  personalDrawingsAmount: number;
  personalDrawingsCount: number;
  cashInToday: number;
  cashOutToday: number;
  netCashToday: number;
  cashEntriesCount: number;
  expectedCashInDrawer: number;
  stockUpdatesCount: number;
  manualStockUpdatesCount: number;
  totalActivitiesCount: number;
  activities: TodayActivityItem[];
}

const roundCurrency = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const isActiveRecord = (status?: string): boolean =>
  status !== 'CANCELLED' && status !== 'REVERSED';

const toSortTime = (primary?: string, fallback?: string): number => {
  const candidates = [primary, fallback].filter(Boolean) as string[];
  for (const val of candidates) {
    const ms = new Date(val).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
};

export function formatActivityTime(isoOrDate?: string): string {
  if (!isoOrDate) return 'Today';
  const trimmed = isoOrDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'Today';
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return 'Today';
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function calculateTodayActivitySummary(params: {
  dateKey?: string;
  sales: SaleRecord[];
  customerTransactions: CustomerTransaction[];
  supplierTransactions: SupplierTransaction[];
  expenses: ExpenseRecord[];
  cashbookEntries: CashbookEntry[];
  stockAdjustments: StockAdjustmentRecord[];
  customers?: Customer[];
  suppliers?: Supplier[];
}): TodayActivitySummary {
  const dateKey = params.dateKey || getLocalTodayKey();
  const customersMap = new Map((params.customers || []).map((c) => [c.id, c]));
  const suppliersMap = new Map((params.suppliers || []).map((s) => [s.id, s]));

  let salesAmount = 0;
  let billsCount = 0;
  let cashSales = 0;
  let upiSales = 0;
  let creditSales = 0;

  let collectionsAmount = 0;
  let collectionsCount = 0;
  let returnsAmount = 0;
  let returnsCount = 0;

  let purchasesAmount = 0;
  let purchasesCount = 0;
  let supplierPaidAmount = 0;
  let supplierPaidCount = 0;

  let operatingExpensesAmount = 0;
  let operatingExpensesCount = 0;
  let personalDrawingsAmount = 0;
  let personalDrawingsCount = 0;

  let cashInToday = 0;
  let cashOutToday = 0;
  let cashEntriesCount = 0;

  let stockUpdatesCount = 0;
  let manualStockUpdatesCount = 0;

  const activities: (TodayActivityItem & { _sortMs: number })[] = [];

  // 1. Sales today
  for (const s of params.sales) {
    if (!isSaleActive(s)) continue;
    if (toLocalDayKey(s.date || s.createdAt) !== dateKey) continue;
    const amt = Number(s.amount) || 0;
    salesAmount += amt;
    billsCount += 1;
    if (s.paymentMethod === 'CASH') cashSales += amt;
    else if (s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK') upiSales += amt;
    else if (s.paymentMethod === 'CREDIT' || s.isCredit) creditSales += amt;
    else cashSales += amt;

    const timestamp = s.createdAt || s.date;
    activities.push({
      id: `today-sale-${s.id}`,
      kind: 'SALE',
      title: s.customerName ? `Sale · ${s.customerName}` : 'Counter Walk-in Sale',
      subtitle: `Bill #${s.invoiceNo} · ${s.paymentMethod} · ${formatActivityTime(timestamp)}`,
      amount: amt,
      amountDirection: s.isCredit || s.paymentMethod === 'CREDIT' ? 'NEUTRAL' : 'IN',
      timestamp,
      targetTab: 'SALES',
      customerId: s.customerId,
      _sortMs: toSortTime(s.createdAt, s.date),
    });
  }

  // 2. Customer transactions today (Payments collected & Returns)
  for (const tx of params.customerTransactions) {
    if (!isActiveRecord(tx.status)) continue;
    if (toLocalDayKey(tx.date || tx.createdAt) !== dateKey) continue;
    const amt = Number(tx.amount) || 0;
    const cust = customersMap.get(tx.customerId);
    const custLabel = cust?.name || 'Customer';
    const timestamp = tx.createdAt || tx.date;

    if (tx.type === 'PAYMENT') {
      collectionsAmount += amt;
      collectionsCount += 1;
      activities.push({
        id: `today-cust-pay-${tx.id}`,
        kind: 'KHATA_PAYMENT',
        title: `Khata Jama · ${custLabel}`,
        subtitle: `${tx.paymentMethod || 'CASH'} · ${tx.description || 'Payment received'} · ${formatActivityTime(timestamp)}`,
        amount: amt,
        amountDirection: 'IN',
        timestamp,
        targetTab: 'CUSTOMERS',
        customerId: tx.customerId,
        _sortMs: toSortTime(tx.createdAt, tx.date),
      });
    } else if (tx.type === 'RETURN') {
      returnsAmount += amt;
      returnsCount += 1;
      activities.push({
        id: `today-cust-ret-${tx.id}`,
        kind: 'RETURN',
        title: `Sales Return · ${custLabel}`,
        subtitle: `${tx.description || 'Item returned'} · ${formatActivityTime(timestamp)}`,
        amount: amt,
        amountDirection: 'OUT',
        timestamp,
        targetTab: 'CUSTOMERS',
        customerId: tx.customerId,
        _sortMs: toSortTime(tx.createdAt, tx.date),
      });
    }
  }

  // 3. Supplier transactions today (Purchases & Supplier Payments)
  for (const st of params.supplierTransactions) {
    if (!isActiveRecord(st.status)) continue;
    if (toLocalDayKey(st.date || st.createdAt) !== dateKey) continue;
    const amt = Number(st.amount) || 0;
    const sup = suppliersMap.get(st.supplierId);
    const supLabel = sup?.name || 'Supplier';
    const timestamp = st.createdAt || st.date;

    if (st.type === 'PURCHASE') {
      const isOpening = Boolean(
        st.description && st.description.toLowerCase().includes('opening balance')
      );
      if (!isOpening) {
        purchasesAmount += amt;
        purchasesCount += 1;
        const upfront = resolveSupplierPurchaseUpfrontPaid(st);
        if (upfront > 0) {
          supplierPaidAmount += upfront;
          supplierPaidCount += 1;
        }
        activities.push({
          id: `today-sup-pur-${st.id}`,
          kind: 'PURCHASE',
          title: `Purchase · ${supLabel}`,
          subtitle: `${st.invoiceNo ? `Inv #${st.invoiceNo} · ` : ''}${st.paymentStatus} · ${formatActivityTime(timestamp)}`,
          amount: amt,
          amountDirection: upfront > 0 ? 'OUT' : 'NEUTRAL',
          timestamp,
          targetTab: 'PURCHASES',
          supplierId: st.supplierId,
          _sortMs: toSortTime(st.createdAt, st.date),
        });
      }
    } else if (st.type === 'PAYMENT') {
      supplierPaidAmount += amt;
      supplierPaidCount += 1;
      activities.push({
        id: `today-sup-pay-${st.id}`,
        kind: 'SUPPLIER_PAYMENT',
        title: `Supplier Paid · ${supLabel}`,
        subtitle: `${st.paymentMethod || 'CASH'} · ${st.description || 'Payment settled'} · ${formatActivityTime(timestamp)}`,
        amount: amt,
        amountDirection: 'OUT',
        timestamp,
        targetTab: 'SUPPLIERS',
        supplierId: st.supplierId,
        _sortMs: toSortTime(st.createdAt, st.date),
      });
    }
  }

  // 4. Expenses & Personal Drawings today
  for (const exp of params.expenses) {
    if (toLocalDayKey(exp.date || exp.createdAt) !== dateKey) continue;
    const amt = Number(exp.amount) || 0;
    const isDrawing = Boolean(exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING');
    if (isDrawing) {
      personalDrawingsAmount += amt;
      personalDrawingsCount += 1;
    } else {
      operatingExpensesAmount += amt;
      operatingExpensesCount += 1;
    }

    const timestamp = exp.createdAt || exp.date;
    activities.push({
      id: `today-exp-${exp.id}`,
      kind: 'EXPENSE',
      title: exp.title,
      subtitle: `${isDrawing ? 'Personal Drawing' : exp.category} · ${exp.paymentMethod} · ${formatActivityTime(timestamp)}`,
      amount: amt,
      amountDirection: 'OUT',
      timestamp,
      targetTab: 'EXPENSES',
      _sortMs: toSortTime(exp.createdAt, exp.date),
    });
  }

  // 5. Cashbook movements today (totals include all active drawer entries; timeline logs manual/opening cashbook entries so sales/khata/expenses aren't duplicated)
  for (const cb of params.cashbookEntries) {
    if (!isCashbookEntryActive(cb)) continue;
    if (toLocalDayKey(cb.date || cb.createdAt) !== dateKey) continue;
    const amt = Number(cb.amount) || 0;
    cashEntriesCount += 1;
    if (cb.type === 'IN') cashInToday += amt;
    else cashOutToday += amt;

    if (
      cb.refType === 'OPENING' ||
      cb.refType === 'OWNER_CONTRIBUTION' ||
      cb.refType === 'OTHER'
    ) {
      const timestamp = cb.createdAt || cb.date;
      activities.push({
        id: `today-cb-${cb.id}`,
        kind: 'CASHBOOK',
        title: `Cash ${cb.type === 'IN' ? 'In' : 'Out'} · ${cb.category || 'Rokad'}`,
        subtitle: `${cb.description} · ${formatActivityTime(timestamp)}`,
        amount: amt,
        amountDirection: cb.type === 'IN' ? 'IN' : 'OUT',
        timestamp,
        targetTab: 'CASHBOOK',
        _sortMs: toSortTime(cb.createdAt, cb.date),
      });
    }
  }

  // 6. Stock adjustments today
  for (const adj of params.stockAdjustments) {
    if (toLocalDayKey(adj.date || adj.createdAt) !== dateKey) continue;
    stockUpdatesCount += 1;
    if (adj.source === 'MANUAL' || adj.source === 'EDIT') {
      manualStockUpdatesCount += 1;
      const timestamp = adj.createdAt || adj.date;
      const sign = adj.type === 'ADD' ? '+' : '-';
      activities.push({
        id: `today-stk-${adj.id}`,
        kind: 'STOCK',
        title: `Stock ${adj.type === 'ADD' ? 'Added' : 'Reduced'} · ${adj.productName}`,
        subtitle: `${sign}${adj.quantityChange} ${adj.unit} · ${adj.reason || 'Stock adjustment'} · ${formatActivityTime(timestamp)}`,
        timestamp,
        targetTab: 'INVENTORY',
        _sortMs: toSortTime(adj.createdAt, adj.date),
      });
    }
  }

  activities.sort((a, b) => b._sortMs - a._sortMs);
  const cleanActivities: TodayActivityItem[] = activities.map(({ _sortMs: _ignored, ...rest }) => rest);

  const cashSummaryOverall = calculateCashbookSummary(0, params.cashbookEntries);

  return {
    dateKey,
    salesAmount: roundCurrency(salesAmount),
    billsCount,
    cashSales: roundCurrency(cashSales),
    upiSales: roundCurrency(upiSales),
    creditSales: roundCurrency(creditSales),
    collectionsAmount: roundCurrency(collectionsAmount),
    collectionsCount,
    returnsAmount: roundCurrency(returnsAmount),
    returnsCount,
    purchasesAmount: roundCurrency(purchasesAmount),
    purchasesCount,
    supplierPaidAmount: roundCurrency(supplierPaidAmount),
    supplierPaidCount,
    operatingExpensesAmount: roundCurrency(operatingExpensesAmount),
    operatingExpensesCount,
    personalDrawingsAmount: roundCurrency(personalDrawingsAmount),
    personalDrawingsCount,
    cashInToday: roundCurrency(cashInToday),
    cashOutToday: roundCurrency(cashOutToday),
    netCashToday: roundCurrency(cashInToday - cashOutToday),
    cashEntriesCount,
    expectedCashInDrawer: roundCurrency(cashSummaryOverall.closingCash),
    stockUpdatesCount,
    manualStockUpdatesCount,
    totalActivitiesCount: cleanActivities.length,
    activities: cleanActivities,
  };
}
