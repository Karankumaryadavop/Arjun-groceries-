import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import {
  formatINR,
  calculateDailySalesTargetProgress,
  getLocalTodayKey,
} from '../utils/accounting';
import { calculateTodayActivitySummary, TodayActivityItem } from '../utils/todayActivity';
import { buildStockVelocityMonitorReport, StockVelocityItem } from '../utils/stockVelocity';
import {
  buildWeeklySalesTrendData,
  getCriticalStockWidgetData,
} from '../utils/dashboardTrends';
import {
  TrendingUp,
  ShoppingCart,
  Users,
  Truck,
  Wallet,
  Receipt,
  PackageCheck,
  ArrowDownLeft,
  ArrowUpRight,
  X,
  Boxes,
  MoonStar,
  Target,
  Edit3,
  Check,
  User,
  ChevronDown,
  Package,
  ClipboardList,
  BarChart2,
  Settings,
  Database,
  Clock,
  RotateCcw,
  LogOut,
} from 'lucide-react';
import { ExpenseCategory } from '../types';
import { BRAND_NAME } from './BrandLogo';
import { PWAInstallButton, useTrackActiveTransaction } from './PWAInstallButton';
import { WeeklySalesTrendCard } from './WeeklySalesTrendCard';
import { CriticalStockWidget } from './CriticalStockWidget';

export const DashboardView: React.FC = () => {
  const {
    profile,
    customers,
    customerTransactions,
    suppliers,
    supplierTransactions,
    products,
    sales,
    expenses,
    cashbookEntries,
    stockAdjustments,
    setActiveTab,
    openInventoryVelocityMonitor,
    openAddPurchaseForProduct,
    setIsQuickSaleOpen,
    setIsDailyClosingOpen,
    setIsBackupModalOpen,
    setSelectedCustomerId,
    setSelectedSupplierId,
    addCustomer,
    addCustomerTransaction,
    addSupplierTransaction,
    addExpense,
    expenseCategories,
    addExpenseCategory,
    dailySalesTarget,
    setDailySalesTarget,
    theme,
    logout,
  } = useStore();

  const [showAllShortcuts, setShowAllShortcuts] = useState(false);
  const [showAllTodayTimeline, setShowAllTodayTimeline] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  // Daily Sales Target Inline Edit State
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetAmountInput, setTargetAmountInput] = useState('');
  const [targetFormError, setTargetFormError] = useState<string | null>(null);

  // Quick Action Modal States
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  const [isReceivePaymentModalOpen, setIsReceivePaymentModalOpen] = useState(false);
  const [isAddPurchaseModalOpen, setIsAddPurchaseModalOpen] = useState(false);
  const [isPaySupplierModalOpen, setIsPaySupplierModalOpen] = useState(false);
  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);

  useTrackActiveTransaction(
    'dashboard-quick-tx',
    isAddCustomerModalOpen ||
      isReceivePaymentModalOpen ||
      isAddPurchaseModalOpen ||
      isPaySupplierModalOpen ||
      isAddExpenseModalOpen
  );

  // Form states for Quick Action modals
  // 1. Add Customer Form
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustOpenBal, setNewCustOpenBal] = useState('');

  // 2. Receive Payment Form
  const [recCustomerId, setRecCustomerId] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recMethod, setRecMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [recNote, setRecNote] = useState('');

  // 3. Add Purchase Form
  const [purSupplierId, setPurSupplierId] = useState('');
  const [purAmount, setPurAmount] = useState('');
  const [purPaidAmount, setPurPaidAmount] = useState('');
  const [purMethod, setPurMethod] = useState<'BANK' | 'UPI' | 'CASH'>('BANK');
  const [purInvoiceNo, setPurInvoiceNo] = useState('');
  const [purStatus, setPurStatus] = useState<'UNPAID' | 'PARTIAL' | 'PAID'>('UNPAID');
  const [purDesc, setPurDesc] = useState('');
  const [purError, setPurError] = useState<string | null>(null);

  // 4. Pay Supplier Form
  const [paySupplierId, setPaySupplierId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'BANK' | 'UPI' | 'CASH'>('BANK');
  const [payDesc, setPayDesc] = useState('');

  // 5. Add Expense Form
  const [expTitle, setExpTitle] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('SHOP');
  const [expAmount, setExpAmount] = useState('');
  const [expMethod, setExpMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [expIsDrawing, setExpIsDrawing] = useState(false);
  const [showQuickCustomCat, setShowQuickCustomCat] = useState(false);
  const [quickCustomCatLabel, setQuickCustomCatLabel] = useState('');
  const [quickCustomCatError, setQuickCustomCatError] = useState<string | null>(null);

  // ----------------------------------------------------
  // TODAY'S ACTIVITY & DAILY TARGET METRICS
  // ----------------------------------------------------
  const todayStr = getLocalTodayKey();

  const todayActivity = useMemo(() => {
    return calculateTodayActivitySummary({
      dateKey: todayStr,
      sales,
      customerTransactions,
      supplierTransactions,
      expenses,
      cashbookEntries,
      stockAdjustments,
      customers,
      suppliers,
    });
  }, [
    todayStr,
    sales,
    customerTransactions,
    supplierTransactions,
    expenses,
    cashbookEntries,
    stockAdjustments,
    customers,
    suppliers,
  ]);

  const todayDateDisplay = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return dt.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }, [todayStr]);

  const handleOpenTodayActivityItem = (item: TodayActivityItem) => {
    if (item.customerId) setSelectedCustomerId(item.customerId);
    if (item.supplierId) setSelectedSupplierId(item.supplierId);
    setActiveTab(item.targetTab);
  };

  const dailyTargetProgress = useMemo(() => {
    return calculateDailySalesTargetProgress(
      sales,
      dailySalesTarget?.amount || 0,
      todayStr
    );
  }, [sales, dailySalesTarget, todayStr]);

  const stockVelocityReport = useMemo(
    () => buildStockVelocityMonitorReport({ products, sales, suppliers }),
    [products, sales, suppliers]
  );

  const weeklySalesTrendReport = useMemo(
    () => buildWeeklySalesTrendData({ sales, customerTransactions }),
    [sales, customerTransactions]
  );

  const criticalStockData = useMemo(
    () => getCriticalStockWidgetData(stockVelocityReport, 5),
    [stockVelocityReport]
  );

  const handleOrderCriticalStockItem = (item: StockVelocityItem) => {
    openAddPurchaseForProduct({
      productId: item.product.id,
      productName: item.product.name,
      unit: item.product.unit,
      supplierId: item.preferredSupplierId,
      suggestedQty: Math.max(1, item.recommendedReorderQty || 1),
      unitPurchasePrice: item.lastPurchasePrice,
      notes: item.reason,
    });
  };

  const handleSaveTarget = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(targetAmountInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setTargetFormError('Please enter a valid target amount (0 or more).');
      return;
    }
    setTargetFormError(null);
    setDailySalesTarget(parsed);
    setIsEditingTarget(false);
  };

  // Helper for quick action submissions
  const handleQuickAddCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    const id = addCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim() || 'No phone',
      address: newCustAddress.trim() || undefined,
      openingBalance: Number(newCustOpenBal) || 0,
    });
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustOpenBal('');
    setIsAddCustomerModalOpen(false);
    setSelectedCustomerId(id);
    setActiveTab('CUSTOMERS');
  };

  const handleQuickReceivePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recCustomerId || Number(recAmount) <= 0) return;
    addCustomerTransaction({
      customerId: recCustomerId,
      type: 'PAYMENT',
      amount: Number(recAmount),
      description: recNote.trim() || 'Khata payment received at counter',
      paymentMethod: recMethod,
    });
    setRecCustomerId('');
    setRecAmount('');
    setRecNote('');
    setIsReceivePaymentModalOpen(false);
  };

  const handleQuickAddPurchase = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(purAmount);
    if (!purSupplierId || !Number.isFinite(amt) || amt <= 0) {
      setPurError('Select a supplier and enter a positive invoice amount.');
      return;
    }
    let resolvedPaidAmount = 0;
    if (purStatus === 'PAID') {
      resolvedPaidAmount = amt;
    } else if (purStatus === 'PARTIAL') {
      const parsedPartial = Number(purPaidAmount);
      if (!Number.isFinite(parsedPartial) || parsedPartial <= 0 || parsedPartial >= amt) {
        setPurError(`Partial amount paid must be greater than ₹0 and less than ₹${amt}.`);
        return;
      }
      resolvedPaidAmount = parsedPartial;
    }
    const res = addSupplierTransaction({
      supplierId: purSupplierId,
      type: 'PURCHASE',
      amount: amt,
      paidAmount: resolvedPaidAmount,
      paymentMethod: purStatus === 'UNPAID' ? undefined : purMethod,
      invoiceNo: purInvoiceNo.trim() || undefined,
      paymentStatus: purStatus,
      description: purDesc.trim() || 'Inward stock purchase bill',
    });
    if (!res.success) {
      setPurError(res.error || 'Failed to save purchase.');
      return;
    }
    setPurSupplierId('');
    setPurAmount('');
    setPurPaidAmount('');
    setPurInvoiceNo('');
    setPurDesc('');
    setPurError(null);
    setIsAddPurchaseModalOpen(false);
  };

  const handleQuickPaySupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paySupplierId || Number(payAmount) <= 0) return;
    addSupplierTransaction({
      supplierId: paySupplierId,
      type: 'PAYMENT',
      amount: Number(payAmount),
      paymentMethod: payMethod,
      paymentStatus: 'PAID',
      description: payDesc.trim() || 'Supplier invoice settlement payment',
    });
    setPaySupplierId('');
    setPayAmount('');
    setPayDesc('');
    setIsPaySupplierModalOpen(false);
  };

  const handleQuickAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle.trim() || Number(expAmount) <= 0) return;
    const effectiveCat = expenseCategories.some((c) => c.id === expCategory)
      ? expCategory
      : expenseCategories[0]?.id || expCategory;
    const matched = expenseCategories.find((c) => c.id === effectiveCat);
    addExpense({
      title: expTitle.trim(),
      category: effectiveCat,
      amount: Number(expAmount),
      isPersonalWithdrawal:
        expIsDrawing || Boolean(matched?.isPersonalDrawing) || effectiveCat === 'PERSONAL_DRAWING',
      paymentMethod: expMethod,
    });
    setExpTitle('');
    setExpAmount('');
    setShowQuickCustomCat(false);
    setQuickCustomCatError(null);
    setIsAddExpenseModalOpen(false);
  };

  return (
    <div className="space-y-6 pb-12">

      {/* ---------------------------------------------------------------- */}
      {/* TOP HERO BANNER + QUICK SHORTCUTS + TODAY'S SALES HIGHLIGHT      */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-5">
        {/* Emerald Shop Welcome Header Card */}
        <div className="relative rounded-2xl bg-emerald-800 dark:bg-emerald-950 text-white p-5 sm:p-6 border border-emerald-700/40 dark:border-emerald-900 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white leading-tight truncate">
                {profile.storeName || BRAND_NAME}
              </h2>
              <p className="text-xs sm:text-sm text-emerald-100/90 mt-0.5 truncate">
                Shop Management
              </p>
              <p className="text-sm sm:text-base font-medium text-white/95 mt-4">
                Welcome back!
              </p>
            </div>

            {/* Dashboard Install App + Owner / Store Quick Menu */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <PWAInstallButton variant="dashboard" />
              <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((v) => !v)}
                aria-expanded={isProfileMenuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white text-slate-800 hover:bg-emerald-50 text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer min-h-[40px] whitespace-nowrap"
              >
                <User className="w-4 h-4 text-emerald-800 shrink-0" />
                <span className="max-w-[110px] truncate">{profile.ownerName || 'Owner'}</span>
                <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
              </button>

              {isProfileMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 rounded-xl bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 shadow-lg py-1.5 z-30"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      setActiveTab('SETTINGS');
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Settings className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                    <span>Store Settings &amp; Profile</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      setIsDailyClosingOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <MoonStar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span>End Day Closing Report</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      setIsBackupModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Database className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                    <span>Backup &amp; Restore</span>
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="dashboard-logout-btn"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      void logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log Out</span>
                  </button>
                </div>
              )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Shortcuts (2 cols on mobile, 4 cols on desktop) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base sm:text-lg">
              Quick Shortcuts
            </h3>
            <button
              type="button"
              onClick={() => setShowAllShortcuts((v) => !v)}
              className="text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              {showAllShortcuts ? 'Show less' : 'View all'}
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => setIsQuickSaleOpen(true)}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <ShoppingCart className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">New Sale</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('INVENTORY')}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <Package className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Products</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('INVENTORY')}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <Boxes className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Stock</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('CUSTOMERS')}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <Users className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Customers</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SUPPLIERS')}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <Truck className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Suppliers</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('EXPENSES')}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <Wallet className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Expenses</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('REPORTS')}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <BarChart2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Reports</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('PURCHASES')}
              className="flex items-center gap-3 px-3.5 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 text-left transition-colors shadow-2xs cursor-pointer min-h-[48px]"
            >
              <ClipboardList className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Purchase</span>
            </button>
          </div>

          {/* Expanded Quick Actions when "View all" is clicked */}
          {showAllShortcuts && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddCustomerModalOpen(true)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <Users className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                <span className="truncate">Add Customer</span>
              </button>
              <button
                type="button"
                onClick={() => setIsReceivePaymentModalOpen(true)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <ArrowDownLeft className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span className="truncate">Receive Payment</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAddPurchaseModalOpen(true)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <PackageCheck className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
                <span className="truncate">Add Purchase Bill</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPaySupplierModalOpen(true)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <ArrowUpRight className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="truncate">Pay Supplier</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAddExpenseModalOpen(true)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <Receipt className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                <span className="truncate">Add Expense</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('CASHBOOK')}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <Wallet className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span className="truncate">Cashbook (Rokad)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ANALYTICS')}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span className="truncate">Business Analytics</span>
              </button>
              <button
                type="button"
                onClick={() => setIsDailyClosingOpen(true)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]"
              >
                <MoonStar className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="truncate">End Day Closing</span>
              </button>
            </div>
          )}
        </div>

        {/* Today's Activity Highlight Cards & Live Today Timeline */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base sm:text-lg leading-tight">
                Today&apos;s Activity
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {todayDateDisplay} · {todayActivity.totalActivitiesCount}{' '}
                {todayActivity.totalActivitiesCount === 1 ? 'activity' : 'activities'} recorded today
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsDailyClosingOpen(true)}
              className="text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Day Closing &rarr;
            </button>
          </div>

          {/* Primary Soft Mint Today's Sales Highlight Card */}
          <button
            type="button"
            onClick={() => setActiveTab('SALES')}
            className="w-full rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-900/70 p-4 sm:p-5 hover:border-emerald-400 transition-colors cursor-pointer flex items-center justify-between gap-4 text-left"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                Today&apos;s Sales
              </div>
              <div className="text-2xl sm:text-3xl font-bold tracking-tight text-emerald-800 dark:text-emerald-300 mt-1 tabular-nums leading-none">
                {formatINR(todayActivity.salesAmount)}
              </div>
              {todayActivity.salesAmount > 0 && (
                <div className="text-[11px] font-medium text-emerald-800/80 dark:text-emerald-300/80 mt-2 tabular-nums">
                  Cash {formatINR(todayActivity.cashSales)} · UPI/Bank {formatINR(todayActivity.upiSales)} · Udhar{' '}
                  {formatINR(todayActivity.creditSales)}
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-medium text-emerald-800/80 dark:text-emerald-300/80 tabular-nums">
                {todayActivity.billsCount} {todayActivity.billsCount === 1 ? 'bill' : 'bills'} today
              </div>
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mt-1">
                View Sales &rarr;
              </div>
            </div>
          </button>

          {/* Today's Activity Cards Grid (styled consistently with Today's Sales) */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {/* 1. Khata Collected Today */}
            <button
              type="button"
              onClick={() => setActiveTab('CUSTOMERS')}
              className="w-full rounded-2xl bg-teal-50/85 dark:bg-teal-950/35 border border-teal-200/70 dark:border-teal-900/60 p-3.5 sm:p-4 hover:border-teal-400 transition-colors cursor-pointer flex flex-col justify-between gap-2 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium text-teal-900 dark:text-teal-200 truncate">
                  Khata Collected
                </span>
                <ArrowDownLeft className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-teal-800 dark:text-teal-300 tabular-nums leading-tight">
                {formatINR(todayActivity.collectionsAmount)}
              </div>
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-teal-800/80 dark:text-teal-300/80">
                <span className="tabular-nums truncate">
                  {todayActivity.collectionsCount} {todayActivity.collectionsCount === 1 ? 'receipt' : 'receipts'}
                </span>
                <span className="font-semibold text-teal-700 dark:text-teal-400 shrink-0">Khata &rarr;</span>
              </div>
            </button>

            {/* 2. Purchases Today */}
            <button
              type="button"
              onClick={() => setActiveTab('PURCHASES')}
              className="w-full rounded-2xl bg-sky-50/85 dark:bg-sky-950/35 border border-sky-200/70 dark:border-sky-900/60 p-3.5 sm:p-4 hover:border-sky-400 transition-colors cursor-pointer flex flex-col justify-between gap-2 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium text-sky-900 dark:text-sky-200 truncate">
                  Today&apos;s Purchases
                </span>
                <PackageCheck className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-sky-800 dark:text-sky-300 tabular-nums leading-tight">
                {formatINR(todayActivity.purchasesAmount)}
              </div>
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-sky-800/80 dark:text-sky-300/80">
                <span className="tabular-nums truncate">
                  {todayActivity.purchasesCount} {todayActivity.purchasesCount === 1 ? 'bill' : 'bills'}
                </span>
                <span className="font-semibold text-sky-700 dark:text-sky-400 shrink-0">Purchases &rarr;</span>
              </div>
            </button>

            {/* 3. Supplier Paid Today */}
            <button
              type="button"
              onClick={() => setActiveTab('SUPPLIERS')}
              className="w-full rounded-2xl bg-amber-50/85 dark:bg-amber-950/35 border border-amber-200/70 dark:border-amber-900/60 p-3.5 sm:p-4 hover:border-amber-400 transition-colors cursor-pointer flex flex-col justify-between gap-2 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium text-amber-900 dark:text-amber-200 truncate">
                  Supplier Paid
                </span>
                <ArrowUpRight className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-amber-800 dark:text-amber-300 tabular-nums leading-tight">
                {formatINR(todayActivity.supplierPaidAmount)}
              </div>
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-amber-800/80 dark:text-amber-300/80">
                <span className="tabular-nums truncate">
                  {todayActivity.supplierPaidCount} {todayActivity.supplierPaidCount === 1 ? 'payment' : 'payments'}
                </span>
                <span className="font-semibold text-amber-700 dark:text-amber-400 shrink-0">Suppliers &rarr;</span>
              </div>
            </button>

            {/* 4. Expenses & Drawings Today */}
            <button
              type="button"
              onClick={() => setActiveTab('EXPENSES')}
              className="w-full rounded-2xl bg-rose-50/80 dark:bg-rose-950/35 border border-rose-200/70 dark:border-rose-900/60 p-3.5 sm:p-4 hover:border-rose-400 transition-colors cursor-pointer flex flex-col justify-between gap-2 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium text-rose-900 dark:text-rose-200 truncate">
                  Today&apos;s Expenses
                </span>
                <Receipt className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-rose-800 dark:text-rose-300 tabular-nums leading-tight">
                {formatINR(todayActivity.operatingExpensesAmount)}
              </div>
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-rose-800/80 dark:text-rose-300/80">
                <span className="tabular-nums truncate">
                  {todayActivity.personalDrawingsAmount > 0
                    ? `Drawings: ${formatINR(todayActivity.personalDrawingsAmount)}`
                    : `${todayActivity.operatingExpensesCount} ${todayActivity.operatingExpensesCount === 1 ? 'expense' : 'expenses'}`}
                </span>
                <span className="font-semibold text-rose-700 dark:text-rose-400 shrink-0">Expenses &rarr;</span>
              </div>
            </button>

            {/* 5. Today's Cash Drawer (Rokad) */}
            <button
              type="button"
              onClick={() => setActiveTab('CASHBOOK')}
              className="w-full rounded-2xl bg-emerald-50/75 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/60 p-3.5 sm:p-4 hover:border-emerald-400 transition-colors cursor-pointer flex flex-col justify-between gap-2 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-200 truncate">
                  Today&apos;s Cash (Rokad)
                </span>
                <Wallet className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-emerald-800 dark:text-emerald-300 tabular-nums leading-tight">
                {todayActivity.netCashToday > 0 ? '+' : ''}
                {formatINR(todayActivity.netCashToday)}
              </div>
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-emerald-800/80 dark:text-emerald-300/80">
                <span className="tabular-nums truncate">
                  Drawer: {formatINR(todayActivity.expectedCashInDrawer)}
                </span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">Rokad &rarr;</span>
              </div>
            </button>

            {/* 6. Returns & Stock Updates Today */}
            <button
              type="button"
              onClick={() =>
                setActiveTab(
                  todayActivity.returnsCount > 0 && todayActivity.manualStockUpdatesCount === 0
                    ? 'CUSTOMERS'
                    : 'INVENTORY'
                )
              }
              className="w-full rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 hover:border-emerald-400 transition-colors cursor-pointer flex flex-col justify-between gap-2 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                  Returns &amp; Stock
                </span>
                <RotateCcw className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums leading-tight">
                {todayActivity.returnsCount > 0
                  ? formatINR(todayActivity.returnsAmount)
                  : `${todayActivity.stockUpdatesCount} updates`}
              </div>
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                <span className="tabular-nums truncate">
                  {todayActivity.returnsCount} ret · {todayActivity.manualStockUpdatesCount} edits
                </span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">Stock &rarr;</span>
              </div>
            </button>
          </div>

          {/* Weekly Sales Trend (Recharts) & Critical Stock Visual Widgets */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
            <div className="xl:col-span-7 min-w-0">
              <WeeklySalesTrendCard
                report={weeklySalesTrendReport}
                onOpenAnalytics={() => setActiveTab('ANALYTICS')}
                onQuickSale={() => setIsQuickSaleOpen(true)}
                isDark={theme === 'dark'}
              />
            </div>
            <div className="xl:col-span-5 min-w-0">
              <CriticalStockWidget
                data={criticalStockData}
                reorderLeadDays={stockVelocityReport.config.reorderLeadDays}
                lowStockWarningDays={stockVelocityReport.config.lowStockWarningDays}
                onOpenVelocityMonitor={openInventoryVelocityMonitor}
                onOpenInventory={() => setActiveTab('INVENTORY')}
                onOrderItem={handleOrderCriticalStockItem}
              />
            </div>
          </div>

          {/* Today's Activity Feed */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  Today&apos;s Activity Log
                </span>
              </div>
              {todayActivity.activities.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllTodayTimeline((v) => !v)}
                  className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
                >
                  {showAllTodayTimeline ? 'Show less' : `View all (${todayActivity.activities.length})`}
                </button>
              )}
            </div>

            {todayActivity.activities.length === 0 ? (
              <div className="px-4 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                No transactions recorded yet today. Tap <strong>New Sale</strong> or any shortcut above to record today&apos;s first entry.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(showAllTodayTimeline
                  ? todayActivity.activities
                  : todayActivity.activities.slice(0, 5)
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleOpenTodayActivityItem(item)}
                    className="w-full px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer flex items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>
                    {typeof item.amount === 'number' && (
                      <div
                        className={`text-xs sm:text-sm font-bold tabular-nums shrink-0 ${
                          item.amountDirection === 'IN'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : item.amountDirection === 'OUT'
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {item.amountDirection === 'IN'
                          ? `+${formatINR(item.amount)}`
                          : item.amountDirection === 'OUT'
                          ? `-${formatINR(item.amount)}`
                          : formatINR(item.amount)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* DAILY SALES TARGET TRACKER (Offline IndexedDB Persistent)        */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-emerald-200 dark:border-emerald-900/70 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div
              className={`p-2.5 rounded-xl shrink-0 ${
                dailyTargetProgress.isAchieved
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <Target className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                  Daily Sales Target (Aaj ka Bikri Lakshya)
                </h3>
                {dailyTargetProgress.targetAmount > 0 && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md tabular-nums ${
                      dailyTargetProgress.isAchieved
                        ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                        : 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200'
                    }`}
                  >
                    {dailyTargetProgress.isAchieved
                      ? 'Target Achieved!'
                      : `${dailyTargetProgress.progressPct}% Reached`}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {dailyTargetProgress.targetAmount > 0 ? (
                  <>
                    Today: <strong className="text-slate-800 dark:text-slate-200">{formatINR(dailyTargetProgress.todaySales)}</strong> / Target:{' '}
                    <strong className="text-emerald-800 dark:text-emerald-300">{formatINR(dailyTargetProgress.targetAmount)}</strong>
                    {!dailyTargetProgress.isAchieved && (
                      <> · Remaining: <strong className="text-amber-700 dark:text-amber-300">{formatINR(dailyTargetProgress.remainingAmount)}</strong></>
                    )}
                  </>
                ) : (
                  'Set a daily bikri goal to track counter progress in real time.'
                )}
              </p>
            </div>
          </div>

          {!isEditingTarget ? (
            <button
              type="button"
              onClick={() => {
                setTargetAmountInput(
                  dailyTargetProgress.targetAmount > 0 ? String(dailyTargetProgress.targetAmount) : '5000'
                );
                setTargetFormError(null);
                setIsEditingTarget(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold cursor-pointer self-start sm:self-auto"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{dailyTargetProgress.targetAmount > 0 ? 'Edit Target' : 'Set Daily Target'}</span>
            </button>
          ) : (
            <form onSubmit={handleSaveTarget} className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <span className="absolute left-2.5 top-2 text-xs font-bold text-slate-400">₹</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  aria-label="Daily Sales Target Amount"
                  placeholder="e.g. 5000"
                  value={targetAmountInput}
                  onChange={(e) => setTargetAmountInput(e.target.value)}
                  className="w-32 text-xs sm:text-sm font-bold pl-6 pr-2.5 py-1.5 rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingTarget(false);
                  setTargetFormError(null);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </form>
          )}
        </div>

        {targetFormError && (
          <div className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{targetFormError}</div>
        )}

        {dailyTargetProgress.targetAmount > 0 && (
          <div className="mt-3">
            <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  dailyTargetProgress.isAchieved ? 'bg-emerald-600' : 'bg-emerald-500'
                }`}
                style={{ width: `${dailyTargetProgress.progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* QUICK ACTION MODALS                                              */}
      {/* ---------------------------------------------------------------- */}

      {/* Modal 1: Quick Add Customer */}
      {isAddCustomerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Quick Add Customer (Naya Grahak)</h3>
              <button
                type="button"
                onClick={() => setIsAddCustomerModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleQuickAddCustomer} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Anand Sharma"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Mobile Phone</label>
                  <input
                    type="tel"
                    placeholder="9876543210"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Opening Udhar ₹</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={newCustOpenBal}
                    onChange={(e) => setNewCustOpenBal(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Address / Locality</label>
                <input
                  type="text"
                  placeholder="e.g. Near Bus Stand"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddCustomerModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Save &amp; Open Khata
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Quick Receive Payment */}
      {isReceivePaymentModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Receive Payment (Khata Jama)</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Collect customer credit dues into cashbook</p>
              </div>
              <button
                type="button"
                onClick={() => setIsReceivePaymentModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleQuickReceivePayment} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Select Customer *</label>
                <select
                  required
                  value={recCustomerId}
                  onChange={(e) => {
                    setRecCustomerId(e.target.value);
                    const selected = customers.find((c) => c.id === e.target.value);
                    if (selected && selected.currentBalance > 0) {
                      setRecAmount(String(selected.currentBalance));
                    }
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">-- Choose Customer with Dues --</option>
                  {customers
                    .filter((c) => c.currentBalance > 0)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.phone}) - Due: {formatINR(c.currentBalance)}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Payment Amount (Rashi ₹) *</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold text-lg">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="e.g. 500"
                    value={recAmount}
                    onChange={(e) => setRecAmount(e.target.value)}
                    className="w-full text-xl font-bold pl-8 pr-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'UPI', 'BANK'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setRecMethod(m)}
                      className={`py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                        recMethod === m ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 border-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Note</label>
                <input
                  type="text"
                  placeholder="e.g. GooglePay receipt or cash paid at counter"
                  value={recNote}
                  onChange={(e) => setRecNote(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsReceivePaymentModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Confirm Jama Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Quick Add Purchase */}
      {isAddPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Record Inward Stock Purchase</h3>
              <button
                type="button"
                onClick={() => setIsAddPurchaseModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleQuickAddPurchase} className="py-4 space-y-3">
              {purError && (
                <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300">
                  {purError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Wholesale Supplier *</label>
                <select
                  required
                  value={purSupplierId}
                  onChange={(e) => {
                    setPurSupplierId(e.target.value);
                    if (purError) setPurError(null);
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">-- Choose Supplier --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (Pending: {formatINR(s.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Invoice Amount ₹ *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  placeholder="e.g. 14500"
                  value={purAmount}
                  onChange={(e) => {
                    setPurAmount(e.target.value);
                    if (purError) setPurError(null);
                  }}
                  className="w-full text-lg font-bold p-2.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Invoice #</label>
                  <input
                    type="text"
                    placeholder="e.g. BLJ-991"
                    value={purInvoiceNo}
                    onChange={(e) => setPurInvoiceNo(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Status</label>
                  <select
                    value={purStatus}
                    onChange={(e) => {
                      const nextStatus = e.target.value as 'UNPAID' | 'PARTIAL' | 'PAID';
                      setPurStatus(nextStatus);
                      if (nextStatus !== 'PARTIAL') setPurPaidAmount('');
                      if (purError) setPurError(null);
                    }}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="UNPAID">Unpaid (Credit)</option>
                    <option value="PARTIAL">Partial</option>
                    <option value="PAID">Paid in Full</option>
                  </select>
                </div>
              </div>

              {purStatus !== 'UNPAID' && (
                <div className={`grid gap-2 ${purStatus === 'PARTIAL' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {purStatus === 'PARTIAL' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Paid Now ₹ *
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        required
                        placeholder="e.g. 5000"
                        value={purPaidAmount}
                        onChange={(e) => {
                          setPurPaidAmount(e.target.value);
                          if (purError) setPurError(null);
                        }}
                        className="w-full text-sm font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Payment Mode
                    </label>
                    <select
                      value={purMethod}
                      onChange={(e) => setPurMethod(e.target.value as 'BANK' | 'UPI' | 'CASH')}
                      className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      <option value="BANK">Bank Transfer</option>
                      <option value="UPI">UPI</option>
                      <option value="CASH">Cash Drawer (Rokad OUT)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Items / Description</label>
                <input
                  type="text"
                  placeholder="e.g. 20 bags Atta, Ghee tins"
                  value={purDesc}
                  onChange={(e) => setPurDesc(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setPurError(null);
                    setIsAddPurchaseModalOpen(false);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Save Inward Purchase
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Quick Pay Supplier */}
      {isPaySupplierModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Pay Supplier (Vyapari Bhugtan)</h3>
              <button
                type="button"
                onClick={() => setIsPaySupplierModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleQuickPaySupplier} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Select Supplier *</label>
                <select
                  required
                  value={paySupplierId}
                  onChange={(e) => {
                    setPaySupplierId(e.target.value);
                    const selected = suppliers.find((s) => s.id === e.target.value);
                    if (selected && selected.currentBalance > 0) {
                      setPayAmount(String(selected.currentBalance));
                    }
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">-- Choose Supplier to Pay --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} - Outstanding Dues: {formatINR(s.currentBalance)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Payment Amount ₹ *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  placeholder="e.g. 10000"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full text-lg font-bold p-2.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['BANK', 'UPI', 'CASH'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMethod(m)}
                      className={`py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                        payMethod === m ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border-amber-500' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Reference / Note</label>
                <input
                  type="text"
                  placeholder="e.g. Bank NEFT ref #89201"
                  value={payDesc}
                  onChange={(e) => setPayDesc(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPaySupplierModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Confirm Supplier Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 5: Quick Add Expense */}
      {isAddExpenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Record Expense or Cash Drawing</h3>
              <button
                type="button"
                onClick={() => setIsAddExpenseModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleQuickAddExpense} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Amount ₹ *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  placeholder="e.g. 150"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  className="w-full text-lg font-bold p-2.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  autoFocus
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Expense Category
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuickCustomCat((prev) => !prev);
                      setQuickCustomCatError(null);
                    }}
                    className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    {showQuickCustomCat ? 'Close' : '+ Custom'}
                  </button>
                </div>
                <select
                  value={
                    expenseCategories.some((c) => c.id === expCategory)
                      ? expCategory
                      : expenseCategories[0]?.id || expCategory
                  }
                  onChange={(e) => {
                    const val = e.target.value as ExpenseCategory;
                    const matched = expenseCategories.find((c) => c.id === val);
                    setExpCategory(val);
                    setExpIsDrawing(Boolean(matched?.isPersonalDrawing || val === 'PERSONAL_DRAWING'));
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.label}
                    </option>
                  ))}
                </select>
                {showQuickCustomCat && (
                  <div className="mt-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
                    {quickCustomCatError && (
                      <div className="text-[11px] text-red-600 dark:text-rose-400">
                        {quickCustomCatError}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Custom category name"
                        value={quickCustomCatLabel}
                        onChange={(e) => setQuickCustomCatLabel(e.target.value)}
                        className="flex-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const res = addExpenseCategory({
                            label: quickCustomCatLabel,
                            icon: '📝',
                            isPersonalDrawing: false,
                          });
                          if (!res.success || !res.category) {
                            setQuickCustomCatError(res.error || 'Could not add category.');
                            return;
                          }
                          setExpCategory(res.category.id);
                          setExpIsDrawing(Boolean(res.category.isPersonalDrawing));
                          setQuickCustomCatLabel('');
                          setQuickCustomCatError(null);
                          setShowQuickCustomCat(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Title / Description *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tea & samosa for counter helper"
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'UPI', 'BANK'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExpMethod(m)}
                      className={`py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                        expMethod === m ? 'bg-slate-900 dark:bg-emerald-700 text-white border-slate-900 dark:border-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddExpenseModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-900 dark:bg-emerald-700 hover:bg-slate-800 dark:hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
