import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../context/StoreContext';
import { Customer, CustomerCategory, BillAttachment, CustomerLedgerEntry, LedgerDateRange } from '../types';
import {
  formatINR,
  calculateCustomerLedgerWithRunningBalance,
  calculateMonthlyCustomerStatement,
} from '../utils/accounting';
import { PaymentQrModal } from './PaymentQrModal';
import { FileAttachment } from './FileAttachment';
import { BillViewerModal } from './BillViewerModal';
import { CustomerDetailModal } from './CustomerDetailModal';
import { CustomerCameraCapture } from './CustomerCameraCapture';
import { CustomerPaymentHistoryChart } from './CustomerPaymentHistoryChart';
import { CustomerLoyaltyPanel } from './CustomerLoyaltyPanel';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  Users,
  Search,
  Plus,
  Phone,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  MessageCircle,
  Printer,
  Calendar,
  AlertTriangle,
  Receipt,
  Edit2,
  Trash2,
  X,
  FileText,
  QrCode,
  Paperclip,
  Eye,
  Download,
  Upload,
  MessageSquare,
  Ban,
  CheckCircle,
  Filter,
  Check,
  Camera,
  Award,
} from 'lucide-react';
import {
  exportCustomersToCSV,
  downloadCSVFile,
  downloadCustomerLedgerCSV,
  getSampleCustomerCSV,
} from '../utils/csv';
import {
  downloadCustomerUdharStatementPDF,
  downloadMonthlyCustomerStatementPDF,
} from '../utils/pdfGenerator';
import { getCustomerReminderHistory } from '../utils/whatsappTemplate';
import { getAllowedSellingUnits } from '../utils/units';
import {
  buildCustomerLoyaltyLedger,
  buildStoreLoyaltySummary,
  resolveLoyaltyConfig,
} from '../utils/loyalty';

export const CustomersView: React.FC = () => {
  const {
    customers,
    customerTransactions,
    sales,
    products,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    addCustomerTransaction,
    cancelCustomerTransaction,
    selectedCustomerId,
    setSelectedCustomerId,
    importCustomersFromCSV,
    profile,
    toggleCustomerWhatsAppConsent,
    whatsappBatches,
    whatsappAuditLogs,
  } = useStore();

  const [customersSectionTab, setCustomersSectionTab] = useState<'KHATA' | 'LOYALTY'>('KHATA');
  const [customerProfileTab, setCustomerProfileTab] = useState<'LEDGER' | 'REMINDERS'>('LEDGER');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | CustomerCategory>('ALL');

  // Ledger Filter State
  const [ledgerDateRange, setLedgerDateRange] = useState<LedgerDateRange>('ALL');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'ALL' | 'CREDIT' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT' | 'CANCELLED'>('ALL');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [monthlyStatementMonth, setMonthlyStatementMonth] = useState<string>(() =>
    new Date().toISOString().slice(0, 7)
  );

  // CSV Import/Export states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importSummary, setImportSummary] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  // Modals state
  const [isAddCustModalOpen, setIsAddCustModalOpen] = useState(false);
  const [isAddTxModalOpen, setIsAddTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<'CREDIT' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT'>('CREDIT');
  const [txAmount, setTxAmount] = useState('');
  const [txDescription, setTxDescription] = useState('');
  const [txInvoiceNo, setTxInvoiceNo] = useState('');
  const [txPaymentMethod, setTxPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [txAttachments, setTxAttachments] = useState<BillAttachment[]>([]);
  const [txReturnProductId, setTxReturnProductId] = useState('');
  const [txReturnQty, setTxReturnQty] = useState('');
  const [txReturnUnit, setTxReturnUnit] = useState('');
  const [txFormError, setTxFormError] = useState<string | null>(null);
  const [txIdempotencyKey, setTxIdempotencyKey] = useState(
    () => `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<{
    attachment: BillAttachment;
    title: string;
    details?: string;
  } | null>(null);
  const [detailModalCustomerId, setDetailModalCustomerId] = useState<string | null>(null);

  // Selected Transaction for Details Modal
  const [selectedTxDetail, setSelectedTxDetail] = useState<CustomerLedgerEntry | null>(null);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState('');

  // Add customer form fields
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustOpenBal, setNewCustOpenBal] = useState('');
  const [newCustNotes, setNewCustNotes] = useState('');
  const [newCustPhoto, setNewCustPhoto] = useState<string | undefined>(undefined);

  // Edit customer modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  useTrackActiveTransaction(
    'customers-modal',
    isAddCustModalOpen || isAddTxModalOpen || isEditModalOpen || isCancelConfirmOpen
  );
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPhoto, setEditPhoto] = useState<string | undefined>(undefined);

  // Filter customers list on the left
  const filteredCustomers = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery);

    if (!matchesSearch) return false;
    if (selectedFilter === 'ALL') return true;
    return c.category === selectedFilter;
  });

  const totalUdhar = customers.reduce((sum, c) => sum + Math.max(0, c.currentBalance), 0);
  const totalOverdueCount = customers.filter((c) => c.category === 'OVERDUE').length;

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const loyaltyConfig = useMemo(() => resolveLoyaltyConfig(profile), [profile]);
  const storeLoyaltySummary = useMemo(
    () => buildStoreLoyaltySummary(customers, sales, loyaltyConfig),
    [customers, sales, loyaltyConfig]
  );
  const selectedCustomerLoyalty = useMemo(() => {
    if (!selectedCustomer) return null;
    return buildCustomerLoyaltyLedger(selectedCustomer, sales, loyaltyConfig);
  }, [selectedCustomer, sales, loyaltyConfig]);
  const detailCustomer = useMemo(
    () => customers.find((c) => c.id === detailModalCustomerId) || null,
    [customers, detailModalCustomerId]
  );

  // Calculate detailed chronological ledger with running balance & filters
  const ledgerSummary = useMemo(() => {
    if (!selectedCustomer) return null;
    return calculateCustomerLedgerWithRunningBalance(
      selectedCustomer,
      customerTransactions,
      {
        dateRange: ledgerDateRange,
        customStartDate: customStartDate || undefined,
        customEndDate: customEndDate || undefined,
        typeFilter: ledgerTypeFilter,
        searchQuery: ledgerSearch,
      }
    );
  }, [
    selectedCustomer,
    customerTransactions,
    ledgerDateRange,
    customStartDate,
    customEndDate,
    ledgerTypeFilter,
    ledgerSearch,
  ]);

  const monthlyStatementPreview = useMemo(() => {
    if (!selectedCustomer) return null;
    return calculateMonthlyCustomerStatement(
      selectedCustomer,
      customerTransactions,
      monthlyStatementMonth
    );
  }, [selectedCustomer, customerTransactions, monthlyStatementMonth]);

  const customerReminderHistory = useMemo(() => {
    if (!selectedCustomerId || !whatsappBatches) return [];
    const history: Array<{
      batchId: string;
      date: string;
      status: string;
      amount: number;
      invoices: string[];
      wabaMessageId?: string;
    }> = [];

    whatsappBatches.forEach((batch) => {
      const match = batch.items.find((item) => item.customerId === selectedCustomerId);
      if (match) {
        history.push({
          batchId: batch.id,
          date: match.sentAt || batch.createdAt,
          status: match.status,
          amount: match.totalOutstanding,
          invoices: match.invoices.map((i) => i.invoiceNo),
          wabaMessageId: match.wabaMessageId,
        });
      }
    });

    return history;
  }, [selectedCustomerId, whatsappBatches]);

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) {
      alert('Please enter customer name');
      return;
    }
    const id = addCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim() || 'No phone',
      address: newCustAddress.trim() || undefined,
      openingBalance: Number(newCustOpenBal) || 0,
      notes: newCustNotes.trim() || undefined,
      photoDataUrl: newCustPhoto,
    });
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustOpenBal('');
    setNewCustNotes('');
    setNewCustPhoto(undefined);
    setIsAddCustModalOpen(false);
    setSelectedCustomerId(id);
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

  const openCustomerTxModal = (type: 'CREDIT' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT') => {
    setTxType(type);
    setTxAmount('');
    setTxDescription('');
    setTxInvoiceNo('');
    setTxAttachments([]);
    setTxReturnProductId('');
    setTxReturnQty('');
    setTxReturnUnit('');
    setTxFormError(null);
    setTxIdempotencyKey(`ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsAddTxModalOpen(true);
  };

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    setTxFormError(null);
    if (!selectedCustomerId || Number(txAmount) <= 0) {
      setTxFormError('Please enter a valid amount greater than 0.');
      return;
    }
    if (
      txType === 'RETURN' &&
      txReturnProductId &&
      (!Number.isFinite(Number(txReturnQty)) || Number(txReturnQty) <= 0)
    ) {
      setTxFormError('Please enter a valid return quantity greater than 0 for the selected product.');
      return;
    }

    const res = addCustomerTransaction({
      customerId: selectedCustomerId,
      type: txType,
      amount: Number(txAmount),
      description:
        txDescription.trim() ||
        (txType === 'CREDIT'
          ? 'Kirana Udhar Bill'
          : txType === 'PAYMENT'
          ? 'Payment Received (Jama)'
          : txType === 'RETURN'
          ? 'Sales Return Adjustment'
          : 'Balance Adjustment'),
      invoiceNo: txInvoiceNo.trim() || undefined,
      paymentMethod: txType === 'PAYMENT' ? txPaymentMethod : undefined,
      attachments: txAttachments.length > 0 ? txAttachments : undefined,
      productId: txType === 'RETURN' && txReturnProductId ? txReturnProductId : undefined,
      quantity: txType === 'RETURN' && txReturnProductId ? Number(txReturnQty) : undefined,
      unit:
        txType === 'RETURN' && txReturnProductId
          ? txReturnUnit || selectedReturnProduct?.unit
          : undefined,
      idempotencyKey: txIdempotencyKey,
    });

    if (!res.success) {
      setTxFormError(res.error || 'Unable to save transaction.');
      return;
    }

    setTxAmount('');
    setTxDescription('');
    setTxInvoiceNo('');
    setTxAttachments([]);
    setTxReturnProductId('');
    setTxReturnQty('');
    setTxReturnUnit('');
    setTxFormError(null);
    setTxIdempotencyKey(`ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsAddTxModalOpen(false);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditName(c.name);
    setEditPhone(c.phone);
    setEditAddress(c.address || '');
    setEditNotes(c.notes || '');
    setEditPhoto(c.photoDataUrl);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) return;
    updateCustomer(selectedCustomerId, {
      name: editName.trim(),
      phone: editPhone.trim(),
      address: editAddress.trim() || undefined,
      notes: editNotes.trim() || undefined,
      photoDataUrl: editPhoto,
    });
    setIsEditModalOpen(false);
  };

  const handleDelete = () => {
    if (!selectedCustomer) return;
    const confirmText = prompt(
      `Delete customer "${selectedCustomer.name}"? Enter reason to confirm (this will be recorded in audit log):`
    );
    if (confirmText) {
      deleteCustomer(selectedCustomer.id, confirmText);
      setSelectedCustomerId(null);
    }
  };

  const handleCancelSelectedTx = () => {
    if (!selectedTxDetail || !cancelReasonInput.trim()) {
      alert('Please enter a cancellation reason');
      return;
    }
    const success = cancelCustomerTransaction(selectedTxDetail.id, cancelReasonInput.trim());
    if (success) {
      setIsCancelConfirmOpen(false);
      setCancelReasonInput('');
      setSelectedTxDetail(null);
    } else {
      alert('Unable to cancel transaction. It may already be cancelled.');
    }
  };

  const getWhatsAppReminderUrl = (customer: Customer) => {
    const rawPhone = customer.phone.replace(/[^0-9]/g, '');
    const phone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    const dueAmt = formatINR(customer.currentBalance);
    const store = profile.storeName || 'Arjun Groceries';
    const upi = profile.upiId ? ` via UPI (${profile.upiId})` : '';
    const text = encodeURIComponent(
      `Namaste ${customer.name} ji, aapka ${store} par kul baki udhar ${dueAmt} hai. Kripya samay par bhugtan karein${upi}. Dhanyawad!`
    );
    return `https://wa.me/${phone}?text=${text}`;
  };

  const handleExportCSV = () => {
    const csv = exportCustomersToCSV(customers);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSVFile(`arjun_groceries_customers_${dateStr}.csv`, csv);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        const summary = importCustomersFromCSV(text);
        setImportSummary(summary);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadSample = () => {
    const sample = getSampleCustomerCSV();
    downloadCSVFile('sample_customers_template.csv', sample);
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
            Total Udhar (Dues)
          </div>
          <div className="text-xl sm:text-2xl font-black text-red-600 dark:text-rose-400 mt-1">
            {formatINR(totalUdhar)}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Across all customer accounts</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Customers
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
            {customers.length}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Active ledger khata books</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Overdue Customers
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {totalOverdueCount}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Pending &gt; 30 days</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Data Migration
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 py-1.5 px-2 rounded-lg cursor-pointer"
              title="Export all customers to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 py-1.5 px-2 rounded-lg cursor-pointer border border-emerald-200 dark:border-emerald-800"
              title="Import customers from CSV"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import CSV</span>
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

      {/* CSV Import Feedback Message */}
      {importSummary && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
          <div>
            <span className="font-bold">CSV Import Finished:</span> Imported {importSummary.imported} customers ({importSummary.skipped} skipped).
            {importSummary.errors.length > 0 && (
              <span className="text-red-700 dark:text-rose-400 ml-2">Errors: {importSummary.errors.join('; ')}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadSample}
              className="underline text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 text-[11px]"
            >
              Download Sample CSV
            </button>
            <button
              type="button"
              onClick={() => setImportSummary(null)}
              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-900 font-bold ml-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Customers Module Sub-Tabs: Khata Ledger vs Loyalty Points */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCustomersSectionTab('KHATA')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              customersSectionTab === 'KHATA'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Khata Ledger ({customers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setCustomersSectionTab('LOYALTY')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              customersSectionTab === 'LOYALTY'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>
              Loyalty Points ({storeLoyaltySummary.totalAvailablePoints} pts)
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsAddCustModalOpen(true)}
          className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Customer</span>
        </button>
      </div>

      {customersSectionTab === 'LOYALTY' ? (
        <CustomerLoyaltyPanel
          onOpenCustomerKhata={(customerId) => {
            setSelectedCustomerId(customerId);
            setCustomersSectionTab('KHATA');
          }}
        />
      ) : (
      /* Main Dual-Column Khata Layout */
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Customers Directory (5 cols on desktop) */}
        <div className={`lg:col-span-5 ${selectedCustomerId ? 'hidden lg:block' : 'block'}`}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
            {/* Search & Actions Bar */}
            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>Customer Directory</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsAddCustModalOpen(true)}
                  className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Customer</span>
                </button>
              </div>

              {/* Search Field */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search customer name or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:bg-white dark:focus:bg-slate-800 focus:outline-emerald-600 transition-colors"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px]">
                {(['ALL', 'HIGH_CREDIT', 'OVERDUE', 'REGULAR', 'CLEARED'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedFilter(cat)}
                    className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-colors cursor-pointer ${
                      selectedFilter === cat
                        ? 'bg-emerald-800 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {cat === 'ALL'
                      ? 'All'
                      : cat === 'HIGH_CREDIT'
                      ? 'High Udhar'
                      : cat === 'OVERDUE'
                      ? 'Overdue'
                      : cat === 'REGULAR'
                      ? 'Regular'
                      : 'Cleared'}
                  </button>
                ))}
              </div>
            </div>

            {/* Customers List */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[620px] overflow-y-auto">
              {filteredCustomers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No customers found matching &quot;{searchQuery}&quot;.
                </div>
              ) : (
                filteredCustomers.map((c) => {
                  const isSelected = c.id === selectedCustomerId;
                  const hasDue = c.currentBalance > 0;
                  const isAdv = c.currentBalance < 0;

                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCustomerId(c.id)}
                      className={`p-3.5 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-l-4 border-emerald-700'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          {c.photoDataUrl ? (
                            <img
                              src={c.photoDataUrl}
                              alt={`${c.name} photo`}
                              className="w-9 h-9 rounded-full object-cover border border-emerald-200 dark:border-emerald-800 shrink-0 mt-0.5"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 border border-emerald-200/70 dark:border-emerald-800/60">
                              {c.name.trim().slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                                {c.name}
                              </span>
                              {c.category === 'OVERDUE' && (
                                <span className="text-[9px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-1.5 py-0.2 rounded">
                                  Overdue
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              <span className="flex items-center gap-0.5">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {c.phone}
                              </span>
                              {c.address && <span className="truncate">· {c.address}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div
                            className={`font-black text-xs sm:text-sm ${
                              hasDue
                                ? 'text-red-600 dark:text-rose-400'
                                : isAdv
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {hasDue
                              ? formatINR(c.currentBalance)
                              : isAdv
                              ? `Advance: ${formatINR(Math.abs(c.currentBalance))}`
                              : 'Rs. 0 (Cleared)'}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {hasDue ? 'Udhar Pending' : isAdv ? 'Advance Jama' : 'Hisab Nil'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100/80 dark:border-slate-800 pt-1.5">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>
                            {c.overdueDays > 0 ? `${c.overdueDays} days pending` : 'Active'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                            {c.totalCreditGiven > 0 ? `Total Udhar: ${formatINR(c.totalCreditGiven)}` : 'Fresh Account'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCustomerId(c.id);
                              setDetailModalCustomerId(c.id);
                            }}
                            aria-label={`Full Details for ${c.name}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Full Details</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Customer Detailed Ledger View (7 cols on desktop) */}
        <div className={`lg:col-span-7 ${!selectedCustomerId ? 'hidden lg:block' : 'block'}`}>
          {selectedCustomer && ledgerSummary ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
              {/* Back to list button for mobile */}
              <div className="lg:hidden p-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId(null)}
                  className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  &larr; Back to all customers
                </button>
              </div>

              {/* Customer Ledger Header Banner */}
              <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-emerald-950 to-emerald-900 text-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(selectedCustomer)}
                      title="Take or update customer photo"
                      aria-label={`Update photo for ${selectedCustomer.name}`}
                      className="relative group w-12 h-12 rounded-full bg-emerald-800 border-2 border-emerald-400/50 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      {selectedCustomer.photoDataUrl ? (
                        <img
                          src={selectedCustomer.photoDataUrl}
                          alt={`${selectedCustomer.name} avatar`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-black text-emerald-100">
                          {selectedCustomer.name.trim().slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Camera className="w-4 h-4 text-white" />
                      </span>
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg sm:text-xl font-black truncate">{selectedCustomer.name}</h3>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            ledgerSummary.status === 'CLEARED'
                              ? 'bg-emerald-800 text-emerald-200'
                              : ledgerSummary.status === 'ADVANCE'
                              ? 'bg-teal-800 text-teal-200'
                              : 'bg-red-900/80 text-red-200'
                          }`}
                        >
                          {ledgerSummary.status}
                        </span>
                      </div>
                      <div className="text-xs text-emerald-200/80 mt-1 flex flex-wrap items-center gap-3">
                        <span>Phone: {selectedCustomer.phone}</span>
                        {selectedCustomer.address && <span>Address: {selectedCustomer.address}</span>}
                        {selectedCustomerLoyalty && (
                          <button
                            type="button"
                            onClick={() => setCustomersSectionTab('LOYALTY')}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-800/90 hover:bg-emerald-700 text-emerald-100 font-bold text-[11px] cursor-pointer"
                            title="View Loyalty Points Tracking"
                          >
                            <Award className="w-3 h-3 text-amber-300" />
                            <span>
                              {selectedCustomerLoyalty.availablePoints} pts (
                              {formatINR(selectedCustomerLoyalty.redeemableValueRs)})
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Header Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailModalCustomerId(selectedCustomer.id)}
                      title="Open Complete Customer Profile & Transaction History"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Full Details</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadCustomerUdharStatementPDF(
                          selectedCustomer,
                          ledgerSummary,
                          profile
                        )
                      }
                      title="Download PDF Ledger Statement"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-900 rounded-lg text-xs font-bold transition-colors shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-700" />
                      <span>PDF Ledger</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadCustomerLedgerCSV(selectedCustomer, ledgerSummary)}
                      title="Export Customer Ledger CSV"
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>CSV</span>
                    </button>

                    {ledgerSummary.closingBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsQrModalOpen(true)}
                        title="Generate UPI QR for Payment"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5 text-slate-900" />
                        <span>QR Code</span>
                      </button>
                    )}

                    <a
                      href={getWhatsAppReminderUrl(selectedCustomer)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-lg text-xs font-bold transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(selectedCustomer)}
                      title="Edit Customer Details"
                      className="p-1.5 rounded-lg bg-emerald-800/80 hover:bg-emerald-700 text-emerald-200 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={handleDelete}
                      title="Delete Customer Account"
                      className="p-1.5 rounded-lg bg-emerald-800/80 hover:bg-red-700 text-emerald-200 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-emerald-800/80 text-center">
                  <div className="p-2 bg-emerald-900/60 rounded-xl">
                    <div className="text-[10px] text-emerald-300 uppercase font-bold">Total Credit Given</div>
                    <div className="text-sm sm:text-base font-extrabold mt-0.5 text-white">
                      {formatINR(ledgerSummary.totalCreditGiven)}
                    </div>
                  </div>
                  <div className="p-2 bg-emerald-900/60 rounded-xl">
                    <div className="text-[10px] text-emerald-300 uppercase font-bold">Total Received</div>
                    <div className="text-sm sm:text-base font-extrabold text-emerald-300 mt-0.5">
                      {formatINR(ledgerSummary.totalPaymentReceived)}
                    </div>
                  </div>
                  <div className="p-2 bg-emerald-900/60 rounded-xl">
                    <div className="text-[10px] text-emerald-300 uppercase font-bold">Outstanding Balance</div>
                    <div
                      className={`text-sm sm:text-base font-black mt-0.5 ${
                        ledgerSummary.closingBalance > 0
                          ? 'text-red-300'
                          : ledgerSummary.closingBalance < 0
                          ? 'text-teal-300'
                          : 'text-emerald-300'
                      }`}
                    >
                      {ledgerSummary.closingBalance < 0
                        ? `Advance: ${formatINR(Math.abs(ledgerSummary.closingBalance))}`
                        : formatINR(ledgerSummary.closingBalance)}
                    </div>
                  </div>
                  <div className="p-2 bg-emerald-900/60 rounded-xl">
                    <div className="text-[10px] text-emerald-300 uppercase font-bold">Activity Dates</div>
                    <div className="text-[11px] font-semibold text-emerald-100 mt-1 truncate">
                      {ledgerSummary.lastTransactionDate
                        ? `Last: ${formatDateTime(ledgerSummary.lastTransactionDate).split(',')[0]}`
                        : 'No activity'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Monthly Statement PDF Bar */}
              {monthlyStatementPreview && (
                <div className="px-4 py-2.5 bg-emerald-50/70 dark:bg-emerald-950/40 border-b border-emerald-100 dark:border-emerald-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="text-xs text-slate-700 dark:text-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Monthly Statement ({monthlyStatementPreview.monthLabel}):</span>
                    </span>
                    <span className="tabular-nums">
                      Opening: <strong>{formatINR(monthlyStatementPreview.openingBalanceForMonth)}</strong>
                    </span>
                    <span className="tabular-nums text-red-700 dark:text-red-300">
                      +Credit: <strong>{formatINR(monthlyStatementPreview.totalMonthlyDebit)}</strong>
                    </span>
                    <span className="tabular-nums text-emerald-700 dark:text-emerald-300">
                      -Paid: <strong>{formatINR(monthlyStatementPreview.totalMonthlyCredit)}</strong>
                    </span>
                    <span className="tabular-nums">
                      Closing: <strong>{formatINR(monthlyStatementPreview.closingBalanceForMonth)}</strong> ({monthlyStatementPreview.entriesInMonth.length} entries)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="month"
                      aria-label="Statement Month"
                      value={monthlyStatementMonth}
                      onChange={(e) => setMonthlyStatementMonth(e.target.value)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        downloadMonthlyCustomerStatementPDF(
                          selectedCustomer,
                          customerTransactions,
                          profile,
                          monthlyStatementMonth
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-2xs cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Monthly PDF</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons: Add Udhar, Receive Payment, Sales Return */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => openCustomerTxModal('CREDIT')}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2.5 px-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-2xs cursor-pointer transition-colors"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Give Credit (Udhar Diya)</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCustomerTxModal('PAYMENT')}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white rounded-xl text-xs sm:text-sm font-bold shadow-2xs cursor-pointer transition-colors"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>Receive Payment (Jama Liya)</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCustomerTxModal('RETURN')}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-purple-700 hover:bg-purple-800 active:bg-purple-900 text-white rounded-xl text-xs sm:text-sm font-bold shadow-2xs cursor-pointer transition-colors"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>Sales Return</span>
                </button>
              </div>

              {/* 6-Month Payment & Credit History Mini-Bar Chart */}
              <CustomerPaymentHistoryChart
                customer={selectedCustomer}
                transactions={customerTransactions}
              />

              {/* WhatsApp Reminder History & Preference Card */}
              <div className="p-3.5 bg-emerald-50/50 dark:bg-emerald-950/30 border-b border-emerald-100 dark:border-emerald-900/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 rounded-lg">
                      <MessageSquare className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        WhatsApp Reminders & Customer Consent
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {selectedCustomer.lastReminderSentAt
                          ? `Last reminded on ${new Date(selectedCustomer.lastReminderSentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} (${selectedCustomer.reminderCount || 1} reminders sent)`
                          : 'No automated reminders sent yet'}
                      </div>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer bg-white dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
                    <input
                      type="checkbox"
                      checked={selectedCustomer.whatsappConsent !== false}
                      onChange={() =>
                        toggleCustomerWhatsAppConsent(
                          selectedCustomer.id,
                          selectedCustomer.whatsappConsent === false
                        )
                      }
                      className="w-4 h-4 text-emerald-700 rounded border-slate-300 dark:border-slate-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 select-none">
                      Allow WhatsApp payment reminders
                    </span>
                    {selectedCustomer.whatsappConsent !== false ? (
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.2 rounded">
                        Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.2 rounded">
                        Opted Out
                      </span>
                    )}
                  </label>
                </div>
              </div>

              {/* Customer Profile Sub-Tabs: Transaction Ledger vs Reminder History */}
              {(() => {
                const customerReminders = getCustomerReminderHistory(
                  selectedCustomer.id,
                  whatsappBatches,
                  whatsappAuditLogs
                );
                return (
                  <>
                    <div className="px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCustomerProfileTab('LEDGER')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                          customerProfileTab === 'LEDGER'
                            ? 'bg-emerald-700 text-white shadow-2xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        Transaction Ledger ({ledgerSummary.totalEntriesCount ?? ledgerSummary.entries.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomerProfileTab('REMINDERS')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                          customerProfileTab === 'REMINDERS'
                            ? 'bg-emerald-700 text-white shadow-2xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Reminder History ({customerReminders.length})</span>
                      </button>
                    </div>

                    {customerProfileTab === 'REMINDERS' && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                          <div>
                            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                              WhatsApp Payment Reminder History
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Chronological log of automated &amp; batch reminders sent to {selectedCustomer.name}, including balance snapshot at the time of each reminder.
                            </p>
                          </div>
                        </div>

                        {customerReminders.length === 0 ? (
                          <div className="p-8 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                            No WhatsApp reminders have been sent to {selectedCustomer.name} yet.
                          </div>
                        ) : (
                          <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                            {customerReminders.map((rem) => (
                              <div
                                key={rem.id}
                                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                        rem.status === 'DELIVERED' || rem.status === 'READ'
                                          ? 'bg-emerald-700 text-white'
                                          : rem.status === 'SENT' || rem.status === 'ACCEPTED'
                                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                                          : rem.status === 'FAILED'
                                          ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                                          : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                                      }`}
                                    >
                                      {rem.status}
                                    </span>
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                      {new Date(rem.sentAt).toLocaleString('en-IN', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                    {rem.sandboxSimulated && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
                                        Sandbox
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-right">
                                    <div className="text-[10px] uppercase font-bold text-slate-400">
                                      Balance at Reminder Time
                                    </div>
                                    <div className="text-sm font-black text-red-600 dark:text-rose-400">
                                      {formatINR(rem.outstandingAtTime)}
                                    </div>
                                  </div>
                                </div>

                                {rem.invoiceNumbers.length > 0 && (
                                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                    <strong>Bills Covered ({rem.invoicesCount}):</strong>{' '}
                                    {rem.invoiceNumbers.join(', ')}
                                  </div>
                                )}

                                <pre className="whitespace-pre-wrap font-sans text-xs bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 leading-relaxed">
                                  {rem.messageText}
                                </pre>

                                <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 font-mono">
                                  <span>Batch: {rem.batchId}</span>
                                  {rem.wabaMessageId && <span>WABA ID: {rem.wabaMessageId}</span>}
                                </div>
                                {rem.errorReason && (
                                  <div className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                                    Error: {rem.errorReason}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}

              {customerProfileTab === 'LEDGER' && (
                <>
              {/* Comprehensive Filter Bar */}
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

                  {/* Type Filter Dropdown / Pills */}
                  <div className="flex items-center gap-1 text-[11px] flex-wrap">
                    <span className="text-slate-400 dark:text-slate-500 font-semibold mr-1">Type:</span>
                    {(
                      [
                        { id: 'ALL', label: 'All' },
                        { id: 'CREDIT', label: 'Credit (Udhar)' },
                        { id: 'PAYMENT', label: 'Payment (Jama)' },
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
                            ? 'bg-emerald-700 text-white'
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
                      className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-xs"
                    />
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">To:</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-xs"
                    />
                  </div>
                )}

                {/* Search Bar for transactions */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by Bill / Invoice #, Transaction ID, or note..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-emerald-600"
                  />
                </div>
              </div>

              {/* Transactions Ledger Table */}
              <div className="p-4">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                      Transaction Ledger History
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
                    <span>Print Ledger</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-[460px] overflow-y-auto">
                  {/* Opening Balance Row if present */}
                  {ledgerSummary.openingBalance > 0 && (
                    <div className="flex items-center justify-between p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-[11px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                          START
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                            Opening Balance Carryforward (Khata Start)
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Initial balance before digital ledger setup
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
                      No transactions match the selected filters. Use the buttons above to record credit or payment.
                    </div>
                  ) : (
                    ledgerSummary.entries.map((entry) => {
                      const isCredit = entry.type === 'CREDIT';
                      const isReturn = entry.type === 'RETURN';
                      const isCancelled = entry.isCancelled;

                      return (
                        <div
                          key={entry.id}
                          onClick={() => setSelectedTxDetail(entry)}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                            isCancelled
                              ? 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 opacity-70 hover:opacity-100'
                              : isCredit
                              ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-red-200 dark:hover:border-rose-800 hover:shadow-2xs'
                              : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-2xs'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
                                isCancelled
                                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                  : isCredit
                                  ? 'bg-red-50 dark:bg-rose-950/60 text-red-600 dark:text-rose-400 border border-red-200 dark:border-rose-800'
                                  : isReturn
                                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                              }`}
                            >
                              {isCancelled ? 'RADD' : isCredit ? 'UDHAR' : isReturn ? 'WAPSI' : 'JAMA'}
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
                                {entry.attachments && entry.attachments.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewingAttachment({
                                        attachment: entry.attachments![0],
                                        title: `${selectedCustomer.name} - ${isCredit ? 'Udhar Bill' : 'Payment Receipt'}`,
                                        details: `Date: ${formatDateTime(entry.date)} · Amount: ${formatINR(entry.amount)} · ${entry.description}`,
                                      });
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                                  >
                                    <Paperclip className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
                                    <span>
                                      {entry.attachments.length} {entry.attachments.length === 1 ? 'Bill' : 'Bills'}
                                    </span>
                                    <Eye className="w-3 h-3 text-emerald-600 dark:text-emerald-400 ml-0.5" />
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
                                  : isCredit
                                  ? 'text-red-600 dark:text-rose-400'
                                  : isReturn
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {isCancelled
                                ? formatINR(entry.amount)
                                : isCredit
                                ? `+ ${formatINR(entry.amount)}`
                                : `- ${formatINR(entry.amount)}`}
                            </div>
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
                </>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <Users className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-base">Select a Customer</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                Choose any customer from the list on the left to view their complete digital ledger, running balance history, or download PDF/CSV statements.
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Transaction Details Modal */}
      {selectedTxDetail && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Transaction Details</h3>
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
              {/* Type & Status Banner */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between ${
                  selectedTxDetail.isCancelled
                    ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    : selectedTxDetail.type === 'CREDIT'
                    ? 'bg-red-50 dark:bg-rose-950/40 border-red-200 dark:border-rose-800 text-red-900 dark:text-rose-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                }`}
              >
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">
                    {selectedTxDetail.type === 'CREDIT'
                      ? 'Credit Sale (Udhar Diya)'
                      : selectedTxDetail.type === 'PAYMENT'
                      ? 'Payment Received (Jama Liya)'
                      : selectedTxDetail.type === 'RETURN'
                      ? 'Sales Return Adjustment'
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
                        : 'bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200'
                    }`}
                  >
                    {selectedTxDetail.status || 'COMPLETED'}
                  </span>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Via {selectedTxDetail.paymentMethod || 'CASH'}
                  </div>
                </div>
              </div>

              {/* Balance Progression Box */}
              <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold">Previous Bal</div>
                  <div className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                    {formatINR(selectedTxDetail.previousBalance)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold">Tx Amount</div>
                  <div
                    className={`text-xs sm:text-sm font-black mt-0.5 ${
                      selectedTxDetail.type === 'CREDIT' ? 'text-red-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {selectedTxDetail.type === 'CREDIT' ? '+' : '-'} {formatINR(selectedTxDetail.amount)}
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
                  <span className="text-slate-500 dark:text-slate-400">Customer Name:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedCustomer.name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Date & Exact Time:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatDateTime(selectedTxDetail.date)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Bill / Invoice No:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {selectedTxDetail.invoiceNo || 'N/A (Direct Ledger)'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Description / Note:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-right max-w-xs">
                    {selectedTxDetail.description}
                  </span>
                </div>

                {selectedTxDetail.isCancelled && (
                  <div className="p-2.5 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-800 rounded-lg text-red-900 dark:text-rose-200 space-y-1">
                    <div className="font-bold flex items-center gap-1">
                      <Ban className="w-3.5 h-3.5 text-red-600 dark:text-rose-400" />
                      <span>Cancelled Transaction (Audit Record)</span>
                    </div>
                    <div className="text-[11px]">
                      Reason: {selectedTxDetail.cancelReason || 'No reason provided'}
                    </div>
                    {selectedTxDetail.cancelledAt && (
                      <div className="text-[10px] text-red-700 dark:text-rose-300">
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
                    Attached Bill / Receipt Photos ({selectedTxDetail.attachments.length})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedTxDetail.attachments.map((att, idx) => (
                      <div
                        key={idx}
                        onClick={() =>
                          setViewingAttachment({
                            attachment: att,
                            title: `${selectedCustomer.name} - Bill #${selectedTxDetail.invoiceNo || idx + 1}`,
                            details: `Date: ${formatDateTime(selectedTxDetail.date)} · Amount: ${formatINR(selectedTxDetail.amount)}`,
                          })
                        }
                        className="p-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer flex items-center gap-2"
                      >
                        <Paperclip className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                        <span className="text-xs font-semibold truncate text-slate-800 dark:text-slate-200">
                          {att.name || `Bill Document ${idx + 1}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cancellation Form */}
              {!selectedTxDetail.isCancelled && isCancelConfirmOpen && (
                <div className="p-3.5 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-800 rounded-xl space-y-2">
                  <div className="text-xs font-bold text-red-900 dark:text-rose-200">
                    Confirm Transaction Cancellation / Reversal
                  </div>
                  <p className="text-[11px] text-red-700 dark:text-rose-300">
                    This transaction will be marked as Cancelled. It will remain visible in the ledger for full audit compliance, and the customer&apos;s active balance will update immediately.
                  </p>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Reason for cancellation *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Cheque bounced / Wrong entry entered"
                      value={cancelReasonInput}
                      onChange={(e) => setCancelReasonInput(e.target.value)}
                      className="w-full text-xs p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-red-300 dark:border-rose-700 rounded-lg focus:outline-red-600"
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
                      onClick={() => setIsCancelConfirmOpen(false)}
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
                    onClick={() => setIsCancelConfirmOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-red-50 dark:bg-rose-950/60 hover:bg-red-100 dark:hover:bg-rose-900/60 text-red-700 dark:text-rose-300 border border-red-200 dark:border-rose-800 rounded-xl text-xs font-bold cursor-pointer"
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

      {/* Add New Customer Modal */}
      {isAddCustModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Add New Customer (Naya Grahak)</h3>
              <button
                type="button"
                onClick={() => setIsAddCustModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Customer Photo (Optional Identification)
                </label>
                <CustomerCameraCapture
                  value={newCustPhoto}
                  customerName={newCustName}
                  onChange={setNewCustPhoto}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Customer Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Bhai Patel"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mobile Number (10 digits for WhatsApp)
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Opening Udhar Balance (Purana Bakaya INR)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={newCustOpenBal}
                  onChange={(e) => setNewCustOpenBal(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Address / Landmark
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shop 4, Station Road"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Notes / Remark
                </label>
                <textarea
                  placeholder="e.g. Monthly ration customer, salary day 5th"
                  rows={2}
                  value={newCustNotes}
                  onChange={(e) => setNewCustNotes(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddCustModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Transaction Modal (Give Credit, Receive Payment, or Sales Return) */}
      {isAddTxModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                {txType === 'CREDIT'
                  ? 'Give Credit (Udhar Diya)'
                  : txType === 'RETURN'
                  ? 'Record Sales Return (Maal Wapsi)'
                  : 'Receive Payment (Jama Liya)'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddTxModalOpen(false)}
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
                  Customer Name
                </label>
                <input
                  type="text"
                  disabled
                  value={selectedCustomer.name}
                  className="w-full text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-bold text-slate-700 dark:text-slate-200"
                />
              </div>

              {txType === 'RETURN' && (
                <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-purple-900 dark:text-purple-200 mb-1">
                      Returned Product (Optional — restores inventory stock)
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
                      <option value="">-- Credit note only (no inventory SKU) --</option>
                      {activeProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (Stock: {p.stockQty} {p.unit})
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
                          placeholder="e.g. 1"
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
                  Invoice / Bill Number (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-1042"
                  value={txInvoiceNo}
                  onChange={(e) => setTxInvoiceNo(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              {txType === 'PAYMENT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['CASH', 'UPI', 'BANK'] as const).map((m) => (
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
                    txType === 'CREDIT'
                      ? 'e.g. 5kg Atta, 2L Oil, Sugar'
                      : txType === 'RETURN'
                      ? 'e.g. Unopened rice bag returned'
                      : 'e.g. Weekly settlement via GPay'
                  }
                  value={txDescription}
                  onChange={(e) => setTxDescription(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <FileAttachment
                attachments={txAttachments}
                onChange={setTxAttachments}
                label="Bill Photo or Payment Receipt"
              />

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddTxModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-white rounded-lg text-xs font-bold cursor-pointer ${
                    txType === 'CREDIT'
                      ? 'bg-red-600 hover:bg-red-700'
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

      {/* Edit Customer Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Edit Customer Info</h3>
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Customer Photo
                </label>
                <CustomerCameraCapture
                  value={editPhoto}
                  customerName={editName}
                  onChange={setEditPhoto}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold"
                >
                  Update Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment QR Modal */}
      {isQrModalOpen && selectedCustomer && (
        <PaymentQrModal
          customer={selectedCustomer}
          isOpen={isQrModalOpen}
          onClose={() => setIsQrModalOpen(false)}
          defaultAmount={selectedCustomer.currentBalance}
        />
      )}

      {/* Bill Viewer Modal */}
      {viewingAttachment && (
        <BillViewerModal
          isOpen={!!viewingAttachment}
          onClose={() => setViewingAttachment(null)}
          attachment={viewingAttachment.attachment}
          title={viewingAttachment.title}
          details={viewingAttachment.details}
        />
      )}

      {/* Detailed Customer History & Udhar Modal */}
      {detailCustomer && (
        <CustomerDetailModal
          customer={detailCustomer}
          customerTransactions={customerTransactions}
          profile={profile}
          isOpen={!!detailCustomer}
          onClose={() => setDetailModalCustomerId(null)}
          onInspectAttachment={setViewingAttachment}
          onQuickRecordTransaction={(type) => {
            setSelectedCustomerId(detailCustomer.id);
            setDetailModalCustomerId(null);
            openCustomerTxModal(type);
          }}
        />
      )}
    </div>
  );
};
