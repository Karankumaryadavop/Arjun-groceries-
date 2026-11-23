/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  StorageMode,
  SyncConflictRecord,
  SyncQueueItem,
} from '../types';
import {
  LocalDbAdapter,
  listSyncConflicts,
  listSyncQueueItems,
  STORE_NAMES,
} from './localDatabase';

export interface CloudTransportAdapter {
  readonly isConfigured: boolean;
  pushRecord(item: SyncQueueItem, payload: unknown): Promise<{
    ok: boolean;
    conflict?: {
      remoteUpdatedAt: string;
      remoteSnapshot: Record<string, unknown>;
      entityLabel: string;
    };
    error?: string;
  }>;
}

/**
 * Default local-only transport when optional Firebase Cloud Sync is not provisioned/enabled.
 * Never throws or destroys local business data.
 */
export const localOnlyTransportAdapter: CloudTransportAdapter = {
  isConfigured: false,
  async pushRecord() {
    return {
      ok: false,
      error: 'Cloud Sync is not provisioned yet. Records remain safely stored in local IndexedDB.',
    };
  },
};

/**
 * Pure conflict detector: flags a conflict if remote record was modified AFTER local base update
 * and their payloads differ. Never silently overwrites newer records.
 */
export function detectSyncConflict(params: {
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  lastSyncedAt?: string;
  localPayloadHash: string;
  remotePayloadHash: string;
}): boolean {
  if (params.localPayloadHash === params.remotePayloadHash) {
    return false;
  }
  const remoteTs = new Date(params.remoteUpdatedAt).getTime();
  const localTs = new Date(params.localUpdatedAt).getTime();
  const lastSyncTs = params.lastSyncedAt ? new Date(params.lastSyncedAt).getTime() : 0;

  // Conflict if remote changed after our last successful sync and differs from local
  return Number.isFinite(remoteTs) && remoteTs > lastSyncTs && remoteTs !== localTs;
}

/**
 * Processes pending / retryable sync queue items safely when Cloud Sync is enabled and online.
 * Preserves local data intact if cloud push fails or detects a conflict.
 */
export async function processSyncQueue(
  db: LocalDbAdapter,
  options: {
    storageMode: StorageMode;
    isOnline: boolean;
    transport?: CloudTransportAdapter;
    resolvePayload: (item: SyncQueueItem) => unknown;
  }
): Promise<{
  processed: number;
  synced: number;
  failed: number;
  conflicts: number;
  skippedReason?: string;
}> {
  const transport = options.transport || localOnlyTransportAdapter;

  if (options.storageMode !== 'CLOUD_SYNC_ENABLED') {
    return {
      processed: 0,
      synced: 0,
      failed: 0,
      conflicts: 0,
      skippedReason: 'Storage mode is Local Only',
    };
  }

  if (!options.isOnline) {
    return {
      processed: 0,
      synced: 0,
      failed: 0,
      conflicts: 0,
      skippedReason: 'Device is offline; mutations remain queued locally',
    };
  }

  if (!transport.isConfigured) {
    return {
      processed: 0,
      synced: 0,
      failed: 0,
      conflicts: 0,
      skippedReason: 'Cloud Sync provider is not configured on this build',
    };
  }

  const queue = await listSyncQueueItems(db);
  const actionable = queue.filter(
    (q) => (q.status === 'PENDING' || q.status === 'FAILED') && q.attempts < q.maxAttempts
  );

  let synced = 0;
  let failed = 0;
  let conflicts = 0;

  for (const item of actionable) {
    const payload = options.resolvePayload(item);
    const res = await transport.pushRecord(item, payload);

    if (res.ok) {
      const syncedItem: SyncQueueItem = {
        ...item,
        status: 'SYNCED',
        attempts: item.attempts + 1,
        syncedAt: new Date().toISOString(),
        lastError: undefined,
      };
      await db.putOne(STORE_NAMES.SYNC_QUEUE, syncedItem);
      synced++;
    } else if (res.conflict) {
      const conflictRecord: SyncConflictRecord = {
        id: `conflict-${item.entityType.toLowerCase()}-${item.entityId}`,
        entityType: item.entityType,
        entityId: item.entityId,
        entityLabel: res.conflict.entityLabel,
        localUpdatedAt: item.localUpdatedAt,
        remoteUpdatedAt: res.conflict.remoteUpdatedAt,
        localSnapshot: (payload && typeof payload === 'object' ? payload : { value: payload }) as Record<
          string,
          unknown
        >,
        remoteSnapshot: res.conflict.remoteSnapshot,
        detectedAt: new Date().toISOString(),
        resolved: false,
      };
      await db.putOne(STORE_NAMES.SYNC_CONFLICTS, conflictRecord);
      await db.putOne(STORE_NAMES.SYNC_QUEUE, {
        ...item,
        status: 'CONFLICT',
        attempts: item.attempts + 1,
        lastError: 'Version conflict detected; awaiting manual resolution',
      } satisfies SyncQueueItem);
      conflicts++;
    } else {
      await db.putOne(STORE_NAMES.SYNC_QUEUE, {
        ...item,
        status: 'FAILED',
        attempts: item.attempts + 1,
        lastError: res.error || 'Sync failed',
      } satisfies SyncQueueItem);
      failed++;
    }
  }

  if (synced > 0) {
    await db.setMeta('lastSyncAt', new Date().toISOString());
  }

  return {
    processed: actionable.length,
    synced,
    failed,
    conflicts,
  };
}

export async function resolveConflictItem(
  db: LocalDbAdapter,
  conflictId: string,
  resolution: 'KEEP_LOCAL' | 'KEEP_REMOTE'
): Promise<SyncConflictRecord | null> {
  const existing = await db.getByKey<SyncConflictRecord>(STORE_NAMES.SYNC_CONFLICTS, conflictId);
  if (!existing) return null;

  const updated: SyncConflictRecord = {
    ...existing,
    resolved: true,
    resolution,
    resolvedAt: new Date().toISOString(),
  };
  await db.putOne(STORE_NAMES.SYNC_CONFLICTS, updated);

  // Re-queue or mark synced in syncQueue
  const queue = await listSyncQueueItems(db);
  for (const q of queue) {
    if (q.entityType === existing.entityType && q.entityId === existing.entityId && q.status === 'CONFLICT') {
      await db.putOne(STORE_NAMES.SYNC_QUEUE, {
        ...q,
        status: resolution === 'KEEP_LOCAL' ? 'PENDING' : 'SYNCED',
        lastError: undefined,
        syncedAt: resolution === 'KEEP_REMOTE' ? new Date().toISOString() : undefined,
      } satisfies SyncQueueItem);
    }
  }

  return updated;
}

export async function getSyncCounters(db: LocalDbAdapter): Promise<{
  pendingSyncCount: number;
  failedSyncCount: number;
  conflictCount: number;
}> {
  const [queue, conflicts] = await Promise.all([
    listSyncQueueItems(db),
    listSyncConflicts(db),
  ]);
  return {
    pendingSyncCount: queue.filter((q) => q.status === 'PENDING').length,
    failedSyncCount: queue.filter((q) => q.status === 'FAILED').length,
    conflictCount: conflicts.filter((c) => !c.resolved).length,
  };
}
