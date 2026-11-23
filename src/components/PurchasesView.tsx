/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { formatINR, getLocalTodayKey } from '../utils/accounting';
import { downloadPurchaseInvoicePDF } from '../utils/pdfGenerator';
import { convertToBaseUnit, formatQuantityWithUnit, getAllowedSellingUnits } from '../utils/units';
import { BillAttachment, PurchaseReturnReason, SupplierTransaction } from '../types';
import { FileAttachment } from './FileAttachment';
import { BillViewerModal } from './BillViewerModal';
import { PurchaseReturnModal, PurchaseReturnPrefill } from './PurchaseReturnModal';
import { CreditNotePreviewModal } from './CreditNotePreviewModal';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  buildPurchaseReturnSummary,
  getPurchaseReturnReasonLabel,
  PURCHASE_RETURN_REASONS,
} from '../utils/purchaseReturns';
import {
  Plus,
  X,
  Paperclip,
  Eye,
  Download,
  PackagePlus,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  FileText,
  Search,
} from 'lucide-react';

export const PurchasesView: React.FC = () => {
  const {
    suppliers,
    supplierTransactions,
    addSupplierTransaction,
    recordProductPurchase,
    products,
    purchasePrefill,
    setPurchasePrefill,
    openSupplierProfile,
    profile,
  } = useStore();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<'GENERAL' | 'PRODUCT'>('GENERAL');

  // Shared fields
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => getLocalTodayKey());
  const [description, setDescription] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'PARTIAL' | 'UNPAID'>('UNPAID');
  const [partialPaidAmount, setPartialPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK'>('BANK');
  const [purchaseAttachments, setPurchaseAttachments] = useState<BillAttachment[]>([]);

  // General Wholesaler Bill fields
  const [amount, setAmount] = useState('');
  const [isReturn, setIsReturn] = useState(false);

  // Product Restock Purchase fields
  const [selectedProductId, setSelectedProductId] = useState('');
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState('');
  const [unitPurchasePrice, setUnitPurchasePrice] = useState('');
  const [returnProductId, setReturnProductId] = useState('');
  const [returnQty, setReturnQty] = useState('');
  const [returnUnit, setReturnUnit] = useState('');
  const [purchaseIdempotencyKey, setPurchaseIdempotencyKey] = useState(
    () => `pur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const [setAsPreferredSupplier, setSetAsPreferredSupplier] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  useTrackActiveTransaction('purchases-modal', isAddModalOpen || pendingConfirmation);
  const [purchaseFormError, setPurchaseFormError] = useState<string | null>(null);
  const [purchaseSuccessBanner, setPurchaseSuccessBanner] = useState<string | null>(null);

  const [viewingAttachment, setViewingAttachment] = useState<{
    attachment: BillAttachment;
    title: string;
    details?: string;
  } | null>(null);

  // Purchase Return & Credit Note Management state
  const [activeSubTab, setActiveSubTab] = useState<'PURCHASES' | 'RETURNS'>('PURCHASES');
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnPrefill, setReturnPrefill] = useState<PurchaseReturnPrefill | null>(null);
  const [previewCreditNoteId, setPreviewCreditNoteId] = useState<string | null>(null);
  const [recentCreditNoteId, setRecentCreditNoteId] = useState<string | null>(null);
  const [returnSearchQuery, setReturnSearchQuery] = useState('');
  const [returnReasonFilter, setReturnReasonFilter] = useState<'ALL' | PurchaseReturnReason>('ALL');

  const activeProducts = useMemo(
    () => products.filter((p) => !p.isArchived),
    [products]
  );

  // Respond cleanly when triggered from Low Stock / Purchase Planning "Add Purchase"
  useEffect(() => {
    if (!purchasePrefill) return;
    const prefillProd = activeProducts.find((p) => p.id === purchasePrefill.productId);
    setPurchaseMode('PRODUCT');
    setSelectedProductId(purchasePrefill.productId);
    setPurchaseUnit(prefillProd?.unit || '');
    setSelectedSupplierId(purchasePrefill.supplierId || '');
    setPurchaseQty(String(purchasePrefill.suggestedQty || 1));
    setUnitPurchasePrice(
      purchasePrefill.unitPurchasePrice > 0 ? String(purchasePrefill.unitPurchasePrice) : ''
    );
    setDescription(purchasePrefill.notes || '');
    setInvoiceNo('');
    setPurchaseDate(getLocalTodayKey());
    setPaymentStatus('UNPAID');
    setPartialPaidAmount('');
    setPaymentMethod('BANK');
    setSetAsPreferredSupplier(!purchasePrefill.supplierId);
    setPendingConfirmation(false);
    setPurchaseFormError(null);
    setPurchaseAttachments([]);
    setPurchaseIdempotencyKey(`pur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsAddModalOpen(true);
    setPurchasePrefill(null);
  }, [purchasePrefill, setPurchasePrefill, activeProducts]);

  const selectedProduct = useMemo(
    () => activeProducts.find((p) => p.id === selectedProductId) || null,
    [activeProducts, selectedProductId]
  );

  const selectedReturnProduct = useMemo(
    () => activeProducts.find((p) => p.id === returnProductId) || null,
    [activeProducts, returnProductId]
  );

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );

  const allowedPurchaseUnits = useMemo(
    () => (selectedProduct ? getAllowedSellingUnits(selectedProduct.unit) : []),
    [selectedProduct]
  );

  const allowedReturnUnits = useMemo(
    () => (selectedReturnProduct ? getAllowedSellingUnits(selectedReturnProduct.unit) : []),
    [selectedReturnProduct]
  );

  const effectivePurchaseUnit = purchaseUnit || selectedProduct?.unit || 'units';

  const computedBaseRestockQty = useMemo(() => {
    const q = Number(purchaseQty);
    if (!selectedProduct || !Number.isFinite(q) || q <= 0) return 0;
    return convertToBaseUnit(q, effectivePurchaseUnit, selectedProduct.unit);
  }, [purchaseQty, effectivePurchaseUnit, selectedProduct]);

  const computedProductTotal = useMemo(() => {
    const q = Number(purchaseQty);
    const p = Number(unitPurchasePrice);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) return 0;
    return Math.round(q * p * 100) / 100;
  }, [purchaseQty, unitPurchasePrice]);

  const purchaseRecords = supplierTransactions.filter(
    (st) => st.type === 'PURCHASE' || st.type === 'RETURN'
  );

  const inwardPurchaseRecords = useMemo(
    () =>
      supplierTransactions
        .filter((st) => st.type === 'PURCHASE')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [supplierTransactions]
  );

  const returnSummary = useMemo(
    () => buildPurchaseReturnSummary(supplierTransactions, suppliers),
    [supplierTransactions, suppliers]
  );

  const filteredReturns = useMemo(() => {
    const q = returnSearchQuery.trim().toLowerCase();
    return returnSummary.returns.filter((tx) => {
      if (returnReasonFilter !== 'ALL' && tx.returnReason !== returnReasonFilter) {
        return false;
      }
      if (!q) return true;
      const supName = suppliers.find((s) => s.id === tx.supplierId)?.name || '';
      return (
        supName.toLowerCase().includes(q) ||
        (tx.creditNoteNo || '').toLowerCase().includes(q) ||
        (tx.invoiceNo || '').toLowerCase().includes(q) ||
        (tx.originalInvoiceNo || '').toLowerCase().includes(q) ||
        (tx.itemsSummary || '').toLowerCase().includes(q) ||
        (tx.description || '').toLowerCase().includes(q)
      );
    });
  }, [returnSummary.returns, returnSearchQuery, returnReasonFilter, suppliers]);

  const previewCreditNoteTx: SupplierTransaction | null = useMemo(
    () =>
      previewCreditNoteId
        ? supplierTransactions.find((tx) => tx.id === previewCreditNoteId) || null
        : null,
    [previewCreditNoteId, supplierTransactions]
  );

  const previewCreditNoteSupplier = useMemo(
    () =>
      previewCreditNoteTx
        ? suppliers.find((s) => s.id === previewCreditNoteTx.supplierId)
        : undefined,
    [previewCreditNoteTx, suppliers]
  );

  const totalPurchases = purchaseRecords
    .filter((st) => st.type === 'PURCHASE' && st.status !== 'CANCELLED' && st.status !== 'REVERSED')
    .reduce((sum, st) => sum + st.amount, 0);

  const openPurchaseReturnModal = (prefill?: PurchaseReturnPrefill) => {
    setReturnPrefill(prefill || null);
    setIsReturnModalOpen(true);
  };

  const resetModalState = () => {
    setAmount('');
    setInvoiceNo('');
    setDescription('');
    setPurchaseQty('');
    setPurchaseUnit('');
    setUnitPurchasePrice('');
    setSelectedProductId('');
    setSelectedSupplierId('');
    setPartialPaidAmount('');
    setReturnProductId('');
    setReturnQty('');
    setReturnUnit('');
    setPurchaseAttachments([]);
    setIsReturn(false);
    setPendingConfirmation(false);
    setPurchaseFormError(null);
    setPurchaseIdempotencyKey(`pur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsAddModalOpen(false);
  };

  const openModalInMode = (mode: 'GENERAL' | 'PRODUCT') => {
    setPurchaseMode(mode);
    setPendingConfirmation(false);
    setPurchaseFormError(null);
    setInvoiceNo('');
    setDescription('');
    setPurchaseDate(getLocalTodayKey());
    setPaymentStatus('UNPAID');
    setPartialPaidAmount('');
    setPaymentMethod('BANK');
    setPurchaseAttachments([]);
    setReturnProductId('');
    setReturnQty('');
    setReturnUnit('');
    setPurchaseIdempotencyKey(`pur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    if (mode === 'PRODUCT' && activeProducts.length > 0 && !selectedProductId) {
      const first = activeProducts[0];
      setSelectedProductId(first.id);
      setPurchaseUnit(first.unit);
      setSelectedSupplierId(first.preferredSupplierId || '');
      const fallbackPrice =
        first.lastPurchasePrice !== undefined ? first.lastPurchasePrice : first.purchasePrice;
      setUnitPurchasePrice(fallbackPrice > 0 ? String(fallbackPrice) : '');
      setPurchaseQty('10');
      setSetAsPreferredSupplier(!first.preferredSupplierId);
    }
    setIsAddModalOpen(true);
  };

  const handleSelectProductInModal = (prodId: string) => {
    setSelectedProductId(prodId);
    setPendingConfirmation(false);
    setPurchaseFormError(null);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (prod) {
      setPurchaseUnit(prod.unit);
      if (prod.preferredSupplierId) {
        setSelectedSupplierId(prod.preferredSupplierId);
        setSetAsPreferredSupplier(false);
      } else {
        setSetAsPreferredSupplier(true);
      }
      const price =
        prod.lastPurchasePrice !== undefined ? prod.lastPurchasePrice : prod.purchasePrice;
      setUnitPurchasePrice(price > 0 ? String(price) : '');
    } else {
      setPurchaseUnit('');
    }
  };

  const handleRecordPurchase = (e: React.FormEvent) => {
    e.preventDefault();
    setPurchaseFormError(null);

    if (purchaseMode === 'PRODUCT') {
      if (!selectedProductId) {
        setPurchaseFormError('Please select a product to restock.');
        return;
      }
      if (!selectedSupplierId) {
        setPurchaseFormError('Please select a wholesaler / supplier.');
        return;
      }
      const qty = Number(purchaseQty);
      const unitPrice = Number(unitPurchasePrice);
      if (!Number.isFinite(qty) || qty <= 0) {
        setPurchaseFormError('Please enter a valid purchase quantity greater than 0.');
        return;
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        setPurchaseFormError('Please enter a valid unit purchase price greater than 0.');
        return;
      }

      const parsedPartial =
        paymentStatus === 'PARTIAL' ? Number(partialPaidAmount) : undefined;
      if (paymentStatus === 'PARTIAL') {
        if (
          partialPaidAmount.trim() === '' ||
          !Number.isFinite(parsedPartial) ||
          (parsedPartial as number) < 0 ||
          (parsedPartial as number) > computedProductTotal
        ) {
          setPurchaseFormError(
            `Please enter partial amount paid now between ₹0 and ${formatINR(computedProductTotal)}.`
          );
          setPendingConfirmation(false);
          return;
        }
      }

      if (!pendingConfirmation) {
        setPendingConfirmation(true);
        return;
      }

      const res = recordProductPurchase({
        supplierId: selectedSupplierId,
        productId: selectedProductId,
        quantity: qty,
        unit: effectivePurchaseUnit,
        unitPurchasePrice: unitPrice,
        paymentStatus,
        paidAmount: parsedPartial,
        paymentMethod,
        invoiceNo: invoiceNo.trim() || undefined,
        notes: description.trim() || undefined,
        attachments: purchaseAttachments.length > 0 ? purchaseAttachments : undefined,
        date: purchaseDate,
        setAsPreferredSupplier,
        idempotencyKey: purchaseIdempotencyKey,
      });

      if (!res.success) {
        setPurchaseFormError(res.error || 'Could not record purchase.');
        setPendingConfirmation(false);
        return;
      }

      const supName = selectedSupplier?.name || 'Supplier';
      const prodName = selectedProduct?.name || 'Product';
      const baseAddedText =
        selectedProduct && effectivePurchaseUnit !== selectedProduct.unit
          ? `${qty} ${effectivePurchaseUnit} (+${formatQuantityWithUnit(computedBaseRestockQty, selectedProduct.unit)})`
          : `${qty} ${effectivePurchaseUnit}`;
      setPurchaseSuccessBanner(
        `Purchase Confirmed: Added +${baseAddedText} to ${prodName} from ${supName} (${formatINR(computedProductTotal)}).`
      );
      resetModalState();
      return;
    }

    // GENERAL Wholesaler Bill Mode
    const billAmt = Number(amount);
    if (!selectedSupplierId || !Number.isFinite(billAmt) || billAmt <= 0) {
      setPurchaseFormError('Please select a supplier and enter a valid bill amount.');
      return;
    }

    const parsedGeneralPartial =
      !isReturn && paymentStatus === 'PARTIAL' ? Number(partialPaidAmount) : undefined;
    if (!isReturn && paymentStatus === 'PARTIAL') {
      if (
        partialPaidAmount.trim() === '' ||
        !Number.isFinite(parsedGeneralPartial) ||
        (parsedGeneralPartial as number) < 0 ||
        (parsedGeneralPartial as number) > billAmt
      ) {
        setPurchaseFormError(
          `Please enter partial amount paid now between ₹0 and ${formatINR(billAmt)}.`
        );
        return;
      }
    }

    if (isReturn && returnProductId && (!Number.isFinite(Number(returnQty)) || Number(returnQty) <= 0)) {
      setPurchaseFormError('Please enter a valid return quantity greater than 0 for the selected product.');
      return;
    }

    const txRes = addSupplierTransaction({
      supplierId: selectedSupplierId,
      type: isReturn ? 'RETURN' : 'PURCHASE',
      amount: billAmt,
      paidAmount: parsedGeneralPartial,
      date: purchaseDate,
      invoiceNo: invoiceNo.trim() || undefined,
      description: description.trim() || (isReturn ? 'Damaged goods return' : 'Stock purchase invoice'),
      paymentStatus: isReturn ? 'PAID' : paymentStatus,
      paymentMethod,
      productId: isReturn && returnProductId ? returnProductId : undefined,
      quantity: isReturn && returnProductId ? Number(returnQty) : undefined,
      unit: isReturn && returnProductId ? returnUnit || selectedReturnProduct?.unit : undefined,
      attachments: purchaseAttachments.length > 0 ? purchaseAttachments : undefined,
      idempotencyKey: purchaseIdempotencyKey,
    });

    if (!txRes.success) {
      setPurchaseFormError(txRes.error || 'Could not record supplier transaction.');
      return;
    }

    resetModalState();
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide">
            Wholesale Purchases & Inward Stock (Maal Kharid Register)
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-blue-900 dark:text-blue-400 tracking-tight mt-0.5 tabular-nums">
            {formatINR(totalPurchases)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Recorded invoices from {suppliers.length} active registered wholesalers
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openModalInMode('PRODUCT')}
            className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
          >
            <PackagePlus className="w-4 h-4" />
            <span>Restock Product</span>
          </button>

          <button
            type="button"
            onClick={() => openModalInMode('GENERAL')}
            className="flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Record Wholesaler Bill</span>
          </button>

          <button
            type="button"
            onClick={() => openPurchaseReturnModal()}
            className="flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Record Purchase Return</span>
          </button>
        </div>
      </div>

      {/* Sub-Tabs: Inward Purchases vs Purchase Returns & Credit Notes */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveSubTab('PURCHASES')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
            activeSubTab === 'PURCHASES'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <PackagePlus className="w-4 h-4" />
          <span>Inward Purchases ({inwardPurchaseRecords.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('RETURNS')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
            activeSubTab === 'RETURNS'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Purchase Returns &amp; Credit Notes ({returnSummary.totalReturnsCount})</span>
        </button>
      </div>

      {/* Purchase / Return Confirmation Banner */}
      {purchaseSuccessBanner && (
        <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-200">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>{purchaseSuccessBanner}</span>
          </div>
          <div className="flex items-center gap-2">
            {recentCreditNoteId && (
              <button
                type="button"
                onClick={() => setPreviewCreditNoteId(recentCreditNoteId)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>View / Download Credit Note</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setPurchaseSuccessBanner(null);
                setRecentCreditNoteId(null);
              }}
              className="text-emerald-800 dark:text-emerald-300 font-bold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {activeSubTab === 'RETURNS' ? (
        <div data-testid="purchase-returns-section" className="space-y-4">
          {/* Purchase Returns KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Credit Notes Value
              </div>
              <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
                {formatINR(returnSummary.totalCreditNoteValue)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {returnSummary.suppliersCreditedCount} supplier
                {returnSummary.suppliersCreditedCount === 1 ? '' : 's'} credited
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Active Credit Notes
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                {returnSummary.activeReturnsCount}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {returnSummary.cancelledReturnsCount > 0
                  ? `${returnSummary.cancelledReturnsCount} cancelled`
                  : 'All settled / active'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Damaged / Expired Value
              </div>
              <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
                {formatINR(returnSummary.damagedOrExpiredValue)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Recovered from damaged/spoiled goods
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Units Adjusted Out
              </div>
              <div className="text-2xl font-black text-blue-700 dark:text-blue-400 mt-1 tabular-nums">
                {returnSummary.totalUnitsReturned}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Deducted from store inventory
              </div>
            </div>
          </div>

          {/* Purchase Returns & Credit Notes Register Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  Purchase Returns &amp; Credit Notes Register
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Damaged, expired, or returned supplier goods with automated stock deductions
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Search credit notes"
                    placeholder="Search CN #, supplier, item..."
                    value={returnSearchQuery}
                    onChange={(e) => setReturnSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <select
                  aria-label="Filter returns by reason"
                  value={returnReasonFilter}
                  onChange={(e) =>
                    setReturnReasonFilter(e.target.value as 'ALL' | PurchaseReturnReason)
                  }
                  className="text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-semibold"
                >
                  <option value="ALL">All Reasons</option>
                  {PURCHASE_RETURN_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.shortLabel}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table
                data-testid="purchase-returns-table"
                className="w-full text-left text-xs sm:text-sm"
              >
                <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold uppercase text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Credit Note #</th>
                    <th className="py-3 px-4">Supplier</th>
                    <th className="py-3 px-4">Returned Goods &amp; Reason</th>
                    <th className="py-3 px-4">Stock &amp; Settlement</th>
                    <th className="py-3 px-4 text-right">Credit Value (₹)</th>
                    <th className="py-3 px-4 text-center">Credit Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredReturns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                        No purchase returns recorded yet. Click &ldquo;Record Purchase Return&rdquo; to issue a Credit Note.
                      </td>
                    </tr>
                  ) : (
                    filteredReturns.map((tx) => {
                      const sup = suppliers.find((s) => s.id === tx.supplierId);
                      const isCancelled = tx.status === 'CANCELLED' || tx.status === 'REVERSED';
                      const cnNo = tx.creditNoteNo || tx.invoiceNo || `CN-${tx.id.slice(-5)}`;
                      const itemCount = tx.returnItems?.length || (tx.productId ? 1 : 0);

                      return (
                        <tr
                          key={tx.id}
                          className={`transition-colors ${
                            isCancelled
                              ? 'bg-slate-50/80 dark:bg-slate-900/40 opacity-70'
                              : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {new Date(tx.date).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4">
                            <div
                              className={`font-mono font-bold ${
                                isCancelled
                                  ? 'line-through text-slate-400'
                                  : 'text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {cnNo}
                            </div>
                            {tx.originalInvoiceNo && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                Orig: #{tx.originalInvoiceNo}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                            {sup ? (
                              <button
                                type="button"
                                onClick={() => openSupplierProfile(sup.id)}
                                className="hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline text-left cursor-pointer"
                              >
                                {sup.name}
                              </button>
                            ) : (
                              'Wholesaler'
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-slate-800 dark:text-slate-200 font-medium">
                              {tx.itemsSummary || tx.description}
                            </div>
                            <span className="inline-flex items-center mt-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                              {getPurchaseReturnReasonLabel(tx.returnReason)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-1">
                              <span
                                className={`inline-flex items-center w-fit text-[10px] font-bold px-2 py-0.5 rounded ${
                                  isCancelled
                                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                    : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                }`}
                              >
                                {isCancelled
                                  ? 'Reversed / Stock Restored'
                                  : itemCount > 0
                                  ? `Stock Deducted (${itemCount} SKU${itemCount === 1 ? '' : 's'})`
                                  : 'Ledger Credit Only'}
                              </span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                {tx.settlementMode === 'CASH_REFUND'
                                  ? 'Cash Refund'
                                  : tx.settlementMode === 'BANK_REFUND'
                                  ? 'Bank / UPI Refund'
                                  : 'Adjusted in Payable'}
                              </span>
                            </div>
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-extrabold tabular-nums ${
                              isCancelled
                                ? 'line-through text-slate-400'
                                : 'text-emerald-800 dark:text-emerald-300'
                            }`}
                          >
                            {formatINR(tx.amount)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => setPreviewCreditNoteId(tx.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Credit Note</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
      /* Purchases List Table */
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Inward Stock Invoices</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Track paid, partial and credit wholesaler deliveries</p>
          </div>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            {inwardPurchaseRecords.length} purchase entries
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold uppercase text-[11px]">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Wholesale Supplier</th>
                <th className="py-3 px-4">Particulars</th>
                <th className="py-3 px-4">Bill Status</th>
                <th className="py-3 px-4 text-right">Amount (₹)</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {inwardPurchaseRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    No purchase bills recorded yet.
                  </td>
                </tr>
              ) : (
                inwardPurchaseRecords.map((st) => {
                  const sup = suppliers.find((s) => s.id === st.supplierId);
                  const isRet = st.type === 'RETURN';
                  const isCancelled = st.status === 'CANCELLED' || st.status === 'REVERSED';
                  return (
                    <tr
                      key={st.id}
                      className={`transition-colors ${
                        isCancelled
                          ? 'bg-slate-50/80 dark:bg-slate-900/40 opacity-70'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {new Date(st.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                        <span className={isCancelled ? 'line-through text-slate-400' : ''}>
                          {st.invoiceNo || 'INV-DIRECT'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        {sup ? (
                          <button
                            type="button"
                            onClick={() => openSupplierProfile(sup.id)}
                            className="hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline text-left cursor-pointer"
                            title="Open Supplier Ledger"
                          >
                            {sup.name}
                          </button>
                        ) : (
                          'Wholesaler'
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        <div className={isCancelled ? 'line-through' : ''}>{st.description}</div>
                        {st.quantity !== undefined && st.unitPrice !== undefined && (
                          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                            {st.quantity} {st.unit || 'units'} @ {formatINR(st.unitPrice)}/{st.unit || 'unit'}
                          </div>
                        )}
                        {!isCancelled && st.paymentStatus === 'PARTIAL' && st.paidAmount !== undefined && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5 tabular-nums">
                            Paid upfront: {formatINR(st.paidAmount)} via {st.paymentMethod || 'BANK'}
                          </div>
                        )}
                        {st.attachments && st.attachments.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setViewingAttachment({
                                attachment: st.attachments![0],
                                title: `${sup?.name || 'Wholesaler'} - Bill #${st.invoiceNo || 'INV'}`,
                                details: `Date: ${new Date(st.date).toLocaleDateString('en-IN')} · Amount: ${formatINR(st.amount)} · ${st.description}`,
                              })
                            }
                            className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer"
                          >
                            <Paperclip className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                            <span>{st.attachments.length} {st.attachments.length === 1 ? 'Bill Photo' : 'Bills'}</span>
                            <Eye className="w-3 h-3 text-blue-600 dark:text-blue-400 ml-0.5" />
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded ${
                              isCancelled
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                : isRet
                                ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300'
                                : st.paymentStatus === 'PAID'
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                : st.paymentStatus === 'PARTIAL'
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                : 'bg-red-100 dark:bg-rose-950/60 text-red-800 dark:text-rose-300'
                            }`}
                          >
                            {isCancelled ? 'Cancelled' : isRet ? 'Stock Return' : st.paymentStatus}
                          </span>
                        </div>
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-extrabold tabular-nums ${
                          isCancelled
                            ? 'line-through text-slate-400 dark:text-slate-500'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {isRet ? `- ${formatINR(st.amount)}` : formatINR(st.amount)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          {!isCancelled && !isRet && (
                            <button
                              type="button"
                              onClick={() =>
                                openPurchaseReturnModal({
                                  supplierId: st.supplierId,
                                  originalPurchaseId: st.id,
                                  originalInvoiceNo: st.invoiceNo,
                                  productId: st.productId,
                                  quantity: st.quantity,
                                  unit: st.unit,
                                  unitPrice: st.unitPrice,
                                })
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800 transition-colors cursor-pointer"
                              title="Return damaged or excess items from this invoice"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Return</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => downloadPurchaseInvoicePDF(st, profile, sup)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-emerald-900 dark:hover:text-emerald-300 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-700 transition-colors cursor-pointer"
                            title="Download Inward Purchase Voucher PDF"
                          >
                            <Download className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                            <span className="hidden sm:inline">PDF</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Record Purchase Modal (Supports both Product Restock & General Wholesaler Bill) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  {purchaseMode === 'PRODUCT'
                    ? 'Record Product Stock Purchase'
                    : 'Record Inward Wholesaler Bill'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {purchaseMode === 'PRODUCT'
                    ? 'Updates inventory stock, last purchase price, and supplier payable after your confirmation.'
                    : 'Record general wholesaler invoice or stock return.'}
                </p>
              </div>
              <button
                type="button"
                onClick={resetModalState}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switch */}
            <div className="grid grid-cols-2 gap-2 mt-3 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setPurchaseMode('PRODUCT');
                  setPendingConfirmation(false);
                  setPurchaseFormError(null);
                }}
                className={`py-2 rounded-lg cursor-pointer transition-colors ${
                  purchaseMode === 'PRODUCT'
                    ? 'bg-white dark:bg-slate-700 text-emerald-800 dark:text-emerald-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Product Stock Restock
              </button>
              <button
                type="button"
                onClick={() => {
                  setPurchaseMode('GENERAL');
                  setPendingConfirmation(false);
                  setPurchaseFormError(null);
                }}
                className={`py-2 rounded-lg cursor-pointer transition-colors ${
                  purchaseMode === 'GENERAL'
                    ? 'bg-white dark:bg-slate-700 text-blue-800 dark:text-blue-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                General Wholesaler Bill
              </button>
            </div>

            <form onSubmit={handleRecordPurchase} className="py-4 space-y-3">
              {purchaseFormError && (
                <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{purchaseFormError}</span>
                </div>
              )}

              {purchaseMode === 'PRODUCT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Select Product to Restock *
                  </label>
                  <select
                    required
                    value={selectedProductId}
                    onChange={(e) => handleSelectProductInModal(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="">-- Choose Product --</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Stock: {p.stockQty} {p.unit} | Limit: {p.minStockAlert})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Select Wholesaler / Supplier *
                </label>
                <select
                  required
                  value={selectedSupplierId}
                  onChange={(e) => {
                    setSelectedSupplierId(e.target.value);
                    setPendingConfirmation(false);
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">-- Choose Wholesaler --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (Payable: {formatINR(s.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>

              {purchaseMode === 'PRODUCT' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Quantity ({effectivePurchaseUnit}) *
                      </label>
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        required
                        placeholder="e.g. 20"
                        value={purchaseQty}
                        onChange={(e) => {
                          setPurchaseQty(e.target.value);
                          setPendingConfirmation(false);
                        }}
                        className="w-full text-base font-bold p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Purchase Unit
                      </label>
                      <select
                        value={effectivePurchaseUnit}
                        onChange={(e) => {
                          setPurchaseUnit(e.target.value);
                          setPendingConfirmation(false);
                        }}
                        disabled={!selectedProduct}
                        className="w-full text-sm font-bold p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      >
                        {allowedPurchaseUnits.length > 0 ? (
                          allowedPurchaseUnits.map((u) => (
                            <option key={u.unit} value={u.unit}>
                              {u.shortLabel}
                            </option>
                          ))
                        ) : (
                          <option value="units">units</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Price / {effectivePurchaseUnit} (₹) *
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        required
                        placeholder="e.g. 110"
                        value={unitPurchasePrice}
                        onChange={(e) => {
                          setUnitPurchasePrice(e.target.value);
                          setPendingConfirmation(false);
                        }}
                        className="w-full text-base font-bold p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                      />
                    </div>
                  </div>

                  {/* Computed Purchase Total & Selling Price Preservation Notice */}
                  <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs tabular-nums">
                    <div>
                      <div className="font-bold text-emerald-900 dark:text-emerald-200">
                        Total Purchase Cost
                      </div>
                      {selectedProduct && (
                        <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                          {effectivePurchaseUnit !== selectedProduct.unit && computedBaseRestockQty > 0
                            ? `Adds +${formatQuantityWithUnit(computedBaseRestockQty, selectedProduct.unit)} to inventory · `
                            : ''}
                          Counter Selling Price stays {formatINR(selectedProduct.sellingPrice)}/{selectedProduct.unit}
                        </div>
                      )}
                    </div>
                    <div className="text-lg font-extrabold text-emerald-900 dark:text-emerald-300">
                      {formatINR(computedProductTotal)}
                    </div>
                  </div>

                  {selectedProduct && selectedSupplierId && (
                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={setAsPreferredSupplier}
                        onChange={(e) => setSetAsPreferredSupplier(e.target.checked)}
                        className="w-4 h-4 text-emerald-700 rounded"
                      />
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        Save <strong>{selectedSupplier?.name}</strong> as Preferred Supplier for{' '}
                        {selectedProduct.name}
                      </span>
                    </label>
                  )}
                </>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Bill Total Amount (Kharid Rashi ₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold text-lg">₹</span>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      required
                      placeholder="e.g. 18500"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full text-xl font-bold pl-8 pr-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 tabular-nums"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Invoice #
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. BLJ-4491"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Bill Status
                  </label>
                  <select
                    value={paymentStatus}
                    onChange={(e) => {
                      const st = e.target.value as 'PAID' | 'PARTIAL' | 'UNPAID';
                      setPaymentStatus(st);
                      setPendingConfirmation(false);
                      if (st !== 'PARTIAL') setPartialPaidAmount('');
                    }}
                    className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="UNPAID">Unpaid (Credit)</option>
                    <option value="PARTIAL">Partial Paid</option>
                    <option value="PAID">Paid in Full</option>
                  </select>
                </div>
              </div>

              {/* Partial Paid Amount & Payment Mode Controls */}
              {(!isReturn || purchaseMode === 'PRODUCT') && (paymentStatus === 'PAID' || paymentStatus === 'PARTIAL') && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {paymentStatus === 'PARTIAL' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                          Amount Paid Now (₹) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          required
                          placeholder="e.g. 2000"
                          value={partialPaidAmount}
                          onChange={(e) => {
                            setPartialPaidAmount(e.target.value);
                            setPendingConfirmation(false);
                            setPurchaseFormError(null);
                          }}
                          className="w-full text-sm font-bold p-2 border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                        />
                        {(() => {
                          const billTotal = purchaseMode === 'PRODUCT' ? computedProductTotal : Number(amount) || 0;
                          const paidNow = Number(partialPaidAmount);
                          if (billTotal > 0 && Number.isFinite(paidNow) && paidNow >= 0 && paidNow <= billTotal) {
                            return (
                              <div className="text-[11px] text-amber-800 dark:text-amber-300 font-semibold mt-1 tabular-nums">
                                Remaining Payable Added: {formatINR(Math.round((billTotal - paidNow) * 100) / 100)}
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    )}

                    <div className={paymentStatus === 'PAID' ? 'sm:col-span-2' : ''}>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                        Payment Mode {paymentMethod === 'CASH' ? '(Deducts Counter Cashbook)' : '(Bank / UPI)'}
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['BANK', 'UPI', 'CASH'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              setPaymentMethod(m);
                              setPendingConfirmation(false);
                            }}
                            className={`py-2 text-xs font-bold rounded-lg border cursor-pointer transition-colors ${
                              paymentMethod === m
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Goods Particulars / Notes
                </label>
                <input
                  type="text"
                  placeholder={
                    purchaseMode === 'PRODUCT'
                      ? 'Optional batch / delivery notes'
                      : 'e.g. 30 Bags Atta, 10 Bags Sugar, Ghee cartons'
                  }
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              {purchaseMode === 'GENERAL' && (
                <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-purple-900 dark:text-purple-200">
                        Goods Return / Damaged Stock?
                      </div>
                      <div className="text-[11px] text-purple-700 dark:text-purple-300">
                        Check if returning damaged or expired items to supplier
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isReturn}
                      onChange={(e) => {
                        setIsReturn(e.target.checked);
                        setPurchaseFormError(null);
                      }}
                      className="w-5 h-5 text-purple-600 rounded"
                    />
                  </div>

                  {isReturn && (
                    <div className="pt-2 border-t border-purple-200 dark:border-purple-800 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-semibold text-purple-900 dark:text-purple-200 mb-1">
                          Returned Inventory Product (Optional — reduces stock)
                        </label>
                        <select
                          value={returnProductId}
                          onChange={(e) => {
                            const pid = e.target.value;
                            setReturnProductId(pid);
                            const found = activeProducts.find((p) => p.id === pid);
                            setReturnUnit(found?.unit || '');
                            setPurchaseFormError(null);
                          }}
                          className="w-full text-xs border border-purple-300 dark:border-purple-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        >
                          <option value="">-- Financial return only (no SKU) --</option>
                          {activeProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} (Avail: {p.stockQty} {p.unit})
                            </option>
                          ))}
                        </select>
                      </div>
                      {returnProductId && (
                        <>
                          <div className="sm:col-span-2">
                            <label className="block text-[11px] font-semibold text-purple-900 dark:text-purple-200 mb-1">
                              Return Qty
                            </label>
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              placeholder="Qty to return"
                              value={returnQty}
                              onChange={(e) => {
                                setReturnQty(e.target.value);
                                setPurchaseFormError(null);
                              }}
                              className="w-full text-xs font-bold border border-purple-300 dark:border-purple-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-purple-900 dark:text-purple-200 mb-1">
                              Unit
                            </label>
                            <select
                              value={returnUnit || selectedReturnProduct?.unit || ''}
                              onChange={(e) => setReturnUnit(e.target.value)}
                              className="w-full text-xs font-bold border border-purple-300 dark:border-purple-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            >
                              {allowedReturnUnits.map((u) => (
                                <option key={u.unit} value={u.unit}>
                                  {u.shortLabel}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <FileAttachment
                  attachments={purchaseAttachments}
                  onChange={setPurchaseAttachments}
                  billType="PURCHASE"
                  label="Attach Wholesaler Bill / Delivery Invoice (Thok Bill Photo Upload)"
                  onOcrExtracted={(data) => {
                    if (data.totalAmount && purchaseMode === 'GENERAL') {
                      setAmount(String(data.totalAmount));
                    }
                    if (data.billNumber) setInvoiceNo(data.billNumber);
                    if (data.items && data.items.length > 0) {
                      const itemsStr = data.items
                        .map((it) => `${it.quantity} ${it.unit} ${it.name}`)
                        .join(', ');
                      setDescription(itemsStr);
                    } else if (data.notes) {
                      setDescription(data.notes);
                    }
                    if (data.partyName) {
                      const match = suppliers.find((s) =>
                        s.name.toLowerCase().includes(data.partyName!.toLowerCase())
                      );
                      if (match) setSelectedSupplierId(match.id);
                    }
                  }}
                />
              </div>

              {/* Explicit Confirmation Summary Step for Product Restock */}
              {purchaseMode === 'PRODUCT' && pendingConfirmation && selectedProduct && selectedSupplier && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-xs text-amber-950 dark:text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    <span>Confirm Purchase Before Saving</span>
                  </div>
                  <p className="leading-relaxed">
                    Add <strong>+{purchaseQty} {effectivePurchaseUnit}</strong>
                    {effectivePurchaseUnit !== selectedProduct.unit && computedBaseRestockQty > 0
                      ? ` (+${formatQuantityWithUnit(computedBaseRestockQty, selectedProduct.unit)})`
                      : ''}{' '}
                    to <strong>{selectedProduct.name}</strong> (Last Purchase Price updates to{' '}
                    <strong>{formatINR(Number(unitPurchasePrice))}</strong>; Selling Price stays{' '}
                    <strong>{formatINR(selectedProduct.sellingPrice)}</strong>). Record{' '}
                    <strong>{formatINR(computedProductTotal)}</strong> ({paymentStatus}
                    {paymentStatus === 'PARTIAL' && partialPaidAmount !== ''
                      ? `, Paid now: ${formatINR(Number(partialPaidAmount))} via ${paymentMethod}`
                      : paymentStatus === 'PAID'
                      ? `, Via ${paymentMethod}`
                      : ''}
                    ) with{' '}
                    <strong>{selectedSupplier.name}</strong>.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={resetModalState}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  {purchaseMode === 'PRODUCT'
                    ? pendingConfirmation
                      ? 'Confirm & Save Purchase'
                      : 'Review Purchase'
                    : 'Save Inward Purchase Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bill Viewer Modal */}
      {viewingAttachment && (
        <BillViewerModal
          attachment={viewingAttachment.attachment}
          title={viewingAttachment.title}
          details={viewingAttachment.details}
          onClose={() => setViewingAttachment(null)}
        />
      )}

      {/* Purchase Return Modal */}
      <PurchaseReturnModal
        isOpen={isReturnModalOpen}
        onClose={() => {
          setIsReturnModalOpen(false);
          setReturnPrefill(null);
        }}
        prefill={returnPrefill}
        onSuccess={(res) => {
          setPurchaseSuccessBanner(
            `Purchase Return Recorded: Credit Note ${res.creditNoteNo} issued to ${res.supplierName} for ${formatINR(res.totalAmount)}. Inventory & supplier payable updated automatically.`
          );
          setRecentCreditNoteId(res.transactionId);
          setActiveSubTab('RETURNS');
        }}
      />

      {/* Credit Note Preview & Download Modal */}
      <CreditNotePreviewModal
        returnTx={previewCreditNoteTx}
        supplier={previewCreditNoteSupplier}
        profile={profile}
        onClose={() => setPreviewCreditNoteId(null)}
      />
    </div>
  );
};
