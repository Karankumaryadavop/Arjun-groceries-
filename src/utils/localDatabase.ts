/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuditLog,
  AutoBackupSettings,
  BillAttachment,
  BillOcrExtractedData,
  CashbookEntry,
  Customer,
  CustomerTransaction,
  DailySalesTargetConfig,
  ExpenseCategoryConfig,
  ExpenseRecord,
  LocalBackupSnapshot,
  PinSecurityRecord,
  Product,
  ProductCategoryConfig,
  RecurringExpense,
  SaleRecord,
  StockAdjustmentRecord,
  StorageMode,
  StoreBusinessDataset,
  StoreProfile,
  Supplier,
  SupplierTransaction,
  SyncConflictRecord,
  SyncQueueItem,
  WhatsAppAuditLog,
  WhatsAppReminderBatch,
} from '../types';
import {
  calculateCustomerLedgerWithRunningBalance,
  calculateSupplierLedgerWithRunningBalance,
} from './accounting';
import {
  base64ToBytes,
  bytesToBase64,
  hashPinWithSalt,
} from './securityCrypto';
import {
  createEmptyBusinessDataset,
  createEmptyStoreProfile,
  hasAnyPersistedBusinessData,
} from './freshInstall';

export const LOCAL_DB_NAME = 'SmartKirana_Local_DB';
export const LOCAL_DB_VERSION = 2;

export const LEGACY_STORAGE_KEYS = {
  PROFILE: 'kirana_pro_profile_v1',
  CUSTOMERS: 'kirana_pro_customers_v1',
  CUST_TX: 'kirana_pro_cust_tx_v1',
  SUPPLIERS: 'kirana_pro_suppliers_v1',
  SUPP_TX: 'kirana_pro_supp_tx_v1',
  SALES: 'kirana_pro_sales_v1',
  EXPENSES: 'kirana_pro_expenses_v1',
  CASHBOOK: 'kirana_pro_cashbook_v1',
  PRODUCTS: 'kirana_pro_products_v1',
  STOCK_ADJUSTMENTS: 'kirana_pro_stock_adj_v1',
  AUDIT: 'kirana_pro_audit_v1',
  WHATSAPP_BATCHES: 'kirana_pro_whatsapp_batches_v1',
  WHATSAPP_LOGS: 'kirana_pro_whatsapp_logs_v1',
  THEME: 'kirana_pro_theme_v1',
  LAST_CLOSED_DAY: 'kirana_pro_last_closed_v1',
} as const;

export const LEGACY_BUSINESS_STORAGE_KEYS: string[] = [
  LEGACY_STORAGE_KEYS.PROFILE,
  LEGACY_STORAGE_KEYS.CUSTOMERS,
  LEGACY_STORAGE_KEYS.CUST_TX,
  LEGACY_STORAGE_KEYS.SUPPLIERS,
  LEGACY_STORAGE_KEYS.SUPP_TX,
  LEGACY_STORAGE_KEYS.SALES,
  LEGACY_STORAGE_KEYS.EXPENSES,
  LEGACY_STORAGE_KEYS.CASHBOOK,
  LEGACY_STORAGE_KEYS.PRODUCTS,
  LEGACY_STORAGE_KEYS.STOCK_ADJUSTMENTS,
  LEGACY_STORAGE_KEYS.AUDIT,
  LEGACY_STORAGE_KEYS.WHATSAPP_BATCHES,
  LEGACY_STORAGE_KEYS.WHATSAPP_LOGS,
  LEGACY_STORAGE_KEYS.LAST_CLOSED_DAY,
];

export const STORE_NAMES = {
  META: 'meta',
  PROFILE: 'profile',
  CUSTOMERS: 'customers',
  CUSTOMER_TX: 'customerTransactions',
  SUPPLIERS: 'suppliers',
  SUPPLIER_TX: 'supplierTransactions',
  SALES: 'sales',
  EXPENSES: 'expenses',
  CASHBOOK: 'cashbookEntries',
  PRODUCTS: 'products',
  STOCK_ADJUSTMENTS: 'stockAdjustments',
  AUDIT_LOGS: 'auditLogs',
  WHATSAPP_BATCHES: 'whatsappBatches',
  WHATSAPP_LOGS: 'whatsappAuditLogs',
  BILL_DOCUMENTS: 'billDocuments',
  RECURRING_EXPENSES: 'recurringExpenses',
  LOCAL_BACKUPS: 'localBackups',
  SYNC_QUEUE: 'syncQueue',
  SYNC_CONFLICTS: 'syncConflicts',
} as const;

export type LocalStoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

export interface LocalDbMetaRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface StoredBillDocumentRecord {
  id: string;
  name: string;
  type: 'IMAGE' | 'PDF';
  mimeType: string;
  blob?: Blob;
  size: number;
  uploadedAt: string;
  rotation?: number;
  ocrData?: BillOcrExtractedData;
  transactionId?: string;
  transactionType?: BillAttachment['transactionType'];
  fileHash?: string;
  fallbackDataUrl?: string;
}

export interface MigrationReport {
  migrated: boolean;
  alreadyMigrated: boolean;
  source: 'localStorage' | 'seed' | 'fresh_install' | 'existing_idb' | 'v1_upgrade';
  migratedAt: string;
  schemaVersion?: string;
  preMigrationBackupId?: string;
  consolidatedBillDocuments?: number;
  recordCounts: {
    customers: number;
    customerTransactions: number;
    suppliers: number;
    supplierTransactions: number;
    sales: number;
    expenses: number;
    cashbookEntries: number;
    products: number;
    stockAdjustments: number;
    auditLogs: number;
    billDocuments?: number;
    recurringExpenses?: number;
  };
}

export const DEFAULT_AUTO_BACKUP_SETTINGS: AutoBackupSettings = {
  enabled: true,
  intervalMinutes: 30,
  backupAfterImportantBatch: true,
  dailyRetentionCount: 7,
  weeklyRetentionCount: 4,
};

export interface KeyValueStorageLike {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
}

let activeDbAdapterRef: LocalDbAdapter | null = null;

export function registerActiveLocalDbAdapter(adapter: LocalDbAdapter | null): void {
  activeDbAdapterRef = adapter;
}

export function getActiveLocalDbAdapter(): LocalDbAdapter | null {
  return activeDbAdapterRef;
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    (typeof e.message === 'string' && e.message.toLowerCase().includes('quota'))
  );
}

export function formatStorageError(err: unknown, context = 'save business data'): Error {
  if (isQuotaExceededError(err)) {
    return new Error(
      `Device storage is full (QuotaExceededError) while trying to ${context}. Export an encrypted backup and clear old bill photos or snapshots to free space.`
    );
  }
  if (err instanceof Error) return err;
  return new Error(`Failed to ${context}: ${String(err)}`);
}

/**
 * Pure helper to deduplicate records by `id` (preserving latest occurrence) to prevent duplicates.
 */
export function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  if (!Array.isArray(items)) return [];
  const map = new Map<string, T>();
  for (const item of items) {
    if (item && typeof item.id === 'string' && item.id.trim()) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

/**
 * Deterministic fast hash for payload change detection and idempotency keys.
 */
export function computeDeterministicHash(input: string): string {
  let hash1 = 0x811c9dc5;
  let hash2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 0x01000193);
    hash2 ^= code + ((hash1 >>> 0) & 0xff);
    hash2 = Math.imul(hash2, 0x85ebca6b);
  }
  return `${(hash1 >>> 0).toString(16).padStart(8, '0')}${(hash2 >>> 0).toString(16).padStart(8, '0')}`;
}

const SENSITIVE_STORAGE_PROFILE_KEYS = [
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

export function sanitizeProfileForStorage(profile: StoreProfile): StoreProfile {
  const sanitized = { ...(profile as StoreProfile & Record<string, unknown>) };
  for (const key of SENSITIVE_STORAGE_PROFILE_KEYS) {
    delete sanitized[key];
  }
  return sanitized as StoreProfile;
}

export function dataUrlToBlob(dataUrl: string, fallbackType = 'application/octet-stream'): {
  blob?: Blob;
  mimeType: string;
} {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { mimeType: fallbackType };
  }
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    return { mimeType: fallbackType };
  }
  const mimeType = match[1] || fallbackType;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';

  if (typeof Blob === 'undefined') {
    return { mimeType };
  }

  try {
    const bytes = isBase64
      ? base64ToBytes(payload)
      : new TextEncoder().encode(decodeURIComponent(payload));
    const bufferCopy = new Uint8Array(bytes.byteLength);
    bufferCopy.set(bytes);
    return {
      blob: new Blob([bufferCopy.buffer], { type: mimeType }),
      mimeType,
    };
  } catch {
    return { mimeType };
  }
}

export async function blobToDataUrl(blob: Blob, mimeType?: string): Promise<string> {
  const resolvedType = mimeType || blob.type || 'application/octet-stream';
  const buf = await blob.arrayBuffer();
  const base64 = bytesToBase64(new Uint8Array(buf));
  return `data:${resolvedType};base64,${base64}`;
}

export function attachmentToStoredRecord(att: BillAttachment): StoredBillDocumentRecord {
  const fallbackMime = att.type === 'PDF' ? 'application/pdf' : 'image/jpeg';
  const { blob, mimeType } = dataUrlToBlob(att.dataUrl, fallbackMime);
  return {
    id: att.id,
    name: att.name,
    type: att.type,
    mimeType,
    blob,
    size: Number(att.size) || blob?.size || 0,
    uploadedAt: att.uploadedAt || new Date().toISOString(),
    rotation: att.rotation,
    ocrData: att.ocrData,
    transactionId: att.transactionId,
    transactionType: att.transactionType,
    fileHash: att.fileHash,
    fallbackDataUrl: blob ? undefined : att.dataUrl,
  };
}

export async function storedRecordToAttachment(rec: StoredBillDocumentRecord): Promise<BillAttachment> {
  let dataUrl = rec.fallbackDataUrl || '';
  if (!dataUrl && rec.blob && typeof rec.blob.arrayBuffer === 'function') {
    dataUrl = await blobToDataUrl(rec.blob, rec.mimeType);
  }
  return {
    id: rec.id,
    name: rec.name,
    type: rec.type,
    dataUrl,
    size: rec.size,
    uploadedAt: rec.uploadedAt,
    rotation: rec.rotation,
    ocrData: rec.ocrData,
    transactionId: rec.transactionId,
    transactionType: rec.transactionType,
    fileHash: rec.fileHash,
  };
}

/**
 * Strips Base64 `dataUrl` payloads from inline transaction attachment references before persisting
 * transaction stores, preventing duplicate multi-megabyte Base64 copies across IndexedDB stores.
 */
function stripAttachmentDataUrlsFromList(
  attachments: BillAttachment[] | undefined,
  collector: Map<string, BillAttachment>,
  txId: string,
  txType: BillAttachment['transactionType']
): BillAttachment[] | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) return attachments;
  return attachments.map((att) => {
    if (att.dataUrl && att.dataUrl.startsWith('data:')) {
      const existing = collector.get(att.id);
      if (!existing || !existing.dataUrl) {
        collector.set(att.id, {
          ...att,
          transactionId: att.transactionId || txId,
          transactionType: att.transactionType || txType,
        });
      }
    }
    return {
      ...att,
      dataUrl: '',
      transactionId: att.transactionId || txId,
      transactionType: att.transactionType || txType,
    };
  });
}

function rehydrateAttachmentsOnList(
  attachments: BillAttachment[] | undefined,
  docMap: Map<string, BillAttachment>
): BillAttachment[] | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) return attachments;
  return attachments.map((att) => {
    if (att.dataUrl && att.dataUrl.length > 0) return att;
    const found = docMap.get(att.id);
    return found ? { ...att, dataUrl: found.dataUrl, fileHash: att.fileHash || found.fileHash } : att;
  });
}

/**
 * Collects all unique BillAttachments (with dataUrl) from dataset.billDocuments and inline
 * transaction attachments, while returning sanitized transaction arrays without Base64 duplication.
 */
function extractAndDeduplicateDatasetAttachments(dataset: StoreBusinessDataset): {
  billDocuments: BillAttachment[];
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  customerTransactions: CustomerTransaction[];
  supplierTransactions: SupplierTransaction[];
  cashbookEntries: CashbookEntry[];
} {
  const collector = new Map<string, BillAttachment>();
  if (Array.isArray(dataset.billDocuments)) {
    for (const doc of dataset.billDocuments) {
      if (doc && doc.id && doc.dataUrl) {
        collector.set(doc.id, doc);
      }
    }
  }

  const sales = (dataset.sales || []).map((s) => ({
    ...s,
    attachments: stripAttachmentDataUrlsFromList(s.attachments, collector, s.id, 'SALE'),
  }));
  const expenses = (dataset.expenses || []).map((e) => ({
    ...e,
    attachments: stripAttachmentDataUrlsFromList(e.attachments, collector, e.id, 'EXPENSE'),
  }));
  const customerTransactions = (dataset.customerTransactions || []).map((t) => ({
    ...t,
    attachments: stripAttachmentDataUrlsFromList(t.attachments, collector, t.id, 'CUSTOMER_PAYMENT'),
  }));
  const supplierTransactions = (dataset.supplierTransactions || []).map((t) => ({
    ...t,
    attachments: stripAttachmentDataUrlsFromList(t.attachments, collector, t.id, 'PURCHASE'),
  }));
  const cashbookEntries = (dataset.cashbookEntries || []).map((c) => ({
    ...c,
    attachments: stripAttachmentDataUrlsFromList(c.attachments, collector, c.id, 'CASHBOOK'),
  }));

  return {
    billDocuments: Array.from(collector.values()),
    sales,
    expenses,
    customerTransactions,
    supplierTransactions,
    cashbookEntries,
  };
}

/**
 * Rebuilds opening-balance + transaction-derived balances on customers & suppliers so restored
 * or migrated ledgers are always mathematically consistent.
 */
export function recalculateLedgerBalancesFromHistory(
  dataset: StoreBusinessDataset
): StoreBusinessDataset {
  const customers = (dataset.customers || []).map((cust) => {
    const custTxs = (dataset.customerTransactions || []).filter((t) => t.customerId === cust.id);
    const summary = calculateCustomerLedgerWithRunningBalance(cust, custTxs);
    const hasTx = summary.activeCount > 0;
    if (!hasTx) {
      const preservedBalance = Number(cust.openingBalance ?? cust.currentBalance ?? 0) || 0;
      if (custTxs.length === 0 && cust.openingBalance === undefined) {
        return {
          ...cust,
          currentBalance: preservedBalance,
        };
      }
      return {
        ...cust,
        currentBalance: summary.closingBalance,
        totalCreditGiven: summary.totalCreditGiven,
        totalPaymentReceived: summary.totalPaymentReceived,
        lastTransactionDate: cust.createdAt,
        category:
          summary.closingBalance <= 0
            ? ('CLEARED' as const)
            : summary.closingBalance >= 5000
            ? ('HIGH_CREDIT' as const)
            : cust.category === 'CLEARED'
            ? ('REGULAR' as const)
            : cust.category,
      };
    }
    const closing = summary.closingBalance;
    const category =
      closing <= 0
        ? ('CLEARED' as const)
        : closing >= 5000
        ? ('HIGH_CREDIT' as const)
        : cust.category === 'CLEARED'
        ? ('REGULAR' as const)
        : cust.category;

    return {
      ...cust,
      currentBalance: closing,
      totalCreditGiven: summary.totalCreditGiven,
      totalPaymentReceived: summary.totalPaymentReceived,
      lastTransactionDate: summary.lastTransactionDate || cust.lastTransactionDate,
      category,
    };
  });

  const suppliers = (dataset.suppliers || []).map((sup) => {
    const supTxs = (dataset.supplierTransactions || []).filter((t) => t.supplierId === sup.id);
    const summary = calculateSupplierLedgerWithRunningBalance(sup, supTxs);
    if (summary.activeCount === 0) {
      if (supTxs.length === 0 && sup.openingBalance === undefined) {
        return {
          ...sup,
          currentBalance: Number(sup.openingBalance ?? sup.currentBalance ?? 0) || 0,
        };
      }
      return {
        ...sup,
        currentBalance: summary.closingBalance,
        totalPurchases: summary.totalPurchases,
        totalPaid: summary.totalPaid,
        lastTransactionDate: sup.createdAt,
      };
    }
    return {
      ...sup,
      currentBalance: summary.closingBalance,
      totalPurchases: summary.totalPurchases,
      totalPaid: summary.totalPaid,
      lastTransactionDate: summary.lastTransactionDate || sup.lastTransactionDate,
    };
  });

  return {
    ...dataset,
    customers,
    suppliers,
  };
}

export interface LocalDbAdapter {
  readonly isIndexedDB: boolean;
  getAll<T>(storeName: LocalStoreName): Promise<T[]>;
  getByKey<T>(storeName: LocalStoreName, key: string): Promise<T | null>;
  putOne<T>(storeName: LocalStoreName, record: T): Promise<void>;
  deleteOne(storeName: LocalStoreName, key: string): Promise<void>;
  replaceStoreAtomic<T>(storeName: LocalStoreName, records: T[]): Promise<void>;
  commitBusinessDatasetAtomic(dataset: StoreBusinessDataset, extraMeta?: LocalDbMetaRecord[]): Promise<void>;
  loadBusinessDataset(): Promise<Partial<StoreBusinessDataset>>;
  getBillDocuments(): Promise<BillAttachment[]>;
  saveBillDocumentRecord(doc: BillAttachment): Promise<void>;
  deleteBillDocumentRecord(id: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
  setMeta<T>(key: string, value: T): Promise<void>;
  close?(): void;
}

/**
 * In-memory fallback adapter used when IndexedDB is unavailable or in unit tests.
 */
export function createMemoryLocalDbAdapter(): LocalDbAdapter {
  const stores = new Map<LocalStoreName, Map<string, unknown>>();
  Object.values(STORE_NAMES).forEach((name) => {
    stores.set(name, new Map());
  });

  const getKeyField = (storeName: LocalStoreName): string =>
    storeName === STORE_NAMES.META ? 'key' : 'id';

  const getStoreMap = (storeName: LocalStoreName): Map<string, unknown> => {
    let map = stores.get(storeName);
    if (!map) {
      map = new Map();
      stores.set(storeName, map);
    }
    return map;
  };

  return {
    isIndexedDB: false,

    async getAll<T>(storeName: LocalStoreName): Promise<T[]> {
      return Array.from(getStoreMap(storeName).values()).map((v) => structuredClone(v) as T);
    },

    async getByKey<T>(storeName: LocalStoreName, key: string): Promise<T | null> {
      const val = getStoreMap(storeName).get(key);
      return val !== undefined ? (structuredClone(val) as T) : null;
    },

    async putOne<T>(storeName: LocalStoreName, record: T): Promise<void> {
      const keyField = getKeyField(storeName);
      const id = String((record as Record<string, unknown>)[keyField] || '');
      if (!id) throw new Error(`Missing key field "${keyField}" for store ${storeName}`);
      getStoreMap(storeName).set(id, structuredClone(record));
    },

    async deleteOne(storeName: LocalStoreName, key: string): Promise<void> {
      getStoreMap(storeName).delete(key);
    },

    async replaceStoreAtomic<T>(storeName: LocalStoreName, records: T[]): Promise<void> {
      const keyField = getKeyField(storeName);
      const next = new Map<string, unknown>();
      for (const rec of records) {
        const id = String((rec as Record<string, unknown>)[keyField] || '');
        if (id) {
          next.set(id, structuredClone(rec));
        }
      }
      stores.set(storeName, next);
    },

    async commitBusinessDatasetAtomic(
      dataset: StoreBusinessDataset,
      extraMeta: LocalDbMetaRecord[] = []
    ): Promise<void> {
      const backupSnapshot = new Map<LocalStoreName, Map<string, unknown>>();
      stores.forEach((m, k) => {
        backupSnapshot.set(k, new Map(m));
      });
      try {
        const {
          billDocuments,
          sales,
          expenses,
          customerTransactions,
          supplierTransactions,
          cashbookEntries,
        } = extractAndDeduplicateDatasetAttachments(dataset);

        await this.replaceStoreAtomic(STORE_NAMES.PROFILE, [
          sanitizeProfileForStorage({ ...dataset.profile, id: dataset.profile.id || 'store-1' }),
        ]);
        await this.replaceStoreAtomic(STORE_NAMES.CUSTOMERS, deduplicateById(dataset.customers));
        await this.replaceStoreAtomic(STORE_NAMES.CUSTOMER_TX, deduplicateById(customerTransactions));
        await this.replaceStoreAtomic(STORE_NAMES.SUPPLIERS, deduplicateById(dataset.suppliers));
        await this.replaceStoreAtomic(STORE_NAMES.SUPPLIER_TX, deduplicateById(supplierTransactions));
        await this.replaceStoreAtomic(STORE_NAMES.SALES, deduplicateById(sales));
        await this.replaceStoreAtomic(STORE_NAMES.EXPENSES, deduplicateById(expenses));
        await this.replaceStoreAtomic(STORE_NAMES.CASHBOOK, deduplicateById(cashbookEntries));
        await this.replaceStoreAtomic(STORE_NAMES.PRODUCTS, deduplicateById(dataset.products));
        await this.replaceStoreAtomic(STORE_NAMES.STOCK_ADJUSTMENTS, deduplicateById(dataset.stockAdjustments));
        await this.replaceStoreAtomic(STORE_NAMES.AUDIT_LOGS, deduplicateById(dataset.auditLogs));
        await this.replaceStoreAtomic(STORE_NAMES.WHATSAPP_BATCHES, deduplicateById(dataset.whatsappBatches));
        await this.replaceStoreAtomic(STORE_NAMES.WHATSAPP_LOGS, deduplicateById(dataset.whatsappAuditLogs));
        if (dataset.recurringExpenses !== undefined) {
          await this.replaceStoreAtomic(
            STORE_NAMES.RECURRING_EXPENSES,
            deduplicateById(dataset.recurringExpenses)
          );
        }

        // Preserve previously stored documents unless explicitly replaced with billDocuments
        if (dataset.billDocuments !== undefined) {
          await this.replaceStoreAtomic(
            STORE_NAMES.BILL_DOCUMENTS,
            billDocuments.map(attachmentToStoredRecord)
          );
        } else {
          for (const doc of billDocuments) {
            await this.putOne(STORE_NAMES.BILL_DOCUMENTS, attachmentToStoredRecord(doc));
          }
        }

        if (dataset.lastClosedDate !== undefined) {
          await this.setMeta('lastClosedDate', dataset.lastClosedDate);
        }
        if (dataset.dailySalesTarget !== undefined) {
          await this.setMeta('dailySalesTarget', dataset.dailySalesTarget);
        }
        if (dataset.productCategories !== undefined) {
          await this.setMeta('productCategories', dataset.productCategories);
        }
        if (dataset.expenseCategories !== undefined) {
          await this.setMeta('expenseCategories', dataset.expenseCategories);
        }
        for (const metaRec of extraMeta) {
          await this.putOne(STORE_NAMES.META, metaRec);
        }
      } catch (err) {
        stores.clear();
        backupSnapshot.forEach((m, k) => stores.set(k, m));
        throw formatStorageError(err, 'commit local database transaction');
      }
    },

    async loadBusinessDataset(): Promise<Partial<StoreBusinessDataset>> {
      const profiles = await this.getAll<StoreProfile>(STORE_NAMES.PROFILE);
      const lastClosedDate = await this.getMeta<string | null>('lastClosedDate');
      const dailySalesTarget = await this.getMeta<DailySalesTargetConfig | null>('dailySalesTarget');
      const productCategories = await this.getMeta<ProductCategoryConfig[]>('productCategories');
      const expenseCategories = await this.getMeta<ExpenseCategoryConfig[]>('expenseCategories');
      const rawDocs = await this.getAll<StoredBillDocumentRecord>(STORE_NAMES.BILL_DOCUMENTS);
      const billDocuments = await Promise.all(rawDocs.map(storedRecordToAttachment));
      const docMap = new Map(billDocuments.map((d) => [d.id, d]));

      const rawSales = await this.getAll<SaleRecord>(STORE_NAMES.SALES);
      const rawExpenses = await this.getAll<ExpenseRecord>(STORE_NAMES.EXPENSES);
      const rawCustTx = await this.getAll<CustomerTransaction>(STORE_NAMES.CUSTOMER_TX);
      const rawSuppTx = await this.getAll<SupplierTransaction>(STORE_NAMES.SUPPLIER_TX);
      const rawCashbook = await this.getAll<CashbookEntry>(STORE_NAMES.CASHBOOK);

      return {
        profile: profiles[0] ? sanitizeProfileForStorage(profiles[0]) : undefined,
        customers: await this.getAll<Customer>(STORE_NAMES.CUSTOMERS),
        customerTransactions: rawCustTx.map((t) => ({
          ...t,
          attachments: rehydrateAttachmentsOnList(t.attachments, docMap),
        })),
        suppliers: await this.getAll<Supplier>(STORE_NAMES.SUPPLIERS),
        supplierTransactions: rawSuppTx.map((t) => ({
          ...t,
          attachments: rehydrateAttachmentsOnList(t.attachments, docMap),
        })),
        sales: rawSales.map((s) => ({
          ...s,
          attachments: rehydrateAttachmentsOnList(s.attachments, docMap),
        })),
        expenses: rawExpenses.map((e) => ({
          ...e,
          attachments: rehydrateAttachmentsOnList(e.attachments, docMap),
        })),
        cashbookEntries: rawCashbook.map((c) => ({
          ...c,
          attachments: rehydrateAttachmentsOnList(c.attachments, docMap),
        })),
        products: await this.getAll<Product>(STORE_NAMES.PRODUCTS),
        productCategories: Array.isArray(productCategories) ? productCategories : undefined,
        expenseCategories: Array.isArray(expenseCategories) ? expenseCategories : undefined,
        stockAdjustments: await this.getAll<StockAdjustmentRecord>(STORE_NAMES.STOCK_ADJUSTMENTS),
        auditLogs: await this.getAll<AuditLog>(STORE_NAMES.AUDIT_LOGS),
        whatsappBatches: await this.getAll<WhatsAppReminderBatch>(STORE_NAMES.WHATSAPP_BATCHES),
        whatsappAuditLogs: await this.getAll<WhatsAppAuditLog>(STORE_NAMES.WHATSAPP_LOGS),
        recurringExpenses: await this.getAll<RecurringExpense>(STORE_NAMES.RECURRING_EXPENSES),
        billDocuments,
        dailySalesTarget: dailySalesTarget ?? null,
        lastClosedDate: lastClosedDate ?? undefined,
      };
    },

    async getBillDocuments(): Promise<BillAttachment[]> {
      const rawDocs = await this.getAll<StoredBillDocumentRecord>(STORE_NAMES.BILL_DOCUMENTS);
      const hydrated = await Promise.all(rawDocs.map(storedRecordToAttachment));
      return hydrated.sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
    },

    async saveBillDocumentRecord(doc: BillAttachment): Promise<void> {
      await this.putOne(STORE_NAMES.BILL_DOCUMENTS, attachmentToStoredRecord(doc));
    },

    async deleteBillDocumentRecord(id: string): Promise<void> {
      await this.deleteOne(STORE_NAMES.BILL_DOCUMENTS, id);
    },

    async getMeta<T>(key: string): Promise<T | null> {
      const rec = await this.getByKey<LocalDbMetaRecord>(STORE_NAMES.META, key);
      return rec ? (rec.value as T) : null;
    },

    async setMeta<T>(key: string, value: T): Promise<void> {
      await this.putOne<LocalDbMetaRecord>(STORE_NAMES.META, {
        key,
        value,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}

function createObjectStoresIfNeeded(db: IDBDatabase, oldVersion: number) {
  const ensureStore = (name: LocalStoreName, keyPath: string, indexes: string[] = []) => {
    let store: IDBObjectStore;
    if (!db.objectStoreNames.contains(name)) {
      store = db.createObjectStore(name, { keyPath });
    } else {
      return;
    }
    for (const idx of indexes) {
      if (!store.indexNames.contains(idx)) {
        store.createIndex(idx, idx, { unique: false });
      }
    }
  };

  if (oldVersion < 1) {
    ensureStore(STORE_NAMES.META, 'key');
    ensureStore(STORE_NAMES.PROFILE, 'id');
    ensureStore(STORE_NAMES.CUSTOMERS, 'id', ['phone', 'category']);
    ensureStore(STORE_NAMES.CUSTOMER_TX, 'id', ['customerId', 'date']);
    ensureStore(STORE_NAMES.SUPPLIERS, 'id', ['phone']);
    ensureStore(STORE_NAMES.SUPPLIER_TX, 'id', ['supplierId', 'date']);
    ensureStore(STORE_NAMES.SALES, 'id', ['date', 'customerId', 'invoiceNo']);
    ensureStore(STORE_NAMES.EXPENSES, 'id', ['date', 'category']);
    ensureStore(STORE_NAMES.CASHBOOK, 'id', ['date', 'refType']);
    ensureStore(STORE_NAMES.PRODUCTS, 'id', ['category', 'preferredSupplierId']);
    ensureStore(STORE_NAMES.STOCK_ADJUSTMENTS, 'id', ['productId', 'date']);
    ensureStore(STORE_NAMES.AUDIT_LOGS, 'id', ['timestamp', 'entityType']);
    ensureStore(STORE_NAMES.WHATSAPP_BATCHES, 'id', ['createdAt', 'status']);
    ensureStore(STORE_NAMES.WHATSAPP_LOGS, 'id', ['timestamp', 'customerId', 'batchId']);
    ensureStore(STORE_NAMES.LOCAL_BACKUPS, 'id', ['createdAt', 'bucket', 'dateKey']);
    ensureStore(STORE_NAMES.SYNC_QUEUE, 'id', ['status', 'entityType', 'idempotencyKey']);
    ensureStore(STORE_NAMES.SYNC_CONFLICTS, 'id', ['resolved', 'entityType']);
  }

  if (oldVersion < 2) {
    ensureStore(STORE_NAMES.BILL_DOCUMENTS, 'id', ['uploadedAt', 'type', 'transactionId', 'fileHash']);
    ensureStore(STORE_NAMES.RECURRING_EXPENSES, 'id', ['nextDueDate', 'isActive', 'frequency']);
  }
}

export function isIndexedDBSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/**
 * Opens the SmartKirana_Local_DB (v2) IndexedDB instance and returns a unified adapter.
 * Falls back transparently to in-memory storage if IndexedDB is unavailable.
 */
export async function openLocalDatabase(customFactory?: IDBFactory): Promise<LocalDbAdapter> {
  const factory = customFactory || (typeof window !== 'undefined' ? window.indexedDB : undefined);
  if (!factory) {
    const mem = createMemoryLocalDbAdapter();
    registerActiveLocalDbAdapter(mem);
    return mem;
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const upgradeDb = request.result;
      createObjectStoresIfNeeded(upgradeDb, event.oldVersion || 0);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(formatStorageError(request.error, 'open SmartKirana_Local_DB'));
  });

  const runReadTx = <T>(
    storeName: LocalStoreName,
    op: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = op(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(formatStorageError(req.error, `read ${storeName}`));
    });
  };

  const runWriteTx = (
    storeNames: LocalStoreName[],
    fn: (stores: Record<string, IDBObjectStore>) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeNames, 'readwrite');
        const map: Record<string, IDBObjectStore> = {};
        for (const name of storeNames) {
          map[name] = tx.objectStore(name);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(formatStorageError(tx.error, 'commit IndexedDB transaction'));
        tx.onabort = () => reject(formatStorageError(tx.error, 'complete IndexedDB transaction'));
        fn(map);
      } catch (err) {
        reject(formatStorageError(err, 'start IndexedDB transaction'));
      }
    });
  };

  const businessStores: LocalStoreName[] = [
    STORE_NAMES.META,
    STORE_NAMES.PROFILE,
    STORE_NAMES.CUSTOMERS,
    STORE_NAMES.CUSTOMER_TX,
    STORE_NAMES.SUPPLIERS,
    STORE_NAMES.SUPPLIER_TX,
    STORE_NAMES.SALES,
    STORE_NAMES.EXPENSES,
    STORE_NAMES.CASHBOOK,
    STORE_NAMES.PRODUCTS,
    STORE_NAMES.STOCK_ADJUSTMENTS,
    STORE_NAMES.AUDIT_LOGS,
    STORE_NAMES.WHATSAPP_BATCHES,
    STORE_NAMES.WHATSAPP_LOGS,
    STORE_NAMES.BILL_DOCUMENTS,
    STORE_NAMES.RECURRING_EXPENSES,
  ];

  const adapter: LocalDbAdapter = {
    isIndexedDB: true,

    async getAll<T>(storeName: LocalStoreName): Promise<T[]> {
      const res = await runReadTx<T[]>(storeName, (s) => s.getAll() as IDBRequest<T[]>);
      return Array.isArray(res) ? res : [];
    },

    async getByKey<T>(storeName: LocalStoreName, key: string): Promise<T | null> {
      const res = await runReadTx<T | undefined>(
        storeName,
        (s) => s.get(key) as IDBRequest<T | undefined>
      );
      return res ?? null;
    },

    async putOne<T>(storeName: LocalStoreName, record: T): Promise<void> {
      await runWriteTx([storeName], (stores) => {
        stores[storeName].put(record);
      });
    },

    async deleteOne(storeName: LocalStoreName, key: string): Promise<void> {
      await runWriteTx([storeName], (stores) => {
        stores[storeName].delete(key);
      });
    },

    async replaceStoreAtomic<T>(storeName: LocalStoreName, records: T[]): Promise<void> {
      await runWriteTx([storeName], (stores) => {
        const s = stores[storeName];
        s.clear();
        for (const rec of records) {
          s.put(rec);
        }
      });
    },

    async commitBusinessDatasetAtomic(
      dataset: StoreBusinessDataset,
      extraMeta: LocalDbMetaRecord[] = []
    ): Promise<void> {
      const {
        billDocuments,
        sales,
        expenses,
        customerTransactions,
        supplierTransactions,
        cashbookEntries,
      } = extractAndDeduplicateDatasetAttachments(dataset);

      const storedDocRecords = billDocuments.map(attachmentToStoredRecord);

      await runWriteTx(businessStores, (stores) => {
        const putCollection = <T extends { id: string }>(storeName: LocalStoreName, list: T[]) => {
          const s = stores[storeName];
          s.clear();
          const deduped = deduplicateById(list);
          for (const item of deduped) {
            s.put(item);
          }
        };

        const pStore = stores[STORE_NAMES.PROFILE];
        pStore.clear();
        pStore.put(sanitizeProfileForStorage({ ...dataset.profile, id: dataset.profile.id || 'store-1' }));

        putCollection(STORE_NAMES.CUSTOMERS, dataset.customers);
        putCollection(STORE_NAMES.CUSTOMER_TX, customerTransactions);
        putCollection(STORE_NAMES.SUPPLIERS, dataset.suppliers);
        putCollection(STORE_NAMES.SUPPLIER_TX, supplierTransactions);
        putCollection(STORE_NAMES.SALES, sales);
        putCollection(STORE_NAMES.EXPENSES, expenses);
        putCollection(STORE_NAMES.CASHBOOK, cashbookEntries);
        putCollection(STORE_NAMES.PRODUCTS, dataset.products);
        putCollection(STORE_NAMES.STOCK_ADJUSTMENTS, dataset.stockAdjustments);
        putCollection(STORE_NAMES.AUDIT_LOGS, dataset.auditLogs);
        putCollection(STORE_NAMES.WHATSAPP_BATCHES, dataset.whatsappBatches);
        putCollection(STORE_NAMES.WHATSAPP_LOGS, dataset.whatsappAuditLogs);

        if (dataset.recurringExpenses !== undefined) {
          putCollection(STORE_NAMES.RECURRING_EXPENSES, dataset.recurringExpenses);
        }

        const docStore = stores[STORE_NAMES.BILL_DOCUMENTS];
        if (dataset.billDocuments !== undefined) {
          docStore.clear();
        }
        for (const docRec of storedDocRecords) {
          docStore.put(docRec);
        }

        if (dataset.lastClosedDate !== undefined) {
          stores[STORE_NAMES.META].put({
            key: 'lastClosedDate',
            value: dataset.lastClosedDate,
            updatedAt: new Date().toISOString(),
          });
        }
        if (dataset.dailySalesTarget !== undefined) {
          stores[STORE_NAMES.META].put({
            key: 'dailySalesTarget',
            value: dataset.dailySalesTarget,
            updatedAt: new Date().toISOString(),
          });
        }
        if (dataset.productCategories !== undefined) {
          stores[STORE_NAMES.META].put({
            key: 'productCategories',
            value: dataset.productCategories,
            updatedAt: new Date().toISOString(),
          });
        }
        if (dataset.expenseCategories !== undefined) {
          stores[STORE_NAMES.META].put({
            key: 'expenseCategories',
            value: dataset.expenseCategories,
            updatedAt: new Date().toISOString(),
          });
        }
        for (const metaRec of extraMeta) {
          stores[STORE_NAMES.META].put(metaRec);
        }
      });
    },

    async loadBusinessDataset(): Promise<Partial<StoreBusinessDataset>> {
      const raw = await new Promise<{
        profile?: StoreProfile;
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
        stockAdjustments: StockAdjustmentRecord[];
        auditLogs: AuditLog[];
        whatsappBatches: WhatsAppReminderBatch[];
        whatsappAuditLogs: WhatsAppAuditLog[];
        recurringExpenses: RecurringExpense[];
        storedDocs: StoredBillDocumentRecord[];
        lastClosedDate?: string | null;
        dailySalesTarget?: DailySalesTargetConfig | null;
      }>((resolve, reject) => {
        const tx = db.transaction(businessStores, 'readonly');
        const result = {
          customers: [] as Customer[],
          customerTransactions: [] as CustomerTransaction[],
          suppliers: [] as Supplier[],
          supplierTransactions: [] as SupplierTransaction[],
          sales: [] as SaleRecord[],
          expenses: [] as ExpenseRecord[],
          cashbookEntries: [] as CashbookEntry[],
          products: [] as Product[],
          stockAdjustments: [] as StockAdjustmentRecord[],
          auditLogs: [] as AuditLog[],
          whatsappBatches: [] as WhatsAppReminderBatch[],
          whatsappAuditLogs: [] as WhatsAppAuditLog[],
          recurringExpenses: [] as RecurringExpense[],
          storedDocs: [] as StoredBillDocumentRecord[],
        } as {
          profile?: StoreProfile;
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
          stockAdjustments: StockAdjustmentRecord[];
          auditLogs: AuditLog[];
          whatsappBatches: WhatsAppReminderBatch[];
          whatsappAuditLogs: WhatsAppAuditLog[];
          recurringExpenses: RecurringExpense[];
          storedDocs: StoredBillDocumentRecord[];
          lastClosedDate?: string | null;
          dailySalesTarget?: DailySalesTargetConfig | null;
        };

        tx.onerror = () =>
          reject(formatStorageError(tx.error, 'load business dataset from IndexedDB'));

        const readAll = <T>(storeName: LocalStoreName, assign: (items: T[]) => void) => {
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => assign(Array.isArray(req.result) ? req.result : []);
        };

        readAll<StoreProfile>(STORE_NAMES.PROFILE, (items) => {
          if (items.length > 0) result.profile = sanitizeProfileForStorage(items[0]);
        });
        readAll<Customer>(STORE_NAMES.CUSTOMERS, (items) => {
          result.customers = items;
        });
        readAll<CustomerTransaction>(STORE_NAMES.CUSTOMER_TX, (items) => {
          result.customerTransactions = items;
        });
        readAll<Supplier>(STORE_NAMES.SUPPLIERS, (items) => {
          result.suppliers = items;
        });
        readAll<SupplierTransaction>(STORE_NAMES.SUPPLIER_TX, (items) => {
          result.supplierTransactions = items;
        });
        readAll<SaleRecord>(STORE_NAMES.SALES, (items) => {
          result.sales = items;
        });
        readAll<ExpenseRecord>(STORE_NAMES.EXPENSES, (items) => {
          result.expenses = items;
        });
        readAll<CashbookEntry>(STORE_NAMES.CASHBOOK, (items) => {
          result.cashbookEntries = items;
        });
        readAll<Product>(STORE_NAMES.PRODUCTS, (items) => {
          result.products = items;
        });
        readAll<StockAdjustmentRecord>(STORE_NAMES.STOCK_ADJUSTMENTS, (items) => {
          result.stockAdjustments = items;
        });
        readAll<AuditLog>(STORE_NAMES.AUDIT_LOGS, (items) => {
          result.auditLogs = items;
        });
        readAll<WhatsAppReminderBatch>(STORE_NAMES.WHATSAPP_BATCHES, (items) => {
          result.whatsappBatches = items;
        });
        readAll<WhatsAppAuditLog>(STORE_NAMES.WHATSAPP_LOGS, (items) => {
          result.whatsappAuditLogs = items;
        });
        readAll<RecurringExpense>(STORE_NAMES.RECURRING_EXPENSES, (items) => {
          result.recurringExpenses = items;
        });
        readAll<StoredBillDocumentRecord>(STORE_NAMES.BILL_DOCUMENTS, (items) => {
          result.storedDocs = items;
        });

        const metaStore = tx.objectStore(STORE_NAMES.META);
        const closedReq = metaStore.get('lastClosedDate');
        closedReq.onsuccess = () => {
          const rec = closedReq.result as LocalDbMetaRecord | undefined;
          if (rec) result.lastClosedDate = (rec.value as string | null) ?? null;
        };

        const targetReq = metaStore.get('dailySalesTarget');
        targetReq.onsuccess = () => {
          const rec = targetReq.result as LocalDbMetaRecord | undefined;
          if (rec) result.dailySalesTarget = (rec.value as DailySalesTargetConfig | null) ?? null;
        };

        const catReq = metaStore.get('productCategories');
        catReq.onsuccess = () => {
          const rec = catReq.result as LocalDbMetaRecord | undefined;
          if (rec && Array.isArray(rec.value)) {
            result.productCategories = rec.value as ProductCategoryConfig[];
          }
        };

        const expCatReq = metaStore.get('expenseCategories');
        expCatReq.onsuccess = () => {
          const rec = expCatReq.result as LocalDbMetaRecord | undefined;
          if (rec && Array.isArray(rec.value)) {
            result.expenseCategories = rec.value as ExpenseCategoryConfig[];
          }
        };

        tx.oncomplete = () => resolve(result);
      });

      const billDocuments = await Promise.all(raw.storedDocs.map(storedRecordToAttachment));
      const docMap = new Map(billDocuments.map((d) => [d.id, d]));

      return {
        profile: raw.profile,
        customers: raw.customers,
        customerTransactions: raw.customerTransactions.map((t) => ({
          ...t,
          attachments: rehydrateAttachmentsOnList(t.attachments, docMap),
        })),
        suppliers: raw.suppliers,
        supplierTransactions: raw.supplierTransactions.map((t) => ({
          ...t,
          attachments: rehydrateAttachmentsOnList(t.attachments, docMap),
        })),
        sales: raw.sales.map((s) => ({
          ...s,
          attachments: rehydrateAttachmentsOnList(s.attachments, docMap),
        })),
        expenses: raw.expenses.map((e) => ({
          ...e,
          attachments: rehydrateAttachmentsOnList(e.attachments, docMap),
        })),
        cashbookEntries: raw.cashbookEntries.map((c) => ({
          ...c,
          attachments: rehydrateAttachmentsOnList(c.attachments, docMap),
        })),
        products: raw.products,
        productCategories: raw.productCategories,
        expenseCategories: raw.expenseCategories,
        stockAdjustments: raw.stockAdjustments,
        auditLogs: raw.auditLogs,
        whatsappBatches: raw.whatsappBatches,
        whatsappAuditLogs: raw.whatsappAuditLogs,
        recurringExpenses: raw.recurringExpenses,
        billDocuments,
        dailySalesTarget: raw.dailySalesTarget,
        lastClosedDate: raw.lastClosedDate,
      };
    },

    async getBillDocuments(): Promise<BillAttachment[]> {
      const rawDocs = await this.getAll<StoredBillDocumentRecord>(STORE_NAMES.BILL_DOCUMENTS);
      const hydrated = await Promise.all(rawDocs.map(storedRecordToAttachment));
      return hydrated.sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
    },

    async saveBillDocumentRecord(doc: BillAttachment): Promise<void> {
      await this.putOne(STORE_NAMES.BILL_DOCUMENTS, attachmentToStoredRecord(doc));
    },

    async deleteBillDocumentRecord(id: string): Promise<void> {
      await this.deleteOne(STORE_NAMES.BILL_DOCUMENTS, id);
    },

    async getMeta<T>(key: string): Promise<T | null> {
      const rec = await this.getByKey<LocalDbMetaRecord>(STORE_NAMES.META, key);
      return rec ? (rec.value as T) : null;
    },

    async setMeta<T>(key: string, value: T): Promise<void> {
      await this.putOne<LocalDbMetaRecord>(STORE_NAMES.META, {
        key,
        value,
        updatedAt: new Date().toISOString(),
      });
    },

    close() {
      if (activeDbAdapterRef === adapter) {
        activeDbAdapterRef = null;
      }
      db.close();
    },
  };

  registerActiveLocalDbAdapter(adapter);
  return adapter;
}

function safeParseJSONArray<T>(raw: string | null, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeParseJSONObject<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export function hasLegacyLocalStorageBusinessData(legacyStorage?: KeyValueStorageLike | null): boolean {
  const storage =
    legacyStorage !== undefined
      ? legacyStorage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;
  if (!storage) return false;
  return LEGACY_BUSINESS_STORAGE_KEYS.some((key) => Boolean(storage.getItem(key)));
}

export function clearLegacyLocalStorageBusinessKeys(legacyStorage?: KeyValueStorageLike | null): void {
  const storage =
    legacyStorage !== undefined
      ? legacyStorage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;
  if (!storage || typeof storage.removeItem !== 'function') return;
  for (const key of LEGACY_BUSINESS_STORAGE_KEYS) {
    storage.removeItem(key);
  }
}

/**
 * Safely migrates legacy localStorage data & legacy SmartKirana_Bills_DB attachments into
 * SmartKirana_Local_DB v2 (non-destructive).
 * - Never deletes or overwrites existing localStorage keys or SmartKirana_Bills_DB.
 * - Creates a PRE_MIGRATION local snapshot before upgrading v1 -> v2 or migrating from localStorage.
 * - Converts any legacy plaintext `profile.pinCode` into a salted PBKDF2-SHA256 `meta.pinSecurity` record.
 */
export async function migrateLegacyLocalStorageToLocalDb(
  db: LocalDbAdapter,
  _legacySeedDataset?: StoreBusinessDataset,
  legacyStorage?: KeyValueStorageLike | null,
  legacyBillDocsLoader?: () => Promise<BillAttachment[]>
): Promise<{ dataset: StoreBusinessDataset; report: MigrationReport }> {
  const existingInstallInitialized = await db.getMeta<boolean>('installInitialized');
  const existingStatus = await db.getMeta<MigrationReport>('migrationStatus');
  const existingSchemaVersion = await db.getMeta<string>('schemaVersion');
  const existingPinSecurity = await db.getMeta<PinSecurityRecord>('pinSecurity');
  const existingData = await db.loadBusinessDataset();

  const hasExistingIdbData =
    existingInstallInitialized === true ||
    Boolean(existingStatus?.migrated) ||
    hasAnyPersistedBusinessData(existingData);

  // If DB already has initialized/existing v1/v2 state, NEVER overwrite or mix demo records into empty collections
  if (hasExistingIdbData) {
    const rawProfile = existingData.profile || createEmptyStoreProfile();
    const rawPin = rawProfile.pinCode;

    let hydrated: StoreBusinessDataset = {
      profile: sanitizeProfileForStorage(rawProfile),
      customers: existingData.customers || [],
      customerTransactions: existingData.customerTransactions || [],
      suppliers: existingData.suppliers || [],
      supplierTransactions: existingData.supplierTransactions || [],
      sales: existingData.sales || [],
      expenses: existingData.expenses || [],
      cashbookEntries: existingData.cashbookEntries || [],
      products: existingData.products || [],
      productCategories: existingData.productCategories ?? [],
      expenseCategories: existingData.expenseCategories ?? [],
      stockAdjustments: existingData.stockAdjustments || [],
      auditLogs: existingData.auditLogs || [],
      whatsappBatches: existingData.whatsappBatches || [],
      whatsappAuditLogs: existingData.whatsappAuditLogs || [],
      billDocuments: existingData.billDocuments || [],
      recurringExpenses: existingData.recurringExpenses || [],
      dailySalesTarget: existingData.dailySalesTarget ?? null,
      lastClosedDate: existingData.lastClosedDate ?? null,
    };

    const needsV2Upgrade =
      existingSchemaVersion !== '4.0.0-local-v2' || Boolean(rawPin && rawPin.trim().length > 0);

    if (needsV2Upgrade) {
      const nowIso = new Date().toISOString();
      let consolidatedCount = 0;
      if (legacyBillDocsLoader) {
        try {
          const legacyDocs = await legacyBillDocsLoader();
          if (legacyDocs.length > 0) {
            const existingMap = new Map((hydrated.billDocuments || []).map((d) => [d.id, d]));
            for (const doc of legacyDocs) {
              if (doc && doc.id && doc.dataUrl && !existingMap.has(doc.id)) {
                existingMap.set(doc.id, doc);
                consolidatedCount++;
              }
            }
            hydrated.billDocuments = Array.from(existingMap.values());
          }
        } catch {
          // Non-fatal: continue upgrade with inline attachments
        }
      }

      // Create PRE_MIGRATION checkpoint before modifying DB
      const hydratedJson = JSON.stringify(hydrated);
      const preMigrationSnap: LocalBackupSnapshot = {
        id: `bak-premigration-${Date.now()}`,
        createdAt: nowIso,
        dateKey: nowIso.slice(0, 10),
        weekKey: nowIso.slice(0, 10),
        trigger: 'PRE_MIGRATION',
        bucket: 'RECOVERY',
        reason: 'Safety snapshot prior to v2 local-only IndexedDB upgrade',
        schemaVersion: existingSchemaVersion || '3.0.0-local-first',
        checksum: computeDeterministicHash(hydratedJson),
        sizeBytes: hydratedJson.length,
        status: 'SUCCESS',
        summary: {
          totalTransactions:
            hydrated.sales.length +
            hydrated.customerTransactions.length +
            hydrated.supplierTransactions.length +
            hydrated.expenses.length +
            hydrated.cashbookEntries.length,
          salesCount: hydrated.sales.length,
          salesTotalVolume: 0,
          customerTransactionsCount: hydrated.customerTransactions.length,
          supplierTransactionsCount: hydrated.supplierTransactions.length,
          expenseCount: hydrated.expenses.length,
          expenseTotalVolume: 0,
          cashbookCount: hydrated.cashbookEntries.length,
          customersCount: hydrated.customers.length,
          suppliersCount: hydrated.suppliers.length,
          productsCount: hydrated.products.length,
          billDocumentsCount: hydrated.billDocuments?.length || 0,
        },
        payloadJson: hydratedJson,
      };
      await db.putOne(STORE_NAMES.LOCAL_BACKUPS, preMigrationSnap);

      const extraMeta: LocalDbMetaRecord[] = [
        { key: 'schemaVersion', value: '4.0.0-local-v2', updatedAt: nowIso },
        { key: 'storageMode', value: 'LOCAL_ONLY' satisfies StorageMode, updatedAt: nowIso },
        { key: 'installInitialized', value: true, updatedAt: nowIso },
      ];

      if (!existingPinSecurity && rawPin && rawPin.trim().length >= 4) {
        const pinRecord = await hashPinWithSalt(rawPin.trim());
        extraMeta.push({ key: 'pinSecurity', value: pinRecord, updatedAt: nowIso });
      }

      hydrated = recalculateLedgerBalancesFromHistory(hydrated);
      const upgradeReport: MigrationReport = {
        migrated: true,
        alreadyMigrated: true,
        source: 'v1_upgrade',
        migratedAt: existingStatus?.migratedAt || nowIso,
        schemaVersion: '4.0.0-local-v2',
        preMigrationBackupId: preMigrationSnap.id,
        consolidatedBillDocuments: consolidatedCount,
        recordCounts: {
          customers: hydrated.customers.length,
          customerTransactions: hydrated.customerTransactions.length,
          suppliers: hydrated.suppliers.length,
          supplierTransactions: hydrated.supplierTransactions.length,
          sales: hydrated.sales.length,
          expenses: hydrated.expenses.length,
          cashbookEntries: hydrated.cashbookEntries.length,
          products: hydrated.products.length,
          stockAdjustments: hydrated.stockAdjustments.length,
          auditLogs: hydrated.auditLogs.length,
          billDocuments: hydrated.billDocuments?.length || 0,
          recurringExpenses: hydrated.recurringExpenses?.length || 0,
        },
      };
      extraMeta.push({ key: 'migrationStatus', value: upgradeReport, updatedAt: nowIso });

      await db.commitBusinessDatasetAtomic(hydrated, extraMeta);
      const verified = await db.loadBusinessDataset();
      if (
        (verified.customers?.length || 0) < hydrated.customers.length ||
        (verified.suppliers?.length || 0) < hydrated.suppliers.length ||
        (verified.products?.length || 0) < hydrated.products.length ||
        (verified.sales?.length || 0) < hydrated.sales.length
      ) {
        throw new Error('Verification after v2 IndexedDB upgrade detected record count mismatch.');
      }
      return { dataset: hydrated, report: upgradeReport };
    }

    if (existingInstallInitialized !== true) {
      await db.setMeta('installInitialized', true);
    }

    // Non-destructively consolidate any remaining legacy SmartKirana_Bills_DB records
    // even on already-migrated v2 databases
    if (legacyBillDocsLoader) {
      try {
        const legacyDocs = await legacyBillDocsLoader();
        if (legacyDocs.length > 0) {
          const existingMap = new Map((hydrated.billDocuments || []).map((d) => [d.id, d]));
          let addedCount = 0;
          for (const doc of legacyDocs) {
            if (doc && doc.id && doc.dataUrl && !existingMap.has(doc.id)) {
              existingMap.set(doc.id, doc);
              await db.saveBillDocumentRecord(doc);
              addedCount++;
            }
          }
          if (addedCount > 0) {
            hydrated.billDocuments = Array.from(existingMap.values());
            const rehydratedAgain = await db.loadBusinessDataset();
            if (rehydratedAgain.sales) hydrated.sales = rehydratedAgain.sales;
            if (rehydratedAgain.expenses) hydrated.expenses = rehydratedAgain.expenses;
            if (rehydratedAgain.customerTransactions) {
              hydrated.customerTransactions = rehydratedAgain.customerTransactions;
            }
            if (rehydratedAgain.supplierTransactions) {
              hydrated.supplierTransactions = rehydratedAgain.supplierTransactions;
            }
            if (rehydratedAgain.cashbookEntries) {
              hydrated.cashbookEntries = rehydratedAgain.cashbookEntries;
            }
          }
        }
      } catch {
        // Non-fatal: continue with already-consolidated billDocuments
      }
    }

    const report: MigrationReport = {
      migrated: true,
      alreadyMigrated: true,
      source: 'existing_idb',
      migratedAt: existingStatus?.migratedAt || new Date().toISOString(),
      schemaVersion: '4.0.0-local-v2',
      consolidatedBillDocuments: existingStatus?.consolidatedBillDocuments,
      recordCounts: {
        customers: hydrated.customers.length,
        customerTransactions: hydrated.customerTransactions.length,
        suppliers: hydrated.suppliers.length,
        supplierTransactions: hydrated.supplierTransactions.length,
        sales: hydrated.sales.length,
        expenses: hydrated.expenses.length,
        cashbookEntries: hydrated.cashbookEntries.length,
        products: hydrated.products.length,
        stockAdjustments: hydrated.stockAdjustments.length,
        auditLogs: hydrated.auditLogs.length,
        billDocuments: hydrated.billDocuments?.length || 0,
        recurringExpenses: hydrated.recurringExpenses?.length || 0,
      },
    };
    return { dataset: hydrated, report };
  }

  // Inspect legacy localStorage keys (read-only: never delete, never mix demo records)
  const storage =
    legacyStorage !== undefined
      ? legacyStorage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  const foundLegacyData = hasLegacyLocalStorageBusinessData(storage);

  let legacyDocs: BillAttachment[] = [];
  if (legacyBillDocsLoader) {
    try {
      legacyDocs = await legacyBillDocsLoader();
    } catch {
      legacyDocs = [];
    }
  }

  const emptyBaseline = createEmptyBusinessDataset();
  const rawProfile = foundLegacyData
    ? safeParseJSONObject<StoreProfile>(
        storage?.getItem(LEGACY_STORAGE_KEYS.PROFILE) || null,
        createEmptyStoreProfile()
      )
    : emptyBaseline.profile;
  const legacyPlainPin = rawProfile.pinCode;

  let targetDataset: StoreBusinessDataset = foundLegacyData
    ? {
        profile: sanitizeProfileForStorage(rawProfile),
        customers: safeParseJSONArray<Customer>(
          storage?.getItem(LEGACY_STORAGE_KEYS.CUSTOMERS) || null,
          []
        ),
        customerTransactions: safeParseJSONArray<CustomerTransaction>(
          storage?.getItem(LEGACY_STORAGE_KEYS.CUST_TX) || null,
          []
        ),
        suppliers: safeParseJSONArray<Supplier>(
          storage?.getItem(LEGACY_STORAGE_KEYS.SUPPLIERS) || null,
          []
        ),
        supplierTransactions: safeParseJSONArray<SupplierTransaction>(
          storage?.getItem(LEGACY_STORAGE_KEYS.SUPP_TX) || null,
          []
        ),
        sales: safeParseJSONArray<SaleRecord>(
          storage?.getItem(LEGACY_STORAGE_KEYS.SALES) || null,
          []
        ),
        expenses: safeParseJSONArray<ExpenseRecord>(
          storage?.getItem(LEGACY_STORAGE_KEYS.EXPENSES) || null,
          []
        ),
        cashbookEntries: safeParseJSONArray<CashbookEntry>(
          storage?.getItem(LEGACY_STORAGE_KEYS.CASHBOOK) || null,
          []
        ),
        products: safeParseJSONArray<Product>(
          storage?.getItem(LEGACY_STORAGE_KEYS.PRODUCTS) || null,
          []
        ),
        stockAdjustments: safeParseJSONArray<StockAdjustmentRecord>(
          storage?.getItem(LEGACY_STORAGE_KEYS.STOCK_ADJUSTMENTS) || null,
          []
        ),
        auditLogs: safeParseJSONArray<AuditLog>(
          storage?.getItem(LEGACY_STORAGE_KEYS.AUDIT) || null,
          []
        ),
        whatsappBatches: safeParseJSONArray<WhatsAppReminderBatch>(
          storage?.getItem(LEGACY_STORAGE_KEYS.WHATSAPP_BATCHES) || null,
          []
        ),
        whatsappAuditLogs: safeParseJSONArray<WhatsAppAuditLog>(
          storage?.getItem(LEGACY_STORAGE_KEYS.WHATSAPP_LOGS) || null,
          []
        ),
        billDocuments: legacyDocs,
        productCategories: [],
        expenseCategories: [],
        recurringExpenses: [],
        dailySalesTarget: null,
        lastClosedDate: storage?.getItem(LEGACY_STORAGE_KEYS.LAST_CLOSED_DAY) || null,
      }
    : {
        ...emptyBaseline,
        billDocuments: legacyDocs,
      };

  targetDataset = recalculateLedgerBalancesFromHistory(targetDataset);

  const nowIso = new Date().toISOString();
  const pinSecurity =
    legacyPlainPin && legacyPlainPin.trim().length >= 4
      ? await hashPinWithSalt(legacyPlainPin.trim())
      : null;

  const migrationReport: MigrationReport = {
    migrated: true,
    alreadyMigrated: false,
    source: foundLegacyData ? 'localStorage' : 'fresh_install',
    migratedAt: nowIso,
    schemaVersion: '4.0.0-local-v2',
    consolidatedBillDocuments: legacyDocs.length,
    recordCounts: {
      customers: targetDataset.customers.length,
      customerTransactions: targetDataset.customerTransactions.length,
      suppliers: targetDataset.suppliers.length,
      supplierTransactions: targetDataset.supplierTransactions.length,
      sales: targetDataset.sales.length,
      expenses: targetDataset.expenses.length,
      cashbookEntries: targetDataset.cashbookEntries.length,
      products: targetDataset.products.length,
      stockAdjustments: targetDataset.stockAdjustments.length,
      auditLogs: targetDataset.auditLogs.length,
      billDocuments: targetDataset.billDocuments?.length || 0,
      recurringExpenses: targetDataset.recurringExpenses?.length || 0,
    },
  };

  const initMeta: LocalDbMetaRecord[] = [
    { key: 'migrationStatus', value: migrationReport, updatedAt: nowIso },
    { key: 'schemaVersion', value: '4.0.0-local-v2', updatedAt: nowIso },
    { key: 'storageMode', value: 'LOCAL_ONLY' satisfies StorageMode, updatedAt: nowIso },
    { key: 'installInitialized', value: true, updatedAt: nowIso },
    {
      key: 'firstTimeSetupCompleted',
      value: foundLegacyData || hasAnyPersistedBusinessData(targetDataset),
      updatedAt: nowIso,
    },
  ];
  if (pinSecurity) {
    initMeta.push({ key: 'pinSecurity', value: pinSecurity, updatedAt: nowIso });
  }

  await db.commitBusinessDatasetAtomic(targetDataset, initMeta);

  // Verify initialization committed atomically before returning
  const verifiedInit = await db.getMeta<boolean>('installInitialized');
  const verifiedStatus = await db.getMeta<MigrationReport>('migrationStatus');
  if (verifiedInit !== true || !verifiedStatus) {
    throw new Error('Local database initialization verification failed.');
  }

  return { dataset: targetDataset, report: migrationReport };
}

/**
 * Sync Queue & Conflict Persistence Helpers (retained for test compatibility; never writes to cloud in local-only mode)
 */
export async function enqueueSyncMutation(
  db: LocalDbAdapter,
  params: {
    entityType: SyncQueueItem['entityType'];
    entityId: string;
    operation?: 'UPSERT' | 'DELETE';
    payloadSnapshot: unknown;
  }
): Promise<SyncQueueItem> {
  const nowIso = new Date().toISOString();
  const payloadHash = computeDeterministicHash(JSON.stringify(params.payloadSnapshot));
  const idempotencyKey = `${params.entityType}:${params.entityId}:${payloadHash}`;

  const existingQueue = await db.getAll<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE);
  const existingPending = existingQueue.find(
    (q) => q.idempotencyKey === idempotencyKey && (q.status === 'PENDING' || q.status === 'SYNCED')
  );
  if (existingPending) {
    return existingPending;
  }

  const item: SyncQueueItem = {
    id: `sync-${params.entityType.toLowerCase()}-${params.entityId}-${Date.now()}`,
    idempotencyKey,
    entityType: params.entityType,
    entityId: params.entityId,
    operation: params.operation || 'UPSERT',
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 5,
    localUpdatedAt: nowIso,
    createdAt: nowIso,
    payloadHash,
  };

  await db.putOne(STORE_NAMES.SYNC_QUEUE, item);
  return item;
}

export async function listSyncQueueItems(db: LocalDbAdapter): Promise<SyncQueueItem[]> {
  const all = await db.getAll<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE);
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function listSyncConflicts(db: LocalDbAdapter): Promise<SyncConflictRecord[]> {
  const all = await db.getAll<SyncConflictRecord>(STORE_NAMES.SYNC_CONFLICTS);
  return all.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
}

export async function listLocalBackups(db: LocalDbAdapter): Promise<LocalBackupSnapshot[]> {
  const all = await db.getAll<LocalBackupSnapshot>(STORE_NAMES.LOCAL_BACKUPS);
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Requests browser persistent storage & returns quota estimates safely.
 */
export async function requestAndCheckStorageQuota(): Promise<{
  isPersisted: boolean;
  usageBytes: number;
  quotaBytes: number;
  usagePct: number;
  quotaWarning: boolean;
}> {
  let isPersisted = false;
  let usageBytes = 0;
  let quotaBytes = 0;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        isPersisted = await navigator.storage.persisted();
      }
      if (!isPersisted && typeof navigator.storage.persist === 'function') {
        isPersisted = await navigator.storage.persist();
      }
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        usageBytes = Number(est.usage) || 0;
        quotaBytes = Number(est.quota) || 0;
      }
    } catch {
      // Ignore browser permission restrictions in embedded iframes
    }
  }

  const usagePct = quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 1000) / 10) : 0;
  const quotaWarning = quotaBytes > 0 && usagePct >= 80;

  return { isPersisted, usageBytes, quotaBytes, usagePct, quotaWarning };
}
