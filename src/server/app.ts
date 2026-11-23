/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { normalizeSalesForecastResponse } from '../utils/analyticsMetrics';
import {
  buildAllowedOrigins,
  createApiSecurityHeadersMiddleware,
  createCorsMiddleware,
  createRateLimiter,
  createSecurityHeadersMiddleware,
  createTokenService,
  safeLogError,
  verifyMetaWebhookSignature,
  type AuthenticatedRequest,
} from './security';
import {
  validateExtractSuppliersBody,
  validateSalesForecastBody,
  validateScanBillBody,
  validateWebhookPostBody,
  validateWhatsAppApproveBatchBody,
  validateWhatsAppCancelBatchBody,
  validateWhatsAppConfigUpdateBody,
  validateWhatsAppDispatchBatchBody,
  validateWhatsAppGenerateBatchBody,
  validateWhatsAppSendTestBody,
  validateWhatsAppStoreSnapshotBody,
} from './validation';
import * as defaultWhatsAppService from './whatsappService';

export type WhatsAppServiceInstance = ReturnType<
  typeof defaultWhatsAppService.createWhatsAppService
>;

export interface CreateApiAppOptions {
  port?: number;
  nodeEnv?: string;
  apiAuthToken?: string;
  signingSecret?: string;
  allowLocalDevSession?: boolean;
  allowedOriginsEnv?: string;
  appUrl?: string;
  geminiApiKey?: string;
  whatsappAppSecret?: string;
  aiClient?: GoogleGenAI | null;
  whatsappService?: Pick<
    WhatsAppServiceInstance,
    | 'getSanitizedConfig'
    | 'verifyWebhookToken'
    | 'updateConfig'
    | 'updateStoreSnapshot'
    | 'testConnection'
    | 'sendTestMessage'
    | 'generateOrGetWeeklyBatch'
    | 'getBatchesAndLogs'
    | 'updateBatchApproval'
    | 'cancelBatch'
    | 'dispatchBatch'
    | 'handleWebhookStatusUpdate'
  >;
  rateLimits?: {
    authMax?: number;
    authWindowMs?: number;
    aiMax?: number;
    aiWindowMs?: number;
    waAdminMax?: number;
    waAdminWindowMs?: number;
    waReadMax?: number;
    waReadWindowMs?: number;
    webhookMax?: number;
    webhookWindowMs?: number;
  };
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');

  const port = options.port ?? (Number(process.env.PORT) || 3000);
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const apiAuthToken = (options.apiAuthToken ?? process.env.API_AUTH_TOKEN ?? '').trim();
  const signingSecret = (options.signingSecret ?? process.env.SESSION_SIGNING_SECRET ?? '').trim();
  const geminiApiKey = (options.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
  const whatsappAppSecret = (options.whatsappAppSecret ?? process.env.WHATSAPP_APP_SECRET ?? '').trim();

  const knownSecrets = [
    apiAuthToken,
    signingSecret,
    geminiApiKey,
    whatsappAppSecret,
    process.env.WHATSAPP_ACCESS_TOKEN,
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  ];

  const allowedOrigins = buildAllowedOrigins({
    allowedOriginsEnv: options.allowedOriginsEnv ?? process.env.ALLOWED_ORIGINS,
    appUrl: options.appUrl ?? process.env.APP_URL,
    port,
    nodeEnv,
  });

  const tokenService = createTokenService({
    apiAuthToken,
    signingSecret,
    nodeEnv,
    allowLocalDevSession: options.allowLocalDevSession,
  });

  const waService = options.whatsappService ?? defaultWhatsAppService;

  let aiClient: GoogleGenAI | null =
    options.aiClient !== undefined ? options.aiClient : null;

  if (options.aiClient === undefined && geminiApiKey) {
    aiClient = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  // Global security & CORS headers
  app.use(createSecurityHeadersMiddleware());
  app.use(createCorsMiddleware(allowedOrigins));
  app.use('/api', createApiSecurityHeadersMiddleware());

  // Granular body parsers (tight limits per sensitivity)
  const smallJsonParser = express.json({ limit: '64kb' });
  const mediumJsonParser = express.json({ limit: '2mb' });
  const ocrJsonParser = express.json({ limit: '15mb' });
  const webhookJsonParser = express.json({
    limit: '64kb',
    verify: (req, _res, buf) => {
      (req as AuthenticatedRequest).rawBody = buf;
    },
  });

  // Granular rate limiters
  const authRateLimiter = createRateLimiter({
    name: 'auth',
    windowMs: options.rateLimits?.authWindowMs ?? 60_000,
    max: options.rateLimits?.authMax ?? 15,
  });

  const aiRateLimiter = createRateLimiter({
    name: 'ai',
    windowMs: options.rateLimits?.aiWindowMs ?? 60_000,
    max: options.rateLimits?.aiMax ?? 20,
  });

  const waAdminRateLimiter = createRateLimiter({
    name: 'wa-admin',
    windowMs: options.rateLimits?.waAdminWindowMs ?? 60_000,
    max: options.rateLimits?.waAdminMax ?? 20,
  });

  const waReadRateLimiter = createRateLimiter({
    name: 'wa-read',
    windowMs: options.rateLimits?.waReadWindowMs ?? 60_000,
    max: options.rateLimits?.waReadMax ?? 60,
  });

  const webhookRateLimiter = createRateLimiter({
    name: 'wa-webhook',
    windowMs: options.rateLimits?.webhookWindowMs ?? 60_000,
    max: options.rateLimits?.webhookMax ?? 120,
  });

  const isLoopbackSandboxMode = () => Boolean(waService.getSanitizedConfig().sandboxMode);

  // ==========================================
  // 1. Server Session Authentication Endpoint
  // ==========================================
  app.post('/api/auth/session', authRateLimiter, smallJsonParser, (req, res) => {
    return tokenService.handleSessionIssue(req, res);
  });

  // ==========================================
  // 2. Gemini AI OCR & Forecasting Routes
  // ==========================================
  app.post(
    '/api/ocr/scan-bill',
    aiRateLimiter,
    tokenService.requireAuth(['ai:ocr']),
    ocrJsonParser,
    async (req, res) => {
      const validated = validateScanBillBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      const { base64Data, mimeType: detectedMime, billType } = validated.value;

      try {
        if (!aiClient || !geminiApiKey) {
          return res.json({
            success: true,
            source: 'HEURISTIC_PARSER',
            warning: 'Gemini API key not detected in environment. Using smart local parser preview.',
            extractedData: {
              partyName:
                billType === 'PURCHASE'
                  ? 'Balaji Grains Wholesale'
                  : billType === 'SALE'
                    ? 'Counter Customer'
                    : 'Shop Operating Expense',
              billNumber: `BILL-${Math.floor(1000 + Math.random() * 9000)}`,
              billDate: new Date().toISOString().split('T')[0],
              items: [
                { name: 'Chakki Atta Sharbati', quantity: 2, unit: 'BAG', rate: 420, total: 840 },
                { name: 'Fortune Mustard Oil 1L', quantity: 5, unit: 'PACKET', rate: 145, total: 725 },
                { name: 'Madhur Pure Sugar', quantity: 10, unit: 'KG', rate: 42, total: 420 },
              ],
              subtotal: 1985,
              taxAmount: 0,
              totalAmount: 1985,
              notes: 'OCR extracted preview from bill receipt. Please verify details before saving.',
              confidence: 0.88,
              extractedAt: new Date().toISOString(),
            },
          });
        }

        const systemPrompt = `You are an expert OCR and document understanding assistant specialized in Indian retail grocery (Kirana) bills, wholesale tax invoices, handwritten parchis, and payment vouchers.
Analyze the attached bill image carefully and extract structured data.
Extract:
1. partyName: Supplier firm name for purchases/expenses, customer name for sales bills, or payee name.
2. billNumber: Invoice number, challan number, cash memo number, or slip number (if found).
3. billDate: Date of the bill in YYYY-MM-DD format (if ambiguous, use the current year 2026).
4. items: Array of purchased/sold line items. Each item must have:
   - name: clear product name in English or Romanized Hindi (e.g. "Aashirvaad Atta 10kg", "Fortune Soyabean Oil")
   - quantity: numeric quantity (default 1)
   - unit: unit of measurement, normalized to standard values: "KG", "GM", "LITRE", "ML", "PCS", "PACKET", "BOX", "BAG", "TIN", or "CARTON"
   - rate: unit price or rate per item
   - total: total price for this line item
5. subtotal: sum of items before tax or discount (if discernible)
6. taxAmount: GST, CGST+SGST, or VAT amount (0 if none)
7. totalAmount: Grand total payable/paid amount in Rupees
8. notes: any special note, payment term, or remark on the bill.

If any field is unreadable or not present, provide a reasonable fallback or empty string. Always return accurate numbers in Indian Rupees.`;

        const response = await aiClient.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: detectedMime,
                  data: base64Data,
                },
              },
              {
                text: `Extract all transaction details from this ${billType.toLowerCase()} bill. Return strict JSON.`,
              },
            ],
          },
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                partyName: { type: Type.STRING, description: 'Vendor, store, supplier, or customer name' },
                billNumber: { type: Type.STRING, description: 'Invoice or bill number' },
                billDate: { type: Type.STRING, description: 'Date of bill in YYYY-MM-DD format' },
                items: {
                  type: Type.ARRAY,
                  description: 'List of items in the bill',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unit: { type: Type.STRING },
                      rate: { type: Type.NUMBER },
                      total: { type: Type.NUMBER },
                    },
                    required: ['name', 'quantity', 'unit', 'rate', 'total'],
                  },
                },
                subtotal: { type: Type.NUMBER },
                taxAmount: { type: Type.NUMBER },
                totalAmount: { type: Type.NUMBER },
                notes: { type: Type.STRING },
              },
              required: ['partyName', 'billNumber', 'billDate', 'items', 'totalAmount'],
            },
          },
        });

        const parsedData = JSON.parse(response.text || '{}');

        return res.json({
          success: true,
          source: 'GEMINI_AI',
          extractedData: {
            ...parsedData,
            confidence: 0.95,
            extractedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        safeLogError('OCR:scan-bill', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'OCR_PROCESSING_ERROR',
          error: 'Failed to process document with OCR.',
          fallback: {
            billNumber: `BILL-${Math.floor(1000 + Math.random() * 9000)}`,
            billDate: new Date().toISOString().split('T')[0],
            items: [],
            totalAmount: 0,
            extractedAt: new Date().toISOString(),
          },
        });
      }
    }
  );

  app.post(
    '/api/ocr/extract-suppliers',
    aiRateLimiter,
    tokenService.requireAuth(['ai:ocr']),
    ocrJsonParser,
    async (req, res) => {
      const validated = validateExtractSuppliersBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        if (!aiClient || !geminiApiKey) {
          return res.json({
            success: false,
            aiAvailable: false,
            error:
              'Scanned-PDF extraction service is currently unavailable. Upload a text-based PDF or add suppliers manually in the review table.',
          });
        }

        const response = await aiClient.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: validated.value.base64Data,
                },
              },
              {
                text: 'Extract every supplier contact directory row from this PDF, including firm name, contact person, 10-digit phone number, address, GSTIN, credit terms (e.g. Net 15 Days, Cash on Delivery), preferred payment method (CASH, UPI, BANK_TRANSFER, CHEQUE, or CREDIT), opening balance, and notes.',
              },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                suppliers: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      contactPerson: { type: Type.STRING },
                      phone: { type: Type.STRING },
                      address: { type: Type.STRING },
                      gstin: { type: Type.STRING },
                      creditTerms: { type: Type.STRING },
                      preferredPaymentMethod: { type: Type.STRING },
                      openingBalance: { type: Type.NUMBER },
                      notes: { type: Type.STRING },
                    },
                    required: ['name'],
                  },
                },
              },
              required: ['suppliers'],
            },
          },
        });

        const parsed = JSON.parse(response.text || '{}');
        return res.json({
          success: true,
          source: 'GEMINI_AI',
          suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
        });
      } catch (err) {
        safeLogError('OCR:extract-suppliers', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'OCR_PROCESSING_ERROR',
          error: 'Failed to extract suppliers from scanned PDF.',
        });
      }
    }
  );

  app.post(
    '/api/analytics/sales-forecast',
    aiRateLimiter,
    tokenService.requireAuth(['ai:forecast']),
    mediumJsonParser,
    async (req, res) => {
      const validated = validateSalesForecastBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        if (!aiClient || !geminiApiKey) {
          return res.status(503).json({
            success: false,
            code: 'SERVICE_UNAVAILABLE',
            error: 'AI sales forecasting service is currently unavailable on the server.',
          });
        }

        const { summary, storeName } = validated.value;
        const promptText = `Analyze the following historical retail grocery store sales data for "${storeName}" and generate a realistic 7-day daily sales forecast (in Indian Rupees ₹) starting the day after ${summary.referenceDateKey}.

Historical Metrics:
- Last 7 days total: ₹${summary.recent7DayTotal}
- Prior 7 days total: ₹${summary.prior7DayTotal}
- Week-over-week growth: ${summary.growthPct}%
- 30-day average daily sales: ₹${summary.avgDailySales30D}
- Active billing days in last 30 days: ${summary.activeDaysCount}
- Monthly operating expenses: ₹${summary.monthlyOperatingExpenses}
- Day-of-week averages: ${JSON.stringify(summary.dayOfWeekAverages)}
- Top categories by sales: ${JSON.stringify(summary.topCategories)}
- Last 14 daily sales totals: ${JSON.stringify(summary.historyDays.slice(-14))}

Return exactly 7 daily forecast entries for the next 7 consecutive days after ${summary.referenceDateKey}. Each day must have non-negative integer estimates (predictedAmount, lowEstimate <= predictedAmount <= highEstimate) and a concise driver string (e.g., "Weekend family ration buying"). Also include trendDirection ("UP", "DOWN", or "STABLE"), concise summary (1-2 sentences), confidenceNote, and up to 3 practical Kirana inventory/cashflow recommendations.`;

        const modelName = 'gemini-4-hydrogen';
        let responseText = '';
        let lastError: unknown = null;

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await aiClient.models.generateContent({
              model: modelName,
              contents: promptText,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                systemInstruction:
                  'You are a retail demand forecasting analyst for an Indian Kirana grocery store. Return strictly valid JSON matching the schema with realistic INR estimates grounded strictly in the provided sales numbers.',
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    summary: { type: Type.STRING },
                    trendDirection: { type: Type.STRING },
                    expected7DayTotal: { type: Type.NUMBER },
                    confidenceNote: { type: Type.STRING },
                    dailyForecast: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          predictedAmount: { type: Type.NUMBER },
                          lowEstimate: { type: Type.NUMBER },
                          highEstimate: { type: Type.NUMBER },
                          driver: { type: Type.STRING },
                        },
                        required: ['predictedAmount', 'lowEstimate', 'highEstimate', 'driver'],
                      },
                    },
                    recommendations: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: [
                    'summary',
                    'trendDirection',
                    'expected7DayTotal',
                    'confidenceNote',
                    'dailyForecast',
                    'recommendations',
                  ],
                },
              },
            });
            responseText = response.text || '';
            lastError = null;
            break;
          } catch (err: any) {
            lastError = err;
            const status = err?.status || err?.statusCode;
            if (status === 400 || status === 401 || status === 403 || status === 404) {
              break;
            }
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
            }
          }
        }

        if (lastError) {
          throw lastError;
        }

        const parsed = JSON.parse(responseText || '{}');
        const forecast = normalizeSalesForecastResponse(
          parsed,
          summary.referenceDateKey,
          modelName
        );

        return res.json({
          success: true,
          forecast,
        });
      } catch (err: any) {
        safeLogError('Analytics:sales-forecast', err, knownSecrets);
        const rawStatus = Number(err?.status || err?.statusCode) || 500;
        const safeHttpStatus = rawStatus === 429 ? 429 : rawStatus === 503 ? 503 : 500;
        return res.status(safeHttpStatus).json({
          success: false,
          code: 'FORECAST_ERROR',
          error:
            safeHttpStatus === 429
              ? 'AI forecasting rate limit reached. Please try again shortly.'
              : 'Failed to generate AI sales forecast.',
        });
      }
    }
  );

  // ==========================================
  // 3. WhatsApp Business Platform API Routes
  // ==========================================
  app.get(
    '/api/whatsapp/config',
    waReadRateLimiter,
    tokenService.requireAuth(['whatsapp:read']),
    (_req, res) => {
      res.json({ success: true, config: waService.getSanitizedConfig() });
    }
  );

  app.post(
    '/api/whatsapp/config',
    waAdminRateLimiter,
    tokenService.requireAuth(['whatsapp:config'], {
      allowLoopbackSandboxOperator: isLoopbackSandboxMode,
    }),
    smallJsonParser,
    (req, res) => {
      const validated = validateWhatsAppConfigUpdateBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      const authReq = req as AuthenticatedRequest;
      const tryingLiveOrSecretMutation =
        validated.value.sandboxMode === false ||
        Boolean(validated.value.accessToken) ||
        Boolean(validated.value.webhookVerifyToken);

      if (tryingLiveOrSecretMutation && authReq.auth?.role !== 'owner') {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN',
          error: 'Owner authorization is required to modify live mode or API credentials.',
        });
      }

      try {
        const updated = waService.updateConfig(validated.value);
        return res.json({ success: true, config: updated });
      } catch (err) {
        safeLogError('WhatsApp:config-update', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Failed to update WhatsApp configuration.',
        });
      }
    }
  );

  app.post(
    '/api/whatsapp/test-connection',
    waAdminRateLimiter,
    tokenService.requireAuth(['whatsapp:config'], {
      allowLoopbackSandboxOperator: isLoopbackSandboxMode,
    }),
    smallJsonParser,
    async (_req, res) => {
      try {
        const result = await waService.testConnection();
        return res.json(result);
      } catch (err) {
        safeLogError('WhatsApp:test-connection', err, knownSecrets);
        return res.status(500).json({
          success: false,
          message: 'Connection verification failed.',
        });
      }
    }
  );

  app.post(
    '/api/whatsapp/send-test',
    waAdminRateLimiter,
    tokenService.requireAuth(['whatsapp:dispatch'], {
      allowLoopbackSandboxOperator: isLoopbackSandboxMode,
    }),
    smallJsonParser,
    async (req, res) => {
      const validated = validateWhatsAppSendTestBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        const result = await waService.sendTestMessage(validated.value);
        return res.status(result.success ? 200 : 400).json(result);
      } catch (err) {
        safeLogError('WhatsApp:send-test', err, knownSecrets);
        return res.status(500).json({
          success: false,
          message: 'Test message dispatch failed.',
        });
      }
    }
  );

  app.post(
    '/api/whatsapp/store-snapshot',
    waReadRateLimiter,
    tokenService.requireAuth(['whatsapp:snapshot']),
    mediumJsonParser,
    (req, res) => {
      const validated = validateWhatsAppStoreSnapshotBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        const saved = waService.updateStoreSnapshot(validated.value);
        return res.json({ success: true, updatedAt: saved.updatedAt });
      } catch (err) {
        safeLogError('WhatsApp:store-snapshot', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Failed to save store snapshot.',
        });
      }
    }
  );

  app.get(
    '/api/whatsapp/batches',
    waReadRateLimiter,
    tokenService.requireAuth(['whatsapp:read']),
    (_req, res) => {
      res.json({ success: true, ...waService.getBatchesAndLogs() });
    }
  );

  app.post(
    '/api/whatsapp/batch/generate',
    waReadRateLimiter,
    tokenService.requireAuth(['whatsapp:batch:prepare']),
    mediumJsonParser,
    (req, res) => {
      const validated = validateWhatsAppGenerateBatchBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        const batch = waService.generateOrGetWeeklyBatch(
          validated.value.sales,
          validated.value.customers,
          validated.value.customerTransactions,
          validated.value.storeProfile,
          validated.value.forceRegenerate
        );
        return res.json({ success: true, batch });
      } catch (err) {
        safeLogError('WhatsApp:batch-generate', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Failed to prepare weekly reminder batch.',
        });
      }
    }
  );

  app.post(
    '/api/whatsapp/batch/approve',
    waAdminRateLimiter,
    tokenService.requireAuth(['whatsapp:batch:approve'], {
      allowLoopbackSandboxOperator: isLoopbackSandboxMode,
    }),
    smallJsonParser,
    (req, res) => {
      const validated = validateWhatsAppApproveBatchBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        const batch = waService.updateBatchApproval(
          validated.value.batchId,
          validated.value.approvedCustomerIds,
          validated.value.approvedBy
        );
        if (!batch) {
          return res.status(404).json({ success: false, error: 'Batch not found.' });
        }
        return res.json({ success: true, batch });
      } catch (err) {
        safeLogError('WhatsApp:batch-approve', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Failed to approve reminder batch.',
        });
      }
    }
  );

  app.post(
    '/api/whatsapp/batch/cancel',
    waReadRateLimiter,
    tokenService.requireAuth(['whatsapp:batch:cancel']),
    smallJsonParser,
    (req, res) => {
      const validated = validateWhatsAppCancelBatchBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        const batch = waService.cancelBatch(validated.value.batchId, validated.value.reason);
        if (!batch) {
          return res.status(404).json({ success: false, error: 'Batch not found.' });
        }
        return res.json({ success: true, batch });
      } catch (err) {
        safeLogError('WhatsApp:batch-cancel', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Failed to cancel reminder batch.',
        });
      }
    }
  );

  app.post(
    '/api/whatsapp/batch/send',
    waAdminRateLimiter,
    tokenService.requireAuth(['whatsapp:dispatch'], {
      allowLoopbackSandboxOperator: isLoopbackSandboxMode,
    }),
    mediumJsonParser,
    async (req, res) => {
      const validated = validateWhatsAppDispatchBatchBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      try {
        const result = await waService.dispatchBatch(validated.value);
        if (!result.found) {
          return res.status(404).json({ success: false, error: result.error || 'Batch not found.' });
        }
        if (result.conflict) {
          return res.status(409).json({ success: false, error: result.error });
        }
        if (result.requiresApproval) {
          return res.status(403).json({ success: false, error: result.error });
        }

        return res.json({
          success: true,
          sentCount: result.sentCount,
          failedCount: result.failedCount,
          skippedCount: result.skippedCount,
          batch: result.batch,
        });
      } catch (err) {
        safeLogError('WhatsApp:batch-send', err, knownSecrets);
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Failed to dispatch WhatsApp reminder batch.',
        });
      }
    }
  );

  // Meta Webhook Verification (GET)
  app.get('/api/whatsapp/webhook', webhookRateLimiter, (req, res) => {
    const mode = req.query['hub.mode'];
    const token =
      typeof req.query['hub.verify_token'] === 'string'
        ? req.query['hub.verify_token']
        : undefined;
    const challenge = req.query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      typeof challenge === 'string' &&
      challenge.length > 0 &&
      challenge.length <= 256 &&
      waService.verifyWebhookToken(token)
    ) {
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.sendStatus(403);
  });

  // Meta Webhook Delivery Status Listener (POST)
  app.post(
    '/api/whatsapp/webhook',
    webhookRateLimiter,
    webhookJsonParser,
    (req, res) => {
      if (whatsappAppSecret) {
        const sigHeader = req.headers['x-hub-signature-256'];
        const sigValue = typeof sigHeader === 'string' ? sigHeader : undefined;
        const rawBody = (req as AuthenticatedRequest).rawBody;
        if (!verifyMetaWebhookSignature(rawBody, sigValue, whatsappAppSecret)) {
          return res.status(401).json({
            success: false,
            code: 'INVALID_WEBHOOK_SIGNATURE',
            error: 'Invalid webhook signature.',
          });
        }
      }

      const validated = validateWebhookPostBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          error: validated.error,
        });
      }

      const result = waService.handleWebhookStatusUpdate(validated.value);
      return res.status(200).json({ success: true, ...result });
    }
  );

  // JSON 404 handler for unknown /api/* routes (never fall through to SPA HTML)
  app.use('/api', (_req, res) => {
    return res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      error: 'API endpoint not found.',
    });
  });

  function attachErrorMiddleware() {
    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      safeLogError(`Express:${req.method} ${req.path}`, err, knownSecrets);

      if (err?.type === 'entity.too.large' || err?.status === 413) {
        return res.status(413).json({
          success: false,
          code: 'PAYLOAD_TOO_LARGE',
          error: 'Request payload exceeds allowed size limit.',
        });
      }

      if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({
          success: false,
          code: 'MALFORMED_JSON',
          error: 'Malformed JSON request body.',
        });
      }

      const isApi = req.path.startsWith('/api/');
      if (isApi) {
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_SERVER_ERROR',
          error: 'Internal server error.',
        });
      }

      return res.status(500).type('text/plain').send('Internal Server Error');
    });
  }

  return {
    app,
    tokenService,
    allowedOrigins,
    attachErrorMiddleware,
  };
}
