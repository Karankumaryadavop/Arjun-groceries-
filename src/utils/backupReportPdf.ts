/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import { StoreBusinessDataset } from '../types';
import {
  BackupFinancialMetrics,
  computeBackupFinancialMetrics,
} from './backupExcel';

export const ARJUN_GROCERIES_LOGO_PATH = '/assets/aistudio/IMG_20261111_163435_a81dbab5.png';

export interface PdfSectionPreviewInfo {
  id: string;
  title: string;
  recordCount: number;
  highlight: string;
}

export interface PdfExportPreviewSummary {
  generatedAt: string;
  metrics: BackupFinancialMetrics;
  sections: PdfSectionPreviewInfo[];
  estimatedPages: number;
}

function formatPdfRs(amount: number): string {
  const num = Math.round((Number(amount) || 0) * 100) / 100;
  const sign = num < 0 ? '- ' : '';
  return `${sign}Rs. ${Math.abs(num).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;
}

function formatPdfDate(value?: string, includeTime = false): string {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function clipText(val: unknown, maxLen: number): string {
  const str = String(val ?? '').replace(/\s+/g, ' ').trim();
  if (!str) return '-';
  if (str.length <= maxLen) return str;
  return `${str.slice(0, Math.max(1, maxLen - 3))}...`;
}

/**
 * Safely fetches the Arjun Groceries logo asset and converts it to a Base64 PNG Data URL
 * for embedding inside jsPDF in browser environments. Returns null cleanly in Node/offline failures.
 */
export async function loadLogoDataUrl(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return null;
  }
  try {
    const res = await fetch(ARJUN_GROCERIES_LOGO_PATH);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Returns structured preview info for UI inspection before downloading PDF.
 */
export function buildPdfExportPreviewSummary(
  dataset: StoreBusinessDataset
): PdfExportPreviewSummary {
  const metrics = computeBackupFinancialMetrics(dataset);
  const purchaseRecordsCount = (dataset.supplierTransactions || []).filter(
    (st) => st.type === 'PURCHASE' || st.type === 'OPENING'
  ).length;

  const sections: PdfSectionPreviewInfo[] = [
    {
      id: 'summary',
      title: 'Financial Summary & Opening Balances',
      recordCount: 1,
      highlight: `Sales ${formatPdfRs(metrics.totalSales)} | Cash ${formatPdfRs(metrics.availableCash)}`,
    },
    {
      id: 'customers',
      title: 'Customers & Outstanding Udhar',
      recordCount: metrics.recordCounts.customers,
      highlight: `Receivable: ${formatPdfRs(metrics.totalCustomerOutstanding)}`,
    },
    {
      id: 'customerTx',
      title: 'Customer Transaction History',
      recordCount: metrics.recordCounts.customerTransactions,
      highlight: `${metrics.recordCounts.customerTransactions} ledger entries`,
    },
    {
      id: 'suppliers',
      title: 'Suppliers & Payable Balances',
      recordCount: metrics.recordCounts.suppliers,
      highlight: `Payable: ${formatPdfRs(metrics.totalSupplierOutstanding)}`,
    },
    {
      id: 'supplierTx',
      title: 'Supplier Purchase & Payment History',
      recordCount: metrics.recordCounts.supplierTransactions,
      highlight: `${metrics.recordCounts.supplierTransactions} supplier entries`,
    },
    {
      id: 'sales',
      title: 'Sales Bills & Payment Details',
      recordCount: metrics.recordCounts.salesBills,
      highlight: `${metrics.recordCounts.salesBills} invoices`,
    },
    {
      id: 'purchases',
      title: 'Purchase Records',
      recordCount: purchaseRecordsCount,
      highlight: `Total Purchases: ${formatPdfRs(metrics.totalPurchases)}`,
    },
    {
      id: 'expenses',
      title: 'Expenses with Categories',
      recordCount: metrics.recordCounts.expenses,
      highlight: `Operating: ${formatPdfRs(metrics.operatingExpenses)}`,
    },
    {
      id: 'cashbook',
      title: 'Cashbook (Rokad) Entries',
      recordCount: metrics.recordCounts.cashbookEntries,
      highlight: `Closing Cash: ${formatPdfRs(metrics.availableCash)}`,
    },
    {
      id: 'inventory',
      title: 'Inventory & Stock Quantities',
      recordCount: metrics.recordCounts.inventory,
      highlight: `Cost Value: ${formatPdfRs(metrics.inventoryCostValue)}`,
    },
  ];

  const totalRows =
    metrics.recordCounts.customers +
    metrics.recordCounts.customerTransactions +
    metrics.recordCounts.suppliers +
    metrics.recordCounts.supplierTransactions +
    metrics.recordCounts.salesBills +
    purchaseRecordsCount +
    metrics.recordCounts.expenses +
    metrics.recordCounts.cashbookEntries +
    metrics.recordCounts.inventory;

  const estimatedPages = Math.max(2, 1 + Math.ceil(totalRows / 30));

  return {
    generatedAt: metrics.generatedAt,
    metrics,
    sections,
    estimatedPages,
  };
}

interface PdfColDef {
  header: string;
  x: number;
  maxChars: number;
  align?: 'left' | 'right';
}

/**
 * Generates the comprehensive green-and-white Arjun Groceries Business Backup PDF Report.
 */
export function generateBackupReportPDF(
  dataset: StoreBusinessDataset,
  options?: { logoDataUrl?: string | null }
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const marginX = 10;
  const contentWidth = pageWidth - marginX * 2;
  const bottomSafeY = pageHeight - 16;

  const metrics = computeBackupFinancialMetrics(dataset);

  const customerMap = new Map<string, string>();
  for (const c of dataset.customers || []) customerMap.set(c.id, c.name);
  const supplierMap = new Map<string, string>();
  for (const s of dataset.suppliers || []) supplierMap.set(s.id, s.name);

  let y = 12;

  // ========== PAGE 1: BRAND HEADER & FINANCIAL SUMMARY ==========
  doc.setFillColor(6, 78, 59); // Emerald-900
  doc.roundedRect(marginX, y, contentWidth, 30, 2, 2, 'F');

  let textStartX = marginX + 5;
  if (options?.logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(marginX + 4, y + 3, 24, 24, 2, 2, 'F');
      doc.addImage(options.logoDataUrl, 'PNG', marginX + 5, y + 4, 22, 22);
      textStartX = marginX + 32;
    } catch {
      textStartX = marginX + 5;
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(metrics.storeName || 'Arjun Groceries', textStartX, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${dataset.profile?.tagline || 'Shop Smart • Save More'} | Owner: ${metrics.ownerName || 'Store Owner'}`,
    textStartX,
    y + 15
  );
  doc.text(
    `Phone: ${metrics.phone || 'N/A'} | UPI: ${metrics.upiId || 'Not Set'}`,
    textStartX,
    y + 20
  );
  doc.text(
    clipText(`Address: ${metrics.address || 'Local Store'}${metrics.gstin ? ` | GSTIN: ${metrics.gstin}` : ''}`, 88),
    textStartX,
    y + 25
  );

  // Right-aligned export badge
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text('COMPLETE BUSINESS REPORT', pageWidth - marginX - 4, y + 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(167, 243, 208);
  doc.text(`Generated: ${formatPdfDate(metrics.generatedAt, true)}`, pageWidth - marginX - 4, y + 16, {
    align: 'right',
  });
  doc.text('Local IndexedDB Snapshot', pageWidth - marginX - 4, y + 21, { align: 'right' });

  y += 34;

  // Non-restorable human-readable export notice
  doc.setFillColor(236, 253, 245); // Emerald-50
  doc.setDrawColor(110, 231, 183); // Emerald-300
  doc.roundedRect(marginX, y, contentWidth, 9, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(6, 95, 70);
  doc.text(
    'NOTE: This PDF is a human-readable report export of live Arjun Groceries records. Use the Full Recovery Backup (.json) file to restore your database.',
    marginX + 3,
    y + 5.7
  );

  y += 14;

  // Section Header: Executive Financial Summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(6, 78, 59);
  doc.text('EXECUTIVE FINANCIAL SUMMARY', marginX, y);
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.5);
  doc.line(marginX, y + 1.8, pageWidth - marginX, y + 1.8);
  doc.setLineWidth(0.2);

  y += 6;

  // KPI Cards Grid (2 rows x 3 cols)
  const kpiCards: Array<{ label: string; value: string; sub: string; accent: [number, number, number] }> = [
    {
      label: 'TOTAL SALES REVENUE',
      value: formatPdfRs(metrics.totalSales),
      sub: `${metrics.recordCounts.salesBills} Bills (Cash ${formatPdfRs(metrics.cashSales)} | UPI ${formatPdfRs(metrics.upiSales + metrics.bankSales)})`,
      accent: [6, 95, 70],
    },
    {
      label: 'CUSTOMER OUTSTANDING (UDHAR)',
      value: formatPdfRs(metrics.totalCustomerOutstanding),
      sub: `${metrics.customersWithDuesCount} customers with dues | Advance: ${formatPdfRs(metrics.totalCustomerAdvance)}`,
      accent: [185, 28, 28],
    },
    {
      label: 'SUPPLIER OUTSTANDING (PAYABLE)',
      value: formatPdfRs(metrics.totalSupplierOutstanding),
      sub: `${metrics.suppliersWithPayableCount} suppliers payable | Purchases: ${formatPdfRs(metrics.totalPurchases)}`,
      accent: [180, 83, 9],
    },
    {
      label: 'OPERATING EXPENSES',
      value: formatPdfRs(metrics.operatingExpenses),
      sub: `Personal Drawings: ${formatPdfRs(metrics.personalDrawings)} (${metrics.recordCounts.expenses} entries)`,
      accent: [190, 24, 93],
    },
    {
      label: 'AVAILABLE CASH (ROKAD)',
      value: formatPdfRs(metrics.availableCash),
      sub: `In: ${formatPdfRs(metrics.cashInflows)} | Out: ${formatPdfRs(metrics.cashOutflows)}`,
      accent: [4, 120, 87],
    },
    {
      label: 'INVENTORY STOCK VALUATION',
      value: formatPdfRs(metrics.inventoryCostValue),
      sub: `Retail: ${formatPdfRs(metrics.inventoryRetailValue)} | ${metrics.activeInventoryCount} active items`,
      accent: [15, 118, 110],
    },
  ];

  const cardGap = 4;
  const cardW = (contentWidth - cardGap * 2) / 3;
  const cardH = 21;

  kpiCards.forEach((card, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const cx = marginX + col * (cardW + cardGap);
    const cy = y + row * (cardH + 4);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(card.accent[0], card.accent[1], card.accent[2]);
    doc.rect(cx, cy, 1.6, cardH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(card.label, cx + 4, cy + 5.5);

    doc.setFontSize(11);
    doc.setTextColor(card.accent[0], card.accent[1], card.accent[2]);
    doc.text(card.value, cx + 4, cy + 12.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(clipText(card.sub, 42), cx + 4, cy + 18);
  });

  y += cardH * 2 + 12;

  // Opening Balances Card
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(marginX, y, contentWidth, 20, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(6, 78, 59);
  doc.text('OPENING BALANCES SUMMARY', marginX + 4, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  const thirdW = contentWidth / 3;
  doc.text(
    `Customer Opening Udhar: ${formatPdfRs(metrics.openingBalances.totalCustomerOpening)}`,
    marginX + 4,
    y + 13.5
  );
  doc.text(
    `Supplier Opening Payable: ${formatPdfRs(metrics.openingBalances.totalSupplierOpening)}`,
    marginX + thirdW + 4,
    y + 13.5
  );
  doc.text(
    `Opening Cash Drawer: ${formatPdfRs(metrics.openingBalances.cashOpeningBalance)}`,
    marginX + thirdW * 2 + 4,
    y + 13.5
  );

  y += 26;

  // Record Counts Table on Page 1
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(6, 78, 59);
  doc.text('INCLUDED RECORDS OVERVIEW', marginX, y);
  y += 4;

  const overviewRows: Array<[string, string, string]> = [
    ['Customers & Udhar Balances', String(metrics.recordCounts.customers), `Outstanding: ${formatPdfRs(metrics.totalCustomerOutstanding)}`],
    ['Customer Transaction History', String(metrics.recordCounts.customerTransactions), 'Credits, payments, returns & opening entries'],
    ['Suppliers & Payables', String(metrics.recordCounts.suppliers), `Payable: ${formatPdfRs(metrics.totalSupplierOutstanding)}`],
    ['Supplier Transactions & Payments', String(metrics.recordCounts.supplierTransactions), `Purchases + payments + returns`],
    ['Sales Bills', String(metrics.recordCounts.salesBills), `Total Revenue: ${formatPdfRs(metrics.totalSales)}`],
    ['Purchase Records', String(metrics.recordCounts.purchaseBills), `Total Purchases: ${formatPdfRs(metrics.totalPurchases)}`],
    ['Expenses & Drawings', String(metrics.recordCounts.expenses), `Operating: ${formatPdfRs(metrics.operatingExpenses)}`],
    ['Cashbook (Rokad) Entries', String(metrics.recordCounts.cashbookEntries), `Closing Cash: ${formatPdfRs(metrics.availableCash)}`],
    ['Inventory Items', String(metrics.recordCounts.inventory), `Low Stock Alerts: ${metrics.lowStockItemsCount}`],
    ['Bill Photos & PDF Attachments', String(metrics.recordCounts.billDocuments), `Stored securely in IndexedDB (${metrics.recordCounts.auditLogs} audit logs)`],
  ];

  doc.setFillColor(6, 95, 70);
  doc.rect(marginX, y, contentWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text('Section / Register', marginX + 3, y + 4.8);
  doc.text('Record Count', marginX + 105, y + 4.8, { align: 'right' });
  doc.text('Financial / Status Summary', marginX + 112, y + 4.8);
  y += 7;

  overviewRows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(240, 253, 244);
      doc.rect(marginX, y, contentWidth, 6, 'F');
    } else {
      doc.setFillColor(255, 255, 255);
      doc.rect(marginX, y, contentWidth, 6, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(row[0], marginX + 3, y + 4.2);
    doc.text(row[1], marginX + 105, y + 4.2, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(clipText(row[2], 60), marginX + 112, y + 4.2);
    y += 6;
  });

  // ========== HELPER FOR SECTION TABLES WITH REPEATING HEADERS ==========
  const startNewPageWithMiniHeader = (sectionTitle: string) => {
    doc.addPage();
    y = 12;
    doc.setFillColor(236, 253, 245);
    doc.rect(marginX, y, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 78, 59);
    doc.text(`${metrics.storeName} — ${sectionTitle} (cont.)`, marginX + 3, y + 4.8);
    doc.text(formatPdfDate(metrics.generatedAt), pageWidth - marginX - 3, y + 4.8, { align: 'right' });
    y += 10;
  };

  const renderTableSection = (
    sectionNumber: number,
    title: string,
    columns: PdfColDef[],
    rows: Array<Array<string | number>>,
    emptyMessage: string
  ) => {
    if (y + 24 > bottomSafeY) {
      doc.addPage();
      y = 14;
    } else {
      y += 6;
    }

    const drawSectionHeading = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(6, 78, 59);
      doc.text(`${sectionNumber}. ${title} (${rows.length})`, marginX, y);
      doc.setDrawColor(16, 185, 129);
      doc.line(marginX, y + 1.5, pageWidth - marginX, y + 1.5);
      y += 4;
    };

    const drawTableHeader = () => {
      doc.setFillColor(6, 95, 70);
      doc.rect(marginX, y, contentWidth, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      for (const col of columns) {
        doc.text(col.header, col.x, y + 4.5, { align: col.align || 'left' });
      }
      y += 6.5;
    };

    drawSectionHeading();

    if (rows.length === 0) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(marginX, y, contentWidth, 8, 'FD');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(emptyMessage, marginX + 3, y + 5.2);
      y += 10;
      return;
    }

    drawTableHeader();

    for (let i = 0; i < rows.length; i++) {
      if (y + 6 > bottomSafeY) {
        startNewPageWithMiniHeader(title);
        drawTableHeader();
      }

      if (i % 2 === 1) {
        doc.setFillColor(240, 253, 244);
        doc.rect(marginX, y, contentWidth, 5.5, 'F');
      } else {
        doc.setFillColor(255, 255, 255);
        doc.rect(marginX, y, contentWidth, 5.5, 'F');
      }

      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, y + 5.5, pageWidth - marginX, y + 5.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);

      const row = rows[i];
      columns.forEach((col, colIdx) => {
        const textVal = clipText(row[colIdx], col.maxChars);
        doc.text(textVal, col.x, y + 3.9, { align: col.align || 'left' });
      });

      y += 5.5;
    }
    y += 3;
  };

  // 1. Customers & Outstanding Balances
  renderTableSection(
    1,
    'Customer List & Outstanding Balances',
    [
      { header: 'Name', x: marginX + 2, maxChars: 24 },
      { header: 'Mobile', x: marginX + 46, maxChars: 14 },
      { header: 'Category', x: marginX + 74, maxChars: 12 },
      { header: 'Opening', x: marginX + 118, maxChars: 14, align: 'right' },
      { header: 'Credit', x: marginX + 144, maxChars: 14, align: 'right' },
      { header: 'Paid', x: marginX + 168, maxChars: 14, align: 'right' },
      { header: 'Udhar Bal', x: pageWidth - marginX - 2, maxChars: 15, align: 'right' },
    ],
    (dataset.customers || []).map((c) => [
      c.name,
      c.phone || '-',
      c.category || 'REGULAR',
      formatPdfRs(c.openingBalance),
      formatPdfRs(c.totalCreditGiven),
      formatPdfRs(c.totalPaymentReceived),
      formatPdfRs(c.currentBalance),
    ]),
    'No customers recorded.'
  );

  // 2. Customer Transaction History
  renderTableSection(
    2,
    'Customer Transaction History',
    [
      { header: 'Date', x: marginX + 2, maxChars: 12 },
      { header: 'Customer', x: marginX + 24, maxChars: 20 },
      { header: 'Type', x: marginX + 62, maxChars: 10 },
      { header: 'Mode', x: marginX + 82, maxChars: 8 },
      { header: 'Ref / Invoice', x: marginX + 98, maxChars: 15 },
      { header: 'Description', x: marginX + 126, maxChars: 26 },
      { header: 'Amount', x: pageWidth - marginX - 2, maxChars: 14, align: 'right' },
    ],
    (dataset.customerTransactions || []).map((tx) => [
      formatPdfDate(tx.date),
      customerMap.get(tx.customerId) || tx.customerId,
      tx.status === 'CANCELLED' ? 'CANCELLED' : tx.type,
      tx.paymentMethod || '-',
      tx.invoiceNo || tx.id.slice(-7),
      tx.description || '-',
      formatPdfRs(tx.amount),
    ]),
    'No customer transactions recorded.'
  );

  // 3. Supplier List & Outstanding Balances
  renderTableSection(
    3,
    'Supplier List & Outstanding Balances',
    [
      { header: 'Supplier Name', x: marginX + 2, maxChars: 24 },
      { header: 'Phone', x: marginX + 48, maxChars: 14 },
      { header: 'Terms', x: marginX + 76, maxChars: 12 },
      { header: 'Opening', x: marginX + 118, maxChars: 14, align: 'right' },
      { header: 'Purchases', x: marginX + 144, maxChars: 14, align: 'right' },
      { header: 'Paid', x: marginX + 168, maxChars: 14, align: 'right' },
      { header: 'Payable', x: pageWidth - marginX - 2, maxChars: 15, align: 'right' },
    ],
    (dataset.suppliers || []).map((s) => [
      s.name,
      s.phone || '-',
      s.creditTerms || '-',
      formatPdfRs(s.openingBalance),
      formatPdfRs(s.totalPurchases),
      formatPdfRs(s.totalPaid),
      formatPdfRs(s.currentBalance),
    ]),
    'No suppliers recorded.'
  );

  // 4. Supplier Purchase & Payment History
  renderTableSection(
    4,
    'Supplier Purchase & Payment History',
    [
      { header: 'Date', x: marginX + 2, maxChars: 12 },
      { header: 'Supplier', x: marginX + 24, maxChars: 20 },
      { header: 'Type', x: marginX + 62, maxChars: 10 },
      { header: 'Status', x: marginX + 82, maxChars: 10 },
      { header: 'Invoice No', x: marginX + 102, maxChars: 14 },
      { header: 'Description', x: marginX + 128, maxChars: 24 },
      { header: 'Amount', x: pageWidth - marginX - 2, maxChars: 14, align: 'right' },
    ],
    (dataset.supplierTransactions || []).map((tx) => [
      formatPdfDate(tx.date),
      supplierMap.get(tx.supplierId) || tx.supplierId,
      tx.type,
      tx.status === 'CANCELLED' ? 'CANCELLED' : tx.paymentStatus,
      tx.invoiceNo || tx.id.slice(-7),
      tx.description || '-',
      formatPdfRs(tx.amount),
    ]),
    'No supplier transactions recorded.'
  );

  // 5. Sales Bills & Payment Details
  renderTableSection(
    5,
    'Sales Bills & Payment Details',
    [
      { header: 'Invoice No', x: marginX + 2, maxChars: 14 },
      { header: 'Date', x: marginX + 30, maxChars: 12 },
      { header: 'Customer / Party', x: marginX + 54, maxChars: 22 },
      { header: 'Mode', x: marginX + 98, maxChars: 10 },
      { header: 'Items / Notes', x: marginX + 118, maxChars: 30 },
      { header: 'Amount', x: pageWidth - marginX - 2, maxChars: 15, align: 'right' },
    ],
    (dataset.sales || []).map((s) => [
      s.invoiceNo || s.id.slice(-7),
      formatPdfDate(s.date),
      s.customerName || (s.customerId ? customerMap.get(s.customerId) : '') || 'Walk-in',
      s.paymentMethod,
      s.items && s.items.length > 0
        ? s.items.map((it) => `${it.quantity}${it.unit} ${it.productName}`).join(', ')
        : s.notes || 'Counter Sale',
      formatPdfRs(s.amount),
    ]),
    'No sales bills recorded.'
  );

  // 6. Purchase Records
  const purchaseRecords = (dataset.supplierTransactions || []).filter(
    (st) => st.type === 'PURCHASE' || st.type === 'OPENING'
  );
  renderTableSection(
    6,
    'Purchase Records',
    [
      { header: 'Bill No', x: marginX + 2, maxChars: 14 },
      { header: 'Date', x: marginX + 30, maxChars: 12 },
      { header: 'Supplier', x: marginX + 54, maxChars: 22 },
      { header: 'Pay Status', x: marginX + 98, maxChars: 10 },
      { header: 'Items / Summary', x: marginX + 120, maxChars: 28 },
      { header: 'Amount', x: pageWidth - marginX - 2, maxChars: 15, align: 'right' },
    ],
    purchaseRecords.map((p) => [
      p.invoiceNo || p.id.slice(-7),
      formatPdfDate(p.date),
      supplierMap.get(p.supplierId) || p.supplierId,
      p.paymentStatus,
      p.itemsSummary || p.description || '-',
      formatPdfRs(p.amount),
    ]),
    'No purchase records recorded.'
  );

  // 7. Expenses with Categories
  renderTableSection(
    7,
    'Expenses with Categories',
    [
      { header: 'Date', x: marginX + 2, maxChars: 12 },
      { header: 'Title', x: marginX + 26, maxChars: 24 },
      { header: 'Category', x: marginX + 74, maxChars: 16 },
      { header: 'Type', x: marginX + 108, maxChars: 14 },
      { header: 'Mode', x: marginX + 136, maxChars: 10 },
      { header: 'Amount', x: pageWidth - marginX - 2, maxChars: 15, align: 'right' },
    ],
    (dataset.expenses || []).map((e) => [
      formatPdfDate(e.date),
      e.title,
      e.category,
      e.isPersonalWithdrawal || e.category === 'PERSONAL_DRAWING' ? 'Drawing' : 'Operating',
      e.paymentMethod,
      formatPdfRs(e.amount),
    ]),
    'No expenses recorded.'
  );

  // 8. Cashbook (Rokad) Entries
  renderTableSection(
    8,
    'Cashbook (Rokad) Entries',
    [
      { header: 'Date', x: marginX + 2, maxChars: 12 },
      { header: 'Dir', x: marginX + 26, maxChars: 6 },
      { header: 'Ref Type', x: marginX + 40, maxChars: 18 },
      { header: 'Description', x: marginX + 78, maxChars: 42 },
      { header: 'Amount', x: pageWidth - marginX - 2, maxChars: 15, align: 'right' },
    ],
    (dataset.cashbookEntries || []).map((cb) => [
      formatPdfDate(cb.date),
      cb.type,
      cb.refType,
      cb.description || '-',
      formatPdfRs(cb.amount),
    ]),
    'No cashbook entries recorded.'
  );

  // 9. Inventory & Stock Quantities
  renderTableSection(
    9,
    'Inventory & Stock Quantities',
    [
      { header: 'Product Name', x: marginX + 2, maxChars: 28 },
      { header: 'Category', x: marginX + 58, maxChars: 16 },
      { header: 'Stock', x: marginX + 106, maxChars: 12, align: 'right' },
      { header: 'Cost Price', x: marginX + 134, maxChars: 14, align: 'right' },
      { header: 'Sell Price', x: marginX + 162, maxChars: 14, align: 'right' },
      { header: 'Stock Value', x: pageWidth - marginX - 2, maxChars: 15, align: 'right' },
    ],
    (dataset.products || []).map((p) => [
      p.isArchived ? `[ARC] ${p.name}` : p.name,
      p.category,
      `${p.stockQty} ${p.unit}`,
      formatPdfRs(p.purchasePrice),
      formatPdfRs(p.sellingPrice),
      formatPdfRs((Number(p.stockQty) || 0) * (Number(p.purchasePrice) || 0)),
    ]),
    'No inventory products recorded.'
  );

  // ========== PAGE NUMBERS & FOOTER ON ALL PAGES ==========
  const totalPages = doc.getNumberOfPages();
  for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
    doc.setPage(pageNo);
    doc.setDrawColor(167, 243, 208);
    doc.line(marginX, pageHeight - 11, pageWidth - marginX, pageHeight - 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `${metrics.storeName} · Local Business Report · Generated ${formatPdfDate(metrics.generatedAt, true)}`,
      marginX,
      pageHeight - 6.5
    );

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(6, 78, 59);
    doc.text(`Page ${pageNo} of ${totalPages}`, pageWidth - marginX, pageHeight - 6.5, {
      align: 'right',
    });
  }

  return doc;
}

/**
 * Generates raw PDF binary bytes (`Uint8Array`) for download, preview Blob URL, or Android Share Sheet.
 */
export async function exportBackupReportPdfBytes(
  dataset: StoreBusinessDataset,
  options?: { logoDataUrl?: string | null }
): Promise<Uint8Array> {
  const logoDataUrl =
    options && 'logoDataUrl' in options ? options.logoDataUrl : await loadLogoDataUrl();
  const doc = generateBackupReportPDF(dataset, { logoDataUrl });
  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}
