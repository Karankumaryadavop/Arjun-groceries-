/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Customer,
  CustomerLedgerSummary,
  Product,
  StockAdjustmentRecord,
  Supplier,
  SupplierLedgerSummary,
} from '../types';
import { normalizePreferredPaymentMethod } from './supplierPdfImport';

/**
 * Escapes a cell string according to standard RFC 4180 CSV specifications.
 */
export function escapeCSVCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Splits a CSV text into rows and columns, properly respecting quoted fields with commas and line breaks.
 */
export function parseCSVRows(csvText: string): string[][] {
  const rows: string[][] = [];
  if (!csvText || !csvText.trim()) return rows;

  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++; // CRLF
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  // Push final cell and row
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  // Filter out any purely empty rows
  return rows.filter((r) => r.length > 0 && r.some((c) => c !== ''));
}

import { triggerVerifiedBlobDownload } from './androidDownload';

/**
 * Triggers a browser download of a CSV string with Android-safe 60s URL revocation.
 */
export function downloadCSVFile(filename: string, csvContent: string): void {
  triggerVerifiedBlobDownload(csvContent, filename, 'text/csv;charset=utf-8;');
}

// ==========================================
// 1. CUSTOMERS CSV
// ==========================================

export function exportCustomersToCSV(customers: Customer[]): string {
  const headers = [
    'ID',
    'Customer Name',
    'Phone',
    'Address',
    'Opening Balance (INR)',
    'Current Balance (INR)',
    'Total Credit Given',
    'Total Payment Received',
    'Overdue Days',
    'Category',
    'Notes',
    'Created At',
  ];

  const rows = customers.map((c) => [
    escapeCSVCell(c.id),
    escapeCSVCell(c.name),
    escapeCSVCell(c.phone),
    escapeCSVCell(c.address || ''),
    escapeCSVCell(c.openingBalance || 0),
    escapeCSVCell(c.currentBalance || 0),
    escapeCSVCell(c.totalCreditGiven || 0),
    escapeCSVCell(c.totalPaymentReceived || 0),
    escapeCSVCell(c.overdueDays || 0),
    escapeCSVCell(c.category || 'REGULAR'),
    escapeCSVCell(c.notes || ''),
    escapeCSVCell(c.createdAt || ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseCustomersCSV(csvText: string): {
  valid: Customer[];
  skipped: number;
  errors: string[];
} {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) {
    return { valid: [], skipped: 0, errors: ['CSV file must have a header row and at least 1 customer row.'] };
  }

  const headerRow = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const nameIdx = headerRow.findIndex((h) => h.includes('name') || h.includes('customer'));
  const phoneIdx = headerRow.findIndex((h) => h.includes('phone') || h.includes('mobile'));
  const addressIdx = headerRow.findIndex((h) => h.includes('address'));
  const openBalIdx = headerRow.findIndex((h) => h.includes('opening') || h.includes('openbal'));
  const notesIdx = headerRow.findIndex((h) => h.includes('note') || h.includes('remark'));

  if (nameIdx === -1) {
    return { valid: [], skipped: 0, errors: ['Missing required column: "Customer Name"'] };
  }

  const valid: Customer[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[nameIdx]?.trim();
    if (!name) {
      skipped++;
      continue;
    }

    const phone = (phoneIdx !== -1 ? row[phoneIdx] : '') || '';
    const address = (addressIdx !== -1 ? row[addressIdx] : '') || '';
    const openBal = openBalIdx !== -1 ? parseFloat(row[openBalIdx]) || 0 : 0;
    const notes = (notesIdx !== -1 ? row[notesIdx] : '') || '';

    const newCustomer: Customer = {
      id: `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      phone: phone.replace(/[^0-9]/g, ''),
      address,
      openingBalance: openBal,
      currentBalance: openBal,
      totalCreditGiven: openBal,
      totalPaymentReceived: 0,
      lastTransactionDate: new Date().toISOString(),
      overdueDays: 0,
      category: 'REGULAR',
      notes,
      createdAt: new Date().toISOString().split('T')[0],
    };
    valid.push(newCustomer);
  }

  return { valid, skipped, errors };
}

export function getSampleCustomerCSV(): string {
  return [
    'Customer Name,Phone,Address,Opening Balance (INR),Notes',
    'Ramesh Bhai Patel,9876543210,"Room 12, Station Road",1200,"Monthly ration customer"',
    'Sunita Sharma,9820198765,"Flat 204, Shanti Niketan",500,"Festival advance"',
  ].join('\n');
}

// ==========================================
// 2. SUPPLIERS CSV
// ==========================================

export function exportSuppliersToCSV(suppliers: Supplier[]): string {
  const headers = [
    'ID',
    'Supplier / Firm Name',
    'Contact Person',
    'Phone',
    'Address',
    'GSTIN',
    'Credit Terms',
    'Preferred Payment Method',
    'Opening Balance (INR)',
    'Current Balance (INR)',
    'Total Purchases (INR)',
    'Total Paid (INR)',
    'Notes',
    'Created At',
  ];

  const rows = suppliers.map((s) => [
    escapeCSVCell(s.id),
    escapeCSVCell(s.name),
    escapeCSVCell(s.contactPerson || ''),
    escapeCSVCell(s.phone),
    escapeCSVCell(s.address || ''),
    escapeCSVCell(s.gstin || ''),
    escapeCSVCell(s.creditTerms || ''),
    escapeCSVCell(s.preferredPaymentMethod || ''),
    escapeCSVCell(s.openingBalance || 0),
    escapeCSVCell(s.currentBalance || 0),
    escapeCSVCell(s.totalPurchases || 0),
    escapeCSVCell(s.totalPaid || 0),
    escapeCSVCell(s.notes || ''),
    escapeCSVCell(s.createdAt || ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseSuppliersCSV(csvText: string): {
  valid: Supplier[];
  skipped: number;
  errors: string[];
} {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) {
    return { valid: [], skipped: 0, errors: ['CSV file must have a header row and at least 1 supplier row.'] };
  }

  const headerRow = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const nameIdx = headerRow.findIndex((h) => h.includes('name') || h.includes('supplier') || h.includes('firm'));
  const contactIdx = headerRow.findIndex((h) => h.includes('contact') || h.includes('person'));
  const phoneIdx = headerRow.findIndex((h) => h.includes('phone') || h.includes('mobile'));
  const addressIdx = headerRow.findIndex((h) => h.includes('address'));
  const gstinIdx = headerRow.findIndex((h) => h.includes('gst') || h.includes('gstin'));
  const creditTermsIdx = headerRow.findIndex((h) => h.includes('creditterm') || (h.includes('credit') && h.includes('term')));
  const prefPayIdx = headerRow.findIndex(
    (h) => h.includes('preferredpayment') || h.includes('paymentmethod') || h.includes('paymentmode')
  );
  const openBalIdx = headerRow.findIndex((h) => h.includes('opening') || h.includes('openbal'));
  const notesIdx = headerRow.findIndex((h) => h.includes('note') || h.includes('remark'));

  if (nameIdx === -1) {
    return { valid: [], skipped: 0, errors: ['Missing required column: "Supplier / Firm Name"'] };
  }

  const valid: Supplier[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[nameIdx]?.trim();
    if (!name) {
      skipped++;
      continue;
    }

    const contactPerson = (contactIdx !== -1 ? row[contactIdx] : '') || '';
    const phone = (phoneIdx !== -1 ? row[phoneIdx] : '') || '';
    const address = (addressIdx !== -1 ? row[addressIdx] : '') || '';
    const gstin = (gstinIdx !== -1 ? row[gstinIdx] : '') || undefined;
    const creditTerms = (creditTermsIdx !== -1 ? row[creditTermsIdx]?.trim() : '') || undefined;
    const rawPayMethod = prefPayIdx !== -1 ? row[prefPayIdx]?.trim() : '';
    const preferredPaymentMethod = rawPayMethod ? normalizePreferredPaymentMethod(rawPayMethod) : undefined;
    const openBal = openBalIdx !== -1 ? parseFloat(row[openBalIdx]) || 0 : 0;
    const notes = (notesIdx !== -1 ? row[notesIdx] : '') || '';

    const newSupplier: Supplier = {
      id: `sup-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      contactPerson,
      phone: phone.replace(/[^0-9]/g, ''),
      address,
      gstin,
      creditTerms,
      preferredPaymentMethod,
      openingBalance: openBal,
      currentBalance: openBal,
      totalPurchases: openBal,
      totalPaid: 0,
      lastTransactionDate: new Date().toISOString(),
      notes,
      createdAt: new Date().toISOString().split('T')[0],
    };
    valid.push(newSupplier);
  }

  return { valid, skipped, errors };
}

export function getSampleSupplierCSV(): string {
  return [
    'Supplier / Firm Name,Contact Person,Phone,Address,GSTIN,Credit Terms,Preferred Payment Method,Opening Balance (INR),Notes',
    'Balaji Grains Wholesale,Sanjay Agrawal,9822334455,"Gala 14, APMC Market",27AABCB1234D1Z2,"Net 15 Days",BANK_TRANSFER,12000,"Main grain distributor"',
    'Shree Ganesh FMCG,Manoj Shah,9811223344,"Plot 88, Wholesale Hub",,"7 Days Credit",UPI,5000,"Parle & Dettol items"',
  ].join('\n');
}

// ==========================================
// 3. INVENTORY & PRODUCTS CSV
// ==========================================

export function exportProductsToCSV(products: Product[]): string {
  const headers = [
    'ID',
    'Product Name',
    'Hindi Name',
    'Category',
    'Wholesale Cost (INR)',
    'Selling Rate (INR)',
    'MRP (INR)',
    'Available Stock',
    'Base Unit',
    'Reorder Threshold',
    'Description',
    'Status',
    'Last Updated',
    'Desired Stock Level',
    'Preferred Supplier ID',
    'Preferred Supplier Name',
    'Last Purchase Price (INR)',
    'Last Purchase Date',
    'Supplier Notes',
  ];

  const rows = products.map((p) => [
    escapeCSVCell(p.id),
    escapeCSVCell(p.name),
    escapeCSVCell(p.localName || ''),
    escapeCSVCell(p.category || 'General Kirana'),
    escapeCSVCell(p.purchasePrice || 0),
    escapeCSVCell(p.sellingPrice || 0),
    escapeCSVCell(p.mrp ?? ''),
    escapeCSVCell(p.stockQty || 0),
    escapeCSVCell(p.unit || 'pcs'),
    escapeCSVCell(p.minStockAlert || 5),
    escapeCSVCell(p.description || ''),
    escapeCSVCell(p.isArchived ? 'Archived' : 'Active'),
    escapeCSVCell(p.updatedAt || ''),
    escapeCSVCell(p.desiredStockLevel ?? ''),
    escapeCSVCell(p.preferredSupplierId || ''),
    escapeCSVCell(p.preferredSupplierName || ''),
    escapeCSVCell(p.lastPurchasePrice ?? ''),
    escapeCSVCell(p.lastPurchaseDate || ''),
    escapeCSVCell(p.supplierNotes || ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseProductsCSV(csvText: string): {
  valid: Product[];
  skipped: number;
  errors: string[];
} {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) {
    return { valid: [], skipped: 0, errors: ['CSV file must have a header row and at least 1 product row.'] };
  }

  const headerRow = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const nameIdx = headerRow.findIndex(
    (h) => h.includes('name') && !h.includes('hindi') && !h.includes('local') && !h.includes('supplier')
  );
  const localNameIdx = headerRow.findIndex((h) => h.includes('hindi') || h.includes('local'));
  const categoryIdx = headerRow.findIndex((h) => h.includes('category'));
  const costIdx = headerRow.findIndex(
    (h) => (h.includes('cost') || h.includes('purchase')) && !h.includes('lastpurchase') && !h.includes('date')
  );
  const sellIdx = headerRow.findIndex(
    (h) => (h.includes('sell') || h.includes('rate') || h.includes('price')) && !h.includes('lastpurchase')
  );
  const mrpIdx = headerRow.findIndex((h) => h.includes('mrp'));
  const stockIdx = headerRow.findIndex(
    (h) => (h.includes('stock') || h.includes('qty') || h.includes('quantity')) && !h.includes('desired')
  );
  const unitIdx = headerRow.findIndex((h) => h.includes('unit'));
  const thresholdIdx = headerRow.findIndex(
    (h) => h.includes('threshold') || h.includes('alert') || h.includes('reorder') || h.includes('min')
  );
  const descIdx = headerRow.findIndex((h) => (h.includes('desc') || h.includes('note')) && !h.includes('supplier'));
  const desiredStockIdx = headerRow.findIndex((h) => h.includes('desiredstock'));
  const prefSupplierIdIdx = headerRow.findIndex((h) => h.includes('preferredsupplierid'));
  const prefSupplierNameIdx = headerRow.findIndex((h) => h.includes('preferredsuppliername'));
  const lastPurchasePriceIdx = headerRow.findIndex((h) => h.includes('lastpurchaseprice'));
  const lastPurchaseDateIdx = headerRow.findIndex((h) => h.includes('lastpurchasedate'));
  const supplierNotesIdx = headerRow.findIndex((h) => h.includes('suppliernote'));

  if (nameIdx === -1) {
    return { valid: [], skipped: 0, errors: ['Missing required column: "Product Name"'] };
  }

  const valid: Product[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[nameIdx]?.trim();
    if (!name) {
      skipped++;
      continue;
    }

    const localName = (localNameIdx !== -1 ? row[localNameIdx] : '') || undefined;
    const category = (categoryIdx !== -1 ? row[categoryIdx] : '') || 'General Kirana';
    const purchasePrice = Math.max(0, costIdx !== -1 ? parseFloat(row[costIdx]) || 0 : 0);
    const sellingPrice = Math.max(0, sellIdx !== -1 ? parseFloat(row[sellIdx]) || 0 : 0);
    const parsedMrp = mrpIdx !== -1 ? parseFloat(row[mrpIdx]) : NaN;
    const mrp = !isNaN(parsedMrp) && parsedMrp >= 0 ? parsedMrp : undefined;
    const stockQty = Math.max(0, stockIdx !== -1 ? parseFloat(row[stockIdx]) || 0 : 0);
    const unit = (unitIdx !== -1 ? row[unitIdx] : '') || 'pcs';
    const minStockAlert = Math.max(0, thresholdIdx !== -1 ? parseFloat(row[thresholdIdx]) || 5 : 5);
    const description = (descIdx !== -1 ? row[descIdx]?.trim() : '') || undefined;

    const parsedDesired = desiredStockIdx !== -1 ? parseFloat(row[desiredStockIdx]) : NaN;
    const desiredStockLevel = !isNaN(parsedDesired) && parsedDesired >= 0 ? parsedDesired : undefined;
    const preferredSupplierId = (prefSupplierIdIdx !== -1 ? row[prefSupplierIdIdx]?.trim() : '') || undefined;
    const preferredSupplierName = (prefSupplierNameIdx !== -1 ? row[prefSupplierNameIdx]?.trim() : '') || undefined;
    const parsedLastPrice = lastPurchasePriceIdx !== -1 ? parseFloat(row[lastPurchasePriceIdx]) : NaN;
    const lastPurchasePrice = !isNaN(parsedLastPrice) && parsedLastPrice >= 0 ? parsedLastPrice : undefined;
    const lastPurchaseDate = (lastPurchaseDateIdx !== -1 ? row[lastPurchaseDateIdx]?.trim() : '') || undefined;
    const supplierNotes = (supplierNotesIdx !== -1 ? row[supplierNotesIdx]?.trim() : '') || undefined;

    const newProduct: Product = {
      id: `p-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      localName,
      category,
      purchasePrice,
      sellingPrice,
      mrp,
      stockQty,
      unit,
      minStockAlert,
      desiredStockLevel,
      preferredSupplierId,
      preferredSupplierName,
      lastPurchasePrice,
      lastPurchaseDate,
      supplierNotes,
      description,
      updatedAt: new Date().toISOString(),
    };
    valid.push(newProduct);
  }

  return { valid, skipped, errors };
}

export function getSampleProductCSV(): string {
  return [
    'Product Name,Hindi Name,Category,Wholesale Cost (INR),Selling Rate (INR),MRP (INR),Available Stock,Base Unit,Reorder Threshold,Description',
    'Aashirvaad Shudh Chakki Atta,Aashirvaad Aata,Grains & Flour,380,425,455,35,10kg bag,8,10kg family chakki atta',
    'Fortune Sunlite Sunflower Oil,Fortune Tel,Edible Oils & Ghee,125,145,160,48,1L pouch,10,Refined sunflower cooking oil',
    'ALU (Fresh Potatoes),Aloo (Naya),Fresh Vegetables & Staples,22,30,35,19.84,KG,5,Fresh loose potatoes',
  ].join('\n');
}

// ==========================================
// 4. CUSTOMER LEDGER CSV
// ==========================================

export function exportCustomerLedgerCSV(
  customer: Customer,
  ledgerSummary: CustomerLedgerSummary
): string {
  const metadataRows = [
    `# ARJUN GROCERIES - CUSTOMER TRANSACTION LEDGER`,
    `Customer Name,${escapeCSVCell(customer.name)}`,
    `Phone,${escapeCSVCell(customer.phone || 'N/A')}`,
    `Address,${escapeCSVCell(customer.address || 'N/A')}`,
    `Account Status,${escapeCSVCell(ledgerSummary.status)}`,
    `Opening Balance (INR),${ledgerSummary.openingBalance}`,
    `Total Credit Given (INR),${ledgerSummary.totalCredit}`,
    `Total Payment Received (INR),${ledgerSummary.totalPayment}`,
    `Closing Balance (INR),${ledgerSummary.closingBalance}`,
    `Generated At,${escapeCSVCell(new Date().toISOString())}`,
    '',
  ];

  const headers = [
    'Date & Time',
    'Transaction ID',
    'Invoice / Ref No',
    'Type',
    'Description',
    'Credit Given (Debit INR)',
    'Payment Received (Credit INR)',
    'Payment Method',
    'Running Balance (INR)',
    'Status',
    'Cancel Reason',
  ];

  const rows = ledgerSummary.entries.map((entry) => [
    escapeCSVCell(entry.date),
    escapeCSVCell(entry.id),
    escapeCSVCell(entry.invoiceNo || ''),
    escapeCSVCell(entry.type),
    escapeCSVCell(entry.description || ''),
    entry.type === 'CREDIT' ? entry.amount : 0,
    entry.type === 'PAYMENT' || entry.type === 'RETURN' ? entry.amount : 0,
    escapeCSVCell(entry.paymentMethod || 'CASH'),
    entry.runningBalance,
    escapeCSVCell(entry.status || 'COMPLETED'),
    escapeCSVCell(entry.cancelReason || ''),
  ]);

  return [...metadataRows, headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadCustomerLedgerCSV(
  customer: Customer,
  ledgerSummary: CustomerLedgerSummary
): void {
  const csv = exportCustomerLedgerCSV(customer, ledgerSummary);
  const safeName = customer.name.replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadCSVFile(`customer_ledger_${safeName}_${dateStr}.csv`, csv);
}

// ==========================================
// 5. SUPPLIER LEDGER CSV
// ==========================================

export function exportSupplierLedgerCSV(
  supplier: Supplier,
  ledgerSummary: SupplierLedgerSummary
): string {
  const metadataRows = [
    `# ARJUN GROCERIES - SUPPLIER TRANSACTION LEDGER`,
    `Supplier Name,${escapeCSVCell(supplier.name)}`,
    `Contact Person,${escapeCSVCell(supplier.contactPerson || 'N/A')}`,
    `Phone,${escapeCSVCell(supplier.phone || 'N/A')}`,
    `GSTIN,${escapeCSVCell(supplier.gstin || 'N/A')}`,
    `Account Status,${escapeCSVCell(ledgerSummary.status)}`,
    `Opening Payable (INR),${ledgerSummary.openingBalance}`,
    `Total Purchases (INR),${ledgerSummary.totalPurchases}`,
    `Total Paid (INR),${ledgerSummary.totalPaid}`,
    `Closing Payable (INR),${ledgerSummary.closingBalance}`,
    `Generated At,${escapeCSVCell(new Date().toISOString())}`,
    '',
  ];

  const headers = [
    'Date & Time',
    'Transaction ID',
    'Bill / Invoice No',
    'Type',
    'Description',
    'Purchase Amount (Debit INR)',
    'Payment Paid (Credit INR)',
    'Payment Method',
    'Running Balance (INR)',
    'Status',
    'Cancel Reason',
  ];

  const rows = ledgerSummary.entries.map((entry) => [
    escapeCSVCell(entry.date),
    escapeCSVCell(entry.id),
    escapeCSVCell(entry.invoiceNo || ''),
    escapeCSVCell(entry.type),
    escapeCSVCell(entry.description || ''),
    entry.type === 'PURCHASE' ? entry.amount : 0,
    entry.type === 'PAYMENT' || entry.type === 'RETURN' ? entry.amount : 0,
    escapeCSVCell(entry.paymentMethod || 'CASH'),
    entry.runningBalance,
    escapeCSVCell(entry.status || 'COMPLETED'),
    escapeCSVCell(entry.cancelReason || ''),
  ]);

  return [...metadataRows, headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadSupplierLedgerCSV(
  supplier: Supplier,
  ledgerSummary: SupplierLedgerSummary
): void {
  const csv = exportSupplierLedgerCSV(supplier, ledgerSummary);
  const safeName = supplier.name.replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadCSVFile(`supplier_ledger_${safeName}_${dateStr}.csv`, csv);
}

// ==========================================
// 6. STOCK MOVEMENT AUDIT REPORT CSV
// ==========================================

export function exportStockMovementCSV(entries: StockAdjustmentRecord[]): string {
  const headers = [
    'Date & Time',
    'Adjustment ID',
    'Product Name',
    'Unit',
    'Source',
    'Type',
    'Quantity Change',
    'Previous Stock',
    'New Stock',
    'Reason',
  ];

  const rows = entries.map((e) => [
    escapeCSVCell(e.date || e.createdAt),
    escapeCSVCell(e.id),
    escapeCSVCell(e.productName),
    escapeCSVCell(e.unit),
    escapeCSVCell(e.source),
    escapeCSVCell(e.type),
    escapeCSVCell(
      e.type === 'ADD'
        ? `+${Math.abs(Number(e.quantityChange) || 0)}`
        : `-${Math.abs(Number(e.quantityChange) || 0)}`
    ),
    escapeCSVCell(e.previousStock),
    escapeCSVCell(e.newStock),
    escapeCSVCell(e.reason || ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadStockMovementCSV(entries: StockAdjustmentRecord[], label = 'all'): void {
  const csv = exportStockMovementCSV(entries);
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadCSVFile(`stock_movement_report_${safeLabel}_${dateStr}.csv`, csv);
}
