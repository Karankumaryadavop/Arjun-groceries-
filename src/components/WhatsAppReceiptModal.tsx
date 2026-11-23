import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  MessageCircle,
  Phone,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';
import { Customer, SaleRecord, StoreProfile } from '../types';
import { formatINR } from '../utils/accounting';
import {
  buildWhatsAppShareUrl,
  formatSaleReceiptWhatsAppText,
  normalizeIndianPhoneForWhatsApp,
  renderSaleReceiptCanvasDataUrl,
} from '../utils/whatsappReceipt';

interface WhatsAppReceiptModalProps {
  sale: SaleRecord;
  profile: StoreProfile;
  customer?: Customer;
  onClose: () => void;
}

export const WhatsAppReceiptModal: React.FC<WhatsAppReceiptModalProps> = ({
  sale,
  profile,
  customer,
  onClose,
}) => {
  const [shareTab, setShareTab] = useState<'TEXT' | 'IMAGE'>('TEXT');
  const [phoneInput, setPhoneInput] = useState<string>(customer?.phone || '');
  const [messageText, setMessageText] = useState<string>(() =>
    formatSaleReceiptWhatsAppText(sale, profile, customer)
  );
  const [copied, setCopied] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const dataUrl = renderSaleReceiptCanvasDataUrl(sale, profile, customer);
    setReceiptImageUrl(dataUrl);
  }, [sale, profile, customer]);

  const normalizedPhone = useMemo(
    () => normalizeIndianPhoneForWhatsApp(phoneInput),
    [phoneInput]
  );

  const whatsappUrl = useMemo(
    () => buildWhatsAppShareUrl(phoneInput, messageText),
    [phoneInput, messageText]
  );

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareFeedback('Could not access clipboard automatically. Please select and copy the text.');
    }
  };

  const handleNativeShareImage = async () => {
    if (!receiptImageUrl) return;
    try {
      const response = await fetch(receiptImageUrl);
      const blob = await response.blob();
      const file = new File([blob], `receipt-${sale.invoiceNo}.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Receipt #${sale.invoiceNo} - ${profile.storeName}`,
          text: `Bill Receipt #${sale.invoiceNo} (${formatINR(sale.amount)}) from ${profile.storeName}`,
          files: [file],
        });
        setShareFeedback('Receipt image shared successfully.');
      } else {
        setShareFeedback(
          'Direct file share is not supported in this desktop browser. Download the PNG and attach it in WhatsApp.'
        );
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setShareFeedback('Download the PNG receipt below and attach it in your WhatsApp chat.');
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share Sale Receipt on WhatsApp"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-emerald-800 dark:bg-emerald-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-700 dark:bg-emerald-800">
              <MessageCircle className="w-5 h-5 text-emerald-100" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">
                Share Receipt on WhatsApp
              </h3>
              <p className="text-xs text-emerald-100/90 tabular-nums">
                Bill #{sale.invoiceNo} · {formatINR(sale.amount)} · {sale.paymentMethod}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close WhatsApp share modal"
            className="p-1.5 rounded-lg text-emerald-100 hover:bg-emerald-700 dark:hover:bg-emerald-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Customer WhatsApp Number */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
              Customer WhatsApp Number (Mobile)
            </label>
            <div className="relative flex items-center">
              <Phone className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3" />
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Enter 10-digit WhatsApp number (e.g. 9876543210)"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-emerald-700 tabular-nums"
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {normalizedPhone.length >= 10
                ? `Ready to open chat with +${normalizedPhone}`
                : 'No number entered: WhatsApp will open contact picker so you can select any customer.'}
            </p>
          </div>

          {/* Mode Tabs: Formatted Text vs Digital Receipt Image */}
          <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setShareTab('TEXT')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                shareTab === 'TEXT'
                  ? 'bg-white dark:bg-slate-900 text-emerald-900 dark:text-emerald-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Formatted Text Bill</span>
            </button>
            <button
              type="button"
              onClick={() => setShareTab('IMAGE')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                shareTab === 'IMAGE'
                  ? 'bg-white dark:bg-slate-900 text-emerald-900 dark:text-emerald-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Receipt Image (PNG)</span>
            </button>
          </div>

          {shareTab === 'TEXT' ? (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    WhatsApp Message Preview (Editable)
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyText}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 dark:text-emerald-400 hover:text-emerald-950 dark:hover:text-emerald-300 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Text</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  rows={10}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  className="w-full text-xs font-mono text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:outline-emerald-700 leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyText}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copied ? 'Copied!' : 'Copy Summary'}</span>
                </button>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Send on WhatsApp</span>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {receiptImageUrl ? (
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 p-3 flex justify-center">
                  <img
                    src={receiptImageUrl}
                    alt={`Receipt #${sale.invoiceNo}`}
                    className="max-h-72 w-auto rounded-lg shadow-xs border border-slate-200 dark:border-slate-700"
                  />
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                  Generating receipt image preview...
                </div>
              )}

              {shareFeedback && (
                <div className="text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl p-2.5">
                  {shareFeedback}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {receiptImageUrl && (
                  <a
                    href={receiptImageUrl}
                    download={`kirana-receipt-${sale.invoiceNo}.png`}
                    className="px-3.5 py-2 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Image PNG</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleNativeShareImage}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share Receipt Image</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
