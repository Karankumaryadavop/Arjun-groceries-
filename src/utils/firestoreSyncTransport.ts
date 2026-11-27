/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, FirestoreErrorInfo, handleFirestoreError, OperationType } from '../firebase';
import {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  FirestoreSyncedCounts,
  PaymentMethod,
  Product,
  SaleRecord,
  StoreBusinessDataset,
  StoreProfile,
  Supplier,
  SupplierTransaction,
} from '../types';
import {
  buildCashbookCloudPayload,
  buildCustomerCloudPayload,
  buildCustomerTxCloudPayload,
  buildExpenseCloudPayload,
  buildProductCloudPayload,
  buildSaleCloudPayload,
  buildStoreWorkspacePayload,
  buildSupplierCloudPayload,
  buildSupplierTxCloudPayload,
} from './firestorePayload';

export type FirestoreCollectionKey =
  | 'stores'
  | 'customers'
  | 'customerTransactions'
  | 'suppliers'
  | 'supplierTransactions'
  | 'sales'
  | 'expenses'
  | 'cashbookEntries'
  | 'products';

/**
 * Exact mutable field allowlists synchronized verbatim with `firestore.rules`
 * (`incoming().diff(existing()).affectedKeys().hasOnly([...])`).
 */
export const FIRESTORE_ALLOWED_UPDATE_KEYS: Record<FirestoreCollectionKey, readonly string[]> = {
  stores: [
    'storeName',
    'ownerName',
    'phone',
    'address',
    'upiId',
    'gstin',
    'lastClosedDate',
    'whatsappTemplateConfig',
    'localUpdatedAt',
  ],
  customers: [
    'name',
    'phone',
    'address',
    'openingBalance',
    'currentBalance',
    'totalCreditGiven',
    'totalPaymentReceived',
    'whatsappConsent',
    'localUpdatedAt',
  ],
  customerTransactions: ['description', 'paymentMethod', 'invoiceNo', 'status', 'localUpdatedAt'],
  suppliers: [
    'name',
    'phone',
    'category',
    'address',
    'openingBalance',
    'currentBalance',
    'totalPurchases',
    'totalPaid',
    'localUpdatedAt',
  ],
  supplierTransactions: [
    'paymentStatus',
    'paymentMethod',
    'description',
    'invoiceNo',
    'status',
    'localUpdatedAt',
  ],
  sales: ['notes', 'paymentMethod', 'customerId', 'customerName', 'localUpdatedAt'],
  expenses: [
    'title',
    'category',
    'amount',
    'isPersonalWithdrawal',
    'paymentMethod',
    'date',
    'notes',
    'localUpdatedAt',
  ],
  cashbookEntries: ['description', 'category', 'amount', 'localUpdatedAt'],
  products: [
    'name',
    'category',
    'unit',
    'costPrice',
    'sellingPrice',
    'mrp',
    'stockQty',
    'minStockAlert',
    'preferredSupplierId',
    'preferredSupplierName',
    'isArchived',
    'localUpdatedAt',
  ],
};

/**
 * Pure helper: extracts only the fields allowed on `update` by `firestore.rules`.
 * Guarantees immutable fields (`id`, `ownerId`, `createdAt`) are never overwritten.
 */
export function buildFirestoreUpdatePatch(
  collectionKey: FirestoreCollectionKey,
  fullPayload: Record<string, unknown>
): Record<string, unknown> {
  const allowed = FIRESTORE_ALLOWED_UPDATE_KEYS[collectionKey];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in fullPayload && fullPayload[key] !== undefined) {
      patch[key] = fullPayload[key];
    }
  }
  return patch;
}

/**
 * Pure helper: terminal transaction statuses locked by `isNotCancelled(existing())` in `firestore.rules`.
 */
export function isTerminalTransactionStatus(status: unknown): boolean {
  return status === 'CANCELLED' || status === 'REVERSED';
}

/**
 * Pure helper: extracts structured FirestoreErrorInfo if thrown by `handleFirestoreError`.
 */
export function parseFirestoreErrorInfo(error: unknown): {
  message: string;
  permissionDenied: boolean;
  info?: FirestoreErrorInfo;
} {
  const raw = error instanceof Error ? error.message : String(error || 'Firestore operation failed.');
  try {
    const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === 'string' && typeof parsed.operationType === 'string') {
      const permissionDenied =
        /permission[-_ ]denied|missing or insufficient permissions/i.test(parsed.error);
      return {
        message: permissionDenied
          ? 'Firestore denied access (Missing or insufficient permissions). Please publish firestore.rules in Firebase Console and verify your email.'
          : parsed.error,
        permissionDenied,
        info: parsed as FirestoreErrorInfo,
      };
    }
  } catch {
    // Plain error message
  }
  const permissionDenied = /permission[-_ ]denied|missing or insufficient permissions/i.test(raw);
  return {
    message: permissionDenied
      ? 'Firestore denied access (Missing or insufficient permissions). Please publish firestore.rules in Firebase Console and verify your email.'
      : raw,
    permissionDenied,
  };
}

function finiteNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function strVal(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

export interface FirestorePulledDataset {
  profilePatch: Partial<StoreProfile>;
  lastClosedDate?: string | null;
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  cashbookEntries: CashbookEntry[];
  products: Product[];
}

/**
 * Pure mapper: converts raw Firestore documents back into typed Arjun Groceries records.
 */
export function mapFirestoreDocsToDatasetPatch(raw: {
  workspace: Record<string, unknown> | null;
  customers: Record<string, unknown>[];
  customerTransactions: Record<string, unknown>[];
  suppliers: Record<string, unknown>[];
  supplierTransactions: Record<string, unknown>[];
  sales: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  cashbookEntries: Record<string, unknown>[];
  products: Record<string, unknown>[];
}): FirestorePulledDataset {
  const ws = raw.workspace || {};
  const profilePatch: Partial<StoreProfile> = {};
  if (typeof ws.storeName === 'string' && ws.storeName.trim()) profilePatch.storeName = ws.storeName;
  if (typeof ws.ownerName === 'string' && ws.ownerName.trim()) profilePatch.ownerName = ws.ownerName;
  if (typeof ws.phone === 'string') profilePatch.phone = ws.phone;
  if (typeof ws.address === 'string') profilePatch.address = ws.address;
  if (typeof ws.upiId === 'string') profilePatch.upiId = ws.upiId;
  if (typeof ws.gstin === 'string') profilePatch.gstin = ws.gstin;
  if (ws.whatsappTemplateConfig && typeof ws.whatsappTemplateConfig === 'object') {
    const cfg = ws.whatsappTemplateConfig as Record<string, unknown>;
    if (typeof cfg.templateName === 'string' && typeof cfg.bodyTemplate === 'string') {
      profilePatch.whatsappTemplateConfig = {
        templateName: cfg.templateName,
        bodyTemplate: cfg.bodyTemplate,
        footerText: strVal(cfg.footerText),
        includeInvoiceList: Boolean(cfg.includeInvoiceList),
        includeUpiId: Boolean(cfg.includeUpiId),
        updatedAt: strVal(cfg.updatedAt) || new Date().toISOString(),
      };
    }
  }

  const customers: Customer[] = raw.customers
    .filter((d) => typeof d.id === 'string' && typeof d.name === 'string')
    .map((d) => {
      const currentBalance = finiteNum(d.currentBalance);
      const rawCategory = strVal(d.category);
      const category: Customer['category'] =
        rawCategory === 'REGULAR' ||
        rawCategory === 'HIGH_CREDIT' ||
        rawCategory === 'OVERDUE' ||
        rawCategory === 'CLEARED'
          ? rawCategory
          : currentBalance <= 0
            ? 'CLEARED'
            : 'REGULAR';
      return {
        id: strVal(d.id),
        name: strVal(d.name),
        phone: strVal(d.phone),
        address: strVal(d.address),
        openingBalance: finiteNum(d.openingBalance),
        currentBalance,
        totalCreditGiven: finiteNum(d.totalCreditGiven),
        totalPaymentReceived: finiteNum(d.totalPaymentReceived),
        overdueDays: finiteNum(d.overdueDays),
        category,
        whatsappConsent: d.whatsappConsent !== false,
        createdAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
      };
    });

  const customerTransactions: CustomerTransaction[] = raw.customerTransactions
    .filter((d) => typeof d.id === 'string' && typeof d.customerId === 'string')
    .map((d) => ({
      id: strVal(d.id),
      customerId: strVal(d.customerId),
      type: (strVal(d.type, 'CREDIT') as CustomerTransaction['type']),
      amount: finiteNum(d.amount),
      date: strVal(d.date) || new Date().toISOString().slice(0, 10),
      description: strVal(d.description),
      paymentMethod: (strVal(d.paymentMethod) as CustomerTransaction['paymentMethod']) || undefined,
      invoiceNo: strVal(d.invoiceNo) || undefined,
      status: (strVal(d.status, 'COMPLETED') as CustomerTransaction['status']),
      createdAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
    }));

  const suppliers: Supplier[] = raw.suppliers
    .filter((d) => typeof d.id === 'string' && typeof d.name === 'string')
    .map((d) => ({
      id: strVal(d.id),
      name: strVal(d.name),
      phone: strVal(d.phone),
      address: strVal(d.address),
      notes: strVal(d.category) || undefined,
      openingBalance: finiteNum(d.openingBalance),
      currentBalance: finiteNum(d.currentBalance),
      totalPurchases: finiteNum(d.totalPurchases),
      totalPaid: finiteNum(d.totalPaid),
      lastTransactionDate: strVal(d.localUpdatedAt) || undefined,
      createdAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
    }));

  const supplierTransactions: SupplierTransaction[] = raw.supplierTransactions
    .filter((d) => typeof d.id === 'string' && typeof d.supplierId === 'string')
    .map((d) => ({
      id: strVal(d.id),
      supplierId: strVal(d.supplierId),
      type: (strVal(d.type, 'PURCHASE') as SupplierTransaction['type']),
      amount: finiteNum(d.amount),
      date: strVal(d.date) || new Date().toISOString().slice(0, 10),
      paymentStatus: (strVal(d.paymentStatus, 'PAID') as SupplierTransaction['paymentStatus']),
      paymentMethod: (strVal(d.paymentMethod) as SupplierTransaction['paymentMethod']) || undefined,
      description: strVal(d.description),
      invoiceNo: strVal(d.invoiceNo) || undefined,
      status: (strVal(d.status, 'COMPLETED') as SupplierTransaction['status']),
      createdAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
    }));

  const sales: SaleRecord[] = raw.sales
    .filter((d) => typeof d.id === 'string' && typeof d.invoiceNo === 'string')
    .map((d) => {
      const itemsRaw = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
      return {
        id: strVal(d.id),
        invoiceNo: strVal(d.invoiceNo),
        date: strVal(d.date) || new Date().toISOString().slice(0, 10),
        customerId: strVal(d.customerId) || undefined,
        customerName: strVal(d.customerName) || undefined,
        amount: finiteNum(d.amount),
        paymentMethod: (strVal(d.paymentMethod, 'CASH') as PaymentMethod),
        isCredit: Boolean(d.isCredit),
        items: itemsRaw.map((it) => ({
          productId: strVal(it.productId),
          productName: strVal(it.productName),
          quantity: finiteNum(it.quantity),
          unit: strVal(it.unit, 'pcs'),
          rate: finiteNum(it.rate),
          total: finiteNum(it.total),
        })),
        notes: strVal(d.notes) || undefined,
        createdAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
      };
    });

  const expenses: ExpenseRecord[] = raw.expenses
    .filter((d) => typeof d.id === 'string' && typeof d.title === 'string')
    .map((d) => ({
      id: strVal(d.id),
      title: strVal(d.title),
      category: (strVal(d.category, 'misc') as ExpenseRecord['category']),
      amount: finiteNum(d.amount),
      isPersonalWithdrawal: Boolean(d.isPersonalWithdrawal),
      paymentMethod: (strVal(d.paymentMethod, 'CASH') as ExpenseRecord['paymentMethod']),
      date: strVal(d.date) || new Date().toISOString().slice(0, 10),
      notes: strVal(d.notes) || undefined,
      createdAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
    }));

  const cashbookEntries: CashbookEntry[] = raw.cashbookEntries
    .filter((d) => typeof d.id === 'string')
    .map((d) => ({
      id: strVal(d.id),
      date: strVal(d.date) || new Date().toISOString().slice(0, 10),
      type: d.type === 'OUT' ? 'OUT' : 'IN',
      category: strVal(d.category, 'GENERAL'),
      description: strVal(d.description),
      amount: finiteNum(d.amount),
      paymentMode: (strVal(d.paymentMode, 'CASH') as CashbookEntry['paymentMode']),
      refType: (strVal(d.refType, 'MANUAL') as CashbookEntry['refType']),
      refId: strVal(d.refId) || undefined,
      createdAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
    }));

  const products: Product[] = raw.products
    .filter((d) => typeof d.id === 'string' && typeof d.name === 'string')
    .map((d) => ({
      id: strVal(d.id),
      name: strVal(d.name),
      category: strVal(d.category, 'Grocery'),
      unit: strVal(d.unit, 'pcs'),
      purchasePrice: finiteNum(d.costPrice),
      sellingPrice: finiteNum(d.sellingPrice),
      mrp: finiteNum(d.mrp) || undefined,
      stockQty: finiteNum(d.stockQty),
      minStockAlert: finiteNum(d.minStockAlert, 5),
      preferredSupplierId: strVal(d.preferredSupplierId) || undefined,
      preferredSupplierName: strVal(d.preferredSupplierName) || undefined,
      isArchived: Boolean(d.isArchived),
      updatedAt: strVal(d.localUpdatedAt) || new Date().toISOString(),
    }));

  return {
    profilePatch,
    lastClosedDate: typeof ws.lastClosedDate === 'string' && ws.lastClosedDate ? ws.lastClosedDate : null,
    customers,
    customerTransactions,
    suppliers,
    supplierTransactions,
    sales,
    expenses,
    cashbookEntries,
    products,
  };
}

/**
 * Ensures the root `/stores/{uid}` workspace document exists and is up to date.
 * Satisfies the Master Gate parent invariant required before any subcollection write.
 */
export async function ensureStoreWorkspaceDoc(
  uid: string,
  profile: StoreProfile,
  lastClosedDate: string | null = null
): Promise<void> {
  const path = `stores/${uid}`;
  const ref = doc(db, 'stores', uid);
  const fullPayload = buildStoreWorkspacePayload(uid, profile, lastClosedDate);

  let exists = false;
  try {
    const snap = await getDoc(ref);
    exists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!exists) {
    try {
      await setDoc(ref, {
        ...fullPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    const patch = buildFirestoreUpdatePatch('stores', fullPayload);
    try {
      await updateDoc(ref, {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

interface PendingBatchOp {
  type: 'create' | 'update';
  path: string;
  collectionKey: Exclude<FirestoreCollectionKey, 'stores'>;
  docId: string;
  data: Record<string, unknown>;
}

const MAX_BATCH_OPS = 380;

async function commitBatchedOps(uid: string, ops: PendingBatchOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
    const chunk = ops.slice(i, i + MAX_BATCH_OPS);
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, 'stores', uid, op.collectionKey, op.docId);
      if (op.type === 'create') {
        batch.set(ref, {
          ...op.data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(ref, {
          ...op.data,
          updatedAt: serverTimestamp(),
        });
      }
    }
    const firstPath = chunk[0]?.path || `stores/${uid}`;
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, firstPath);
    }
  }
}

async function listExistingDocMeta(
  uid: string,
  subcollection: Exclude<FirestoreCollectionKey, 'stores'>
): Promise<Map<string, Record<string, unknown>>> {
  const path = `stores/${uid}/${subcollection}`;
  try {
    const q = query(collection(db, 'stores', uid, subcollection), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    const result = new Map<string, Record<string, unknown>>();
    snap.forEach((docSnap) => {
      result.set(docSnap.id, docSnap.data() as Record<string, unknown>);
    });
    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Syncs the full local Arjun Groceries business dataset to Cloud Firestore under `/stores/{uid}/...`.
 * Strictly obeys `firestore.rules` (Master Gate, strict keys, `affectedKeys().hasOnly(...)`,
 * terminal transaction immutability, and server timestamps). Never modifies local IndexedDB.
 */
export async function syncDatasetToFirestore(
  uid: string,
  dataset: StoreBusinessDataset
): Promise<{ syncedCounts: FirestoreSyncedCounts; syncedAt: string }> {
  // 1. Ensure parent `/stores/{uid}` exists first (Master Gate)
  await ensureStoreWorkspaceDoc(uid, dataset.profile, dataset.lastClosedDate ?? null);

  // 2. Inspect existing remote doc IDs so we use `create` for new docs and allowlisted `update` for existing docs
  const [
    existingCustomers,
    existingCustomerTx,
    existingSuppliers,
    existingSupplierTx,
    existingSales,
    existingExpenses,
    existingCashbook,
    existingProducts,
  ] = await Promise.all([
    listExistingDocMeta(uid, 'customers'),
    listExistingDocMeta(uid, 'customerTransactions'),
    listExistingDocMeta(uid, 'suppliers'),
    listExistingDocMeta(uid, 'supplierTransactions'),
    listExistingDocMeta(uid, 'sales'),
    listExistingDocMeta(uid, 'expenses'),
    listExistingDocMeta(uid, 'cashbookEntries'),
    listExistingDocMeta(uid, 'products'),
  ]);

  const ops: PendingBatchOp[] = [];
  const nowIso = new Date().toISOString();

  const enqueueCollection = (
    sub: Exclude<FirestoreCollectionKey, 'stores'>,
    payloads: Record<string, unknown>[],
    existingMap: Map<string, Record<string, unknown>>,
    respectTerminalStatus = false
  ) => {
    for (const fullPayload of payloads) {
      const docId = String(fullPayload.id || '');
      if (!docId) continue;
      const remoteDoc = existingMap.get(docId);
      if (!remoteDoc) {
        ops.push({
          type: 'create',
          path: `stores/${uid}/${sub}/${docId}`,
          collectionKey: sub,
          docId,
          data: fullPayload,
        });
      } else {
        if (respectTerminalStatus && isTerminalTransactionStatus(remoteDoc.status)) {
          continue;
        }
        ops.push({
          type: 'update',
          path: `stores/${uid}/${sub}/${docId}`,
          collectionKey: sub,
          docId,
          data: buildFirestoreUpdatePatch(sub, fullPayload),
        });
      }
    }
  };

  enqueueCollection(
    'customers',
    dataset.customers.map((c) => buildCustomerCloudPayload(uid, c, nowIso)),
    existingCustomers
  );
  enqueueCollection(
    'customerTransactions',
    dataset.customerTransactions.map((tx) => buildCustomerTxCloudPayload(uid, tx, nowIso)),
    existingCustomerTx,
    true
  );
  enqueueCollection(
    'suppliers',
    dataset.suppliers.map((s) => buildSupplierCloudPayload(uid, s, nowIso)),
    existingSuppliers
  );
  enqueueCollection(
    'supplierTransactions',
    dataset.supplierTransactions.map((tx) => buildSupplierTxCloudPayload(uid, tx, nowIso)),
    existingSupplierTx,
    true
  );
  enqueueCollection(
    'sales',
    dataset.sales.map((s) => buildSaleCloudPayload(uid, s, nowIso)),
    existingSales
  );
  enqueueCollection(
    'expenses',
    dataset.expenses.map((e) => buildExpenseCloudPayload(uid, e, nowIso)),
    existingExpenses
  );
  enqueueCollection(
    'cashbookEntries',
    dataset.cashbookEntries.map((c) => buildCashbookCloudPayload(uid, c, nowIso)),
    existingCashbook
  );
  enqueueCollection(
    'products',
    dataset.products.map((p) => buildProductCloudPayload(uid, p, nowIso)),
    existingProducts
  );

  if (ops.length > 0) {
    await commitBatchedOps(uid, ops);
  }

  return {
    syncedCounts: {
      customers: dataset.customers.length,
      customerTransactions: dataset.customerTransactions.length,
      suppliers: dataset.suppliers.length,
      supplierTransactions: dataset.supplierTransactions.length,
      sales: dataset.sales.length,
      expenses: dataset.expenses.length,
      cashbookEntries: dataset.cashbookEntries.length,
      products: dataset.products.length,
    },
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Fetches the store workspace and all synced subcollections from Cloud Firestore for `uid`.
 * Uses `where('ownerId', '==', uid)` on every list query to satisfy `firestore.rules`.
 */
export async function fetchDatasetFromFirestore(uid: string): Promise<FirestorePulledDataset | null> {
  const wsPath = `stores/${uid}`;
  let workspaceData: Record<string, unknown> | null = null;
  try {
    const wsSnap = await getDoc(doc(db, 'stores', uid));
    if (!wsSnap.exists()) {
      return null;
    }
    workspaceData = wsSnap.data() as Record<string, unknown>;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  const [
    customersMap,
    customerTxMap,
    suppliersMap,
    supplierTxMap,
    salesMap,
    expensesMap,
    cashbookMap,
    productsMap,
  ] = await Promise.all([
    listExistingDocMeta(uid, 'customers'),
    listExistingDocMeta(uid, 'customerTransactions'),
    listExistingDocMeta(uid, 'suppliers'),
    listExistingDocMeta(uid, 'supplierTransactions'),
    listExistingDocMeta(uid, 'sales'),
    listExistingDocMeta(uid, 'expenses'),
    listExistingDocMeta(uid, 'cashbookEntries'),
    listExistingDocMeta(uid, 'products'),
  ]);

  return mapFirestoreDocsToDatasetPatch({
    workspace: workspaceData,
    customers: Array.from(customersMap.values()),
    customerTransactions: Array.from(customerTxMap.values()),
    suppliers: Array.from(suppliersMap.values()),
    supplierTransactions: Array.from(supplierTxMap.values()),
    sales: Array.from(salesMap.values()),
    expenses: Array.from(expensesMap.values()),
    cashbookEntries: Array.from(cashbookMap.values()),
    products: Array.from(productsMap.values()),
  });
}
