/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type ExcelJS from 'exceljs';
import {
  StoreBusinessDataset,
} from '../types';
import {
  calculateCashbookSummary,
  calculateInventoryValuation,
  formatINR,
} from './accounting';

export const EXCEL_WORKSHEET_NAMES = [
  'Dashboard Summary',
  'Customers',
  'Customer Transactions',
  'Suppliers',
  'Supplier Transactions',
  'Sales Bills',
  'Purchase Bills',
  'Expenses',
  'Cashbook',
  'Inventory',
  'Audit Logs',
] as const;

export type ExcelWorksheetName = (typeof EXCEL_WORKSHEET_NAMES)[number];

export interface BackupFinancialMetrics {
  generatedAt: string;
  storeName: string;
  ownerName: string;
  phone: string;
  address: string;
  gstin?: string;
  upiId?: string;
  totalSales: number;
  cashSales: number;
  upiSales: number;
  bankSales: number;
  creditSales: number;
  totalCustomerOutstanding: number;
  totalCustomerAdvance: number;
  customersWithDuesCount: number;
  totalSupplierOutstanding: number;
  suppliersWithPayableCount: number;
  totalPurchases: number;
  purchaseBillsCount: number;
  operatingExpenses: number;
  personalDrawings: number;
  totalAllExpenses: number;
  availableCash: number;
  cashInflows: number;
  cashOutflows: number;
  inventoryCostValue: number;
  inventoryRetailValue: number;
  inventoryPotentialProfit: number;
  activeInventoryCount: number;
  lowStockItemsCount: number;
  openingBalances: {
    totalCustomerOpening: number;
    totalSupplierOpening: number;
    cashOpeningBalance: number;
  };
  recordCounts: {
    customers: number;
    customerTransactions: number;
    suppliers: number;
    supplierTransactions: number;
    salesBills: number;
    purchaseBills: number;
    expenses: number;
    cashbookEntries: number;
    inventory: number;
    auditLogs: number;
    billDocuments: number;
    stockAdjustments: number;
  };
}

export interface ExcelSheetPreview {
  name: ExcelWorksheetName;
  rowCount: number;
  columns: string[];
  sampleRows: Array<Array<string | number>>;
}

export interface ExcelSummaryPreview {
  generatedAt: string;
  storeName: string;
  metrics: BackupFinancialMetrics;
  sheets: ExcelSheetPreview[];
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toExcelDate(value?: string): Date | string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d;
}

function formatPreviewDate(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Computes consistent live financial KPIs & record counts from StoreBusinessDataset
 * using the exact same accounting rules as StoreContext and accounting.ts.
 */
export function computeBackupFinancialMetrics(
  dataset: StoreBusinessDataset
): BackupFinancialMetrics {
  const customers = dataset.customers || [];
  const customerTransactions = dataset.customerTransactions || [];
  const suppliers = dataset.suppliers || [];
  const supplierTransactions = dataset.supplierTransactions || [];
  const sales = dataset.sales || [];
  const expenses = dataset.expenses || [];
  const cashbookEntries = dataset.cashbookEntries || [];
  const products = dataset.products || [];
  const auditLogs = dataset.auditLogs || [];
  const billDocuments = dataset.billDocuments || [];
  const stockAdjustments = dataset.stockAdjustments || [];

  let totalSales = 0;
  let cashSales = 0;
  let upiSales = 0;
  let bankSales = 0;
  let creditSales = 0;

  for (const s of sales) {
    const amt = Number(s.amount) || 0;
    totalSales += amt;
    if (s.paymentMethod === 'CREDIT' || s.isCredit) {
      creditSales += amt;
    } else if (s.paymentMethod === 'UPI') {
      upiSales += amt;
    } else if (s.paymentMethod === 'BANK') {
      bankSales += amt;
    } else {
      cashSales += amt;
    }
  }

  let totalCustomerOutstanding = 0;
  let totalCustomerAdvance = 0;
  let customersWithDuesCount = 0;
  let totalCustomerOpening = 0;

  for (const c of customers) {
    const bal = Number(c.currentBalance) || 0;
    totalCustomerOpening += Number(c.openingBalance) || 0;
    if (bal > 0) {
      totalCustomerOutstanding += bal;
      customersWithDuesCount += 1;
    } else if (bal < 0) {
      totalCustomerAdvance += Math.abs(bal);
    }
  }

  let totalSupplierOutstanding = 0;
  let suppliersWithPayableCount = 0;
  let totalSupplierOpening = 0;

  for (const s of suppliers) {
    const bal = Number(s.currentBalance) || 0;
    totalSupplierOpening += Number(s.openingBalance) || 0;
    if (bal > 0) {
      totalSupplierOutstanding += bal;
      suppliersWithPayableCount += 1;
    }
  }

  const purchaseBills = supplierTransactions.filter(
    (st) => st.type === 'PURCHASE' || st.type === 'OPENING'
  );
  const totalPurchases = supplierTransactions
    .filter(
      (st) =>
        st.type === 'PURCHASE' &&
        st.status !== 'CANCELLED' &&
        st.status !== 'REVERSED'
    )
    .reduce((sum, st) => sum + (Number(st.amount) || 0), 0);

  let operatingExpenses = 0;
  let personalDrawings = 0;
  for (const e of expenses) {
    const amt = Number(e.amount) || 0;
    if (e.isPersonalWithdrawal || e.category === 'PERSONAL_DRAWING') {
      personalDrawings += amt;
    } else {
      operatingExpenses += amt;
    }
  }

  const cashSummary = calculateCashbookSummary(0, cashbookEntries);
  const openingCashEntry = cashbookEntries.find(
    (cb) => cb.category === 'OPENING' || cb.refType === 'OPENING'
  );
  const cashOpeningBalance = openingCashEntry ? Number(openingCashEntry.amount) || 0 : 0;

  const inv = calculateInventoryValuation(products);

  return {
    generatedAt: new Date().toISOString(),
    storeName: dataset.profile?.storeName || 'Arjun Groceries',
    ownerName: dataset.profile?.ownerName || '',
    phone: dataset.profile?.phone || '',
    address: dataset.profile?.address || '',
    gstin: dataset.profile?.gstin || '',
    upiId: dataset.profile?.upiId || '',
    totalSales: round2(totalSales),
    cashSales: round2(cashSales),
    upiSales: round2(upiSales),
    bankSales: round2(bankSales),
    creditSales: round2(creditSales),
    totalCustomerOutstanding: round2(totalCustomerOutstanding),
    totalCustomerAdvance: round2(totalCustomerAdvance),
    customersWithDuesCount,
    totalSupplierOutstanding: round2(totalSupplierOutstanding),
    suppliersWithPayableCount,
    totalPurchases: round2(totalPurchases),
    purchaseBillsCount: purchaseBills.length,
    operatingExpenses: round2(operatingExpenses),
    personalDrawings: round2(personalDrawings),
    totalAllExpenses: round2(operatingExpenses + personalDrawings),
    availableCash: round2(cashSummary.closingCash),
    cashInflows: round2(cashSummary.totalInflows),
    cashOutflows: round2(cashSummary.totalOutflows),
    inventoryCostValue: inv.totalCostValue,
    inventoryRetailValue: inv.totalRetailValue,
    inventoryPotentialProfit: inv.potentialProfit,
    activeInventoryCount: inv.totalItems,
    lowStockItemsCount: inv.lowStockItemsCount,
    openingBalances: {
      totalCustomerOpening: round2(totalCustomerOpening),
      totalSupplierOpening: round2(totalSupplierOpening),
      cashOpeningBalance: round2(cashOpeningBalance),
    },
    recordCounts: {
      customers: customers.length,
      customerTransactions: customerTransactions.length,
      suppliers: suppliers.length,
      supplierTransactions: supplierTransactions.length,
      salesBills: sales.length,
      purchaseBills: purchaseBills.length,
      expenses: expenses.length,
      cashbookEntries: cashbookEntries.length,
      inventory: products.length,
      auditLogs: auditLogs.length,
      billDocuments: billDocuments.length,
      stockAdjustments: stockAdjustments.length,
    },
  };
}

function makeLookupMaps(dataset: StoreBusinessDataset) {
  const customerMap = new Map<string, string>();
  for (const c of dataset.customers || []) {
    customerMap.set(c.id, c.name);
  }
  const supplierMap = new Map<string, string>();
  for (const s of dataset.suppliers || []) {
    supplierMap.set(s.id, s.name);
  }
  return { customerMap, supplierMap };
}

/**
 * Builds an Excel Summary Preview covering all 11 worksheets for UI inspection
 * before downloading the `.xlsx` workbook.
 */
export function buildExcelSummaryPreview(
  dataset: StoreBusinessDataset,
  sampleLimit = 6
): ExcelSummaryPreview {
  const metrics = computeBackupFinancialMetrics(dataset);
  const { customerMap, supplierMap } = makeLookupMaps(dataset);

  const summaryRows: Array<Array<string | number>> = [
    ['Store Name', metrics.storeName, 'Owner', metrics.ownerName || '-'],
    ['Generated At', formatPreviewDate(metrics.generatedAt), 'Phone', metrics.phone || '-'],
    ['Total Sales Revenue', `${metrics.recordCounts.salesBills} bills`, 'INR', formatINR(metrics.totalSales)],
    ['Customer Outstanding (Udhar)', `${metrics.customersWithDuesCount} customers`, 'INR', formatINR(metrics.totalCustomerOutstanding)],
    ['Supplier Outstanding (Payable)', `${metrics.suppliersWithPayableCount} suppliers`, 'INR', formatINR(metrics.totalSupplierOutstanding)],
    ['Operating Expenses', `${metrics.recordCounts.expenses} entries`, 'INR', formatINR(metrics.operatingExpenses)],
    ['Available Cash (Rokad)', `${metrics.recordCounts.cashbookEntries} entries`, 'INR', formatINR(metrics.availableCash)],
    ['Inventory Stock Value', `${metrics.activeInventoryCount} active items`, 'INR', formatINR(metrics.inventoryCostValue)],
  ];

  const purchaseBills = (dataset.supplierTransactions || []).filter(
    (st) => st.type === 'PURCHASE' || st.type === 'OPENING'
  );

  const sheets: ExcelSheetPreview[] = [
    {
      name: 'Dashboard Summary',
      rowCount: 16,
      columns: ['Category', 'Metric / Particulars', 'Count / Info', 'Amount / Value'],
      sampleRows: summaryRows.slice(0, sampleLimit),
    },
    {
      name: 'Customers',
      rowCount: (dataset.customers || []).length,
      columns: ['Customer ID', 'Name', 'Phone', 'Category', 'Opening Bal', 'Current Udhar'],
      sampleRows: (dataset.customers || []).slice(0, sampleLimit).map((c) => [
        c.id,
        c.name,
        c.phone,
        c.category,
        formatINR(c.openingBalance),
        formatINR(c.currentBalance),
      ]),
    },
    {
      name: 'Customer Transactions',
      rowCount: (dataset.customerTransactions || []).length,
      columns: ['Tx ID', 'Date', 'Customer', 'Type', 'Mode', 'Amount', 'Status'],
      sampleRows: (dataset.customerTransactions || []).slice(0, sampleLimit).map((tx) => [
        tx.id,
        formatPreviewDate(tx.date),
        customerMap.get(tx.customerId) || tx.customerId,
        tx.type,
        tx.paymentMethod || '-',
        formatINR(tx.amount),
        tx.status || 'COMPLETED',
      ]),
    },
    {
      name: 'Suppliers',
      rowCount: (dataset.suppliers || []).length,
      columns: ['Supplier ID', 'Name', 'Phone', 'Credit Terms', 'Opening Bal', 'Payable Bal'],
      sampleRows: (dataset.suppliers || []).slice(0, sampleLimit).map((s) => [
        s.id,
        s.name,
        s.phone,
        s.creditTerms || '-',
        formatINR(s.openingBalance),
        formatINR(s.currentBalance),
      ]),
    },
    {
      name: 'Supplier Transactions',
      rowCount: (dataset.supplierTransactions || []).length,
      columns: ['Tx ID', 'Date', 'Supplier', 'Type', 'Invoice No', 'Amount', 'Pay Status'],
      sampleRows: (dataset.supplierTransactions || []).slice(0, sampleLimit).map((tx) => [
        tx.id,
        formatPreviewDate(tx.date),
        supplierMap.get(tx.supplierId) || tx.supplierId,
        tx.type,
        tx.invoiceNo || '-',
        formatINR(tx.amount),
        tx.paymentStatus,
      ]),
    },
    {
      name: 'Sales Bills',
      rowCount: (dataset.sales || []).length,
      columns: ['Sale ID', 'Invoice No', 'Date', 'Customer', 'Mode', 'Items', 'Amount'],
      sampleRows: (dataset.sales || []).slice(0, sampleLimit).map((s) => [
        s.id,
        s.invoiceNo,
        formatPreviewDate(s.date),
        s.customerName || (s.customerId ? customerMap.get(s.customerId) : '') || 'Walk-in',
        s.paymentMethod,
        s.items?.length || 0,
        formatINR(s.amount),
      ]),
    },
    {
      name: 'Purchase Bills',
      rowCount: purchaseBills.length,
      columns: ['Bill ID', 'Invoice No', 'Date', 'Supplier', 'Pay Status', 'Amount'],
      sampleRows: purchaseBills.slice(0, sampleLimit).map((p) => [
        p.id,
        p.invoiceNo || '-',
        formatPreviewDate(p.date),
        supplierMap.get(p.supplierId) || p.supplierId,
        p.paymentStatus,
        formatINR(p.amount),
      ]),
    },
    {
      name: 'Expenses',
      rowCount: (dataset.expenses || []).length,
      columns: ['Expense ID', 'Date', 'Title', 'Category', 'Personal?', 'Mode', 'Amount'],
      sampleRows: (dataset.expenses || []).slice(0, sampleLimit).map((e) => [
        e.id,
        formatPreviewDate(e.date),
        e.title,
        e.category,
        e.isPersonalWithdrawal ? 'Yes' : 'No',
        e.paymentMethod,
        formatINR(e.amount),
      ]),
    },
    {
      name: 'Cashbook',
      rowCount: (dataset.cashbookEntries || []).length,
      columns: ['Entry ID', 'Date', 'Type', 'Ref Type', 'Description', 'Amount'],
      sampleRows: (dataset.cashbookEntries || []).slice(0, sampleLimit).map((cb) => [
        cb.id,
        formatPreviewDate(cb.date),
        cb.type,
        cb.refType,
        cb.description,
        formatINR(cb.amount),
      ]),
    },
    {
      name: 'Inventory',
      rowCount: (dataset.products || []).length,
      columns: ['Product ID', 'Name', 'Category', 'Stock', 'Unit', 'Purchase Price', 'Selling Price'],
      sampleRows: (dataset.products || []).slice(0, sampleLimit).map((p) => [
        p.id,
        p.name,
        p.category,
        p.stockQty,
        p.unit,
        formatINR(p.purchasePrice),
        formatINR(p.sellingPrice),
      ]),
    },
    {
      name: 'Audit Logs',
      rowCount: (dataset.auditLogs || []).length,
      columns: ['Log ID', 'Timestamp', 'Entity Type', 'Action', 'Entity ID', 'Details'],
      sampleRows: (dataset.auditLogs || []).slice(0, sampleLimit).map((a) => [
        a.id,
        formatPreviewDate(a.timestamp),
        a.entityType,
        a.action,
        a.entityId || '-',
        a.details,
      ]),
    },
  ];

  return {
    generatedAt: metrics.generatedAt,
    storeName: metrics.storeName,
    metrics,
    sheets,
  };
}

interface ColumnSpec {
  header: string;
  key: string;
  minWidth?: number;
  maxWidth?: number;
  numFmt?: string;
  isCurrency?: boolean;
  isDate?: boolean;
  align?: 'left' | 'right' | 'center';
}

const INR_FORMAT = '₹#,##0.00';
const DATE_TIME_FORMAT = 'dd-mmm-yyyy hh:mm';

function configureWorksheet(
  wb: ExcelJS.Workbook,
  name: ExcelWorksheetName,
  columns: ColumnSpec[],
  rows: Array<Record<string, unknown>>
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.minWidth ?? 16,
  }));

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF065F46' }, // Emerald-800
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF064E3B' } },
      bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
      left: { style: 'thin', color: { argb: 'FF047857' } },
      right: { style: 'thin', color: { argb: 'FF047857' } },
    };
  });

  // Add rows safely
  for (let i = 0; i < rows.length; i++) {
    const addedRow = ws.addRow(rows[i]);
    const isAlt = i % 2 === 1;

    columns.forEach((col, colIdx) => {
      const cell = addedRow.getCell(colIdx + 1);
      if (col.isCurrency) {
        cell.numFmt = col.numFmt || INR_FORMAT;
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (col.isDate && cell.value instanceof Date) {
        cell.numFmt = col.numFmt || DATE_TIME_FORMAT;
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else if (col.align) {
        cell.alignment = { vertical: 'middle', horizontal: col.align };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }

      if (isAlt) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  }

  // Enable AutoFilter across header + data rows
  const lastColLetter = ws.getColumn(columns.length).letter;
  const lastRowNum = Math.max(1, rows.length + 1);
  ws.autoFilter = `A1:${lastColLetter}${lastRowNum}`;

  // Compute readable column widths
  columns.forEach((col, idx) => {
    let maxLen = col.header.length + 4;
    const scanLimit = Math.min(rows.length, 300);
    for (let r = 0; r < scanLimit; r++) {
      const raw = rows[r][col.key];
      let displayLen = 0;
      if (raw instanceof Date) {
        displayLen = 18;
      } else if (typeof raw === 'number') {
        displayLen = col.isCurrency ? raw.toLocaleString('en-IN').length + 6 : String(raw).length + 2;
      } else if (raw !== null && raw !== undefined) {
        displayLen = String(raw).length + 2;
      }
      if (displayLen > maxLen) {
        maxLen = displayLen;
      }
    }
    const minW = col.minWidth ?? 12;
    const maxW = col.maxWidth ?? 46;
    ws.getColumn(idx + 1).width = Math.max(minW, Math.min(maxW, maxLen));
  });

  return ws;
}

/**
 * Generates an ExcelJS Workbook containing all 11 worksheets from live application state.
 */
export async function generateBackupExcelWorkbook(
  dataset: StoreBusinessDataset
): Promise<ExcelJS.Workbook> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJSClass = ExcelJSModule.default ?? ExcelJSModule;
  const wb = new ExcelJSClass.Workbook();
  wb.creator = 'Arjun Groceries';
  wb.created = new Date();
  wb.modified = new Date();

  const metrics = computeBackupFinancialMetrics(dataset);
  const { customerMap, supplierMap } = makeLookupMaps(dataset);

  // 1. Dashboard Summary
  const summaryRows: Array<Record<string, unknown>> = [
    { category: 'Store Info', metric: 'Business Name', info: 'Active Profile', value: metrics.storeName, numericAmount: null },
    { category: 'Store Info', metric: 'Owner / Phone', info: metrics.ownerName || '-', value: metrics.phone || '-', numericAmount: null },
    { category: 'Store Info', metric: 'Address / GSTIN', info: metrics.gstin || 'Unregistered', value: metrics.address || '-', numericAmount: null },
    { category: 'Store Info', metric: 'Export Timestamp', info: 'Human-Readable Report (Not For Full Restore)', value: toExcelDate(metrics.generatedAt), numericAmount: null },
    { category: 'Sales', metric: 'Total Sales Revenue', info: `${metrics.recordCounts.salesBills} bills`, value: metrics.totalSales, numericAmount: metrics.totalSales },
    { category: 'Sales', metric: 'Cash Sales Revenue', info: 'CASH', value: metrics.cashSales, numericAmount: metrics.cashSales },
    { category: 'Sales', metric: 'UPI / Bank Sales Revenue', info: 'UPI + BANK', value: round2(metrics.upiSales + metrics.bankSales), numericAmount: round2(metrics.upiSales + metrics.bankSales) },
    { category: 'Sales', metric: 'Credit (Udhar) Sales', info: 'CREDIT', value: metrics.creditSales, numericAmount: metrics.creditSales },
    { category: 'Receivables', metric: 'Customer Outstanding (Udhar)', info: `${metrics.customersWithDuesCount} customers with dues`, value: metrics.totalCustomerOutstanding, numericAmount: metrics.totalCustomerOutstanding },
    { category: 'Receivables', metric: 'Customer Advance Balances', info: 'Credit ahead', value: metrics.totalCustomerAdvance, numericAmount: metrics.totalCustomerAdvance },
    { category: 'Payables', metric: 'Supplier Outstanding (Payable)', info: `${metrics.suppliersWithPayableCount} suppliers payable`, value: metrics.totalSupplierOutstanding, numericAmount: metrics.totalSupplierOutstanding },
    { category: 'Purchases', metric: 'Total Purchases Volume', info: `${metrics.purchaseBillsCount} purchase bills`, value: metrics.totalPurchases, numericAmount: metrics.totalPurchases },
    { category: 'Expenses', metric: 'Operating Business Expenses', info: `${metrics.recordCounts.expenses} total entries`, value: metrics.operatingExpenses, numericAmount: metrics.operatingExpenses },
    { category: 'Expenses', metric: 'Owner Personal Drawings', info: 'Equity withdrawals', value: metrics.personalDrawings, numericAmount: metrics.personalDrawings },
    { category: 'Cashbook', metric: 'Available Cash in Hand (Rokad)', info: `${metrics.recordCounts.cashbookEntries} cash entries`, value: metrics.availableCash, numericAmount: metrics.availableCash },
    { category: 'Cashbook', metric: 'Cash Inflows / Outflows', info: `In: ${formatINR(metrics.cashInflows)} | Out: ${formatINR(metrics.cashOutflows)}`, value: metrics.cashInflows, numericAmount: metrics.cashInflows },
    { category: 'Inventory', metric: 'Inventory Stock Cost Value', info: `${metrics.activeInventoryCount} active (${metrics.lowStockItemsCount} low stock)`, value: metrics.inventoryCostValue, numericAmount: metrics.inventoryCostValue },
    { category: 'Inventory', metric: 'Inventory Retail Value', info: `Est. Margin: ${formatINR(metrics.inventoryPotentialProfit)}`, value: metrics.inventoryRetailValue, numericAmount: metrics.inventoryRetailValue },
    { category: 'Opening Balances', metric: 'Customer Opening Udhar Total', info: `${metrics.recordCounts.customers} customers`, value: metrics.openingBalances.totalCustomerOpening, numericAmount: metrics.openingBalances.totalCustomerOpening },
    { category: 'Opening Balances', metric: 'Supplier Opening Payable Total', info: `${metrics.recordCounts.suppliers} suppliers`, value: metrics.openingBalances.totalSupplierOpening, numericAmount: metrics.openingBalances.totalSupplierOpening },
    { category: 'Opening Balances', metric: 'Cash Drawer Opening Balance', info: 'Cashbook Opening', value: metrics.openingBalances.cashOpeningBalance, numericAmount: metrics.openingBalances.cashOpeningBalance },
    { category: 'Attachments', metric: 'Stored Bill Photos & PDFs', info: 'IndexedDB Binary Store', value: `${metrics.recordCounts.billDocuments} files`, numericAmount: metrics.recordCounts.billDocuments },
  ];

  const summaryWs = configureWorksheet(
    wb,
    'Dashboard Summary',
    [
      { header: 'Category', key: 'category', minWidth: 18 },
      { header: 'Metric / Particulars', key: 'metric', minWidth: 32 },
      { header: 'Count / Details', key: 'info', minWidth: 32 },
      { header: 'Value / Amount (INR)', key: 'value', minWidth: 22, align: 'right' },
    ],
    summaryRows
  );

  // Format currency and date cells specifically on Dashboard Summary
  summaryRows.forEach((row, idx) => {
    const valCell = summaryWs.getRow(idx + 2).getCell(4);
    if (typeof row.value === 'number' && row.category !== 'Attachments') {
      valCell.numFmt = INR_FORMAT;
      valCell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else if (row.value instanceof Date) {
      valCell.numFmt = DATE_TIME_FORMAT;
      valCell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
  });

  // 2. Customers
  configureWorksheet(
    wb,
    'Customers',
    [
      { header: 'Customer ID', key: 'id', minWidth: 18 },
      { header: 'Customer Name', key: 'name', minWidth: 24 },
      { header: 'Mobile Number', key: 'phone', minWidth: 16 },
      { header: 'Address', key: 'address', minWidth: 24 },
      { header: 'Category', key: 'category', minWidth: 14 },
      { header: 'Opening Balance (INR)', key: 'openingBalance', minWidth: 18, isCurrency: true },
      { header: 'Total Credit Given (INR)', key: 'totalCreditGiven', minWidth: 20, isCurrency: true },
      { header: 'Total Paid (INR)', key: 'totalPaymentReceived', minWidth: 18, isCurrency: true },
      { header: 'Current Udhar Balance (INR)', key: 'currentBalance', minWidth: 22, isCurrency: true },
      { header: 'Overdue Days', key: 'overdueDays', minWidth: 13, align: 'right' },
      { header: 'Last Transaction Date', key: 'lastTransactionDate', minWidth: 20, isDate: true },
      { header: 'Created At', key: 'createdAt', minWidth: 20, isDate: true },
      { header: 'Notes', key: 'notes', minWidth: 24 },
    ],
    (dataset.customers || []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      address: c.address || '',
      category: c.category || 'REGULAR',
      openingBalance: Number(c.openingBalance) || 0,
      totalCreditGiven: Number(c.totalCreditGiven) || 0,
      totalPaymentReceived: Number(c.totalPaymentReceived) || 0,
      currentBalance: Number(c.currentBalance) || 0,
      overdueDays: Number(c.overdueDays) || 0,
      lastTransactionDate: toExcelDate(c.lastTransactionDate),
      createdAt: toExcelDate(c.createdAt),
      notes: c.notes || '',
    }))
  );

  // 3. Customer Transactions
  configureWorksheet(
    wb,
    'Customer Transactions',
    [
      { header: 'Transaction ID', key: 'id', minWidth: 20 },
      { header: 'Date & Time', key: 'date', minWidth: 20, isDate: true },
      { header: 'Customer ID', key: 'customerId', minWidth: 18 },
      { header: 'Customer Name', key: 'customerName', minWidth: 22 },
      { header: 'Type', key: 'type', minWidth: 14 },
      { header: 'Invoice / Ref No', key: 'invoiceNo', minWidth: 18 },
      { header: 'Payment Mode', key: 'paymentMethod', minWidth: 14 },
      { header: 'Amount (INR)', key: 'amount', minWidth: 16, isCurrency: true },
      { header: 'Status', key: 'status', minWidth: 14 },
      { header: 'Description', key: 'description', minWidth: 28 },
      { header: 'Items Summary', key: 'itemsSummary', minWidth: 26 },
      { header: 'Attachments', key: 'attachmentsCount', minWidth: 13, align: 'right' },
      { header: 'Created At', key: 'createdAt', minWidth: 20, isDate: true },
    ],
    (dataset.customerTransactions || []).map((tx) => ({
      id: tx.id,
      date: toExcelDate(tx.date),
      customerId: tx.customerId,
      customerName: customerMap.get(tx.customerId) || 'Unknown Customer',
      type: tx.type,
      invoiceNo: tx.invoiceNo || '',
      paymentMethod: tx.paymentMethod || '',
      amount: Number(tx.amount) || 0,
      status: tx.status || 'COMPLETED',
      description: tx.description || '',
      itemsSummary: tx.itemsSummary || '',
      attachmentsCount: tx.attachments?.length || 0,
      createdAt: toExcelDate(tx.createdAt),
    }))
  );

  // 4. Suppliers
  configureWorksheet(
    wb,
    'Suppliers',
    [
      { header: 'Supplier ID', key: 'id', minWidth: 18 },
      { header: 'Supplier Name', key: 'name', minWidth: 24 },
      { header: 'Contact Person', key: 'contactPerson', minWidth: 20 },
      { header: 'Phone', key: 'phone', minWidth: 16 },
      { header: 'GSTIN', key: 'gstin', minWidth: 18 },
      { header: 'Credit Terms', key: 'creditTerms', minWidth: 16 },
      { header: 'Preferred Payment Mode', key: 'preferredPaymentMethod', minWidth: 20 },
      { header: 'Opening Balance (INR)', key: 'openingBalance', minWidth: 18, isCurrency: true },
      { header: 'Total Purchases (INR)', key: 'totalPurchases', minWidth: 18, isCurrency: true },
      { header: 'Total Paid (INR)', key: 'totalPaid', minWidth: 18, isCurrency: true },
      { header: 'Current Payable (INR)', key: 'currentBalance', minWidth: 20, isCurrency: true },
      { header: 'Address', key: 'address', minWidth: 24 },
      { header: 'Last Transaction Date', key: 'lastTransactionDate', minWidth: 20, isDate: true },
      { header: 'Notes', key: 'notes', minWidth: 24 },
    ],
    (dataset.suppliers || []).map((s) => ({
      id: s.id,
      name: s.name,
      contactPerson: s.contactPerson || '',
      phone: s.phone || '',
      gstin: s.gstin || '',
      creditTerms: s.creditTerms || '',
      preferredPaymentMethod: s.preferredPaymentMethod || '',
      openingBalance: Number(s.openingBalance) || 0,
      totalPurchases: Number(s.totalPurchases) || 0,
      totalPaid: Number(s.totalPaid) || 0,
      currentBalance: Number(s.currentBalance) || 0,
      address: s.address || '',
      lastTransactionDate: toExcelDate(s.lastTransactionDate),
      notes: s.notes || '',
    }))
  );

  // 5. Supplier Transactions
  configureWorksheet(
    wb,
    'Supplier Transactions',
    [
      { header: 'Transaction ID', key: 'id', minWidth: 20 },
      { header: 'Date & Time', key: 'date', minWidth: 20, isDate: true },
      { header: 'Supplier ID', key: 'supplierId', minWidth: 18 },
      { header: 'Supplier Name', key: 'supplierName', minWidth: 22 },
      { header: 'Type', key: 'type', minWidth: 14 },
      { header: 'Invoice / Bill No', key: 'invoiceNo', minWidth: 18 },
      { header: 'Payment Status', key: 'paymentStatus', minWidth: 15 },
      { header: 'Payment Mode', key: 'paymentMethod', minWidth: 14 },
      { header: 'Amount (INR)', key: 'amount', minWidth: 16, isCurrency: true },
      { header: 'Record Status', key: 'status', minWidth: 14 },
      { header: 'Description', key: 'description', minWidth: 28 },
      { header: 'Items Summary', key: 'itemsSummary', minWidth: 26 },
      { header: 'Attachments', key: 'attachmentsCount', minWidth: 13, align: 'right' },
      { header: 'Created At', key: 'createdAt', minWidth: 20, isDate: true },
    ],
    (dataset.supplierTransactions || []).map((tx) => ({
      id: tx.id,
      date: toExcelDate(tx.date),
      supplierId: tx.supplierId,
      supplierName: supplierMap.get(tx.supplierId) || 'Unknown Supplier',
      type: tx.type,
      invoiceNo: tx.invoiceNo || '',
      paymentStatus: tx.paymentStatus,
      paymentMethod: tx.paymentMethod || '',
      amount: Number(tx.amount) || 0,
      status: tx.status || 'COMPLETED',
      description: tx.description || '',
      itemsSummary: tx.itemsSummary || '',
      attachmentsCount: tx.attachments?.length || 0,
      createdAt: toExcelDate(tx.createdAt),
    }))
  );

  // 6. Sales Bills
  configureWorksheet(
    wb,
    'Sales Bills',
    [
      { header: 'Sale ID', key: 'id', minWidth: 20 },
      { header: 'Invoice No', key: 'invoiceNo', minWidth: 16 },
      { header: 'Date & Time', key: 'date', minWidth: 20, isDate: true },
      { header: 'Customer ID', key: 'customerId', minWidth: 18 },
      { header: 'Customer Name', key: 'customerName', minWidth: 22 },
      { header: 'Payment Mode', key: 'paymentMethod', minWidth: 14 },
      { header: 'Is Credit (Udhar)', key: 'isCredit', minWidth: 16 },
      { header: 'Amount (INR)', key: 'amount', minWidth: 16, isCurrency: true },
      { header: 'Item Count', key: 'itemCount', minWidth: 12, align: 'right' },
      { header: 'Items Breakdown', key: 'itemsBreakdown', minWidth: 36 },
      { header: 'Notes', key: 'notes', minWidth: 24 },
      { header: 'Attachments', key: 'attachmentsCount', minWidth: 13, align: 'right' },
      { header: 'Created At', key: 'createdAt', minWidth: 20, isDate: true },
    ],
    (dataset.sales || []).map((s) => ({
      id: s.id,
      invoiceNo: s.invoiceNo,
      date: toExcelDate(s.date),
      customerId: s.customerId || '',
      customerName:
        s.customerName ||
        (s.customerId ? customerMap.get(s.customerId) : '') ||
        'Walk-in Customer',
      paymentMethod: s.paymentMethod,
      isCredit: s.isCredit ? 'YES' : 'NO',
      amount: Number(s.amount) || 0,
      itemCount: s.items?.length || 0,
      itemsBreakdown:
        s.items && s.items.length > 0
          ? s.items.map((it) => `${it.quantity} ${it.unit} ${it.productName} (${it.total})`).join('; ')
          : '',
      notes: s.notes || '',
      attachmentsCount: s.attachments?.length || 0,
      createdAt: toExcelDate(s.createdAt),
    }))
  );

  // 7. Purchase Bills
  const purchaseBills = (dataset.supplierTransactions || []).filter(
    (st) => st.type === 'PURCHASE' || st.type === 'OPENING'
  );
  configureWorksheet(
    wb,
    'Purchase Bills',
    [
      { header: 'Purchase ID', key: 'id', minWidth: 20 },
      { header: 'Bill / Invoice No', key: 'invoiceNo', minWidth: 18 },
      { header: 'Date & Time', key: 'date', minWidth: 20, isDate: true },
      { header: 'Supplier ID', key: 'supplierId', minWidth: 18 },
      { header: 'Supplier Name', key: 'supplierName', minWidth: 22 },
      { header: 'Bill Type', key: 'type', minWidth: 13 },
      { header: 'Payment Status', key: 'paymentStatus', minWidth: 15 },
      { header: 'Payment Mode', key: 'paymentMethod', minWidth: 14 },
      { header: 'Amount (INR)', key: 'amount', minWidth: 16, isCurrency: true },
      { header: 'Product ID', key: 'productId', minWidth: 16 },
      { header: 'Qty & Unit', key: 'qtyUnit', minWidth: 14 },
      { header: 'Unit Cost (INR)', key: 'unitPrice', minWidth: 16, isCurrency: true },
      { header: 'Items / Description', key: 'description', minWidth: 28 },
      { header: 'Record Status', key: 'status', minWidth: 14 },
      { header: 'Attachments', key: 'attachmentsCount', minWidth: 13, align: 'right' },
    ],
    purchaseBills.map((p) => ({
      id: p.id,
      invoiceNo: p.invoiceNo || '',
      date: toExcelDate(p.date),
      supplierId: p.supplierId,
      supplierName: supplierMap.get(p.supplierId) || 'Unknown Supplier',
      type: p.type,
      paymentStatus: p.paymentStatus,
      paymentMethod: p.paymentMethod || '',
      amount: Number(p.amount) || 0,
      productId: p.productId || '',
      qtyUnit: p.quantity !== undefined ? `${p.quantity} ${p.unit || ''}`.trim() : '',
      unitPrice: Number(p.unitPrice) || 0,
      description: p.itemsSummary || p.description || '',
      status: p.status || 'COMPLETED',
      attachmentsCount: p.attachments?.length || 0,
    }))
  );

  // 8. Expenses
  configureWorksheet(
    wb,
    'Expenses',
    [
      { header: 'Expense ID', key: 'id', minWidth: 20 },
      { header: 'Date & Time', key: 'date', minWidth: 20, isDate: true },
      { header: 'Title', key: 'title', minWidth: 24 },
      { header: 'Category', key: 'category', minWidth: 18 },
      { header: 'Type (Business / Personal)', key: 'expenseType', minWidth: 22 },
      { header: 'Payment Mode', key: 'paymentMethod', minWidth: 14 },
      { header: 'Amount (INR)', key: 'amount', minWidth: 16, isCurrency: true },
      { header: 'Notes', key: 'notes', minWidth: 26 },
      { header: 'Attachments', key: 'attachmentsCount', minWidth: 13, align: 'right' },
      { header: 'Created At', key: 'createdAt', minWidth: 20, isDate: true },
    ],
    (dataset.expenses || []).map((e) => ({
      id: e.id,
      date: toExcelDate(e.date),
      title: e.title,
      category: e.category,
      expenseType:
        e.isPersonalWithdrawal || e.category === 'PERSONAL_DRAWING'
          ? 'Personal Drawing'
          : 'Operating Expense',
      paymentMethod: e.paymentMethod,
      amount: Number(e.amount) || 0,
      notes: e.notes || '',
      attachmentsCount: e.attachments?.length || 0,
      createdAt: toExcelDate(e.createdAt),
    }))
  );

  // 9. Cashbook
  configureWorksheet(
    wb,
    'Cashbook',
    [
      { header: 'Entry ID', key: 'id', minWidth: 20 },
      { header: 'Date & Time', key: 'date', minWidth: 20, isDate: true },
      { header: 'Direction (IN / OUT)', key: 'type', minWidth: 16 },
      { header: 'Category', key: 'category', minWidth: 18 },
      { header: 'Ref Type', key: 'refType', minWidth: 18 },
      { header: 'Reference ID', key: 'refId', minWidth: 20 },
      { header: 'Payment Mode', key: 'paymentMode', minWidth: 14 },
      { header: 'Amount (INR)', key: 'amount', minWidth: 16, isCurrency: true },
      { header: 'Description', key: 'description', minWidth: 32 },
      { header: 'Attachments', key: 'attachmentsCount', minWidth: 13, align: 'right' },
      { header: 'Created At', key: 'createdAt', minWidth: 20, isDate: true },
    ],
    (dataset.cashbookEntries || []).map((cb) => ({
      id: cb.id,
      date: toExcelDate(cb.date),
      type: cb.type,
      category: cb.category,
      refType: cb.refType,
      refId: cb.refId || '',
      paymentMode: cb.paymentMode || 'CASH',
      amount: Number(cb.amount) || 0,
      description: cb.description || '',
      attachmentsCount: cb.attachments?.length || 0,
      createdAt: toExcelDate(cb.createdAt),
    }))
  );

  // 10. Inventory
  configureWorksheet(
    wb,
    'Inventory',
    [
      { header: 'Product ID', key: 'id', minWidth: 18 },
      { header: 'Product Name', key: 'name', minWidth: 26 },
      { header: 'Local Name', key: 'localName', minWidth: 20 },
      { header: 'Category', key: 'category', minWidth: 16 },
      { header: 'Stock Qty', key: 'stockQty', minWidth: 12, align: 'right' },
      { header: 'Base Unit', key: 'unit', minWidth: 11 },
      { header: 'Min Stock Alert', key: 'minStockAlert', minWidth: 15, align: 'right' },
      { header: 'Purchase Price (INR)', key: 'purchasePrice', minWidth: 18, isCurrency: true },
      { header: 'Selling Price (INR)', key: 'sellingPrice', minWidth: 18, isCurrency: true },
      { header: 'MRP (INR)', key: 'mrp', minWidth: 14, isCurrency: true },
      { header: 'Stock Cost Value (INR)', key: 'stockCostValue', minWidth: 20, isCurrency: true },
      { header: 'Preferred Supplier', key: 'preferredSupplierName', minWidth: 22 },
      { header: 'Status', key: 'status', minWidth: 13 },
      { header: 'Updated At', key: 'updatedAt', minWidth: 20, isDate: true },
    ],
    (dataset.products || []).map((p) => ({
      id: p.id,
      name: p.name,
      localName: p.localName || '',
      category: p.category,
      stockQty: Number(p.stockQty) || 0,
      unit: p.unit,
      minStockAlert: Number(p.minStockAlert) || 0,
      purchasePrice: Number(p.purchasePrice) || 0,
      sellingPrice: Number(p.sellingPrice) || 0,
      mrp: Number(p.mrp) || 0,
      stockCostValue: round2((Number(p.stockQty) || 0) * (Number(p.purchasePrice) || 0)),
      preferredSupplierName: p.preferredSupplierName || '',
      status: p.isArchived ? 'ARCHIVED' : Number(p.stockQty) <= Number(p.minStockAlert) ? 'LOW STOCK' : 'ACTIVE',
      updatedAt: toExcelDate(p.updatedAt),
    }))
  );

  // 11. Audit Logs
  configureWorksheet(
    wb,
    'Audit Logs',
    [
      { header: 'Log ID', key: 'id', minWidth: 20 },
      { header: 'Timestamp', key: 'timestamp', minWidth: 20, isDate: true },
      { header: 'Entity Type', key: 'entityType', minWidth: 14 },
      { header: 'Action', key: 'action', minWidth: 22 },
      { header: 'Entity ID', key: 'entityId', minWidth: 20 },
      { header: 'Performed By', key: 'user', minWidth: 16 },
      { header: 'Details', key: 'details', minWidth: 44 },
    ],
    (dataset.auditLogs || []).map((a) => ({
      id: a.id,
      timestamp: toExcelDate(a.timestamp),
      entityType: a.entityType,
      action: a.action,
      entityId: a.entityId || '',
      user: a.user || 'Owner',
      details: a.details,
    }))
  );

  return wb;
}

/**
 * Generates raw `.xlsx` binary bytes (Uint8Array) ready for saving via File System Access API,
 * Android Share Sheet, or browser download.
 */
export async function generateBackupExcelBuffer(
  dataset: StoreBusinessDataset
): Promise<Uint8Array> {
  const wb = await generateBackupExcelWorkbook(dataset);
  const rawBuffer = await wb.xlsx.writeBuffer();
  return rawBuffer instanceof Uint8Array
    ? rawBuffer
    : new Uint8Array(rawBuffer as ArrayBuffer);
}
