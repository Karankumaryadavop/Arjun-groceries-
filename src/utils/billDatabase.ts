/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BillAttachment } from '../types';
import { getActiveLocalDbAdapter } from './localDatabase';

const LEGACY_DB_NAME = 'SmartKirana_Bills_DB';
const LEGACY_DB_VERSION = 1;
const LEGACY_STORE_NAME = 'bill_documents';

// In-memory fallback when IndexedDB is unavailable (SSR or Node test environment)
const memoryStore = new Map<string, BillAttachment>();

function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/**
 * Fast string hashing utility for duplicate file detection.
 */
export function calculateFileHash(content: string): string {
  let hash = 0;
  if (!content || content.length === 0) return '0';
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `hash_${Math.abs(hash).toString(16)}_${content.length}`;
}

/**
 * Non-destructively reads any documents stored in the legacy SmartKirana_Bills_DB
 * so v2 migration can consolidate them into SmartKirana_Local_DB.billDocuments.
 */
export async function readLegacyBillsDbDocuments(): Promise<BillAttachment[]> {
  if (!isIndexedDBAvailable()) {
    return [];
  }

  try {
    // Check databases() first if available to avoid creating an empty legacy DB on fresh installs
    if (typeof window.indexedDB.databases === 'function') {
      const dbs = await window.indexedDB.databases();
      const exists = dbs.some((d) => d.name === LEGACY_DB_NAME);
      if (!exists) return [];
    }

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(LEGACY_DB_NAME, LEGACY_DB_VERSION);
      request.onupgradeneeded = (event) => {
        const upgradeDb = (event.target as IDBOpenDBRequest).result;
        if (!upgradeDb.objectStoreNames.contains(LEGACY_STORE_NAME)) {
          upgradeDb.createObjectStore(LEGACY_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Failed to open legacy bills DB'));
    });

    const docs = await new Promise<BillAttachment[]>((resolve) => {
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction([LEGACY_STORE_NAME], 'readonly');
      const req = tx.objectStore(LEGACY_STORE_NAME).getAll();
      req.onsuccess = () => {
        const res = Array.isArray(req.result) ? (req.result as BillAttachment[]) : [];
        db.close();
        resolve(res);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    });

    return docs.filter((d) => d && typeof d.id === 'string' && typeof d.dataUrl === 'string' && d.dataUrl.length > 0);
  } catch {
    return [];
  }
}

/**
 * Persists a bill document (image or PDF) into the unified SmartKirana_Local_DB `billDocuments` store.
 */
export async function saveBillDocument(doc: BillAttachment): Promise<BillAttachment> {
  const fileHash = doc.fileHash || calculateFileHash(doc.dataUrl);
  const enrichedDoc: BillAttachment = {
    ...doc,
    fileHash,
  };

  memoryStore.set(enrichedDoc.id, enrichedDoc);

  const activeDb = getActiveLocalDbAdapter();
  if (activeDb) {
    await activeDb.saveBillDocumentRecord(enrichedDoc);
    return enrichedDoc;
  }

  return enrichedDoc;
}

/**
 * Retrieves a single bill document by unique ID.
 */
export async function getBillDocument(id: string): Promise<BillAttachment | null> {
  const activeDb = getActiveLocalDbAdapter();
  if (activeDb) {
    const all = await activeDb.getBillDocuments();
    const found = all.find((d) => d.id === id);
    if (found) {
      memoryStore.set(found.id, found);
      return found;
    }
  }

  if (memoryStore.has(id)) {
    return memoryStore.get(id) || null;
  }

  // Fallback read from legacy SmartKirana_Bills_DB if still present
  const legacyDocs = await readLegacyBillsDbDocuments();
  const legacyMatch = legacyDocs.find((d) => d.id === id);
  if (legacyMatch) {
    memoryStore.set(legacyMatch.id, legacyMatch);
    if (activeDb) {
      try {
        await activeDb.saveBillDocumentRecord(legacyMatch);
      } catch {
        // Non-fatal fallback
      }
    }
    return legacyMatch;
  }

  return null;
}

/**
 * Retrieves all stored bill documents from SmartKirana_Local_DB (or memory cache fallback),
 * merging any unconsolidated legacy SmartKirana_Bills_DB documents non-destructively.
 */
export async function getAllBillDocuments(): Promise<BillAttachment[]> {
  const docMap = new Map<string, BillAttachment>();
  const activeDb = getActiveLocalDbAdapter();
  if (activeDb) {
    const docs = await activeDb.getBillDocuments();
    for (const d of docs) {
      if (d && d.id) {
        memoryStore.set(d.id, d);
        docMap.set(d.id, d);
      }
    }
  } else {
    for (const d of memoryStore.values()) {
      if (d && d.id) docMap.set(d.id, d);
    }
  }

  const legacyDocs = await readLegacyBillsDbDocuments();
  for (const leg of legacyDocs) {
    if (leg && leg.id && leg.dataUrl && !docMap.has(leg.id)) {
      docMap.set(leg.id, leg);
      memoryStore.set(leg.id, leg);
    }
  }

  return Array.from(docMap.values()).sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

/**
 * Deletes a bill document by ID.
 */
export async function deleteBillDocument(id: string): Promise<boolean> {
  memoryStore.delete(id);

  const activeDb = getActiveLocalDbAdapter();
  if (activeDb) {
    await activeDb.deleteBillDocumentRecord(id);
    return true;
  }

  return true;
}

/**
 * Links an existing bill document to its accounting transaction.
 */
export async function linkDocumentToTransaction(
  docId: string,
  txId: string,
  txType: BillAttachment['transactionType']
): Promise<void> {
  const doc = await getBillDocument(docId);
  if (!doc) return;

  const updated: BillAttachment = {
    ...doc,
    transactionId: txId,
    transactionType: txType,
  };

  await saveBillDocument(updated);
}

/**
 * Checks if an identical file has already been uploaded based on hash.
 */
export async function findDuplicateDocument(dataUrl: string): Promise<BillAttachment | null> {
  const hash = calculateFileHash(dataUrl);

  const all = await getAllBillDocuments();
  for (const doc of all) {
    if (doc.fileHash === hash || doc.dataUrl === dataUrl) {
      return doc;
    }
  }

  for (const doc of memoryStore.values()) {
    if (doc.fileHash === hash || doc.dataUrl === dataUrl) {
      return doc;
    }
  }

  return null;
}

/**
 * Exports all documents for inclusion in complete data backups.
 */
export async function exportDocumentsForBackup(): Promise<BillAttachment[]> {
  return await getAllBillDocuments();
}

/**
 * Imports documents from a backup payload, avoiding duplicates.
 */
export async function importDocumentsFromBackup(
  docs: BillAttachment[]
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const doc of docs) {
    if (!doc || !doc.id || !doc.dataUrl) {
      skipped++;
      continue;
    }
    try {
      await saveBillDocument(doc);
      imported++;
    } catch {
      skipped++;
    }
  }

  return { imported, skipped };
}
