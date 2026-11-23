/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import {
  Customer,
  CustomerLedgerSummary,
  CustomerTransaction,
  SaleRecord,
  StoreProfile,
  Supplier,
  SupplierLedgerSummary,
  SupplierTransaction,
} from '../types';
import {
  calculateCustomerLedgerWithRunningBalance,
  calculateMonthlyCustomerStatement,
  calculateSupplierLedgerWithRunningBalance,
  getLocalTodayKey,
  resolveSupplierPurchaseUpfrontPaid,
} from './accounting';
import { getPurchaseReturnReasonLabel } from './purchaseReturns';

/**
 * Formats currency amount safely for jsPDF standard font rendering.
 */
function formatPDFCurrency(amount: number): string {
  const num = Math.round(Number(amount || 0) * 100) / 100;
  return `Rs. ${num.toLocaleString('en-IN')}`;
}

/**
 * Generates an official Customer Udhar Statement PDF.
 */
/**
 * Generates an official Customer Udhar Statement / Ledger PDF.
 */
export function generateCustomerUdharStatementPDF(
  customer: Customer,
  transactionsOrSummary: CustomerTransaction[] | CustomerLedgerSummary,
  profile: StoreProfile
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const summary: CustomerLedgerSummary = Array.isArray(transactionsOrSummary)
    ? calculateCustomerLedgerWithRunningBalance(customer, transactionsOrSummary)
    : transactionsOrSummary;

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header Banner
  doc.setFillColor(6, 78, 59); // Emerald-900
  doc.rect(10, y, pageWidth - 20, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(profile.storeName || 'Arjun Groceries', 14, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${profile.address || 'Kirana Bazar'} | Contact: ${profile.phone || ''} | UPI: ${profile.upiId || 'Not Configured'}`,
    14,
    y + 14
  );
  if (profile.gstin) {
    doc.text(`GSTIN: ${profile.gstin}`, 14, y + 19);
  }

  y += 28;

  // Document Title
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('CUSTOMER UDHAR KHATA STATEMENT / GRAHAK PARCHI', 10, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const dateFormatted = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.text(`Generated: ${dateFormatted}`, pageWidth - 10, y, { align: 'right' });

  y += 5;

  // Customer Profile & Balance Snapshot Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 26, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Customer: ${customer.name}`, 14, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Mobile: ${customer.phone || 'N/A'}`, 14, y + 12);
  doc.text(`Address: ${customer.address || 'Local Customer'}`, 14, y + 17);
  doc.text(`Category: ${customer.category || 'REGULAR'} (${customer.overdueDays || 0} days overdue) | Status: ${summary.status}`, 14, y + 22);

  // Outstanding Balance Callout
  const isAdvance = summary.closingBalance < 0;
  if (isAdvance) {
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
  } else if (summary.closingBalance === 0) {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
  } else {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 202, 202);
  }
  doc.rect(pageWidth - 75, y + 3, 60, 20, 'FD');

  if (isAdvance) {
    doc.setTextColor(5, 150, 105);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('ADVANCE BALANCE (JAMA)', pageWidth - 45, y + 8, { align: 'center' });
    doc.setFontSize(12);
    doc.text(formatPDFCurrency(Math.abs(summary.closingBalance)), pageWidth - 45, y + 16, { align: 'center' });
  } else if (summary.closingBalance === 0) {
    doc.setTextColor(22, 101, 52);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('ALL DUES CLEARED (HISAB NIL)', pageWidth - 45, y + 8, { align: 'center' });
    doc.setFontSize(12);
    doc.text('Rs. 0', pageWidth - 45, y + 16, { align: 'center' });
  } else {
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('CURRENT UDHAR PENDING', pageWidth - 45, y + 8, { align: 'center' });
    doc.setFontSize(12);
    doc.text(formatPDFCurrency(summary.closingBalance), pageWidth - 45, y + 16, { align: 'center' });
  }

  y += 32;

  // Account Ledger Breakdown Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Transaction Ledger (${summary.filteredEntriesCount} Entries)`, 10, y);

  y += 3;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);

  doc.text('Date & Time', 12, y + 5);
  doc.text('Ref / Bill No', 38, y + 5);
  doc.text('Type', 66, y + 5);
  doc.text('Description / Items', 84, y + 5);
  doc.text('Debit (+)', 142, y + 5, { align: 'right' });
  doc.text('Credit (-)', 166, y + 5, { align: 'right' });
  doc.text('Running Bal', pageWidth - 14, y + 5, { align: 'right' });

  y += 7;

  // Initial opening balance row if non-zero
  if (summary.openingBalance > 0) {
    doc.setFillColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(customer.createdAt ? customer.createdAt.replace('T', ' ').substring(0, 16) : '-', 12, y + 5);
    doc.text('OPENING', 38, y + 5);
    doc.text('OPENING', 66, y + 5);
    doc.text('Opening account balance carryforward', 84, y + 5);
    doc.text(formatPDFCurrency(summary.openingBalance), 142, y + 5, { align: 'right' });
    doc.text('-', 166, y + 5, { align: 'right' });
    doc.text(formatPDFCurrency(summary.openingBalance), pageWidth - 14, y + 5, { align: 'right' });
    y += 6;
  }

  // Transaction rows
  summary.entries.forEach((tx, idx) => {
    if (y > 260) {
      doc.addPage();
      y = 15;
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(10, y, pageWidth - 20, 6, 'F');
    }

    const isCredit = tx.type === 'CREDIT';
    const isPaymentOrReturn = tx.type === 'PAYMENT' || tx.type === 'RETURN';
    const debitAmt = isCredit ? tx.amount : 0;
    const creditAmt = isPaymentOrReturn ? tx.amount : 0;

    const txDateStr = tx.date ? tx.date.replace('T', ' ').substring(0, 16) : '-';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);

    doc.text(txDateStr, 12, y + 4.5);
    doc.text(tx.invoiceNo || `TX-${tx.id.slice(-5)}`, 38, y + 4.5);

    if (tx.isCancelled || tx.status === 'CANCELLED') {
      doc.setTextColor(148, 163, 184); // Gray
      doc.text('CANCELLED', 66, y + 4.5);
    } else if (isCredit) {
      doc.setTextColor(185, 28, 28); // Red
      doc.text('CREDIT', 66, y + 4.5);
    } else if (tx.type === 'RETURN') {
      doc.setTextColor(217, 119, 6); // Amber
      doc.text('RETURN', 66, y + 4.5);
    } else {
      doc.setTextColor(21, 128, 61); // Green
      doc.text(`PAID (${tx.paymentMethod || 'CASH'})`, 66, y + 4.5);
    }

    doc.setTextColor(tx.isCancelled ? 148 : 71, tx.isCancelled ? 163 : 85, tx.isCancelled ? 184 : 105);
    const desc = tx.isCancelled
      ? `[CANCELLED] ${tx.cancelReason || tx.description || 'Cancelled'}`
      : (tx.description || tx.itemsSummary || 'Counter transaction');
    doc.text(desc.length > 30 ? desc.substring(0, 30) + '...' : desc, 84, y + 4.5);

    doc.setTextColor(30, 41, 59);
    if (tx.isCancelled) {
      doc.setTextColor(148, 163, 184);
      doc.text('-', 142, y + 4.5, { align: 'right' });
      doc.text('-', 166, y + 4.5, { align: 'right' });
    } else {
      doc.text(debitAmt > 0 ? formatPDFCurrency(debitAmt) : '-', 142, y + 4.5, { align: 'right' });
      doc.text(creditAmt > 0 ? formatPDFCurrency(creditAmt) : '-', 166, y + 4.5, { align: 'right' });
    }
    doc.text(formatPDFCurrency(tx.runningBalance), pageWidth - 14, y + 4.5, { align: 'right' });

    y += 6;
  });

  // Total Summary Footer Box
  y = Math.max(y + 4, 235);
  if (y > 255) {
    doc.addPage();
    y = 15;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, pageWidth - 10, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Please verify and pay via UPI: ' + (profile.upiId || 'Shop Counter'), 10, y + 4);
  doc.text('Thank you for shopping at ' + (profile.storeName || 'Arjun Groceries'), 10, y + 8);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Authorized Signature & Shop Stamp', pageWidth - 65, y + 4);
  doc.line(pageWidth - 65, y + 16, pageWidth - 15, y + 16);

  return doc;
}

/**
 * Triggers direct download of Customer Udhar Statement PDF.
 */
export function downloadCustomerUdharStatementPDF(
  customer: Customer,
  transactionsOrSummary: CustomerTransaction[] | CustomerLedgerSummary,
  profile: StoreProfile,
  filename?: string
): void {
  const doc = generateCustomerUdharStatementPDF(customer, transactionsOrSummary, profile);
  const safeName = customer.name.replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = getLocalTodayKey();
  const finalFilename = filename || `arjun_groceries_customer_ledger_${safeName}_${dateStr}.pdf`;
  doc.save(finalFilename);
}

/**
 * Generates an official Supplier Purchase & Payment Ledger PDF.
 */
export function generateSupplierLedgerPDF(
  supplier: Supplier,
  transactionsOrSummary: SupplierTransaction[] | SupplierLedgerSummary,
  profile: StoreProfile
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const summary: SupplierLedgerSummary = Array.isArray(transactionsOrSummary)
    ? calculateSupplierLedgerWithRunningBalance(supplier, transactionsOrSummary)
    : transactionsOrSummary;

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header Banner
  doc.setFillColor(6, 78, 59); // Emerald-900
  doc.rect(10, y, pageWidth - 20, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(profile.storeName || 'Arjun Groceries', 14, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${profile.address || 'Kirana Bazar'} | Contact: ${profile.phone || ''} | UPI: ${profile.upiId || 'Not Configured'}`,
    14,
    y + 14
  );
  if (profile.gstin) {
    doc.text(`GSTIN: ${profile.gstin}`, 14, y + 19);
  }

  y += 28;

  // Document Title
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('SUPPLIER PURCHASE & PAYMENT LEDGER / VYAPARI BIKRI KHATA', 10, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const dateFormatted = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.text(`Generated: ${dateFormatted}`, pageWidth - 10, y, { align: 'right' });

  y += 5;

  // Supplier Profile & Balance Snapshot Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 26, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Supplier: ${supplier.name}`, 14, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Contact: ${supplier.contactPerson || 'N/A'} | Phone: ${supplier.phone || 'N/A'}`, 14, y + 12);
  doc.text(`Address: ${supplier.address || 'Wholesale Mandi'}`, 14, y + 17);
  doc.text(`GSTIN: ${supplier.gstin || 'Unregistered'} | Status: ${summary.status}`, 14, y + 22);

  // Outstanding Payable Callout
  const isAdvance = summary.closingBalance < 0;
  if (isAdvance) {
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
  } else if (summary.closingBalance === 0) {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
  } else {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 202, 202);
  }
  doc.rect(pageWidth - 75, y + 3, 60, 20, 'FD');

  if (isAdvance) {
    doc.setTextColor(5, 150, 105);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('ADVANCE PAID TO SUPPLIER', pageWidth - 45, y + 8, { align: 'center' });
    doc.setFontSize(12);
    doc.text(formatPDFCurrency(Math.abs(summary.closingBalance)), pageWidth - 45, y + 16, { align: 'center' });
  } else if (summary.closingBalance === 0) {
    doc.setTextColor(22, 101, 52);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('ALL DUES SETTLED (HISAB NIL)', pageWidth - 45, y + 8, { align: 'center' });
    doc.setFontSize(12);
    doc.text('Rs. 0', pageWidth - 45, y + 16, { align: 'center' });
  } else {
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('CURRENT PAYABLE DUES', pageWidth - 45, y + 8, { align: 'center' });
    doc.setFontSize(12);
    doc.text(formatPDFCurrency(summary.closingBalance), pageWidth - 45, y + 16, { align: 'center' });
  }

  y += 32;

  // Account Ledger Breakdown Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Supplier Ledger (${summary.filteredEntriesCount} Entries)`, 10, y);

  y += 3;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);

  doc.text('Date & Time', 12, y + 5);
  doc.text('Bill / Inv No', 38, y + 5);
  doc.text('Type', 66, y + 5);
  doc.text('Description', 84, y + 5);
  doc.text('Purchase (+)', 142, y + 5, { align: 'right' });
  doc.text('Paid (-)', 166, y + 5, { align: 'right' });
  doc.text('Running Bal', pageWidth - 14, y + 5, { align: 'right' });

  y += 7;

  // Initial opening balance row if non-zero
  if (summary.openingBalance > 0) {
    doc.setFillColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(supplier.createdAt ? supplier.createdAt.replace('T', ' ').substring(0, 16) : '-', 12, y + 5);
    doc.text('OPENING', 38, y + 5);
    doc.text('OPENING', 66, y + 5);
    doc.text('Opening payable carryforward', 84, y + 5);
    doc.text(formatPDFCurrency(summary.openingBalance), 142, y + 5, { align: 'right' });
    doc.text('-', 166, y + 5, { align: 'right' });
    doc.text(formatPDFCurrency(summary.openingBalance), pageWidth - 14, y + 5, { align: 'right' });
    y += 6;
  }

  // Transaction rows
  summary.entries.forEach((tx, idx) => {
    if (y > 260) {
      doc.addPage();
      y = 15;
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(10, y, pageWidth - 20, 6, 'F');
    }

    const isOpening = tx.type === 'OPENING';
    const isPurchase = tx.type === 'PURCHASE' || isOpening;
    const isPaymentOrReturn = tx.type === 'PAYMENT' || tx.type === 'RETURN';
    const upfrontPaid =
      tx.type === 'PURCHASE'
        ? tx.upfrontPaidAmount !== undefined
          ? tx.upfrontPaidAmount
          : resolveSupplierPurchaseUpfrontPaid(tx)
        : 0;
    const debitAmt = isPurchase
      ? tx.purchaseAmount ?? tx.amount
      : tx.type === 'ADJUSTMENT' && tx.purchaseAmount > 0
      ? tx.purchaseAmount
      : 0;
    const creditAmt = isPaymentOrReturn
      ? tx.paymentAmount ?? tx.amount
      : tx.type === 'PURCHASE'
      ? upfrontPaid
      : tx.type === 'ADJUSTMENT' && tx.paymentAmount > 0
      ? tx.paymentAmount
      : 0;

    const txDateStr = tx.date ? tx.date.replace('T', ' ').substring(0, 16) : '-';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);

    doc.text(txDateStr, 12, y + 4.5);
    doc.text(tx.invoiceNo || (isOpening ? 'OPENING' : `BILL-${tx.id.slice(-5)}`), 38, y + 4.5);

    if (tx.isCancelled || tx.status === 'CANCELLED') {
      doc.setTextColor(148, 163, 184); // Gray
      doc.text('CANCELLED', 66, y + 4.5);
    } else if (isOpening) {
      doc.setTextColor(71, 85, 105);
      doc.text('OPENING', 66, y + 4.5);
    } else if (tx.type === 'PURCHASE') {
      doc.setTextColor(185, 28, 28); // Red
      doc.text(
        upfrontPaid > 0 ? `PURCHASE (${tx.paymentStatus})` : 'PURCHASE',
        66,
        y + 4.5
      );
    } else if (tx.type === 'RETURN') {
      doc.setTextColor(217, 119, 6); // Amber
      doc.text('RETURN', 66, y + 4.5);
    } else if (tx.type === 'ADJUSTMENT') {
      doc.setTextColor(71, 85, 105);
      doc.text('ADJUSTMENT', 66, y + 4.5);
    } else {
      doc.setTextColor(21, 128, 61); // Green
      doc.text(`PAID (${tx.paymentMethod || 'CASH'})`, 66, y + 4.5);
    }

    doc.setTextColor(tx.isCancelled ? 148 : 71, tx.isCancelled ? 163 : 85, tx.isCancelled ? 184 : 105);
    const desc = tx.isCancelled
      ? `[CANCELLED] ${tx.cancelReason || tx.description || 'Cancelled'}`
      : (tx.description || 'Stock supply transaction');
    doc.text(desc.length > 30 ? desc.substring(0, 30) + '...' : desc, 84, y + 4.5);

    doc.setTextColor(30, 41, 59);
    if (tx.isCancelled) {
      doc.setTextColor(148, 163, 184);
      doc.text('-', 142, y + 4.5, { align: 'right' });
      doc.text('-', 166, y + 4.5, { align: 'right' });
    } else {
      doc.text(debitAmt > 0 ? formatPDFCurrency(debitAmt) : '-', 142, y + 4.5, { align: 'right' });
      doc.text(creditAmt > 0 ? formatPDFCurrency(creditAmt) : '-', 166, y + 4.5, { align: 'right' });
    }
    doc.text(formatPDFCurrency(tx.runningBalance), pageWidth - 14, y + 4.5, { align: 'right' });

    y += 6;
  });

  // Total Summary Footer Box
  y = Math.max(y + 4, 235);
  if (y > 255) {
    doc.addPage();
    y = 15;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, pageWidth - 10, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Payment settlements recorded by: ' + (profile.storeName || 'Arjun Groceries'), 10, y + 4);
  doc.text('Contact store owner: ' + (profile.phone || 'Counter Desk'), 10, y + 8);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Authorized Store Signature & Stamp', pageWidth - 65, y + 4);
  doc.line(pageWidth - 65, y + 16, pageWidth - 15, y + 16);

  return doc;
}

/**
 * Triggers direct download of Supplier Ledger PDF.
 */
export function downloadSupplierLedgerPDF(
  supplier: Supplier,
  transactionsOrSummary: SupplierTransaction[] | SupplierLedgerSummary,
  profile: StoreProfile,
  filename?: string
): void {
  const doc = generateSupplierLedgerPDF(supplier, transactionsOrSummary, profile);
  const safeName = supplier.name.replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = getLocalTodayKey();
  const finalFilename = filename || `arjun_groceries_supplier_ledger_${safeName}_${dateStr}.pdf`;
  doc.save(finalFilename);
}

/**
 * Generates a comprehensive Daily Sales Report PDF.
 */
export function generateDailySalesReportPDF(
  sales: SaleRecord[],
  profile: StoreProfile,
  dateFilterLabel = 'Today',
  costRevenueSummary?: {
    totalSales: number;
    totalCOGS: number;
    grossProfit: number;
    grossMarginPct: number;
    costCoveragePct?: number;
    uncostedRevenue?: number;
    hasCompleteCogs?: boolean;
    reviewStatus?: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
    isProfitVerified?: boolean;
    knownCostGrossProfit?: number | null;
    knownCostGrossMarginPct?: number | null;
  }
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header Banner
  doc.setFillColor(6, 78, 59); // Emerald-900
  doc.rect(10, y, pageWidth - 20, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(profile.storeName || 'Arjun Groceries', 14, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `Daily Sales Register | ${profile.address || ''} | Phone: ${profile.phone || ''}`,
    14,
    y + 14
  );
  if (profile.gstin) {
    doc.text(`GSTIN: ${profile.gstin}`, 14, y + 19);
  }

  y += 28;

  // Report Title
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`DAILY COUNTER SALES REPORT (${dateFilterLabel.toUpperCase()})`, 10, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    pageWidth - 10,
    y,
    { align: 'right' }
  );

  y += 5;

  // Aggregate Sales KPIs (exclude CANCELLED / REVERSED bills)
  const activeSales = sales.filter((s) => s.status !== 'CANCELLED' && s.status !== 'REVERSED');
  const totalSalesAmount = activeSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const cashSales = activeSales
    .filter((s) => s.paymentMethod === 'CASH')
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const upiSales = activeSales
    .filter((s) => s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK')
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const creditSales = activeSales
    .filter((s) => s.paymentMethod === 'CREDIT' || s.isCredit)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  // KPI Grid
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 20, 'FD');

  const colW = (pageWidth - 20) / 4;

  // Total Sales
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('TOTAL REVENUE', 14, y + 6);
  doc.setFontSize(11);
  doc.setTextColor(6, 78, 59);
  doc.text(formatPDFCurrency(totalSalesAmount), 14, y + 14);

  // Cash
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('CASH SALES', 14 + colW, y + 6);
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(formatPDFCurrency(cashSales), 14 + colW, y + 14);

  // UPI / Bank
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('UPI / BANK SALES', 14 + colW * 2, y + 6);
  doc.setFontSize(11);
  doc.setTextColor(30, 64, 175);
  doc.text(formatPDFCurrency(upiSales), 14 + colW * 2, y + 14);

  // Credit / Udhar
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('CREDIT / UDHAR', 14 + colW * 3, y + 6);
  doc.setFontSize(11);
  doc.setTextColor(185, 28, 28);
  doc.text(formatPDFCurrency(creditSales), 14 + colW * 3, y + 14);

  y += 25;

  // Bill-by-Bill Itemized Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Counter Invoices (${activeSales.length} Active Bills)`, 10, y);

  y += 3;

  // Table Headers
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);

  doc.text('Bill No', 12, y + 5);
  doc.text('Date / Time', 34, y + 5);
  doc.text('Customer / Party', 65, y + 5);
  doc.text('Mode', 110, y + 5);
  doc.text('Items Summary', 130, y + 5);
  doc.text('Amount (Rs)', pageWidth - 14, y + 5, { align: 'right' });

  y += 7;

  activeSales.forEach((s, idx) => {
    if (y > 265) {
      doc.addPage();
      y = 15;
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(10, y, pageWidth - 20, 6, 'F');
    }

    const timeStr = s.date
      ? new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const dateStr = s.date ? s.date.split('T')[0] : '';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    doc.text(s.invoiceNo || `BILL-${s.id.slice(-5)}`, 12, y + 4.5);
    doc.text(`${dateStr} ${timeStr}`, 34, y + 4.5);

    const party = s.customerName || (s.isCredit ? 'Credit Customer' : 'Counter Walk-in');
    doc.text(party.length > 22 ? party.substring(0, 22) + '...' : party, 65, y + 4.5);

    doc.setFont('helvetica', 'bold');
    if (s.paymentMethod === 'CASH') doc.setTextColor(21, 128, 61);
    else if (s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK') doc.setTextColor(30, 64, 175);
    else doc.setTextColor(185, 28, 28);
    doc.text(s.paymentMethod || 'CASH', 110, y + 4.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    const itemsSummary = s.items && s.items.length > 0
      ? s.items.map((it) => `${it.quantity} ${it.unit || ''} ${it.productName}`).join(', ')
      : s.notes || 'Groceries';
    doc.text(itemsSummary.length > 28 ? itemsSummary.substring(0, 28) + '...' : itemsSummary, 130, y + 4.5);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.text(formatPDFCurrency(s.amount || 0), pageWidth - 14, y + 4.5, { align: 'right' });

    y += 6;
  });

  // Footer & Profit Summary
  y = Math.max(y + 6, 245);
  if (y > 260) {
    doc.addPage();
    y = 15;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, pageWidth - 10, y);
  y += 5;

  if (costRevenueSummary) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const hasExplicitCoverageFlags =
      costRevenueSummary.isProfitVerified !== undefined ||
      costRevenueSummary.hasCompleteCogs !== undefined ||
      costRevenueSummary.reviewStatus !== undefined;

    if (
      hasExplicitCoverageFlags &&
      (costRevenueSummary.isProfitVerified === false ||
        costRevenueSummary.hasCompleteCogs === false ||
        (costRevenueSummary.reviewStatus && costRevenueSummary.reviewStatus !== 'RECONCILED'))
    ) {
      const cov = costRevenueSummary.costCoveragePct ?? 0;
      const uncosted = costRevenueSummary.uncostedRevenue ?? 0;
      const status = costRevenueSummary.reviewStatus || 'UNCOSTED';
      if (cov <= 0 || costRevenueSummary.knownCostGrossProfit === null || costRevenueSummary.knownCostGrossProfit === undefined) {
        doc.setTextColor(180, 83, 9);
        doc.text(
          `Gross Profit: UNVERIFIED (${cov}% COGS coverage | Uncosted Sales: ${formatPDFCurrency(uncosted)} | Status: ${status})`,
          10,
          y + 4
        );
      } else {
        doc.setTextColor(180, 83, 9);
        doc.text(
          `Provisional Known-Cost Gross Profit: ${formatPDFCurrency(costRevenueSummary.knownCostGrossProfit)} (${costRevenueSummary.knownCostGrossMarginPct ?? 0}% on costed | ${cov}% costed | Uncosted: ${formatPDFCurrency(uncosted)} | ${status})`,
          10,
          y + 4
        );
      }
    } else {
      doc.setTextColor(6, 78, 59);
      doc.text(
        `Estimated Gross Profit: ${formatPDFCurrency(costRevenueSummary.grossProfit)} (Gross Margin: ${costRevenueSummary.grossMarginPct}%)`,
        10,
        y + 4
      );
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Certified authentic counter sales register. Arjun Groceries Digital Management System.', 10, y + 8);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Store Manager / Owner Signature', pageWidth - 65, y + 4);
  doc.line(pageWidth - 65, y + 16, pageWidth - 15, y + 16);

  return doc;
}

/**
 * Triggers direct download of Daily Sales Report PDF.
 */
export function downloadDailySalesReportPDF(
  sales: SaleRecord[],
  profile: StoreProfile,
  dateFilterLabel = 'Today',
  costRevenueSummary?: {
    totalSales: number;
    totalCOGS: number;
    grossProfit: number;
    grossMarginPct: number;
    costCoveragePct?: number;
    uncostedRevenue?: number;
    hasCompleteCogs?: boolean;
    reviewStatus?: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
    isProfitVerified?: boolean;
    knownCostGrossProfit?: number | null;
    knownCostGrossMarginPct?: number | null;
  },
  filename?: string
): void {
  const doc = generateDailySalesReportPDF(sales, profile, dateFilterLabel, costRevenueSummary);
  const dateStr = getLocalTodayKey();
  const finalFilename = filename || `arjun-groceries-sales-report-${dateStr}.pdf`;
  doc.save(finalFilename);
}

/**
 * Generates an official Tax Invoice / Cash Memo PDF for a single sale.
 */
export function generateSaleInvoicePDF(
  sale: SaleRecord,
  profile: StoreProfile,
  customer?: Customer
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header Banner
  doc.setFillColor(6, 78, 59); // Emerald-900
  doc.rect(10, y, pageWidth - 20, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(profile.storeName || 'Arjun Groceries', 14, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${profile.address || 'Retail Kirana'} | Phone: ${profile.phone || ''} | UPI: ${profile.upiId || 'Store Counter'}`,
    14,
    y + 14
  );
  if (profile.gstin) {
    doc.text(`GSTIN: ${profile.gstin}`, 14, y + 19);
  }

  // Right side header label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  const invoiceTypeTitle = sale.isCredit ? 'CREDIT SALE / UDHAR BILL' : 'RETAIL TAX INVOICE / CASH MEMO';
  doc.text(invoiceTypeTitle, pageWidth - 14, y + 10, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(167, 243, 208);
  doc.text(`Original for Recipient`, pageWidth - 14, y + 16, { align: 'right' });

  y += 30;

  // Invoice & Customer Metadata Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 28, 'FD');

  const halfWidth = (pageWidth - 20) / 2;

  // Left Column: Bill Information
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('INVOICE DETAILS:', 14, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Bill No: #${sale.invoiceNo}`, 14, y + 12);

  const saleDateStr = new Date(sale.date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Date & Time: ${saleDateStr}`, 14, y + 17);

  doc.text(`Payment Mode: ${sale.paymentMethod}`, 14, y + 22);

  // Status Badge in Metadata Box
  if (sale.isCredit) {
    doc.setTextColor(185, 28, 28);
    doc.setFont('helvetica', 'bold');
    doc.text(`Status: UNPAID (ADDED TO UDHAR KHATA)`, 14, y + 26);
  } else {
    doc.setTextColor(21, 128, 61);
    doc.setFont('helvetica', 'bold');
    doc.text(`Status: FULLY PAID (${sale.paymentMethod})`, 14, y + 26);
  }

  // Right Column: Billed To Customer
  const rightColX = 14 + halfWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('BILLED TO (CUSTOMER):', rightColX, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  const custName = sale.customerName || customer?.name || 'Walk-in Cash Customer';
  doc.text(custName, rightColX, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const custPhone = customer?.phone || 'Direct Counter Sale';
  doc.text(`Phone: ${custPhone}`, rightColX, y + 17);
  if (customer?.address) {
    doc.text(`Address: ${customer.address.substring(0, 35)}`, rightColX, y + 22);
  }

  if (customer && customer.currentBalance > 0) {
    doc.setTextColor(185, 28, 28);
    doc.setFont('helvetica', 'bold');
    doc.text(`Current Ledger Balance: ${formatPDFCurrency(customer.currentBalance)}`, rightColX, y + 26);
  }

  y += 34;

  // Itemized Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);

  doc.text('#', 13, y + 5);
  doc.text('Item Description', 24, y + 5);
  doc.text('Qty / Unit', 105, y + 5);
  doc.text('Rate (Rs)', 135, y + 5, { align: 'right' });
  doc.text('Discount', 160, y + 5, { align: 'right' });
  doc.text('Amount (Rs)', pageWidth - 14, y + 5, { align: 'right' });

  y += 7;

  // Item rows
  const items = sale.items && sale.items.length > 0 ? sale.items : null;

  if (items && items.length > 0) {
    items.forEach((it, idx) => {
      if (y > 255) {
        doc.addPage();
        y = 15;
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(10, y, pageWidth - 20, 6, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);

      doc.text(String(idx + 1), 13, y + 4.5);
      const name = it.productName.length > 40 ? it.productName.substring(0, 40) + '...' : it.productName;
      doc.text(name, 24, y + 4.5);
      doc.text(`${it.quantity} ${it.unit || ''}`, 105, y + 4.5);
      doc.text(it.rate ? Number(it.rate).toFixed(2) : '-', 135, y + 4.5, { align: 'right' });
      doc.text(it.discount && it.discount > 0 ? `${formatPDFCurrency(it.discount)}` : '-', 160, y + 4.5, {
        align: 'right',
      });
      doc.setFont('helvetica', 'bold');
      doc.text(formatPDFCurrency(it.total), pageWidth - 14, y + 4.5, { align: 'right' });

      y += 6;
    });
  } else {
    // Single row for quick bill without itemized list
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text('1', 13, y + 4.5);
    doc.text(sale.notes || 'Groceries / Counter Items', 24, y + 4.5);
    doc.text('1 Lot', 105, y + 4.5);
    doc.text(Number(sale.amount).toFixed(2), 135, y + 4.5, { align: 'right' });
    doc.text('-', 160, y + 4.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatPDFCurrency(sale.amount), pageWidth - 14, y + 4.5, { align: 'right' });
    y += 6;
  }

  // Total Summary Box
  y = Math.max(y + 6, 175);
  if (y > 240) {
    doc.addPage();
    y = 15;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, pageWidth - 10, y);
  y += 4;

  // Left note & Right totals
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Remarks / Notes:', 14, y + 4);
  doc.setTextColor(51, 65, 85);
  doc.text(sale.notes || 'Thank you for your business!', 14, y + 9);

  // Total Box
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(187, 247, 208);
  doc.rect(pageWidth - 85, y, 75, 20, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(6, 78, 59);
  doc.text('TOTAL AMOUNT PAYABLE:', pageWidth - 80, y + 6);

  doc.setFontSize(13);
  doc.setTextColor(6, 78, 59);
  doc.text(formatPDFCurrency(sale.amount), pageWidth - 14, y + 15, { align: 'right' });

  y += 28;

  // Bottom Terms & Stamp
  doc.setDrawColor(226, 232, 240);
  doc.line(10, y, pageWidth - 10, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('1. Goods once sold will not be exchanged or returned without bill.', 14, y + 3);
  doc.text('2. Please scan store UPI QR code to make immediate digital payments.', 14, y + 7);
  doc.text('3. Computer generated invoice powered by Arjun Groceries.', 14, y + 11);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${profile.storeName || 'Arjun Groceries'}`, pageWidth - 65, y + 3);
  doc.text('Authorized Signatory & Stamp', pageWidth - 65, y + 16);
  doc.line(pageWidth - 65, y + 13, pageWidth - 15, y + 13);

  return doc;
}

/**
 * Triggers direct download of Sale Invoice PDF.
 */
export function downloadSaleInvoicePDF(
  sale: SaleRecord,
  profile: StoreProfile,
  customer?: Customer,
  filename?: string
): void {
  const doc = generateSaleInvoicePDF(sale, profile, customer);
  const safeInvoiceNo = (sale.invoiceNo || sale.id).replace(/[^a-zA-Z0-9]/g, '_');
  const finalFilename = filename || `invoice-${safeInvoiceNo}.pdf`;
  doc.save(finalFilename);
}

/**
 * Generates an official Inward Purchase Voucher / Goods Receipt Note (GRN) PDF.
 */
export function generatePurchaseInvoicePDF(
  purchase: SupplierTransaction,
  profile: StoreProfile,
  supplier?: Supplier
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header Banner (Navy/Blue/Emerald for Wholesale Purchases)
  doc.setFillColor(30, 41, 59); // Slate-800
  doc.rect(10, y, pageWidth - 20, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(profile.storeName || 'Arjun Groceries', 14, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(226, 232, 240);
  doc.text(
    `Store Contact: ${profile.phone || ''} | Address: ${profile.address || ''}`,
    14,
    y + 14
  );
  if (profile.gstin) {
    doc.text(`Buyer GSTIN: ${profile.gstin}`, 14, y + 19);
  }

  // Right side header label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  const isRet = purchase.type === 'RETURN';
  const docTitle = isRet
    ? 'PURCHASE RETURN / DEBIT NOTE'
    : 'INWARD PURCHASE VOUCHER / GRN';
  doc.text(docTitle, pageWidth - 14, y + 10, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Accounting & Inventory Record`, pageWidth - 14, y + 16, { align: 'right' });

  y += 30;

  // Voucher & Wholesaler Info Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 28, 'FD');

  const halfWidth = (pageWidth - 20) / 2;

  // Left Column: Voucher details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('PURCHASE RECORD DETAILS:', 14, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Supplier Invoice #: ${purchase.invoiceNo || 'INV-DIRECT'}`, 14, y + 12);

  const purchaseDateStr = new Date(purchase.date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Purchase Date: ${purchaseDateStr}`, 14, y + 17);
  doc.text(`Voucher ID: ${purchase.id}`, 14, y + 22);

  // Status
  doc.setFont('helvetica', 'bold');
  if (purchase.paymentStatus === 'PAID') {
    doc.setTextColor(21, 128, 61);
    doc.text(`Payment Status: FULLY PAID (${purchase.paymentMethod || 'CASH'})`, 14, y + 26);
  } else if (purchase.paymentStatus === 'PARTIAL') {
    doc.setTextColor(217, 119, 6);
    doc.text(`Payment Status: PARTIALLY SETTLED`, 14, y + 26);
  } else {
    doc.setTextColor(185, 28, 28);
    doc.text(`Payment Status: UNPAID (SUPPLIER CREDIT)`, 14, y + 26);
  }

  // Right Column: Wholesaler / Distributor Details
  const rightColX = 14 + halfWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('DISTRIBUTOR / WHOLESALER:', rightColX, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  const supName = supplier?.name || 'Wholesale Supplier';
  doc.text(supName, rightColX, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Contact: ${supplier?.contactPerson || 'Sales Rep'} (${supplier?.phone || 'N/A'})`, rightColX, y + 17);
  if (supplier?.gstin) {
    doc.text(`Supplier GSTIN: ${supplier.gstin}`, rightColX, y + 22);
  }

  if (supplier && supplier.currentBalance > 0) {
    doc.setTextColor(185, 28, 28);
    doc.setFont('helvetica', 'bold');
    doc.text(`Current Payable to Supplier: ${formatPDFCurrency(supplier.currentBalance)}`, rightColX, y + 26);
  }

  y += 34;

  // Breakdown Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);

  doc.text('#', 13, y + 5);
  doc.text('Goods Description & Inward Stock Summary', 24, y + 5);
  doc.text('Voucher Type', 120, y + 5);
  doc.text('Amount (Rs)', pageWidth - 14, y + 5, { align: 'right' });

  y += 7;

  // Table row for the purchase
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);

  doc.text('1', 13, y + 5);
  const desc = purchase.itemsSummary || purchase.description || 'Inward Kirana Grocery Stock';
  doc.text(desc, 24, y + 5);
  doc.text(purchase.type, 120, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.text(formatPDFCurrency(purchase.amount), pageWidth - 14, y + 5, { align: 'right' });

  y += 12;

  // If there are attached bill images or notes
  if (purchase.attachments && purchase.attachments.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Physical Bill Attachments: ${purchase.attachments.length} file(s) attached digitally in Arjun Groceries`, 24, y);
    y += 8;
  }

  // Summary box
  y = Math.max(y + 8, 175);
  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, pageWidth - 10, y);
  y += 5;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(pageWidth - 85, y, 75, 20, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text('TOTAL INWARD PURCHASE VALUE:', pageWidth - 80, y + 6);

  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(formatPDFCurrency(purchase.amount), pageWidth - 14, y + 15, { align: 'right' });

  y += 30;

  // Signatures
  doc.setDrawColor(226, 232, 240);
  doc.line(10, y, pageWidth - 10, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Store Goods Inward Verification & Inventory Audit Slip.', 14, y + 3);
  doc.text('Recorded in Arjun Groceries Purchase Register.', 14, y + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Store Receiver / Inventory Manager', 14, y + 20);
  doc.line(14, y + 16, 75, y + 16);

  doc.text('Distributor Delivery Representative', pageWidth - 75, y + 20);
  doc.line(pageWidth - 75, y + 16, pageWidth - 15, y + 16);

  return doc;
}

/**
 * Triggers direct download of Purchase Voucher PDF.
 */
export function downloadPurchaseInvoicePDF(
  purchase: SupplierTransaction,
  profile: StoreProfile,
  supplier?: Supplier,
  filename?: string
): void {
  const doc = generatePurchaseInvoicePDF(purchase, profile, supplier);
  const safeInvoiceNo = (purchase.invoiceNo || purchase.id).replace(/[^a-zA-Z0-9]/g, '_');
  const finalFilename = filename || `purchase-${safeInvoiceNo}.pdf`;
  doc.save(finalFilename);
}

/**
 * Generates and downloads a Purchase Order (PO) Draft PDF for low-stock replenishment.
 */
export function downloadPurchaseOrderPDF(params: {
  poNumber: string;
  poDate: string;
  supplierName: string;
  supplierPhone?: string;
  notes?: string;
  items: Array<{
    productName: string;
    unit: string;
    currentStock: number;
    orderQty: number;
    unitCost: number;
    estimatedTotal: number;
  }>;
  profile: StoreProfile;
}): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header Banner
  doc.setFillColor(6, 78, 59);
  doc.rect(10, y, pageWidth - 20, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(params.profile.storeName || 'Arjun Groceries', 14, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${params.profile.address || 'Kirana Bazar'} | Mob: ${params.profile.phone || ''}`,
    14,
    y + 15
  );

  y += 28;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('PURCHASE ORDER DRAFT (MAAL ORDER PARCHI)', 10, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`PO #: ${params.poNumber}  |  Date: ${params.poDate}`, pageWidth - 10, y, { align: 'right' });

  y += 6;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 18, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`To Supplier: ${params.supplierName}`, 14, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Phone: ${params.supplierPhone || 'N/A'}`, 14, y + 13);

  y += 24;

  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text('#', 13, y + 5);
  doc.text('Product Name', 22, y + 5);
  doc.text('In Stock', 108, y + 5, { align: 'right' });
  doc.text('Order Qty', 135, y + 5, { align: 'right' });
  doc.text('Est. Rate', 162, y + 5, { align: 'right' });
  doc.text('Est. Total', pageWidth - 14, y + 5, { align: 'right' });
  y += 9;

  let grandTotal = 0;
  params.items.forEach((item, idx) => {
    if (y > 265) {
      doc.addPage();
      y = 18;
    }
    grandTotal += item.estimatedTotal;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(String(idx + 1), 13, y + 4);
    doc.text(item.productName.slice(0, 42), 22, y + 4);
    doc.text(`${item.currentStock} ${item.unit}`, 108, y + 4, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(`${item.orderQty} ${item.unit}`, 135, y + 4, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(formatPDFCurrency(item.unitCost), 162, y + 4, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatPDFCurrency(item.estimatedTotal), pageWidth - 14, y + 4, { align: 'right' });

    doc.setDrawColor(241, 245, 249);
    doc.line(10, y + 6, pageWidth - 10, y + 6);
    y += 7.5;
  });

  y += 6;
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(167, 243, 208);
  doc.rect(pageWidth - 82, y, 72, 16, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(6, 95, 70);
  doc.text('ESTIMATED ORDER TOTAL', pageWidth - 78, y + 6);
  doc.setFontSize(12);
  doc.text(formatPDFCurrency(grandTotal), pageWidth - 14, y + 13, { align: 'right' });

  if (params.notes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Notes: ${params.notes.slice(0, 80)}`, 10, y + 8);
  }

  const safePo = params.poNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`purchase-order-${safePo}.pdf`);
}

/**
 * Generates an official Monthly Customer Khata Statement PDF for a given YYYY-MM month.
 * Shows entering opening balance for the month, itemized debits/credits within that month, and closing balance.
 */
export function generateMonthlyCustomerStatementPDF(
  customer: Customer,
  transactions: CustomerTransaction[],
  profile: StoreProfile,
  monthKey: string
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const statement = calculateMonthlyCustomerStatement(customer, transactions, monthKey);
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Store Banner
  doc.setFillColor(6, 78, 59);
  doc.rect(10, y, pageWidth - 20, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(profile.storeName || 'Arjun Groceries', 14, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${profile.address || 'Kirana Bazar'} | Contact: ${profile.phone || ''} | UPI: ${profile.upiId || 'Not Configured'}`,
    14,
    y + 14
  );
  if (profile.gstin) {
    doc.text(`GSTIN: ${profile.gstin}`, 14, y + 19);
  }

  y += 28;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`MONTHLY CUSTOMER KHATA STATEMENT (${statement.monthLabel.toUpperCase()})`, 10, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Period: ${statement.monthKey}`, pageWidth - 10, y, { align: 'right' });

  y += 5;

  // Customer & Summary Snapshot Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 28, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Customer: ${customer.name}`, 14, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Mobile: ${customer.phone || 'N/A'} | Address: ${customer.address || 'Local'}`, 14, y + 12);
  doc.text(
    `Opening Bal (1st): ${formatPDFCurrency(statement.openingBalanceForMonth)}  |  Credit (+): ${formatPDFCurrency(statement.totalMonthlyDebit)}  |  Paid (-): ${formatPDFCurrency(statement.totalMonthlyCredit)}`,
    14,
    y + 18
  );
  doc.text(`Entries in ${statement.monthLabel}: ${statement.entriesInMonth.length}`, 14, y + 23.5);

  const isAdvance = statement.closingBalanceForMonth < 0;
  if (isAdvance) {
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
  } else if (statement.closingBalanceForMonth === 0) {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
  } else {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 202, 202);
  }
  doc.rect(pageWidth - 72, y + 3, 58, 22, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  if (isAdvance) {
    doc.setTextColor(5, 150, 105);
    doc.text('MONTH-END ADVANCE', pageWidth - 43, y + 9, { align: 'center' });
    doc.setFontSize(11.5);
    doc.text(formatPDFCurrency(Math.abs(statement.closingBalanceForMonth)), pageWidth - 43, y + 17.5, { align: 'center' });
  } else if (statement.closingBalanceForMonth === 0) {
    doc.setTextColor(22, 101, 52);
    doc.text('MONTH-END NIL', pageWidth - 43, y + 9, { align: 'center' });
    doc.setFontSize(11.5);
    doc.text('Rs. 0', pageWidth - 43, y + 17.5, { align: 'center' });
  } else {
    doc.setTextColor(153, 27, 27);
    doc.text('MONTH-END CLOSING DUE', pageWidth - 43, y + 9, { align: 'center' });
    doc.setFontSize(11.5);
    doc.text(formatPDFCurrency(statement.closingBalanceForMonth), pageWidth - 43, y + 17.5, { align: 'center' });
  }

  y += 34;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Date', 12, y + 5);
  doc.text('Ref / Bill', 36, y + 5);
  doc.text('Type', 64, y + 5);
  doc.text('Description', 84, y + 5);
  doc.text('Debit (+)', 142, y + 5, { align: 'right' });
  doc.text('Credit (-)', 166, y + 5, { align: 'right' });
  doc.text('Balance', pageWidth - 14, y + 5, { align: 'right' });
  y += 7;

  // Entering Opening Balance Row
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(51, 65, 85);
  doc.text(`${statement.monthKey}-01`, 12, y + 4.5);
  doc.text('B/F', 36, y + 4.5);
  doc.text('OPENING', 64, y + 4.5);
  doc.text(`Opening balance entering ${statement.monthLabel}`, 84, y + 4.5);
  doc.text('-', 142, y + 4.5, { align: 'right' });
  doc.text('-', 166, y + 4.5, { align: 'right' });
  doc.text(formatPDFCurrency(statement.openingBalanceForMonth), pageWidth - 14, y + 4.5, { align: 'right' });
  y += 6.5;

  if (statement.entriesInMonth.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`No transactions recorded during ${statement.monthLabel}.`, 14, y + 6);
    y += 12;
  } else {
    statement.entriesInMonth.forEach((tx, idx) => {
      if (y > 265) {
        doc.addPage();
        y = 16;
      }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(10, y, pageWidth - 20, 6, 'F');
      }

      const txDateStr = tx.date ? tx.date.replace('T', ' ').substring(0, 16) : '-';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(30, 41, 59);
      doc.text(txDateStr, 12, y + 4.5);
      doc.text(tx.invoiceNo || `TX-${tx.id.slice(-5)}`, 36, y + 4.5);

      if (tx.isCancelled) {
        doc.setTextColor(148, 163, 184);
        doc.text('CANCELLED', 64, y + 4.5);
      } else if (tx.debitAmount > 0) {
        doc.setTextColor(185, 28, 28);
        doc.text(tx.type === 'OPENING' ? 'OPENING' : 'CREDIT', 64, y + 4.5);
      } else {
        doc.setTextColor(21, 128, 61);
        doc.text(`PAID (${tx.paymentMethod || 'CASH'})`, 64, y + 4.5);
      }

      doc.setTextColor(tx.isCancelled ? 148 : 71, tx.isCancelled ? 163 : 85, tx.isCancelled ? 184 : 105);
      const desc = tx.isCancelled
        ? `[CANCELLED] ${tx.cancelReason || tx.description || 'Cancelled'}`
        : tx.description || 'Counter entry';
      doc.text(desc.length > 30 ? `${desc.slice(0, 30)}...` : desc, 84, y + 4.5);

      if (tx.isCancelled) {
        doc.setTextColor(148, 163, 184);
        doc.text('-', 142, y + 4.5, { align: 'right' });
        doc.text('-', 166, y + 4.5, { align: 'right' });
      } else {
        doc.setTextColor(30, 41, 59);
        doc.text(tx.debitAmount > 0 ? formatPDFCurrency(tx.debitAmount) : '-', 142, y + 4.5, { align: 'right' });
        doc.text(tx.creditAmount > 0 ? formatPDFCurrency(tx.creditAmount) : '-', 166, y + 4.5, { align: 'right' });
      }
      doc.text(formatPDFCurrency(tx.runningBalance), pageWidth - 14, y + 4.5, { align: 'right' });
      y += 6;
    });
  }

  y += 6;
  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, pageWidth - 10, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Closing Balance (${statement.monthLabel}): ${formatPDFCurrency(statement.closingBalanceForMonth)}`,
    pageWidth - 14,
    y,
    { align: 'right' }
  );

  return doc;
}

export function downloadMonthlyCustomerStatementPDF(
  customer: Customer,
  transactions: CustomerTransaction[],
  profile: StoreProfile,
  monthKey: string,
  filename?: string
): void {
  const doc = generateMonthlyCustomerStatementPDF(customer, transactions, profile, monthKey);
  const safeName = customer.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const safeMonth = monthKey.replace(/[^0-9-]/g, '');
  doc.save(filename || `khata-monthly-${safeName}-${safeMonth}.pdf`);
}

/**
 * Generates an official Purchase Return Credit Note PDF for damaged or returned goods sent back to a supplier.
 */
export function generatePurchaseReturnCreditNotePDF(
  returnTx: SupplierTransaction,
  profile: StoreProfile,
  supplier?: Supplier
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header Banner (Deep Emerald / Slate accent for formal Credit Note)
  doc.setFillColor(6, 78, 59);
  doc.rect(10, y, pageWidth - 20, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(profile.storeName || 'Arjun Groceries', 14, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${profile.address || 'Kirana Bazar'} | Contact: ${profile.phone || ''}`,
    14,
    y + 14
  );
  if (profile.gstin) {
    doc.text(`GSTIN: ${profile.gstin}`, 14, y + 19);
  }

  // Right-side title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(255, 255, 255);
  doc.text('PURCHASE RETURN CREDIT NOTE', pageWidth - 14, y + 10, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(167, 243, 208);
  const cnNo = returnTx.creditNoteNo || returnTx.invoiceNo || `CN-${returnTx.id.slice(-6)}`;
  doc.text(`Credit Note #: ${cnNo}`, pageWidth - 14, y + 16, { align: 'right' });

  y += 30;

  // Metadata Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, y, pageWidth - 20, 30, 'FD');

  const halfWidth = (pageWidth - 20) / 2;

  // Left: Credit Note Details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('CREDIT NOTE DETAILS:', 14, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Credit Note #: ${cnNo}`, 14, y + 12);

  const returnDateStr = new Date(returnTx.date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Return Date: ${returnDateStr}`, 14, y + 17);
  doc.text(
    `Original Invoice #: ${returnTx.originalInvoiceNo ? `#${returnTx.originalInvoiceNo}` : 'General Stock Return'}`,
    14,
    y + 22
  );
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 83, 9);
  doc.text(`Return Reason: ${getPurchaseReturnReasonLabel(returnTx.returnReason)}`, 14, y + 27);

  // Right: Supplier Details
  const rightColX = 14 + halfWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('ISSUED TO SUPPLIER / WHOLESALER:', rightColX, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(supplier?.name || 'Wholesale Supplier', rightColX, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Contact: ${supplier?.contactPerson || 'Sales Desk'} | Phone: ${supplier?.phone || 'N/A'}`,
    rightColX,
    y + 17
  );
  if (supplier?.gstin) {
    doc.text(`Supplier GSTIN: ${supplier.gstin}`, rightColX, y + 22);
  } else if (supplier?.address) {
    doc.text(`Address: ${supplier.address.slice(0, 38)}`, rightColX, y + 22);
  }

  const settlementLabel =
    returnTx.settlementMode === 'CASH_REFUND'
      ? 'Cash Refund Received'
      : returnTx.settlementMode === 'BANK_REFUND'
      ? 'Bank / UPI Refund'
      : 'Adjusted Against Supplier Payable';
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(6, 95, 70);
  doc.text(`Settlement: ${settlementLabel}`, rightColX, y + 27);

  y += 36;

  // Itemized Returned Goods Table
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, pageWidth - 20, 7.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);

  doc.text('#', 13, y + 5);
  doc.text('Returned Item Description', 22, y + 5);
  doc.text('Reason', 96, y + 5);
  doc.text('Qty Returned', 134, y + 5, { align: 'right' });
  doc.text('Unit Rate', 162, y + 5, { align: 'right' });
  doc.text('Credit Amt', pageWidth - 14, y + 5, { align: 'right' });

  y += 8;

  const lineItems = returnTx.returnItems && returnTx.returnItems.length > 0 ? returnTx.returnItems : null;

  if (lineItems && lineItems.length > 0) {
    lineItems.forEach((item, idx) => {
      if (y > 245) {
        doc.addPage();
        y = 18;
      }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(10, y, pageWidth - 20, 7, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);
      doc.text(String(idx + 1), 13, y + 4.8);
      const nameStr =
        item.productName.length > 36 ? `${item.productName.slice(0, 36)}...` : item.productName;
      doc.text(nameStr, 22, y + 4.8);
      doc.setTextColor(180, 83, 9);
      doc.text(getPurchaseReturnReasonLabel(item.reason || returnTx.returnReason), 96, y + 4.8);
      doc.setTextColor(30, 41, 59);
      doc.text(`${item.quantity} ${item.unit}`, 134, y + 4.8, { align: 'right' });
      doc.text(formatPDFCurrency(item.unitPrice), 162, y + 4.8, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(formatPDFCurrency(item.total), pageWidth - 14, y + 4.8, { align: 'right' });

      y += 7;
    });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text('1', 13, y + 5);
    const desc = returnTx.itemsSummary || returnTx.description || 'Returned Goods';
    doc.text(desc.length > 42 ? `${desc.slice(0, 42)}...` : desc, 22, y + 5);
    doc.setTextColor(180, 83, 9);
    doc.text(getPurchaseReturnReasonLabel(returnTx.returnReason), 96, y + 5);
    doc.setTextColor(30, 41, 59);
    doc.text(
      returnTx.quantity ? `${returnTx.quantity} ${returnTx.unit || 'pcs'}` : '1 Lot',
      134,
      y + 5,
      { align: 'right' }
    );
    doc.text(
      returnTx.unitPrice ? formatPDFCurrency(returnTx.unitPrice) : formatPDFCurrency(returnTx.amount),
      162,
      y + 5,
      { align: 'right' }
    );
    doc.setFont('helvetica', 'bold');
    doc.text(formatPDFCurrency(returnTx.amount), pageWidth - 14, y + 5, { align: 'right' });
    y += 8;
  }

  // Summary Box
  y = Math.max(y + 8, 175);
  if (y > 238) {
    doc.addPage();
    y = 18;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, pageWidth - 10, y);
  y += 5;

  // Left: Inventory adjustment confirmation & supplier payable snapshot
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('INVENTORY & LEDGER CONFIRMATION:', 14, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('• Returned quantities automatically deducted from store inventory.', 14, y + 9.5);
  doc.text(`• Settlement mode: ${settlementLabel}.`, 14, y + 14);
  if (supplier) {
    doc.text(
      `• Current Supplier Payable Balance: ${formatPDFCurrency(Math.max(0, supplier.currentBalance || 0))}`,
      14,
      y + 18.5
    );
  }
  if (returnTx.status === 'CANCELLED') {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text('STATUS: CANCELLED / REVERSED CREDIT NOTE', 14, y + 23);
  }

  // Right: Credit Note Total Box
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(167, 243, 208);
  doc.rect(pageWidth - 85, y, 75, 22, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(6, 78, 59);
  doc.text('TOTAL CREDIT NOTE VALUE:', pageWidth - 80, y + 6.5);

  doc.setFontSize(13.5);
  doc.setTextColor(6, 78, 59);
  doc.text(formatPDFCurrency(returnTx.amount), pageWidth - 14, y + 16, { align: 'right' });

  y += 30;

  // Signatures Footer
  doc.setDrawColor(226, 232, 240);
  doc.line(10, y, pageWidth - 10, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Official Purchase Return Credit Note issued via Arjun Groceries.', 14, y + 3);
  doc.text('Please adjust this credit amount in the monthly wholesaler statement.', 14, y + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Authorized Store Signature', 14, y + 20);
  doc.line(14, y + 16, 75, y + 16);

  doc.text('Supplier / Representative Acknowledgment', pageWidth - 78, y + 20);
  doc.line(pageWidth - 78, y + 16, pageWidth - 15, y + 16);

  return doc;
}

/**
 * Triggers direct download of Purchase Return Credit Note PDF.
 */
export function downloadPurchaseReturnCreditNotePDF(
  returnTx: SupplierTransaction,
  profile: StoreProfile,
  supplier?: Supplier,
  filename?: string
): void {
  const doc = generatePurchaseReturnCreditNotePDF(returnTx, profile, supplier);
  const safeCn = (returnTx.creditNoteNo || returnTx.invoiceNo || returnTx.id).replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  doc.save(filename || `credit-note-${safeCn}.pdf`);
}


