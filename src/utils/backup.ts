/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppBackupData,
  AppBackupSummary,
  AuditLog,
  BillAttachment,
  CashbookEntry,
  Customer,
  CustomerTransaction,
  DailySalesTargetConfig,
  ExpenseCategoryConfig,
  ExpenseRecord,
  Product,
  ProductCategoryConfig,
  RecurringExpense,
  SaleRecord,
  StockAdjustmentRecord,
  StoreProfile,
  Supplier,
  SupplierTransaction,
  WhatsAppReminderBatch,
  WhatsAppAuditLog,
} from '../types';

export interface BackupInput {
  profile: StoreProfile;
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  cashbookEntries: CashbookEntry[];
  products: Product[];
  productCategories?: ProductCategoryConfig[];
  expenseCategories?: ExpenseCategoryConfig[];
  stockAdjustments?: StockAdjustmentRecord[];
  auditLogs: AuditLog[];
  billDocuments?: BillAttachment[];
  recurringExpenses?: RecurringExpense[];
  dailySalesTarget?: DailySalesTargetConfig | null;
  lastClosedDate?: string | null;
  whatsappBatches?: WhatsAppReminderBatch[];
  whatsappAuditLogs?: WhatsAppAuditLog[];
}

const SENSITIVE_PROFILE_KEYS = [
  'pinCode',
  'pinHash',
  'pinSalt',
  'accessToken',
  'apiKey',
  'secret',
  'webhookVerifyToken',
  'whatsappAccessToken',
  'whatsappApiConfig',
] as const;

export function sanitizeBackupProfile(profile: StoreProfile): StoreProfile {
  const sanitized = { ...(profile as StoreProfile & Record<string, unknown>) };
  for (const key of SENSITIVE_PROFILE_KEYS) {
    delete sanitized[key];
  }
  return sanitized as StoreProfile;
}

/**
 * Builds a structured, complete JSON backup payload of all application transactions,
 * master data, attachments, recurring schedules, daily targets, and audit trail.
 * Never exports plaintext PINs or API secrets.
 */
export function generateBackupData(input: BackupInput): AppBackupData {
  const {
    profile,
    customers = [],
    customerTransactions = [],
    suppliers = [],
    supplierTransactions = [],
    sales = [],
    expenses = [],
    cashbookEntries = [],
    products = [],
    productCategories = [],
    expenseCategories = [],
    stockAdjustments = [],
    auditLogs = [],
    billDocuments = [],
    recurringExpenses = [],
    dailySalesTarget = null,
    lastClosedDate = null,
    whatsappBatches = [],
    whatsappAuditLogs = [],
  } = input;

  const salesTotalVolume = sales.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
  const expenseTotalVolume = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  const totalCustomerOpening = customers.reduce((acc, c) => acc + (Number(c.openingBalance) || 0), 0);
  const totalSupplierOpening = suppliers.reduce((acc, s) => acc + (Number(s.openingBalance) || 0), 0);
  const openingCashEntry = cashbookEntries.find(
    (cb) => cb.category === 'OPENING' || cb.refType === 'OPENING'
  );
  const cashOpeningBalance = openingCashEntry ? Number(openingCashEntry.amount) || 0 : 0;

  const summary: AppBackupSummary = {
    totalTransactions:
      sales.length +
      customerTransactions.length +
      supplierTransactions.length +
      expenses.length +
      cashbookEntries.length,
    salesCount: sales.length,
    salesTotalVolume: Math.round(salesTotalVolume * 100) / 100,
    customerTransactionsCount: customerTransactions.length,
    supplierTransactionsCount: supplierTransactions.length,
    expenseCount: expenses.length,
    expenseTotalVolume: Math.round(expenseTotalVolume * 100) / 100,
    cashbookCount: cashbookEntries.length,
    customersCount: customers.length,
    suppliersCount: suppliers.length,
    productsCount: products.length,
    billDocumentsCount: billDocuments.length,
    openingBalances: {
      totalCustomerOpening: Math.round(totalCustomerOpening * 100) / 100,
      totalSupplierOpening: Math.round(totalSupplierOpening * 100) / 100,
      cashOpeningBalance: Math.round(cashOpeningBalance * 100) / 100,
    },
  };

  const backupTimestamp = new Date().toISOString();
  const sanitizedProfile = sanitizeBackupProfile(profile);

  const recordCounts: Record<string, number> = {
    customers: customers.length,
    customerTransactions: customerTransactions.length,
    suppliers: suppliers.length,
    supplierTransactions: supplierTransactions.length,
    sales: sales.length,
    expenses: expenses.length,
    cashbookEntries: cashbookEntries.length,
    products: products.length,
    productCategories: productCategories.length,
    expenseCategories: expenseCategories.length,
    stockAdjustments: stockAdjustments.length,
    auditLogs: auditLogs.length,
    billDocuments: billDocuments.length,
    recurringExpenses: recurringExpenses.length,
    whatsappBatches: whatsappBatches.length,
    whatsappAuditLogs: whatsappAuditLogs.length,
  };

  return {
    appName: 'Arjun Groceries',
    version: '2.2',
    schemaVersion: '2.2.0',
    schema: 'https://smartkirana.app/schemas/backup-v2.2.json',
    backupDate: backupTimestamp,
    exportedAt: backupTimestamp,
    storeProfile: sanitizedProfile,
    summary,
    recordCounts,
    transactions: {
      sales: [...sales],
      customerTransactions: [...customerTransactions],
      supplierTransactions: [...supplierTransactions],
      expenses: [...expenses],
      cashbookEntries: [...cashbookEntries],
    },
    masterData: {
      customers: [...customers],
      suppliers: [...suppliers],
      products: [...products],
    },
    auditTrail: [...auditLogs],
    stockAdjustments: [...stockAdjustments],
    productCategories: [...productCategories],
    expenseCategories: [...expenseCategories],
    billDocuments: [...billDocuments],
    recurringExpenses: [...recurringExpenses],
    dailySalesTarget,
    lastClosedDate,
    whatsappBatches: [...whatsappBatches],
    whatsappAuditLogs: [...whatsappAuditLogs],
    // Top-level aliases for legacy compatibility
    profile: sanitizedProfile,
    customers: [...customers],
    customerTransactions: [...customerTransactions],
    suppliers: [...suppliers],
    supplierTransactions: [...supplierTransactions],
    sales: [...sales],
    expenses: [...expenses],
    cashbookEntries: [...cashbookEntries],
    products: [...products],
    auditLogs: [...auditLogs],
  };
}

/**
 * Formats the backup data into an indented, human-readable JSON string.
 */
export function serializeBackupJSON(backupData: AppBackupData, pretty = true): string {
  return JSON.stringify(backupData, null, pretty ? 2 : 0);
}

/**
 * Triggers a native local file download of the JSON backup with safe Android Chrome revocation delay (60s).
 */
export function downloadBackupJSONFile(jsonString: string, filename?: string): { byteSize: number; fileName: string } {
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const finalFilename = filename || `arjun-groceries-backup-${dateStr}.json`;

  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  if (blob.size <= 0) {
    throw new Error('Generated backup file is empty.');
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = finalFilename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 60_000);

  return { byteSize: blob.size, fileName: finalFilename };
}

export interface ParsedBackupResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
  migratedFromVersion?: string;
  metadata?: {
    appName: string;
    version: string;
    schemaVersion: string;
    backupDate: string;
    exportedAt: string;
    storeName: string;
    ownerName?: string;
    phone?: string;
  };
  data?: {
    profile: StoreProfile;
    customers: Customer[];
    customerTransactions: CustomerTransaction[];
    suppliers: Supplier[];
    supplierTransactions: SupplierTransaction[];
    sales: SaleRecord[];
    expenses: ExpenseRecord[];
    cashbookEntries: CashbookEntry[];
    products: Product[];
    productCategories?: ProductCategoryConfig[];
    expenseCategories?: ExpenseCategoryConfig[];
    stockAdjustments?: StockAdjustmentRecord[];
    auditLogs: AuditLog[];
    billDocuments?: BillAttachment[];
    recurringExpenses?: RecurringExpense[];
    dailySalesTarget?: DailySalesTargetConfig | null;
    lastClosedDate?: string | null;
    whatsappBatches?: WhatsAppReminderBatch[];
    whatsappAuditLogs?: WhatsAppAuditLog[];
  };
  summary?: AppBackupSummary;
  exportedAt?: string;
}

interface RecordValidationOptions {
  nonNegativeFields?: string[];
  requiredStringFields?: string[];
  dateFields?: string[];
}

function isValidDateString(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  return !Number.isNaN(Date.parse(value));
}

function validateCollectionRecords(
  label: string,
  items: unknown[],
  numericFields: string[],
  options: RecordValidationOptions = {}
): string | null {
  const seenIds = new Set<string>();
  const nonNegativeSet = new Set(options.nonNegativeFields || []);
  const requiredStrings = options.requiredStringFields || [];
  const dateFields = options.dateFields || [];

  for (let i = 0; i < items.length; i++) {
    const rec = items[i];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      return `${label} entry #${i + 1} is not a valid object.`;
    }
    const obj = rec as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
      return `${label} entry #${i + 1} is missing a valid id.`;
    }
    const trimmedId = obj.id.trim();
    if (seenIds.has(trimmedId)) {
      return `${label} contains duplicate record id "${trimmedId}".`;
    }
    seenIds.add(trimmedId);

    for (const reqField of requiredStrings) {
      if (typeof obj[reqField] !== 'string' || !String(obj[reqField]).trim()) {
        return `${label} entry "${trimmedId}" is missing required field "${reqField}".`;
      }
    }

    for (const field of numericFields) {
      if (obj[field] !== undefined && obj[field] !== null) {
        const val = Number(obj[field]);
        if (!Number.isFinite(val)) {
          return `${label} entry "${trimmedId}" has invalid numeric field "${field}".`;
        }
        if (nonNegativeSet.has(field) && val < 0) {
          return `${label} entry "${trimmedId}" has negative value (${val}) for "${field}".`;
        }
      }
    }

    for (const dateField of dateFields) {
      if (obj[dateField] !== undefined && obj[dateField] !== null && obj[dateField] !== '') {
        if (!isValidDateString(obj[dateField])) {
          return `${label} entry "${trimmedId}" has invalid date in "${dateField}".`;
        }
      }
    }
  }
  return null;
}

function requireCollectionArray<T>(
  rawValue: unknown,
  label: string
): { ok: true; data: T[] } | { ok: false; error: string } {
  if (rawValue === undefined || rawValue === null) {
    return {
      ok: false,
      error: `Incomplete backup rejected: required "${label}" collection is missing. Existing shop records were not modified.`,
    };
  }
  if (!Array.isArray(rawValue)) {
    return {
      ok: false,
      error: `${label} collection must be an array.`,
    };
  }
  return { ok: true, data: rawValue as T[] };
}

/**
 * Validates and extracts records from an uploaded backup JSON string.
 * Supports v2.2, v2.1, v2.0 (structured under transactions/masterData) and v1.0 (flat top-level) schemas.
 * Rejects incomplete backups that omit required collections instead of silently defaulting to empty arrays.
 */
export function validateAndParseBackupJSON(jsonStr: string): ParsedBackupResult {
  if (!jsonStr || typeof jsonStr !== 'string' || !jsonStr.trim()) {
    return { valid: false, error: 'Backup file is completely empty.' };
  }

  try {
    const raw = JSON.parse(jsonStr);

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { valid: false, error: 'Invalid JSON file: Root content must be a JSON object.' };
    }

    const rawProfile = raw.storeProfile || raw.profile;
    if (!rawProfile || typeof rawProfile !== 'object') {
      return { valid: false, error: 'Backup is missing required store profile information.' };
    }

    if (!rawProfile.storeName || typeof rawProfile.storeName !== 'string' || !rawProfile.storeName.trim()) {
      return { valid: false, error: 'Store profile in backup must contain a valid storeName.' };
    }

    const profile = sanitizeBackupProfile(rawProfile as StoreProfile);
    const warnings: string[] = [];

    // Strict required collections — never silently replace missing core collections with []
    const salesCheck = requireCollectionArray<SaleRecord>(
      raw.transactions?.sales ?? raw.sales,
      'Sales bills'
    );
    if (!salesCheck.ok) return { valid: false, error: salesCheck.error };
    const sales = salesCheck.data;

    const custTxCheck = requireCollectionArray<CustomerTransaction>(
      raw.transactions?.customerTransactions ?? raw.customerTransactions,
      'Customer transactions'
    );
    if (!custTxCheck.ok) return { valid: false, error: custTxCheck.error };
    const customerTransactions = custTxCheck.data;

    const suppTxCheck = requireCollectionArray<SupplierTransaction>(
      raw.transactions?.supplierTransactions ?? raw.supplierTransactions,
      'Supplier transactions'
    );
    if (!suppTxCheck.ok) return { valid: false, error: suppTxCheck.error };
    const supplierTransactions = suppTxCheck.data;

    const expensesCheck = requireCollectionArray<ExpenseRecord>(
      raw.transactions?.expenses ?? raw.expenses,
      'Expenses'
    );
    if (!expensesCheck.ok) return { valid: false, error: expensesCheck.error };
    const expenses = expensesCheck.data;

    const cashbookCheck = requireCollectionArray<CashbookEntry>(
      raw.transactions?.cashbookEntries ?? raw.cashbookEntries,
      'Cashbook entries'
    );
    if (!cashbookCheck.ok) return { valid: false, error: cashbookCheck.error };
    const cashbookEntries = cashbookCheck.data;

    const customersCheck = requireCollectionArray<Customer>(
      raw.masterData?.customers ?? raw.customers,
      'Customers master data'
    );
    if (!customersCheck.ok) return { valid: false, error: customersCheck.error };
    const customers = customersCheck.data;

    const suppliersCheck = requireCollectionArray<Supplier>(
      raw.masterData?.suppliers ?? raw.suppliers,
      'Suppliers master data'
    );
    if (!suppliersCheck.ok) return { valid: false, error: suppliersCheck.error };
    const suppliers = suppliersCheck.data;

    const productsCheck = requireCollectionArray<Product>(
      raw.masterData?.products ?? raw.products,
      'Products inventory'
    );
    if (!productsCheck.ok) return { valid: false, error: productsCheck.error };
    const products = productsCheck.data;

    const schemaVersion = String(raw.schemaVersion || (raw.transactions ? '2.0.0' : '1.0.0'));
    const isV22OrNewer = schemaVersion.startsWith('2.2');

    const auditRaw = raw.auditTrail ?? raw.auditLogs;
    if (auditRaw !== undefined && !Array.isArray(auditRaw)) {
      return { valid: false, error: 'Audit logs collection must be an array.' };
    }
    if (isV22OrNewer && auditRaw === undefined) {
      return {
        valid: false,
        error: 'Incomplete v2.2 backup rejected: required "auditLogs" collection is missing.',
      };
    }
    const auditLogs: AuditLog[] = Array.isArray(auditRaw) ? auditRaw : [];

    const adjRaw = raw.stockAdjustments;
    if (adjRaw !== undefined && !Array.isArray(adjRaw)) {
      return { valid: false, error: 'Stock adjustments collection must be an array.' };
    }
    if (isV22OrNewer && adjRaw === undefined) {
      return {
        valid: false,
        error: 'Incomplete v2.2 backup rejected: required "stockAdjustments" collection is missing.',
      };
    }
    const stockAdjustments: StockAdjustmentRecord[] = Array.isArray(adjRaw) ? adjRaw : [];

    const categoriesRaw = raw.productCategories;
    if (categoriesRaw !== undefined && !Array.isArray(categoriesRaw)) {
      return { valid: false, error: 'Product categories collection must be an array.' };
    }
    const productCategories: ProductCategoryConfig[] = Array.isArray(categoriesRaw) ? categoriesRaw : [];

    const expCategoriesRaw = raw.expenseCategories;
    if (expCategoriesRaw !== undefined && !Array.isArray(expCategoriesRaw)) {
      return { valid: false, error: 'Expense categories collection must be an array.' };
    }
    const expenseCategories: ExpenseCategoryConfig[] = Array.isArray(expCategoriesRaw) ? expCategoriesRaw : [];

    const docsRaw = raw.billDocuments;
    if (docsRaw !== undefined && !Array.isArray(docsRaw)) {
      return { valid: false, error: 'Bill documents collection must be an array.' };
    }
    if (isV22OrNewer && docsRaw === undefined) {
      return {
        valid: false,
        error: 'Incomplete v2.2 backup rejected: required "billDocuments" collection is missing.',
      };
    }
    const billDocuments: BillAttachment[] = Array.isArray(docsRaw) ? docsRaw : [];
    if (docsRaw === undefined) {
      warnings.push('No dedicated billDocuments bundle present in older backup; inline bill attachments will still be restored if present.');
    }

    const recurringRaw = raw.recurringExpenses;
    if (recurringRaw !== undefined && !Array.isArray(recurringRaw)) {
      return { valid: false, error: 'Recurring expenses collection must be an array.' };
    }
    const recurringExpenses: RecurringExpense[] = Array.isArray(recurringRaw) ? recurringRaw : [];

    const dailySalesTarget: DailySalesTargetConfig | null =
      raw.dailySalesTarget && typeof raw.dailySalesTarget === 'object'
        ? (raw.dailySalesTarget as DailySalesTargetConfig)
        : null;

    const lastClosedDate: string | null =
      typeof raw.lastClosedDate === 'string' ? raw.lastClosedDate : null;

    const batchesRaw = raw.whatsappBatches;
    if (batchesRaw !== undefined && !Array.isArray(batchesRaw)) {
      return { valid: false, error: 'WhatsApp batches collection must be an array.' };
    }
    const whatsappBatches: WhatsAppReminderBatch[] = Array.isArray(batchesRaw) ? batchesRaw : [];

    const wLogsRaw = raw.whatsappAuditLogs;
    if (wLogsRaw !== undefined && !Array.isArray(wLogsRaw)) {
      return { valid: false, error: 'WhatsApp audit logs collection must be an array.' };
    }
    const whatsappAuditLogs: WhatsAppAuditLog[] = Array.isArray(wLogsRaw) ? wLogsRaw : [];

    // Per-record field, duplicate ID, numeric bounds, and date validation
    const validationChecks = [
      validateCollectionRecords('Customers', customers, ['openingBalance', 'currentBalance'], {
        requiredStringFields: ['name'],
        dateFields: ['createdAt', 'lastTransactionDate'],
      }),
      validateCollectionRecords('Suppliers', suppliers, ['openingBalance', 'currentBalance'], {
        requiredStringFields: ['name'],
        dateFields: ['createdAt', 'lastTransactionDate'],
      }),
      validateCollectionRecords(
        'Products',
        products,
        ['stockQty', 'purchasePrice', 'sellingPrice', 'minStockAlert'],
        {
          nonNegativeFields: ['stockQty', 'purchasePrice', 'sellingPrice', 'minStockAlert'],
          requiredStringFields: ['name'],
          dateFields: ['updatedAt'],
        }
      ),
      validateCollectionRecords('Sales', sales, ['amount'], {
        nonNegativeFields: ['amount'],
        dateFields: ['date', 'createdAt'],
      }),
      validateCollectionRecords('Customer transactions', customerTransactions, ['amount'], {
        requiredStringFields: ['customerId', 'type', 'date'],
        dateFields: ['date', 'createdAt'],
      }),
      validateCollectionRecords('Supplier transactions', supplierTransactions, ['amount'], {
        requiredStringFields: ['supplierId', 'type', 'date'],
        dateFields: ['date', 'createdAt'],
      }),
      validateCollectionRecords('Expenses', expenses, ['amount'], {
        nonNegativeFields: ['amount'],
        requiredStringFields: ['title', 'date'],
        dateFields: ['date', 'createdAt'],
      }),
      validateCollectionRecords('Cashbook entries', cashbookEntries, ['amount'], {
        nonNegativeFields: ['amount'],
        requiredStringFields: ['type', 'date'],
        dateFields: ['date', 'createdAt'],
      }),
      validateCollectionRecords(
        'Stock adjustments',
        stockAdjustments,
        ['quantityChange', 'previousStock', 'newStock'],
        {
          nonNegativeFields: ['previousStock', 'newStock'],
          requiredStringFields: ['productId', 'type', 'date'],
          dateFields: ['date', 'createdAt'],
        }
      ),
      validateCollectionRecords('Bill documents', billDocuments, ['size'], {
        nonNegativeFields: ['size'],
        requiredStringFields: ['name', 'type', 'dataUrl'],
        dateFields: ['uploadedAt'],
      }),
      validateCollectionRecords('Audit logs', auditLogs, [], {
        dateFields: ['timestamp'],
      }),
    ];
    const firstRecordError = validationChecks.find((e) => e !== null);
    if (firstRecordError) {
      return { valid: false, error: `Corrupted backup record detected: ${firstRecordError}` };
    }

    // Verify declared recordCounts when present in metadata
    if (raw.recordCounts && typeof raw.recordCounts === 'object') {
      const actualCounts: Record<string, number> = {
        customers: customers.length,
        customerTransactions: customerTransactions.length,
        suppliers: suppliers.length,
        supplierTransactions: supplierTransactions.length,
        sales: sales.length,
        expenses: expenses.length,
        cashbookEntries: cashbookEntries.length,
        products: products.length,
        stockAdjustments: stockAdjustments.length,
        auditLogs: auditLogs.length,
        billDocuments: billDocuments.length,
      };
      for (const [key, actual] of Object.entries(actualCounts)) {
        const expected = raw.recordCounts[key];
        if (typeof expected === 'number' && expected !== actual) {
          return {
            valid: false,
            error: `Backup record count mismatch for "${key}": header declares ${expected} record(s), but payload contains ${actual}.`,
          };
        }
      }
    }

    // Cross-collection referential checks (report orphaned FKs as warnings for reconciliation view)
    const custIdSet = new Set(customers.map((c) => c.id));
    const supIdSet = new Set(suppliers.map((s) => s.id));
    const prodIdSet = new Set(products.map((p) => p.id));

    const orphanedCustTxCount = customerTransactions.filter((tx) => !custIdSet.has(tx.customerId)).length;
    if (orphanedCustTxCount > 0) {
      warnings.push(
        `${orphanedCustTxCount} customer transaction(s) refer to a customer ID missing from the customers list.`
      );
    }

    const orphanedSupTxCount = supplierTransactions.filter((tx) => !supIdSet.has(tx.supplierId)).length;
    if (orphanedSupTxCount > 0) {
      warnings.push(
        `${orphanedSupTxCount} supplier transaction(s) refer to a supplier ID missing from the suppliers list.`
      );
    }

    const orphanedAdjCount = stockAdjustments.filter((adj) => !prodIdSet.has(adj.productId)).length;
    if (orphanedAdjCount > 0) {
      warnings.push(
        `${orphanedAdjCount} stock adjustment(s) refer to an archived or removed product ID.`
      );
    }

    // Collect any inline attachments into unified billDocuments if not already present
    const docMap = new Map<string, BillAttachment>();
    for (const d of billDocuments) {
      if (d && d.id && d.dataUrl) docMap.set(d.id, d);
    }
    const collectInline = (list: { attachments?: BillAttachment[] }[]) => {
      for (const item of list) {
        if (!Array.isArray(item.attachments)) continue;
        for (const att of item.attachments) {
          if (att && att.id && att.dataUrl && !docMap.has(att.id)) {
            docMap.set(att.id, att);
          }
        }
      }
    };
    collectInline(sales);
    collectInline(expenses);
    collectInline(customerTransactions);
    collectInline(supplierTransactions);
    collectInline(cashbookEntries);
    const mergedBillDocuments = Array.from(docMap.values());

    const salesTotalVolume = sales.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    const expenseTotalVolume = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

    const totalCustomerOpening = customers.reduce((acc, c) => acc + (Number(c.openingBalance) || 0), 0);
    const totalSupplierOpening = suppliers.reduce((acc, s) => acc + (Number(s.openingBalance) || 0), 0);
    const openingCashEntry = cashbookEntries.find(
      (cb) => cb.category === 'OPENING' || cb.refType === 'OPENING'
    );
    const cashOpeningBalance = openingCashEntry ? Number(openingCashEntry.amount) || 0 : 0;

    const summary: AppBackupSummary = {
      totalTransactions:
        sales.length +
        customerTransactions.length +
        supplierTransactions.length +
        expenses.length +
        cashbookEntries.length,
      salesCount: sales.length,
      salesTotalVolume: Math.round(salesTotalVolume * 100) / 100,
      customerTransactionsCount: customerTransactions.length,
      supplierTransactionsCount: supplierTransactions.length,
      expenseCount: expenses.length,
      expenseTotalVolume: Math.round(expenseTotalVolume * 100) / 100,
      cashbookCount: cashbookEntries.length,
      customersCount: customers.length,
      suppliersCount: suppliers.length,
      productsCount: products.length,
      billDocumentsCount: mergedBillDocuments.length,
      openingBalances: {
        totalCustomerOpening: Math.round(totalCustomerOpening * 100) / 100,
        totalSupplierOpening: Math.round(totalSupplierOpening * 100) / 100,
        cashOpeningBalance: Math.round(cashOpeningBalance * 100) / 100,
      },
    };

    const appName = raw.appName || 'Arjun Groceries';
    const version = raw.version || '1.0';
    const backupDate = raw.backupDate || raw.exportedAt || new Date().toISOString();
    const exportedAt = raw.exportedAt || backupDate;

    if (schemaVersion !== '2.2.0') {
      warnings.push(`Upgraded backup automatically from schema v${schemaVersion} to v2.2.0.`);
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      migratedFromVersion: schemaVersion !== '2.2.0' ? schemaVersion : undefined,
      metadata: {
        appName,
        version,
        schemaVersion,
        backupDate,
        exportedAt,
        storeName: profile.storeName,
        ownerName: profile.ownerName,
        phone: profile.phone,
      },
      exportedAt,
      summary,
      data: {
        profile,
        customers,
        customerTransactions,
        suppliers,
        supplierTransactions,
        sales,
        expenses,
        cashbookEntries,
        products,
        productCategories,
        expenseCategories,
        stockAdjustments,
        auditLogs,
        billDocuments: mergedBillDocuments,
        recurringExpenses,
        dailySalesTarget,
        lastClosedDate,
        whatsappBatches,
        whatsappAuditLogs,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Syntax error in JSON file';
    return {
      valid: false,
      error: `Failed to parse backup JSON: ${msg}`,
    };
  }
}
