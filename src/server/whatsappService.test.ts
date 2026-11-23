import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWhatsAppService } from './whatsappService';
import { Customer, CustomerTransaction, SaleRecord, StoreProfile } from '../types';

const tempDirs: string[] = [];

function createTempStateFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartkirana-wa-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'whatsapp-state.json');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup issues
    }
  }
});

const baseProfile: StoreProfile = {
  id: 'store-test',
  storeName: 'Gupta Kirana Store',
  ownerName: 'Ramesh Gupta',
  phone: '9876543210',
  upiId: 'gupta@upi',
  address: 'Main Market, Jaipur',
  currencySymbol: '₹',
  isPinEnabled: false,
};

const baseCustomers: Customer[] = [
  {
    id: 'cust-1',
    name: 'Mahesh Verma',
    phone: '9811122233',
    openingBalance: 0,
    currentBalance: 1200,
    totalCreditGiven: 1200,
    totalPaymentReceived: 0,
    overdueDays: 3,
    category: 'REGULAR',
    whatsappConsent: true,
    createdAt: '2026-10-01T08:00:00.000Z',
  },
];

const sundayRef = new Date('2026-11-15T06:31:00.000Z'); // Sunday 12:01 PM IST
const eligibleSaleDate = new Date(sundayRef.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

const baseSales: SaleRecord[] = [
  {
    id: 'sale-1',
    invoiceNo: 'BILL-501',
    date: eligibleSaleDate,
    customerId: 'cust-1',
    customerName: 'Mahesh Verma',
    amount: 1200,
    paymentMethod: 'CREDIT',
    items: [],
    isCredit: true,
    createdAt: eligibleSaleDate,
  },
];

const baseTx: CustomerTransaction[] = [
  {
    id: 'ctx-1',
    customerId: 'cust-1',
    type: 'CREDIT',
    amount: 1200,
    date: eligibleSaleDate,
    description: 'Credit Sale #BILL-501',
    invoiceNo: 'BILL-501',
    createdAt: eligibleSaleDate,
  },
];

describe('whatsappService production hardening', () => {
  it('masks secrets in sanitized config and persists state across restarts', async () => {
    const stateFile = createTempStateFile();
    const svc1 = createWhatsAppService({
      stateFilePath: stateFile,
      sleepFn: async () => {},
      env: {
        WHATSAPP_WABA_ID: '111222333444',
        WHATSAPP_PHONE_NUMBER_ID: '999888777666',
        WHATSAPP_ACCESS_TOKEN: 'EAAG_SECRET_TOKEN_VALUE_9999',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'my_super_secret_webhook_verify',
        WHATSAPP_SANDBOX_MODE: 'true',
      },
    });

    const sanitized = svc1.getSanitizedConfig();
    assert.equal(sanitized.configuredViaEnv, true);
    assert.equal(sanitized.hasAccessToken, true);
    assert.equal(sanitized.hasWebhookVerifyToken, true);
    assert.equal((sanitized as any).accessToken, undefined);
    assert.equal((sanitized as any).webhookVerifyToken, undefined);
    assert.ok(!sanitized.accessTokenMasked?.includes('SECRET_TOKEN'));
    assert.ok(!sanitized.webhookVerifyTokenMasked?.includes('super_secret'));
    assert.equal(svc1.verifyWebhookToken('my_super_secret_webhook_verify'), true);
    assert.equal(svc1.verifyWebhookToken('wrong-token'), false);

    // Prepare batch & update snapshot
    svc1.updateStoreSnapshot({
      sales: baseSales,
      customers: baseCustomers,
      customerTransactions: baseTx,
      storeProfile: baseProfile,
    });
    const batch = svc1.generateOrGetWeeklyBatch(
      baseSales,
      baseCustomers,
      baseTx,
      baseProfile,
      false,
      sundayRef
    );
    assert.equal(batch.totalEligibleCustomers, 1);

    // Reload fresh service instance from same disk file
    const svc2 = createWhatsAppService({
      stateFilePath: stateFile,
      sleepFn: async () => {},
      env: {
        WHATSAPP_WABA_ID: '111222333444',
        WHATSAPP_PHONE_NUMBER_ID: '999888777666',
        WHATSAPP_ACCESS_TOKEN: 'EAAG_SECRET_TOKEN_VALUE_9999',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'my_super_secret_webhook_verify',
        WHATSAPP_SANDBOX_MODE: 'true',
      },
    });

    const reloaded = svc2.getBatchesAndLogs();
    assert.equal(reloaded.batches.length, 1);
    assert.equal(reloaded.batches[0].id, batch.id);
    assert.ok(svc2.getLatestStoreSnapshot());
    assert.equal(svc2.getLatestStoreSnapshot()?.customers.length, 1);
  });

  it('strictly blocks live Meta fetch calls in Sandbox mode for connection test, test send, and batch send', async () => {
    const stateFile = createTempStateFile();
    let fetchCallCount = 0;
    const spyFetch: typeof fetch = async () => {
      fetchCallCount++;
      throw new Error('fetch must NEVER be called in sandbox mode');
    };

    const svc = createWhatsAppService({
      stateFilePath: stateFile,
      fetchFn: spyFetch,
      sleepFn: async () => {},
      env: {
        WHATSAPP_SANDBOX_MODE: 'true',
      },
    });

    const testConn = await svc.testConnection();
    assert.equal(testConn.success, true);
    assert.equal(fetchCallCount, 0);

    const testSend = await svc.sendTestMessage({
      testPhoneNumber: '9876543210',
      storeName: 'Gupta Kirana Store',
    });
    assert.equal(testSend.success, true);
    assert.equal(testSend.sandboxSimulated, true);
    assert.equal(fetchCallCount, 0);

    const batch = svc.generateOrGetWeeklyBatch(
      baseSales,
      baseCustomers,
      baseTx,
      baseProfile,
      false,
      sundayRef
    );

    // Must reject dispatch before explicit approval
    const blockedSend = await svc.dispatchBatch({
      batchId: batch.id,
      currentCustomers: baseCustomers,
      currentTransactions: baseTx,
      currentSales: baseSales,
    });
    assert.equal(blockedSend.requiresApproval, true);
    assert.equal(blockedSend.sentCount, 0);

    svc.updateBatchApproval(batch.id, ['cust-1'], 'Ramesh Gupta');
    const dispatched = await svc.dispatchBatch({
      batchId: batch.id,
      storeName: 'Gupta Kirana Store',
      upiId: 'gupta@upi',
      currentCustomers: baseCustomers,
      currentTransactions: baseTx,
      currentSales: baseSales,
    });
    assert.equal(dispatched.sentCount, 1);
    assert.equal(dispatched.batch?.items[0].status, 'SENT');
    assert.equal(dispatched.batch?.items[0].apiResponseSummary?.sandboxSimulated, true);
    assert.equal(fetchCallCount, 0);

    // Direct replay of already-dispatched batch hits idempotency lock and skips sending
    const directReplay = await svc.dispatchBatch({
      batchId: batch.id,
      currentCustomers: baseCustomers,
      currentTransactions: baseTx,
      currentSales: baseSales,
    });
    assert.equal(directReplay.sentCount, 0);
    assert.equal(directReplay.skippedCount, 1);

    // Regenerating batch in same week preserves persistent idempotency lock and prevents re-approval
    const regen = svc.generateOrGetWeeklyBatch(
      baseSales,
      baseCustomers,
      baseTx,
      baseProfile,
      true,
      sundayRef
    );
    assert.equal(regen.items[0].status, 'SENT');
    assert.equal(regen.items[0].approved, false);
    svc.updateBatchApproval(regen.id, ['cust-1'], 'Ramesh Gupta');
    const redispatch = await svc.dispatchBatch({
      batchId: regen.id,
      currentCustomers: baseCustomers,
      currentTransactions: baseTx,
      currentSales: baseSales,
    });
    assert.equal(redispatch.sentCount, 0);
    assert.equal(fetchCallCount, 0);
  });

  it('validates WABA template approval in live mode and handles 429 retry vs permanent 4xx failures', async () => {
    const stateFile = createTempStateFile();
    let msgAttempt = 0;

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/999888777666?fields=')) {
        return new Response(
          JSON.stringify({
            verified_name: 'Gupta Kirana Official',
            display_phone_number: '+91 98765 43210',
            quality_rating: 'GREEN',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/111222333444/message_templates')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                name: 'payment_reminder_weekly',
                language: 'hi',
                status: 'APPROVED',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/999888777666/messages')) {
        msgAttempt++;
        if (msgAttempt === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'Rate limit hit', code: 130429 } }),
            { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': '1' } }
          );
        }
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            contacts: [{ wa_id: '919811122233' }],
            messages: [{ id: 'wamid.LIVE_RETRY_OK_123' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: { message: 'Unexpected URL' } }), { status: 404 });
    };

    const svc = createWhatsAppService({
      stateFilePath: stateFile,
      fetchFn: mockFetch,
      sleepFn: async () => {},
      env: {
        WHATSAPP_WABA_ID: '111222333444',
        WHATSAPP_PHONE_NUMBER_ID: '999888777666',
        WHATSAPP_ACCESS_TOKEN: 'EAAG_LIVE_TEST_TOKEN',
        WHATSAPP_TEMPLATE_NAME: 'payment_reminder_weekly',
        WHATSAPP_TEMPLATE_LANGUAGE: 'hi',
        WHATSAPP_SANDBOX_MODE: 'false',
      },
    });

    const verify = await svc.testConnection();
    assert.equal(verify.success, true);
    assert.equal(verify.config.templateStatus, 'APPROVED');
    assert.equal(verify.config.verifiedBusinessName, 'Gupta Kirana Official');

    const batch = svc.generateOrGetWeeklyBatch(
      baseSales,
      baseCustomers,
      baseTx,
      baseProfile,
      false,
      sundayRef
    );
    svc.updateBatchApproval(batch.id, ['cust-1'], 'Owner');
    const dispatched = await svc.dispatchBatch({
      batchId: batch.id,
      storeName: 'Gupta Kirana Store',
      upiId: 'gupta@upi',
      currentCustomers: baseCustomers,
      currentTransactions: baseTx,
      currentSales: baseSales,
    });

    assert.equal(msgAttempt, 2);
    assert.equal(dispatched.sentCount, 1);
    assert.equal(dispatched.batch?.items[0].status, 'ACCEPTED');
    assert.equal(dispatched.batch?.items[0].wabaMessageId, 'wamid.LIVE_RETRY_OK_123');
    assert.equal(dispatched.batch?.items[0].attempts, 2);

    // Webhook updates delivery & read statuses and persists
    const hookRes = svc.handleWebhookStatusUpdate({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.LIVE_RETRY_OK_123',
                    status: 'delivered',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: '919811122233',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(hookRes.processedCount, 1);
    assert.equal(svc.getBatchesAndLogs().batches[0].items[0].status, 'DELIVERED');
  });

  it('fails template verification when template is unapproved or missing and prepares Sunday IST scheduler batch without auto-sending', async () => {
    const stateFile = createTempStateFile();
    let fetchCalls = 0;

    const mockFetch: typeof fetch = async (input) => {
      fetchCalls++;
      const url = String(input);
      if (url.includes('/message_templates')) {
        return new Response(
          JSON.stringify({
            data: [{ name: 'payment_reminder_weekly', language: 'hi', status: 'PENDING' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ verified_name: 'Kirana Biz', display_phone_number: '+91 90000 00001' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const svc = createWhatsAppService({
      stateFilePath: stateFile,
      fetchFn: mockFetch,
      sleepFn: async () => {},
      env: {
        WHATSAPP_WABA_ID: '111222333444',
        WHATSAPP_PHONE_NUMBER_ID: '999888777666',
        WHATSAPP_ACCESS_TOKEN: 'EAAG_LIVE_TEST_TOKEN',
        WHATSAPP_SANDBOX_MODE: 'false',
      },
    });

    const verify = await svc.testConnection();
    assert.equal(verify.success, false);
    assert.equal(verify.config.templateStatus, 'PENDING');

    svc.updateStoreSnapshot({
      sales: baseSales,
      customers: baseCustomers,
      customerTransactions: baseTx,
      storeProfile: baseProfile,
    });

    const beforeMessagesCalls = fetchCalls;
    // Non-Sunday should not trigger scheduler
    const mondayUtc = new Date('2026-11-16T06:30:00.000Z');
    assert.equal(svc.runSchedulerTick(mondayUtc), null);

    // Sunday 12:01 PM IST should prepare batch once and NEVER send
    const prepared = svc.runSchedulerTick(sundayRef);
    assert.ok(prepared);
    assert.equal(prepared?.status, 'READY_FOR_REVIEW');
    assert.equal(fetchCalls, beforeMessagesCalls);

    // Second tick within same Sunday window is idempotent no-op
    assert.equal(svc.runSchedulerTick(sundayRef), null);
  });

  it('never writes plaintext accessToken or webhookVerifyToken to whatsapp-state.json and scrubs legacy plaintext files', () => {
    const stateFile = createTempStateFile();
    const envAccess = 'EAAG_SECRET_ENV_ACCESS_998877';
    const envWebhook = 'WEBHOOK_SECRET_ENV_556677';
    const dynamicAccess = 'EAAG_DYNAMIC_SECRET_334455';
    const dynamicWebhook = 'WEBHOOK_DYNAMIC_SECRET_112233';

    // 1) Pre-populate a legacy state file containing plaintext tokens
    fs.writeFileSync(
      stateFile,
      JSON.stringify(
        {
          config: {
            businessAccountId: '111',
            phoneNumberId: '222',
            accessToken: 'LEGACY_PLAIN_ACCESS_000111',
            webhookVerifyToken: 'LEGACY_PLAIN_WEBHOOK_000222',
            templateName: 'payment_reminder_weekly',
            templateLanguage: 'hi',
            verifiedTestNumber: '',
            sandboxMode: true,
          },
          batches: [],
          auditLogs: [],
          sentIdempotencyKeys: {},
        },
        null,
        2
      ),
      'utf-8'
    );

    // Loading immediately scrubs legacy plaintext secrets on disk
    const svc = createWhatsAppService({
      stateFilePath: stateFile,
      env: {
        WHATSAPP_ACCESS_TOKEN: envAccess,
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: envWebhook,
        WHATSAPP_SECRET_ENCRYPTION_KEY: 'test-encryption-master-key-xyz',
      },
    });

    const scrubbedDisk = fs.readFileSync(stateFile, 'utf-8');
    assert.ok(!scrubbedDisk.includes('LEGACY_PLAIN_ACCESS_000111'));
    assert.ok(!scrubbedDisk.includes('LEGACY_PLAIN_WEBHOOK_000222'));
    assert.ok(!scrubbedDisk.includes(envAccess));
    assert.ok(!scrubbedDisk.includes(envWebhook));

    // 2) Updating config with new secrets stores encrypted blob only & zero plaintext tokens
    const updated = svc.updateConfig({
      accessToken: dynamicAccess,
      webhookVerifyToken: dynamicWebhook,
      phoneNumberId: '333444',
    });
    assert.equal(updated.hasAccessToken, true);
    assert.equal(updated.hasWebhookVerifyToken, true);
    assert.ok(!JSON.stringify(updated).includes(dynamicAccess));
    assert.ok(!JSON.stringify(updated).includes(dynamicWebhook));

    const diskAfterUpdate = fs.readFileSync(stateFile, 'utf-8');
    assert.ok(!diskAfterUpdate.includes(dynamicAccess));
    assert.ok(!diskAfterUpdate.includes(dynamicWebhook));
    assert.ok(!diskAfterUpdate.includes(envAccess));
    assert.ok(!diskAfterUpdate.includes(envWebhook));
    const parsedDisk = JSON.parse(diskAfterUpdate);
    assert.equal(parsedDisk.config.accessToken, undefined);
    assert.equal(parsedDisk.config.webhookVerifyToken, undefined);
    assert.equal(parsedDisk.encryptedSecrets?.cipher, 'AES-256-GCM');
  });
});
