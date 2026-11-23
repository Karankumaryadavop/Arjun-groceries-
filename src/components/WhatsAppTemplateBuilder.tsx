/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import {
  DEFAULT_WHATSAPP_TEMPLATE_CONFIG,
  renderWhatsAppTemplateMessage,
  validateWhatsAppTemplate,
  WHATSAPP_TEMPLATE_TOKENS,
} from '../utils/whatsappTemplate';
import { WhatsAppTemplateConfig } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export const WhatsAppTemplateBuilder: React.FC = () => {
  const { profile, updateProfile } = useStore();

  const initialConfig: WhatsAppTemplateConfig =
    profile.whatsappTemplateConfig || DEFAULT_WHATSAPP_TEMPLATE_CONFIG;

  const [templateName, setTemplateName] = useState(initialConfig.templateName);
  const [bodyTemplate, setBodyTemplate] = useState(initialConfig.bodyTemplate);
  const [footerText, setFooterText] = useState(initialConfig.footerText || '');
  const [includeInvoiceList, setIncludeInvoiceList] = useState(
    initialConfig.includeInvoiceList !== false
  );
  const [includeUpiId, setIncludeUpiId] = useState(initialConfig.includeUpiId !== false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const currentConfig: WhatsAppTemplateConfig = useMemo(
    () => ({
      templateName: templateName.trim(),
      bodyTemplate,
      footerText,
      includeInvoiceList,
      includeUpiId,
      updatedAt: new Date().toISOString(),
    }),
    [templateName, bodyTemplate, footerText, includeInvoiceList, includeUpiId]
  );

  const validation = useMemo(
    () => validateWhatsAppTemplate(currentConfig),
    [currentConfig]
  );

  const livePreviewText = useMemo(
    () =>
      renderWhatsAppTemplateMessage(currentConfig, {
        customerName: 'Ramesh Sharma',
        storeProfile: profile,
        totalOutstanding: 1450,
        invoices: [
          {
            invoiceId: 'sample-1',
            invoiceNo: 'INV-204',
            date: new Date().toISOString(),
            originalAmount: 1000,
            paidAmount: 0,
            outstandingAmount: 1000,
          },
          {
            invoiceId: 'sample-2',
            invoiceNo: 'INV-211',
            date: new Date().toISOString(),
            originalAmount: 450,
            paidAmount: 0,
            outstandingAmount: 450,
          },
        ],
      }),
    [currentConfig, profile]
  );

  const handleInsertToken = (token: string) => {
    setBodyTemplate((prev) => (prev.endsWith(' ') || prev.endsWith('\n') ? `${prev}${token}` : `${prev} ${token}`));
  };

  const handleSaveTemplate = () => {
    if (!validation.valid) return;
    updateProfile({
      whatsappTemplateConfig: {
        ...currentConfig,
        updatedAt: new Date().toISOString(),
      },
    });
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 3000);
  };

  const handleResetDefault = () => {
    setTemplateName(DEFAULT_WHATSAPP_TEMPLATE_CONFIG.templateName);
    setBodyTemplate(DEFAULT_WHATSAPP_TEMPLATE_CONFIG.bodyTemplate);
    setFooterText(DEFAULT_WHATSAPP_TEMPLATE_CONFIG.footerText || '');
    setIncludeInvoiceList(true);
    setIncludeUpiId(true);
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <span>Custom WhatsApp Payment Reminder Template</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Customize your utility reminder wording with dynamic customer placeholders and check Meta WhatsApp Business compliance before sending.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
              validation.valid && validation.score >= 90
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : validation.valid
                ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                : 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800'
            }`}
          >
            Meta Compliance Score: {validation.score}/100
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Template Editor */}
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Meta Template Name (lowercase + underscores)
              </label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="payment_reminder_weekly"
                className="w-full text-xs font-mono border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
              />
            </div>

            <div className="flex items-end gap-4 pb-1">
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeInvoiceList}
                  onChange={(e) => setIncludeInvoiceList(e.target.checked)}
                  className="w-4 h-4 text-emerald-700 rounded border-slate-300"
                />
                <span>Include Itemized Bills</span>
              </label>

              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUpiId}
                  onChange={(e) => setIncludeUpiId(e.target.checked)}
                  className="w-4 h-4 text-emerald-700 rounded border-slate-300"
                />
                <span>Include UPI VPA</span>
              </label>
            </div>
          </div>

          {/* Click-to-Insert Placeholder Chips */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
              <span>Insert Dynamic Variable Placeholders</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WHATSAPP_TEMPLATE_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => handleInsertToken(t.token)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-[11px] font-semibold cursor-pointer transition-colors"
                >
                  + {t.label}{' '}
                  <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                    {t.token}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Message Body Template
              </label>
              <span
                className={`text-[11px] font-mono ${
                  validation.characterCount > 1024 ? 'text-red-600 font-bold' : 'text-slate-400'
                }`}
              >
                {validation.characterCount} / 1024 chars
              </span>
            </div>
            <textarea
              rows={7}
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              className="w-full text-xs leading-relaxed border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-3 focus:outline-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Footer Signature (Optional)
            </label>
            <input
              type="text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Dhanyavaad! {{store_name}}"
              className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
            />
          </div>

          {/* Guideline Errors & Warnings */}
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="space-y-2">
              {validation.errors.map((err, i) => (
                <div
                  key={`err-${i}`}
                  className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200 flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{err}</span>
                </div>
              ))}
              {validation.warnings.map((warn, i) => (
                <div
                  key={`warn-${i}`}
                  className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>{warn}</span>
                </div>
              ))}
            </div>
          )}

          {/* Save Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={handleResetDefault}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default Template</span>
            </button>

            <div className="flex items-center gap-3">
              {savedFeedback && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Template Saved!</span>
                </span>
              )}
              <button
                type="button"
                disabled={!validation.valid}
                onClick={handleSaveTemplate}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Save WhatsApp Template
              </button>
            </div>
          </div>
        </div>

        {/* Right: Live WhatsApp Preview */}
        <div className="lg:col-span-5 space-y-3">
          <div className="p-4 rounded-2xl bg-emerald-950/5 dark:bg-slate-950 border border-emerald-200 dark:border-emerald-900/50 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-emerald-900 dark:text-emerald-300">
              <span className="flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Live WhatsApp Customer Preview</span>
              </span>
              <span className="text-[10px] font-mono text-slate-500">UTILITY</span>
            </div>

            <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-2xl rounded-tl-xs p-3.5 shadow-2xs">
              <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 dark:text-slate-100 leading-relaxed">
                {livePreviewText}
              </pre>
              <div className="text-[10px] text-slate-400 text-right mt-2">
                12:00 PM · Delivered
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
              <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>Meta Utility Template Checklist</span>
              </div>
              <p>
                Keep messages informative (amount, store name, bill numbers). Avoid promotional offers or link shorteners so Meta approves your template rapidly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
