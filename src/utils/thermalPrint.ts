/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SaleRecord, StoreProfile, ThermalPaperWidth, ThermalPrintConfig } from '../types';

export const DEFAULT_THERMAL_PRINT_CONFIG: ThermalPrintConfig = {
  paperWidth: '80mm',
  showLogo: true,
  logoMode: 'DEFAULT',
  customLogoDataUrl: undefined,
  logoHeightPx: 44,
  headerAlignment: 'CENTER',
  headerTitle: '',
  headerLines: ['Fresh Daily Kirana & Groceries', 'ESTIMATE BILL / KACHA PARCHI'],
  footerLines: ['Thank you for shopping with us!', 'Please check items before leaving the counter.'],
  showAddress: true,
  showPhone: true,
  showGstin: true,
  showUpiId: true,
  showUpiQr: false,
  showCustomerBalance: true,
  showItemDiscount: true,
};

export const ALLOWED_LOGO_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

export function validateThermalLogoDataUrl(dataUrl?: string | null): boolean {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  const trimmed = dataUrl.trim();
  if (trimmed.length > 450_000) return false; // Cap ~450KB to protect IndexedDB storage
  return /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed);
}

export function cleanMultilineEntries(lines?: string[] | string): string[] {
  if (!lines) return [];
  const rawList = Array.isArray(lines) ? lines : String(lines).split(/\r?\n/);
  return rawList
    .map((line) => String(line ?? '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);
}

export function normalizeThermalPrintConfig(
  input?: Partial<ThermalPrintConfig> | null
): ThermalPrintConfig {
  const base = DEFAULT_THERMAL_PRINT_CONFIG;
  if (!input) return { ...base, headerLines: [...base.headerLines], footerLines: [...base.footerLines] };

  const paperWidth: ThermalPaperWidth = input.paperWidth === '58mm' ? '58mm' : '80mm';
  const rawLogoHeight = Number(input.logoHeightPx);
  const logoHeightPx = Number.isFinite(rawLogoHeight)
    ? Math.max(24, Math.min(84, Math.round(rawLogoHeight)))
    : base.logoHeightPx;

  const validCustomLogo = validateThermalLogoDataUrl(input.customLogoDataUrl)
    ? input.customLogoDataUrl!.trim()
    : undefined;
  const logoMode: 'DEFAULT' | 'CUSTOM' =
    input.logoMode === 'CUSTOM' && validCustomLogo ? 'CUSTOM' : 'DEFAULT';

  const headerLines =
    input.headerLines !== undefined
      ? cleanMultilineEntries(input.headerLines)
      : [...base.headerLines];

  const footerLines =
    input.footerLines !== undefined
      ? cleanMultilineEntries(input.footerLines)
      : [...base.footerLines];

  return {
    paperWidth,
    showLogo: input.showLogo !== undefined ? Boolean(input.showLogo) : base.showLogo,
    logoMode,
    customLogoDataUrl: validCustomLogo,
    logoHeightPx,
    headerAlignment: input.headerAlignment === 'LEFT' ? 'LEFT' : 'CENTER',
    headerTitle: typeof input.headerTitle === 'string' ? input.headerTitle.trim() : '',
    headerLines,
    footerLines,
    showAddress: input.showAddress !== undefined ? Boolean(input.showAddress) : base.showAddress,
    showPhone: input.showPhone !== undefined ? Boolean(input.showPhone) : base.showPhone,
    showGstin: input.showGstin !== undefined ? Boolean(input.showGstin) : base.showGstin,
    showUpiId: input.showUpiId !== undefined ? Boolean(input.showUpiId) : base.showUpiId,
    showUpiQr: input.showUpiQr !== undefined ? Boolean(input.showUpiQr) : base.showUpiQr,
    showCustomerBalance:
      input.showCustomerBalance !== undefined
        ? Boolean(input.showCustomerBalance)
        : base.showCustomerBalance,
    showItemDiscount:
      input.showItemDiscount !== undefined
        ? Boolean(input.showItemDiscount)
        : base.showItemDiscount,
    updatedAt: input.updatedAt,
  };
}

export function resolveThermalPrintConfig(profile?: StoreProfile | null): ThermalPrintConfig {
  return normalizeThermalPrintConfig(profile?.thermalPrintConfig);
}

export interface ThermalReceiptItemInput {
  productName: string;
  quantity: number;
  unit?: string;
  rate?: number;
  discount?: number;
  total: number;
}

export interface ThermalReceiptData {
  invoiceNo: string;
  dateIso: string;
  paymentMethod: string;
  customerName?: string;
  customerBalanceAfter?: number;
  items: ThermalReceiptItemInput[];
  grossAmount?: number;
  loyaltyDiscountAmount?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyPointsEarned?: number;
  totalAmount: number;
  notes?: string;
  isCancelled?: boolean;
}

export function buildSampleThermalReceipt(profile: StoreProfile): ThermalReceiptData {
  return {
    invoiceNo: 'INV-2026-0418',
    dateIso: new Date().toISOString(),
    paymentMethod: 'UPI',
    customerName: 'Ramesh Bhai Patel',
    customerBalanceAfter: 450,
    items: [
      {
        productName: 'Aashirvaad Atta',
        quantity: 1,
        unit: '10kg bag',
        rate: 425,
        discount: 10,
        total: 415,
      },
      {
        productName: 'Fortune Sunflower Oil',
        quantity: 2,
        unit: '1L',
        rate: 145,
        discount: 0,
        total: 290,
      },
      {
        productName: 'Toor Dal Premium',
        quantity: 0.5,
        unit: 'KG',
        rate: 156,
        discount: 0,
        total: 78,
      },
    ],
    totalAmount: 783,
    notes: 'Counter Sale',
  };
}

export function buildThermalReceiptFromSale(
  sale: SaleRecord,
  customerBalanceAfter?: number
): ThermalReceiptData {
  return {
    invoiceNo: sale.invoiceNo || sale.id.slice(0, 8),
    dateIso: sale.date,
    paymentMethod: sale.paymentMethod,
    customerName: sale.customerName,
    customerBalanceAfter,
    items: (sale.items || []).map((it) => ({
      productName: it.productName,
      quantity: it.quantity,
      unit: it.unit,
      rate: it.rate,
      discount: it.discount,
      total: it.total,
    })),
    grossAmount: sale.grossAmount,
    loyaltyDiscountAmount: sale.loyaltyDiscountAmount,
    loyaltyPointsRedeemed: sale.loyaltyPointsRedeemed,
    loyaltyPointsEarned: sale.loyaltyPointsEarned,
    totalAmount: sale.amount,
    notes: sale.notes,
    isCancelled: sale.status === 'CANCELLED',
  };
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatReceiptInr(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `₹${safe.toLocaleString('en-IN', {
    minimumFractionDigits: safe % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Generates self-contained, XSS-escaped thermal receipt HTML sized for 58mm or 80mm printers.
 */
export function buildThermalPrintDocumentHtml(params: {
  profile: StoreProfile;
  config: ThermalPrintConfig;
  receipt: ThermalReceiptData;
  logoSrc?: string;
  upiQrDataUrl?: string;
}): string {
  const { profile, config, receipt, logoSrc, upiQrDataUrl } = params;
  const widthMm = config.paperWidth === '58mm' ? 58 : 80;
  const contentWidthMm = config.paperWidth === '58mm' ? 50 : 72;
  const align = config.headerAlignment === 'LEFT' ? 'left' : 'center';
  const title = config.headerTitle?.trim() || profile.storeName || 'Arjun Groceries';

  const dateObj = new Date(receipt.dateIso);
  const dateLabel = Number.isNaN(dateObj.getTime())
    ? receipt.dateIso
    : dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeLabel = Number.isNaN(dateObj.getTime())
    ? ''
    : dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const totalDiscount = receipt.items.reduce((sum, it) => sum + Math.max(0, Number(it.discount) || 0), 0);

  const logoHtml =
    config.showLogo && logoSrc
      ? `<div style="text-align:${align};margin-bottom:6px;"><img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(title)}" style="height:${config.logoHeightPx}px;width:auto;max-width:100%;object-fit:contain;display:inline-block;" /></div>`
      : '';

  const headerLinesHtml = config.headerLines
    .map((line) => `<div class="muted">${escapeHtml(line)}</div>`)
    .join('');

  const itemsHtml =
    receipt.items.length > 0
      ? `<table class="items">
          <thead>
            <tr>
              <th style="text-align:left;">Item</th>
              <th style="text-align:right;">Qty</th>
              <th style="text-align:right;">Amt</th>
            </tr>
          </thead>
          <tbody>
            ${receipt.items
              .map((it) => {
                const qtyLabel = `${it.quantity}${it.unit ? ` ${it.unit}` : ''}`;
                const discHtml =
                  config.showItemDiscount && it.discount && it.discount > 0
                    ? `<div class="sub">Disc: -${escapeHtml(formatReceiptInr(it.discount))}</div>`
                    : '';
                return `<tr>
                  <td>${escapeHtml(it.productName)}${discHtml}</td>
                  <td style="text-align:right;white-space:nowrap;">${escapeHtml(qtyLabel)}</td>
                  <td style="text-align:right;white-space:nowrap;">${escapeHtml(formatReceiptInr(it.total))}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
      : '';

  const footerLinesHtml = config.footerLines
    .map((line) => `<div class="footer-line">${escapeHtml(line)}</div>`)
    .join('');

  const upiHtml =
    config.showUpiId && profile.upiId
      ? `<div class="center muted" style="margin-top:6px;">UPI: <strong>${escapeHtml(profile.upiId)}</strong></div>`
      : '';

  const qrHtml =
    config.showUpiQr && upiQrDataUrl
      ? `<div class="center" style="margin-top:6px;"><img src="${escapeHtml(upiQrDataUrl)}" alt="UPI QR" style="width:96px;height:96px;" /></div>`
      : '';

  const balanceHtml =
    config.showCustomerBalance &&
    typeof receipt.customerBalanceAfter === 'number' &&
    receipt.customerName
      ? `<div class="row muted"><span>Khata Balance:</span><span>${escapeHtml(formatReceiptInr(receipt.customerBalanceAfter))}</span></div>`
      : '';

  const loyaltyDiscountHtml =
    receipt.loyaltyDiscountAmount && receipt.loyaltyDiscountAmount > 0
      ? `<div class="row muted"><span>Loyalty Redeem (${receipt.loyaltyPointsRedeemed || 0} pts):</span><span>-${escapeHtml(formatReceiptInr(receipt.loyaltyDiscountAmount))}</span></div>`
      : '';

  const loyaltyEarnedHtml =
    !receipt.isCancelled && receipt.loyaltyPointsEarned && receipt.loyaltyPointsEarned > 0
      ? `<div class="row muted"><span>Loyalty Points Earned:</span><span>+${receipt.loyaltyPointsEarned} pts</span></div>`
      : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${escapeHtml(receipt.invoiceNo)}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 2mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 4mm 2mm;
      width: ${contentWidthMm}mm;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: ${widthMm === 58 ? '10px' : '11px'};
      line-height: 1.35;
      color: #000;
      background: #fff;
    }
    .header { text-align: ${align}; padding-bottom: 6px; border-bottom: 1px dashed #333; }
    .store-name { font-size: ${widthMm === 58 ? '13px' : '15px'}; font-weight: 800; letter-spacing: 0.2px; }
    .muted { font-size: ${widthMm === 58 ? '9px' : '10px'}; color: #222; }
    .void { margin-top: 4px; font-weight: 800; border: 1px solid #000; padding: 2px 4px; display: inline-block; }
    .meta { padding: 6px 0; border-bottom: 1px dashed #333; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .items { width: 100%; border-collapse: collapse; margin: 6px 0; }
    .items th, .items td { padding: 2px 0; vertical-align: top; }
    .items thead tr { border-bottom: 1px dashed #333; }
    .sub { font-size: 9px; color: #333; }
    .totals { border-top: 1px dashed #333; padding-top: 6px; margin-top: 4px; }
    .grand { font-size: ${widthMm === 58 ? '12px' : '14px'}; font-weight: 800; }
    .footer { border-top: 1px dashed #333; margin-top: 8px; padding-top: 6px; text-align: center; }
    .footer-line { font-size: 9.5px; margin-top: 2px; }
    .center { text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    ${logoHtml}
    <div class="store-name">${escapeHtml(title)}</div>
    ${config.showAddress && profile.address ? `<div class="muted">${escapeHtml(profile.address)}</div>` : ''}
    ${config.showPhone && profile.phone ? `<div class="muted">Ph: ${escapeHtml(profile.phone)}</div>` : ''}
    ${config.showGstin && profile.gstin ? `<div class="muted">GSTIN: ${escapeHtml(profile.gstin)}</div>` : ''}
    ${headerLinesHtml}
    ${receipt.isCancelled ? '<div class="void">CANCELLED BILL / VOID</div>' : ''}
  </div>
  <div class="meta">
    <div class="row"><span>Bill: #${escapeHtml(receipt.invoiceNo)}</span><span>${escapeHtml(dateLabel)} ${escapeHtml(timeLabel)}</span></div>
    <div class="row"><span>Mode: ${escapeHtml(receipt.paymentMethod)}</span>${receipt.customerName ? `<span>Cust: ${escapeHtml(receipt.customerName)}</span>` : ''}</div>
  </div>
  ${itemsHtml}
  <div class="totals">
    ${config.showItemDiscount && totalDiscount > 0 ? `<div class="row muted"><span>Item Savings:</span><span>-${escapeHtml(formatReceiptInr(totalDiscount))}</span></div>` : ''}
    ${loyaltyDiscountHtml}
    <div class="row grand"><span>${receipt.isCancelled ? 'CANCELLED:' : 'TOTAL:'}</span><span>${escapeHtml(formatReceiptInr(receipt.totalAmount))}</span></div>
    ${loyaltyEarnedHtml}
    ${balanceHtml}
  </div>
  ${upiHtml}
  ${qrHtml}
  ${footerLinesHtml ? `<div class="footer">${footerLinesHtml}</div>` : ''}
</body>
</html>`;
}

/**
 * Prints thermal receipt HTML via a hidden iframe (iframe-safe; never calls window.open).
 */
export function printThermalReceiptDocument(html: string): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 1000);
  };

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      cleanup();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        cleanup();
      }
    }, 120);
    return true;
  } catch {
    cleanup();
    return false;
  }
}
