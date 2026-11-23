/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Customer } from '../types';
import { useStore } from '../context/StoreContext';
import { formatINR } from '../utils/accounting';
import {
  QrCode,
  X,
  Share2,
  Download,
  CheckCircle2,
  IndianRupee,
  Smartphone,
  Copy,
  Check,
  Send,
  Building2,
  Clock,
  Sparkles,
} from 'lucide-react';

interface PaymentQrModalProps {
  customer: Customer | null;
  isOpen?: boolean;
  onClose: () => void;
  defaultAmount?: number;
}

export const PaymentQrModal: React.FC<PaymentQrModalProps> = ({
  customer,
  isOpen = true,
  onClose,
  defaultAmount,
}) => {
  const { profile, recordCustomerPayment } = useStore();

  const [amount, setAmount] = useState<number>(0);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [isReceivedSuccess, setIsReceivedSuccess] = useState(false);

  const storeUpi = (profile.upiId || '').trim();
  const storeName = (profile.storeName || '').trim() || 'My Grocery Store';

  // Update amount when customer changes or modal opens
  useEffect(() => {
    if (customer) {
      const initialAmt =
        defaultAmount !== undefined
          ? defaultAmount
          : Math.max(0, customer.currentBalance);
      setAmount(initialAmt);
      setIsReceivedSuccess(false);
    }
  }, [customer, defaultAmount, isOpen]);

  // Generate dynamic UPI URI and render QR Code
  useEffect(() => {
    if (!customer || !isOpen || !storeUpi) {
      setQrDataUrl('');
      return;
    }

    const safeAmount = Math.max(1, Number(amount) || 0);
    const payeeName = profile.ownerName
      ? `${storeName} - ${profile.ownerName}`
      : storeName;
    const note = `Khata Payment - ${customer.name}`;

    // Standard NPCI Unified Payment Interface (UPI) URI format
    const upiUri = `upi://pay?pa=${encodeURIComponent(storeUpi)}&pn=${encodeURIComponent(
      payeeName
    )}&am=${safeAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

    QRCode.toDataURL(upiUri, {
      width: 320,
      margin: 1.5,
      color: {
        dark: '#064e3b', // Professional deep emerald
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate UPI QR code', err));
  }, [customer, amount, storeUpi, storeName, profile.ownerName, isOpen]);

  if (!isOpen || !customer) return null;

  const handleCopyUpi = async () => {
    try {
      await navigator.clipboard.writeText(storeUpi);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleSendWhatsApp = () => {
    const safeAmount = Math.max(1, Number(amount) || 0);
    const upiLine = storeUpi
      ? `Kripya neeche diye gaye UPI ID par GooglePay / PhonePe / Paytm se bhugtan karein:\n👉 *UPI ID:* \`${storeUpi}\`\n\n`
      : '';
    const ownerLabel = profile.ownerName ? `${profile.ownerName}${profile.phone ? ` (${profile.phone})` : ''}` : `${storeName}${profile.phone ? ` (${profile.phone})` : ''}`;
    const msg =
      `*Namaste ${customer.name} ji,* 🙏\n\n` +
      `*${storeName}* ki taraf se aapke khate ka bakaya:\n` +
      `💰 *Kul Bakaya Rashi:* ${formatINR(customer.currentBalance)}\n` +
      `💳 *Bhugtan Karne Yogya Rashi:* ${formatINR(safeAmount)}\n\n` +
      upiLine +
      `_Dukandar: ${ownerLabel}_\n` +
      `Dhanyawad! 🙏`;

    const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
    const fullPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const url = `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodeURIComponent(
      msg
    )}`;
    window.open(url, '_blank');
  };

  const handleDirectReceive = () => {
    const payAmt = Math.max(1, Number(amount) || 0);
    recordCustomerPayment(
      customer.id,
      payAmt,
      `UPI QR payment received from ${customer.name}`,
      'UPI'
    );
    setIsReceivedSuccess(true);
    setTimeout(() => {
      setIsReceivedSuccess(false);
      onClose();
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-950 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <QrCode className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg">Generate Payment QR</h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/30 text-emerald-200">
                  LIVE UPI
                </span>
              </div>
              <p className="text-xs text-emerald-200/80">
                Scan with any Indian UPI App (GPay, PhonePe, Paytm)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment QR modal"
            className="p-1.5 rounded-lg text-emerald-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {isReceivedSuccess ? (
            <div className="p-6 text-center space-y-2 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mx-auto animate-bounce" />
              <h4 className="font-bold text-emerald-950 dark:text-emerald-200 text-base">Payment Recorded Successfully!</h4>
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                {formatINR(amount)} credited to {customer.name}&apos;s ledger and added to cashbook.
              </p>
            </div>
          ) : (
            <>
              {/* Customer & Store Info Banner */}
              <div className="bg-slate-50 dark:bg-slate-800/70 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Customer Account (Grahak Khata)
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">{customer.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{customer.phone}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">Current Balance Due</div>
                  <div className="text-base font-extrabold text-red-600 dark:text-red-400">
                    {formatINR(customer.currentBalance)}
                  </div>
                  {customer.overdueDays > 0 && (
                    <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      {customer.overdueDays} days pending
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic Amount Input with Presets */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                    <IndianRupee className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                    <span>Payment Amount (QR Rashi ₹):</span>
                  </label>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Pre-filled with full balance</span>
                </div>

                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 font-bold text-lg">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="1000000"
                    value={amount || ''}
                    onChange={(e) => setAmount(Number(e.target.value) || 0)}
                    className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 border-2 border-emerald-600 dark:border-emerald-500 rounded-xl text-lg font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-inner"
                    placeholder="Enter amount"
                  />
                </div>

                {/* Quick Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setAmount(customer.currentBalance)}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900 transition-colors cursor-pointer"
                  >
                    Full Due: {formatINR(customer.currentBalance)}
                  </button>
                  {[500, 1000, 2000, 5000].map(
                    (chip) =>
                      chip < customer.currentBalance && (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setAmount(chip)}
                          className="px-2 py-1 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer font-medium"
                        >
                          ₹{chip}
                        </button>
                      )
                  )}
                </div>
              </div>

              {/* Rendered Scannable QR Code Card (inner QR wrapper stays white for camera contrast) */}
              <div className="bg-gradient-to-b from-emerald-50/60 to-white dark:from-slate-800/70 dark:to-slate-900 rounded-2xl p-4 border-2 border-emerald-200 dark:border-emerald-800 text-center space-y-3">
                {storeUpi ? (
                  <>
                    <div className="inline-block bg-white p-3 rounded-2xl border border-emerald-100 shadow-md">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt="UPI QR Code"
                          className="w-48 h-48 sm:w-52 sm:h-52 mx-auto rounded-lg object-contain"
                        />
                      ) : (
                        <div className="w-48 h-48 sm:w-52 sm:h-52 flex items-center justify-center text-slate-400 text-xs">
                          Generating QR...
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Scan &amp; Pay to: <span className="text-emerald-800 dark:text-emerald-400">{storeName}</span>
                      </div>
                      <div className="flex items-center justify-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-mono">
                        <span>UPI ID: {storeUpi}</span>
                        <button
                          type="button"
                          onClick={handleCopyUpi}
                          className="p-1 hover:text-emerald-700 dark:hover:text-emerald-400 text-slate-400 dark:text-slate-500 cursor-pointer"
                          title="Copy UPI ID"
                        >
                          {copiedUpi ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                    No Store UPI ID configured yet. Add your real UPI ID in Store Settings to generate a scannable payment QR code.
                  </div>
                )}

                {/* Supported Apps Badges */}
                <div className="flex items-center justify-center gap-2 pt-1 border-t border-emerald-100 dark:border-slate-700 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
                    Google Pay
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
                    PhonePe
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
                    Paytm
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
                    BHIM UPI
                  </span>
                </div>
              </div>

              {/* Action Buttons: WhatsApp Share & Record Payment */}
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleSendWhatsApp}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>Send on WhatsApp</span>
                  </button>

                  <a
                    href={qrDataUrl}
                    download={`upi-qr-${customer.name.replace(/\s+/g, '-').toLowerCase()}-${amount}.png`}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                    <span>Download QR</span>
                  </a>
                </div>

                <button
                  type="button"
                  onClick={handleDirectReceive}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold text-sm rounded-xl shadow-md transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Mark Paid: {formatINR(amount)} (Khate me Jama Kare)</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Zero transaction fees via direct UPI
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
