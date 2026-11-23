/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppBackupData,
  AppBackupSummary,
  CloudPassphraseVerifier,
  EncryptedBackupEnvelope,
  StoreBusinessDataset,
} from '../types';
import {
  buildVerifiedBackupEnvelope,
  inspectAndValidateBackupContent,
  InspectedBackupResult,
} from './localBackupManager';
import {
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  ENCRYPTED_BACKUP_MAGIC,
  encryptBackupEnvelope,
} from './securityCrypto';

export const CLOUD_BACKUP_MIN_PASSPHRASE_LENGTH = 8;
const CLOUD_VERIFIER_ITERATIONS = 150_000;
const CLOUD_VERIFIER_PREFIX = 'ARJUN_GROCERIES_CLOUD_PASSPHRASE_V1:';

export interface CloudPassphraseValidation {
  valid: boolean;
  strength: 'WEAK' | 'FAIR' | 'STRONG';
  error?: string;
}

export function validateCloudPassphrase(passphrase: string): CloudPassphraseValidation {
  const trimmed = typeof passphrase === 'string' ? passphrase.trim() : '';
  if (trimmed.length < CLOUD_BACKUP_MIN_PASSPHRASE_LENGTH) {
    return {
      valid: false,
      strength: 'WEAK',
      error: `Cloud recovery passphrase must be at least ${CLOUD_BACKUP_MIN_PASSPHRASE_LENGTH} characters long.`,
    };
  }

  let classes = 0;
  if (/[a-z]/.test(trimmed)) classes++;
  if (/[A-Z]/.test(trimmed)) classes++;
  if (/[0-9]/.test(trimmed)) classes++;
  if (/[^A-Za-z0-9]/.test(trimmed)) classes++;

  const strength: CloudPassphraseValidation['strength'] =
    trimmed.length >= 12 && classes >= 2 ? 'STRONG' : trimmed.length >= 10 && classes >= 3 ? 'STRONG' : 'FAIR';

  return { valid: true, strength };
}

function getWebCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API (crypto.subtle) is unavailable in this environment.');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Computes a SHA-256 hex digest over raw encrypted payload bytes for integrity verification.
 */
export async function computeBytesSha256Hex(bytes: Uint8Array): Promise<string> {
  const c = getWebCrypto();
  const digest = await c.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derives a non-reversible salted PBKDF2 verifier so returning sessions can confirm a typed
 * passphrase matches the configured cloud passphrase without storing the passphrase itself.
 */
export async function createPassphraseVerifier(passphrase: string): Promise<CloudPassphraseVerifier> {
  const check = validateCloudPassphrase(passphrase);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid cloud recovery passphrase.');
  }
  const c = getWebCrypto();
  const salt = new Uint8Array(16);
  c.getRandomValues(salt);
  const keyMaterial = await c.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${CLOUD_VERIFIER_PREFIX}${passphrase.trim()}`),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await c.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: CLOUD_VERIFIER_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return {
    algorithm: 'PBKDF2-SHA256',
    iterations: CLOUD_VERIFIER_ITERATIONS,
    saltBase64: bytesToBase64(salt),
    hashBase64: bytesToBase64(new Uint8Array(bits)),
    updatedAt: new Date().toISOString(),
  };
}

export async function verifyPassphraseVerifier(
  passphrase: string,
  verifier: CloudPassphraseVerifier | null | undefined
): Promise<boolean> {
  if (!verifier || !verifier.saltBase64 || !verifier.hashBase64) return false;
  const trimmed = typeof passphrase === 'string' ? passphrase.trim() : '';
  if (!trimmed) return false;
  try {
    const c = getWebCrypto();
    const salt = base64ToBytes(verifier.saltBase64);
    const expected = base64ToBytes(verifier.hashBase64);
    const keyMaterial = await c.subtle.importKey(
      'raw',
      new TextEncoder().encode(`${CLOUD_VERIFIER_PREFIX}${trimmed}`),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await c.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: toArrayBuffer(salt),
        iterations: Number(verifier.iterations) || CLOUD_VERIFIER_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      expected.length * 8
    );
    return constantTimeEqual(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

export interface BuiltCloudEncryptedPayload {
  envelope: EncryptedBackupEnvelope;
  jsonString: string;
  bytes: Uint8Array;
  sizeBytes: number;
  ciphertextSha256: string;
  plaintextChecksum: string;
  summary: AppBackupData['summary'];
  customMetadata: Record<string, string>;
}

/**
 * Ensures neither the unencrypted outer envelope JSON nor Firebase Storage customMetadata
 * leaks store names, owner info, phones, customer names, or financial counts/totals.
 */
export function assertZeroPlaintextLeakage(
  outerEnvelopeJson: string,
  customMetadata: Record<string, string>,
  dataset: StoreBusinessDataset
): void {
  const parsed = JSON.parse(outerEnvelopeJson) as Record<string, unknown>;
  if (parsed.format !== ENCRYPTED_BACKUP_MAGIC || parsed.cipher !== 'AES-256-GCM') {
    throw new Error('Refusing cloud upload: payload is not encrypted with AES-256-GCM.');
  }

  const forbiddenRootKeys = [
    'customers',
    'customerTransactions',
    'suppliers',
    'supplierTransactions',
    'sales',
    'expenses',
    'cashbookEntries',
    'products',
    'billDocuments',
    'storeProfile',
    'profile',
    'summary',
    'transactions',
    'masterData',
  ];
  for (const key of forbiddenRootKeys) {
    if (key in parsed) {
      throw new Error(`Security violation: unencrypted root field "${key}" found in cloud payload.`);
    }
  }

  const envelopeMeta = (parsed.metadata || {}) as Record<string, unknown>;
  const forbiddenMetaKeys = [
    'storeName',
    'ownerName',
    'phone',
    'upiId',
    'address',
    'recordCounts',
    'totalSales',
    'customers',
    'salesCount',
  ];
  for (const key of forbiddenMetaKeys) {
    if (key in envelopeMeta || key in customMetadata) {
      throw new Error(`Security violation: sensitive metadata field "${key}" must not be stored unencrypted.`);
    }
  }

  // Strip ciphertext before checking string leakage so only outer unencrypted wrapper is scanned
  const outerWithoutCipher = JSON.stringify({ ...parsed, ciphertextBase64: '' });
  const metaBlob = JSON.stringify(customMetadata);
  const sensitiveTerms = [
    dataset.profile?.storeName,
    dataset.profile?.ownerName,
    dataset.profile?.phone,
    dataset.profile?.upiId,
    ...dataset.customers.slice(0, 10).map((c) => c.name),
    ...dataset.customers.slice(0, 10).map((c) => c.phone),
    ...dataset.suppliers.slice(0, 10).map((s) => s.name),
  ]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length >= 3);

  for (const term of sensitiveTerms) {
    if (outerWithoutCipher.includes(term) || metaBlob.includes(term)) {
      throw new Error('Security violation: unencrypted business data detected in cloud backup header.');
    }
  }
}

/**
 * Encrypts the complete consolidated business dataset (including bill attachments) into
 * an AES-256-GCM archive ready for Firebase Cloud Storage, with zero plaintext metadata leakage.
 */
export async function buildEncryptedCloudBackupPayload(
  dataset: StoreBusinessDataset,
  passphrase: string,
  options?: { createdAt?: string }
): Promise<BuiltCloudEncryptedPayload> {
  const passCheck = validateCloudPassphrase(passphrase);
  if (!passCheck.valid) {
    throw new Error(passCheck.error || 'Cloud recovery passphrase is too weak.');
  }

  const verified = await buildVerifiedBackupEnvelope(dataset);
  const rawEnvelope = await encryptBackupEnvelope(verified.jsonString, passphrase.trim(), {
    schemaVersion: verified.backup.schemaVersion,
  });

  // Strictly minimize outer metadata: schemaVersion only (no storeName, no recordCounts, no plaintext checksum)
  const envelope: EncryptedBackupEnvelope = {
    ...rawEnvelope,
    createdAt: options?.createdAt || rawEnvelope.createdAt,
    metadata: {
      schemaVersion: verified.backup.schemaVersion,
    },
  };

  const jsonString = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(jsonString);
  const ciphertextSha256 = await computeBytesSha256Hex(bytes);

  const customMetadata: Record<string, string> = {
    format: ENCRYPTED_BACKUP_MAGIC,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    schemaVersion: verified.backup.schemaVersion,
    ciphertextSha256,
    createdAt: envelope.createdAt,
    payloadType: 'encrypted-store-snapshot',
  };

  assertZeroPlaintextLeakage(jsonString, customMetadata, dataset);

  return {
    envelope,
    jsonString,
    bytes,
    sizeBytes: bytes.byteLength,
    ciphertextSha256,
    plaintextChecksum: verified.checksum,
    summary: verified.backup.summary,
    customMetadata,
  };
}

/**
 * Decrypts and validates a downloaded cloud backup envelope before previewing or restoring.
 */
export async function decryptAndInspectCloudBackup(
  rawEncryptedJson: string,
  passphrase: string
): Promise<InspectedBackupResult> {
  const trimmedPass = typeof passphrase === 'string' ? passphrase.trim() : '';
  if (!trimmedPass) {
    return {
      valid: false,
      isEncrypted: true,
      requiresPassphrase: true,
      error: 'Enter your cloud backup recovery passphrase to decrypt this snapshot.',
    };
  }
  return inspectAndValidateBackupContent(rawEncryptedJson, trimmedPass);
}
