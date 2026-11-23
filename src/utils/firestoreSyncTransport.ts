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
} from 'firebase/firestore';
import {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  LocalBackupSnapshot,
  Product,
  SaleRecord,
  StoreBusinessDataset,
  StoreProfile,
  Supplier,
  SupplierTransaction,
  SyncQueueItem,
} from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CloudTransportAdapter, detectSyncConflict } from './cloudSyncEngine';
import {
  buildBackupManifestCloudPayload,
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
import { computeDeterministicHash } from './localDatabase';

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128) || 'id-0';
}

function pickKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * Ensures parent `/stores/{userId}` document exists (required by Master Gate rules).
 */
export async function ensureStoreWorkspaceDoc(
  userId: string,
  profile: StoreProfile,
  lastClosedDate: string | null
): Promise<void> {
  const safeUid = sanitizeId(userId);
  const ref = doc(db, 'stores', safeUid);
  const path = `stores/${safeUid}`;
  const payload = buildStoreWorkspacePayload(safeUid, profile, lastClosedDate);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  try {
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const updatePatch = pickKeys(payload, [
        'storeName',
        'ownerName',
        'phone',
        'address',
        'upiId',
        'gstin',
        'lastClosedDate',
        'whatsappTemplateConfig',
        'localUpdatedAt',
      ]);
      await updateDoc(ref, {
        ...updatePatch,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

async function upsertSubcollectionDoc(params: {
  userId: string;
  subcollection: string;
  docId: string;
  createPayload: Record<string, unknown>;
  updateAllowedKeys: string[];
  localUpdatedAt: string;
  entityLabel: string;
  lastSyncedAt?: string;
  allowUpdate?: boolean;
  skipIfTerminal?: boolean;
}): Promise<{
  ok: boolean;
  conflict?: {
    remoteUpdatedAt: string;
    remoteSnapshot: Record<string, unknown>;
    entityLabel: string;
  };
  error?: string;
}> {
  const safeUid = sanitizeId(params.userId);
  const safeDocId = sanitizeId(params.docId);
  const path = `stores/${safeUid}/${params.subcollection}/${safeDocId}`;
  const ref = doc(db, 'stores', safeUid, params.subcollection, safeDocId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...params.createPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }

    const remoteData = snap.data() as Record<string, unknown>;
    if (
      params.skipIfTerminal &&
      (remoteData.status === 'CANCELLED' || remoteData.status === 'REVERSED')
    ) {
      return { ok: true };
    }

    if (params.allowUpdate === false) {
      return { ok: true };
    }

    const remoteUpdatedAt =
      typeof remoteData.localUpdatedAt === 'string' ? remoteData.localUpdatedAt : '';
    const localHash = computeDeterministicHash(JSON.stringify(params.createPayload));
    const comparableRemote = pickKeys(remoteData, Object.keys(params.createPayload));
    const remoteHash = computeDeterministicHash(JSON.stringify(comparableRemote));

    if (
      remoteUpdatedAt &&
      detectSyncConflict({
        localUpdatedAt: params.localUpdatedAt,
        remoteUpdatedAt,
        lastSyncedAt: params.lastSyncedAt,
        localPayloadHash: localHash,
        remotePayloadHash: remoteHash,
      })
    ) {
      return {
        ok: false,
        conflict: {
          remoteUpdatedAt,
          remoteSnapshot: remoteData,
          entityLabel: params.entityLabel,
        },
      };
    }

    const updatePatch = pickKeys(params.createPayload, params.updateAllowedKeys);
    await updateDoc(ref, {
      ...updatePatch,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch (wrapped) {
      const msg = wrapped instanceof Error ? wrapped.message : String(wrapped);
      return { ok: false, error: msg };
    }
  }
}

export function createFirestoreTransportAdapter(options: {
  userId: string;
  emailVerified: boolean;
  getDataset: () => StoreBusinessDataset;
  getLocalBackups: () => LocalBackupSnapshot[];
  getLastSyncedAt: () => string | undefined;
}): CloudTransportAdapter {
  const configured = Boolean(options.userId && options.emailVerified);

  return {
    isConfigured: configured,
    async pushRecord(item: SyncQueueItem, payload: unknown) {
      if (!configured) {
        return {
          ok: false,
          error: 'Sign in with a verified Google account to sync with Firebase Firestore.',
        };
      }

      const ds = options.getDataset();
      await ensureStoreWorkspaceDoc(options.userId, ds.profile, ds.lastClosedDate ?? null);

      const safeUid = sanitizeId(options.userId);
      const lastSyncedAt = options.getLastSyncedAt();

      if (item.entityType === 'SETTINGS') {
        return { ok: true };
      }

      if (item.entityType === 'CUSTOMER') {
        const c = ds.customers.find((x) => x.id === item.entityId);
        if (!c) return { ok: true };
        const docPayload = buildCustomerCloudPayload(safeUid, c, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'customers',
          docId: c.id,
          createPayload: docPayload,
          updateAllowedKeys: [
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
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Customer: ${c.name}`,
          lastSyncedAt,
        });
      }

      if (item.entityType === 'CUSTOMER_TX') {
        const tx = ds.customerTransactions.find((x) => x.id === item.entityId);
        if (!tx) return { ok: true };
        const docPayload = buildCustomerTxCloudPayload(safeUid, tx, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'customerTransactions',
          docId: tx.id,
          createPayload: docPayload,
          updateAllowedKeys: ['description', 'paymentMethod', 'invoiceNo', 'status', 'localUpdatedAt'],
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Customer Tx: ${tx.description || tx.id}`,
          lastSyncedAt,
          skipIfTerminal: true,
        });
      }

      if (item.entityType === 'SUPPLIER') {
        const s = ds.suppliers.find((x) => x.id === item.entityId);
        if (!s) return { ok: true };
        const docPayload = buildSupplierCloudPayload(safeUid, s, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'suppliers',
          docId: s.id,
          createPayload: docPayload,
          updateAllowedKeys: [
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
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Supplier: ${s.name}`,
          lastSyncedAt,
        });
      }

      if (item.entityType === 'SUPPLIER_TX') {
        const tx = ds.supplierTransactions.find((x) => x.id === item.entityId);
        if (!tx) return { ok: true };
        const docPayload = buildSupplierTxCloudPayload(safeUid, tx, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'supplierTransactions',
          docId: tx.id,
          createPayload: docPayload,
          updateAllowedKeys: [
            'paymentStatus',
            'paymentMethod',
            'description',
            'invoiceNo',
            'status',
            'localUpdatedAt',
          ],
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Supplier Tx: ${tx.description || tx.id}`,
          lastSyncedAt,
          skipIfTerminal: true,
        });
      }

      if (item.entityType === 'SALE') {
        const sale = ds.sales.find((x) => x.id === item.entityId);
        if (!sale) return { ok: true };
        const docPayload = buildSaleCloudPayload(safeUid, sale, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'sales',
          docId: sale.id,
          createPayload: docPayload,
          updateAllowedKeys: ['notes', 'paymentMethod', 'customerId', 'customerName', 'localUpdatedAt'],
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Invoice #${sale.invoiceNo}`,
          lastSyncedAt,
        });
      }

      if (item.entityType === 'EXPENSE') {
        const exp = ds.expenses.find((x) => x.id === item.entityId);
        if (!exp) return { ok: true };
        const docPayload = buildExpenseCloudPayload(safeUid, exp, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'expenses',
          docId: exp.id,
          createPayload: docPayload,
          updateAllowedKeys: [
            'title',
            'category',
            'amount',
            'isPersonalWithdrawal',
            'paymentMethod',
            'date',
            'notes',
            'localUpdatedAt',
          ],
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Expense: ${exp.title}`,
          lastSyncedAt,
        });
      }

      if (item.entityType === 'CASHBOOK') {
        const cb = ds.cashbookEntries.find((x) => x.id === item.entityId);
        if (!cb) return { ok: true };
        const docPayload = buildCashbookCloudPayload(safeUid, cb, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'cashbookEntries',
          docId: cb.id,
          createPayload: docPayload,
          updateAllowedKeys: ['description', 'category', 'amount', 'localUpdatedAt'],
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Cashbook: ${cb.description}`,
          lastSyncedAt,
        });
      }

      if (item.entityType === 'PRODUCT') {
        const prod = ds.products.find((x) => x.id === item.entityId);
        if (!prod) return { ok: true };
        const docPayload = buildProductCloudPayload(safeUid, prod, item.localUpdatedAt);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'products',
          docId: prod.id,
          createPayload: docPayload,
          updateAllowedKeys: [
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
          localUpdatedAt: String(docPayload.localUpdatedAt),
          entityLabel: `Product: ${prod.name}`,
          lastSyncedAt,
        });
      }

      if (item.entityType === 'BACKUP_META') {
        const snap = options.getLocalBackups().find((x) => x.id === item.entityId);
        if (!snap) return { ok: true };
        const docPayload = buildBackupManifestCloudPayload(safeUid, snap);
        return upsertSubcollectionDoc({
          userId: safeUid,
          subcollection: 'backupManifests',
          docId: snap.id,
          createPayload: docPayload,
          updateAllowedKeys: [],
          localUpdatedAt: snap.createdAt,
          entityLabel: `Backup ${snap.bucket}`,
          lastSyncedAt,
          allowUpdate: false,
        });
      }

      // Suppress unused param lint warning when fallback is skipped
      void payload;
      return { ok: true };
    },
  };
}

/**
 * Syncs a complete local store dataset cleanly to Firestore (used on initial Cloud Sync or manual Sync Now).
 */
export async function syncFullDatasetToCloud(
  userId: string,
  dataset: StoreBusinessDataset,
  localBackups: LocalBackupSnapshot[],
  lastSyncedAt?: string
): Promise<{ syncedCount: number; conflictCount: number; failedCount: number }> {
  const safeUid = sanitizeId(userId);
  await ensureStoreWorkspaceDoc(safeUid, dataset.profile, dataset.lastClosedDate ?? null);

  let syncedCount = 1; // root workspace
  let conflictCount = 0;
  let failedCount = 0;

  const jobs: Array<() => Promise<{ ok: boolean; conflict?: unknown }>> = [
    ...dataset.customers.map((c) => () => {
      const p = buildCustomerCloudPayload(safeUid, c);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'customers',
        docId: c.id,
        createPayload: p,
        updateAllowedKeys: [
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
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Customer: ${c.name}`,
        lastSyncedAt,
      });
    }),
    ...dataset.customerTransactions.map((tx) => () => {
      const p = buildCustomerTxCloudPayload(safeUid, tx);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'customerTransactions',
        docId: tx.id,
        createPayload: p,
        updateAllowedKeys: ['description', 'paymentMethod', 'invoiceNo', 'status', 'localUpdatedAt'],
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Customer Tx: ${tx.description || tx.id}`,
        lastSyncedAt,
        skipIfTerminal: true,
      });
    }),
    ...dataset.suppliers.map((s) => () => {
      const p = buildSupplierCloudPayload(safeUid, s);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'suppliers',
        docId: s.id,
        createPayload: p,
        updateAllowedKeys: [
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
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Supplier: ${s.name}`,
        lastSyncedAt,
      });
    }),
    ...dataset.supplierTransactions.map((tx) => () => {
      const p = buildSupplierTxCloudPayload(safeUid, tx);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'supplierTransactions',
        docId: tx.id,
        createPayload: p,
        updateAllowedKeys: [
          'paymentStatus',
          'paymentMethod',
          'description',
          'invoiceNo',
          'status',
          'localUpdatedAt',
        ],
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Supplier Tx: ${tx.description || tx.id}`,
        lastSyncedAt,
        skipIfTerminal: true,
      });
    }),
    ...dataset.sales.map((s) => () => {
      const p = buildSaleCloudPayload(safeUid, s);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'sales',
        docId: s.id,
        createPayload: p,
        updateAllowedKeys: ['notes', 'paymentMethod', 'customerId', 'customerName', 'localUpdatedAt'],
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Invoice #${s.invoiceNo}`,
        lastSyncedAt,
      });
    }),
    ...dataset.expenses.map((e) => () => {
      const p = buildExpenseCloudPayload(safeUid, e);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'expenses',
        docId: e.id,
        createPayload: p,
        updateAllowedKeys: [
          'title',
          'category',
          'amount',
          'isPersonalWithdrawal',
          'paymentMethod',
          'date',
          'notes',
          'localUpdatedAt',
        ],
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Expense: ${e.title}`,
        lastSyncedAt,
      });
    }),
    ...dataset.cashbookEntries.map((cb) => () => {
      const p = buildCashbookCloudPayload(safeUid, cb);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'cashbookEntries',
        docId: cb.id,
        createPayload: p,
        updateAllowedKeys: ['description', 'category', 'amount', 'localUpdatedAt'],
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Cashbook: ${cb.description}`,
        lastSyncedAt,
      });
    }),
    ...dataset.products.map((prod) => () => {
      const p = buildProductCloudPayload(safeUid, prod);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'products',
        docId: prod.id,
        createPayload: p,
        updateAllowedKeys: [
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
        localUpdatedAt: String(p.localUpdatedAt),
        entityLabel: `Product: ${prod.name}`,
        lastSyncedAt,
      });
    }),
    ...localBackups.slice(0, 5).map((snap) => () => {
      const p = buildBackupManifestCloudPayload(safeUid, snap);
      return upsertSubcollectionDoc({
        userId: safeUid,
        subcollection: 'backupManifests',
        docId: snap.id,
        createPayload: p,
        updateAllowedKeys: [],
        localUpdatedAt: snap.createdAt,
        entityLabel: `Backup ${snap.bucket}`,
        lastSyncedAt,
        allowUpdate: false,
      });
    }),
  ];

  for (const job of jobs) {
    const res = await job();
    if (res.ok) syncedCount++;
    else if (res.conflict) conflictCount++;
    else failedCount++;
  }

  return { syncedCount, conflictCount, failedCount };
}

/**
 * Pulls the authenticated owner's Firestore cloud data for recovery onto a new/reset device.
 */
export async function pullStoreDatasetFromCloud(
  userId: string,
  baseDataset: StoreBusinessDataset
): Promise<{ found: boolean; dataset?: StoreBusinessDataset; recordCount: number }> {
  const safeUid = sanitizeId(userId);
  const storePath = `stores/${safeUid}`;
  try {
    const storeSnap = await getDoc(doc(db, 'stores', safeUid));
    if (!storeSnap.exists()) {
      return { found: false, recordCount: 0 };
    }
    const storeData = storeSnap.data();

    const [
      custSnaps,
      custTxSnaps,
      supSnaps,
      supTxSnaps,
      saleSnaps,
      expSnaps,
      cbSnaps,
      prodSnaps,
    ] = await Promise.all([
      getDocs(query(collection(db, 'stores', safeUid, 'customers'), where('ownerId', '==', safeUid))),
      getDocs(
        query(collection(db, 'stores', safeUid, 'customerTransactions'), where('ownerId', '==', safeUid))
      ),
      getDocs(query(collection(db, 'stores', safeUid, 'suppliers'), where('ownerId', '==', safeUid))),
      getDocs(
        query(collection(db, 'stores', safeUid, 'supplierTransactions'), where('ownerId', '==', safeUid))
      ),
      getDocs(query(collection(db, 'stores', safeUid, 'sales'), where('ownerId', '==', safeUid))),
      getDocs(query(collection(db, 'stores', safeUid, 'expenses'), where('ownerId', '==', safeUid))),
      getDocs(query(collection(db, 'stores', safeUid, 'cashbookEntries'), where('ownerId', '==', safeUid))),
      getDocs(query(collection(db, 'stores', safeUid, 'products'), where('ownerId', '==', safeUid))),
    ]);

    const customers: Customer[] = custSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        name: String(x.name || ''),
        phone: String(x.phone || ''),
        address: String(x.address || ''),
        openingBalance: Number(x.openingBalance) || 0,
        currentBalance: Number(x.currentBalance) || 0,
        totalCreditGiven: Number(x.totalCreditGiven) || 0,
        totalPaymentReceived: Number(x.totalPaymentReceived) || 0,
        overdueDays: 0,
        category: 'REGULAR',
        createdAt: String(x.localUpdatedAt || new Date().toISOString()),
        whatsappConsent: x.whatsappConsent !== false,
      };
    });

    const customerTransactions: CustomerTransaction[] = custTxSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        customerId: String(x.customerId || ''),
        type: (x.type as CustomerTransaction['type']) || 'CREDIT',
        amount: Number(x.amount) || 0,
        date: String(x.date || new Date().toISOString()),
        description: String(x.description || ''),
        paymentMethod: (x.paymentMethod as CustomerTransaction['paymentMethod']) || 'CASH',
        invoiceNo: x.invoiceNo ? String(x.invoiceNo) : undefined,
        status:
          x.status === 'CANCELLED' || x.status === 'REVERSED' || x.status === 'COMPLETED'
            ? (x.status as CustomerTransaction['status'])
            : 'COMPLETED',
        createdAt: String(x.localUpdatedAt || new Date().toISOString()),
      };
    });

    const suppliers: Supplier[] = supSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        name: String(x.name || ''),
        phone: String(x.phone || ''),
        address: String(x.address || ''),
        notes: x.category ? String(x.category) : undefined,
        openingBalance: Number(x.openingBalance) || 0,
        currentBalance: Number(x.currentBalance) || 0,
        totalPurchases: Number(x.totalPurchases) || 0,
        totalPaid: Number(x.totalPaid) || 0,
        createdAt: String(x.localUpdatedAt || new Date().toISOString()),
      };
    });

    const supplierTransactions: SupplierTransaction[] = supTxSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        supplierId: String(x.supplierId || ''),
        type: (x.type as SupplierTransaction['type']) || 'PURCHASE',
        amount: Number(x.amount) || 0,
        date: String(x.date || new Date().toISOString()),
        paymentStatus: (x.paymentStatus as SupplierTransaction['paymentStatus']) || 'PAID',
        paymentMethod: (x.paymentMethod as SupplierTransaction['paymentMethod']) || 'BANK',
        description: String(x.description || ''),
        invoiceNo: x.invoiceNo ? String(x.invoiceNo) : undefined,
        status:
          x.status === 'CANCELLED' || x.status === 'REVERSED' || x.status === 'COMPLETED'
            ? (x.status as SupplierTransaction['status'])
            : 'COMPLETED',
        createdAt: String(x.localUpdatedAt || new Date().toISOString()),
      };
    });

    const sales: SaleRecord[] = saleSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        invoiceNo: String(x.invoiceNo || d.id),
        date: String(x.date || new Date().toISOString()),
        customerId: x.customerId ? String(x.customerId) : undefined,
        customerName: x.customerName ? String(x.customerName) : undefined,
        amount: Number(x.amount) || 0,
        paymentMethod: (x.paymentMethod as SaleRecord['paymentMethod']) || 'CASH',
        items: Array.isArray(x.items) ? (x.items as SaleRecord['items']) : [],
        notes: x.notes ? String(x.notes) : undefined,
        isCredit: Boolean(x.isCredit),
        createdAt: String(x.localUpdatedAt || new Date().toISOString()),
      };
    });

    const expenses: ExpenseRecord[] = expSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        title: String(x.title || ''),
        category: (x.category as ExpenseRecord['category']) || 'OTHER',
        amount: Number(x.amount) || 0,
        isPersonalWithdrawal: Boolean(x.isPersonalWithdrawal),
        paymentMethod: (x.paymentMethod as ExpenseRecord['paymentMethod']) || 'CASH',
        date: String(x.date || new Date().toISOString().split('T')[0]),
        notes: x.notes ? String(x.notes) : undefined,
        createdAt: String(x.localUpdatedAt || new Date().toISOString()),
      };
    });

    const cashbookEntries: CashbookEntry[] = cbSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        date: String(x.date || new Date().toISOString().split('T')[0]),
        type: x.type === 'OUT' ? 'OUT' : 'IN',
        category: String(x.category || 'GENERAL'),
        description: String(x.description || ''),
        amount: Number(x.amount) || 0,
        paymentMode: 'CASH',
        refType: (x.refType as CashbookEntry['refType']) || 'MANUAL',
        refId: x.refId ? String(x.refId) : undefined,
        createdAt: String(x.localUpdatedAt || new Date().toISOString()),
      };
    });

    const products: Product[] = prodSnaps.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id || d.id),
        name: String(x.name || ''),
        category: String(x.category || 'Grocery'),
        unit: String(x.unit || 'pcs'),
        purchasePrice: Number(x.costPrice) || 0,
        sellingPrice: Number(x.sellingPrice) || 0,
        mrp: x.mrp !== undefined ? Number(x.mrp) : undefined,
        stockQty: Number(x.stockQty) || 0,
        minStockAlert: Number(x.minStockAlert) || 0,
        preferredSupplierId: x.preferredSupplierId ? String(x.preferredSupplierId) : undefined,
        preferredSupplierName: x.preferredSupplierName ? String(x.preferredSupplierName) : undefined,
        isArchived: Boolean(x.isArchived),
        updatedAt: String(x.localUpdatedAt || new Date().toISOString()),
      };
    });

    const mergedProfile: StoreProfile = {
      ...baseDataset.profile,
      storeName: String(storeData.storeName || baseDataset.profile.storeName),
      ownerName: String(storeData.ownerName || baseDataset.profile.ownerName),
      phone: String(storeData.phone || baseDataset.profile.phone),
      address: String(storeData.address || baseDataset.profile.address),
      upiId: String(storeData.upiId || baseDataset.profile.upiId),
      gstin: storeData.gstin ? String(storeData.gstin) : baseDataset.profile.gstin,
      whatsappTemplateConfig:
        storeData.whatsappTemplateConfig || baseDataset.profile.whatsappTemplateConfig,
    };

    const recordCount =
      customers.length +
      customerTransactions.length +
      suppliers.length +
      supplierTransactions.length +
      sales.length +
      expenses.length +
      cashbookEntries.length +
      products.length;

    return {
      found: true,
      recordCount,
      dataset: {
        ...baseDataset,
        profile: mergedProfile,
        customers: customers.length > 0 ? customers : baseDataset.customers,
        customerTransactions:
          customerTransactions.length > 0 ? customerTransactions : baseDataset.customerTransactions,
        suppliers: suppliers.length > 0 ? suppliers : baseDataset.suppliers,
        supplierTransactions:
          supplierTransactions.length > 0 ? supplierTransactions : baseDataset.supplierTransactions,
        sales: sales.length > 0 ? sales : baseDataset.sales,
        expenses: expenses.length > 0 ? expenses : baseDataset.expenses,
        cashbookEntries:
          cashbookEntries.length > 0 ? cashbookEntries : baseDataset.cashbookEntries,
        products: products.length > 0 ? products : baseDataset.products,
        lastClosedDate: storeData.lastClosedDate
          ? String(storeData.lastClosedDate)
          : baseDataset.lastClosedDate,
      },
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, storePath);
  }
}
