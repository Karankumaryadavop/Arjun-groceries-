/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  Customer,
  CustomerReminderItem,
  CustomerTransaction,
  SaleRecord,
  StoreProfile,
  WhatsAppApiConfig,
  WhatsAppApiResponseSummary,
  WhatsAppAuditLog,
  WhatsAppReminderBatch,
} from '../types';
import {
  calculateInvoiceOutstanding,
  createWeeklyReminderBatch,
  formatWhatsAppPhoneNumber,
  getWeeklyISTWindow,
} from '../utils/whatsappReminders';
import {
  redactSensitiveText,
  safeLogError,
  timingSafeEqualStrings,
} from './security';

export interface StoreSnapshotPayload {
  sales: SaleRecord[];
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  storeProfile: StoreProfile;
  updatedAt?: string;
}

interface EncryptedWhatsAppSecrets {
  cipher: 'AES-256-GCM';
  ivBase64: string;
  tagBase64: string;
  ciphertextBase64: string;
}

interface PersistedConfig {
  businessAccountId: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  verifiedTestNumber: string;
  sandboxMode: boolean;
  lastTestedAt?: string;
  testStatus?: 'SUCCESS' | 'FAILED';
  testErrorMessage?: string;
  templateStatus?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NOT_FOUND' | 'UNKNOWN';
  templateVerifiedAt?: string;
  verifiedBusinessName?: string;
  verifiedDisplayPhone?: string;
}

interface InternalConfig extends PersistedConfig {
  accessToken: string;
  webhookVerifyToken: string;
}

export interface SentIdempotencyRecord {
  wabaMessageId?: string;
  sentAt: string;
  batchId?: string;
  customerId?: string;
}

interface PersistedServerState {
  config: PersistedConfig;
  encryptedSecrets?: EncryptedWhatsAppSecrets;
  batches: WhatsAppReminderBatch[];
  auditLogs: WhatsAppAuditLog[];
  sentIdempotencyKeys: Record<string, SentIdempotencyRecord>;
  lastSchedulerRunWeekId?: string;
  storeSnapshot?: StoreSnapshotPayload;
}

interface RuntimeServerState {
  config: InternalConfig;
  batches: WhatsAppReminderBatch[];
  auditLogs: WhatsAppAuditLog[];
  sentIdempotencyKeys: Record<string, SentIdempotencyRecord>;
  lastSchedulerRunWeekId?: string;
  storeSnapshot?: StoreSnapshotPayload;
}

export interface WhatsAppServiceOptions {
  stateFilePath?: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
}

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const ALREADY_DISPATCHED_STATUSES = new Set(['SENT', 'ACCEPTED', 'DELIVERED', 'READ']);

function maskSecret(secret: string): string {
  const trimmed = (secret || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

function parseBoolEnv(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined || val === null || val.trim() === '') return fallback;
  const lower = val.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return fallback;
}

function languagesMatch(templateLang: string, expectedLang: string): boolean {
  const a = (templateLang || '').trim().toLowerCase();
  const b = (expectedLang || '').trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  return a.split(/[_-]/)[0] === b.split(/[_-]/)[0];
}

export function createWhatsAppService(options: WhatsAppServiceOptions = {}) {
  const stateFilePath =
    options.stateFilePath || path.resolve(process.cwd(), 'data', 'whatsapp-state.json');
  const fetchFn = options.fetchFn || globalThis.fetch;
  const sleepFn =
    options.sleepFn || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const env = options.env || process.env;

  const envWabaId = (env.WHATSAPP_WABA_ID || '').trim();
  const envPhoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const envAccessToken = (env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const envTemplateName = (env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const envTemplateLang = (env.WHATSAPP_TEMPLATE_LANGUAGE || '').trim();
  const envWebhookToken = (env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
  const envTestNumber = (env.WHATSAPP_TEST_NUMBER || '').trim();

  const configuredViaEnv = !!(envPhoneNumberId && envAccessToken);

  const defaultConfig: InternalConfig = {
    businessAccountId: envWabaId,
    phoneNumberId: envPhoneNumberId,
    accessToken: envAccessToken,
    templateName: envTemplateName || 'payment_reminder_weekly',
    templateLanguage: envTemplateLang || 'hi',
    webhookVerifyToken: envWebhookToken,
    verifiedTestNumber: envTestNumber,
    sandboxMode: parseBoolEnv(env.WHATSAPP_SANDBOX_MODE, !envAccessToken),
  };

  const secretEncryptionKeyMaterial = (
    env.WHATSAPP_SECRET_ENCRYPTION_KEY ||
    env.SESSION_SIGNING_SECRET ||
    env.API_AUTH_TOKEN ||
    ''
  ).trim();

  function deriveSecretsAesKey(): Buffer | null {
    if (!secretEncryptionKeyMaterial) return null;
    return crypto
      .createHash('sha256')
      .update(`arjun-groceries-wa-secrets:${secretEncryptionKeyMaterial}`, 'utf-8')
      .digest();
  }

  function encryptSecretsForDisk(secrets: {
    accessToken?: string;
    webhookVerifyToken?: string;
  }): EncryptedWhatsAppSecrets | undefined {
    const key = deriveSecretsAesKey();
    if (!key) return undefined;
    const accessToken = (secrets.accessToken || '').trim();
    const webhookVerifyToken = (secrets.webhookVerifyToken || '').trim();
    if (!accessToken && !webhookVerifyToken) return undefined;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify({ accessToken, webhookVerifyToken });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      cipher: 'AES-256-GCM',
      ivBase64: iv.toString('base64'),
      tagBase64: tag.toString('base64'),
      ciphertextBase64: encrypted.toString('base64'),
    };
  }

  function decryptSecretsFromDisk(
    blob: EncryptedWhatsAppSecrets | undefined
  ): { accessToken?: string; webhookVerifyToken?: string } {
    if (!blob || blob.cipher !== 'AES-256-GCM') return {};
    const key = deriveSecretsAesKey();
    if (!key) return {};
    try {
      const iv = Buffer.from(blob.ivBase64, 'base64');
      const tag = Buffer.from(blob.tagBase64, 'base64');
      const ciphertext = Buffer.from(blob.ciphertextBase64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
      const parsed = JSON.parse(decrypted) as { accessToken?: string; webhookVerifyToken?: string };
      return {
        accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken.trim() : undefined,
        webhookVerifyToken:
          typeof parsed.webhookVerifyToken === 'string' ? parsed.webhookVerifyToken.trim() : undefined,
      };
    } catch {
      return {};
    }
  }

  // Tracks only secrets supplied dynamically via runtime config updates (never re-persisting env secrets)
  let runtimeOverrideSecrets: { accessToken?: string; webhookVerifyToken?: string } = {};

  function buildSanitizedPersistedState(state: RuntimeServerState): PersistedServerState {
    const {
      accessToken: _stripAccessToken,
      webhookVerifyToken: _stripWebhookToken,
      ...persistedConfig
    } = state.config;

    const encryptedSecrets = encryptSecretsForDisk(runtimeOverrideSecrets);

    return {
      config: persistedConfig,
      ...(encryptedSecrets ? { encryptedSecrets } : {}),
      batches: state.batches,
      auditLogs: state.auditLogs,
      sentIdempotencyKeys: state.sentIdempotencyKeys,
      lastSchedulerRunWeekId: state.lastSchedulerRunWeekId,
      storeSnapshot: state.storeSnapshot,
    };
  }

  function writeStateFileAtomically(payload: PersistedServerState): void {
    const dir = path.dirname(stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${stateFilePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tempPath, stateFilePath);
    try {
      fs.chmodSync(stateFilePath, 0o600);
    } catch {
      // Best-effort on platforms that ignore POSIX file modes
    }
  }

  function loadPersistedState(): RuntimeServerState {
    const emptyState: RuntimeServerState = {
      config: { ...defaultConfig },
      batches: [],
      auditLogs: [],
      sentIdempotencyKeys: {},
    };

    try {
      if (!fs.existsSync(stateFilePath)) {
        return emptyState;
      }
      const raw = fs.readFileSync(stateFilePath, 'utf-8');
      if (!raw.trim()) return emptyState;
      const parsed = JSON.parse(raw) as Partial<PersistedServerState> & {
        config?: Partial<InternalConfig>;
      };
      const persistedCfg: Partial<InternalConfig> = parsed.config || {};
      const decryptedSecrets = decryptSecretsFromDisk(parsed.encryptedSecrets);

      const legacyPlainAccess =
        typeof persistedCfg.accessToken === 'string' ? persistedCfg.accessToken.trim() : '';
      const legacyPlainWebhook =
        typeof persistedCfg.webhookVerifyToken === 'string'
          ? persistedCfg.webhookVerifyToken.trim()
          : '';
      const hadLegacyPlaintextSecrets = !!(legacyPlainAccess || legacyPlainWebhook);

      const effectiveAccessToken =
        envAccessToken || decryptedSecrets.accessToken || legacyPlainAccess || '';
      const effectiveWebhookToken =
        envWebhookToken || decryptedSecrets.webhookVerifyToken || legacyPlainWebhook || '';

      if (decryptedSecrets.accessToken) {
        runtimeOverrideSecrets.accessToken = decryptedSecrets.accessToken;
      }
      if (decryptedSecrets.webhookVerifyToken) {
        runtimeOverrideSecrets.webhookVerifyToken = decryptedSecrets.webhookVerifyToken;
      }

      const mergedConfig: InternalConfig = {
        ...defaultConfig,
        ...persistedCfg,
        businessAccountId: persistedCfg.businessAccountId || defaultConfig.businessAccountId,
        phoneNumberId: persistedCfg.phoneNumberId || defaultConfig.phoneNumberId,
        accessToken: effectiveAccessToken,
        templateName: persistedCfg.templateName || defaultConfig.templateName,
        templateLanguage: persistedCfg.templateLanguage || defaultConfig.templateLanguage,
        webhookVerifyToken: effectiveWebhookToken,
        verifiedTestNumber:
          persistedCfg.verifiedTestNumber !== undefined
            ? persistedCfg.verifiedTestNumber
            : defaultConfig.verifiedTestNumber,
        sandboxMode:
          persistedCfg.sandboxMode !== undefined
            ? persistedCfg.sandboxMode
            : defaultConfig.sandboxMode,
      };

      const loadedState: RuntimeServerState = {
        config: mergedConfig,
        batches: Array.isArray(parsed.batches) ? parsed.batches : [],
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
        sentIdempotencyKeys:
          parsed.sentIdempotencyKeys && typeof parsed.sentIdempotencyKeys === 'object'
            ? parsed.sentIdempotencyKeys
            : {},
        lastSchedulerRunWeekId: parsed.lastSchedulerRunWeekId,
        storeSnapshot: parsed.storeSnapshot,
      };

      // Immediately scrub any legacy plaintext tokens detected in existing file
      if (hadLegacyPlaintextSecrets) {
        writeStateFileAtomically(buildSanitizedPersistedState(loadedState));
      }

      return loadedState;
    } catch (err) {
      safeLogError('WhatsAppService:loadPersistedState', err, [
        envAccessToken,
        envWebhookToken,
      ]);
      return emptyState;
    }
  }

  const serverState: RuntimeServerState = loadPersistedState();

  function persistState(): void {
    try {
      const sanitizedPayload = buildSanitizedPersistedState(serverState);
      writeStateFileAtomically(sanitizedPayload);
    } catch (err) {
      safeLogError('WhatsAppService:persistState', err, [
        serverState.config.accessToken,
        serverState.config.webhookVerifyToken,
      ]);
    }
  }

  function logWhatsAppAudit(entry: Omit<WhatsAppAuditLog, 'id' | 'timestamp'>): void {
    const log: WhatsAppAuditLog = {
      ...entry,
      id: `wlog-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    serverState.auditLogs.unshift(log);
    if (serverState.auditLogs.length > 500) {
      serverState.auditLogs.length = 500;
    }
    persistState();
  }

  function getSanitizedConfig(): WhatsAppApiConfig {
    const cfg = serverState.config;
    const hasAccessToken = !!cfg.accessToken && cfg.accessToken.trim().length > 0;
    const hasWebhookVerifyToken =
      !!cfg.webhookVerifyToken && cfg.webhookVerifyToken.trim().length > 0;
    const isConfigured = !!(cfg.phoneNumberId && (hasAccessToken || cfg.sandboxMode));

    return {
      businessAccountId: cfg.businessAccountId,
      phoneNumberId: cfg.phoneNumberId,
      accessTokenMasked: hasAccessToken ? maskSecret(cfg.accessToken) : '',
      hasAccessToken,
      webhookVerifyTokenMasked: hasWebhookVerifyToken ? maskSecret(cfg.webhookVerifyToken) : '',
      hasWebhookVerifyToken,
      configuredViaEnv,
      templateName: cfg.templateName,
      templateLanguage: cfg.templateLanguage,
      templateStatus: cfg.templateStatus || 'UNKNOWN',
      templateVerifiedAt: cfg.templateVerifiedAt,
      verifiedBusinessName: cfg.verifiedBusinessName,
      verifiedDisplayPhone: cfg.verifiedDisplayPhone,
      verifiedTestNumber: cfg.verifiedTestNumber || '',
      isConfigured,
      sandboxMode: cfg.sandboxMode,
      lastTestedAt: cfg.lastTestedAt,
      testStatus: cfg.testStatus,
      testErrorMessage: cfg.testErrorMessage,
    };
  }

  function verifyWebhookToken(candidateToken: string | undefined): boolean {
    const expected = (serverState.config.webhookVerifyToken || '').trim();
    if (!expected || !candidateToken) return false;
    return timingSafeEqualStrings(candidateToken.trim(), expected);
  }

  function updateConfig(updates: {
    businessAccountId?: string;
    phoneNumberId?: string;
    accessToken?: string;
    templateName?: string;
    templateLanguage?: string;
    webhookVerifyToken?: string;
    verifiedTestNumber?: string;
    sandboxMode?: boolean;
  }): WhatsAppApiConfig {
    if (updates.businessAccountId !== undefined) {
      serverState.config.businessAccountId = updates.businessAccountId.trim();
    }
    if (updates.phoneNumberId !== undefined) {
      serverState.config.phoneNumberId = updates.phoneNumberId.trim();
    }
    if (updates.accessToken !== undefined && updates.accessToken.trim() !== '') {
      const cleanToken = updates.accessToken.trim();
      serverState.config.accessToken = cleanToken;
      runtimeOverrideSecrets.accessToken = cleanToken;
    }
    if (updates.templateName !== undefined) {
      serverState.config.templateName = updates.templateName.trim();
      serverState.config.templateStatus = 'UNKNOWN';
      serverState.config.templateVerifiedAt = undefined;
    }
    if (updates.templateLanguage !== undefined) {
      serverState.config.templateLanguage = updates.templateLanguage.trim();
      serverState.config.templateStatus = 'UNKNOWN';
      serverState.config.templateVerifiedAt = undefined;
    }
    if (updates.webhookVerifyToken !== undefined && updates.webhookVerifyToken.trim() !== '') {
      const cleanWebhook = updates.webhookVerifyToken.trim();
      serverState.config.webhookVerifyToken = cleanWebhook;
      runtimeOverrideSecrets.webhookVerifyToken = cleanWebhook;
    }
    if (updates.verifiedTestNumber !== undefined) {
      serverState.config.verifiedTestNumber = updates.verifiedTestNumber.trim();
    }
    if (updates.sandboxMode !== undefined) {
      serverState.config.sandboxMode = Boolean(updates.sandboxMode);
    }

    logWhatsAppAudit({
      action: 'CONFIG_UPDATED',
      details: `Updated WhatsApp API configuration. Mode: ${serverState.config.sandboxMode ? 'SANDBOX' : 'LIVE'}. Phone ID: ${serverState.config.phoneNumberId || 'Not Set'}`,
    });

    return getSanitizedConfig();
  }

  function updateStoreSnapshot(snapshot: StoreSnapshotPayload): StoreSnapshotPayload {
    const cleanSnapshot: StoreSnapshotPayload = {
      sales: Array.isArray(snapshot.sales) ? snapshot.sales : [],
      customers: Array.isArray(snapshot.customers) ? snapshot.customers : [],
      customerTransactions: Array.isArray(snapshot.customerTransactions)
        ? snapshot.customerTransactions
        : [],
      storeProfile: snapshot.storeProfile,
      updatedAt: new Date().toISOString(),
    };
    serverState.storeSnapshot = cleanSnapshot;
    persistState();
    return cleanSnapshot;
  }

  function getLatestStoreSnapshot(): StoreSnapshotPayload | undefined {
    return serverState.storeSnapshot;
  }

  /**
   * Tests Meta WhatsApp Cloud API phone endpoint & approved message template.
   * Never calls Meta Graph API when sandboxMode is enabled.
   */
  async function testConnection(): Promise<{
    success: boolean;
    message: string;
    config: WhatsAppApiConfig;
    details?: Record<string, unknown>;
  }> {
    const cfg = serverState.config;

    if (cfg.sandboxMode) {
      cfg.lastTestedAt = new Date().toISOString();
      cfg.testStatus = 'SUCCESS';
      cfg.testErrorMessage = undefined;
      cfg.templateStatus = 'UNKNOWN';
      logWhatsAppAudit({
        action: 'CONFIG_UPDATED',
        details: 'Connection test passed in Sandbox / Test mode (no live Meta API call executed)',
        status: 'SUCCESS',
      });
      return {
        success: true,
        message:
          'Sandbox / Test Mode Active: Local simulation ready without calling Meta Graph API.',
        config: getSanitizedConfig(),
      };
    }

    if (!cfg.phoneNumberId || !cfg.accessToken || !cfg.businessAccountId || !cfg.templateName) {
      cfg.lastTestedAt = new Date().toISOString();
      cfg.testStatus = 'FAILED';
      cfg.testErrorMessage =
        'WABA ID, Phone Number ID, System User Access Token, and Template Name are all required for live verification.';
      logWhatsAppAudit({
        action: 'CONFIG_UPDATED',
        details: `Connection test blocked: ${cfg.testErrorMessage}`,
        status: 'FAILED',
      });
      return {
        success: false,
        message: cfg.testErrorMessage,
        config: getSanitizedConfig(),
      };
    }

    try {
      // 1. Verify Phone Number ID & Business Display Info
      const phoneUrl = `${META_GRAPH_BASE}/${encodeURIComponent(cfg.phoneNumberId)}?fields=verified_name,display_phone_number,quality_rating`;
      const phoneRes = await fetchFn(phoneUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
        },
      });
      const phoneData: any = await phoneRes.json();

      if (!phoneRes.ok) {
        const errorMsg =
          phoneData?.error?.message || `HTTP ${phoneRes.status} from Meta Phone Number lookup`;
        cfg.lastTestedAt = new Date().toISOString();
        cfg.testStatus = 'FAILED';
        cfg.testErrorMessage = errorMsg;
        logWhatsAppAudit({
          action: 'CONFIG_UPDATED',
          details: `Live phone verification failed: ${errorMsg}`,
          status: 'FAILED',
        });
        return {
          success: false,
          message: `Meta API Error: ${errorMsg}`,
          config: getSanitizedConfig(),
          details: { errorCode: phoneData?.error?.code, fbtraceId: phoneData?.error?.fbtrace_id },
        };
      }

      cfg.verifiedBusinessName = phoneData.verified_name || undefined;
      cfg.verifiedDisplayPhone = phoneData.display_phone_number || undefined;

      // 2. Verify Template existence, language match, and APPROVED status on WABA ID
      const tmplUrl = `${META_GRAPH_BASE}/${encodeURIComponent(cfg.businessAccountId)}/message_templates?name=${encodeURIComponent(cfg.templateName)}`;
      const tmplRes = await fetchFn(tmplUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
        },
      });
      const tmplData: any = await tmplRes.json();

      if (!tmplRes.ok) {
        const errorMsg =
          tmplData?.error?.message || `HTTP ${tmplRes.status} while checking WABA message templates`;
        cfg.lastTestedAt = new Date().toISOString();
        cfg.testStatus = 'FAILED';
        cfg.templateStatus = 'UNKNOWN';
        cfg.testErrorMessage = errorMsg;
        logWhatsAppAudit({
          action: 'CONFIG_UPDATED',
          details: `Live template verification failed: ${errorMsg}`,
          status: 'FAILED',
        });
        return {
          success: false,
          message: `Template Check Failed: ${errorMsg}`,
          config: getSanitizedConfig(),
          details: { errorCode: tmplData?.error?.code, fbtraceId: tmplData?.error?.fbtrace_id },
        };
      }

      const templates: any[] = Array.isArray(tmplData?.data) ? tmplData.data : [];
      const exactNameTemplates = templates.filter((t) => t?.name === cfg.templateName);
      const langMatched = exactNameTemplates.find((t) =>
        languagesMatch(t?.language || '', cfg.templateLanguage)
      );
      const matchedTemplate = langMatched || exactNameTemplates[0];

      cfg.templateVerifiedAt = new Date().toISOString();

      if (!matchedTemplate) {
        cfg.templateStatus = 'NOT_FOUND';
        cfg.lastTestedAt = new Date().toISOString();
        cfg.testStatus = 'FAILED';
        cfg.testErrorMessage = `Template "${cfg.templateName}" was not found under WABA ${cfg.businessAccountId}.`;
        logWhatsAppAudit({
          action: 'CONFIG_UPDATED',
          details: cfg.testErrorMessage,
          status: 'FAILED',
        });
        return {
          success: false,
          message: cfg.testErrorMessage,
          config: getSanitizedConfig(),
        };
      }

      if (!langMatched) {
        cfg.templateStatus = (matchedTemplate.status as any) || 'UNKNOWN';
        cfg.lastTestedAt = new Date().toISOString();
        cfg.testStatus = 'FAILED';
        cfg.testErrorMessage = `Template "${cfg.templateName}" exists for language "${matchedTemplate.language}" but configured language is "${cfg.templateLanguage}".`;
        logWhatsAppAudit({
          action: 'CONFIG_UPDATED',
          details: cfg.testErrorMessage,
          status: 'FAILED',
        });
        return {
          success: false,
          message: cfg.testErrorMessage,
          config: getSanitizedConfig(),
        };
      }

      const rawStatus = String(matchedTemplate.status || 'UNKNOWN').toUpperCase();
      if (rawStatus === 'APPROVED' || rawStatus === 'PENDING' || rawStatus === 'REJECTED') {
        cfg.templateStatus = rawStatus;
      } else {
        cfg.templateStatus = 'UNKNOWN';
      }

      if (rawStatus !== 'APPROVED') {
        cfg.lastTestedAt = new Date().toISOString();
        cfg.testStatus = 'FAILED';
        cfg.testErrorMessage = `Template "${cfg.templateName}" (${matchedTemplate.language}) status is ${rawStatus}. Only APPROVED templates can be sent.`;
        logWhatsAppAudit({
          action: 'CONFIG_UPDATED',
          details: cfg.testErrorMessage,
          status: 'FAILED',
        });
        return {
          success: false,
          message: cfg.testErrorMessage,
          config: getSanitizedConfig(),
        };
      }

      cfg.lastTestedAt = new Date().toISOString();
      cfg.testStatus = 'SUCCESS';
      cfg.testErrorMessage = undefined;

      logWhatsAppAudit({
        action: 'CONFIG_UPDATED',
        details: `Live Meta verification passed for ${cfg.verifiedDisplayPhone || cfg.phoneNumberId} & APPROVED template "${cfg.templateName}" (${matchedTemplate.language})`,
        status: 'SUCCESS',
      });

      return {
        success: true,
        message: `Connected (${cfg.verifiedDisplayPhone || cfg.verifiedBusinessName || cfg.phoneNumberId}) · Template "${cfg.templateName}" APPROVED (${matchedTemplate.language})`,
        config: getSanitizedConfig(),
        details: {
          verifiedName: phoneData.verified_name,
          displayPhoneNumber: phoneData.display_phone_number,
          qualityRating: phoneData.quality_rating,
          templateName: matchedTemplate.name,
          templateLanguage: matchedTemplate.language,
          templateStatus: rawStatus,
        },
      };
    } catch (err: any) {
      const safeErrMsg = redactSensitiveText(
        err?.message || 'Network error contacting Meta Graph API',
        [cfg.accessToken, cfg.webhookVerifyToken]
      );
      cfg.lastTestedAt = new Date().toISOString();
      cfg.testStatus = 'FAILED';
      cfg.testErrorMessage = safeErrMsg;
      logWhatsAppAudit({
        action: 'CONFIG_UPDATED',
        details: `Live Meta test network exception: ${safeErrMsg}`,
        status: 'FAILED',
      });
      return {
        success: false,
        message: `Network connection failed: ${safeErrMsg}`,
        config: getSanitizedConfig(),
      };
    }
  }

  /**
   * Executes Meta WhatsApp template POST with 429 / 5xx retry & exponential backoff.
   * NEVER executes when sandboxMode is enabled.
   */
  async function postMetaTemplateMessageWithRetry(
    toE164: string,
    bodyParams: string[]
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    status: 'ACCEPTED' | 'FAILED';
    attempts: number;
    apiResponseSummary: WhatsAppApiResponseSummary;
  }> {
    const cfg = serverState.config;

    if (cfg.sandboxMode) {
      throw new Error('Safety violation blocked: Live Meta API request attempted while Sandbox Mode is active.');
    }

    if (!cfg.phoneNumberId || !cfg.accessToken) {
      return {
        success: false,
        status: 'FAILED',
        attempts: 0,
        error:
          'WhatsApp API is not configured. Add Phone Number ID and System User Access Token first.',
        apiResponseSummary: {
          attempts: 0,
          sandboxSimulated: false,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const url = `${META_GRAPH_BASE}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toE164,
      type: 'template',
      template: {
        name: cfg.templateName || 'payment_reminder_weekly',
        language: {
          code: cfg.templateLanguage || 'hi',
        },
        components: [
          {
            type: 'body',
            parameters: bodyParams.map((txt) => ({
              type: 'text',
              text: (txt || '-').trim() || '-',
            })),
          },
        ],
      },
    };

    const maxAttempts = 3; // 1 initial attempt + up to 2 retries on 429/5xx/network
    let lastError = 'Unknown WhatsApp Cloud API error';
    let lastSummary: WhatsAppApiResponseSummary = {
      attempts: 0,
      sandboxSimulated: false,
      timestamp: new Date().toISOString(),
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfg.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        let data: any = {};
        try {
          data = await response.json();
        } catch {
          data = {};
        }

        const nowTs = new Date().toISOString();

        if (response.ok) {
          const messageId = data?.messages?.[0]?.id || `wamid.${Date.now()}`;
          const recipientWaId = data?.contacts?.[0]?.wa_id;
          return {
            success: true,
            messageId,
            status: 'ACCEPTED',
            attempts: attempt,
            apiResponseSummary: {
              httpStatus: response.status,
              wabaMessageId: messageId,
              messagingProduct: data?.messaging_product || 'whatsapp',
              recipientWaId,
              attempts: attempt,
              sandboxSimulated: false,
              timestamp: nowTs,
            },
          };
        }

        const errorObj = data?.error || {};
        lastError = errorObj.message || `HTTP ${response.status} from Meta WhatsApp Cloud API`;
        lastSummary = {
          httpStatus: response.status,
          errorCode: typeof errorObj.code === 'number' ? errorObj.code : undefined,
          errorSubcode: typeof errorObj.error_subcode === 'number' ? errorObj.error_subcode : undefined,
          fbtraceId: typeof errorObj.fbtrace_id === 'string' ? errorObj.fbtrace_id : undefined,
          attempts: attempt,
          sandboxSimulated: false,
          timestamp: nowTs,
        };

        const isRetryable = response.status === 429 || response.status >= 500;
        if (isRetryable && attempt < maxAttempts) {
          const retryAfterHeader = response.headers?.get?.('retry-after');
          const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
          const waitMs =
            Number.isFinite(retryAfterSec) && retryAfterSec > 0
              ? Math.min(retryAfterSec * 1000, 10000)
              : 500 * Math.pow(2, attempt - 1);
          await sleepFn(waitMs);
          continue;
        }

        return {
          success: false,
          status: 'FAILED',
          error: lastError,
          attempts: attempt,
          apiResponseSummary: lastSummary,
        };
      } catch (err: any) {
        lastError = redactSensitiveText(
          err?.message || 'Network exception during Meta API call',
          [cfg.accessToken, cfg.webhookVerifyToken]
        );
        lastSummary = {
          attempts: attempt,
          sandboxSimulated: false,
          timestamp: new Date().toISOString(),
        };

        if (attempt < maxAttempts) {
          await sleepFn(500 * Math.pow(2, attempt - 1));
          continue;
        }

        return {
          success: false,
          status: 'FAILED',
          error: lastError,
          attempts: attempt,
          apiResponseSummary: lastSummary,
        };
      }
    }

    return {
      success: false,
      status: 'FAILED',
      error: lastError,
      attempts: maxAttempts,
      apiResponseSummary: lastSummary,
    };
  }

  /**
   * Sends a single customer reminder via Sandbox or Meta WhatsApp Cloud API
   */
  async function sendWhatsAppMessage(
    item: CustomerReminderItem,
    storeName: string,
    upiId: string
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    status: 'SENT' | 'FAILED' | 'ACCEPTED';
    attempts: number;
    apiResponseSummary: WhatsAppApiResponseSummary;
  }> {
    const cfg = serverState.config;
    const nowTs = new Date().toISOString();

    const phoneRes = formatWhatsAppPhoneNumber(item.phone);
    if (!phoneRes.isValid) {
      return {
        success: false,
        status: 'FAILED',
        attempts: 0,
        error: `Invalid recipient phone number: ${item.phone}`,
        apiResponseSummary: {
          attempts: 0,
          sandboxSimulated: cfg.sandboxMode,
          timestamp: nowTs,
        },
      };
    }

    if (cfg.sandboxMode) {
      const simulatedMsgId = `wamid.SIMULATED_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const apiResponseSummary: WhatsAppApiResponseSummary = {
        httpStatus: 200,
        wabaMessageId: simulatedMsgId,
        messagingProduct: 'whatsapp',
        recipientWaId: phoneRes.formattedE164,
        attempts: 1,
        sandboxSimulated: true,
        timestamp: nowTs,
      };

      logWhatsAppAudit({
        action: 'MESSAGE_SENT',
        customerId: item.customerId,
        customerName: item.customerName,
        phone: phoneRes.formattedE164,
        wabaMessageId: simulatedMsgId,
        status: 'SENT (Sandbox)',
        details: `Sandbox simulated WhatsApp template delivery to ${item.customerName} for ₹${item.totalOutstanding}`,
      });

      return {
        success: true,
        messageId: simulatedMsgId,
        status: 'SENT',
        attempts: 1,
        apiResponseSummary,
      };
    }

    const invoiceSummary = item.invoices
      .map((inv) => `${inv.invoiceNo} (Rs.${inv.outstandingAmount})`)
      .join(', ');

    const bodyParams = [
      item.customerName,
      storeName || 'Arjun Groceries',
      String(item.totalOutstanding),
      invoiceSummary || 'Pending Invoices',
      upiId || storeName || 'Store Counter',
    ];

    const liveResult = await postMetaTemplateMessageWithRetry(phoneRes.formattedE164, bodyParams);

    if (liveResult.success) {
      logWhatsAppAudit({
        action: 'MESSAGE_SENT',
        customerId: item.customerId,
        customerName: item.customerName,
        phone: phoneRes.formattedE164,
        wabaMessageId: liveResult.messageId,
        status: 'ACCEPTED',
        details: `WhatsApp template accepted by Meta for ${item.customerName} (WABA ID: ${liveResult.messageId}, attempts: ${liveResult.attempts})`,
      });
    } else {
      logWhatsAppAudit({
        action: 'MESSAGE_FAILED',
        customerId: item.customerId,
        customerName: item.customerName,
        phone: phoneRes.formattedE164,
        status: 'FAILED',
        details: `Failed to send to ${item.customerName} after ${liveResult.attempts} attempt(s): ${liveResult.error}`,
      });
    }

    return liveResult;
  }

  /**
   * Manual Test Mode: sends a single template message ONLY to the specified verified test number.
   * Does not modify customer ledger balances or batch idempotency keys.
   */
  async function sendTestMessage(params: {
    testPhoneNumber?: string;
    customerName?: string;
    storeName?: string;
    outstandingAmount?: number;
    upiId?: string;
  }): Promise<{
    success: boolean;
    message: string;
    messageId?: string;
    formattedPhone?: string;
    sandboxSimulated: boolean;
    apiResponseSummary?: WhatsAppApiResponseSummary;
  }> {
    const cfg = serverState.config;
    const rawTarget = (params.testPhoneNumber || cfg.verifiedTestNumber || '').trim();
    const phoneCheck = formatWhatsAppPhoneNumber(rawTarget);

    if (!phoneCheck.isValid) {
      return {
        success: false,
        message: phoneCheck.error || 'Please enter a valid verified test WhatsApp number.',
        sandboxSimulated: cfg.sandboxMode,
      };
    }

    // Remember verified test number in config for convenience
    if (params.testPhoneNumber && params.testPhoneNumber.trim()) {
      cfg.verifiedTestNumber = params.testPhoneNumber.trim();
      persistState();
    }

    const sampleCustomer = params.customerName?.trim() || 'Test Customer';
    const sampleStore = params.storeName?.trim() || 'Arjun Groceries';
    const sampleAmount = Number(params.outstandingAmount) > 0 ? Number(params.outstandingAmount) : 450;
    const sampleUpi = params.upiId?.trim() || sampleStore;
    const nowTs = new Date().toISOString();

    if (cfg.sandboxMode) {
      const simId = `wamid.TEST_SIM_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const apiResponseSummary: WhatsAppApiResponseSummary = {
        httpStatus: 200,
        wabaMessageId: simId,
        messagingProduct: 'whatsapp',
        recipientWaId: phoneCheck.formattedE164,
        attempts: 1,
        sandboxSimulated: true,
        timestamp: nowTs,
      };
      logWhatsAppAudit({
        action: 'TEST_MESSAGE_SENT',
        phone: phoneCheck.formattedE164,
        wabaMessageId: simId,
        status: 'SENT (Sandbox)',
        details: `Manual test template simulated in Sandbox for +${phoneCheck.formattedE164} (no real Meta message sent)`,
      });
      return {
        success: true,
        message: `Sandbox Test Simulated for +${phoneCheck.formattedE164} (Ref: ${simId}). Switch off Sandbox Mode to send live via Meta.`,
        messageId: simId,
        formattedPhone: phoneCheck.formattedE164,
        sandboxSimulated: true,
        apiResponseSummary,
      };
    }

    const res = await postMetaTemplateMessageWithRetry(phoneCheck.formattedE164, [
      sampleCustomer,
      sampleStore,
      String(sampleAmount),
      'TEST-BILL-101 (Rs.450)',
      sampleUpi,
    ]);

    if (res.success) {
      logWhatsAppAudit({
        action: 'TEST_MESSAGE_SENT',
        phone: phoneCheck.formattedE164,
        wabaMessageId: res.messageId,
        status: 'ACCEPTED',
        details: `Live manual test template sent to +${phoneCheck.formattedE164} (WABA ID: ${res.messageId})`,
      });
      return {
        success: true,
        message: `Live WhatsApp test template accepted for +${phoneCheck.formattedE164} (WABA ID: ${res.messageId})`,
        messageId: res.messageId,
        formattedPhone: phoneCheck.formattedE164,
        sandboxSimulated: false,
        apiResponseSummary: res.apiResponseSummary,
      };
    }

    logWhatsAppAudit({
      action: 'TEST_MESSAGE_FAILED',
      phone: phoneCheck.formattedE164,
      status: 'FAILED',
      details: `Live manual test failed for +${phoneCheck.formattedE164}: ${res.error}`,
    });

    return {
      success: false,
      message: res.error || 'Failed to send test WhatsApp message',
      formattedPhone: phoneCheck.formattedE164,
      sandboxSimulated: false,
      apiResponseSummary: res.apiResponseSummary,
    };
  }

  /**
   * Generates or retrieves the weekly batch, carrying over persisted idempotency locks
   * so already-sent customers cannot be resent if a batch is regenerated.
   */
  function generateOrGetWeeklyBatch(
    sales: SaleRecord[],
    customers: Customer[],
    customerTransactions: CustomerTransaction[],
    storeProfile: StoreProfile,
    forceRegenerate = false,
    referenceDate: Date = new Date()
  ): WhatsAppReminderBatch {
    const windowInfo = getWeeklyISTWindow(referenceDate);
    const idempotencyKey = `batch_key_${storeProfile.id || 'store'}_${windowInfo.windowStartISO.slice(0, 10)}_${windowInfo.windowEndISO.slice(0, 10)}`;

    const existingIndex = serverState.batches.findIndex((b) => b.idempotencyKey === idempotencyKey);
    if (!forceRegenerate && existingIndex >= 0) {
      return serverState.batches[existingIndex];
    }

    const newBatch = createWeeklyReminderBatch(
      sales,
      customers,
      customerTransactions,
      storeProfile,
      referenceDate
    );

    // Preserve sent state if any customer in this window already received a message
    newBatch.items = newBatch.items.map((item) => {
      const priorSent = serverState.sentIdempotencyKeys[item.idempotencyKey];
      if (priorSent) {
        return {
          ...item,
          status: 'SENT',
          wabaMessageId: priorSent.wabaMessageId,
          sentAt: priorSent.sentAt,
          approved: false,
        };
      }
      return item;
    });

    const hasSentItems = newBatch.items.some((item) => ALREADY_DISPATCHED_STATUSES.has(item.status));
    const hasPendingEligible = newBatch.items.some(
      (item) => item.eligibilityStatus === 'ELIGIBLE' && !ALREADY_DISPATCHED_STATUSES.has(item.status)
    );
    if (hasSentItems && !hasPendingEligible) {
      newBatch.status = 'COMPLETED';
    }

    if (existingIndex >= 0) {
      serverState.batches[existingIndex] = newBatch;
    } else {
      serverState.batches.unshift(newBatch);
      if (serverState.batches.length > 100) {
        serverState.batches.length = 100;
      }
    }

    logWhatsAppAudit({
      action: 'BATCH_GENERATED',
      batchId: newBatch.id,
      details: `Prepared weekly reminder batch ${newBatch.id} for window ${newBatch.dateWindowStart.slice(0, 10)} to ${newBatch.dateWindowEnd.slice(0, 10)}. Eligible: ${newBatch.totalEligibleCustomers}, Outstanding: ₹${newBatch.totalOutstandingAmount}`,
    });

    return newBatch;
  }

  function getBatchesAndLogs(): {
    batches: WhatsAppReminderBatch[];
    auditLogs: WhatsAppAuditLog[];
    nextSchedule: {
      nextExecutionISO: string;
      day: string;
      time: string;
      timezone: string;
    };
  } {
    const windowInfo = getWeeklyISTWindow();
    return {
      batches: serverState.batches,
      auditLogs: serverState.auditLogs,
      nextSchedule: {
        nextExecutionISO: windowInfo.nextScheduledExecutionISO,
        day: 'Sunday',
        time: '12:00 PM',
        timezone: 'Asia/Kolkata (IST)',
      },
    };
  }

  function updateBatchApproval(
    batchId: string,
    approvedCustomerIds: string[],
    approvedBy: string = 'Store Owner'
  ): WhatsAppReminderBatch | null {
    const batch = serverState.batches.find((b) => b.id === batchId);
    if (!batch) return null;

    const approvedSet = new Set(approvedCustomerIds);

    batch.items.forEach((item) => {
      if (ALREADY_DISPATCHED_STATUSES.has(item.status) || serverState.sentIdempotencyKeys[item.idempotencyKey]) {
        item.approved = false;
        return;
      }
      if (approvedSet.has(item.customerId) && item.eligibilityStatus === 'ELIGIBLE') {
        item.approved = true;
        item.status = 'APPROVED';
      } else {
        item.approved = false;
        item.status = 'EXCLUDED';
      }
    });

    batch.status = 'AWAITING_APPROVAL';
    batch.approvedAt = new Date().toISOString();
    batch.approvedBy = approvedBy;
    batch.updatedAt = new Date().toISOString();

    logWhatsAppAudit({
      action: 'BATCH_APPROVED',
      batchId: batch.id,
      details: `Batch approved by ${approvedBy} for ${approvedCustomerIds.length} customers`,
      performedBy: approvedBy,
    });

    return batch;
  }

  function cancelBatch(
    batchId: string,
    reason = 'Cancelled by owner'
  ): WhatsAppReminderBatch | null {
    const batch = serverState.batches.find((b) => b.id === batchId);
    if (!batch) return null;

    batch.status = 'CANCELLED';
    batch.cancelledAt = new Date().toISOString();
    batch.notes = `${batch.notes || ''} [Cancelled: ${reason}]`;
    batch.updatedAt = new Date().toISOString();

    logWhatsAppAudit({
      action: 'BATCH_CANCELLED',
      batchId: batch.id,
      details: `Batch ${batch.id} was cancelled. Reason: ${reason}`,
    });

    return batch;
  }

  /**
   * Dispatches an explicitly approved batch with:
   * - Approval enforcement
   * - Persistent idempotency duplicate-send lock
   * - Live balance & partial-payment re-validation before each send
   * - Rate-limit pacing & retry support
   */
  async function dispatchBatch(params: {
    batchId: string;
    storeName?: string;
    upiId?: string;
    currentCustomers?: Customer[];
    currentTransactions?: CustomerTransaction[];
    currentSales?: SaleRecord[];
  }): Promise<{
    found: boolean;
    conflict?: boolean;
    requiresApproval?: boolean;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    batch?: WhatsAppReminderBatch;
    error?: string;
  }> {
    const batch = serverState.batches.find((b) => b.id === params.batchId);
    if (!batch) {
      return {
        found: false,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        error: 'Batch not found',
      };
    }

    if (batch.status === 'SENDING') {
      return {
        found: true,
        conflict: true,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        batch,
        error: 'Batch is already in sending state',
      };
    }

    if (batch.status === 'CANCELLED') {
      return {
        found: true,
        requiresApproval: true,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        batch,
        error: 'Cannot dispatch a cancelled batch.',
      };
    }

    if (!batch.approvedAt) {
      return {
        found: true,
        requiresApproval: true,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        batch,
        error: 'Explicit owner approval is required before sending WhatsApp reminders.',
      };
    }

    batch.status = 'SENDING';
    batch.updatedAt = new Date().toISOString();
    persistState();

    const effectiveCustomers =
      params.currentCustomers && params.currentCustomers.length > 0
        ? params.currentCustomers
        : serverState.storeSnapshot?.customers || [];
    const effectiveTransactions =
      params.currentTransactions && params.currentTransactions.length > 0
        ? params.currentTransactions
        : serverState.storeSnapshot?.customerTransactions || [];
    const effectiveSales =
      params.currentSales && params.currentSales.length > 0
        ? params.currentSales
        : serverState.storeSnapshot?.sales || [];

    const customerMap = new Map<string, Customer>();
    effectiveCustomers.forEach((c) => customerMap.set(c.id, c));

    const salesByCustomer = new Map<string, SaleRecord[]>();
    effectiveSales.forEach((s) => {
      if (!s.customerId) return;
      const arr = salesByCustomer.get(s.customerId) || [];
      arr.push(s);
      salesByCustomer.set(s.customerId, arr);
    });

    const storeName =
      params.storeName || serverState.storeSnapshot?.storeProfile?.storeName || 'Arjun Groceries';
    const upiId = params.upiId || serverState.storeSnapshot?.storeProfile?.upiId || '';

    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    const itemsToSend = batch.items.filter(
      (item) => item.approved && item.eligibilityStatus === 'ELIGIBLE'
    );

    for (const item of itemsToSend) {
      // 0. Duplicate idempotency lock check
      const priorSent = serverState.sentIdempotencyKeys[item.idempotencyKey];
      if (ALREADY_DISPATCHED_STATUSES.has(item.status) || priorSent) {
        if (priorSent) {
          item.wabaMessageId = item.wabaMessageId || priorSent.wabaMessageId;
          item.sentAt = item.sentAt || priorSent.sentAt;
          if (!ALREADY_DISPATCHED_STATUSES.has(item.status)) {
            item.status = 'SENT';
          }
        }
        skippedCount++;
        continue;
      }

      // 1. Revalidate Customer Ledger Balance Before Sending
      const customer = customerMap.get(item.customerId);
      if (customer && customer.currentBalance <= 0) {
        item.status = 'EXCLUDED';
        item.approved = false;
        item.errorReason = 'Account settled after batch preview (Zero outstanding)';
        skippedCount++;
        continue;
      }

      if (customer && customer.whatsappConsent === false) {
        item.status = 'EXCLUDED';
        item.approved = false;
        item.errorReason = 'Customer opted out before dispatch';
        skippedCount++;
        continue;
      }

      // 2. Recalculate remaining balance per invoice
      let currentCustomerRemaining = 0;
      const custAllSales = customer ? salesByCustomer.get(customer.id) || [] : [];
      item.invoices = item.invoices.filter((inv) => {
        const saleMatch: SaleRecord =
          custAllSales.find((s) => s.id === inv.invoiceId) || {
            id: inv.invoiceId,
            invoiceNo: inv.invoiceNo,
            date: inv.date,
            customerId: item.customerId,
            amount: inv.originalAmount,
            paymentMethod: 'CREDIT',
            items: [],
            isCredit: true,
            createdAt: inv.date,
          };
        const balance = customer
          ? calculateInvoiceOutstanding(
              saleMatch,
              customer,
              effectiveTransactions,
              custAllSales.length > 0 ? custAllSales : undefined
            )
          : {
              originalAmount: inv.originalAmount,
              paidAmount: inv.paidAmount,
              outstandingAmount: inv.outstandingAmount,
            };

        if (balance.outstandingAmount > 0) {
          inv.paidAmount = balance.paidAmount;
          inv.outstandingAmount = balance.outstandingAmount;
          currentCustomerRemaining += balance.outstandingAmount;
          return true;
        }
        return false;
      });

      if (customer) {
        currentCustomerRemaining = Math.min(
          Math.round(currentCustomerRemaining * 100) / 100,
          Math.max(0, Number(customer.currentBalance) || 0)
        );
      }

      if (item.invoices.length === 0 || currentCustomerRemaining <= 0) {
        item.status = 'EXCLUDED';
        item.approved = false;
        item.errorReason = 'Invoices paid after preview (Zero outstanding)';
        skippedCount++;
        continue;
      }

      item.totalOutstanding = currentCustomerRemaining;
      item.status = 'SENDING';
      item.lastAttemptAt = new Date().toISOString();
      persistState();

      // 3. Send via Sandbox or Live Meta Cloud API (with retry)
      const sendResult = await sendWhatsAppMessage(item, storeName, upiId);
      item.attempts = (item.attempts || 0) + sendResult.attempts;
      item.apiResponseSummary = sendResult.apiResponseSummary;

      if (sendResult.success) {
        const sentAt = new Date().toISOString();
        item.status = sendResult.status; // 'SENT' in sandbox or 'ACCEPTED' in live
        item.wabaMessageId = sendResult.messageId;
        item.sentAt = sentAt;
        item.errorReason = undefined;
        serverState.sentIdempotencyKeys[item.idempotencyKey] = {
          wabaMessageId: sendResult.messageId,
          sentAt,
          batchId: batch.id,
          customerId: item.customerId,
        };
        sentCount++;
      } else {
        item.status = 'FAILED';
        item.errorReason = sendResult.error || 'Meta WhatsApp API failed to deliver';
        failedCount++;
      }

      persistState();

      // Gentle pacing between messages
      await sleepFn(serverState.config.sandboxMode ? 15 : 200);
    }

    if (failedCount > 0 && sentCount > 0) {
      batch.status = 'PARTIALLY_FAILED';
    } else if (failedCount > 0 && sentCount === 0) {
      batch.status = 'FAILED';
    } else {
      batch.status = 'COMPLETED';
    }

    batch.completedAt = new Date().toISOString();
    batch.updatedAt = new Date().toISOString();
    persistState();

    return {
      found: true,
      sentCount,
      failedCount,
      skippedCount,
      batch,
    };
  }

  function handleWebhookStatusUpdate(body: any): { processedCount: number } {
    let count = 0;
    try {
      const entries = body?.entry || [];
      for (const entry of entries) {
        const changes = entry?.changes || [];
        for (const change of changes) {
          const statuses = change?.value?.statuses || [];
          for (const st of statuses) {
            const wabaId = st.id;
            const status = String(st.status || '').toLowerCase();
            const recipientId = st.recipient_id;
            const tsIso = st.timestamp
              ? new Date(Number(st.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            for (const batch of serverState.batches) {
              const item = batch.items.find((i) => i.wabaMessageId === wabaId);
              if (item) {
                if (status === 'sent') {
                  item.status = 'SENT';
                } else if (status === 'delivered') {
                  item.status = 'DELIVERED';
                  item.deliveredAt = tsIso;
                } else if (status === 'read') {
                  item.status = 'READ';
                  item.readAt = tsIso;
                } else if (status === 'failed') {
                  item.status = 'FAILED';
                  item.errorReason =
                    st.errors?.[0]?.message || st.errors?.[0]?.title || 'Failed to deliver';
                }
                batch.updatedAt = new Date().toISOString();
                count++;
              }
            }

            logWhatsAppAudit({
              action: 'STATUS_WEBHOOK',
              phone: recipientId,
              wabaMessageId: wabaId,
              status,
              details: `Webhook status update: ${status.toUpperCase()} for message ${wabaId}`,
            });
          }
        }
      }
      if (count > 0) {
        persistState();
      }
    } catch (err) {
      safeLogError('WhatsAppService:webhook', err, [
        serverState.config.accessToken,
        serverState.config.webhookVerifyToken,
      ]);
    }

    return { processedCount: count };
  }

  let schedulerInterval: NodeJS.Timeout | null = null;

  function runSchedulerTick(
    referenceDate: Date = new Date(),
    getLatestStoreData?: () => StoreSnapshotPayload | undefined
  ): WhatsAppReminderBatch | null {
    const istTime = new Date(referenceDate.getTime() + 5.5 * 60 * 60 * 1000);
    const isSunday = istTime.getUTCDay() === 0;
    const hours = istTime.getUTCHours();
    const minutes = istTime.getUTCMinutes();

    // Sunday 12:00 PM - 12:04 PM IST window
    if (!(isSunday && hours === 12 && minutes < 5)) {
      return null;
    }

    const windowInfo = getWeeklyISTWindow(referenceDate);
    if (serverState.lastSchedulerRunWeekId === windowInfo.weekId) {
      return null;
    }

    const storeData = getLatestStoreData?.() ?? serverState.storeSnapshot;
    if (!storeData || !storeData.storeProfile) {
      return null;
    }

    const batch = generateOrGetWeeklyBatch(
      storeData.sales,
      storeData.customers,
      storeData.customerTransactions,
      storeData.storeProfile,
      false,
      referenceDate
    );

    serverState.lastSchedulerRunWeekId = windowInfo.weekId;
    persistState();
    return batch;
  }

  function initBackgroundScheduler(
    getLatestStoreData?: () => StoreSnapshotPayload | undefined
  ) {
    if (schedulerInterval) return;

    console.log(
      '[Scheduler] Arjun Groceries Weekly Bulk WhatsApp Reminder Scheduler initialized (Asia/Kolkata Sunday 12:00 PM IST)'
    );

    schedulerInterval = setInterval(() => {
      try {
        const prepared = runSchedulerTick(new Date(), getLatestStoreData);
        if (prepared) {
          console.log(
            `[Scheduler] Prepared batch ${prepared.id} with ${prepared.totalEligibleCustomers} customers. Waiting for explicit owner approval.`
          );
        }
      } catch (err) {
        safeLogError('WhatsAppService:scheduler', err, [
          serverState.config.accessToken,
          serverState.config.webhookVerifyToken,
        ]);
      }
    }, 60 * 1000);
  }

  function stopBackgroundScheduler() {
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = null;
    }
  }

  return {
    getSanitizedConfig,
    verifyWebhookToken,
    updateConfig,
    updateStoreSnapshot,
    getLatestStoreSnapshot,
    testConnection,
    sendWhatsAppMessage,
    sendTestMessage,
    generateOrGetWeeklyBatch,
    getBatchesAndLogs,
    updateBatchApproval,
    cancelBatch,
    dispatchBatch,
    handleWebhookStatusUpdate,
    runSchedulerTick,
    initBackgroundScheduler,
    stopBackgroundScheduler,
    logWhatsAppAudit,
    getSentIdempotencyKeys: () => ({ ...serverState.sentIdempotencyKeys }),
  };
}

// Default application singleton
const defaultService = createWhatsAppService();

export const getSanitizedConfig = defaultService.getSanitizedConfig;
export const verifyWebhookToken = defaultService.verifyWebhookToken;
export const updateConfig = defaultService.updateConfig;
export const updateStoreSnapshot = defaultService.updateStoreSnapshot;
export const getLatestStoreSnapshot = defaultService.getLatestStoreSnapshot;
export const testConnection = defaultService.testConnection;
export const sendWhatsAppMessage = defaultService.sendWhatsAppMessage;
export const sendTestMessage = defaultService.sendTestMessage;
export const generateOrGetWeeklyBatch = defaultService.generateOrGetWeeklyBatch;
export const getBatchesAndLogs = defaultService.getBatchesAndLogs;
export const updateBatchApproval = defaultService.updateBatchApproval;
export const cancelBatch = defaultService.cancelBatch;
export const dispatchBatch = defaultService.dispatchBatch;
export const handleWebhookStatusUpdate = defaultService.handleWebhookStatusUpdate;
export const runSchedulerTick = defaultService.runSchedulerTick;
export const initBackgroundScheduler = defaultService.initBackgroundScheduler;
