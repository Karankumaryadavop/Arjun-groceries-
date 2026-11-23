/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dataUrlToBlob } from './localDatabase';

const DEFAULT_REVOKE_DELAY_MS = 60_000;
const pendingObjectUrls = new Set<string>();
let unloadListenerRegistered = false;

function ensureUnloadCleanupRegistered(): void {
  if (unloadListenerRegistered || typeof window === 'undefined') return;
  unloadListenerRegistered = true;
  window.addEventListener('beforeunload', () => {
    for (const url of pendingObjectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    pendingObjectUrls.clear();
  });
}

export interface VerifiedDownloadResult {
  byteSize: number;
  fileName: string;
}

/**
 * Triggers a browser download from raw text/binary data with:
 * - Non-empty & expected byte-size verification before triggering
 * - 60s delayed `URL.revokeObjectURL` so Android Chrome DownloadManager never aborts large transfers
 */
export function triggerVerifiedBlobDownload(
  data: BlobPart | Blob,
  filename: string,
  mimeType: string,
  options?: {
    expectedBytes?: number;
    revokeDelayMs?: number;
  }
): VerifiedDownloadResult {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });

  if (blob.size <= 0) {
    throw new Error(`Cannot download "${filename}": generated file is empty (0 bytes).`);
  }

  if (
    typeof options?.expectedBytes === 'number' &&
    options.expectedBytes > 0 &&
    blob.size !== options.expectedBytes
  ) {
    throw new Error(
      `File size verification failed for "${filename}" (expected ${options.expectedBytes} bytes, got ${blob.size} bytes).`
    );
  }

  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { byteSize: blob.size, fileName: filename };
  }

  ensureUnloadCleanupRegistered();
  const url = URL.createObjectURL(blob);
  pendingObjectUrls.add(url);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  const delayMs = options?.revokeDelayMs ?? DEFAULT_REVOKE_DELAY_MS;
  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    if (pendingObjectUrls.has(url)) {
      URL.revokeObjectURL(url);
      pendingObjectUrls.delete(url);
    }
  }, delayMs);

  return { byteSize: blob.size, fileName: filename };
}

/**
 * Converts a stored Base64 data URL (image or PDF) into a Blob and downloads it safely on Android Chrome.
 */
export function downloadDataUrlAsBlobFile(
  dataUrl: string,
  filename: string,
  fallbackMime = 'application/octet-stream'
): VerifiedDownloadResult {
  const { blob, mimeType } = dataUrlToBlob(dataUrl, fallbackMime);
  if (!blob || blob.size <= 0) {
    throw new Error(`Attachment "${filename}" does not contain valid binary data to download.`);
  }
  return triggerVerifiedBlobDownload(blob, filename, mimeType);
}

/**
 * Opens a stored Base64 data URL (image or PDF) in a new browser tab via a safe Object URL
 * rather than inline `data:` URI (which Android Chrome blocks or truncates for larger PDFs).
 */
export function openDataUrlViaBlobTab(
  dataUrl: string,
  fallbackMime = 'application/pdf'
): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const { blob } = dataUrlToBlob(dataUrl, fallbackMime);
  if (!blob || blob.size <= 0) {
    return false;
  }

  ensureUnloadCleanupRegistered();
  const url = URL.createObjectURL(blob);
  pendingObjectUrls.add(url);

  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    if (pendingObjectUrls.has(url)) {
      URL.revokeObjectURL(url);
      pendingObjectUrls.delete(url);
    }
  }, DEFAULT_REVOKE_DELAY_MS);

  return true;
}

/**
 * Human-readable byte size formatter (B, KB, MB) for verified backup status banners.
 */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
