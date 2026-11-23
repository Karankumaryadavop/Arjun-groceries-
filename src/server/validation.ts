/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Customer, CustomerTransaction, SaleRecord, StoreProfile } from '../types';
import type { SalesForecastInputPayload } from '../utils/analyticsMetrics';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const ALLOWED_OCR_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const ALLOWED_BILL_TYPES = new Set(['PURCHASE', 'EXPENSE', 'SALE'] as const);
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_TEMPLATE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_TEMPLATE_LANG_PATTERN = /^[a-zA-Z]{2,3}(?:_[a-zA-Z]{2})?$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BASE64_BODY_PATTERN = /^[A-Za-z0-9+/=]+$/;

const MAX_DECODED_UPLOAD_BYTES = 12 * 1024 * 1024; // 12MB

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Strips control characters, newlines, and quotes to prevent prompt-injection or log forging.
 */
export function sanitizePromptText(input: unknown, maxLen: number, fallback = ''): string {
  if (typeof input !== 'string') return fallback;
  const cleaned = input
    .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
    .replace(/["`\\]/g, '')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

export interface ValidatedScanBillBody {
  base64Data: string;
  mimeType: string;
  billType: 'PURCHASE' | 'EXPENSE' | 'SALE';
}

export function validateScanBillBody(body: unknown): ValidationResult<ValidatedScanBillBody> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid request body format.' };
  }

  const rawImage = body.image;
  if (typeof rawImage !== 'string' || !rawImage.trim()) {
    return { ok: false, error: 'No image or document data provided for scanning.' };
  }

  const rawBillType = body.billType === undefined ? 'PURCHASE' : body.billType;
  if (typeof rawBillType !== 'string' || !ALLOWED_BILL_TYPES.has(rawBillType as any)) {
    return { ok: false, error: 'Invalid billType. Allowed values: PURCHASE, EXPENSE, SALE.' };
  }

  const rawMime = body.mimeType === undefined ? 'image/jpeg' : body.mimeType;
  if (typeof rawMime !== 'string' || !ALLOWED_OCR_MIMES.has(rawMime.trim().toLowerCase())) {
    return { ok: false, error: 'Unsupported MIME type. Allowed: JPEG, PNG, WEBP, PDF.' };
  }

  let detectedMime = rawMime.trim().toLowerCase();
  let base64Part = rawImage.trim();

  if (base64Part.startsWith('data:')) {
    const commaIdx = base64Part.indexOf(',');
    if (commaIdx === -1) {
      return { ok: false, error: 'Malformed data URL payload.' };
    }
    const header = base64Part.slice(5, commaIdx).toLowerCase();
    const [mimePart, ...params] = header.split(';');
    if (!params.includes('base64')) {
      return { ok: false, error: 'Data URL must use base64 encoding.' };
    }
    if (!ALLOWED_OCR_MIMES.has(mimePart)) {
      return { ok: false, error: 'Unsupported embedded document MIME type.' };
    }
    detectedMime = mimePart;
    base64Part = base64Part.slice(commaIdx + 1);
  }

  const compactBase64 = base64Part.replace(/\s+/g, '');
  if (!compactBase64 || !BASE64_BODY_PATTERN.test(compactBase64)) {
    return { ok: false, error: 'Invalid base64 document encoding.' };
  }

  const approxBytes = Math.floor((compactBase64.length * 3) / 4);
  if (approxBytes > MAX_DECODED_UPLOAD_BYTES) {
    return { ok: false, error: 'Uploaded document exceeds maximum allowed size (12MB).' };
  }

  if (detectedMime === 'image/jpg') {
    detectedMime = 'image/jpeg';
  }

  return {
    ok: true,
    value: {
      base64Data: compactBase64,
      mimeType: detectedMime,
      billType: rawBillType as 'PURCHASE' | 'EXPENSE' | 'SALE',
    },
  };
}

export function validateExtractSuppliersBody(
  body: unknown
): ValidationResult<{ base64Data: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid request body format.' };
  }
  const rawPdf = body.pdfBase64;
  if (typeof rawPdf !== 'string' || !rawPdf.trim()) {
    return { ok: false, error: 'No PDF document provided.' };
  }

  let base64Part = rawPdf.trim();
  if (base64Part.startsWith('data:')) {
    const commaIdx = base64Part.indexOf(',');
    if (commaIdx === -1) {
      return { ok: false, error: 'Malformed PDF data URL.' };
    }
    const header = base64Part.slice(5, commaIdx).toLowerCase();
    const [mimePart, ...params] = header.split(';');
    if (mimePart !== 'application/pdf' || !params.includes('base64')) {
      return { ok: false, error: 'Document must be a base64-encoded application/pdf.' };
    }
    base64Part = base64Part.slice(commaIdx + 1);
  }

  const compactBase64 = base64Part.replace(/\s+/g, '');
  if (!compactBase64 || !BASE64_BODY_PATTERN.test(compactBase64)) {
    return { ok: false, error: 'Invalid base64 PDF payload.' };
  }

  const approxBytes = Math.floor((compactBase64.length * 3) / 4);
  if (approxBytes > MAX_DECODED_UPLOAD_BYTES) {
    return { ok: false, error: 'PDF payload exceeds maximum allowed size (12MB).' };
  }

  return { ok: true, value: { base64Data: compactBase64 } };
}

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function validateSalesForecastBody(
  body: unknown
): ValidationResult<{ summary: SalesForecastInputPayload; storeName: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid request body format.' };
  }

  const summary = body.summary;
  if (!isPlainObject(summary)) {
    return { ok: false, error: 'Historical sales summary payload is required.' };
  }

  if (typeof summary.referenceDateKey !== 'string' || !DATE_KEY_PATTERN.test(summary.referenceDateKey)) {
    return { ok: false, error: 'Valid referenceDateKey (YYYY-MM-DD) is required.' };
  }

  if (!Array.isArray(summary.historyDays) || summary.historyDays.length === 0 || summary.historyDays.length > 90) {
    return { ok: false, error: 'historyDays must be an array of 1 to 90 daily summaries.' };
  }

  for (const day of summary.historyDays) {
    if (!isPlainObject(day) || !isFiniteNumber(day.amount) || typeof day.dateKey !== 'string') {
      return { ok: false, error: 'Each historyDays item must contain a valid dateKey and numeric amount.' };
    }
  }

  const requiredNumericKeys = [
    'recent7DayTotal',
    'prior7DayTotal',
    'growthPct',
    'avgDailySales30D',
    'monthlyOperatingExpenses',
    'activeDaysCount',
  ] as const;

  for (const k of requiredNumericKeys) {
    if (!isFiniteNumber(summary[k])) {
      return { ok: false, error: `Invalid numeric summary metric: ${k}.` };
    }
  }

  if (!Array.isArray(summary.dayOfWeekAverages) || summary.dayOfWeekAverages.length > 14) {
    return { ok: false, error: 'dayOfWeekAverages must be a valid array.' };
  }
  if (!Array.isArray(summary.topCategories) || summary.topCategories.length > 50) {
    return { ok: false, error: 'topCategories must be a valid array.' };
  }

  const storeName = sanitizePromptText(body.storeName, 100, 'Arjun Groceries');

  return {
    ok: true,
    value: {
      summary: summary as unknown as SalesForecastInputPayload,
      storeName,
    },
  };
}

const ALLOWED_WHATSAPP_CONFIG_KEYS = new Set([
  'businessAccountId',
  'phoneNumberId',
  'accessToken',
  'templateName',
  'templateLanguage',
  'webhookVerifyToken',
  'verifiedTestNumber',
  'sandboxMode',
]);

export interface ValidatedWhatsAppConfigUpdate {
  businessAccountId?: string;
  phoneNumberId?: string;
  accessToken?: string;
  templateName?: string;
  templateLanguage?: string;
  webhookVerifyToken?: string;
  verifiedTestNumber?: string;
  sandboxMode?: boolean;
}

export function validateWhatsAppConfigUpdateBody(
  body: unknown
): ValidationResult<ValidatedWhatsAppConfigUpdate> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid configuration payload.' };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_WHATSAPP_CONFIG_KEYS.has(key)) {
      return { ok: false, error: `Unsupported configuration field: ${key}.` };
    }
  }

  const result: ValidatedWhatsAppConfigUpdate = {};

  const checkOptionalString = (key: keyof ValidatedWhatsAppConfigUpdate, maxLen: number): string | undefined => {
    const val = body[key];
    if (val === undefined) return undefined;
    if (typeof val !== 'string') {
      throw new Error(`Field "${key}" must be a string.`);
    }
    const trimmed = val.trim();
    if (trimmed.length > maxLen) {
      throw new Error(`Field "${key}" exceeds max length (${maxLen}).`);
    }
    return trimmed;
  };

  try {
    const businessAccountId = checkOptionalString('businessAccountId', 64);
    if (businessAccountId !== undefined) {
      if (businessAccountId && !/^[a-zA-Z0-9_-]+$/.test(businessAccountId)) {
        return { ok: false, error: 'Invalid businessAccountId format.' };
      }
      result.businessAccountId = businessAccountId;
    }

    const phoneNumberId = checkOptionalString('phoneNumberId', 64);
    if (phoneNumberId !== undefined) {
      if (phoneNumberId && !/^[a-zA-Z0-9_-]+$/.test(phoneNumberId)) {
        return { ok: false, error: 'Invalid phoneNumberId format.' };
      }
      result.phoneNumberId = phoneNumberId;
    }

    const accessToken = checkOptionalString('accessToken', 512);
    if (accessToken !== undefined) {
      result.accessToken = accessToken;
    }

    const webhookVerifyToken = checkOptionalString('webhookVerifyToken', 256);
    if (webhookVerifyToken !== undefined) {
      result.webhookVerifyToken = webhookVerifyToken;
    }

    const templateName = checkOptionalString('templateName', 128);
    if (templateName !== undefined) {
      if (!SAFE_TEMPLATE_NAME_PATTERN.test(templateName)) {
        return { ok: false, error: 'Invalid templateName format.' };
      }
      result.templateName = templateName;
    }

    const templateLanguage = checkOptionalString('templateLanguage', 16);
    if (templateLanguage !== undefined) {
      if (!SAFE_TEMPLATE_LANG_PATTERN.test(templateLanguage)) {
        return { ok: false, error: 'Invalid templateLanguage code.' };
      }
      result.templateLanguage = templateLanguage;
    }

    const verifiedTestNumber = checkOptionalString('verifiedTestNumber', 24);
    if (verifiedTestNumber !== undefined) {
      if (verifiedTestNumber && !/^[+\d\s()-]{6,24}$/.test(verifiedTestNumber)) {
        return { ok: false, error: 'Invalid verifiedTestNumber format.' };
      }
      result.verifiedTestNumber = verifiedTestNumber;
    }

    if (body.sandboxMode !== undefined) {
      if (typeof body.sandboxMode !== 'boolean') {
        return { ok: false, error: 'Field "sandboxMode" must be a boolean.' };
      }
      result.sandboxMode = body.sandboxMode;
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Invalid configuration fields.' };
  }

  return { ok: true, value: result };
}

export function validateWhatsAppSendTestBody(body: unknown): ValidationResult<{
  testPhoneNumber?: string;
  customerName?: string;
  storeName?: string;
  outstandingAmount?: number;
  upiId?: string;
}> {
  if (body !== undefined && !isPlainObject(body)) {
    return { ok: false, error: 'Invalid test-send payload.' };
  }
  const obj = (body || {}) as Record<string, unknown>;

  if (obj.testPhoneNumber !== undefined) {
    if (typeof obj.testPhoneNumber !== 'string' || obj.testPhoneNumber.trim().length > 24) {
      return { ok: false, error: 'Invalid testPhoneNumber.' };
    }
  }
  if (obj.customerName !== undefined && (typeof obj.customerName !== 'string' || obj.customerName.length > 100)) {
    return { ok: false, error: 'Invalid customerName.' };
  }
  if (obj.storeName !== undefined && (typeof obj.storeName !== 'string' || obj.storeName.length > 100)) {
    return { ok: false, error: 'Invalid storeName.' };
  }
  if (obj.upiId !== undefined && (typeof obj.upiId !== 'string' || obj.upiId.length > 120)) {
    return { ok: false, error: 'Invalid upiId.' };
  }
  if (obj.outstandingAmount !== undefined) {
    if (!isFiniteNumber(obj.outstandingAmount) || obj.outstandingAmount <= 0 || obj.outstandingAmount > 10_000_000) {
      return { ok: false, error: 'outstandingAmount must be a positive finite number.' };
    }
  }

  return {
    ok: true,
    value: {
      testPhoneNumber: obj.testPhoneNumber as string | undefined,
      customerName: obj.customerName as string | undefined,
      storeName: obj.storeName as string | undefined,
      outstandingAmount: obj.outstandingAmount as number | undefined,
      upiId: obj.upiId as string | undefined,
    },
  };
}

export function validateWhatsAppStoreSnapshotBody(body: unknown): ValidationResult<{
  sales: SaleRecord[];
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  storeProfile: StoreProfile;
}> {
  if (!isPlainObject(body) || !isPlainObject(body.storeProfile)) {
    return { ok: false, error: 'storeProfile object is required.' };
  }
  const sales = body.sales === undefined ? [] : body.sales;
  const customers = body.customers === undefined ? [] : body.customers;
  const customerTransactions = body.customerTransactions === undefined ? [] : body.customerTransactions;

  if (!Array.isArray(sales) || !Array.isArray(customers) || !Array.isArray(customerTransactions)) {
    return { ok: false, error: 'sales, customers, and customerTransactions must be arrays.' };
  }

  return {
    ok: true,
    value: {
      sales: sales as SaleRecord[],
      customers: customers as Customer[],
      customerTransactions: customerTransactions as CustomerTransaction[],
      storeProfile: body.storeProfile as unknown as StoreProfile,
    },
  };
}

export function validateWhatsAppGenerateBatchBody(body: unknown): ValidationResult<{
  sales: SaleRecord[];
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  storeProfile: StoreProfile;
  forceRegenerate: boolean;
}> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid batch generation payload.' };
  }
  const sales = body.sales === undefined ? [] : body.sales;
  const customers = body.customers === undefined ? [] : body.customers;
  const customerTransactions = body.customerTransactions === undefined ? [] : body.customerTransactions;
  const storeProfile = body.storeProfile === undefined ? {} : body.storeProfile;
  const forceRegenerate = body.forceRegenerate === undefined ? false : body.forceRegenerate;

  if (
    !Array.isArray(sales) ||
    !Array.isArray(customers) ||
    !Array.isArray(customerTransactions) ||
    !isPlainObject(storeProfile) ||
    typeof forceRegenerate !== 'boolean'
  ) {
    return { ok: false, error: 'Invalid types in batch generation payload.' };
  }

  return {
    ok: true,
    value: {
      sales: sales as SaleRecord[],
      customers: customers as Customer[],
      customerTransactions: customerTransactions as CustomerTransaction[],
      storeProfile: storeProfile as unknown as StoreProfile,
      forceRegenerate,
    },
  };
}

export function validateWhatsAppApproveBatchBody(body: unknown): ValidationResult<{
  batchId: string;
  approvedCustomerIds: string[];
  approvedBy: string;
}> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid batch approval payload.' };
  }
  if (typeof body.batchId !== 'string' || !SAFE_ID_PATTERN.test(body.batchId.trim())) {
    return { ok: false, error: 'Valid batchId is required.' };
  }
  if (!Array.isArray(body.approvedCustomerIds) || body.approvedCustomerIds.length > 500) {
    return { ok: false, error: 'approvedCustomerIds must be an array of customer IDs.' };
  }
  for (const cid of body.approvedCustomerIds) {
    if (typeof cid !== 'string' || !SAFE_ID_PATTERN.test(cid.trim())) {
      return { ok: false, error: 'Each approvedCustomerIds entry must be a valid customer ID string.' };
    }
  }
  const approvedBy =
    typeof body.approvedBy === 'string' && body.approvedBy.trim()
      ? body.approvedBy.trim().slice(0, 100)
      : 'Store Owner';

  return {
    ok: true,
    value: {
      batchId: body.batchId.trim(),
      approvedCustomerIds: (body.approvedCustomerIds as string[]).map((id) => id.trim()),
      approvedBy,
    },
  };
}

export function validateWhatsAppCancelBatchBody(body: unknown): ValidationResult<{
  batchId: string;
  reason: string;
}> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid batch cancellation payload.' };
  }
  if (typeof body.batchId !== 'string' || !SAFE_ID_PATTERN.test(body.batchId.trim())) {
    return { ok: false, error: 'Valid batchId is required.' };
  }
  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 300)
      : 'Cancelled by owner';

  return {
    ok: true,
    value: {
      batchId: body.batchId.trim(),
      reason,
    },
  };
}

export function validateWhatsAppDispatchBatchBody(body: unknown): ValidationResult<{
  batchId: string;
  storeName?: string;
  upiId?: string;
  currentCustomers: Customer[];
  currentTransactions: CustomerTransaction[];
  currentSales: SaleRecord[];
}> {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Invalid dispatch payload.' };
  }
  if (typeof body.batchId !== 'string' || !SAFE_ID_PATTERN.test(body.batchId.trim())) {
    return { ok: false, error: 'Valid batchId is required.' };
  }
  if (body.storeName !== undefined && (typeof body.storeName !== 'string' || body.storeName.length > 100)) {
    return { ok: false, error: 'Invalid storeName.' };
  }
  if (body.upiId !== undefined && (typeof body.upiId !== 'string' || body.upiId.length > 120)) {
    return { ok: false, error: 'Invalid upiId.' };
  }

  const currentCustomers = body.currentCustomers === undefined ? [] : body.currentCustomers;
  const currentTransactions = body.currentTransactions === undefined ? [] : body.currentTransactions;
  const currentSales = body.currentSales === undefined ? [] : body.currentSales;

  if (
    !Array.isArray(currentCustomers) ||
    !Array.isArray(currentTransactions) ||
    !Array.isArray(currentSales)
  ) {
    return { ok: false, error: 'currentCustomers, currentTransactions, and currentSales must be arrays.' };
  }

  return {
    ok: true,
    value: {
      batchId: body.batchId.trim(),
      storeName: body.storeName as string | undefined,
      upiId: body.upiId as string | undefined,
      currentCustomers: currentCustomers as Customer[],
      currentTransactions: currentTransactions as CustomerTransaction[],
      currentSales: currentSales as SaleRecord[],
    },
  };
}

export function validateWebhookPostBody(body: unknown): ValidationResult<{ entry: unknown[] }> {
  if (!isPlainObject(body) || !Array.isArray(body.entry)) {
    return { ok: false, error: 'Invalid WhatsApp webhook payload structure.' };
  }
  return { ok: true, value: body as { entry: unknown[] } };
}
