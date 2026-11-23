/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Customer,
  CustomerInvoiceSummary,
  CustomerReminderHistoryEntry,
  CustomerTransaction,
  StoreProfile,
  WhatsAppAuditLog,
  WhatsAppReminderBatch,
  WhatsAppTemplateConfig,
} from '../types';

export const DEFAULT_WHATSAPP_TEMPLATE_CONFIG: WhatsAppTemplateConfig = {
  templateName: 'payment_reminder_weekly',
  bodyTemplate:
    'Namaste {{customer_name}} ji,\n\n' +
    'Aapke {{store_name}} account mein pichhle hafte ke bills ka kul Rs.{{amount}} payment pending hai.\n\n' +
    'Pending Bill Details:\n' +
    '{{invoices}}\n\n' +
    'Kripya apni suvidha ke anusaar payment kar dein{{upi_id}} ya dukan par aakar jama karayein.',
  footerText: 'Dhanyavaad! {{store_name}}',
  includeInvoiceList: true,
  includeUpiId: true,
  updatedAt: new Date(0).toISOString(),
};

export const WHATSAPP_TEMPLATE_TOKENS = [
  { token: '{{customer_name}}', label: 'Customer Name', sample: 'Ramesh Sharma' },
  { token: '{{store_name}}', label: 'Store Name', sample: 'Arjun Groceries' },
  { token: '{{amount}}', label: 'Pending Amount', sample: '1,450' },
  { token: '{{invoices}}', label: 'Pending Bill List', sample: 'INV-204 (12 Nov): Rs.1,450' },
  { token: '{{upi_id}}', label: 'Store UPI ID', sample: 'arjungroceries@okaxis' },
] as const;

export interface TemplateValidationResult {
  valid: boolean;
  score: number; // 0-100 guideline score
  errors: string[];
  warnings: string[];
  characterCount: number;
}

const PROHIBITED_SPAM_PHRASES = [
  'free money',
  'lottery',
  'click here now',
  'act immediately',
  'guaranteed prize',
  'bit.ly',
  'tinyurl',
];

/**
 * Validates custom WhatsApp reminder templates against Meta WhatsApp Business guidelines:
 * - Clear customer name & amount transparency
 * - Max 1024 character body limit (Meta utility template limit)
 * - No shortened URLs or deceptive spam phrases
 * - Balanced variable placeholders
 */
export function validateWhatsAppTemplate(
  config: Pick<WhatsAppTemplateConfig, 'templateName' | 'bodyTemplate' | 'footerText'>
): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = (config.bodyTemplate || '').trim();
  const footer = (config.footerText || '').trim();
  const fullLength = body.length + (footer ? footer.length + 2 : 0);

  if (!config.templateName || !/^[a-z0-9_]{3,64}$/.test(config.templateName.trim())) {
    errors.push(
      'Template name must use 3-64 lowercase letters, numbers, or underscores only (e.g. payment_reminder_weekly).'
    );
  }

  if (!body) {
    errors.push('Message template body cannot be empty.');
  }

  if (fullLength > 1024) {
    errors.push(`Template exceeds Meta 1,024 character limit (${fullLength} characters).`);
  }

  if (!body.includes('{{customer_name}}')) {
    warnings.push('Include {{customer_name}} so customers know the reminder is personalized.');
  }
  if (!body.includes('{{amount}}')) {
    errors.push('Template must include {{amount}} to display the accurate pending balance.');
  }
  if (!body.includes('{{store_name}}') && !footer.includes('{{store_name}}')) {
    warnings.push('Include {{store_name}} in body or footer for clear merchant identity.');
  }

  const lower = `${body} ${footer}`.toLowerCase();
  for (const phrase of PROHIBITED_SPAM_PHRASES) {
    if (lower.includes(phrase)) {
      errors.push(`Contains disallowed promotional/link-shortener phrase: "${phrase}".`);
    }
  }

  // Check unknown {{tokens}}
  const allowed = new Set<string>(WHATSAPP_TEMPLATE_TOKENS.map((t) => t.token));
  const matches = body.match(/\{\{[^}]+\}\}/g) || [];
  for (const m of matches) {
    if (!allowed.has(m)) {
      warnings.push(`Unknown placeholder ${m} will render literally unless replaced.`);
    }
  }

  // Excess exclamation marks or shouting check
  const exclamationCount = (body.match(/!/g) || []).length;
  if (exclamationCount > 3) {
    warnings.push('Reduce exclamation marks to keep a polite utility tone.');
  }

  let score = 100;
  score -= errors.length * 30;
  score -= warnings.length * 10;
  score = Math.max(0, Math.min(100, score));

  return {
    valid: errors.length === 0,
    score,
    errors,
    warnings,
    characterCount: fullLength,
  };
}

/**
 * Renders a WhatsApp payment reminder message from a template config and live customer/invoice data.
 */
export function renderWhatsAppTemplateMessage(
  templateConfig: WhatsAppTemplateConfig | undefined,
  params: {
    customerName: string;
    storeProfile: StoreProfile;
    totalOutstanding: number;
    invoices: CustomerInvoiceSummary[];
  }
): string {
  const cfg = templateConfig?.bodyTemplate?.trim()
    ? templateConfig
    : DEFAULT_WHATSAPP_TEMPLATE_CONFIG;

  const storeName = params.storeProfile.storeName || 'Arjun Groceries';
  const upiId = params.storeProfile.upiId || '';
  const formattedAmount = params.totalOutstanding.toLocaleString('en-IN');

  const invoiceLines =
    cfg.includeInvoiceList !== false
      ? params.invoices
          .map(
            (inv) =>
              `- ${inv.invoiceNo} (${new Date(inv.date).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
              })}): Rs.${inv.outstandingAmount.toLocaleString('en-IN')}`
          )
          .join('\n')
      : `${params.invoices.length} pending bill(s)`;

  const upiFragment =
    cfg.includeUpiId !== false && upiId ? ` via UPI: ${upiId}` : '';

  const replaceTokens = (raw: string) =>
    raw
      .replaceAll('{{customer_name}}', params.customerName || 'Customer')
      .replaceAll('{{store_name}}', storeName)
      .replaceAll('{{amount}}', formattedAmount)
      .replaceAll('{{invoices}}', invoiceLines)
      .replaceAll('{{upi_id}}', upiFragment);

  const renderedBody = replaceTokens(cfg.bodyTemplate).trim();
  const renderedFooter = cfg.footerText?.trim()
    ? replaceTokens(cfg.footerText).trim()
    : '';

  return renderedFooter ? `${renderedBody}\n\n${renderedFooter}` : renderedBody;
}

export interface WhatsAppAnalyticsData {
  summary: {
    totalAttempts: number;
    sentCount: number;
    deliveredOrReadCount: number;
    failedCount: number;
    pendingCount: number;
    successRatePct: number;
    totalRemindedRupees: number;
    totalRecoveredAfterReminder: number;
    outstandingReductionPct: number;
  };
  statusBreakdown: Array<{ name: string; value: number; fill: string }>;
  trend30Days: Array<{
    dateKey: string;
    label: string;
    sent: number;
    delivered: number;
    failed: number;
  }>;
  balanceImpactByBatch: Array<{
    batchLabel: string;
    remindedAmount: number;
    recoveredAmount: number;
    remainingAmount: number;
  }>;
}

/**
 * Pure analytics computation for WhatsApp Reminders Dashboard Recharts visualizations.
 */
export function computeWhatsAppReminderAnalytics(
  batches: WhatsAppReminderBatch[],
  auditLogs: WhatsAppAuditLog[],
  customers: Customer[],
  customerTransactions: CustomerTransaction[],
  referenceDate: Date = new Date()
): WhatsAppAnalyticsData {
  let sentCount = 0;
  let deliveredOrReadCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  let totalRemindedRupees = 0;

  const customerMap = new Map<string, Customer>();
  customers.forEach((c) => customerMap.set(c.id, c));

  // Build 30-day rolling bucket map
  const trendMap = new Map<
    string,
    { dateKey: string; label: string; sent: number; delivered: number; failed: number }
  >();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    trendMap.set(key, { dateKey: key, label, sent: 0, delivered: 0, failed: 0 });
  }

  const batchImpactList: WhatsAppAnalyticsData['balanceImpactByBatch'] = [];

  // Sort batches oldest -> newest for chronological chart bars
  const sortedBatches = [...batches].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  for (const batch of sortedBatches) {
    let batchReminded = 0;
    let batchRecovered = 0;

    for (const item of batch.items) {
      const status = item.status;
      if (status === 'DELIVERED' || status === 'READ') {
        deliveredOrReadCount++;
        sentCount++;
      } else if (status === 'SENT' || status === 'ACCEPTED') {
        sentCount++;
      } else if (status === 'FAILED') {
        failedCount++;
      } else if (status === 'PENDING' || status === 'APPROVED' || status === 'SENDING') {
        pendingCount++;
      }

      const eventIso = item.sentAt || item.lastAttemptAt || batch.completedAt || batch.createdAt;
      const dateKey = eventIso ? eventIso.slice(0, 10) : '';
      const bucket = trendMap.get(dateKey);
      if (bucket) {
        if (status === 'DELIVERED' || status === 'READ') {
          bucket.sent += 1;
          bucket.delivered += 1;
        } else if (status === 'SENT' || status === 'ACCEPTED') {
          bucket.sent += 1;
        } else if (status === 'FAILED') {
          bucket.failed += 1;
        }
      }

      if (status === 'SENT' || status === 'ACCEPTED' || status === 'DELIVERED' || status === 'READ') {
        const amt = Number(item.totalOutstanding) || 0;
        totalRemindedRupees += amt;
        batchReminded += amt;

        // Calculate payments collected from this customer after reminder sentAt
        const sentTime = new Date(eventIso).getTime();
        const paymentsAfter = customerTransactions
          .filter(
            (tx) =>
              tx.customerId === item.customerId &&
              tx.type === 'PAYMENT' &&
              tx.status !== 'CANCELLED' &&
              tx.status !== 'REVERSED' &&
              new Date(tx.date).getTime() >= sentTime
          )
          .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);

        const cust = customerMap.get(item.customerId);
        const currentBal = cust ? Math.max(0, Number(cust.currentBalance) || 0) : amt;
        const impliedRecovered =
          paymentsAfter > 0
            ? Math.min(amt, paymentsAfter)
            : Math.max(0, amt - currentBal);
        batchRecovered += impliedRecovered;
      }
    }

    if (batchReminded > 0) {
      batchImpactList.push({
        batchLabel: batch.dateWindowEnd.slice(5, 10),
        remindedAmount: Math.round(batchReminded),
        recoveredAmount: Math.round(batchRecovered),
        remainingAmount: Math.max(0, Math.round(batchReminded - batchRecovered)),
      });
    }
  }

  // Also include TEST_MESSAGE_SENT / TEST_MESSAGE_FAILED audit events into 30-day trend if batch items didn't cover them
  for (const log of auditLogs) {
    const dk = log.timestamp?.slice(0, 10);
    const bucket = dk ? trendMap.get(dk) : undefined;
    if (bucket && (log.action === 'TEST_MESSAGE_SENT' || log.action === 'TEST_MESSAGE_FAILED')) {
      if (log.action === 'TEST_MESSAGE_SENT') {
        bucket.sent += 1;
      } else {
        bucket.failed += 1;
      }
    }
  }

  const totalRecoveredAfterReminder = Math.round(
    batchImpactList.reduce((sum, b) => sum + b.recoveredAmount, 0)
  );
  const totalAttempts = sentCount + failedCount;
  const successRatePct =
    totalAttempts > 0 ? Math.round((sentCount / totalAttempts) * 1000) / 10 : 0;
  const outstandingReductionPct =
    totalRemindedRupees > 0
      ? Math.min(100, Math.round((totalRecoveredAfterReminder / totalRemindedRupees) * 1000) / 10)
      : 0;

  return {
    summary: {
      totalAttempts,
      sentCount,
      deliveredOrReadCount,
      failedCount,
      pendingCount,
      successRatePct,
      totalRemindedRupees: Math.round(totalRemindedRupees),
      totalRecoveredAfterReminder,
      outstandingReductionPct,
    },
    statusBreakdown: [
      { name: 'Sent / Accepted', value: Math.max(0, sentCount - deliveredOrReadCount), fill: '#059669' },
      { name: 'Delivered / Read', value: deliveredOrReadCount, fill: '#047857' },
      { name: 'Failed', value: failedCount, fill: '#dc2626' },
      { name: 'Pending Review', value: pendingCount, fill: '#d97706' },
    ].filter((d) => d.value > 0),
    trend30Days: Array.from(trendMap.values()),
    balanceImpactByBatch: batchImpactList.slice(-8),
  };
}

/**
 * Extracts chronological WhatsApp reminder history for a specific customer across batches & audit logs.
 */
export function getCustomerReminderHistory(
  customerId: string,
  batches: WhatsAppReminderBatch[],
  auditLogs: WhatsAppAuditLog[] = []
): CustomerReminderHistoryEntry[] {
  const entries: CustomerReminderHistoryEntry[] = [];
  const seenKeys = new Set<string>();
  const seenWabaIds = new Set<string>();
  const seenTimestamps: number[] = [];

  for (const batch of batches) {
    for (const item of batch.items) {
      if (item.customerId !== customerId) continue;
      if (item.status === 'EXCLUDED' && !item.sentAt && !item.lastAttemptAt) continue;

      const sentAt = item.sentAt || item.lastAttemptAt || batch.completedAt || batch.createdAt;
      const key = `${batch.id}:${item.customerId}`;
      seenKeys.add(key);
      if (item.wabaMessageId) seenWabaIds.add(item.wabaMessageId);
      const sentMs = new Date(sentAt).getTime();
      if (!Number.isNaN(sentMs)) seenTimestamps.push(sentMs);

      entries.push({
        id: item.idempotencyKey || key,
        batchId: batch.id,
        sentAt,
        status: item.status,
        outstandingAtTime: Number(item.totalOutstanding) || 0,
        invoicesCount: item.invoices?.length || 0,
        invoiceNumbers: (item.invoices || []).map((inv) => inv.invoiceNo),
        messageText: item.customizedMessage || item.messageText,
        wabaMessageId: item.wabaMessageId,
        errorReason: item.errorReason,
        sandboxSimulated: item.apiResponseSummary?.sandboxSimulated,
      });
    }
  }

  // Fallback audit log entries when item wasn't in a local batch
  for (const log of auditLogs) {
    if (log.customerId !== customerId) continue;
    if (log.action !== 'MESSAGE_SENT' && log.action !== 'MESSAGE_FAILED') continue;
    const key = `${log.batchId || 'manual'}:${customerId}`;
    if (seenKeys.has(key)) continue;
    if (log.wabaMessageId && seenWabaIds.has(log.wabaMessageId)) continue;
    const logMs = new Date(log.timestamp).getTime();
    if (!Number.isNaN(logMs) && seenTimestamps.some((ts) => Math.abs(ts - logMs) < 5000)) {
      continue;
    }

    entries.push({
      id: log.id,
      batchId: log.batchId || 'Manual Dispatch',
      sentAt: log.timestamp,
      status: log.action === 'MESSAGE_FAILED' ? 'FAILED' : 'SENT',
      outstandingAtTime: 0,
      invoicesCount: 0,
      invoiceNumbers: [],
      messageText: log.details,
      wabaMessageId: log.wabaMessageId,
    });
  }

  return entries.sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
  );
}
