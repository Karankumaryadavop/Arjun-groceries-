import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { StoreProfile, ThermalPrintConfig } from '../types';
import { formatINR } from '../utils/accounting';
import {
  buildThermalPrintDocumentHtml,
  printThermalReceiptDocument,
  resolveThermalPrintConfig,
  ThermalReceiptData,
} from '../utils/thermalPrint';
import { formatQuantityWithUnit } from '../utils/units';
import { ARJUN_GROCERIES_LOGO_SRC } from './BrandLogo';

export const DEFAULT_THERMAL_LOGO_SRC = ARJUN_GROCERIES_LOGO_SRC;

interface ThermalReceiptPreviewProps {
  profile: StoreProfile;
  receipt: ThermalReceiptData;
  configOverride?: ThermalPrintConfig;
  className?: string;
}

export function resolveThermalLogoSrc(config: ThermalPrintConfig): string | undefined {
  if (!config.showLogo) return undefined;
  if (config.logoMode === 'CUSTOM' && config.customLogoDataUrl) {
    return config.customLogoDataUrl;
  }
  return DEFAULT_THERMAL_LOGO_SRC;
}

export async function triggerCustomThermalPrint(params: {
  profile: StoreProfile;
  receipt: ThermalReceiptData;
  configOverride?: ThermalPrintConfig;
}): Promise<boolean> {
  const config = params.configOverride || resolveThermalPrintConfig(params.profile);
  const logoSrc = resolveThermalLogoSrc(config);

  let upiQrDataUrl: string | undefined;
  if (config.showUpiQr && params.profile.upiId?.trim()) {
    try {
      const upiUri = `upi://pay?pa=${encodeURIComponent(params.profile.upiId.trim())}&pn=${encodeURIComponent(
        config.headerTitle?.trim() || params.profile.storeName || 'Arjun Groceries'
      )}&am=${encodeURIComponent(String(Math.max(0, params.receipt.totalAmount || 0)))}&cu=INR`;
      upiQrDataUrl = await QRCode.toDataURL(upiUri, {
        width: 140,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {
      upiQrDataUrl = undefined;
    }
  }

  const html = buildThermalPrintDocumentHtml({
    profile: params.profile,
    config,
    receipt: params.receipt,
    logoSrc,
    upiQrDataUrl,
  });

  return printThermalReceiptDocument(html);
}

export const ThermalReceiptPreview: React.FC<ThermalReceiptPreviewProps> = ({
  profile,
  receipt,
  configOverride,
  className = '',
}) => {
  const config = configOverride || resolveThermalPrintConfig(profile);
  const logoSrc = resolveThermalLogoSrc(config);
  const [upiQrDataUrl, setUpiQrDataUrl] = useState<string>('');

  const displayTitle = config.headerTitle?.trim() || profile.storeName || 'Arjun Groceries';
  const alignClass = config.headerAlignment === 'LEFT' ? 'text-left' : 'text-center';
  const widthClass = config.paperWidth === '58mm' ? 'max-w-[248px]' : 'max-w-[330px]';

  useEffect(() => {
    let cancelled = false;
    if (!config.showUpiQr || !profile.upiId?.trim()) {
      setUpiQrDataUrl('');
      return;
    }
    const upiUri = `upi://pay?pa=${encodeURIComponent(profile.upiId.trim())}&pn=${encodeURIComponent(
      displayTitle
    )}&am=${encodeURIComponent(String(Math.max(0, receipt.totalAmount || 0)))}&cu=INR`;
    QRCode.toDataURL(upiUri, {
      width: 120,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setUpiQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setUpiQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [config.showUpiQr, profile.upiId, displayTitle, receipt.totalAmount]);

  const dateObj = new Date(receipt.dateIso);
  const dateLabel = Number.isNaN(dateObj.getTime())
    ? receipt.dateIso
    : dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeLabel = Number.isNaN(dateObj.getTime())
    ? ''
    : dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const totalDiscount = receipt.items.reduce(
    (sum, it) => sum + Math.max(0, Number(it.discount) || 0),
    0
  );

  return (
    <div
      data-testid="thermal-receipt-preview"
      className={`bg-white text-slate-900 border border-slate-300 rounded-xl p-4 font-mono shadow-sm mx-auto w-full ${widthClass} ${
        config.paperWidth === '58mm' ? 'text-[10.5px]' : 'text-xs'
      } ${className}`}
    >
      {/* Header Section */}
      <div className={`${alignClass} pb-2.5 border-b border-dashed border-slate-400 space-y-0.5`}>
        {config.showLogo && logoSrc && (
          <div className={`mb-1.5 flex ${config.headerAlignment === 'LEFT' ? 'justify-start' : 'justify-center'}`}>
            <img
              src={logoSrc}
              alt={`${displayTitle} logo`}
              referrerPolicy="no-referrer"
              style={{ height: `${config.logoHeightPx}px` }}
              className="w-auto max-w-full object-contain rounded"
            />
          </div>
        )}
        <div className="font-extrabold text-sm tracking-tight text-slate-950">{displayTitle}</div>
        {config.showAddress && profile.address && (
          <div className="text-[10px] text-slate-600 leading-snug">{profile.address}</div>
        )}
        {config.showPhone && profile.phone && (
          <div className="text-[10px] text-slate-600">Ph: {profile.phone}</div>
        )}
        {config.showGstin && profile.gstin && (
          <div className="text-[10px] text-slate-700 font-semibold">GSTIN: {profile.gstin}</div>
        )}
        {config.headerLines.map((line, idx) => (
          <div key={idx} className="text-[10px] text-slate-700 leading-snug">
            {line}
          </div>
        ))}
        {receipt.isCancelled && (
          <div className="inline-block mt-1 px-2 py-0.5 border border-red-700 text-red-700 font-bold text-[10px]">
            CANCELLED BILL / VOID
          </div>
        )}
      </div>

      {/* Bill Metadata */}
      <div className="py-2 border-b border-dashed border-slate-300 space-y-1 text-[10.5px]">
        <div className="flex justify-between gap-2">
          <span className="font-semibold">Bill #{receipt.invoiceNo}</span>
          <span className="tabular-nums text-slate-600">
            {dateLabel} {timeLabel}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Mode: {receipt.paymentMethod}</span>
          {receipt.customerName && (
            <span className="truncate max-w-[140px]">Cust: {receipt.customerName}</span>
          )}
        </div>
      </div>

      {/* Items List */}
      {receipt.items.length > 0 && (
        <div className="py-2 border-b border-dashed border-slate-300 space-y-1.5">
          <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase pb-1 border-b border-slate-200">
            <span>Item</span>
            <span>Amount</span>
          </div>
          {receipt.items.map((item, idx) => (
            <div key={idx} className="space-y-0.5">
              <div className="flex justify-between gap-2">
                <span className="leading-snug">
                  {item.productName}{' '}
                  <span className="text-slate-500">
                    ({item.unit ? formatQuantityWithUnit(item.quantity, item.unit) : `${item.quantity}x`})
                  </span>
                </span>
                <span className="tabular-nums shrink-0 font-medium">{formatINR(item.total)}</span>
              </div>
              {config.showItemDiscount && Number(item.discount || 0) > 0 && (
                <div className="text-[9.5px] text-slate-500">
                  Discount: -{formatINR(Number(item.discount))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="pt-2 space-y-1">
        {config.showItemDiscount && totalDiscount > 0 && (
          <div className="flex justify-between text-[10.5px] text-slate-600">
            <span>Total Savings:</span>
            <span className="tabular-nums">-{formatINR(totalDiscount)}</span>
          </div>
        )}
        {Number(receipt.loyaltyDiscountAmount || 0) > 0 && (
          <div className="flex justify-between text-[10.5px] text-emerald-700 font-semibold">
            <span>Loyalty ({receipt.loyaltyPointsRedeemed || 0} pts):</span>
            <span className="tabular-nums">-{formatINR(Number(receipt.loyaltyDiscountAmount))}</span>
          </div>
        )}
        <div className="flex justify-between font-extrabold text-sm text-slate-950 tabular-nums">
          <span>{receipt.isCancelled ? 'CANCELLED:' : 'TOTAL:'}</span>
          <span>{formatINR(receipt.totalAmount)}</span>
        </div>
        {!receipt.isCancelled && Number(receipt.loyaltyPointsEarned || 0) > 0 && (
          <div className="flex justify-between text-[10px] text-emerald-700 pt-0.5">
            <span>Loyalty Points Earned:</span>
            <span className="tabular-nums font-bold">+{receipt.loyaltyPointsEarned} pts</span>
          </div>
        )}
        {config.showCustomerBalance &&
          typeof receipt.customerBalanceAfter === 'number' &&
          receipt.customerName && (
            <div className="flex justify-between text-[10px] text-slate-600 pt-0.5">
              <span>Khata Balance:</span>
              <span className="tabular-nums font-semibold">
                {formatINR(receipt.customerBalanceAfter)}
              </span>
            </div>
          )}
      </div>

      {/* UPI ID / QR */}
      {config.showUpiId && profile.upiId && (
        <div className="text-center text-[10px] text-slate-700 mt-2.5 pt-2 border-t border-dashed border-slate-200">
          UPI: <span className="font-bold">{profile.upiId}</span>
        </div>
      )}
      {config.showUpiQr && upiQrDataUrl && (
        <div className="flex justify-center mt-2">
          <img src={upiQrDataUrl} alt="UPI Payment QR" className="w-24 h-24 rounded border border-slate-200" />
        </div>
      )}

      {/* Custom Footer Lines */}
      {config.footerLines.length > 0 && (
        <div className="text-center text-[10px] text-slate-600 mt-3 pt-2 border-t border-dashed border-slate-300 space-y-0.5">
          {config.footerLines.map((line, idx) => (
            <div key={idx} className="leading-snug">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
