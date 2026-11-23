import React from 'react';
import { StoreProfile, Supplier, SupplierTransaction } from '../types';
import { formatINR } from '../utils/accounting';
import { downloadPurchaseReturnCreditNotePDF } from '../utils/pdfGenerator';
import { getPurchaseReturnReasonLabel } from '../utils/purchaseReturns';
import { printThermalReceiptDocument } from '../utils/thermalPrint';
import { CheckCircle2, Download, FileText, Printer, X } from 'lucide-react';

interface CreditNotePreviewModalProps {
  returnTx: SupplierTransaction | null;
  supplier?: Supplier;
  profile: StoreProfile;
  onClose: () => void;
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPrintableCreditNoteHtml(
  returnTx: SupplierTransaction,
  profile: StoreProfile,
  supplier?: Supplier
): string {
  const cnNo = returnTx.creditNoteNo || returnTx.invoiceNo || returnTx.id;
  const dateStr = new Date(returnTx.date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const items = returnTx.returnItems && returnTx.returnItems.length > 0 ? returnTx.returnItems : null;
  const rowsHtml = items
    ? items
        .map(
          (item, i) => `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(item.productName)}</td>
            <td>${escapeHtml(getPurchaseReturnReasonLabel(item.reason || returnTx.returnReason))}</td>
            <td style="text-align:right;">${escapeHtml(`${item.quantity} ${item.unit}`)}</td>
            <td style="text-align:right;">${escapeHtml(formatINR(item.unitPrice))}</td>
            <td style="text-align:right;font-weight:700;">${escapeHtml(formatINR(item.total))}</td>
          </tr>`
        )
        .join('')
    : `<tr>
        <td>1</td>
        <td>${escapeHtml(returnTx.itemsSummary || returnTx.description || 'Returned Goods')}</td>
        <td>${escapeHtml(getPurchaseReturnReasonLabel(returnTx.returnReason))}</td>
        <td style="text-align:right;">${escapeHtml(returnTx.quantity ? `${returnTx.quantity} ${returnTx.unit || 'pcs'}` : '1 Lot')}</td>
        <td style="text-align:right;">${escapeHtml(formatINR(returnTx.unitPrice || returnTx.amount))}</td>
        <td style="text-align:right;font-weight:700;">${escapeHtml(formatINR(returnTx.amount))}</td>
      </tr>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Credit Note ${escapeHtml(cnNo)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 24px; font-size: 12px; }
    .banner { background: #064e3b; color: #fff; padding: 16px 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
    .banner h1 { margin: 0; font-size: 18px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; padding: 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; }
    th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; color: #475569; }
    .total-box { margin-top: 18px; margin-left: auto; width: 260px; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 12px 16px; border-radius: 8px; text-align: right; }
    .sigs { display: flex; justify-content: space-between; margin-top: 48px; font-weight: 600; }
    .sig-line { border-top: 1px solid #64748b; width: 200px; padding-top: 6px; text-align: center; }
  </style>
</head>
<body>
  <div class="banner">
    <div>
      <h1>${escapeHtml(profile.storeName || 'Arjun Groceries')}</h1>
      <div style="font-size:11px;opacity:0.9;">${escapeHtml(profile.address || '')} ${profile.phone ? `| Ph: ${escapeHtml(profile.phone)}` : ''}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:800;font-size:14px;">PURCHASE RETURN CREDIT NOTE</div>
      <div style="font-size:12px;">${escapeHtml(cnNo)}</div>
    </div>
  </div>
  <div class="meta">
    <div>
      <div><strong>Credit Note #:</strong> ${escapeHtml(cnNo)}</div>
      <div><strong>Return Date:</strong> ${escapeHtml(dateStr)}</div>
      <div><strong>Original Bill #:</strong> ${escapeHtml(returnTx.originalInvoiceNo || 'General Stock Return')}</div>
      <div><strong>Reason:</strong> ${escapeHtml(getPurchaseReturnReasonLabel(returnTx.returnReason))}</div>
    </div>
    <div>
      <div><strong>Issued To Supplier:</strong> ${escapeHtml(supplier?.name || 'Wholesale Supplier')}</div>
      <div><strong>Phone:</strong> ${escapeHtml(supplier?.phone || 'N/A')}</div>
      ${supplier?.gstin ? `<div><strong>GSTIN:</strong> ${escapeHtml(supplier.gstin)}</div>` : ''}
      <div><strong>Settlement:</strong> ${escapeHtml(
        returnTx.settlementMode === 'CASH_REFUND'
          ? 'Cash Refund Received'
          : returnTx.settlementMode === 'BANK_REFUND'
          ? 'Bank / UPI Refund'
          : 'Adjusted Against Supplier Payable'
      )}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Returned Item</th>
        <th>Reason</th>
        <th style="text-align:right;">Qty</th>
        <th style="text-align:right;">Unit Rate</th>
        <th style="text-align:right;">Credit Amt</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="total-box">
    <div style="font-size:11px;font-weight:700;color:#065f46;">TOTAL CREDIT NOTE VALUE</div>
    <div style="font-size:20px;font-weight:800;color:#064e3b;">${escapeHtml(formatINR(returnTx.amount))}</div>
  </div>
  <div class="sigs">
    <div class="sig-line">Authorized Store Signature</div>
    <div class="sig-line">Supplier Representative</div>
  </div>
</body>
</html>`;
}

export const CreditNotePreviewModal: React.FC<CreditNotePreviewModalProps> = ({
  returnTx,
  supplier,
  profile,
  onClose,
}) => {
  if (!returnTx) return null;

  const cnNo = returnTx.creditNoteNo || returnTx.invoiceNo || `CN-${returnTx.id.slice(-6)}`;
  const isCancelled = returnTx.status === 'CANCELLED' || returnTx.status === 'REVERSED';
  const items = returnTx.returnItems && returnTx.returnItems.length > 0 ? returnTx.returnItems : null;

  const settlementText =
    returnTx.settlementMode === 'CASH_REFUND'
      ? 'Cash Refund Received'
      : returnTx.settlementMode === 'BANK_REFUND'
      ? 'Bank / UPI Refund'
      : 'Adjusted Against Supplier Payable';

  const handlePrint = () => {
    const html = buildPrintableCreditNoteHtml(returnTx, profile, supplier);
    printThermalReceiptDocument(html);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Credit Note ${cnNo}`}
    >
      <div
        data-testid="credit-note-preview-modal"
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full my-auto border border-slate-200 dark:border-slate-800 overflow-hidden"
      >
        {/* Top Bar */}
        <div className="px-5 py-3.5 bg-emerald-950 text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-300" />
            <div>
              <h3 className="font-bold text-sm sm:text-base">
                Purchase Return Credit Note · {cnNo}
              </h3>
              <p className="text-[11px] text-emerald-300/80">
                Formal supplier return voucher &amp; inventory deduction certificate
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close credit note preview"
            className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Document Body */}
        <div className="p-5 space-y-4 max-h-[74vh] overflow-y-auto">
          {isCancelled && (
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-bold text-red-700 dark:text-red-300 text-center">
              THIS CREDIT NOTE HAS BEEN CANCELLED / REVERSED
            </div>
          )}

          {/* Store & Supplier Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs">
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Issued By (Store)
              </div>
              <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                {profile.storeName || 'Arjun Groceries'}
              </div>
              {profile.address && (
                <div className="text-slate-600 dark:text-slate-400">{profile.address}</div>
              )}
              {profile.phone && (
                <div className="text-slate-600 dark:text-slate-400">Phone: {profile.phone}</div>
              )}
              {profile.gstin && (
                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  GSTIN: {profile.gstin}
                </div>
              )}
            </div>

            <div className="space-y-1 sm:border-l sm:border-slate-200 dark:sm:border-slate-700 sm:pl-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Issued To (Supplier / Wholesaler)
              </div>
              <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                {supplier?.name || 'Wholesale Supplier'}
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                Phone: {supplier?.phone || 'N/A'}
              </div>
              {supplier?.gstin && (
                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  GSTIN: {supplier.gstin}
                </div>
              )}
              <div className="text-emerald-800 dark:text-emerald-300 font-semibold pt-0.5">
                {settlementText}
              </div>
            </div>
          </div>

          {/* Metadata Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                Credit Note #
              </div>
              <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {cnNo}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                Return Date
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {new Date(returnTx.date).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                Original Bill #
              </div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {returnTx.originalInvoiceNo || 'General'}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
              <div className="text-[10px] font-bold uppercase text-amber-800 dark:text-amber-300">
                Reason
              </div>
              <div className="font-bold text-amber-900 dark:text-amber-200 mt-0.5">
                {getPurchaseReturnReasonLabel(returnTx.returnReason)}
              </div>
            </div>
          </div>

          {/* Itemized Returned Goods Table */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase text-[10px] font-bold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Returned Item</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Unit Rate</th>
                  <th className="py-2.5 px-3 text-right">Credit Amt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items ? (
                  items.map((item, idx) => (
                    <tr key={`${item.productId || item.productName}-${idx}`}>
                      <td className="py-2.5 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                        {item.productName}
                      </td>
                      <td className="py-2.5 px-3 text-amber-700 dark:text-amber-300 font-medium">
                        {getPurchaseReturnReasonLabel(item.reason || returnTx.returnReason)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {formatINR(item.unitPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatINR(item.total)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-2.5 px-3 text-slate-500">1</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                      {returnTx.itemsSummary || returnTx.description || 'Returned Goods'}
                    </td>
                    <td className="py-2.5 px-3 text-amber-700 dark:text-amber-300 font-medium">
                      {getPurchaseReturnReasonLabel(returnTx.returnReason)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {returnTx.quantity ? `${returnTx.quantity} ${returnTx.unit || 'pcs'}` : '1 Lot'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatINR(returnTx.unitPrice || returnTx.amount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold tabular-nums">
                      {formatINR(returnTx.amount)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Credit Value & Confirmation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-start gap-2 text-xs text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Automated Stock &amp; Ledger Adjustment Confirmed</div>
                <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                  Returned items deducted from inventory &amp; credit applied to supplier account.
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-300">
                Total Credit Note Value
              </div>
              <div className="text-xl font-black text-emerald-900 dark:text-emerald-200 tabular-nums">
                {formatINR(returnTx.amount)}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print Credit Note</span>
            </button>
            <button
              type="button"
              onClick={() => downloadPurchaseReturnCreditNotePDF(returnTx, profile, supplier)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
