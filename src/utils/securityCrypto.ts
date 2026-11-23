/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EncryptedBackupEnvelope } from '../types';

export const DEFAULT_DEMO_PIN = '1234';
export const ENCRYPTED_BACKUP_MAGIC = 'SKPRO_ENC_V1';
const PIN_PBKDF2_ITERATIONS = 100_000;
const BACKUP_PBKDF2_ITERATIONS = 150_000;

export interface PinHashPayload {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  hashBase64: string;
  updatedAt: string;
}

function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Constant-time equality check for equal-length strings or byte arrays.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Canonical deterministic JSON stringifier (recursively sorts object keys).
 */
export function canonicalJSONStringify(value: unknown): string {
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(sortValue);
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        if (obj[key] !== undefined) {
          sorted[key] = sortValue(obj[key]);
        }
      }
      return sorted;
    }
    return v;
  };
  return JSON.stringify(sortValue(value));
}

async function derivePbkdf2Bits(
  secret: string,
  salt: Uint8Array,
  iterations: number,
  bitLength = 256
): Promise<Uint8Array> {
  const c = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await c.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await c.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    bitLength
  );
  return new Uint8Array(bits);
}

/**
 * Hashes a 4-digit (or custom) PIN using a fresh 16-byte random salt and PBKDF2-SHA256.
 */
export async function hashPinWithSalt(pin: string): Promise<PinHashPayload> {
  const c = getCrypto();
  const salt = new Uint8Array(16);
  c.getRandomValues(salt);
  const derived = await derivePbkdf2Bits(pin.trim(), salt, PIN_PBKDF2_ITERATIONS, 256);
  return {
    algorithm: 'PBKDF2-SHA256',
    iterations: PIN_PBKDF2_ITERATIONS,
    saltBase64: bytesToBase64(salt),
    hashBase64: bytesToBase64(derived),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Verifies a candidate PIN against a stored PBKDF2-SHA256 record.
 */
export async function verifyPinHash(pin: string, record: PinHashPayload | null | undefined): Promise<boolean> {
  if (!record || !record.saltBase64 || !record.hashBase64) return false;
  try {
    const salt = base64ToBytes(record.saltBase64);
    const expected = base64ToBytes(record.hashBase64);
    const derived = await derivePbkdf2Bits(
      pin.trim(),
      salt,
      record.iterations || PIN_PBKDF2_ITERATIONS,
      expected.length * 8
    );
    return constantTimeEqual(derived, expected);
  } catch {
    return false;
  }
}

async function deriveAesGcmKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const c = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await c.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return c.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a verified JSON backup payload using AES-256-GCM + PBKDF2-SHA256.
 */
export async function encryptBackupEnvelope(
  plainJson: string,
  passphrase: string,
  metadata?: {
    storeName?: string;
    schemaVersion?: string;
    checksum?: string;
    recordCounts?: Record<string, number>;
  }
): Promise<EncryptedBackupEnvelope> {
  const trimmed = passphrase.trim();
  if (trimmed.length < 4) {
    throw new Error('Passphrase must be at least 4 characters long for AES-256-GCM encryption.');
  }

  const c = getCrypto();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  c.getRandomValues(salt);
  c.getRandomValues(iv);

  const key = await deriveAesGcmKey(trimmed, salt, BACKUP_PBKDF2_ITERATIONS);
  const encoded = new TextEncoder().encode(plainJson);
  const cipherBuffer = await c.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    encoded
  );

  return {
    format: ENCRYPTED_BACKUP_MAGIC,
    kdf: 'PBKDF2-SHA256',
    iterations: BACKUP_PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(new Uint8Array(cipherBuffer)),
    createdAt: new Date().toISOString(),
    metadata,
  };
}

/**
 * Checks whether an unknown parsed JSON object is an encrypted SmartKirana backup envelope.
 */
export function isEncryptedBackupEnvelope(raw: unknown): raw is EncryptedBackupEnvelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.format === ENCRYPTED_BACKUP_MAGIC &&
    typeof obj.saltBase64 === 'string' &&
    typeof obj.ivBase64 === 'string' &&
    typeof obj.ciphertextBase64 === 'string'
  );
}

/**
 * Decrypts an AES-256-GCM encrypted backup envelope with user-supplied passphrase.
 */
export async function decryptBackupEnvelope(
  envelopeOrJson: EncryptedBackupEnvelope | string,
  passphrase: string
): Promise<string> {
  const envelope: EncryptedBackupEnvelope =
    typeof envelopeOrJson === 'string'
      ? (JSON.parse(envelopeOrJson) as EncryptedBackupEnvelope)
      : envelopeOrJson;

  if (!isEncryptedBackupEnvelope(envelope)) {
    throw new Error('Invalid encrypted backup format.');
  }

  const trimmed = passphrase.trim();
  if (!trimmed) {
    throw new Error('Passphrase is required to decrypt this backup file.');
  }

  const salt = base64ToBytes(envelope.saltBase64);
  const iv = base64ToBytes(envelope.ivBase64);
  const ciphertext = base64ToBytes(envelope.ciphertextBase64);
  const iterations = Number(envelope.iterations) || BACKUP_PBKDF2_ITERATIONS;

  const key = await deriveAesGcmKey(trimmed, salt, iterations);

  try {
    const plainBuffer = await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext)
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    throw new Error('Incorrect passphrase or tampered encrypted backup file.');
  }
}

export const PIN_ATTEMPTS_STORAGE_KEY = 'arjun_groceries_pin_attempts_v1';

export interface PinAttemptState {
  failedCount: number;
  lockedUntilMs: number;
  lastFailedAtMs: number;
}

export interface PinStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function getDefaultPinStorage(): PinStorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore restricted storage
  }
  return null;
}

/**
 * Progressive exponential cooldown schedule after repeated incorrect PIN attempts:
 * - 0..2 failures: 0s
 * - 3 failures: 5s
 * - 4 failures: 15s
 * - 5 failures: 30s
 * - 6+ failures: 60s
 */
export function computePinLockoutDelaySeconds(failedCount: number): number {
  if (failedCount < 3) return 0;
  if (failedCount === 3) return 5;
  if (failedCount === 4) return 15;
  if (failedCount === 5) return 30;
  return 60;
}

export function readPinAttemptState(storage?: PinStorageLike | null): PinAttemptState {
  const store = storage === undefined ? getDefaultPinStorage() : storage;
  if (!store) {
    return { failedCount: 0, lockedUntilMs: 0, lastFailedAtMs: 0 };
  }
  try {
    const raw = store.getItem(PIN_ATTEMPTS_STORAGE_KEY);
    if (!raw) return { failedCount: 0, lockedUntilMs: 0, lastFailedAtMs: 0 };
    const parsed = JSON.parse(raw) as Partial<PinAttemptState>;
    return {
      failedCount: Math.max(0, Number(parsed.failedCount) || 0),
      lockedUntilMs: Math.max(0, Number(parsed.lockedUntilMs) || 0),
      lastFailedAtMs: Math.max(0, Number(parsed.lastFailedAtMs) || 0),
    };
  } catch {
    return { failedCount: 0, lockedUntilMs: 0, lastFailedAtMs: 0 };
  }
}

export function getPinCooldownRemainingSeconds(
  nowMs: number = Date.now(),
  storage?: PinStorageLike | null
): number {
  const state = readPinAttemptState(storage);
  if (!state.lockedUntilMs || state.lockedUntilMs <= nowMs) return 0;
  return Math.ceil((state.lockedUntilMs - nowMs) / 1000);
}

export function recordFailedPinAttempt(
  nowMs: number = Date.now(),
  storage?: PinStorageLike | null
): { failedCount: number; cooldownSeconds: number; lockedUntilMs: number } {
  const store = storage === undefined ? getDefaultPinStorage() : storage;
  const prev = readPinAttemptState(store);
  // Reset failed streak if last failure was over 15 minutes ago
  const baseCount =
    prev.lastFailedAtMs > 0 && nowMs - prev.lastFailedAtMs > 15 * 60 * 1000
      ? 0
      : prev.failedCount;
  const failedCount = baseCount + 1;
  const cooldownSeconds = computePinLockoutDelaySeconds(failedCount);
  const lockedUntilMs = cooldownSeconds > 0 ? nowMs + cooldownSeconds * 1000 : 0;
  const next: PinAttemptState = {
    failedCount,
    lockedUntilMs,
    lastFailedAtMs: nowMs,
  };
  try {
    store?.setItem(PIN_ATTEMPTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return { failedCount, cooldownSeconds, lockedUntilMs };
}

export function clearPinAttemptState(storage?: PinStorageLike | null): void {
  const store = storage === undefined ? getDefaultPinStorage() : storage;
  if (!store) return;
  try {
    if (typeof store.removeItem === 'function') {
      store.removeItem(PIN_ATTEMPTS_STORAGE_KEY);
    } else {
      store.setItem(PIN_ATTEMPTS_STORAGE_KEY, JSON.stringify({ failedCount: 0, lockedUntilMs: 0, lastFailedAtMs: 0 }));
    }
  } catch {
    // ignore storage errors
  }
}

