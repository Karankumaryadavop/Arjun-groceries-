import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../context/StoreContext';
import {
  Supplier,
  SupplierPreferredPaymentMethod,
  BillAttachment,
  SupplierLedgerEntry,
  LedgerDateRange,
} from '../types';
import { formatINR, calculateSupplierLedgerWithRunningBalance, getLocalTodayKey } from '../utils/accounting';
import { FileAttachment } from './FileAttachment';
import { BillViewerModal } from './BillViewerModal';
import { SupplierPdfImportModal } from './SupplierPdfImportModal';
import { SUPPLIER_PAYMENT_METHOD_LABELS } from '../utils/supplierPdfImport';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  Truck,
  Search,
  Plus,
  Phone,
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  Clock,
  Edit2,
  Trash2,
  X,
  FileCheck,
  Paperclip,
  Eye,
  Download,
  Upload,
  Ban,
  CheckCircle,
  Filter,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import {
  exportSuppliersToCSV,
  downloadCSVFile,
  downloadSupplierLedgerCSV,
  getSampleSupplierCSV,
} from '../utils/csv';
import { downloadSupplierLedgerPDF } from '../utils/pdfGenerator';
import { getAllowedSellingUnits } from '../utils/units';

export const SuppliersView: React.FC = () => {
  const {
    suppliers,
    supplierTransactions,
    products,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    addSupplierTransaction,
    cancelSupplierTransaction,
    selectedSupplierId,
    setSelectedSupplierId,
    importSuppliersFromCSV,
    importSuppliersBatch,
    profile,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');

  // Ledger Filter State
  const [ledgerDateRange, setLedgerDateRange] = useState<LedgerDateRange>('ALL');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'ALL' | 'PURCHASE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT' | 'CANCELLED'>('ALL');
  const [ledgerSearch, setLedgerSearch] = useState('');

  // CSV Import/Export states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importSummary, setImportSummary] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  // Modals state
  const [isAddSupModalOpen, setIsAddSupModalOpen] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<'PURCHASE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT'>('PURCHASE');
  const [txAmount, setTxAmount] = useState('');
  const [txDescription, setTxDescription] = useState('');
  const [txInvoiceNo, setTxInvoiceNo] = useState('');
  const [txPaymentMethod, setTxPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK'>('BANK');
  const [txPaymentStatus, setTxPaymentStatus] = useState<'PAID' | 'PARTIAL' | 'UNPAID'>('UNPAID');
  const [txPaidAmount, setTxPaidAmount] = useState('');
  const [supAttachments, setSupAttachments] = useState<BillAttachment[]>([]);
  const [txReturnProductId, setTxReturnProductId] = useState('');
  const [txReturnQty, setTxReturnQty] = useState('');
  const [txReturnUnit, setTxReturnUnit] = useState('');
  const [txFormError, setTxFormError] = useState<string | null>(null);
  const [txIdempotencyKey, setTxIdempotencyKey] = useState(
    () => `stx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const [viewingAttachment, setViewingAttachment] = useState<{
    attachment: BillAttachment;
    title: string;
    details?: string;
  } | null>(null);

  // Selected Transaction for Details Modal
  const [selectedTxDetail, setSelectedTxDetail] = useState<SupplierLedgerEntry | null>(null);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [txCancelError, setTxCancelError] = useState<string | null>(null);

  const [isPdfImportOpen, setIsPdfImportOpen] = useState(false);

  // Add Supplier form
  const [newName, setNewName] = useState('');
  const [newContactPerson, setNewContactPerson] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newGstin, setNewGstin] = useState('');
  const [newCreditTerms, setNewCreditTerms] = useState('');
  const [newPreferredPaymentMethod, setNewPreferredPaymentMethod] =
    useState<SupplierPreferredPaymentMethod>('BANK_TRANSFER');
  const [newOpenBal, setNewOpenBal] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Edit Supplier
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  useTrackActiveTransaction(
    'suppliers-modal',
    isAddSupModalOpen || isTxModalOpen || isEditModalOpen || isCancelConfirmOpen
  );
  const [editName, setEditName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editGstin, setEditGstin] = useState('');
  const [editCreditTerms, setEditCreditTerms] = useState('');
  const [editPreferredPaymentMethod, setEditPreferredPaymentMethod] =
    useState<SupplierPreferredPaymentMethod>('BANK_TRANSFER');

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(searchQuery.toLowerCase())) ||
      s.phone.includes(searchQuery)
  );

  const totalPayables = suppliers.reduce((sum, s) => sum + Math.max(0, s.currentBalance), 0);
  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  // Chronological Supplier Ledger Summary with running balances and filters
  const ledgerSummary = useMemo(() => {
    if (!selectedSupplier) return null;
    return calculateSupplierLedgerWithRunningBalance(
      selectedSupplier,
      supplierTransactions,
      {
        dateRange: ledgerDateRange,
        customStartDate: customStartDate || undefined,
        customEndDate: customEndDate || undefined,
        typeFilter: ledgerTypeFilter,
        searchQuery: ledgerSearch,
      }
    );
  }, [
    selectedSupplier,
    supplierTransactions,
    ledgerDateRange,
    customStartDate,
    customEndDate,
    ledgerTypeFilter,
    ledgerSearch,
  ]);

  const handleCreateSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = addSupplier({
      name: newName.trim(),
      contactPerson: newContactPerson.trim() || undefined,
      phone: newPhone.trim() || 'No phone',
      address: newAddress.trim() || undefined,
      gstin: newGstin.trim() || undefined,
      creditTerms: newCreditTerms.trim() || undefined,
      preferredPaymentMethod: newPreferredPaymentMethod,
      openingBalance: Number(newOpenBal) || 0,
      notes: newNotes.trim() || undefined,
    });
    setNewName('');
    setNewContactPerson('');
    setNewPhone('');
    setNewAddress('');
    setNewGstin('');
    setNewCreditTerms('');
    setNewPreferredPaymentMethod('BANK_TRANSFER');
    setNewOpenBal('');
    setNewNotes('');
    setIsAddSupModalOpen(false);
    setSelectedSupplierId(id);
  };

  const activeProducts = useMemo(
    () => products.filter((p) => !p.isArchived),
    [products]
  );

  const selectedReturnProduct = useMemo(
    () => activeProducts.find((p) => p.id === txReturnProductId) || null,
    [activeProducts, txReturnProductId]
  );

  const allowedReturnUnits = useMemo(
    () => (selectedReturnProduct ? getAllowedSellingUnits(selectedReturnProduct.unit) : []),
    [selectedReturnProduct]
  );

  const openSupplierTxModal = (type: 'PURCHASE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT') => {
    setTxType(type);
    setTxAmount('');
    setTxPaidAmount('');
    setTxPaymentStatus('UNPAID');
    setTxDescription('');
    setTxInvoiceNo('');
    setSupAttachments([]);
    setTxReturnProductId('');
    setTxReturnQty('');
    setTxReturnUnit('');
    setTxFormError(null);
    setTxIdempotencyKey(`stx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsTxModalOpen(true);
  };

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    setTxFormError(null);
    const totalAmt = Number(txAmount);
    if (!selectedSupplierId || !Number.isFinite(totalAmt) || totalAmt <= 0) {
      setTxFormError('Please enter a valid amount greater than 0.');
      return;
    }

    const parsedPaid =
      txType === 'PURCHASE' && txPaymentStatus === 'PARTIAL' ? Number(txPaidAmount) : undefined;
    if (txType === 'PURCHASE' && txPaymentStatus === 'PARTIAL') {
      if (
        txPaidAmount.trim() === '' ||
        !Number.isFinite(parsedPaid) ||
        (parsedPaid as number) < 0 ||
        (parsedPaid as number) > totalAmt
      ) {
        setTxFormError(`Please enter partial amount paid now between ₹0 and ${formatINR(totalAmt)}.`);
        return;
      }
    }

    if (
      txType === 'RETURN' &&
      txReturnProductId &&
      (!Number.isFinite(Number(txReturnQty)) || Number(txReturnQty) <= 0)
    ) {
      setTxFormError('Please enter a valid return quantity greater than 0 for the selected product.');
      return;
    }

    const res = addSupplierTransaction({
      supplierId: selectedSupplierId,
      type: txType,
      amount: totalAmt,
      paidAmount: parsedPaid,
      description:
        txDescription.trim() ||
        (txType === 'PURCHASE'
          ? 'Goods Purchase Bill (Maal Aavak)'
          : txType === 'PAYMENT'
          ? 'Supplier Payment Settlement (Bhugtan)'
          : txType === 'RETURN'
          ? 'Purchase Return to Wholesaler'
          : 'Account Adjustment'),
      invoiceNo: txInvoiceNo.trim() || undefined,
      paymentStatus: txType === 'PURCHASE' ? txPaymentStatus : 'PAID',
      paymentMethod: txPaymentMethod,
      productId: txType === 'RETURN' && txReturnProductId ? txReturnProductId : undefined,
      quantity: txType === 'RETURN' && txReturnProductId ? Number(txReturnQty) : undefined,
      unit:
        txType === 'RETURN' && txReturnProductId
          ? txReturnUnit || selectedReturnProduct?.unit
          : undefined,
      attachments: supAttachments.length > 0 ? supAttachments : undefined,
      idempotencyKey: txIdempotencyKey,
    });

    if (!res.success) {
      setTxFormError(res.error || 'Unable to save supplier transaction.');
      return;
    }

    setTxAmount('');
    setTxPaidAmount('');
    setTxDescription('');
    setTxInvoiceNo('');
    setSupAttachments([]);
    setTxReturnProductId('');
    setTxReturnQty('');
    setTxReturnUnit('');
    setTxFormError(null);
    setTxIdempotencyKey(`stx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsTxModalOpen(false);
  };

  const handleOpenEdit = (s: Supplier) => {
    setEditName(s.name);
    setEditContact(s.contactPerson || '');
    setEditPhone(s.phone);
    setEditAddress(s.address || '');
    setEditGstin(s.gstin || '');
    setEditCreditTerms(s.creditTerms || '');
    setEditPreferredPaymentMethod(s.preferredPaymentMethod || 'BANK_TRANSFER');
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) return;
    updateSupplier(selectedSupplierId, {
      name: editName.trim(),
      contactPerson: editContact.trim() || undefined,
      phone: editPhone.trim(),
      address: editAddress.trim() || undefined,
      gstin: editGstin.trim() || undefined,
      creditTerms: editCreditTerms.trim() || undefined,
      preferredPaymentMethod: editPreferredPaymentMethod,
    });
    setIsEditModalOpen(false);
  };

  const handleDelete = () => {
    if (!selectedSupplier) return;
    const confirmText = prompt(
      `Delete supplier "${selectedSupplier.name}"? Enter reason to confirm (this will be logged in audit):`
    );
    if (confirmText) {
      deleteSupplier(selectedSupplier.id, confirmText);
      setSelectedSupplierId(null);
    }
  };

  const handleCancelSelectedTx = () => {
    if (!selectedTxDetail || !cancelReasonInput.trim()) {
      setTxCancelError('Please enter a cancellation reason.');
      return;
    }
    const success = cancelSupplierTransaction(selectedTxDetail.id, cancelReasonInput.trim());
    if (success) {
      setTxCancelError(null);
      setIsCancelConfirmOpen(false);
      setCancelReasonInput('');
      setSelectedTxDetail(null);
    } else {
      setTxCancelError('Unable to cancel transaction. It may already be cancelled or purchased stock has already been sold.');
    }
  };

  const handleExportCSV = () => {
    const csv = exportSuppliersToCSV(suppliers);
    const dateStr = getLocalTodayKey();
    downloadCSVFile(`arjun_groceries_suppliers_${dateStr}.csv`, csv);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        const summary = importSuppliersFromCSV(text);
        setImportSummary(summary);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadSample = () => {
    const sample = getSampleSupplierCSV();
    downloadCSVFile('sample_suppliers_template.csv', sample);
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Payables (Dues)
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {formatINR(totalPayables)}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Amount payable to wholesalers</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Active Suppliers
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
            {suppliers.length}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Wholesalers & Distributors</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            High Dues Suppliers
          </div>
          <div className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1">
            {suppliers.filter((s) => s.currentBalance >= 15000).length}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Payable &gt; Rs. 15,000</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Data Migration
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 py-1.5 px-2 rounded-lg whitespace-nowrap cursor-pointer"
              title="Export suppliers to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => setIsPdfImportOpen(true)}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 py-1.5 px-2.5 rounded-lg whitespace-nowrap cursor-pointer border border-emerald-200 dark:border-emerald-800"
              title="Bulk import supplier contacts from a CSV or PDF file with preview"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import CSV / PDF</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".csv,text/csv"
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* CSV Import Summary */}
      {importSummary && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
          <div>
            <span className="font-bold">CSV Import Result:</span> Imported {importSummary.imported} suppliers ({importSummary.skipped} skipped).
            {importSummary.errors.length > 0 && (
              <span className="text-red-700 dark:text-red-400 ml-2">Errors: {importSummary.errors.join('; ')}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadSample}
              className="underline text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 text-[11px]"
            >
              Download Sample CSV
            </button>
            <button
              type="button"
              onClick={() => setImportSummary(null)}
              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 font-bold ml-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Dual Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Suppliers Directory (5 cols) */}
        <div className={`lg:col-span-5 ${selectedSupplierId ? 'hidden lg:block' : 'block'}`}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>Wholesaler Directory</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsAddSupModalOpen(true)}
                  className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Supplier</span>
                </button>
              </div>

              {/* Search Field */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search supplier, contact, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-emerald-600 transition-colors"
                />
              </div>
            </div>

            {/* Suppliers List */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[620px] overflow-y-auto">
              {filteredSuppliers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No suppliers found matching &quot;{searchQuery}&quot;.
                </div>
              ) : (
                filteredSuppliers.map((s) => {
                  const isSelected = s.id === selectedSupplierId;
                  const hasDue = s.currentBalance > 0;
                  const isAdv = s.currentBalance < 0;

                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedSupplierId(s.id)}
                      className={`p-3.5 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/50 border-l-4 border-emerald-700 dark:border-emerald-500'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                            {s.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            {s.contactPerson && <span>{s.contactPerson}</span>}
                            <span>· {s.phone}</span>
                            {s.creditTerms && <span>· {s.creditTerms}</span>}
                            {s.preferredPaymentMethod && (
                              <span>· {SUPPLIER_PAYMENT_METHOD_LABELS[s.preferredPaymentMethod]}</span>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div
                            className={`font-black text-xs sm:text-sm ${
                              hasDue
                                ? 'text-amber-700 dark:text-amber-400'
                                : isAdv
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {hasDue
                              ? formatINR(s.currentBalance)
                              : isAdv
                              ? `Advance: ${formatINR(Math.abs(s.currentBalance))}`
                              : 'Rs. 0 (Settled)'}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {hasDue ? 'Payable Dues' : isAdv ? 'Advance Paid' : 'Settled'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100/80 dark:border-slate-800 pt-1.5">
                        <span className="truncate">
                          Total Purchases: {formatINR(s.totalPurchases)}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                          Paid: {formatINR(s.totalPaid)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Supplier Ledger & Detail (7 cols) */}
        <div className={`lg:col-span-7 ${!selectedSupplierId ? 'hidden lg:block' : 'block'}`}>
          {selectedSupplier && ledgerSummary ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
              {/* Back to list button for mobile */}
              <div className="lg:hidden p-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setSelectedSupplierId(null)}
                  className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  &larr; Back to all suppliers
                </button>
              </div>

              {/* Supplier Header Banner */}
              <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg sm:text-xl font-black">{selectedSupplier.name}</h3>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          ledgerSummary.status === 'CLEARED'
                            ? 'bg-emerald-800 text-emerald-200'
                            : ledgerSummary.status === 'ADVANCE'
                            ? 'bg-teal-800 text-teal-200'
                            : 'bg-amber-900/80 text-amber-200'
                        }`}
                      >
                        {ledgerSummary.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {selectedSupplier.contactPerson && (
                        <span>Contact: {selectedSupplier.contactPerson}</span>
                      )}
                      <span>Phone: {selectedSupplier.phone}</span>
                      {selectedSupplier.gstin && <span>GSTIN: {selectedSupplier.gstin}</span>}
                      {selectedSupplier.creditTerms && (
                        <span>Terms: {selectedSupplier.creditTerms}</span>
                      )}
                      {selectedSupplier.preferredPaymentMethod && (
                        <span>
                          Preferred: {SUPPLIER_PAYMENT_METHOD_LABELS[selectedSupplier.preferredPaymentMethod]}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        downloadSupplierLedgerPDF(
                          selectedSupplier,
                          ledgerSummary,
                          profile
                        )
                      }
                      title="Download Supplier Ledger PDF"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-900 rounded-lg text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-700" />
                      <span>PDF Ledger</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadSupplierLedgerCSV(selectedSupplier, ledgerSummary)}
                      title="Export Supplier Ledger CSV"
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>CSV</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(selectedSupplier)}
                      title="Edit Supplier Details"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={handleDelete}
                      title="Delete Supplier"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-700 text-slate-300 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-700/80 text-center">
                  <div className="p-2 bg-slate-800/80 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Total Purchases</div>
                    <div className="text-sm sm:text-base font-extrabold mt-0.5 text-white">
                      {formatINR(ledgerSummary.totalPurchases)}
                    </div>
                  </div>
                  <div className="p-2 bg-slate-800/80 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Total Paid</div>
                    <div className="text-sm sm:text-base font-extrabold text-emerald-400 mt-0.5">
                      {formatINR(ledgerSummary.totalPaid)}
                    </div>
                  </div>
                  <div className="p-2 bg-slate-800/80 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Current Payable</div>
                    <div
                      className={`text-sm sm:text-base font-black mt-0.5 ${
                        ledgerSummary.closingBalance > 0
                          ? 'text-amber-400'
                          : ledgerSummary.closingBalance < 0
                          ? 'text-teal-300'
                          : 'text-emerald-400'
                      }`}
                    >
                      {ledgerSummary.closingBalance < 0
                        ? `Advance: ${formatINR(Math.abs(ledgerSummary.closingBalance))}`
                        : formatINR(ledgerSummary.closingBalance)}
                    </div>
                  </div>
                  <div className="p-2 bg-slate-800/80 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Last Supply Date</div>
                    <div className="text-[11px] font-semibold text-slate-300 mt-1 truncate">
                      {ledgerSummary.lastTransactionDate
                        ? formatDateTime(ledgerSummary.lastTransactionDate).split(',')[0]
                        : 'No activity'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Add Purchase, Pay Supplier, Purchase Return */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => openSupplierTxModal('PURCHASE')}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2.5 px-3 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Record Purchase Bill (Maal Aaya)</span>
                </button>
                <button
                  type="button"
                  onClick={() => openSupplierTxModal('PAYMENT')}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-colors"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Pay Supplier (Bhugtan Kiya)</span>
                </button>
                <button
                  type="button"
                  onClick={() => openSupplierTxModal('RETURN')}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-purple-700 hover:bg-purple-800 active:bg-purple-900 text-white rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-colors"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Purchase Return</span>
                </button>
              </div>

              {/* Filter Bar */}
              <div className="p-3.5 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  {/* Date Filter Quick Pills */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px]">
                    {(
                      [
                        { id: 'ALL', label: 'All Time' },
                        { id: 'TODAY', label: 'Today' },
                        { id: 'YESTERDAY', label: 'Yesterday' },
                        { id: 'LAST_7_DAYS', label: '7 Days' },
                        { id: 'LAST_30_DAYS', label: '30 Days' },
                        { id: 'THIS_MONTH', label: 'This Month' },
                        { id: 'LAST_MONTH', label: 'Last Month' },
                        { id: 'CUSTOM', label: 'Custom' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setLedgerDateRange(f.id)}
                        className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-colors cursor-pointer ${
                          ledgerDateRange === f.id
                            ? 'bg-slate-900 dark:bg-emerald-700 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Type Filter Pills */}
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-slate-400 dark:text-slate-500 font-semibold mr-1">Type:</span>
                    {(
                      [
                        { id: 'ALL', label: 'All' },
                        { id: 'PURCHASE', label: 'Purchases' },
                        { id: 'PAYMENT', label: 'Payments' },
                        { id: 'RETURN', label: 'Returns' },
                        { id: 'CANCELLED', label: 'Cancelled' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setLedgerTypeFilter(t.id)}
                        className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                          ledgerTypeFilter === t.id
                            ? 'bg-blue-700 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Date Pickers */}
                {ledgerDateRange === 'CUSTOM' && (
                  <div className="flex items-center gap-2 pt-1 text-xs">
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">From:</span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
                    />
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">To:</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}

                {/* Search Bar for transactions */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by Bill #, Inv #, or description..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-emerald-600"
                  />
                </div>
              </div>

              {/* Transactions Ledger Table */}
              <div className="p-4">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                      Supplier Statement & Ledger History
                    </h4>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      ({ledgerSummary.filteredEntriesCount} of {ledgerSummary.totalEntriesCount} records)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Statement</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-[460px] overflow-y-auto">
                  {/* Opening Balance Row if present */}
                  {ledgerSummary.openingBalance > 0 && (
                    <div className="flex items-center justify-between p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 text-slate-700 dark:text-slate-200">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-[11px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                          START
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                            Opening Balance Carryforward (Purana Hisab)
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Initial balance before digital record keeping
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">
                          {formatINR(ledgerSummary.openingBalance)}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">
                          Running Bal: {formatINR(ledgerSummary.openingBalance)}
                        </div>
                      </div>
                    </div>
                  )}

                  {ledgerSummary.entries.length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-500 dark:text-slate-400">
                      No purchase bills or payments found matching the selected filters.
                    </div>
                  ) : (
                    ledgerSummary.entries.map((entry) => {
                      const isPurchase = entry.type === 'PURCHASE';
                      const isReturn = entry.type === 'RETURN';
                      const isCancelled = entry.isCancelled;

                      return (
                        <div
                          key={entry.id}
                          onClick={() => setSelectedTxDetail(entry)}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                            isCancelled
                              ? 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 opacity-70 hover:opacity-100'
                              : isPurchase
                              ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-2xs'
                              : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-2xs'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
                                isCancelled
                                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                  : isPurchase
                                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                  : isReturn
                                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              }`}
                            >
                              {isCancelled ? 'RADD' : isPurchase ? 'BILL' : isReturn ? 'WAPSI' : 'PAY'}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-bold text-xs sm:text-sm truncate ${
                                    isCancelled ? 'line-through text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100'
                                  }`}
                                >
                                  {entry.description}
                                </span>
                                {isCancelled && (
                                  <span className="text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.2 rounded">
                                    Cancelled
                                  </span>
                                )}
                              </div>

                              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                                <span>{formatDateTime(entry.date)}</span>
                                {entry.invoiceNo && (
                                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                                    · Bill #{entry.invoiceNo}
                                  </span>
                                )}
                                {entry.paymentMethod && <span>· Via {entry.paymentMethod}</span>}
                                {!isCancelled && entry.upfrontPaidAmount !== undefined && entry.upfrontPaidAmount > 0 && (
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    · Paid now: {formatINR(entry.upfrontPaidAmount)}
                                  </span>
                                )}
                                {entry.attachments && entry.attachments.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewingAttachment({
                                        attachment: entry.attachments![0],
                                        title: `${selectedSupplier.name} - ${isPurchase ? 'Bill Photo' : 'Payment Slip'}`,
                                        details: `Date: ${formatDateTime(entry.date)} · Amount: ${formatINR(entry.amount)}`,
                                      });
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer"
                                  >
                                    <Paperclip className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                    <span>
                                      {entry.attachments.length} {entry.attachments.length === 1 ? 'Doc' : 'Docs'}
                                    </span>
                                    <Eye className="w-3 h-3 text-blue-600 dark:text-blue-400 ml-0.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0 pl-2">
                            <div
                              className={`font-black text-xs sm:text-sm ${
                                isCancelled
                                  ? 'text-slate-400 dark:text-slate-500 line-through'
                                  : isPurchase
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : isReturn
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {isCancelled
                                ? formatINR(entry.amount)
                                : isPurchase
                                ? `+ ${formatINR(entry.amount)}`
                                : `- ${formatINR(entry.amount)}`}
                            </div>
                            {!isCancelled && entry.upfrontPaidAmount !== undefined && entry.upfrontPaidAmount > 0 && (
                              <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                - {formatINR(entry.upfrontPaidAmount)} paid
                              </div>
                            )}
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                              Bal: {formatINR(entry.runningBalance)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <Truck className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <h4 className="font-bold text-slate-800 dark:text-slate-100 text-base">Select a Supplier</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                View supplier purchase bills, payment history, running balances, and download formatted PDF statements.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Transaction Details Modal */}
      {selectedTxDetail && selectedSupplier && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Supplier Transaction Details</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400">ID: {selectedTxDetail.id}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTxDetail(null);
                  setIsCancelConfirmOpen(false);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              {/* Type & Amount Header */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between ${
                  selectedTxDetail.isCancelled
                    ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    : selectedTxDetail.type === 'PURCHASE'
                    ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                }`}
              >
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">
                    {selectedTxDetail.type === 'PURCHASE'
                      ? 'Purchase Invoice (Maal Aavak)'
                      : selectedTxDetail.type === 'PAYMENT'
                      ? 'Payment Settlement (Bhugtan)'
                      : selectedTxDetail.type === 'RETURN'
                      ? 'Purchase Return'
                      : 'Account Adjustment'}
                  </div>
                  <div className="text-2xl font-black mt-0.5">
                    {formatINR(selectedTxDetail.amount)}
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${
                      selectedTxDetail.isCancelled
                        ? 'bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                        : 'bg-blue-200 dark:bg-blue-900 text-blue-900 dark:text-blue-200'
                    }`}
                  >
                    {selectedTxDetail.status || 'COMPLETED'}
                  </span>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Via {selectedTxDetail.paymentMethod || 'BANK'}
                  </div>
                </div>
              </div>

              {/* Balance Progression Box */}
              <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold">Previous Bal</div>
                  <div className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                    {formatINR(selectedTxDetail.previousBalance)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold">Tx Amount</div>
                  <div
                    className={`text-xs sm:text-sm font-black mt-0.5 ${
                      selectedTxDetail.type === 'PURCHASE' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {selectedTxDetail.type === 'PURCHASE' ? '+' : '-'} {formatINR(selectedTxDetail.amount)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold">Updated Bal</div>
                  <div className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 mt-0.5">
                    {formatINR(selectedTxDetail.runningBalance)}
                  </div>
                </div>
              </div>

              {/* Information Grid */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Supplier:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedSupplier.name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Date & Exact Time:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatDateTime(selectedTxDetail.date)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Bill / Inv Number:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {selectedTxDetail.invoiceNo || 'N/A (Direct Entry)'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Description:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-right max-w-xs">
                    {selectedTxDetail.description}
                  </span>
                </div>

                {selectedTxDetail.isCancelled && (
                  <div className="p-2.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg text-red-900 dark:text-red-200 space-y-1">
                    <div className="font-bold flex items-center gap-1">
                      <Ban className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                      <span>Cancelled Transaction (Audit Record)</span>
                    </div>
                    <div className="text-[11px]">
                      Reason: {selectedTxDetail.cancelReason || 'No reason specified'}
                    </div>
                    {selectedTxDetail.cancelledAt && (
                      <div className="text-[10px] text-red-700 dark:text-red-300">
                        Cancelled At: {formatDateTime(selectedTxDetail.cancelledAt)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Attachments Section */}
              {selectedTxDetail.attachments && selectedTxDetail.attachments.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Attached Bill / Invoice Documents ({selectedTxDetail.attachments.length})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedTxDetail.attachments.map((att, idx) => (
                      <div
                        key={idx}
                        onClick={() =>
                          setViewingAttachment({
                            attachment: att,
                            title: `${selectedSupplier.name} - Bill #${selectedTxDetail.invoiceNo || idx + 1}`,
                            details: `Date: ${formatDateTime(selectedTxDetail.date)} · Amount: ${formatINR(selectedTxDetail.amount)}`,
                          })
                        }
                        className="p-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer flex items-center gap-2"
                      >
                        <Paperclip className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
                        <span className="text-xs font-semibold truncate text-slate-800 dark:text-slate-200">
                          {att.name || `Document ${idx + 1}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cancellation Form */}
              {!selectedTxDetail.isCancelled && isCancelConfirmOpen && (
                <div className="p-3.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl space-y-2">
                  <div className="text-xs font-bold text-red-900 dark:text-red-200">
                    Confirm Cancellation / Reversal
                  </div>
                  <p className="text-[11px] text-red-700 dark:text-red-300">
                    This transaction will be marked Cancelled and preserved in the ledger history for audit accuracy. The supplier&apos;s active payable balance and any linked Cashbook/stock entry will update immediately.
                  </p>
                  {txCancelError && (
                    <div role="alert" className="p-2 rounded-lg bg-red-100 dark:bg-red-900/60 border border-red-300 dark:border-red-800 text-[11px] font-semibold text-red-800 dark:text-red-200">
                      {txCancelError}
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Reason for cancellation *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Returned goods / Incorrect amount billed"
                      value={cancelReasonInput}
                      onChange={(e) => {
                        setCancelReasonInput(e.target.value);
                        if (txCancelError) setTxCancelError(null);
                      }}
                      className="w-full text-xs p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-red-300 dark:border-red-800 rounded-lg focus:outline-red-600"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCancelSelectedTx}
                      className="flex-1 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Confirm Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCancelConfirmOpen(false);
                        setTxCancelError(null);
                      }}
                      className="py-1.5 px-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Slip</span>
                </button>

                {!selectedTxDetail.isCancelled && !isCancelConfirmOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setTxCancelError(null);
                      setIsCancelConfirmOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Cancel / Reverse</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Supplier Modal */}
      {isAddSupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Add New Supplier / Wholesaler</h3>
              <button
                type="button"
                onClick={() => setIsAddSupModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supplier / Firm Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Laxmi Grains Wholesale"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contact Person
                </label>
                <input
                  type="text"
                  placeholder="e.g. Suresh Bhai"
                  value={newContactPerson}
                  onChange={(e) => setNewContactPerson(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9820011223"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Opening Payable Balance (Purana Bakaya INR)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={newOpenBal}
                  onChange={(e) => setNewOpenBal(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mandi Address / Market
                </label>
                <input
                  type="text"
                  placeholder="e.g. APMC Dana Bazar, Shop 42"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  GSTIN (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  value={newGstin}
                  onChange={(e) => setNewGstin(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Credit Terms
                  </label>
                  <input
                    type="text"
                    list="supplier-credit-terms-presets"
                    placeholder="e.g. Net 15 Days"
                    value={newCreditTerms}
                    onChange={(e) => setNewCreditTerms(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Preferred Payment Method
                  </label>
                  <select
                    value={newPreferredPaymentMethod}
                    onChange={(e) =>
                      setNewPreferredPaymentMethod(e.target.value as SupplierPreferredPaymentMethod)
                    }
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                  >
                    {(Object.keys(SUPPLIER_PAYMENT_METHOD_LABELS) as SupplierPreferredPaymentMethod[]).map(
                      (method) => (
                        <option key={method} value={method}>
                          {SUPPLIER_PAYMENT_METHOD_LABELS[method]}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddSupModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold"
                >
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {isTxModalOpen && selectedSupplier && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                {txType === 'PURCHASE'
                  ? 'Record Purchase Bill (Maal Aavak)'
                  : txType === 'RETURN'
                  ? 'Record Purchase Return (Maal Wapsi)'
                  : 'Pay Supplier (Bhugtan)'}
              </h3>
              <button
                type="button"
                onClick={() => setIsTxModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddTransaction} className="py-4 space-y-3">
              {txFormError && (
                <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{txFormError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supplier Name
                </label>
                <input
                  type="text"
                  disabled
                  value={selectedSupplier.name}
                  className="w-full text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-bold text-slate-700 dark:text-slate-200"
                />
              </div>

              {txType === 'RETURN' && (
                <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-purple-900 dark:text-purple-200 mb-1">
                      Returned Product (Optional — reduces inventory stock)
                    </label>
                    <select
                      value={txReturnProductId}
                      onChange={(e) => {
                        const pid = e.target.value;
                        setTxReturnProductId(pid);
                        const found = activeProducts.find((p) => p.id === pid);
                        setTxReturnUnit(found?.unit || '');
                        setTxFormError(null);
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

                  {txReturnProductId && (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-semibold text-purple-900 dark:text-purple-200 mb-1">
                          Return Quantity *
                        </label>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          placeholder="e.g. 2"
                          value={txReturnQty}
                          onChange={(e) => {
                            setTxReturnQty(e.target.value);
                            setTxFormError(null);
                          }}
                          className="w-full text-xs font-bold border border-purple-300 dark:border-purple-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-purple-900 dark:text-purple-200 mb-1">
                          Unit
                        </label>
                        <select
                          value={txReturnUnit || selectedReturnProduct?.unit || ''}
                          onChange={(e) => setTxReturnUnit(e.target.value)}
                          className="w-full text-xs font-bold border border-purple-300 dark:border-purple-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        >
                          {allowedReturnUnits.map((u) => (
                            <option key={u.unit} value={u.unit}>
                              {u.shortLabel}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Amount (INR) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 font-bold">
                    Rs.
                  </span>
                  <input
                    type="number"
                    step="any"
                    required
                    min="1"
                    placeholder="0"
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    className="w-full text-lg font-black pl-10 pr-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Bill / Invoice Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. BILL-8921"
                  value={txInvoiceNo}
                  onChange={(e) => setTxInvoiceNo(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              {txType === 'PURCHASE' ? (
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Payment Status
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'UNPAID', label: 'Full Udhar (Unpaid)' },
                          { id: 'PARTIAL', label: 'Partial Paid' },
                          { id: 'PAID', label: 'Fully Paid' },
                        ] as const
                      ).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            setTxPaymentStatus(st.id);
                            if (st.id !== 'PARTIAL') setTxPaidAmount('');
                            setTxFormError(null);
                          }}
                          className={`py-2 px-1 text-xs font-bold rounded-lg border text-center transition-colors cursor-pointer ${
                            txPaymentStatus === st.id
                              ? 'bg-blue-700 text-white border-blue-700'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {txPaymentStatus === 'PARTIAL' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                        Amount Paid Now (₹) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        required
                        placeholder="e.g. 2000"
                        value={txPaidAmount}
                        onChange={(e) => {
                          setTxPaidAmount(e.target.value);
                          setTxFormError(null);
                        }}
                        className="w-full text-sm font-bold p-2.5 border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg tabular-nums"
                      />
                      {Number(txAmount) > 0 && txPaidAmount !== '' && Number(txPaidAmount) >= 0 && Number(txPaidAmount) <= Number(txAmount) && (
                        <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mt-1 tabular-nums">
                          Remaining Payable Added: {formatINR(Math.round((Number(txAmount) - Number(txPaidAmount)) * 100) / 100)}
                        </div>
                      )}
                    </div>
                  )}

                  {(txPaymentStatus === 'PAID' || txPaymentStatus === 'PARTIAL') && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Payment Mode {txPaymentMethod === 'CASH' ? '(Deducts Counter Cashbook)' : '(Bank / UPI)'}
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['BANK', 'UPI', 'CASH'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setTxPaymentMethod(m)}
                            className={`py-2 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                              txPaymentMethod === m
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['BANK', 'UPI', 'CASH'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setTxPaymentMethod(m)}
                        className={`py-2 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                          txPaymentMethod === m
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description / Items Detail
                </label>
                <input
                  type="text"
                  placeholder={
                    txType === 'PURCHASE'
                      ? 'e.g. 20 Bags Basmati Rice, 10 Tins Oil'
                      : txType === 'RETURN'
                      ? 'e.g. Damaged stock returned to distributor'
                      : 'e.g. Payment for bill #8921 via NEFT'
                  }
                  value={txDescription}
                  onChange={(e) => setTxDescription(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <FileAttachment
                attachments={supAttachments}
                onChange={setSupAttachments}
                label="Wholesale Bill Photo or Payment Voucher"
              />

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsTxModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-white rounded-lg text-xs font-bold cursor-pointer ${
                    txType === 'PURCHASE'
                      ? 'bg-blue-700 hover:bg-blue-800'
                      : txType === 'RETURN'
                      ? 'bg-purple-700 hover:bg-purple-800'
                      : 'bg-emerald-700 hover:bg-emerald-800'
                  }`}
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Supplier Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Edit Supplier Details</h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Firm Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contact Person
                </label>
                <input
                  type="text"
                  value={editContact}
                  onChange={(e) => setEditContact(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Phone</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Address</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">GSTIN</label>
                <input
                  type="text"
                  value={editGstin}
                  onChange={(e) => setEditGstin(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Credit Terms
                  </label>
                  <input
                    type="text"
                    list="supplier-credit-terms-presets"
                    placeholder="e.g. Net 15 Days"
                    value={editCreditTerms}
                    onChange={(e) => setEditCreditTerms(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Preferred Payment Method
                  </label>
                  <select
                    value={editPreferredPaymentMethod}
                    onChange={(e) =>
                      setEditPreferredPaymentMethod(e.target.value as SupplierPreferredPaymentMethod)
                    }
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                  >
                    {(Object.keys(SUPPLIER_PAYMENT_METHOD_LABELS) as SupplierPreferredPaymentMethod[]).map(
                      (method) => (
                        <option key={method} value={method}>
                          {SUPPLIER_PAYMENT_METHOD_LABELS[method]}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold"
                >
                  Update Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <datalist id="supplier-credit-terms-presets">
        <option value="Cash on Delivery" />
        <option value="Net 7 Days" />
        <option value="Net 15 Days" />
        <option value="Net 30 Days" />
        <option value="Weekly Settlement" />
      </datalist>

      {/* Bulk CSV / PDF Supplier Import Modal */}
      <SupplierPdfImportModal
        isOpen={isPdfImportOpen}
        onClose={() => setIsPdfImportOpen(false)}
        existingSuppliers={suppliers}
        onImportRows={(rows, options) => importSuppliersBatch(rows, options)}
      />

      {/* Document Viewer Modal */}
      {viewingAttachment && (
        <BillViewerModal
          isOpen={!!viewingAttachment}
          onClose={() => setViewingAttachment(null)}
          attachment={viewingAttachment.attachment}
          title={viewingAttachment.title}
          details={viewingAttachment.details}
        />
      )}
    </div>
  );
};
