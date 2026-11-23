/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  deleteObject,
  FirebaseStorage,
  getBytes,
  getMetadata,
  listAll,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import {
  CloudAuthUser,
  CloudBackupBucket,
  CloudBackupConfig,
  CloudBackupRemoteEntry,
  CloudBackupStatus,
  StoreBusinessDataset,
} from '../types';
import {
  buildEncryptedCloudBackupPayload,
  computeBytesSha256Hex,
  decryptAndInspectCloudBackup,
} from './cloudBackupCrypto';
import {
  InspectedBackupResult,
  RestoreBackupResult,
  restoreBackupSafelyWithRollback,
} from './localBackupManager';
import { LocalDbAdapter } from './localDatabase';

export const DEFAULT_CLOUD_BACKUP_CONFIG: CloudBackupConfig = {
  autoDailyEnabled: true,
  dailyRetentionCount: 7,
  weeklyRetentionCount: 4,
  manualRetentionCount: 5,
};

export const DEFAULT_CLOUD_BACKUP_STATUS: CloudBackupStatus = {
  state: 'IDLE',
};

const AUTO_DAILY_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

export class CloudBackupOwnerMismatchError extends Error {
  readonly code = 'CLOUD_OWNER_MISMATCH' as const;
  readonly expectedUid: string;
  readonly actualUid: string;

  constructor(expectedUid: string, actualUid: string, expectedEmail?: string | null) {
    const emailLabel = expectedEmail ? ` (${expectedEmail})` : '';
    super(
      `Signed-in Google account does not match the bound store owner${emailLabel}. Switch back to the owner Google account or explicitly confirm switching backup accounts.`
    );
    this.name = 'CloudBackupOwnerMismatchError';
    this.expectedUid = expectedUid;
    this.actualUid = actualUid;
  }
}

/**
 * Formats a calendar date `YYYY-MM-DD` strictly in India Standard Time (`Asia/Kolkata`).
 */
export function getIstDateKey(date: Date = new Date()): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      return formatted;
    }
  } catch {
    // Fallback below if ICU timezone data unavailable
  }
  const istMs = date.getTime() + 330 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

/**
 * Computes the ISO-8601 week key (`YYYY-Www`) anchored to the IST calendar date.
 */
export function getIstIsoWeekKey(date: Date = new Date()): string {
  const istDateKey = getIstDateKey(date);
  const [year, month, day] = istDateKey.split('-').map((n) => Number(n));
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getIstTimeCompact(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    return `${getPart('hour')}${getPart('minute')}${getPart('second')}`;
  } catch {
    const istMs = date.getTime() + 330 * 60 * 1000;
    return new Date(istMs).toISOString().slice(11, 19).replace(/:/g, '');
  }
}

function generateUniqueBackupId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    if (typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }
    if (typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(6);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 12);
}

export function buildCloudBackupPath(
  uid: string,
  bucket: CloudBackupBucket,
  date: Date = new Date(),
  uniqueBackupId: string = generateUniqueBackupId()
): { fullPath: string; fileName: string; dateKey: string; backupId: string } {
  const cleanUid = uid.trim();
  if (!cleanUid) {
    throw new Error('Authenticated user UID is required for Cloud Storage path.');
  }
  const cleanId = uniqueBackupId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || generateUniqueBackupId();
  const stamp = getIstTimeCompact(date);

  if (bucket === 'weekly') {
    const weekKey = getIstIsoWeekKey(date);
    const fileName = `backup-${weekKey}-${stamp}-${cleanId}.skbackup.json`;
    return {
      fullPath: `users/${cleanUid}/backups/weekly/${fileName}`,
      fileName,
      dateKey: weekKey,
      backupId: cleanId,
    };
  }

  const istDate = getIstDateKey(date);
  const fileName = `backup-${istDate}-${stamp}-${cleanId}.skbackup.json`;
  return {
    fullPath: `users/${cleanUid}/backups/${bucket}/${fileName}`,
    fileName,
    dateKey: istDate,
    backupId: cleanId,
  };
}

export interface CloudStorageObjectSummary {
  fullPath: string;
  name: string;
  sizeBytes: number;
  updatedAt: string;
  customMetadata?: Record<string, string>;
}

export interface CloudBackupStorageTransport {
  uploadEncryptedObject(params: {
    path: string;
    bytes: Uint8Array;
    contentType: 'application/json';
    customMetadata: Record<string, string>;
  }): Promise<{ fullPath: string; sizeBytes: number }>;
  getObjectMetadata?(fullPath: string): Promise<CloudStorageObjectSummary | null>;
  listObjects(prefix: string): Promise<CloudStorageObjectSummary[]>;
  downloadObjectBytes(fullPath: string): Promise<{
    bytes: Uint8Array;
    customMetadata?: Record<string, string>;
  }>;
  deleteObject(fullPath: string): Promise<void>;
}

/**
 * Production Firebase Cloud Storage transport using the Web SDK (`firebase/storage`).
 * Uses resumable uploads and create-only collision checks so existing backups are never overwritten.
 */
export function createFirebaseCloudBackupTransport(
  storageInstance: FirebaseStorage
): CloudBackupStorageTransport {
  return {
    async uploadEncryptedObject(params) {
      const storageRef = ref(storageInstance, params.path);

      // Client-side immutability guard before upload (enforced server-side by storage.rules allow create / allow update: if false)
      try {
        await getMetadata(storageRef);
        throw new Error(`Immutable backup collision: refusing to overwrite existing cloud backup at ${params.path}.`);
      } catch (metaErr: unknown) {
        const code = (metaErr as { code?: string })?.code;
        if (code !== 'storage/object-not-found') {
          if (metaErr instanceof Error && metaErr.message.includes('Immutable backup collision')) {
            throw metaErr;
          }
          // Ignore non-not-found metadata read errors only if storage rules restrict preflight, upload will enforce create-only
        }
      }

      const task = uploadBytesResumable(storageRef, params.bytes, {
        contentType: params.contentType,
        customMetadata: params.customMetadata,
      });

      const snapshot = await new Promise<typeof task.snapshot>((resolve, reject) => {
        task.on(
          'state_changed',
          undefined,
          (error) => reject(error),
          () => resolve(task.snapshot)
        );
      });

      return {
        fullPath: snapshot.metadata.fullPath || params.path,
        sizeBytes: Number(snapshot.metadata.size) || params.bytes.byteLength,
      };
    },

    async getObjectMetadata(fullPath) {
      const itemRef = ref(storageInstance, fullPath);
      try {
        const meta = await getMetadata(itemRef);
        return {
          fullPath: meta.fullPath || itemRef.fullPath,
          name: itemRef.name,
          sizeBytes: Number(meta.size) || 0,
          updatedAt: meta.updated || meta.timeCreated || new Date().toISOString(),
          customMetadata: meta.customMetadata,
        };
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'storage/object-not-found') {
          return null;
        }
        throw err;
      }
    },

    async listObjects(prefix) {
      const folderRef = ref(storageInstance, prefix);
      const listed = await listAll(folderRef);
      const entries = await Promise.all(
        listed.items.map(async (itemRef) => {
          const meta = await getMetadata(itemRef);
          return {
            fullPath: itemRef.fullPath,
            name: itemRef.name,
            sizeBytes: Number(meta.size) || 0,
            updatedAt: meta.updated || meta.timeCreated || new Date().toISOString(),
            customMetadata: meta.customMetadata,
          } satisfies CloudStorageObjectSummary;
        })
      );
      return entries;
    },

    async downloadObjectBytes(fullPath) {
      const itemRef = ref(storageInstance, fullPath);
      const [meta, buffer] = await Promise.all([
        getMetadata(itemRef).catch(() => null),
        getBytes(itemRef),
      ]);
      return {
        bytes: new Uint8Array(buffer),
        customMetadata: meta?.customMetadata,
      };
    },

    async deleteObject(fullPath) {
      const itemRef = ref(storageInstance, fullPath);
      await deleteObject(itemRef);
    },
  };
}

/**
 * Deterministic in-memory Cloud Storage transport for unit/integration tests.
 * Enforces immutable create-only writes (throws if target path already exists).
 */
export function createMemoryCloudBackupTransport(): CloudBackupStorageTransport & {
  _objects: Map<string, { bytes: Uint8Array; updatedAt: string; customMetadata: Record<string, string> }>;
} {
  const objects = new Map<
    string,
    { bytes: Uint8Array; updatedAt: string; customMetadata: Record<string, string> }
  >();

  return {
    _objects: objects,

    async uploadEncryptedObject(params) {
      if (objects.has(params.path)) {
        throw new Error(
          `Immutable backup collision: refusing to overwrite existing cloud backup at ${params.path}.`
        );
      }
      const copy = new Uint8Array(params.bytes.byteLength);
      copy.set(params.bytes);
      const updatedAt = params.customMetadata.createdAt || new Date().toISOString();
      objects.set(params.path, {
        bytes: copy,
        updatedAt,
        customMetadata: { ...params.customMetadata },
      });
      return {
        fullPath: params.path,
        sizeBytes: copy.byteLength,
      };
    },

    async getObjectMetadata(fullPath) {
      const found = objects.get(fullPath);
      if (!found) return null;
      const parts = fullPath.split('/');
      return {
        fullPath,
        name: parts[parts.length - 1] || fullPath,
        sizeBytes: found.bytes.byteLength,
        updatedAt: found.updatedAt,
        customMetadata: { ...found.customMetadata },
      };
    },

    async listObjects(prefix) {
      const cleanPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
      const results: CloudStorageObjectSummary[] = [];
      for (const [path, val] of objects.entries()) {
        if (path.startsWith(cleanPrefix)) {
          const name = path.slice(cleanPrefix.length);
          if (!name.includes('/')) {
            results.push({
              fullPath: path,
              name,
              sizeBytes: val.bytes.byteLength,
              updatedAt: val.updatedAt,
              customMetadata: { ...val.customMetadata },
            });
          }
        }
      }
      return results;
    },

    async downloadObjectBytes(fullPath) {
      const found = objects.get(fullPath);
      if (!found) {
        throw new Error(`Cloud backup object not found: ${fullPath}`);
      }
      const copy = new Uint8Array(found.bytes.byteLength);
      copy.set(found.bytes);
      return {
        bytes: copy,
        customMetadata: { ...found.customMetadata },
      };
    },

    async deleteObject(fullPath) {
      objects.delete(fullPath);
    },
  };
}

export function validateAuthenticatedOwner(
  authUser: CloudAuthUser | null | undefined,
  config: CloudBackupConfig,
  options?: { allowRebindOwner?: boolean }
): CloudAuthUser {
  if (!authUser || !authUser.uid) {
    throw new Error('Sign in with Google first to use Encrypted Cloud Backup.');
  }
  if (!authUser.emailVerified) {
    throw new Error('Verified Google email is required for Encrypted Cloud Backup.');
  }
  if (
    config.boundOwnerUid &&
    config.boundOwnerUid !== authUser.uid &&
    !options?.allowRebindOwner
  ) {
    throw new CloudBackupOwnerMismatchError(
      config.boundOwnerUid,
      authUser.uid,
      config.boundOwnerEmail
    );
  }
  return authUser;
}

function extractDateKeyFromFileName(name: string, bucket: CloudBackupBucket): string {
  if (bucket === 'weekly') {
    const m = name.match(/backup-(\d{4}-W\d{2})/);
    if (m) return m[1];
  }
  const m = name.match(/backup-(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function toRemoteEntry(
  obj: CloudStorageObjectSummary,
  bucket: CloudBackupBucket
): CloudBackupRemoteEntry {
  const createdAt = obj.customMetadata?.createdAt || obj.updatedAt || new Date().toISOString();
  return {
    fullPath: obj.fullPath,
    name: obj.name,
    bucket,
    dateKey: extractDateKeyFromFileName(obj.name, bucket) || createdAt.slice(0, 10),
    createdAt,
    sizeBytes: obj.sizeBytes,
    ciphertextSha256: obj.customMetadata?.ciphertextSha256,
    format: obj.customMetadata?.format,
    schemaVersion: obj.customMetadata?.schemaVersion,
  };
}

/**
 * Lists all encrypted cloud snapshots for a single authenticated user UID across daily/weekly/manual buckets.
 */
export async function listUserCloudBackups(
  transport: CloudBackupStorageTransport,
  uid: string
): Promise<CloudBackupRemoteEntry[]> {
  const cleanUid = uid.trim();
  if (!cleanUid) return [];

  const buckets: CloudBackupBucket[] = ['daily', 'weekly', 'manual', 'pre-restore'];
  const allByBucket = await Promise.all(
    buckets.map(async (bucket) => {
      try {
        const objs = await transport.listObjects(`users/${cleanUid}/backups/${bucket}`);
        return objs
          .filter((o) => o.name.endsWith('.skbackup.json'))
          .map((o) => toRemoteEntry(o, bucket));
      } catch {
        return [] as CloudBackupRemoteEntry[];
      }
    })
  );

  return allByBucket
    .flat()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Pure retention calculator:
 * - Retains latest 7 automated daily and 4 automated weekly cloud snapshots
 * - Strictly preserves ALL manual and pre-restore backups (never auto-pruned)
 */
export function computeCloudRetentionPrunePaths(
  entries: CloudBackupRemoteEntry[],
  config: CloudBackupConfig = DEFAULT_CLOUD_BACKUP_CONFIG
): { keep: CloudBackupRemoteEntry[]; prunePaths: string[] } {
  const sortNewest = (list: CloudBackupRemoteEntry[]) =>
    [...list].sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.dateKey.localeCompare(a.dateKey);
    });

  const keepDaily = sortNewest(entries.filter((e) => e.bucket === 'daily')).slice(
    0,
    Math.max(1, config.dailyRetentionCount || 7)
  );
  const keepWeekly = sortNewest(entries.filter((e) => e.bucket === 'weekly')).slice(
    0,
    Math.max(1, config.weeklyRetentionCount || 4)
  );
  // Always preserve all manual and pre-restore snapshots
  const keepProtected = entries.filter(
    (e) => e.bucket === 'manual' || e.bucket === 'pre-restore'
  );

  const keptPaths = new Set(
    [...keepDaily, ...keepWeekly, ...keepProtected].map((e) => e.fullPath)
  );
  const keep = sortNewest(entries.filter((e) => keptPaths.has(e.fullPath)));
  const prunePaths = entries
    .filter(
      (e) =>
        !keptPaths.has(e.fullPath) &&
        e.bucket !== 'manual' &&
        e.bucket !== 'pre-restore'
    )
    .map((e) => e.fullPath);
  return { keep, prunePaths };
}

/**
 * Determines whether the daily IST encrypted cloud backup should run now.
 */
export function shouldRunDailyCloudBackup(params: {
  config: CloudBackupConfig;
  status: CloudBackupStatus;
  authUser: CloudAuthUser | null | undefined;
  sessionPassphrase: string | null | undefined;
  isOnline: boolean;
  now?: Date;
}): boolean {
  const { config, status, authUser, sessionPassphrase, isOnline } = params;
  const now = params.now || new Date();

  if (!config.autoDailyEnabled) return false;
  if (!isOnline) return false;
  if (!authUser?.uid || !authUser.emailVerified) return false;
  if (config.boundOwnerUid && config.boundOwnerUid !== authUser.uid) return false;
  if (!sessionPassphrase || sessionPassphrase.trim().length < 8) return false;
  if (status.state === 'UPLOADING' || status.state === 'RESTORING') return false;

  const todayIst = getIstDateKey(now);
  if (status.lastSuccessDateKeyIst === todayIst) {
    return false;
  }

  if (status.lastAttemptDateKeyIst === todayIst && status.lastAttemptAt) {
    const elapsedMs = now.getTime() - new Date(status.lastAttemptAt).getTime();
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < AUTO_DAILY_FAILURE_COOLDOWN_MS) {
      return false;
    }
  }

  return true;
}

export interface UploadCloudBackupResult {
  uploadedEntry: CloudBackupRemoteEntry;
  weeklyUploadedEntry?: CloudBackupRemoteEntry;
  prunedPaths: string[];
  status: CloudBackupStatus;
  plaintextChecksum: string;
}

export const MAX_CLOUD_BACKUP_BYTES = 50 * 1024 * 1024;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

function assertValidCloudIntegrityMetadata(
  customMetadata: Record<string, string> | undefined,
  expectedSha256?: string
): string {
  const format = customMetadata?.format?.trim();
  const cipher = customMetadata?.cipher?.trim();
  const sha = customMetadata?.ciphertextSha256?.trim().toLowerCase();

  if (format !== 'SKPRO_ENC_V1' || cipher !== 'AES-256-GCM') {
    throw new Error(
      'Cloud backup metadata verification failed: missing or invalid encryption format headers.'
    );
  }
  if (!sha || !SHA256_HEX_REGEX.test(sha)) {
    throw new Error(
      'Cloud backup metadata verification failed: missing or malformed ciphertextSha256 integrity hash.'
    );
  }
  if (expectedSha256 && sha !== expectedSha256.toLowerCase()) {
    throw new Error('Cloud backup metadata SHA-256 verification failed: SHA-256 mismatch detected.');
  }
  return sha;
}

async function verifyUploadedCloudObject(params: {
  transport: CloudBackupStorageTransport;
  fullPath: string;
  expectedSizeBytes: number;
  expectedCiphertextSha256: string;
}): Promise<void> {
  if (params.transport.getObjectMetadata) {
    const remoteMeta = await params.transport.getObjectMetadata(params.fullPath);
    if (!remoteMeta) {
      throw new Error(
        `Cloud backup verification failed: uploaded object missing at ${params.fullPath}.`
      );
    }
    if (remoteMeta.sizeBytes !== params.expectedSizeBytes) {
      throw new Error(
        `Cloud backup metadata size mismatch (expected ${params.expectedSizeBytes} bytes, got ${remoteMeta.sizeBytes}).`
      );
    }
    assertValidCloudIntegrityMetadata(remoteMeta.customMetadata, params.expectedCiphertextSha256);
  }

  const downloaded = await params.transport.downloadObjectBytes(params.fullPath);
  if (!downloaded.bytes || downloaded.bytes.byteLength !== params.expectedSizeBytes) {
    throw new Error(
      `Cloud backup read-back size mismatch (expected ${params.expectedSizeBytes} bytes, got ${downloaded.bytes?.byteLength ?? 0}).`
    );
  }
  const actualSha256 = await computeBytesSha256Hex(downloaded.bytes);
  if (actualSha256.toLowerCase() !== params.expectedCiphertextSha256.toLowerCase()) {
    throw new Error(
      'Cloud backup read-back ciphertext SHA-256 verification failed. Retention pruning aborted.'
    );
  }
  assertValidCloudIntegrityMetadata(downloaded.customMetadata, params.expectedCiphertextSha256);
}

/**
 * Encrypts the consolidated local dataset in memory, uploads an immutable object to Firebase Cloud Storage
 * under `users/{uid}/backups/{daily|weekly|manual|pre-restore}/...`, verifies remote metadata and
 * ciphertext SHA-256 read-back, creates a weekly IST backup if missing, and prunes expired daily/weekly
 * snapshots strictly ONLY after all uploads and verifications succeed. Manual & pre-restore backups are preserved.
 */
export async function uploadEncryptedCloudBackup(params: {
  transport: CloudBackupStorageTransport;
  authUser: CloudAuthUser | null | undefined;
  config: CloudBackupConfig;
  dataset: StoreBusinessDataset;
  passphrase: string;
  bucket?: 'daily' | 'manual' | 'pre-restore';
  isOnline?: boolean;
  now?: Date;
  allowRebindOwner?: boolean;
}): Promise<UploadCloudBackupResult> {
  const now = params.now || new Date();
  const isOnline = params.isOnline !== undefined ? params.isOnline : true;
  const bucket = params.bucket || 'daily';

  const owner = validateAuthenticatedOwner(params.authUser, params.config, {
    allowRebindOwner: params.allowRebindOwner,
  });

  if (!isOnline) {
    throw new Error('Device is offline. Local IndexedDB changes remain safe; Cloud Backup will retry when online.');
  }

  const createdAtIso = now.toISOString();
  const istDateKey = getIstDateKey(now);
  const built = await buildEncryptedCloudBackupPayload(params.dataset, params.passphrase, {
    createdAt: createdAtIso,
  });

  if (built.sizeBytes > MAX_CLOUD_BACKUP_BYTES) {
    throw new Error(
      `Encrypted cloud backup exceeds the 50 MB Firebase Storage object limit (${(
        built.sizeBytes /
        (1024 * 1024)
      ).toFixed(1)} MB). Attached bill documents were NOT omitted; please export a local encrypted backup file instead.`
    );
  }

  const target = buildCloudBackupPath(owner.uid, bucket, now);
  const uploadRes = await params.transport.uploadEncryptedObject({
    path: target.fullPath,
    bytes: built.bytes,
    contentType: 'application/json',
    customMetadata: built.customMetadata,
  });

  if (!uploadRes.sizeBytes || uploadRes.sizeBytes !== built.sizeBytes) {
    throw new Error(
      `Cloud backup upload size mismatch (expected ${built.sizeBytes} bytes, got ${uploadRes.sizeBytes}).`
    );
  }

  // Mandatory post-upload metadata + SHA-256 read-back verification before any pruning occurs
  await verifyUploadedCloudObject({
    transport: params.transport,
    fullPath: uploadRes.fullPath,
    expectedSizeBytes: built.sizeBytes,
    expectedCiphertextSha256: built.ciphertextSha256,
  });

  const uploadedEntry: CloudBackupRemoteEntry = {
    fullPath: uploadRes.fullPath,
    name: target.fileName,
    bucket,
    dateKey: target.dateKey,
    createdAt: createdAtIso,
    sizeBytes: uploadRes.sizeBytes,
    ciphertextSha256: built.ciphertextSha256,
    format: built.customMetadata.format,
    schemaVersion: built.customMetadata.schemaVersion,
  };

  let weeklyUploadedEntry: CloudBackupRemoteEntry | undefined;
  const existingEntries = await listUserCloudBackups(params.transport, owner.uid);
  const istWeekKey = getIstIsoWeekKey(now);
  const hasThisWeekWeekly = existingEntries.some(
    (entry) => entry.bucket === 'weekly' && entry.dateKey === istWeekKey
  );

  if (!hasThisWeekWeekly && bucket !== 'pre-restore') {
    const weeklyTarget = buildCloudBackupPath(owner.uid, 'weekly', now);
    const weeklyRes = await params.transport.uploadEncryptedObject({
      path: weeklyTarget.fullPath,
      bytes: built.bytes,
      contentType: 'application/json',
      customMetadata: {
        ...built.customMetadata,
        weeklyKey: istWeekKey,
      },
    });
    if (!weeklyRes.sizeBytes || weeklyRes.sizeBytes !== built.sizeBytes) {
      throw new Error(
        `Weekly cloud backup upload size mismatch (expected ${built.sizeBytes} bytes, got ${weeklyRes.sizeBytes}).`
      );
    }

    await verifyUploadedCloudObject({
      transport: params.transport,
      fullPath: weeklyRes.fullPath,
      expectedSizeBytes: built.sizeBytes,
      expectedCiphertextSha256: built.ciphertextSha256,
    });

    weeklyUploadedEntry = {
      fullPath: weeklyRes.fullPath,
      name: weeklyTarget.fileName,
      bucket: 'weekly',
      dateKey: istWeekKey,
      createdAt: createdAtIso,
      sizeBytes: weeklyRes.sizeBytes,
      ciphertextSha256: built.ciphertextSha256,
      format: built.customMetadata.format,
      schemaVersion: built.customMetadata.schemaVersion,
    };
  }

  // Prune ONLY expired daily/weekly automated backups, strictly AFTER full verification succeeds
  const afterUploadEntries = await listUserCloudBackups(params.transport, owner.uid);
  const { prunePaths } = computeCloudRetentionPrunePaths(afterUploadEntries, params.config);
  const deletedPaths: string[] = [];
  for (const pathToDelete of prunePaths) {
    if (
      pathToDelete.includes('/backups/manual/') ||
      pathToDelete.includes('/backups/pre-restore/')
    ) {
      continue;
    }
    try {
      await params.transport.deleteObject(pathToDelete);
      deletedPaths.push(pathToDelete);
    } catch {
      // Non-fatal: retention pruning failure should never fail the verified backup upload
    }
  }

  const verifiedAtIso = new Date().toISOString();
  const status: CloudBackupStatus = {
    state: 'IDLE',
    lastAttemptAt: createdAtIso,
    lastAttemptDateKeyIst: istDateKey,
    lastSuccessAt: createdAtIso,
    lastSuccessDateKeyIst: istDateKey,
    lastSuccessBucket: bucket,
    lastUploadedPath: uploadRes.fullPath,
    lastUploadedBytes: uploadRes.sizeBytes,
    lastUploadedChecksum: built.ciphertextSha256,
    lastUploadedFileName: target.fileName,
    verificationStatus: 'VERIFIED',
    verifiedAt: verifiedAtIso,
    pendingDailyBackupIst: false,
    lastError: null,
  };

  return {
    uploadedEntry,
    weeklyUploadedEntry,
    prunedPaths: deletedPaths,
    status,
    plaintextChecksum: built.plaintextChecksum,
  };
}

export interface InspectedCloudDownloadResult {
  fullPath: string;
  rawEncryptedJson: string;
  sizeBytes: number;
  ciphertextSha256: string;
  inspected: InspectedBackupResult;
}

/**
 * Downloads an encrypted snapshot owned by `uid`, verifies ciphertext integrity if metadata hash
 * is present, decrypts with the user's recovery passphrase, and parses/reconciles for preview.
 */
export async function downloadAndInspectCloudBackup(params: {
  transport: CloudBackupStorageTransport;
  uid: string;
  fullPath: string;
  passphrase: string;
}): Promise<InspectedCloudDownloadResult> {
  const cleanUid = params.uid.trim();
  if (!cleanUid || !params.fullPath.startsWith(`users/${cleanUid}/backups/`)) {
    throw new Error('Access denied: requested cloud backup path does not belong to the signed-in owner.');
  }

  const { bytes, customMetadata } = await params.transport.downloadObjectBytes(params.fullPath);
  if (!bytes || bytes.byteLength === 0) {
    throw new Error('Downloaded cloud backup file is empty.');
  }

  const actualCipherSha256 = await computeBytesSha256Hex(bytes);
  assertValidCloudIntegrityMetadata(customMetadata, actualCipherSha256);

  const rawEncryptedJson = new TextDecoder().decode(bytes);
  const inspected = await decryptAndInspectCloudBackup(rawEncryptedJson, params.passphrase);
  if (!inspected.valid || !inspected.data) {
    throw new Error(inspected.error || 'Could not decrypt or validate the cloud backup archive.');
  }

  return {
    fullPath: params.fullPath,
    rawEncryptedJson,
    sizeBytes: bytes.byteLength,
    ciphertextSha256: actualCipherSha256,
    inspected,
  };
}

/**
 * Replacement-phone Disaster Recovery restore:
 * Downloads, verifies ciphertext SHA-256, decrypts AES-256-GCM, and hands off to Phase 1's
 * atomic verified rollback restore (`restoreBackupSafelyWithRollback`).
 */
export async function restoreCloudBackupSafely(params: {
  db: LocalDbAdapter;
  currentDataset: StoreBusinessDataset;
  transport: CloudBackupStorageTransport;
  authUser: CloudAuthUser | null | undefined;
  config: CloudBackupConfig;
  fullPath: string;
  passphrase: string;
  allowRebindOwner?: boolean;
}): Promise<RestoreBackupResult> {
  const owner = validateAuthenticatedOwner(params.authUser, params.config, {
    allowRebindOwner: params.allowRebindOwner,
  });

  const downloaded = await downloadAndInspectCloudBackup({
    transport: params.transport,
    uid: owner.uid,
    fullPath: params.fullPath,
    passphrase: params.passphrase,
  });

  return restoreBackupSafelyWithRollback(
    params.db,
    params.currentDataset,
    downloaded.rawEncryptedJson,
    params.passphrase
  );
}
