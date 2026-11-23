/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppBackupData,
  AppBackupSummary,
  AutoBackupSettings,
  BackupReconciliationReport,
  BackupRetentionBucket,
  BackupTriggerType,
  EncryptedBackupEnvelope,
  LocalBackupSnapshot,
  StoreBusinessDataset,
} from '../types';
import { triggerVerifiedBlobDownload } from './androidDownload';
import {
  generateBackupData,
  ParsedBackupResult,
  serializeBackupJSON,
  validateAndParseBackupJSON,
} from './backup';
import { generateBackupReconciliationReport } from './backupReconciliation';
import {
  computeDeterministicHash,
  DEFAULT_AUTO_BACKUP_SETTINGS,
  formatStorageError,
  listLocalBackups,
  LocalDbAdapter,
  recalculateLedgerBalancesFromHistory,
  requestAndCheckStorageQuota,
  STORE_NAMES,
} from './localDatabase';
import {
  canonicalJSONStringify,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  isEncryptedBackupEnvelope,
} from './securityCrypto';

export function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getCalendarDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Computes a deterministic SHA-256 checksum for backup payload integrity verification.
 */
export async function computePayloadChecksum(payloadJson: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const encoded = new TextEncoder().encode(payloadJson);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback below
    }
  }
  return `fnv-${computeDeterministicHash(payloadJson)}`;
}

/**
 * Builds a verified backup JSON envelope including full billDocuments, recurringExpenses,
 * dailySalesTarget, lastClosedDate, and canonical SHA-256 checksum.
 */
export async function buildVerifiedBackupEnvelope(
  dataset: StoreBusinessDataset
): Promise<{ jsonString: string; checksum: string; backup: AppBackupData; sizeBytes: number }> {
  const backup = generateBackupData({
    profile: dataset.profile,
    customers: dataset.customers,
    customerTransactions: dataset.customerTransactions,
    suppliers: dataset.suppliers,
    supplierTransactions: dataset.supplierTransactions,
    sales: dataset.sales,
    expenses: dataset.expenses,
    cashbookEntries: dataset.cashbookEntries,
    products: dataset.products,
    productCategories: dataset.productCategories || [],
    expenseCategories: dataset.expenseCategories || [],
    stockAdjustments: dataset.stockAdjustments,
    auditLogs: dataset.auditLogs,
    billDocuments: dataset.billDocuments || [],
    recurringExpenses: dataset.recurringExpenses || [],
    dailySalesTarget: dataset.dailySalesTarget ?? null,
    lastClosedDate: dataset.lastClosedDate ?? null,
    whatsappBatches: dataset.whatsappBatches,
    whatsappAuditLogs: dataset.whatsappAuditLogs,
  });

  const canonicalBody = canonicalJSONStringify(backup);
  const checksum = await computePayloadChecksum(canonicalBody);

  const envelope: AppBackupData = {
    ...backup,
    checksumAlgorithm: checksum.startsWith('fnv-') ? 'FNV64' : 'SHA-256',
    checksum,
  };

  const jsonString = serializeBackupJSON(envelope, true);
  const sizeBytes =
    typeof Blob !== 'undefined'
      ? new Blob([jsonString]).size
      : Buffer.byteLength(jsonString, 'utf8');

  return { jsonString, checksum, backup, sizeBytes };
}

/**
 * Builds an AES-256-GCM encrypted backup file (.skbackup.json) wrapping the verified JSON envelope.
 */
export async function buildEncryptedBackupFileContent(
  dataset: StoreBusinessDataset,
  passphrase: string
): Promise<{
  jsonString: string;
  envelope: EncryptedBackupEnvelope;
  checksum: string;
  backup: AppBackupData;
  sizeBytes: number;
}> {
  const verified = await buildVerifiedBackupEnvelope(dataset);
  const envelope = await encryptBackupEnvelope(verified.jsonString, passphrase, {
    storeName: dataset.profile.storeName,
    schemaVersion: verified.backup.schemaVersion,
    checksum: verified.checksum,
    recordCounts: verified.backup.recordCounts,
  });
  const jsonString = JSON.stringify(envelope, null, 2);
  const sizeBytes =
    typeof Blob !== 'undefined'
      ? new Blob([jsonString]).size
      : Buffer.byteLength(jsonString, 'utf8');
  return {
    jsonString,
    envelope,
    checksum: verified.checksum,
    backup: verified.backup,
    sizeBytes,
  };
}

/**
 * Validates JSON syntax, schema, entity arrays, and embedded checksum (supporting canonical & legacy key-order forms).
 * Enforces checksum presence on v2.1+ / v2.2+ backups; marks unsigned v1.0 / v2.0 backups with explicit warning.
 */
export async function validateBackupWithChecksum(
  jsonStr: string
): Promise<
  ParsedBackupResult & {
    checksumValid?: boolean;
    expectedChecksum?: string;
    isUnsignedLegacy?: boolean;
  }
> {
  const baseParsed = validateAndParseBackupJSON(jsonStr);
  if (!baseParsed.valid || !baseParsed.data) {
    return baseParsed;
  }

  try {
    const raw = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof raw.checksum === 'string' && raw.checksum.trim()) {
      const embeddedChecksum = raw.checksum.trim();
      const withoutChecksum = { ...raw };
      delete withoutChecksum.checksum;
      delete withoutChecksum.checksumAlgorithm;

      const canonicalSorted = canonicalJSONStringify(withoutChecksum);
      const formatted = JSON.stringify(withoutChecksum, null, 2);
      const compact = JSON.stringify(withoutChecksum);

      const [hSorted, hFormatted, hCompact] = await Promise.all([
        computePayloadChecksum(canonicalSorted),
        computePayloadChecksum(formatted),
        computePayloadChecksum(compact),
      ]);

      const matches =
        embeddedChecksum === hSorted ||
        embeddedChecksum === hFormatted ||
        embeddedChecksum === hCompact;

      if (!matches) {
        return {
          valid: false,
          checksumValid: false,
          expectedChecksum: embeddedChecksum,
          error:
            'Backup integrity check failed: checksum mismatch detected. The JSON file may have been corrupted or truncated.',
        };
      }
      return { ...baseParsed, checksumValid: true, expectedChecksum: embeddedChecksum };
    }

    const schemaVer = baseParsed.metadata?.schemaVersion || '1.0.0';
    const requiresChecksum =
      schemaVer.startsWith('2.1') || schemaVer.startsWith('2.2') || schemaVer.startsWith('3.');
    if (requiresChecksum) {
      return {
        valid: false,
        checksumValid: false,
        error: `Backup integrity check failed: required SHA-256 checksum is missing from schema v${schemaVer} backup.`,
      };
    }

    const warnings = [...(baseParsed.warnings || [])];
    warnings.push(
      'Unsigned legacy backup (no SHA-256 checksum). Review the financial reconciliation report carefully before restoring.'
    );
    return {
      ...baseParsed,
      warnings,
      checksumValid: false,
      isUnsignedLegacy: true,
    };
  } catch {
    return {
      valid: false,
      error: 'Failed to verify backup integrity checksum.',
    };
  }
}

export interface InspectedBackupResult extends ParsedBackupResult {
  isEncrypted?: boolean;
  requiresPassphrase?: boolean;
  checksumValid?: boolean;
  expectedChecksum?: string;
  isUnsignedLegacy?: boolean;
  reconciliationReport?: BackupReconciliationReport;
  encryptedMetadata?: EncryptedBackupEnvelope['metadata'];
}

/**
 * Inspects either a plain JSON backup or an encrypted `.skbackup.json` envelope.
 * If encrypted and passphrase is omitted, signals `requiresPassphrase: true` safely.
 */
export async function inspectAndValidateBackupContent(
  contentStr: string,
  passphrase?: string
): Promise<InspectedBackupResult> {
  if (!contentStr || typeof contentStr !== 'string' || !contentStr.trim()) {
    return { valid: false, error: 'Backup file is completely empty.' };
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(contentStr);
  } catch (err: unknown) {
    return {
      valid: false,
      error: `Invalid backup JSON syntax: ${err instanceof Error ? err.message : 'Unable to parse file'}`,
    };
  }

  if (isEncryptedBackupEnvelope(parsedRaw)) {
    if (!passphrase || !passphrase.trim()) {
      return {
        valid: false,
        isEncrypted: true,
        requiresPassphrase: true,
        encryptedMetadata: parsedRaw.metadata,
        error: 'This backup is AES-256-GCM encrypted. Enter your passphrase to preview and restore.',
      };
    }

    try {
      const decryptedJson = await decryptBackupEnvelope(parsedRaw, passphrase);
      const validated = await validateBackupWithChecksum(decryptedJson);
      const reconciliationReport =
        validated.valid && validated.data
          ? generateBackupReconciliationReport({
              profile: validated.data.profile,
              customers: validated.data.customers,
              customerTransactions: validated.data.customerTransactions,
              suppliers: validated.data.suppliers,
              supplierTransactions: validated.data.supplierTransactions,
              sales: validated.data.sales,
              expenses: validated.data.expenses,
              cashbookEntries: validated.data.cashbookEntries,
              products: validated.data.products,
              productCategories: validated.data.productCategories || [],
              expenseCategories: validated.data.expenseCategories || [],
              stockAdjustments: validated.data.stockAdjustments || [],
              auditLogs: validated.data.auditLogs,
              billDocuments: validated.data.billDocuments || [],
              recurringExpenses: validated.data.recurringExpenses || [],
              dailySalesTarget: validated.data.dailySalesTarget ?? null,
              lastClosedDate: validated.data.lastClosedDate ?? null,
              whatsappBatches: validated.data.whatsappBatches || [],
              whatsappAuditLogs: validated.data.whatsappAuditLogs || [],
            })
          : undefined;
      return {
        ...validated,
        isEncrypted: true,
        requiresPassphrase: false,
        reconciliationReport,
        encryptedMetadata: parsedRaw.metadata,
      };
    } catch (err: unknown) {
      return {
        valid: false,
        isEncrypted: true,
        requiresPassphrase: false,
        encryptedMetadata: parsedRaw.metadata,
        error: err instanceof Error ? err.message : 'Failed to decrypt encrypted backup file.',
      };
    }
  }

  const validated = await validateBackupWithChecksum(contentStr);
  const reconciliationReport =
    validated.valid && validated.data
      ? generateBackupReconciliationReport({
          profile: validated.data.profile,
          customers: validated.data.customers,
          customerTransactions: validated.data.customerTransactions,
          suppliers: validated.data.suppliers,
          supplierTransactions: validated.data.supplierTransactions,
          sales: validated.data.sales,
          expenses: validated.data.expenses,
          cashbookEntries: validated.data.cashbookEntries,
          products: validated.data.products,
          productCategories: validated.data.productCategories || [],
          expenseCategories: validated.data.expenseCategories || [],
          stockAdjustments: validated.data.stockAdjustments || [],
          auditLogs: validated.data.auditLogs,
          billDocuments: validated.data.billDocuments || [],
          recurringExpenses: validated.data.recurringExpenses || [],
          dailySalesTarget: validated.data.dailySalesTarget ?? null,
          lastClosedDate: validated.data.lastClosedDate ?? null,
          whatsappBatches: validated.data.whatsappBatches || [],
          whatsappAuditLogs: validated.data.whatsappAuditLogs || [],
        })
      : undefined;

  return {
    ...validated,
    isEncrypted: false,
    reconciliationReport,
  };
}

/**
 * Enforces retention policy:
 * - Retain up to `dailyRetentionCount` (default 7) latest DAILY snapshots (one per calendar day)
 * - Retain up to `weeklyRetentionCount` (default 4) latest WEEKLY snapshots (one per ISO week)
 * - Retain up to 10 recent MANUAL snapshots
 * - Independently protect up to 5 latest RECOVERY (`PRE_RESTORE` / `PRE_MIGRATION`) snapshots
 */
export function applyBackupRetentionPolicy(
  snapshots: LocalBackupSnapshot[],
  settings: AutoBackupSettings = DEFAULT_AUTO_BACKUP_SETTINGS
): { keep: LocalBackupSnapshot[]; pruneIds: string[] } {
  const sorted = [...snapshots].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const keptIds = new Set<string>();

  const dailySnapshots = sorted.filter((s) => s.bucket === 'DAILY');
  const seenDays = new Set<string>();
  for (const snap of dailySnapshots) {
    if (!seenDays.has(snap.dateKey)) {
      if (seenDays.size < Math.max(1, settings.dailyRetentionCount)) {
        seenDays.add(snap.dateKey);
        keptIds.add(snap.id);
      }
    }
  }

  const weeklySnapshots = sorted.filter((s) => s.bucket === 'WEEKLY');
  const seenWeeks = new Set<string>();
  for (const snap of weeklySnapshots) {
    if (!seenWeeks.has(snap.weekKey)) {
      if (seenWeeks.size < Math.max(1, settings.weeklyRetentionCount)) {
        seenWeeks.add(snap.weekKey);
        keptIds.add(snap.id);
      }
    }
  }

  const manualSnapshots = sorted.filter((s) => s.bucket === 'MANUAL');
  for (const snap of manualSnapshots.slice(0, 10)) {
    keptIds.add(snap.id);
  }

  const recoverySnapshots = sorted.filter(
    (s) =>
      s.bucket === 'RECOVERY' ||
      s.trigger === 'PRE_RESTORE' ||
      s.trigger === 'PRE_MIGRATION'
  );
  for (const snap of recoverySnapshots) {
    keptIds.add(snap.id);
  }

  const keep = sorted.filter((s) => keptIds.has(s.id));
  const pruneIds = sorted.filter((s) => !keptIds.has(s.id)).map((s) => s.id);
  return { keep, pruneIds };
}

/**
 * Creates a verified snapshot inside IndexedDB and rotates older backups cleanly.
 * Protected PRE_RESTORE and PRE_MIGRATION snapshots are stored in the `RECOVERY` bucket.
 */
export async function createLocalBackupSnapshot(
  db: LocalDbAdapter,
  dataset: StoreBusinessDataset,
  trigger: BackupTriggerType,
  reason?: string,
  settings: AutoBackupSettings = DEFAULT_AUTO_BACKUP_SETTINGS
): Promise<LocalBackupSnapshot> {
  const now = new Date();
  const createdAt = now.toISOString();
  const dateKey = getCalendarDateKey(now);
  const weekKey = getIsoWeekKey(now);

  const { jsonString, checksum, backup, sizeBytes } = await buildVerifiedBackupEnvelope(dataset);

  const bucket: BackupRetentionBucket =
    trigger === 'PRE_RESTORE' || trigger === 'PRE_MIGRATION'
      ? 'RECOVERY'
      : trigger === 'MANUAL'
      ? 'MANUAL'
      : 'DAILY';

  const snapshot: LocalBackupSnapshot = {
    id: `bak-${trigger.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt,
    dateKey,
    weekKey,
    trigger,
    bucket,
    reason,
    schemaVersion: backup.schemaVersion,
    checksum,
    sizeBytes,
    status: 'SUCCESS',
    summary: backup.summary,
    payloadJson: jsonString,
  };

  await db.putOne(STORE_NAMES.LOCAL_BACKUPS, snapshot);

  const allExisting = await listLocalBackups(db);
  const hasThisWeekWeekly = allExisting.some(
    (b) => b.bucket === 'WEEKLY' && b.weekKey === weekKey
  );
  if (!hasThisWeekWeekly && trigger !== 'PRE_RESTORE' && trigger !== 'PRE_MIGRATION') {
    const weeklyClone: LocalBackupSnapshot = {
      ...snapshot,
      id: `bak-weekly-${weekKey}-${Date.now()}`,
      bucket: 'WEEKLY',
      reason: `Weekly archive (${weekKey})`,
    };
    await db.putOne(STORE_NAMES.LOCAL_BACKUPS, weeklyClone);
  }

  const updatedList = await listLocalBackups(db);
  const { pruneIds } = applyBackupRetentionPolicy(updatedList, settings);
  for (const id of pruneIds) {
    await db.deleteOne(STORE_NAMES.LOCAL_BACKUPS, id);
  }

  await db.setMeta('lastBackupMeta', {
    lastBackupAt: createdAt,
    status: 'SUCCESS',
    trigger,
    snapshotId: snapshot.id,
  });

  return snapshot;
}

export interface VerifiedRestoreCounts {
  verified: boolean;
  customers: number;
  customerTransactions: number;
  suppliers: number;
  supplierTransactions: number;
  sales: number;
  expenses: number;
  cashbookEntries: number;
  products: number;
  stockAdjustments: number;
  billDocuments: number;
  auditLogs: number;
}

export interface RestoreBackupResult {
  success: boolean;
  error?: string;
  restoreError?: string;
  rollbackError?: string;
  rollbackSucceeded?: boolean;
  criticalRecoveryFailure?: boolean;
  preRestoreSnapshotPreserved?: boolean;
  requiresPassphrase?: boolean;
  warnings?: string[];
  restoredDataset?: StoreBusinessDataset;
  summary?: AppBackupSummary;
  reconciliationReport?: BackupReconciliationReport;
  rollbackCheckpointId?: string;
  verifiedCounts?: VerifiedRestoreCounts;
}

export class CriticalRestoreRollbackError extends Error {
  readonly code = 'CRITICAL_RECOVERY_FAILURE' as const;
  readonly restoreError: string;
  readonly rollbackError: string;
  readonly rollbackCheckpointId: string;
  readonly preRestoreSnapshotPreserved: boolean;
  readonly reconciliationReport?: BackupReconciliationReport;

  constructor(params: {
    restoreError: string;
    rollbackError: string;
    rollbackCheckpointId: string;
    preRestoreSnapshotPreserved: boolean;
    reconciliationReport?: BackupReconciliationReport;
  }) {
    const msg = `CRITICAL RECOVERY FAILURE: Restore failed (${params.restoreError}) AND rollback failed (${params.rollbackError}). Do not clear browser data — pre-restore safety snapshot "${params.rollbackCheckpointId}" is ${
      params.preRestoreSnapshotPreserved
        ? 'preserved in local recovery storage'
        : 'referenced for recovery'
    }.`;
    super(msg);
    this.name = 'CriticalRestoreRollbackError';
    this.restoreError = params.restoreError;
    this.rollbackError = params.rollbackError;
    this.rollbackCheckpointId = params.rollbackCheckpointId;
    this.preRestoreSnapshotPreserved = params.preRestoreSnapshotPreserved;
    this.reconciliationReport = params.reconciliationReport;
  }
}

function deduplicateExpectedIds<T extends { id: string }>(items: T[] | undefined): T[] {
  if (!Array.isArray(items)) return [];
  const seen = new Map<string, T>();
  for (const item of items) {
    if (item && typeof item.id === 'string' && item.id.trim()) {
      seen.set(item.id, item);
    }
  }
  return Array.from(seen.values());
}

function collectExpectedDocumentDataUrls(dataset: StoreBusinessDataset): Map<string, string> {
  const docMap = new Map<string, string>();
  for (const d of dataset.billDocuments || []) {
    if (d && d.id && d.dataUrl && d.dataUrl.trim().length > 0) {
      docMap.set(d.id, d.dataUrl);
    }
  }
  const collectInline = (
    list: Array<{ attachments?: Array<{ id?: string; dataUrl?: string }> }> | undefined
  ) => {
    for (const rec of list || []) {
      for (const att of rec.attachments || []) {
        if (att && att.id && att.dataUrl && att.dataUrl.trim().length > 0 && !docMap.has(att.id)) {
          docMap.set(att.id, att.dataUrl);
        }
      }
    }
  };
  collectInline(dataset.sales);
  collectInline(dataset.expenses);
  collectInline(dataset.customerTransactions);
  collectInline(dataset.supplierTransactions);
  collectInline(dataset.cashbookEntries);
  return docMap;
}

async function verifyDatasetReadBack(
  db: LocalDbAdapter,
  expectedDataset: StoreBusinessDataset,
  context: 'restore' | 'rollback'
): Promise<{
  verifiedCounts: VerifiedRestoreCounts;
  hydratedDataset: StoreBusinessDataset;
}> {
  const readBack = await db.loadBusinessDataset();

  if (!readBack || !readBack.profile || !readBack.profile.storeName) {
    throw new Error(`Post-${context} verification failed: store profile is missing.`);
  }

  const expectedDocMap = collectExpectedDocumentDataUrls(expectedDataset);

  const expectedCustomers = deduplicateExpectedIds(expectedDataset.customers);
  const expectedCustomerTx = deduplicateExpectedIds(expectedDataset.customerTransactions);
  const expectedSuppliers = deduplicateExpectedIds(expectedDataset.suppliers);
  const expectedSupplierTx = deduplicateExpectedIds(expectedDataset.supplierTransactions);
  const expectedSales = deduplicateExpectedIds(expectedDataset.sales);
  const expectedExpenses = deduplicateExpectedIds(expectedDataset.expenses);
  const expectedCashbook = deduplicateExpectedIds(expectedDataset.cashbookEntries);
  const expectedProducts = deduplicateExpectedIds(expectedDataset.products);
  const expectedStockAdj = deduplicateExpectedIds(expectedDataset.stockAdjustments);
  const expectedAuditLogs = deduplicateExpectedIds(expectedDataset.auditLogs);
  const expectedRecurring = deduplicateExpectedIds(expectedDataset.recurringExpenses);
  const expectedWaBatches = deduplicateExpectedIds(expectedDataset.whatsappBatches);
  const expectedWaLogs = deduplicateExpectedIds(expectedDataset.whatsappAuditLogs);

  const expectedCounts = {
    customers: expectedCustomers.length,
    customerTransactions: expectedCustomerTx.length,
    suppliers: expectedSuppliers.length,
    supplierTransactions: expectedSupplierTx.length,
    sales: expectedSales.length,
    expenses: expectedExpenses.length,
    cashbookEntries: expectedCashbook.length,
    products: expectedProducts.length,
    stockAdjustments: expectedStockAdj.length,
    billDocuments: expectedDocMap.size,
    auditLogs: expectedAuditLogs.length,
  };

  const readBackDocs = readBack.billDocuments || [];
  const actualCounts = {
    customers: deduplicateExpectedIds(readBack.customers).length,
    customerTransactions: deduplicateExpectedIds(readBack.customerTransactions).length,
    suppliers: deduplicateExpectedIds(readBack.suppliers).length,
    supplierTransactions: deduplicateExpectedIds(readBack.supplierTransactions).length,
    sales: deduplicateExpectedIds(readBack.sales).length,
    expenses: deduplicateExpectedIds(readBack.expenses).length,
    cashbookEntries: deduplicateExpectedIds(readBack.cashbookEntries).length,
    products: deduplicateExpectedIds(readBack.products).length,
    stockAdjustments: deduplicateExpectedIds(readBack.stockAdjustments).length,
    billDocuments: readBackDocs.length,
    auditLogs: deduplicateExpectedIds(readBack.auditLogs).length,
  };

  const mismatches: string[] = [];

  if (readBack.profile.storeName !== expectedDataset.profile.storeName) {
    mismatches.push(
      `profile.storeName (expected "${expectedDataset.profile.storeName}", got "${readBack.profile.storeName}")`
    );
  }

  const verifyCollection = (
    label: string,
    expectedItems: Array<{ id: string }>,
    actualItems: Array<{ id: string }> | undefined
  ) => {
    const dedupActual = deduplicateExpectedIds(actualItems);
    if (dedupActual.length !== expectedItems.length) {
      mismatches.push(`${label} (expected ${expectedItems.length}, got ${dedupActual.length})`);
      return;
    }
    const actualIdSet = new Set(dedupActual.map((item) => item.id));
    const missingIds = expectedItems.filter((item) => !actualIdSet.has(item.id)).map((item) => item.id);
    if (missingIds.length > 0) {
      mismatches.push(`${label} missing expected record IDs (${missingIds.slice(0, 3).join(', ')})`);
    }
  };

  verifyCollection('customers', expectedCustomers, readBack.customers);
  verifyCollection('customerTransactions', expectedCustomerTx, readBack.customerTransactions);
  verifyCollection('suppliers', expectedSuppliers, readBack.suppliers);
  verifyCollection('supplierTransactions', expectedSupplierTx, readBack.supplierTransactions);
  verifyCollection('sales', expectedSales, readBack.sales);
  verifyCollection('expenses', expectedExpenses, readBack.expenses);
  verifyCollection('cashbookEntries', expectedCashbook, readBack.cashbookEntries);
  verifyCollection('products', expectedProducts, readBack.products);
  verifyCollection('stockAdjustments', expectedStockAdj, readBack.stockAdjustments);
  verifyCollection('auditLogs', expectedAuditLogs, readBack.auditLogs);
  verifyCollection('whatsappBatches', expectedWaBatches, readBack.whatsappBatches);
  verifyCollection('whatsappAuditLogs', expectedWaLogs, readBack.whatsappAuditLogs);
  if (expectedDataset.recurringExpenses !== undefined) {
    verifyCollection('recurringExpenses', expectedRecurring, readBack.recurringExpenses);
  }

  if (expectedDataset.billDocuments === undefined) {
    if (actualCounts.billDocuments < expectedCounts.billDocuments) {
      mismatches.push(
        `billDocuments (expected at least ${expectedCounts.billDocuments}, got ${actualCounts.billDocuments})`
      );
    }
  } else if (actualCounts.billDocuments !== expectedCounts.billDocuments) {
    mismatches.push(
      `billDocuments (expected ${expectedCounts.billDocuments}, got ${actualCounts.billDocuments})`
    );
  }

  const readBackDocMap = new Map(readBackDocs.map((d) => [d.id, d]));
  const missingDocIds: string[] = [];
  const unhydratedDocIds: string[] = [];
  for (const docId of expectedDocMap.keys()) {
    const foundDoc = readBackDocMap.get(docId);
    if (!foundDoc) {
      missingDocIds.push(docId);
    } else if (!foundDoc.dataUrl || foundDoc.dataUrl.trim().length === 0) {
      unhydratedDocIds.push(docId);
    }
  }
  if (missingDocIds.length > 0) {
    mismatches.push(`missing bill documents (${missingDocIds.slice(0, 3).join(', ')})`);
  }
  if (unhydratedDocIds.length > 0) {
    mismatches.push(
      `hydrated bill documents (unhydrated IDs: ${unhydratedDocIds.slice(0, 3).join(', ')})`
    );
  }

  if (expectedDataset.lastClosedDate !== undefined) {
    const expectedClosed = expectedDataset.lastClosedDate ?? null;
    const actualClosed = readBack.lastClosedDate ?? null;
    if (actualClosed !== expectedClosed) {
      mismatches.push(`lastClosedDate (expected ${String(expectedClosed)}, got ${String(actualClosed)})`);
    }
  }

  if (expectedDataset.dailySalesTarget !== undefined) {
    const expectedTargetAmt = expectedDataset.dailySalesTarget?.amount ?? null;
    const actualTargetAmt = readBack.dailySalesTarget?.amount ?? null;
    if (actualTargetAmt !== expectedTargetAmt) {
      mismatches.push(
        `dailySalesTarget (expected ${String(expectedTargetAmt)}, got ${String(actualTargetAmt)})`
      );
    }
  }

  if (expectedDataset.productCategories !== undefined) {
    const expectedCatLen = expectedDataset.productCategories.length;
    const actualCatLen = readBack.productCategories?.length ?? 0;
    if (actualCatLen !== expectedCatLen) {
      mismatches.push(`productCategories (expected ${expectedCatLen}, got ${actualCatLen})`);
    }
  }

  if (expectedDataset.expenseCategories !== undefined) {
    const expectedExpCatLen = expectedDataset.expenseCategories.length;
    const actualExpCatLen = readBack.expenseCategories?.length ?? 0;
    if (actualExpCatLen !== expectedExpCatLen) {
      mismatches.push(`expenseCategories (expected ${expectedExpCatLen}, got ${actualExpCatLen})`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Post-${context} verification mismatch: ${mismatches.join(', ')}`);
  }

  const hydratedDataset: StoreBusinessDataset = {
    ...expectedDataset,
    ...readBack,
    profile: readBack.profile,
    customers: readBack.customers || expectedDataset.customers,
    customerTransactions:
      readBack.customerTransactions || expectedDataset.customerTransactions,
    suppliers: readBack.suppliers || expectedDataset.suppliers,
    supplierTransactions:
      readBack.supplierTransactions || expectedDataset.supplierTransactions,
    sales: readBack.sales || expectedDataset.sales,
    expenses: readBack.expenses || expectedDataset.expenses,
    cashbookEntries: readBack.cashbookEntries || expectedDataset.cashbookEntries,
    products: readBack.products || expectedDataset.products,
    productCategories:
      readBack.productCategories !== undefined
        ? readBack.productCategories
        : expectedDataset.productCategories || [],
    expenseCategories:
      readBack.expenseCategories !== undefined
        ? readBack.expenseCategories
        : expectedDataset.expenseCategories || [],
    stockAdjustments: readBack.stockAdjustments || expectedDataset.stockAdjustments,
    auditLogs: readBack.auditLogs || expectedDataset.auditLogs,
    billDocuments: readBackDocs,
    recurringExpenses: readBack.recurringExpenses || expectedDataset.recurringExpenses || [],
    dailySalesTarget:
      readBack.dailySalesTarget !== undefined
        ? readBack.dailySalesTarget
        : expectedDataset.dailySalesTarget ?? null,
    lastClosedDate:
      readBack.lastClosedDate !== undefined
        ? readBack.lastClosedDate
        : expectedDataset.lastClosedDate ?? null,
    whatsappBatches: readBack.whatsappBatches || expectedDataset.whatsappBatches,
    whatsappAuditLogs: readBack.whatsappAuditLogs || expectedDataset.whatsappAuditLogs,
  };

  return {
    verifiedCounts: {
      verified: true,
      ...actualCounts,
    },
    hydratedDataset,
  };
}

/**
 * Restores a validated plain or encrypted backup into IndexedDB with:
 * - Storage quota pre-check before touching data,
 * - Protected PRE_RESTORE rollback checkpoint in `RECOVERY` bucket,
 * - Pre-recalculation Financial Reconciliation Report,
 * - Opening-balance + transaction-derived ledger recalculation,
 * - Full `billDocuments`, `recurringExpenses`, `dailySalesTarget`, `lastClosedDate` reconstruction,
 * - Strict read-back verification of every restored collection count & attachment hydration,
 * - Verified automatic rollback on any write or verification mismatch, and explicit critical recovery
 *   failure reporting (never claiming safe rollback) if rollback itself fails.
 */
export async function restoreBackupSafelyWithRollback(
  db: LocalDbAdapter,
  currentDataset: StoreBusinessDataset,
  contentStr: string,
  passphrase?: string
): Promise<RestoreBackupResult> {
  const inspected = await inspectAndValidateBackupContent(contentStr, passphrase);
  if (!inspected.valid || !inspected.data) {
    return {
      success: false,
      requiresPassphrase: inspected.requiresPassphrase,
      error: inspected.error || 'Backup validation failed',
    };
  }

  // Pre-check available device storage when quota telemetry is supported
  try {
    const quota = await requestAndCheckStorageQuota();
    if (quota.quotaBytes > 0) {
      const remainingBytes = Math.max(0, quota.quotaBytes - quota.usageBytes);
      const estimatedPayloadBytes =
        typeof Blob !== 'undefined' ? new Blob([contentStr]).size : contentStr.length;
      const requiredBytes = Math.max(estimatedPayloadBytes * 2, 128 * 1024);
      if (remainingBytes < requiredBytes) {
        return {
          success: false,
          error:
            'Insufficient browser storage space to create a protected pre-restore snapshot and restore this backup safely. Please clear browser cache/unused files on your phone and retry.',
        };
      }
    }
  } catch {
    // Non-fatal if storage estimate API is restricted
  }

  const rawCandidate: StoreBusinessDataset = {
    profile: inspected.data.profile,
    customers: inspected.data.customers || [],
    customerTransactions: inspected.data.customerTransactions || [],
    suppliers: inspected.data.suppliers || [],
    supplierTransactions: inspected.data.supplierTransactions || [],
    sales: inspected.data.sales || [],
    expenses: inspected.data.expenses || [],
    cashbookEntries: inspected.data.cashbookEntries || [],
    products: inspected.data.products || [],
    productCategories:
      inspected.data.productCategories !== undefined
        ? inspected.data.productCategories
        : currentDataset.productCategories || [],
    expenseCategories:
      inspected.data.expenseCategories !== undefined
        ? inspected.data.expenseCategories
        : currentDataset.expenseCategories || [],
    stockAdjustments: inspected.data.stockAdjustments || [],
    auditLogs: inspected.data.auditLogs || [],
    billDocuments: inspected.data.billDocuments || [],
    recurringExpenses: inspected.data.recurringExpenses || [],
    dailySalesTarget:
      inspected.data.dailySalesTarget !== undefined
        ? inspected.data.dailySalesTarget
        : currentDataset.dailySalesTarget ?? null,
    lastClosedDate:
      inspected.data.lastClosedDate !== undefined
        ? inspected.data.lastClosedDate
        : currentDataset.lastClosedDate ?? null,
    whatsappBatches: inspected.data.whatsappBatches || [],
    whatsappAuditLogs: inspected.data.whatsappAuditLogs || [],
  };

  const reconciliationReport =
    inspected.reconciliationReport || generateBackupReconciliationReport(rawCandidate);

  let rollbackSnapshot: LocalBackupSnapshot;
  try {
    rollbackSnapshot = await createLocalBackupSnapshot(
      db,
      currentDataset,
      'PRE_RESTORE',
      'Protected automatic safety checkpoint prior to restore'
    );
  } catch (snapshotErr: unknown) {
    const formattedSnap = formatStorageError(snapshotErr, 'create pre-restore safety snapshot');
    return {
      success: false,
      rollbackSucceeded: false,
      preRestoreSnapshotPreserved: false,
      error: `Could not create pre-restore safety snapshot (${formattedSnap.message}). Existing shop data was not modified.`,
      reconciliationReport,
    };
  }

  const verifiedSnapshotRecord = await db
    .getByKey<LocalBackupSnapshot>(STORE_NAMES.LOCAL_BACKUPS, rollbackSnapshot.id)
    .catch(() => null);

  if (
    !rollbackSnapshot.id ||
    !rollbackSnapshot.checksum ||
    !verifiedSnapshotRecord ||
    verifiedSnapshotRecord.checksum !== rollbackSnapshot.checksum
  ) {
    return {
      success: false,
      rollbackSucceeded: false,
      preRestoreSnapshotPreserved: Boolean(verifiedSnapshotRecord),
      rollbackCheckpointId: rollbackSnapshot.id || undefined,
      error: 'Could not verify pre-restore safety checkpoint. Existing shop data was not modified.',
      reconciliationReport,
    };
  }

  const candidateDataset: StoreBusinessDataset = recalculateLedgerBalancesFromHistory(rawCandidate);

  try {
    await db.commitBusinessDatasetAtomic(candidateDataset);
    const { verifiedCounts, hydratedDataset } = await verifyDatasetReadBack(
      db,
      candidateDataset,
      'restore'
    );

    return {
      success: true,
      warnings: inspected.warnings,
      restoredDataset: hydratedDataset,
      summary: inspected.summary,
      reconciliationReport,
      rollbackCheckpointId: rollbackSnapshot.id,
      preRestoreSnapshotPreserved: true,
      verifiedCounts,
    };
  } catch (restoreErr: unknown) {
    const restoreErrorMessage = formatStorageError(
      restoreErr,
      'restore backup atomically'
    ).message;

    let rollbackSucceeded = false;
    let rollbackErrorMessage: string | undefined;

    try {
      await db.commitBusinessDatasetAtomic(currentDataset);
      await verifyDatasetReadBack(db, currentDataset, 'rollback');
      rollbackSucceeded = true;
    } catch (rollbackErr: unknown) {
      rollbackSucceeded = false;
      rollbackErrorMessage = formatStorageError(
        rollbackErr,
        'roll back to pre-restore shop data'
      ).message;
    }

    const snapshotAfterFailure = await db
      .getByKey<LocalBackupSnapshot>(STORE_NAMES.LOCAL_BACKUPS, rollbackSnapshot.id)
      .catch(() => null);
    const preRestoreSnapshotPreserved = Boolean(
      snapshotAfterFailure && snapshotAfterFailure.checksum === rollbackSnapshot.checksum
    );

    if (rollbackSucceeded) {
      return {
        success: false,
        rollbackSucceeded: true,
        criticalRecoveryFailure: false,
        restoreError: restoreErrorMessage,
        preRestoreSnapshotPreserved,
        error: `Atomic restore failed verification and rolled back safely (verified against checkpoint ${rollbackSnapshot.id}): ${restoreErrorMessage}`,
        rollbackCheckpointId: rollbackSnapshot.id,
        reconciliationReport,
      };
    }

    throw new CriticalRestoreRollbackError({
      restoreError: restoreErrorMessage,
      rollbackError: rollbackErrorMessage || 'Rollback verification failed.',
      rollbackCheckpointId: rollbackSnapshot.id,
      preRestoreSnapshotPreserved,
      reconciliationReport,
    });
  }
}

export type BackupExportMethod = 'file_picker' | 'share_sheet' | 'download_queued';

/**
 * Exports a backup file safely for desktop & Android Chrome:
 * 1. Opens Android Share Sheet ONLY when `preferShareSheet: true` is explicitly requested.
 * 2. Tries File System Access API (`showSaveFilePicker`) on desktop browsers when supported & allowed.
 * 3. Falls back to verified `<a download>` with a safe 60,000ms URL revocation delay and byte-size verification so Android Chrome DownloadManager never aborts large backup transfers.
 */
export async function exportBackupFileWithPickerFallback(
  contentString: string,
  suggestedFilename: string,
  options?: { preferShareSheet?: boolean }
): Promise<{ savedVia: BackupExportMethod; cancelled?: boolean; byteSize?: number; fileName?: string }> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const expectedBytes =
    typeof Blob !== 'undefined'
      ? new Blob([contentString], { type: 'application/json;charset=utf-8' }).size
      : contentString.length;

  const tryShareSheet = async (): Promise<{
    savedVia: BackupExportMethod;
    cancelled?: boolean;
    byteSize?: number;
    fileName?: string;
  } | null> => {
    if (
      nav &&
      typeof nav.share === 'function' &&
      typeof nav.canShare === 'function' &&
      typeof File !== 'undefined'
    ) {
      try {
        const file = new File([contentString], suggestedFilename, {
          type: 'application/json',
        });
        if (nav.canShare({ files: [file] })) {
          await nav.share({
            files: [file],
            title: 'Arjun Groceries Backup',
            text: `Local store backup (${suggestedFilename})`,
          });
          return { savedVia: 'share_sheet', byteSize: file.size, fileName: suggestedFilename };
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
          return { savedVia: 'share_sheet', cancelled: true };
        }
      }
    }
    return null;
  };

  if (options?.preferShareSheet) {
    const shareRes = await tryShareSheet();
    if (shareRes) return shareRes;
  }

  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (win && typeof win.showSaveFilePicker === 'function') {
    try {
      const picker = win.showSaveFilePicker as (opts: unknown) => Promise<{
        createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
      }>;
      const handle = await picker({
        suggestedName: suggestedFilename,
        types: [
          {
            description: 'Arjun Groceries Backup File',
            accept: { 'application/json': ['.json', '.skbackup.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(contentString);
      await writable.close();
      return { savedVia: 'file_picker', byteSize: expectedBytes, fileName: suggestedFilename };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
        return { savedVia: 'file_picker', cancelled: true };
      }
      // In cross-origin iframes or Android Chrome where showSaveFilePicker is unsupported/blocked, continue download fallback
    }
  }

  const downloaded = triggerVerifiedBlobDownload(
    contentString,
    suggestedFilename,
    'application/json;charset=utf-8',
    { expectedBytes }
  );
  return {
    savedVia: 'download_queued',
    byteSize: downloaded.byteSize,
    fileName: downloaded.fileName,
  };
}

/**
 * Exports a binary file (PDF or Excel .xlsx) safely for desktop & Android Chrome:
 * 1. Tries Android Share Sheet ONLY if `preferShareSheet` is requested.
 * 2. Tries File System Access API (`showSaveFilePicker`) when supported & allowed.
 * 3. Falls back to verified `<a download>` with a 60,000ms URL revocation delay and exact byte-size check.
 */
export async function exportBinaryFileWithPickerFallback(
  bytes: Uint8Array,
  suggestedFilename: string,
  options: {
    mimeType: string;
    description: string;
    extensions: string[];
    title?: string;
    preferShareSheet?: boolean;
  }
): Promise<{ savedVia: BackupExportMethod; cancelled?: boolean; byteSize?: number; fileName?: string }> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const expectedBytes = bytes.byteLength;
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;

  const tryShareSheet = async (): Promise<{
    savedVia: BackupExportMethod;
    cancelled?: boolean;
    byteSize?: number;
    fileName?: string;
  } | null> => {
    if (
      nav &&
      typeof nav.share === 'function' &&
      typeof nav.canShare === 'function' &&
      typeof File !== 'undefined'
    ) {
      try {
        const file = new File([arrayBuffer], suggestedFilename, {
          type: options.mimeType,
        });
        if (nav.canShare({ files: [file] })) {
          await nav.share({
            files: [file],
            title: options.title || 'Arjun Groceries Report',
            text: `Arjun Groceries export (${suggestedFilename})`,
          });
          return { savedVia: 'share_sheet', byteSize: file.size, fileName: suggestedFilename };
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
          return { savedVia: 'share_sheet', cancelled: true };
        }
      }
    }
    return null;
  };

  if (options.preferShareSheet) {
    const shareRes = await tryShareSheet();
    if (shareRes) return shareRes;
  }

  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (win && typeof win.showSaveFilePicker === 'function') {
    try {
      const picker = win.showSaveFilePicker as (opts: unknown) => Promise<{
        createWritable(): Promise<{ write(data: Blob | ArrayBuffer): Promise<void>; close(): Promise<void> }>;
      }>;
      const handle = await picker({
        suggestedName: suggestedFilename,
        types: [
          {
            description: options.description,
            accept: { [options.mimeType]: options.extensions },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([arrayBuffer], { type: options.mimeType }));
      await writable.close();
      return { savedVia: 'file_picker', byteSize: expectedBytes, fileName: suggestedFilename };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
        return { savedVia: 'file_picker', cancelled: true };
      }
      // Continue download fallback if picker is unsupported/blocked
    }
  }

  const downloaded = triggerVerifiedBlobDownload(
    arrayBuffer,
    suggestedFilename,
    options.mimeType,
    { expectedBytes }
  );

  return {
    savedVia: 'download_queued',
    byteSize: downloaded.byteSize,
    fileName: downloaded.fileName,
  };
}
