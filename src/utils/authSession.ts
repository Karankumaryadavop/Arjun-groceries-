/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PinSecurityRecord } from '../types';
import {
  base64ToBytes,
  bytesToBase64,
  canonicalJSONStringify,
} from './securityCrypto';
import { normalizeMobileDigits } from './loginValidation';

export const AUTH_SESSION_META_KEY = 'authSession';
export const AUTH_SESSION_KEY_META_KEY = 'authSessionKey';
export const DEFAULT_AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CLOCK_SKEW_MS = 60 * 1000; // 1 minute

export type StoreAuthMode = 'PIN' | 'GUEST' | 'CUSTOMER' | 'SUPPLIER';

export interface AuthSessionPayload {
  version: 1;
  sessionId: string;
  authMode: StoreAuthMode;
  mobile?: string;
  portalEntityId?: string;
  portalEntityName?: string;
  pinHashFingerprint?: string;
  issuedAt: number;
  expiresAt: number;
}

export interface PersistedAuthSessionRecord {
  payload: AuthSessionPayload;
  signatureBase64: string;
}

export type AuthSessionVerificationStatus =
  | 'VALID'
  | 'MISSING'
  | 'EXPIRED'
  | 'INVALID'
  | 'PIN_CHANGED'
  | 'LOCKED_GUEST_REJECTED';

export interface AuthSessionVerificationResult {
  status: AuthSessionVerificationStatus;
  session?: AuthSessionPayload;
  reason?: string;
}

export interface AuthNotice {
  type: 'expired' | 'error' | 'logged_out';
  message: string;
}

export type AuthLifecycleStatus =
  | 'auth-initializing'
  | 'authenticated'
  | 'unauthenticated';

export type AuthInitStage =
  | 'opening-database'
  | 'verifying-session'
  | 'syncing-auth-provider'
  | 'ready';

export interface AuthInitializationSignals {
  isDbOpened?: boolean;
  isDbHydrated: boolean;
  isStoreSessionChecked: boolean;
  isFirebaseAuthReady: boolean;
  hasVerifiedSession: boolean;
}

/**
 * Pure deterministic auth lifecycle state machine.
 * Stays strictly in 'auth-initializing' until IndexedDB hydration, local cryptographic
 * session verification, and Firebase Auth startup readiness have all settled.
 */
export function resolveAuthLifecycleStatus(
  signals: AuthInitializationSignals
): AuthLifecycleStatus {
  if (
    !signals.isDbHydrated ||
    !signals.isStoreSessionChecked ||
    !signals.isFirebaseAuthReady
  ) {
    return 'auth-initializing';
  }
  return signals.hasVerifiedSession ? 'authenticated' : 'unauthenticated';
}

/**
 * Resolves the current human-readable startup stage while authStatus is 'auth-initializing'.
 */
export function resolveAuthInitStage(
  signals: AuthInitializationSignals
): AuthInitStage {
  if (signals.isDbOpened === false) {
    return 'opening-database';
  }
  if (!signals.isStoreSessionChecked) {
    return signals.isDbOpened ? 'verifying-session' : 'opening-database';
  }
  if (!signals.isDbHydrated) {
    return 'opening-database';
  }
  if (!signals.isFirebaseAuthReady) {
    return 'syncing-auth-provider';
  }
  return 'ready';
}

function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  getCrypto().getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes a SHA-256 fingerprint of the stored PBKDF2-SHA256 PIN hash record.
 * Never touches or stores any plaintext PIN; binds the session to the exact stored hash
 * so changing or resetting the PIN invalidates all older sessions immediately.
 */
export async function computePinHashFingerprint(
  pinRecord: PinSecurityRecord | null | undefined
): Promise<string | null> {
  if (!pinRecord || !pinRecord.hashBase64 || !pinRecord.saltBase64) {
    return null;
  }
  const canonical = `${pinRecord.algorithm}:${pinRecord.iterations}:${pinRecord.saltBase64}:${pinRecord.hashBase64}:${pinRecord.updatedAt}`;
  const encoded = new TextEncoder().encode(canonical);
  const digest = await getCrypto().subtle.digest('SHA-256', toArrayBuffer(encoded));
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Generates a fresh non-extractable HMAC-SHA256 CryptoKey suitable for IndexedDB structured clone storage.
 */
export async function generateSessionSigningKey(): Promise<CryptoKey> {
  return getCrypto().subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false, // non-extractable
    ['sign', 'verify']
  );
}

/**
 * Creates a cryptographically signed, time-bound store auth session.
 */
export async function createSignedAuthSession(params: {
  authMode: StoreAuthMode;
  mobile?: string;
  portalEntityId?: string;
  portalEntityName?: string;
  pinRecord?: PinSecurityRecord | null;
  ttlMs?: number;
  nowMs?: number;
}): Promise<{ record: PersistedAuthSessionRecord; key: CryptoKey }> {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = Math.max(60 * 1000, params.ttlMs ?? DEFAULT_AUTH_SESSION_TTL_MS);

  let pinHashFingerprint: string | undefined;
  if (params.authMode === 'PIN') {
    const fp = await computePinHashFingerprint(params.pinRecord);
    if (!fp) {
      throw new Error('Cannot create PIN-authenticated session without a configured PIN hash.');
    }
    pinHashFingerprint = fp;
  }

  if (
    (params.authMode === 'CUSTOMER' || params.authMode === 'SUPPLIER') &&
    (!params.portalEntityId || !params.portalEntityId.trim())
  ) {
    throw new Error(`Cannot create ${params.authMode} portal session without a verified entity ID.`);
  }

  const normalizedMobile = params.mobile ? normalizeMobileDigits(params.mobile) : undefined;
  const cleanEntityId = params.portalEntityId?.trim();
  const cleanEntityName = params.portalEntityName?.trim();
  const payload: AuthSessionPayload = {
    version: 1,
    sessionId: generateSessionId(),
    authMode: params.authMode,
    ...(normalizedMobile && normalizedMobile.length >= 10 ? { mobile: normalizedMobile } : {}),
    ...(cleanEntityId ? { portalEntityId: cleanEntityId } : {}),
    ...(cleanEntityName ? { portalEntityName: cleanEntityName } : {}),
    ...(pinHashFingerprint ? { pinHashFingerprint } : {}),
    issuedAt: nowMs,
    expiresAt: nowMs + ttlMs,
  };

  const key = await generateSessionSigningKey();
  const canonicalBytes = new TextEncoder().encode(canonicalJSONStringify(payload));
  const sigBuffer = await getCrypto().subtle.sign('HMAC', key, toArrayBuffer(canonicalBytes));

  return {
    record: {
      payload,
      signatureBase64: bytesToBase64(new Uint8Array(sigBuffer)),
    },
    key,
  };
}

function isValidPayloadShape(raw: unknown): raw is AuthSessionPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const p = raw as Partial<AuthSessionPayload>;
  const validMode =
    p.authMode === 'PIN' ||
    p.authMode === 'GUEST' ||
    p.authMode === 'CUSTOMER' ||
    p.authMode === 'SUPPLIER';
  const validPortalId =
    p.authMode === 'CUSTOMER' || p.authMode === 'SUPPLIER'
      ? typeof p.portalEntityId === 'string' && p.portalEntityId.trim().length > 0
      : true;
  return (
    p.version === 1 &&
    typeof p.sessionId === 'string' &&
    p.sessionId.length >= 16 &&
    validMode &&
    validPortalId &&
    typeof p.issuedAt === 'number' &&
    Number.isFinite(p.issuedAt) &&
    typeof p.expiresAt === 'number' &&
    Number.isFinite(p.expiresAt) &&
    p.expiresAt > p.issuedAt
  );
}

/**
 * Cryptographically verifies a persisted store auth session against its non-extractable
 * IndexedDB HMAC key, current time, PIN security state, and registered phone.
 */
export async function verifyPersistedAuthSession(params: {
  record: PersistedAuthSessionRecord | null | undefined;
  key: CryptoKey | null | undefined;
  pinRecord: PinSecurityRecord | null | undefined;
  isPinEnabled: boolean;
  registeredPhone?: string;
  nowMs?: number;
}): Promise<AuthSessionVerificationResult> {
  const { record, key, pinRecord, isPinEnabled, registeredPhone } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (!record && !key) {
    return { status: 'MISSING' };
  }

  if (
    !record ||
    !key ||
    typeof record.signatureBase64 !== 'string' ||
    !record.signatureBase64 ||
    !isValidPayloadShape(record.payload)
  ) {
    return {
      status: 'INVALID',
      reason: 'Saved session data is incomplete or invalid. Please log in again.',
    };
  }

  // 1. Always verify HMAC-SHA256 signature before trusting any payload fields (including expiresAt)
  try {
    const sigBytes = base64ToBytes(record.signatureBase64);
    const canonicalBytes = new TextEncoder().encode(canonicalJSONStringify(record.payload));
    const verified = await getCrypto().subtle.verify(
      'HMAC',
      key,
      toArrayBuffer(sigBytes),
      toArrayBuffer(canonicalBytes)
    );
    if (!verified) {
      return {
        status: 'INVALID',
        reason: 'Session verification failed. Please log in again.',
      };
    }
  } catch {
    return {
      status: 'INVALID',
      reason: 'Session key could not be verified. Please log in again.',
    };
  }

  const { payload } = record;

  // 2. Enforce genuine time expiration and reject future-dated clock anomalies
  if (payload.issuedAt > nowMs + MAX_CLOCK_SKEW_MS) {
    return {
      status: 'INVALID',
      reason: 'Session timestamp is invalid. Please log in again.',
    };
  }

  if (nowMs >= payload.expiresAt) {
    return {
      status: 'EXPIRED',
      reason: 'Your session has expired. Please log in again to continue.',
    };
  }

  // 3. Enforce Counter PIN Lock security policy (guest sessions can NEVER bypass an active PIN lock;
  // role-scoped CUSTOMER / SUPPLIER sessions remain strictly isolated inside their read-only portals)
  if (isPinEnabled && payload.authMode === 'GUEST') {
    return {
      status: 'LOCKED_GUEST_REJECTED',
      reason: 'Store Counter Lock is active. Please log in with your 4-digit PIN.',
    };
  }

  // 4. Verify PIN hash fingerprint binding for PIN-authenticated sessions
  if (payload.authMode === 'PIN') {
    const currentFingerprint = await computePinHashFingerprint(pinRecord);
    if (!currentFingerprint || payload.pinHashFingerprint !== currentFingerprint) {
      return {
        status: 'PIN_CHANGED',
        reason: 'Your store security PIN was updated or reset. Please log in again.',
      };
    }

    const normalizedRegistered = normalizeMobileDigits(registeredPhone || '');
    const normalizedSessionMobile = normalizeMobileDigits(payload.mobile || '');
    if (
      normalizedRegistered.length >= 10 &&
      normalizedSessionMobile.length >= 10 &&
      normalizedSessionMobile.slice(-10) !== normalizedRegistered.slice(-10)
    ) {
      return {
        status: 'INVALID',
        reason: 'Registered store mobile number changed. Please log in again.',
      };
    }
  }

  return {
    status: 'VALID',
    session: payload,
  };
}

/**
 * Checks whether an already-restored in-memory auth session has expired.
 */
export function isAuthSessionExpired(
  session: AuthSessionPayload | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!session) return true;
  return nowMs >= session.expiresAt;
}
