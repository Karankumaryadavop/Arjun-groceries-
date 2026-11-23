import { BillAttachment, BillOcrExtractedData } from '../types';
import { saveBillDocument, calculateFileHash, findDuplicateDocument } from './billDatabase';
import { apiFetch } from './apiClient';

/**
 * Compresses an image file client-side using HTML5 Canvas to keep file sizes
 * small (~80-250KB) while preserving sharp readability of printed bill text and numbers.
 */
export async function compressImageFile(
  file: File,
  maxDimension = 1600,
  quality = 0.82
): Promise<{ dataUrl: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image into memory'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: e.target?.result as string, size: file.size });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Calculate approximate size in bytes from base64
        const stringLength = dataUrl.length - 'data:image/jpeg;base64,'.length;
        const sizeInBytes = Math.round(stringLength * 0.75);

        resolve({ dataUrl, size: sizeInBytes });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Reads any file (e.g. PDF or small asset) as Base64 Data URL.
 */
export async function readFileAsDataUrl(file: File): Promise<{ dataUrl: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read document file'));
    reader.onload = (e) => {
      resolve({
        dataUrl: e.target?.result as string,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a browser File (from camera, gallery or PDF upload) into a standardized BillAttachment,
 * saves it persistently in IndexedDB, and detects duplicates.
 */
export async function processFileToAttachment(file: File): Promise<BillAttachment> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const type: 'IMAGE' | 'PDF' = isPdf ? 'PDF' : 'IMAGE';

  let dataUrl = '';
  let size = file.size;

  if (isPdf) {
    const res = await readFileAsDataUrl(file);
    dataUrl = res.dataUrl;
    size = res.size;
  } else {
    try {
      const res = await compressImageFile(file);
      dataUrl = res.dataUrl;
      size = res.size;
    } catch {
      // Fallback to uncompressed read if canvas fails
      const fallback = await readFileAsDataUrl(file);
      dataUrl = fallback.dataUrl;
      size = fallback.size;
    }
  }

  const fileHash = calculateFileHash(dataUrl);

  // Check if identical document was already uploaded
  try {
    const existing = await findDuplicateDocument(dataUrl);
    if (existing) {
      return existing;
    }
  } catch {
    // ignore duplicate check error
  }

  const uniqueId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const attachment: BillAttachment = {
    id: uniqueId,
    name: file.name,
    type,
    dataUrl,
    size,
    uploadedAt: new Date().toISOString(),
    rotation: 0,
    fileHash,
  };

  // Persist into IndexedDB
  try {
    await saveBillDocument(attachment);
  } catch (err) {
    console.warn('Could not save document to IndexedDB:', err);
  }

  return attachment;
}

/**
 * Calls the backend Gemini OCR scanner to extract data from an attached bill.
 */
export async function scanBillWithAI(
  attachment: BillAttachment,
  billType: 'PURCHASE' | 'EXPENSE' | 'SALE' = 'PURCHASE'
): Promise<{ success: boolean; data?: BillOcrExtractedData; error?: string }> {
  try {
    const response = await apiFetch('/api/ocr/scan-bill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: attachment.dataUrl,
        mimeType: attachment.type === 'PDF' ? 'application/pdf' : 'image/jpeg',
        billType,
      }),
    });

    const resData = await response.json();
    if (resData.success && resData.extractedData) {
      return {
        success: true,
        data: resData.extractedData,
      };
    }

    return {
      success: false,
      error: resData.error || 'Failed to extract bill information',
      data: resData.fallback,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Network error while contacting OCR service',
    };
  }
}

/**
 * Formats bytes to readable KB/MB string.
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Rotates an image attachment by 90 degrees clockwise using HTML Canvas.
 */
export async function rotateImageAttachment(attachment: BillAttachment): Promise<BillAttachment> {
  if (attachment.type !== 'IMAGE') return attachment;

  const nextRotation = ((attachment.rotation || 0) + 90) % 360;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // For 90 or 270 degrees, swap width and height
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ ...attachment, rotation: nextRotation });
        return;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const rotatedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({
        ...attachment,
        dataUrl: rotatedDataUrl,
        rotation: 0, // already applied to pixels
      });
    };
    img.onerror = () => {
      resolve({ ...attachment, rotation: nextRotation });
    };
    img.src = attachment.dataUrl;
  });
}
