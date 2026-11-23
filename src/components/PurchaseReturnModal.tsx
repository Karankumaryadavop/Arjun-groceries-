import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import {
  PurchaseReturnReason,
  SupplierTransaction,
} from '../types';
import { formatINR, getLocalTodayKey } from '../utils/accounting';
import {
  generateCreditNoteNumber,
  normalizePurchaseReturnItems,
  PURCHASE_RETURN_REASONS,
  PurchaseReturnLineInput,
  validatePurchaseReturnStockAvailability,
} from '../utils/purchaseReturns';
import { getAllowedSellingUnits } from '../utils/units';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  AlertTriangle,
  FileText,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';

export interface PurchaseReturnPrefill {
  supplierId?: string;
  originalPurchaseId?: string;
  originalInvoiceNo?: string;
  productId?: string;
  productName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
}

interface PurchaseReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefill?: PurchaseReturnPrefill | null;
  onSuccess?: (result: {
    transactionId: string;
    creditNoteNo: string;
    totalAmount: number;
    supplierName: string;
  }) => void;
}

interface DraftReturnRow {
  rowId: string;
  productId: string;
  productName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  reason: PurchaseReturnReason;
}

function createEmptyRow(defaultReason: PurchaseReturnReason = 'DAMAGED'): DraftReturnRow {
  return {
    rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    productId: '',
    productName: '',
    quantity: '1',
    unit: 'pcs',
    unitPrice: '',
    reason: defaultReason,
  };
}

export const PurchaseReturnModal: React.FC<PurchaseReturnModalProps> = ({
  isOpen,
  onClose,
  prefill,
  onSuccess,
}) => {
  const {
    suppliers,
    supplierTransactions,
    products,
    profile,
    recordPurchaseReturn,
  } = useStore();

  useTrackActiveTransaction('purchase-return-modal', isOpen);

  const activeProducts = useMemo(
    () => products.filter((p) => !p.isArchived),
    [products]
  );

  const [supplierId, setSupplierId] = useState('');
  const [originalPurchaseId, setOriginalPurchaseId] = useState('');
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState('');
  const [creditNoteNo, setCreditNoteNo] = useState('');
  const [returnDate, setReturnDate] = useState(() => getLocalTodayKey());
  const [reason, setReason] = useState<PurchaseReturnReason>('DAMAGED');
  const [settlementMode, setSettlementMode] = useState<
    'ADJUST_PAYABLE' | 'CASH_REFUND' | 'BANK_REFUND'
  >('ADJUST_PAYABLE');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<DraftReturnRow[]>(() => [createEmptyRow('DAMAGED')]);
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => `pret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    if (!isOpen) return;
    const today = getLocalTodayKey();
    setReturnDate(today);
    setCreditNoteNo(generateCreditNoteNumber(supplierTransactions, today));
    setReason('DAMAGED');
    setSettlementMode('ADJUST_PAYABLE');
    setNotes('');
    setFormError(null);
    setIdempotencyKey(`pret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    if (prefill) {
      setSupplierId(prefill.supplierId || '');
      setOriginalPurchaseId(prefill.originalPurchaseId || '');
      setOriginalInvoiceNo(prefill.originalInvoiceNo || '');
      if (prefill.productId) {
        const prod = activeProducts.find((p) => p.id === prefill.productId);
        const rate =
          prefill.unitPrice && prefill.unitPrice > 0
            ? prefill.unitPrice
            : prod?.lastPurchasePrice || prod?.purchasePrice || 0;
        setRows([
          {
            rowId: `row-${Date.now()}`,
            productId: prefill.productId,
            productName: prod?.name || prefill.productName || '',
            quantity: String(prefill.quantity && prefill.quantity > 0 ? Math.min(prefill.quantity, Math.max(1, prod?.stockQty || prefill.quantity)) : 1),
            unit: prefill.unit || prod?.unit || 'pcs',
            unitPrice: rate > 0 ? String(rate) : '',
            reason: 'DAMAGED',
          },
        ]);
      } else {
        setRows([createEmptyRow('DAMAGED')]);
      }
    } else {
      setSupplierId(suppliers[0]?.id || '');
      setOriginalPurchaseId('');
      setOriginalInvoiceNo('');
      setRows([createEmptyRow('DAMAGED')]);
    }
  }, [isOpen, prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const supplierPurchases: SupplierTransaction[] = useMemo(() => {
    if (!supplierId) return [];
    return supplierTransactions
      .filter(
        (tx) =>
          tx.supplierId === supplierId &&
          tx.type === 'PURCHASE' &&
          tx.status !== 'CANCELLED' &&
          tx.status !== 'REVERSED'
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [supplierTransactions, supplierId]);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) || null,
    [suppliers, supplierId]
  );

  const lineInputs: PurchaseReturnLineInput[] = useMemo(
    () =>
      rows.map((r) => ({
        productId: r.productId || undefined,
        productName: r.productName,
        quantity: Number(r.quantity) || 0,
        unit: r.unit,
        unitPrice: Number(r.unitPrice) || 0,
        reason: r.reason || reason,
      })),
    [rows, reason]
  );

  const liveTotalCredit = useMemo(() => {
    return rows.reduce((sum, r) => {
      const q = Number(r.quantity);
      const p = Number(r.unitPrice);
      if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return sum;
      return Math.round((sum + q * p) * 100) / 100;
    }, 0);
  }, [rows]);

  if (!isOpen) return null;

  const handleLinkPurchase = (purchaseId: string) => {
    setOriginalPurchaseId(purchaseId);
    setFormError(null);
    if (!purchaseId) return;
    const found = supplierPurchases.find((p) => p.id === purchaseId);
    if (!found) return;
    if (found.invoiceNo) {
      setOriginalInvoiceNo(found.invoiceNo);
    }
    if (found.productId) {
      const prod = activeProducts.find((p) => p.id === found.productId);
      const rate =
        found.unitPrice && found.unitPrice > 0
          ? found.unitPrice
          : prod?.lastPurchasePrice || prod?.purchasePrice || 0;
      setRows([
        {
          rowId: `row-${Date.now()}`,
          productId: found.productId,
          productName: prod?.name || found.description || '',
          quantity: '1',
          unit: found.unit || prod?.unit || 'pcs',
          unitPrice: rate > 0 ? String(rate) : '',
          reason,
        },
      ]);
    }
  };

  const handleRowProductChange = (rowId: string, productId: string) => {
    const prod = activeProducts.find((p) => p.id === productId);
    setRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        if (!prod) {
          return { ...row, productId: '', productName: '', unit: 'pcs' };
        }
        const suggestedPrice =
          prod.lastPurchasePrice !== undefined && prod.lastPurchasePrice > 0
            ? prod.lastPurchasePrice
            : prod.purchasePrice;
        return {
          ...row,
          productId: prod.id,
          productName: prod.name,
          unit: prod.unit,
          unitPrice: suggestedPrice > 0 ? String(suggestedPrice) : row.unitPrice,
        };
      })
    );
    setFormError(null);
  };

  const updateRowField = <K extends keyof DraftReturnRow>(
    rowId: string,
    key: K,
    value: DraftReturnRow[K]
  ) => {
    setRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, [key]: value } : row))
    );
    setFormError(null);
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, createEmptyRow(reason)]);
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.rowId !== rowId) : prev));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!supplierId) {
      setFormError('Please select a wholesaler / supplier.');
      return;
    }

    const norm = normalizePurchaseReturnItems(lineInputs, products, reason);
    if (!norm.valid) {
      setFormError(norm.error || 'Please check the returned item quantities and unit rates.');
      return;
    }

    const stockCheck = validatePurchaseReturnStockAvailability({
      items: norm.items,
      products,
      allowNegativeStock: Boolean(profile.allowNegativeStock),
    });
    if (!stockCheck.valid) {
      setFormError(stockCheck.error || 'Insufficient inventory stock to return.');
      return;
    }

    const res = recordPurchaseReturn({
      supplierId,
      items: lineInputs,
      reason,
      creditNoteNo: creditNoteNo.trim() || undefined,
      originalInvoiceNo: originalInvoiceNo.trim() || undefined,
      originalPurchaseId: originalPurchaseId || undefined,
      settlementMode,
      notes: notes.trim() || undefined,
      date: returnDate,
      idempotencyKey,
    });

    if (!res.success || !res.transactionId) {
      setFormError(res.error || 'Could not record purchase return.');
      return;
    }

    if (onSuccess) {
      onSuccess({
        transactionId: res.transactionId,
        creditNoteNo: res.creditNoteNo || creditNoteNo,
        totalAmount: norm.totalAmount,
        supplierName: selectedSupplier?.name || 'Supplier',
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Record Purchase Return & Issue Credit Note"
    >
      <div
        data-testid="purchase-return-modal"
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full my-auto border border-slate-200 dark:border-slate-800 overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-emerald-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-800 rounded-lg text-emerald-200">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Record Purchase Return &amp; Credit Note</h3>
              <p className="text-xs text-emerald-300/80">
                Automatically deducts damaged/returned stock &amp; adjusts supplier payable
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close purchase return modal"
            className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {formError && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Supplier & Original Purchase Link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Wholesale Supplier *
              </label>
              <select
                required
                aria-label="Wholesale Supplier"
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  setOriginalPurchaseId('');
                  setFormError(null);
                }}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="">-- Select Wholesaler --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Payable: {formatINR(s.currentBalance)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Link Original Purchase Bill (Optional)
              </label>
              <select
                aria-label="Link Original Purchase Bill"
                value={originalPurchaseId}
                onChange={(e) => handleLinkPurchase(e.target.value)}
                disabled={!supplierId || supplierPurchases.length === 0}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
              >
                <option value="">
                  {supplierPurchases.length === 0
                    ? '-- No prior bills for supplier --'
                    : '-- Select purchase bill to auto-fill --'}
                </option>
                {supplierPurchases.slice(0, 30).map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    {tx.invoiceNo || 'INV'} · {new Date(tx.date).toLocaleDateString('en-IN')} ·{' '}
                    {formatINR(tx.amount)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Credit Note #, Original Invoice #, Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Credit Note # *
              </label>
              <input
                type="text"
                required
                aria-label="Credit Note Number"
                value={creditNoteNo}
                onChange={(e) => setCreditNoteNo(e.target.value)}
                placeholder="CN-2026-0001"
                className="w-full text-sm font-mono font-bold border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Original Bill / Inv #
              </label>
              <input
                type="text"
                aria-label="Original Bill Number"
                value={originalInvoiceNo}
                onChange={(e) => setOriginalInvoiceNo(e.target.value)}
                placeholder="e.g. INV-9001"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Return Date *
              </label>
              <input
                type="date"
                required
                aria-label="Return Date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Primary Return Reason & Settlement Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Primary Return Reason *
              </label>
              <select
                aria-label="Primary Return Reason"
                value={reason}
                onChange={(e) => {
                  const next = e.target.value as PurchaseReturnReason;
                  setReason(next);
                  setRows((prev) => prev.map((r) => ({ ...r, reason: next })));
                }}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {PURCHASE_RETURN_REASONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Credit Settlement Mode
              </label>
              <select
                aria-label="Credit Settlement Mode"
                value={settlementMode}
                onChange={(e) =>
                  setSettlementMode(
                    e.target.value as 'ADJUST_PAYABLE' | 'CASH_REFUND' | 'BANK_REFUND'
                  )
                }
                className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="ADJUST_PAYABLE">Adjust Against Supplier Payable (Credit Note)</option>
                <option value="CASH_REFUND">Cash Refund Received (+Cashbook IN)</option>
                <option value="BANK_REFUND">Bank / UPI Refund Received</option>
              </select>
            </div>
          </div>

          {/* Returned Items Table */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                Returned Goods &amp; Automated Stock Deduction
              </label>
              <button
                type="button"
                onClick={handleAddRow}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {rows.map((row, idx) => {
                const prod = activeProducts.find((p) => p.id === row.productId);
                const allowedUnits = prod ? getAllowedSellingUnits(prod.unit) : [];
                const lineVal =
                  Math.round(
                    Math.max(0, Number(row.quantity) || 0) *
                      Math.max(0, Number(row.unitPrice) || 0) *
                      100
                  ) / 100;

                return (
                  <div
                    key={row.rowId}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
                        Item #{idx + 1}
                        {prod ? ` · Current Stock: ${prod.stockQty} ${prod.unit}` : ''}
                      </span>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.rowId)}
                          aria-label={`Remove return item ${idx + 1}`}
                          className="text-slate-400 hover:text-red-600 p-1 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-5">
                        <select
                          required
                          aria-label={`Select return product ${idx + 1}`}
                          value={row.productId}
                          onChange={(e) => handleRowProductChange(row.rowId, e.target.value)}
                          className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        >
                          <option value="">-- Choose Inventory Product --</option>
                          {activeProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.stockQty} {p.unit} in stock)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          required
                          aria-label={`Return quantity ${idx + 1}`}
                          placeholder="Qty"
                          value={row.quantity}
                          onChange={(e) => updateRowField(row.rowId, 'quantity', e.target.value)}
                          className="w-full text-xs sm:text-sm font-bold border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <select
                          aria-label={`Return unit ${idx + 1}`}
                          value={row.unit}
                          onChange={(e) => updateRowField(row.rowId, 'unit', e.target.value)}
                          disabled={!prod}
                          className="w-full text-xs sm:text-sm font-semibold border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        >
                          {allowedUnits.length > 0 ? (
                            allowedUnits.map((u) => (
                              <option key={u.unit} value={u.unit}>
                                {u.shortLabel}
                              </option>
                            ))
                          ) : (
                            <option value={row.unit}>{row.unit}</option>
                          )}
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <div className="relative">
                          <span className="absolute left-2.5 top-2 text-xs text-slate-400 font-bold">
                            ₹
                          </span>
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            required
                            aria-label={`Return unit rate ${idx + 1}`}
                            placeholder="Rate"
                            value={row.unitPrice}
                            onChange={(e) => updateRowField(row.rowId, 'unitPrice', e.target.value)}
                            className="w-full text-xs sm:text-sm font-bold pl-6 pr-2 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>
                        {prod
                          ? `Stock will reduce by ${Number(row.quantity) || 0} ${row.unit}`
                          : 'Select an inventory item for automatic stock deduction'}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        Line Credit: {formatINR(lineVal)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Return Remarks / Condition Notes
            </label>
            <input
              type="text"
              aria-label="Return Remarks"
              placeholder="e.g. 5 torn bags handed back to delivery van driver"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Live Credit Note Summary */}
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5 text-xs">
              <div className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                <span>Credit Note Total ({creditNoteNo || 'Auto'})</span>
              </div>
              <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                {selectedSupplier
                  ? settlementMode === 'ADJUST_PAYABLE'
                    ? `${selectedSupplier.name} payable reduces from ${formatINR(
                        selectedSupplier.currentBalance
                      )} to ${formatINR(
                        Math.round((selectedSupplier.currentBalance - liveTotalCredit) * 100) / 100
                      )}`
                    : `${selectedSupplier.name} refund recorded (${settlementMode === 'CASH_REFUND' ? '+Cashbook IN' : 'Bank/UPI'})`
                  : 'Select a supplier to preview ledger balance update'}
              </div>
            </div>
            <div className="text-xl font-black text-emerald-900 dark:text-emerald-300 tabular-nums">
              {formatINR(liveTotalCredit)}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-bold shadow-sm cursor-pointer flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" />
              <span>Confirm Return &amp; Generate Credit Note</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
