import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { formatINR, matchesLedgerDateFilter } from '../utils/accounting';
import {
  buildExpenseAuditReport,
  buildPurchaseAuditReport,
  buildSaleAuditReport,
  downloadSalePurchaseAuditPDF,
  PurchaseAuditStatus,
  SaleAuditStatus,
} from '../utils/billsAudit';
import {
  downloadPurchaseInvoicePDF,
  downloadSaleInvoicePDF,
} from '../utils/pdfGenerator';
import { PeriodFilterBar, getDateFilterLabel } from './PeriodFilterBar';
import { SaleRecord, SupplierTransaction } from '../types';
import {
  FileText,
  FilePlus2,
  Download,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  FileCheck2,
  Receipt,
} from 'lucide-react';

type AuditSubTab = 'SALE' | 'PURCHASE' | 'EXPENSE';

export const BillsAuditView: React.FC = () => {
  const {
    profile,
    sales,
    customers,
    suppliers,
    supplierTransactions,
    expenses,
    products,
    dateFilter,
    customDateRange,
    setActiveTab,
    setIsQuickSaleOpen,
    setSelectedCustomerId,
    setSelectedSupplierId,
  } = useStore();

  const [subTab, setSubTab] = useState<AuditSubTab>('SALE');
  const [searchQuery, setSearchQuery] = useState('');
  const [saleStatusFilter, setSaleStatusFilter] = useState<'ALL' | SaleAuditStatus>('ALL');
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<'ALL' | PurchaseAuditStatus>('ALL');
  const [isSampleModalOpen, setIsSampleModalOpen] = useState(false);
  const [sampleTab, setSampleTab] = useState<'NON_GST' | 'GST'>('NON_GST');
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);

  const periodSales = useMemo(() => {
    return sales.filter((s) =>
      matchesLedgerDateFilter(
        s.date || s.createdAt,
        dateFilter,
        customDateRange.startDate,
        customDateRange.endDate
      )
    );
  }, [sales, dateFilter, customDateRange]);

  const periodSupplierTxs = useMemo(() => {
    return supplierTransactions.filter((st) =>
      matchesLedgerDateFilter(
        st.date || st.createdAt,
        dateFilter,
        customDateRange.startDate,
        customDateRange.endDate
      )
    );
  }, [supplierTransactions, dateFilter, customDateRange]);

  const periodExpenses = useMemo(() => {
    return expenses.filter((e) =>
      matchesLedgerDateFilter(
        e.date || e.createdAt,
        dateFilter,
        customDateRange.startDate,
        customDateRange.endDate
      )
    );
  }, [expenses, dateFilter, customDateRange]);

  const saleAudit = useMemo(() => {
    return buildSaleAuditReport({
      sales: periodSales,
      customers,
      products,
      profile,
      searchQuery,
      statusFilter: saleStatusFilter,
    });
  }, [periodSales, customers, products, profile, searchQuery, saleStatusFilter]);

  const purchaseAudit = useMemo(() => {
    return buildPurchaseAuditReport({
      supplierTransactions: periodSupplierTxs,
      suppliers,
      profile,
      searchQuery,
      statusFilter: purchaseStatusFilter,
    });
  }, [periodSupplierTxs, suppliers, profile, searchQuery, purchaseStatusFilter]);

  const expenseAudit = useMemo(() => {
    return buildExpenseAuditReport({
      expenses: periodExpenses,
      searchQuery,
    });
  }, [periodExpenses, searchQuery]);

  const periodLabel = getDateFilterLabel(dateFilter, customDateRange);

  const handleExportAuditPdf = () => {
    downloadSalePurchaseAuditPDF({
      profile,
      periodLabel,
      saleReport: saleAudit,
      purchaseReport: purchaseAudit,
      expenseReport: expenseAudit,
    });
  };

  const handleDownloadSampleSalePdf = (mode: 'NON_GST' | 'GST') => {
    const sampleSale: SaleRecord = {
      id: 'sample-sale-0012',
      invoiceNo: mode === 'GST' ? 'GST-0054' : 'INV-0012',
      date: new Date().toISOString(),
      customerName: mode === 'GST' ? 'Lakshmi Provisions' : 'Ramesh Verma',
      amount: 5406,
      paymentMethod: 'UPI',
      isCredit: false,
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
      items: [
        {
          productName: 'Premium Basmati Rice',
          quantity: 10,
          unit: 'kg',
          baseUnit: 'kg',
          baseQuantity: 10,
          rate: 120,
          total: 1200,
        },
        {
          productName: 'Mustard Oil Tin',
          quantity: 2,
          unit: 'L',
          baseUnit: 'L',
          baseQuantity: 2,
          rate: 190,
          total: 380,
        },
        {
          productName: 'Chakki Fresh Atta',
          quantity: 40,
          unit: 'kg',
          baseUnit: 'kg',
          baseQuantity: 40,
          rate: 45,
          total: 1800,
        },
        {
          productName: 'Toor Dal Grade A',
          quantity: 12,
          unit: 'kg',
          baseUnit: 'kg',
          baseQuantity: 12,
          rate: 168.83,
          total: 2026,
        },
      ],
    };
    const sampleProfile = {
      ...profile,
      storeName: profile.storeName || 'Arjun Groceries',
      gstin: mode === 'GST' ? profile.gstin || '27ABCDE1234F1Z5' : undefined,
    };
    downloadSaleInvoicePDF(sampleSale, sampleProfile);
  };

  const handleDownloadSamplePurchasePdf = () => {
    const samplePurchase: SupplierTransaction = {
      id: 'sample-pur-0054',
      supplierId: 'sample-sup',
      type: 'PURCHASE',
      amount: 14500,
      paidAmount: 10000,
      paymentStatus: 'PARTIAL',
      paymentMethod: 'BANK',
      invoiceNo: 'BLJ-54',
      description: 'Wholesale grocery stock inward (Atta, Rice & Oil)',
      date: new Date().toISOString(),
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
    };
    downloadPurchaseInvoicePDF(samplePurchase, profile, {
      id: 'sample-sup',
      name: 'Mahavir Retail Suppliers',
      phone: '9876543210',
      gstin: profile.gstin || '27XYZAB5678C1Z2',
      openingBalance: 0,
      currentBalance: 4500,
      totalPurchases: 14500,
      totalPaid: 10000,
      createdAt: new Date().toISOString(),
    });
  };

  const handleAddBillPrimary = () => {
    if (subTab === 'SALE') {
      setIsQuickSaleOpen(true);
    } else if (subTab === 'PURCHASE') {
      setActiveTab('PURCHASES');
    } else {
      setActiveTab('EXPENSES');
    }
  };

  const renderDateShort = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="space-y-4 pb-32 lg:pb-24">
      {/* Top Sale / Purchase / Expense Navigation Strip */}
      <div className="bg-emerald-800 dark:bg-emerald-950 text-white rounded-2xl overflow-hidden shadow-xs border border-emerald-700/50 dark:border-emerald-900">
        <div role="tablist" aria-label="Bills Audit Category" className="grid grid-cols-3">
          {(
            [
              { id: 'SALE', label: 'Sale' },
              { id: 'PURCHASE', label: 'Purchase' },
              { id: 'EXPENSE', label: 'Expense' },
            ] as const
          ).map((tab) => {
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSubTab(tab.id)}
                className={`py-3.5 text-sm sm:text-base font-bold transition-colors cursor-pointer relative ${
                  active
                    ? 'text-white bg-emerald-900/40'
                    : 'text-emerald-100/80 hover:text-white hover:bg-emerald-900/20'
                }`}
              >
                <span>{tab.label}</span>
                {active && (
                  <span className="absolute bottom-0 left-3 right-3 h-[3px] bg-white rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Featured Non-GST & GST Billing Showcase Card (matching reference visual) */}
      <div className="rounded-2xl border border-emerald-300/80 dark:border-emerald-800 bg-emerald-50/75 dark:bg-emerald-950/35 overflow-hidden shadow-2xs">
        <div className="p-5 sm:p-6 flex flex-col items-center text-center">
          <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white leading-tight">
            {subTab === 'SALE'
              ? 'Create professional bill in 3 secs'
              : subTab === 'PURCHASE'
              ? 'Audit every inward purchase bill'
              : 'Audit every store expense bill'}
          </h2>
          <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 mt-1">
            Auto updates Khata, Inventory &amp; Cashbook
          </p>

          {/* Stacked Miniature Invoice Preview (Non-GST + GST) */}
          <div className="relative w-full max-w-xs h-52 my-4 flex items-center justify-center select-none" aria-hidden="true">
            {/* Back Top Bill (Retail Paid) */}
            <div className="w-44 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-md p-2.5 text-left -translate-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
                <span className="text-[9px] font-bold text-emerald-800 dark:text-emerald-300 truncate">
                  {profile.storeName || 'Arjun Groceries'}
                </span>
                <span className="text-[8px] font-semibold text-slate-400">Inv #0012</span>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[8px] text-slate-500">Paid via UPI</span>
                <span className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400">₹5,406</span>
              </div>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 w-full" />
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 w-4/5" />
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 w-3/5" />
              </div>
            </div>

            {/* Bottom-Left Thermal Receipt (Non-GST) */}
            <div className="absolute left-2 bottom-1 w-32 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg p-2 text-left">
              <div className="text-[8px] font-extrabold text-slate-800 dark:text-slate-100 tracking-wide text-center border-b border-dashed border-slate-200 dark:border-slate-700 pb-1">
                NON-GST MEMO
              </div>
              <div className="mt-1.5 space-y-1 text-[7px] text-slate-500 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>Rice 5kg</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">₹320</span>
                </div>
                <div className="flex justify-between">
                  <span>Atta 10kg</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">₹410</span>
                </div>
                <div className="flex justify-between border-t border-dashed border-slate-200 dark:border-slate-700 pt-1 font-bold text-slate-800 dark:text-slate-100">
                  <span>TOTAL</span>
                  <span>₹730</span>
                </div>
              </div>
            </div>

            {/* Bottom-Right GST Tax Invoice */}
            <div className="absolute right-2 bottom-0 w-36 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800 shadow-xl p-2 text-left">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                <span className="text-[7px] font-bold text-emerald-700 dark:text-emerald-400">TAX INVOICE</span>
                <span className="text-[7px] text-slate-400">GSTIN</span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 text-[7px] text-slate-500 dark:text-slate-400 font-semibold">
                <span>ITEM</span>
                <span className="text-right">GST</span>
                <span className="text-right">AMT</span>
              </div>
              <div className="mt-1 space-y-1 text-[7px] text-slate-700 dark:text-slate-300">
                <div className="grid grid-cols-3 gap-1">
                  <span className="truncate">Oil 2L</span>
                  <span className="text-right">5%</span>
                  <span className="text-right font-bold">₹380</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <span className="truncate">Dal 5kg</span>
                  <span className="text-right">0%</span>
                  <span className="text-right font-bold">₹690</span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
            Complete Non-GST &amp; GST Billing
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsSampleModalOpen(true)}
          className="w-full py-3.5 px-4 bg-white dark:bg-slate-900 hover:bg-emerald-50/70 dark:hover:bg-slate-800 border-t border-emerald-200/80 dark:border-emerald-800 text-sm sm:text-base font-bold text-emerald-800 dark:text-emerald-300 transition-colors cursor-pointer"
        >
          View sample bills
        </button>
      </div>

      {/* Period Filter & Audit Controls */}
      <PeriodFilterBar label="Audit Period" />

      {/* Search, Filter & Export Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 space-y-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>
                {subTab === 'SALE'
                  ? 'Sale Audit Report'
                  : subTab === 'PURCHASE'
                  ? 'Purchase Audit Report'
                  : 'Expense Audit Report'}
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {periodLabel} · Live bill verification &amp; GST/Non-GST register
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportAuditPdf}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-2xs cursor-pointer self-start sm:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Audit PDF</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                subTab === 'SALE'
                  ? 'Search invoice #, customer, or payment mode...'
                  : subTab === 'PURCHASE'
                  ? 'Search purchase #, supplier, or stock status...'
                  : 'Search expense title, category, or mode...'
              }
              className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          {subTab === 'SALE' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'VERIFIED', label: 'Verified' },
                  { id: 'NEEDS_REVIEW', label: 'Needs Review' },
                  { id: 'CANCELLED', label: 'Cancelled' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSaleStatusFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    saleStatusFilter === f.id
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {subTab === 'PURCHASE' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'STOCK_LINKED', label: 'Stock Linked' },
                  { id: 'LEDGER_ONLY', label: 'Ledger Only' },
                  { id: 'CANCELLED', label: 'Cancelled' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPurchaseStatusFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    purchaseStatusFilter === f.id
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audit KPI Strip */}
      {subTab === 'SALE' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Active Sale Bills</div>
            <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5 tabular-nums">
              {saleAudit.activeBills}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {saleAudit.cancelledBills} cancelled
            </div>
          </div>
          <div className="rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-3.5">
            <div className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-200">Total Sale Value</div>
            <div className="text-lg font-extrabold text-emerald-800 dark:text-emerald-300 mt-0.5 tabular-nums">
              {formatINR(saleAudit.totalRevenue)}
            </div>
            <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 tabular-nums">
              Paid: {formatINR(saleAudit.paidRevenue)}
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Credit (Udhar)</div>
            <div className="text-lg font-extrabold text-amber-700 dark:text-amber-400 mt-0.5 tabular-nums">
              {formatINR(saleAudit.creditRevenue)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Added to Khata</div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Audit Status</div>
            <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
              {saleAudit.verifiedBills} Verified
            </div>
            <div className="text-[11px] text-amber-700 dark:text-amber-400 tabular-nums">
              {saleAudit.needsReviewBills} needs review · {saleAudit.costCoveragePct}% costed
            </div>
          </div>
        </div>
      )}

      {subTab === 'PURCHASE' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Active Purchase Bills</div>
            <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5 tabular-nums">
              {purchaseAudit.activeBills}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {purchaseAudit.cancelledBills} cancelled
            </div>
          </div>
          <div className="rounded-2xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 p-3.5">
            <div className="text-[11px] font-semibold text-sky-900 dark:text-sky-200">Gross Purchases</div>
            <div className="text-lg font-extrabold text-sky-800 dark:text-sky-300 mt-0.5 tabular-nums">
              {formatINR(purchaseAudit.grossPurchaseAmount)}
            </div>
            <div className="text-[11px] text-sky-800/80 dark:text-sky-300/80 tabular-nums">
              Paid: {formatINR(purchaseAudit.paidAmount)}
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Payable Due</div>
            <div className="text-lg font-extrabold text-amber-700 dark:text-amber-400 mt-0.5 tabular-nums">
              {formatINR(purchaseAudit.payableDueAmount)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Supplier Balance</div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Stock Audit</div>
            <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
              {purchaseAudit.stockLinkedBills} Linked
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {purchaseAudit.ledgerOnlyBills} ledger only
            </div>
          </div>
        </div>
      )}

      {subTab === 'EXPENSE' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Expense Entries</div>
            <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5 tabular-nums">
              {expenseAudit.totalEntries}
            </div>
          </div>
          <div className="rounded-2xl bg-rose-50/80 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900 p-3.5">
            <div className="text-[11px] font-semibold text-rose-900 dark:text-rose-200">Shop Expenses</div>
            <div className="text-lg font-extrabold text-rose-800 dark:text-rose-300 mt-0.5 tabular-nums">
              {formatINR(expenseAudit.operatingAmount)}
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Owner Drawings</div>
            <div className="text-lg font-extrabold text-amber-700 dark:text-amber-400 mt-0.5 tabular-nums">
              {formatINR(expenseAudit.drawingsAmount)}
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Cash vs Digital</div>
            <div className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5 tabular-nums">
              {formatINR(expenseAudit.cashOutAmount)} / {formatINR(expenseAudit.digitalOutAmount)}
            </div>
          </div>
        </div>
      )}

      {/* Audit Register List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
            {subTab === 'SALE'
              ? `Sale Bills (${saleAudit.rows.length})`
              : subTab === 'PURCHASE'
              ? `Purchase Bills (${purchaseAudit.rows.length})`
              : `Expense Entries (${expenseAudit.rows.length})`}
          </span>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {profile.gstin ? `GSTIN: ${profile.gstin}` : 'Non-GST Retail Mode'}
          </span>
        </div>

        {subTab === 'SALE' && (
          saleAudit.rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No sale bills match this filter. Tap <strong>ADD BILL</strong> below to record your first sale bill.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {saleAudit.rows.map((row) => (
                <div
                  key={row.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        #{row.invoiceNo}
                      </span>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                        {row.partyName}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{renderDateShort(row.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.paymentMethod}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.billingMode === 'GST' ? 'GST' : 'Non-GST'}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          row.auditStatus === 'VERIFIED'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : row.auditStatus === 'NEEDS_REVIEW'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {row.auditStatus === 'VERIFIED' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : row.auditStatus === 'NEEDS_REVIEW' ? (
                          <AlertTriangle className="w-3 h-3" />
                        ) : (
                          <XCircle className="w-3 h-3" />
                        )}
                        <span>{row.auditNote}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <div
                        className={`text-xs sm:text-sm font-extrabold tabular-nums ${
                          row.auditStatus === 'CANCELLED'
                            ? 'line-through text-slate-400'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {formatINR(row.amount)}
                      </div>
                      <div className="text-[10px] text-slate-400 tabular-nums">
                        {row.itemsCount} {row.itemsCount === 1 ? 'item' : 'items'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const cust = row.customerId
                          ? customers.find((c) => c.id === row.customerId)
                          : undefined;
                        downloadSaleInvoicePDF(row.rawSale, profile, cust);
                      }}
                      aria-label={`Download PDF for bill ${row.invoiceNo}`}
                      className="px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-xs font-bold cursor-pointer"
                    >
                      PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {subTab === 'PURCHASE' && (
          purchaseAudit.rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No purchase bills match this filter. Tap <strong>ADD BILL</strong> below to record inward stock purchases.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchaseAudit.rows.map((row) => (
                <div
                  key={row.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        #{row.invoiceNo}
                      </span>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                        {row.partyName}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{renderDateShort(row.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.paymentStatus}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.billingMode === 'GST' ? 'GST' : 'Non-GST'}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold ${
                          row.auditStatus === 'STOCK_LINKED'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : row.auditStatus === 'LEDGER_ONLY'
                            ? 'text-sky-700 dark:text-sky-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {row.auditNote}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <div
                        className={`text-xs sm:text-sm font-extrabold tabular-nums ${
                          row.auditStatus === 'CANCELLED'
                            ? 'line-through text-slate-400'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {formatINR(row.amount)}
                      </div>
                      {row.dueAmount > 0 && (
                        <div className="text-[10px] text-amber-700 dark:text-amber-400 tabular-nums">
                          Due: {formatINR(row.dueAmount)}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const sup = suppliers.find((s) => s.id === row.supplierId);
                        downloadPurchaseInvoicePDF(row.rawPurchase, profile, sup);
                      }}
                      aria-label={`Download PDF for purchase ${row.invoiceNo}`}
                      className="px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-xs font-bold cursor-pointer"
                    >
                      PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {subTab === 'EXPENSE' && (
          expenseAudit.rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No expense entries recorded in this period. Tap <strong>ADD BILL</strong> below to log store expenses.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenseAudit.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setActiveTab('EXPENSES')}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                      {row.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {renderDateShort(row.date)} · {row.isPersonalWithdrawal ? 'Owner Drawing' : row.category} ·{' '}
                      {row.paymentMethod}
                    </div>
                  </div>
                  <div className="text-xs sm:text-sm font-extrabold text-rose-700 dark:text-rose-400 tabular-nums shrink-0">
                    -{formatINR(row.amount)}
                  </div>
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* Bottom Floating Action Bar (matching screenshot's MORE / Payment & Return + ADD BILL pills) */}
      <div className="fixed bottom-20 left-0 right-0 z-30 pointer-events-none px-4 lg:static lg:px-0 lg:pointer-events-auto lg:pt-2">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3 pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsMoreActionsOpen(true)}
            className="flex flex-col items-center justify-center px-5 py-2 rounded-full bg-white dark:bg-slate-900 border-2 border-emerald-700 dark:border-emerald-500 text-emerald-900 dark:text-emerald-200 shadow-lg hover:bg-emerald-50 dark:hover:bg-slate-800 transition-colors cursor-pointer min-h-[48px]"
          >
            <span className="text-xs font-extrabold tracking-wide leading-tight">MORE</span>
            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 leading-tight">
              Payment &amp; Return
            </span>
          </button>

          <button
            type="button"
            onClick={handleAddBillPrimary}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-emerald-800 hover:bg-emerald-900 active:bg-emerald-950 text-white font-extrabold text-xs sm:text-sm tracking-wide shadow-lg transition-colors cursor-pointer min-h-[48px]"
          >
            <FilePlus2 className="w-4 h-4 shrink-0" />
            <span>ADD BILL</span>
          </button>
        </div>
      </div>

      {/* Sample Bills Modal (Non-GST & GST) */}
      {isSampleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 bg-emerald-800 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Sample Non-GST &amp; GST Bills</h3>
                <p className="text-xs text-emerald-100">Preview &amp; download formatted invoice PDFs</p>
              </div>
              <button
                type="button"
                aria-label="Close sample bills modal"
                onClick={() => setIsSampleModalOpen(false)}
                className="p-1.5 rounded-lg text-emerald-100 hover:bg-emerald-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setSampleTab('NON_GST')}
                  className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    sampleTab === 'NON_GST'
                      ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Non-GST Retail Bill
                </button>
                <button
                  type="button"
                  onClick={() => setSampleTab('GST')}
                  className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    sampleTab === 'GST'
                      ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  GST Tax Invoice
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50/70 dark:bg-slate-800/50 text-xs space-y-2">
                <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <div>
                    <div className="font-extrabold text-slate-900 dark:text-white text-sm">
                      {profile.storeName || 'Arjun Groceries'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {sampleTab === 'GST'
                        ? `GSTIN: ${profile.gstin || '27ABCDE1234F1Z5'}`
                        : 'Retail Cash / Udhar Memo'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-emerald-700 dark:text-emerald-400">
                      {sampleTab === 'GST' ? 'TAX INVOICE' : 'BILL #0012'}
                    </div>
                    <div className="text-[11px] text-slate-500">PAID · UPI</div>
                  </div>
                </div>
                <div className="space-y-1.5 text-slate-700 dark:text-slate-300 tabular-nums">
                  <div className="flex justify-between">
                    <span>Basmati Rice (10 kg)</span>
                    <span className="font-semibold">₹1,200</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Mustard Oil (2 L)</span>
                    <span className="font-semibold">₹380</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Chakki Fresh Atta (40 kg)</span>
                    <span className="font-semibold">₹1,800</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Toor Dal (12 kg)</span>
                    <span className="font-semibold">₹2,026</span>
                  </div>
                </div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 font-extrabold text-sm text-emerald-800 dark:text-emerald-300 tabular-nums">
                  <span>Grand Total</span>
                  <span>₹5,406</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleDownloadSampleSalePdf(sampleTab)}
                  className="py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Sale Sample PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSamplePurchasePdf}
                  className="py-2.5 px-3 rounded-xl border border-emerald-700 dark:border-emerald-500 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Purchase Sample PDF</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* More Actions Sheet (Payment, Return & Audit Export) */}
      {isMoreActionsOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl max-w-md w-full p-5 border-t sm:border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">Payment, Return &amp; Audit</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Quick billing &amp; reconciliation actions</p>
              </div>
              <button
                type="button"
                aria-label="Close payment and return menu"
                onClick={() => setIsMoreActionsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setIsMoreActionsOpen(false);
                  if (customers[0]) setSelectedCustomerId(customers[0].id);
                  setActiveTab('CUSTOMERS');
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-left cursor-pointer"
              >
                <ArrowDownLeft className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">Receive Customer Payment</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Record Khata Jama &amp; print receipt</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMoreActionsOpen(false);
                  if (suppliers[0]) setSelectedSupplierId(suppliers[0].id);
                  setActiveTab('SUPPLIERS');
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-left cursor-pointer"
              >
                <ArrowUpRight className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">Pay Supplier</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Settle wholesale bills &amp; payables</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMoreActionsOpen(false);
                  setActiveTab(subTab === 'PURCHASE' ? 'PURCHASES' : 'CUSTOMERS');
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-left cursor-pointer"
              >
                <RotateCcw className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    {subTab === 'PURCHASE' ? 'Purchase Return (Maal Vapsi)' : 'Sales Return (Customer Return)'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Adjust stock &amp; party ledger safely</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMoreActionsOpen(false);
                  handleExportAuditPdf();
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-500 text-left cursor-pointer"
              >
                <FileText className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    Download Sale &amp; Purchase Audit PDF
                  </div>
                  <div className="text-xs text-emerald-700 dark:text-emerald-400">
                    Full GST / Non-GST &amp; cost audit summary
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMoreActionsOpen(false);
                  setIsSampleModalOpen(true);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-left cursor-pointer"
              >
                <Receipt className="w-5 h-5 text-slate-600 dark:text-slate-300 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">View Sample Bills</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Preview Non-GST &amp; GST formats</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
