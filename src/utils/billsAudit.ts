import { jsPDF } from 'jspdf';
import {
  Customer,
  ExpenseRecord,
  Product,
  SaleRecord,
  StoreProfile,
  Supplier,
  SupplierTransaction,
} from '../types';
import {
  getLocalTodayKey,
  isSaleActive,
  resolveSupplierPurchaseUpfrontPaid,
  toLocalDayKey,
} from './accounting';
import { resolveHistoricalBaseQuantityStrict } from './inventoryEngine';

export type SaleAuditStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'CANCELLED';
export type PurchaseAuditStatus = 'STOCK_LINKED' | 'LEDGER_ONLY' | 'CANCELLED';

export interface SaleAuditRow {
  id: string;
  invoiceNo: string;
  date: string;
  dayKey: string;
  partyName: string;
  customerId?: string;
  paymentMethod: string;
  isCredit: boolean;
  amount: number;
  billingMode: 'GST' | 'NON_GST';
  itemsCount: number;
  uncostedItemsCount: number;
  missingUnitItemsCount: number;
  auditStatus: SaleAuditStatus;
  auditNote: string;
  rawSale: SaleRecord;
}

export interface SaleAuditReport {
  rows: SaleAuditRow[];
  totalBills: number;
  activeBills: number;
  cancelledBills: number;
  verifiedBills: number;
  needsReviewBills: number;
  totalRevenue: number;
  paidRevenue: number;
  creditRevenue: number;
  costCoveragePct: number;
}

export interface PurchaseAuditRow {
  id: string;
  invoiceNo: string;
  date: string;
  dayKey: string;
  partyName: string;
  supplierId: string;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  paymentMethod?: string;
  amount: number;
  paidAmount: number;
  dueAmount: number;
  billingMode: 'GST' | 'NON_GST';
  quantity?: number;
  unit?: string;
  auditStatus: PurchaseAuditStatus;
  auditNote: string;
  rawPurchase: SupplierTransaction;
}

export interface PurchaseAuditReport {
  rows: PurchaseAuditRow[];
  totalBills: number;
  activeBills: number;
  cancelledBills: number;
  stockLinkedBills: number;
  ledgerOnlyBills: number;
  grossPurchaseAmount: number;
  paidAmount: number;
  payableDueAmount: number;
}

export interface ExpenseAuditRow {
  id: string;
  title: string;
  category: string;
  date: string;
  dayKey: string;
  paymentMethod: string;
  amount: number;
  isPersonalWithdrawal: boolean;
}

export interface ExpenseAuditReport {
  rows: ExpenseAuditRow[];
  totalEntries: number;
  operatingAmount: number;
  drawingsAmount: number;
  cashOutAmount: number;
  digitalOutAmount: number;
}

const roundCurrency = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildSaleAuditReport(params: {
  sales: SaleRecord[];
  customers?: Customer[];
  products?: Product[];
  profile?: Pick<StoreProfile, 'gstin'>;
  searchQuery?: string;
  statusFilter?: 'ALL' | SaleAuditStatus;
}): SaleAuditReport {
  const customersMap = new Map((params.customers || []).map((c) => [c.id, c]));
  const hasGstin = Boolean(params.profile?.gstin?.trim());
  const q = (params.searchQuery || '').trim().toLowerCase();

  let activeBills = 0;
  let cancelledBills = 0;
  let verifiedBills = 0;
  let needsReviewBills = 0;
  let totalRevenue = 0;
  let paidRevenue = 0;
  let creditRevenue = 0;
  let costedRevenue = 0;

  const allRows: SaleAuditRow[] = params.sales.map((sale) => {
    const active = isSaleActive(sale);
    const customer = sale.customerId ? customersMap.get(sale.customerId) : undefined;
    const partyName = sale.customerName || customer?.name || 'Walk-in Customer';
    const items = Array.isArray(sale.items) ? sale.items : [];

    let uncostedItemsCount = 0;
    let missingUnitItemsCount = 0;
    let saleHasAllCosts = true;

    for (const item of items) {
      if (item.unitCostAtSale === undefined || item.unitCostAtSale === null) {
        uncostedItemsCount += 1;
        saleHasAllCosts = false;
      }
      const strictUnit = resolveHistoricalBaseQuantityStrict({
        quantity: Number(item.quantity) || 0,
        selectedUnit: item.unit,
        historicalBaseUnit: item.baseUnit,
        explicitBaseQuantity: item.baseQuantity,
      });
      if (!strictUnit.valid || !strictUnit.baseUnit) {
        missingUnitItemsCount += 1;
      }
    }

    let auditStatus: SaleAuditStatus = 'VERIFIED';
    let auditNote = 'COGS & unit snapshot verified';
    if (!active) {
      auditStatus = 'CANCELLED';
      auditNote = sale.cancelReason ? `Cancelled: ${sale.cancelReason}` : 'Cancelled / reversed bill';
    } else if (uncostedItemsCount > 0 || missingUnitItemsCount > 0) {
      auditStatus = 'NEEDS_REVIEW';
      auditNote =
        missingUnitItemsCount > 0
          ? `${missingUnitItemsCount} item(s) missing historical unit`
          : `${uncostedItemsCount} item(s) uncosted`;
    } else if (items.length === 0) {
      auditNote = 'Quick amount bill (no line items)';
    }

    const amt = roundCurrency(Number(sale.amount) || 0);
    if (active) {
      activeBills += 1;
      totalRevenue += amt;
      if (sale.isCredit || sale.paymentMethod === 'CREDIT') {
        creditRevenue += amt;
      } else {
        paidRevenue += amt;
      }
      if (auditStatus === 'VERIFIED') {
        verifiedBills += 1;
        if (items.length > 0 && saleHasAllCosts) {
          costedRevenue += amt;
        }
      } else if (auditStatus === 'NEEDS_REVIEW') {
        needsReviewBills += 1;
      }
    } else {
      cancelledBills += 1;
    }

    return {
      id: sale.id,
      invoiceNo: sale.invoiceNo || sale.id,
      date: sale.date || sale.createdAt,
      dayKey: toLocalDayKey(sale.date || sale.createdAt),
      partyName,
      customerId: sale.customerId,
      paymentMethod: sale.paymentMethod,
      isCredit: Boolean(sale.isCredit || sale.paymentMethod === 'CREDIT'),
      amount: amt,
      billingMode: hasGstin ? 'GST' : 'NON_GST',
      itemsCount: items.length,
      uncostedItemsCount,
      missingUnitItemsCount,
      auditStatus,
      auditNote,
      rawSale: sale,
    };
  });

  const filtered = allRows
    .filter((row) => {
      if (params.statusFilter && params.statusFilter !== 'ALL' && row.auditStatus !== params.statusFilter) {
        return false;
      }
      if (q) {
        const hay = `${row.invoiceNo} ${row.partyName} ${row.paymentMethod} ${row.auditNote}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const costCoveragePct =
    totalRevenue > 0 ? Math.min(100, Math.round((costedRevenue / totalRevenue) * 100)) : 100;

  return {
    rows: filtered,
    totalBills: allRows.length,
    activeBills,
    cancelledBills,
    verifiedBills,
    needsReviewBills,
    totalRevenue: roundCurrency(totalRevenue),
    paidRevenue: roundCurrency(paidRevenue),
    creditRevenue: roundCurrency(creditRevenue),
    costCoveragePct,
  };
}

export function buildPurchaseAuditReport(params: {
  supplierTransactions: SupplierTransaction[];
  suppliers?: Supplier[];
  profile?: Pick<StoreProfile, 'gstin'>;
  searchQuery?: string;
  statusFilter?: 'ALL' | PurchaseAuditStatus;
}): PurchaseAuditReport {
  const suppliersMap = new Map((params.suppliers || []).map((s) => [s.id, s]));
  const storeGstin = Boolean(params.profile?.gstin?.trim());
  const q = (params.searchQuery || '').trim().toLowerCase();

  let activeBills = 0;
  let cancelledBills = 0;
  let stockLinkedBills = 0;
  let ledgerOnlyBills = 0;
  let grossPurchaseAmount = 0;
  let paidAmountTotal = 0;
  let payableDueTotal = 0;

  const purchaseTxs = params.supplierTransactions.filter(
    (st) =>
      st.type === 'PURCHASE' &&
      !(st.description && st.description.toLowerCase().includes('opening balance'))
  );

  const allRows: PurchaseAuditRow[] = purchaseTxs.map((st) => {
    const cancelled = st.status === 'CANCELLED' || st.status === 'REVERSED';
    const supplier = suppliersMap.get(st.supplierId);
    const partyName = supplier?.name || 'Wholesale Supplier';
    const amt = roundCurrency(Number(st.amount) || 0);
    const paid = cancelled ? 0 : roundCurrency(resolveSupplierPurchaseUpfrontPaid(st));
    const due = cancelled ? 0 : roundCurrency(Math.max(0, amt - paid));
    const stockLinked = Boolean(st.productId && Number(st.quantity) > 0);

    let auditStatus: PurchaseAuditStatus = stockLinked ? 'STOCK_LINKED' : 'LEDGER_ONLY';
    let auditNote = stockLinked
      ? `Inventory linked (${st.quantity} ${st.unit || 'units'})`
      : 'Supplier ledger bill only';
    if (cancelled) {
      auditStatus = 'CANCELLED';
      auditNote = st.cancelReason ? `Cancelled: ${st.cancelReason}` : 'Cancelled / reversed bill';
    }

    if (cancelled) {
      cancelledBills += 1;
    } else {
      activeBills += 1;
      grossPurchaseAmount += amt;
      paidAmountTotal += paid;
      payableDueTotal += due;
      if (stockLinked) stockLinkedBills += 1;
      else ledgerOnlyBills += 1;
    }

    return {
      id: st.id,
      invoiceNo: st.invoiceNo || `PUR-${st.id.slice(-6).toUpperCase()}`,
      date: st.date || st.createdAt,
      dayKey: toLocalDayKey(st.date || st.createdAt),
      partyName,
      supplierId: st.supplierId,
      paymentStatus: st.paymentStatus,
      paymentMethod: st.paymentMethod,
      amount: amt,
      paidAmount: paid,
      dueAmount: due,
      billingMode: Boolean(supplier?.gstin?.trim() || storeGstin) ? 'GST' : 'NON_GST',
      quantity: st.quantity,
      unit: st.unit,
      auditStatus,
      auditNote,
      rawPurchase: st,
    };
  });

  const filtered = allRows
    .filter((row) => {
      if (params.statusFilter && params.statusFilter !== 'ALL' && row.auditStatus !== params.statusFilter) {
        return false;
      }
      if (q) {
        const hay = `${row.invoiceNo} ${row.partyName} ${row.paymentStatus} ${row.auditNote}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    rows: filtered,
    totalBills: allRows.length,
    activeBills,
    cancelledBills,
    stockLinkedBills,
    ledgerOnlyBills,
    grossPurchaseAmount: roundCurrency(grossPurchaseAmount),
    paidAmount: roundCurrency(paidAmountTotal),
    payableDueAmount: roundCurrency(payableDueTotal),
  };
}

export function buildExpenseAuditReport(params: {
  expenses: ExpenseRecord[];
  searchQuery?: string;
}): ExpenseAuditReport {
  const q = (params.searchQuery || '').trim().toLowerCase();
  let operatingAmount = 0;
  let drawingsAmount = 0;
  let cashOutAmount = 0;
  let digitalOutAmount = 0;

  const allRows: ExpenseAuditRow[] = params.expenses.map((exp) => {
    const amt = roundCurrency(Number(exp.amount) || 0);
    const isDrawing = Boolean(exp.isPersonalWithdrawal || exp.category === 'PERSONAL_DRAWING');
    if (isDrawing) drawingsAmount += amt;
    else operatingAmount += amt;

    if (exp.paymentMethod === 'CASH') cashOutAmount += amt;
    else digitalOutAmount += amt;

    return {
      id: exp.id,
      title: exp.title,
      category: exp.category,
      date: exp.date || exp.createdAt,
      dayKey: toLocalDayKey(exp.date || exp.createdAt),
      paymentMethod: exp.paymentMethod,
      amount: amt,
      isPersonalWithdrawal: isDrawing,
    };
  });

  const filtered = allRows
    .filter((row) => {
      if (!q) return true;
      return `${row.title} ${row.category} ${row.paymentMethod}`.toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    rows: filtered,
    totalEntries: allRows.length,
    operatingAmount: roundCurrency(operatingAmount),
    drawingsAmount: roundCurrency(drawingsAmount),
    cashOutAmount: roundCurrency(cashOutAmount),
    digitalOutAmount: roundCurrency(digitalOutAmount),
  };
}

function pdfCurrency(amount: number): string {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  return `Rs. ${rounded.toLocaleString('en-IN')}`;
}

export function downloadSalePurchaseAuditPDF(params: {
  profile: StoreProfile;
  periodLabel: string;
  saleReport: SaleAuditReport;
  purchaseReport: PurchaseAuditReport;
  expenseReport: ExpenseAuditReport;
}): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFillColor(6, 78, 59);
  doc.rect(10, y, pageWidth - 20, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(params.profile.storeName || 'Arjun Groceries', 14, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `SALE & PURCHASE AUDIT REPORT · Period: ${params.periodLabel}`,
    14,
    y + 15
  );
  if (params.profile.gstin) {
    doc.text(`GSTIN: ${params.profile.gstin}`, pageWidth - 14, y + 15, { align: 'right' });
  }

  y += 28;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Sale Audit Summary', 10, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Active Bills: ${params.saleReport.activeBills} | Verified: ${params.saleReport.verifiedBills} | Needs Review: ${params.saleReport.needsReviewBills} | Cancelled: ${params.saleReport.cancelledBills}`,
    10,
    y
  );
  y += 5;
  doc.text(
    `Gross Active Revenue: ${pdfCurrency(params.saleReport.totalRevenue)} (Paid: ${pdfCurrency(params.saleReport.paidRevenue)}, Udhar: ${pdfCurrency(params.saleReport.creditRevenue)})`,
    10,
    y
  );

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. Purchase Audit Summary', 10, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Active Bills: ${params.purchaseReport.activeBills} | Stock Linked: ${params.purchaseReport.stockLinkedBills} | Ledger Only: ${params.purchaseReport.ledgerOnlyBills} | Cancelled: ${params.purchaseReport.cancelledBills}`,
    10,
    y
  );
  y += 5;
  doc.text(
    `Total Purchases: ${pdfCurrency(params.purchaseReport.grossPurchaseAmount)} (Paid: ${pdfCurrency(params.purchaseReport.paidAmount)}, Payable Due: ${pdfCurrency(params.purchaseReport.payableDueAmount)})`,
    10,
    y
  );

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('3. Expense Audit Summary', 10, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Entries: ${params.expenseReport.totalEntries} | Operating Expenses: ${pdfCurrency(params.expenseReport.operatingAmount)} | Drawings: ${pdfCurrency(params.expenseReport.drawingsAmount)}`,
    10,
    y
  );

  y += 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Recent Sale Bills (Audit Register)', 10, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const saleSlice = params.saleReport.rows.slice(0, 12);
  if (saleSlice.length === 0) {
    doc.text('No sale bills in selected period.', 12, y);
    y += 5;
  } else {
    for (const row of saleSlice) {
      if (y > 270) {
        doc.addPage();
        y = 14;
      }
      doc.text(
        `${row.dayKey} | ${row.invoiceNo} | ${row.partyName.slice(0, 22)} | ${row.paymentMethod} | ${row.auditStatus} | ${pdfCurrency(row.amount)}`,
        12,
        y
      );
      y += 5;
    }
  }

  y += 6;
  if (y > 255) {
    doc.addPage();
    y = 14;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Recent Purchase Bills (Audit Register)', 10, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const purSlice = params.purchaseReport.rows.slice(0, 12);
  if (purSlice.length === 0) {
    doc.text('No purchase bills in selected period.', 12, y);
  } else {
    for (const row of purSlice) {
      if (y > 270) {
        doc.addPage();
        y = 14;
      }
      doc.text(
        `${row.dayKey} | ${row.invoiceNo} | ${row.partyName.slice(0, 22)} | ${row.paymentStatus} | ${row.auditStatus} | ${pdfCurrency(row.amount)}`,
        12,
        y
      );
      y += 5;
    }
  }

  doc.save(`arjun-groceries-audit-report-${getLocalTodayKey()}.pdf`);
}
