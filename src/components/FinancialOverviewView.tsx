import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import {
  formatINR,
  getOldestUnpaidCustomer,
  calculateDetailedCashFlow,
  calculateProfitAndLoss,
  calculateMonthlyProfitTrend,
  getApproachingReorderProducts,
  getCustomersWithDuePaymentsOlderThanDays,
  calculateOpeningCashBeforeRange,
  calculateNonCashBankUpiSummary,
  getLocalTodayKey,
  toLocalDayKey,
  isSaleActive,
  matchesLedgerDateFilter,
} from '../utils/accounting';
import {
  TrendingUp,
  ShoppingCart,
  Users,
  Truck,
  Wallet,
  Receipt,
  PackageCheck,
  Percent,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  X,
  Boxes,
  Activity,
  ShieldCheck,
  ArrowLeft,
} from 'lucide-react';
import { Product } from '../types';
import { PeriodFilterBar, getDateFilterLabel } from './PeriodFilterBar';

export const FinancialOverviewView: React.FC = () => {
  const {
    accountingReconciliation,
    customers,
    customerTransactions,
    suppliers,
    supplierTransactions,
    sales,
    filteredSales,
    expenses,
    filteredExpenses,
    cashbookEntries,
    filteredCashbookEntries,
    products,
    updateProductThreshold,
    adjustStock,
    dateFilter,
    customDateRange,
    setActiveTab,
    setReportsActiveTab,
    setSelectedCustomerId,
    setSelectedSupplierId,
  } = useStore();

  // Sales Chart View Toggle: Daily (14 days) vs Monthly (6 months)
  const [salesChartMode, setSalesChartMode] = useState<'DAILY' | 'MONTHLY'>('DAILY');

  // Low Stock Threshold & Restock Modal States
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState(false);
  const [selectedProdForThreshold, setSelectedProdForThreshold] = useState<Product | null>(null);
  const [thresholdInput, setThresholdInput] = useState('');

  const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
  const [selectedProdForRestock, setSelectedProdForRestock] = useState<Product | null>(null);
  const [restockQtyInput, setRestockQtyInput] = useState('');
  const [restockReasonInput, setRestockReasonInput] = useState('Distributor restock delivery');
  const [restockError, setRestockError] = useState<string | null>(null);

  // Filter active products below or approaching their reorder thresholds
  const lowStockProducts = useMemo(() => {
    return products.filter((p) => !p.isArchived && p.stockQty <= p.minStockAlert);
  }, [products]);

  const approachingReorderProducts = useMemo(() => {
    return getApproachingReorderProducts(products);
  }, [products]);

  // Customers with pending ledger entries older than 7 days
  const dueOver7DaysCustomers = useMemo(() => {
    return getCustomersWithDuePaymentsOlderThanDays(customers, customerTransactions, 7);
  }, [customers, customerTransactions]);

  // ----------------------------------------------------
  // SECTION 1: FINANCIAL OVERVIEW METRICS (actual data)
  // ----------------------------------------------------
  const todayStr = getLocalTodayKey();
  const thisMonthPrefix = todayStr.substring(0, 7);

  const todaySales = useMemo(() => {
    return sales
      .filter((s) => isSaleActive(s) && toLocalDayKey(s.date || s.createdAt) === todayStr)
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  }, [sales, todayStr]);

  const monthlySales = useMemo(() => {
    return sales
      .filter((s) => isSaleActive(s) && toLocalDayKey(s.date || s.createdAt).startsWith(thisMonthPrefix))
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  }, [sales, thisMonthPrefix]);

  const totalPurchases = useMemo(() => {
    return supplierTransactions
      .filter(
        (st) =>
          st.status !== 'CANCELLED' &&
          st.status !== 'REVERSED' &&
          st.type === 'PURCHASE' &&
          !(st.description && st.description.toLowerCase().includes('opening balance'))
      )
      .reduce((sum, st) => sum + (Number(st.amount) || 0), 0);
  }, [supplierTransactions]);

  const totalExpenses = useMemo(() => {
    return expenses
      .filter((e) => !e.isPersonalWithdrawal && e.category !== 'PERSONAL_DRAWING')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [expenses]);

  // Products map for accurate COGS
  const productsMap = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const filteredCustomerTxsForPeriod = useMemo(() => {
    return customerTransactions.filter((tx) =>
      matchesLedgerDateFilter(tx.date || tx.createdAt, dateFilter, customDateRange.startDate, customDateRange.endDate)
    );
  }, [customerTransactions, dateFilter, customDateRange]);

  const filteredSupplierTxsForPeriod = useMemo(() => {
    return supplierTransactions.filter((st) =>
      matchesLedgerDateFilter(st.date || st.createdAt, dateFilter, customDateRange.startDate, customDateRange.endDate)
    );
  }, [supplierTransactions, dateFilter, customDateRange]);

  const currentPnl = useMemo(() => {
    return calculateProfitAndLoss(filteredSales, filteredExpenses, productsMap, filteredCustomerTxsForPeriod);
  }, [filteredSales, filteredExpenses, productsMap, filteredCustomerTxsForPeriod]);

  // ----------------------------------------------------
  // SECTION 2: BUSINESS OUTSTANDING METRICS
  // ----------------------------------------------------
  const totalCustomerDues = useMemo(() => {
    return customers.reduce((sum, c) => sum + Math.max(0, Number(c.currentBalance) || 0), 0);
  }, [customers]);

  const totalSupplierDues = useMemo(() => {
    return suppliers.reduce((sum, s) => sum + Math.max(0, Number(s.currentBalance) || 0), 0);
  }, [suppliers]);

  const customersWithDues = useMemo(() => {
    return customers.filter((c) => Number(c.currentBalance) > 0);
  }, [customers]);

  const overdueCustomerAccounts = useMemo(() => {
    return customers.filter((c) => Number(c.currentBalance) > 0 && (Number(c.overdueDays) || 0) >= 30);
  }, [customers]);

  const oldestUnpaidCustomer = useMemo(() => {
    return getOldestUnpaidCustomer(customers);
  }, [customers]);

  // ----------------------------------------------------
  // SECTION 3: CASH FLOW METRICS (strict physical cash + carried-forward opening)
  // ----------------------------------------------------
  const openingCashForRange = useMemo(() => {
    return calculateOpeningCashBeforeRange(cashbookEntries, dateFilter, customDateRange.startDate);
  }, [cashbookEntries, dateFilter, customDateRange.startDate]);

  const detailedCashFlow = useMemo(() => {
    return calculateDetailedCashFlow(openingCashForRange, filteredCashbookEntries);
  }, [openingCashForRange, filteredCashbookEntries]);

  const bankUpiSummary = useMemo(() => {
    return calculateNonCashBankUpiSummary({
      sales: filteredSales,
      customerTransactions: filteredCustomerTxsForPeriod,
      supplierTransactions: filteredSupplierTxsForPeriod,
      expenses: filteredExpenses,
    });
  }, [filteredSales, filteredCustomerTxsForPeriod, filteredSupplierTxsForPeriod, filteredExpenses]);

  // ----------------------------------------------------
  // SECTION 4: BUSINESS ANALYTICS DATA
  // ----------------------------------------------------
  // A. Daily 14 Days Sales Data
  const daily14DaysData = useMemo(() => {
    const list: { label: string; dateStr: string; cash: number; credit: number; total: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dateStr = toLocalDayKey(d);
      const dayLabel = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

      let cashSum = 0;
      let creditSum = 0;
      sales.forEach((s) => {
        if (!isSaleActive(s)) return;
        if (toLocalDayKey(s.date || s.createdAt) === dateStr) {
          if (s.isCredit || s.paymentMethod === 'CREDIT') creditSum += s.amount;
          else cashSum += s.amount;
        }
      });
      list.push({ label: dayLabel, dateStr, cash: cashSum, credit: creditSum, total: cashSum + creditSum });
    }
    return list;
  }, [sales]);

  // B. Monthly 6 Months Sales & P&L Coverage Data
  const monthly6MonthsData = useMemo(() => {
    return calculateMonthlyProfitTrend(sales, expenses, productsMap, customerTransactions, 6);
  }, [sales, expenses, productsMap, customerTransactions]);

  const maxDailySale = Math.max(...daily14DaysData.map((d) => d.total), 4000);
  const maxMonthlySale = Math.max(...monthly6MonthsData.map((m) => m.totalSales), 10000);

  // C. Expense Category Breakdown
  const expenseBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => {
      if (!e.isPersonalWithdrawal && e.category !== 'PERSONAL_DRAWING') {
        map[e.category] = (map[e.category] || 0) + e.amount;
      }
    });
    const items = Object.entries(map).map(([cat, amt]) => ({
      category: cat,
      amount: amt,
    }));
    items.sort((a, b) => b.amount - a.amount);
    return items;
  }, [expenses]);

  const totalExpenseSum = expenseBreakdown.reduce((s, it) => s + it.amount, 0);

  const categoryColors: Record<string, string> = {
    ELECTRICITY: '#f59e0b',
    STAFF: '#059669',
    TRANSPORT: '#3b82f6',
    SHOP: '#8b5cf6',
    BREAKFAST: '#ec4899',
    LUNCH: '#14b8a6',
    DINNER: '#f97316',
    OTHER: '#64748b',
  };

  // D. Cash vs Credit Sales Comparison
  const totalCashSales = useMemo(() => {
    return filteredSales
      .filter((s) => isSaleActive(s) && (s.paymentMethod === 'CASH' || s.paymentMethod === 'UPI' || s.paymentMethod === 'BANK'))
      .reduce((sum, s) => sum + s.amount, 0);
  }, [filteredSales]);

  const totalCreditSales = useMemo(() => {
    return filteredSales
      .filter((s) => isSaleActive(s) && (s.isCredit || s.paymentMethod === 'CREDIT'))
      .reduce((sum, s) => sum + s.amount, 0);
  }, [filteredSales]);

  const totalSalesVolume = totalCashSales + totalCreditSales;
  const cashSharePct = totalSalesVolume > 0 ? Math.round((totalCashSales / totalSalesVolume) * 100) : 0;
  const creditSharePct = totalSalesVolume > 0 ? 100 - cashSharePct : 0;

  // E. Customer Payment Recovery Rate
  const totalCreditEverGiven = useMemo(() => {
    return customers.reduce((sum, c) => sum + (Number(c.totalCreditGiven) || 0), 0);
  }, [customers]);

  const totalPaymentsEverReceived = useMemo(() => {
    return customers.reduce((sum, c) => sum + (Number(c.totalPaymentReceived) || 0), 0);
  }, [customers]);

  const recoveryRatePct =
    totalCreditEverGiven > 0
      ? Math.min(100, Math.round((totalPaymentsEverReceived / totalCreditEverGiven) * 100))
      : 100;

  // F. Supplier Payment Analysis
  const totalSupplierPurchasesEver = useMemo(() => {
    return suppliers.reduce((sum, s) => sum + (Number(s.totalPurchases) || 0), 0);
  }, [suppliers]);

  const totalSupplierPaymentsEver = useMemo(() => {
    return suppliers.reduce((sum, s) => sum + (Number(s.totalPaid) || 0), 0);
  }, [suppliers]);

  const supplierPaidPct =
    totalSupplierPurchasesEver > 0
      ? Math.min(100, Math.round((totalSupplierPaymentsEver / totalSupplierPurchasesEver) * 100))
      : 100;

  // ----------------------------------------------------
  // SECTION 6: RECENT ACTIVITY UNIFIED FEED
  // ----------------------------------------------------
  const recentActivities = useMemo(() => {
    const list: {
      id: string;
      date: string;
      title: string;
      subtitle: string;
      amount: number;
      type: 'SALE' | 'PAYMENT' | 'PURCHASE' | 'EXPENSE';
      method?: string;
      onClick: () => void;
    }[] = [];

    sales
      .filter(isSaleActive)
      .slice(0, 4)
      .forEach((s) => {
        list.push({
          id: `act-s-${s.id}`,
          date: s.date,
          title: s.customerName ? `Sale to ${s.customerName}` : 'Counter Walk-in Sale',
          subtitle: `Bill #${s.invoiceNo} · ${s.paymentMethod}`,
          amount: s.amount,
          type: 'SALE',
          method: s.paymentMethod,
          onClick: () => setActiveTab('SALES'),
        });
      });

    customerTransactions
      .filter((tx) => tx.status !== 'CANCELLED' && tx.status !== 'REVERSED' && tx.type === 'PAYMENT')
      .slice(0, 3)
      .forEach((tx) => {
        const cust = customers.find((c) => c.id === tx.customerId);
        list.push({
          id: `act-tx-${tx.id}`,
          date: tx.date,
          title: `Khata Payment: ${cust?.name || 'Customer'}`,
          subtitle: tx.description || 'Udhar settled',
          amount: tx.amount,
          type: 'PAYMENT',
          method: tx.paymentMethod || 'CASH',
          onClick: () => {
            if (cust) setSelectedCustomerId(cust.id);
            setActiveTab('CUSTOMERS');
          },
        });
      });

    supplierTransactions
      .filter((st) => st.status !== 'CANCELLED' && st.status !== 'REVERSED' && st.type === 'PURCHASE')
      .slice(0, 3)
      .forEach((st) => {
        const sup = suppliers.find((s) => s.id === st.supplierId);
        list.push({
          id: `act-p-${st.id}`,
          date: st.date,
          title: `Purchase from ${sup?.name || 'Wholesaler'}`,
          subtitle: st.invoiceNo ? `Inv #${st.invoiceNo} · ${st.paymentStatus}` : st.description,
          amount: st.amount,
          type: 'PURCHASE',
          onClick: () => {
            if (sup) setSelectedSupplierId(sup.id);
            setActiveTab('PURCHASES');
          },
        });
      });

    expenses.slice(0, 3).forEach((exp) => {
      list.push({
        id: `act-e-${exp.id}`,
        date: exp.date,
        title: exp.title,
        subtitle: `${exp.category} · ${exp.isPersonalWithdrawal ? 'Drawing' : 'Shop Expense'}`,
        amount: exp.amount,
        type: 'EXPENSE',
        method: exp.paymentMethod,
        onClick: () => setActiveTab('EXPENSES'),
      });
    });

    list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return list.slice(0, 6);
  }, [sales, customerTransactions, supplierTransactions, expenses, customers, suppliers, setActiveTab, setSelectedCustomerId, setSelectedSupplierId]);

  // ----------------------------------------------------
  // SECTION 7: SMART ALERTS DATA
  // ----------------------------------------------------
  const smartAlerts = useMemo(() => {
    const list: {
      id: string;
      title: string;
      message: string;
      severity: 'HIGH' | 'MEDIUM' | 'WARNING';
      actionLabel: string;
      action: () => void;
      icon: React.ReactNode;
    }[] = [];

    customers.forEach((c) => {
      if (c.currentBalance > 0 && c.overdueDays >= 30) {
        list.push({
          id: `sa-c-${c.id}`,
          title: `Overdue Udhar: ${c.name}`,
          message: `${formatINR(c.currentBalance)} pending for ${c.overdueDays} days.`,
          severity: c.overdueDays >= 90 ? 'HIGH' : 'MEDIUM',
          actionLabel: 'View Khata',
          action: () => {
            setSelectedCustomerId(c.id);
            setActiveTab('CUSTOMERS');
          },
          icon: <Clock className="w-4 h-4 text-red-600" />,
        });
      }
    });

    products.forEach((p) => {
      if (p.isArchived) return;
      if (p.stockQty <= p.minStockAlert) {
        list.push({
          id: `sa-p-${p.id}`,
          title: `Low Stock: ${p.name}`,
          message: `Only ${p.stockQty} ${p.unit} remaining (Threshold: ${p.minStockAlert}).`,
          severity: p.stockQty <= 2 ? 'HIGH' : 'WARNING',
          actionLabel: 'Restock',
          action: () => setActiveTab('INVENTORY'),
          icon: <Boxes className="w-4 h-4 text-amber-600" />,
        });
      }
    });

    approachingReorderProducts.slice(0, 2).forEach(({ product, bufferRemaining }) => {
      list.push({
        id: `sa-app-${product.id}`,
        title: `Nearing Reorder: ${product.name}`,
        message: `${product.stockQty} ${product.unit} left (${bufferRemaining} ${product.unit} above threshold ${product.minStockAlert}).`,
        severity: 'WARNING',
        actionLabel: 'Review Stock',
        action: () => setActiveTab('INVENTORY'),
        icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      });
    });

    suppliers.forEach((s) => {
      if (s.currentBalance >= 15000) {
        list.push({
          id: `sa-s-${s.id}`,
          title: `Supplier Due: ${s.name}`,
          message: `Pending invoice balance of ${formatINR(s.currentBalance)} to wholesaler.`,
          severity: 'MEDIUM',
          actionLabel: 'Pay Supplier',
          action: () => {
            setSelectedSupplierId(s.id);
            setActiveTab('SUPPLIERS');
          },
          icon: <Truck className="w-4 h-4 text-blue-600" />,
        });
      }
    });

    if (detailedCashFlow.closingCash < 1000) {
      list.push({
        id: 'sa-cash-low',
        title: 'Low Cash In Counter',
        message: `Available drawer cash is ${formatINR(detailedCashFlow.closingCash)}. Keep sufficient small change.`,
        severity: detailedCashFlow.closingCash < 0 ? 'HIGH' : 'WARNING',
        actionLabel: 'Check Rokad',
        action: () => setActiveTab('CASHBOOK'),
        icon: <Wallet className="w-4 h-4 text-red-600" />,
      });
    }

    return list.slice(0, 5);
  }, [customers, products, approachingReorderProducts, suppliers, detailedCashFlow, setActiveTab, setSelectedCustomerId, setSelectedSupplierId]);

  const handleUpdateThresholdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProdForThreshold) return;
    const val = parseFloat(thresholdInput);
    if (isNaN(val) || val < 0) return;
    updateProductThreshold(selectedProdForThreshold.id, val);
    setIsThresholdModalOpen(false);
    setSelectedProdForThreshold(null);
  };

  const handleRestockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProdForRestock) return;
    const qty = parseFloat(restockQtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setRestockError('Please enter a positive restock quantity greater than zero.');
      return;
    }
    const trimmedReason = restockReasonInput.trim();
    if (trimmedReason.length < 3) {
      setRestockError('Please enter a clear restock reason (at least 3 characters).');
      return;
    }
    const res = adjustStock(selectedProdForRestock.id, qty, trimmedReason);
    if (!res.success) {
      setRestockError(res.error || 'Could not update stock.');
      return;
    }
    setRestockError(null);
    setIsRestockModalOpen(false);
    setSelectedProdForRestock(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Financial Overview &amp; Business Insights
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            P&amp;L, business outstanding, cash flow, charts, and shop alerts
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('DASHBOARD')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </button>
      </div>

      {!accountingReconciliation.isFullyReconciled && (
        <div
          className={`rounded-2xl p-3.5 border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
            accountingReconciliation.hasCriticalIssues
              ? 'bg-red-50/70 dark:bg-red-950/35 border-red-200 dark:border-red-900'
              : 'bg-amber-50/70 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800'
          }`}
        >
          <div className="flex items-start sm:items-center gap-2.5">
            <ShieldCheck
              className={`w-5 h-5 shrink-0 ${
                accountingReconciliation.hasCriticalIssues
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-700 dark:text-amber-300'
              }`}
            />
            <div className="text-xs text-slate-800 dark:text-slate-200">
              <span className="font-bold">Accounting Reconciliation Notice:</span>{' '}
              {accountingReconciliation.countsBySeverity.critical > 0 &&
                `${accountingReconciliation.countsBySeverity.critical} critical `}
              {accountingReconciliation.countsBySeverity.warning > 0 &&
                `${accountingReconciliation.countsBySeverity.warning} warning `}
              item(s) need review in your read-only audit report.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setReportsActiveTab('RECONCILIATION');
              setActiveTab('REPORTS');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-slate-800 cursor-pointer shrink-0 self-start sm:self-auto"
          >
            <span>Open Reconciliation Audit</span>
            <span>&rarr;</span>
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* SECTION 1: FINANCIAL OVERVIEW (6 Clickable Cards)                 */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
            1. Financial Overview
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Click any card to open detailed register</span>
        </div>

        <PeriodFilterBar label="View Data For" className="mb-3.5" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* 1. Today's Sales */}
          <div
            onClick={() => setActiveTab('SALES')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/70 shadow-xs hover:shadow-md hover:border-emerald-500 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Today's Sales</span>
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 group-hover:scale-110 transition-transform">
                <ShoppingCart className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">Aaj ki kul bikri</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2 tabular-nums">{formatINR(todaySales)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Actual sales today</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium group-hover:translate-x-0.5 transition-transform">View Sales &rarr;</span>
            </div>
          </div>

          {/* 2. Monthly Sales */}
          <div
            onClick={() => setActiveTab('SALES')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/70 shadow-xs hover:shadow-md hover:border-emerald-500 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Monthly Sales</span>
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 group-hover:scale-110 transition-transform">
                <Calendar className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">Is mahine ki kul bikri</div>
            <div className="text-2xl sm:text-[1.65rem] font-extrabold tracking-tight text-emerald-700 dark:text-emerald-300 mt-2.5 tabular-nums leading-none">{formatINR(monthlySales)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Current month total</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium group-hover:translate-x-0.5 transition-transform">Sales History &rarr;</span>
            </div>
          </div>

          {/* 3. Total Purchases */}
          <div
            onClick={() => setActiveTab('PURCHASES')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900/70 shadow-xs hover:shadow-md hover:border-blue-500 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total Purchases</span>
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 group-hover:scale-110 transition-transform">
                <PackageCheck className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">Kul maal aavak (kharid)</div>
            <div className="text-2xl sm:text-[1.65rem] font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-2.5 tabular-nums leading-none">{formatINR(totalPurchases)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>From registered suppliers</span>
              <span className="text-blue-700 dark:text-blue-400 font-medium group-hover:translate-x-0.5 transition-transform">Purchase Bills &rarr;</span>
            </div>
          </div>

          {/* 4. Total Expenses */}
          <div
            onClick={() => setActiveTab('EXPENSES')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-md hover:border-slate-400 dark:hover:border-slate-600 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total Expenses</span>
              <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 group-hover:scale-110 transition-transform">
                <Receipt className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">Dukan sanchalan kharch</div>
            <div className="text-2xl sm:text-[1.65rem] font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-2.5 tabular-nums leading-none">{formatINR(totalExpenses)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Operating costs (excl. drawings)</span>
              <span className="text-slate-700 dark:text-slate-300 font-medium group-hover:translate-x-0.5 transition-transform">Expenses &rarr;</span>
            </div>
          </div>

          {/* 5. Gross Profit (Verified vs Provisional) */}
          <div
            onClick={() => setActiveTab('ANALYTICS')}
            className={`p-4 rounded-xl border shadow-xs hover:shadow-md transition-all cursor-pointer group ${
              currentPnl.isProfitVerified
                ? 'bg-emerald-50/20 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900/70 hover:border-emerald-500'
                : 'bg-amber-50/30 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 hover:border-amber-500'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    currentPnl.isProfitVerified
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : 'text-amber-900 dark:text-amber-300'
                  }`}
                >
                  {currentPnl.isProfitVerified ? 'Verified Gross Profit' : 'Provisional Gross Profit'}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    currentPnl.reviewStatus === 'RECONCILED'
                      ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                      : 'bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {currentPnl.reviewStatus}
                </span>
              </div>
              <div
                className={`p-2 rounded-lg shrink-0 group-hover:scale-110 transition-transform ${
                  currentPnl.isProfitVerified
                    ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                    : 'bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200'
                }`}
              >
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-0.5">
              {currentPnl.isProfitVerified
                ? 'Gross profit (bikri - maal laagat)'
                : `Partial/unverified · ${currentPnl.costCoveragePct}% costed`}
            </div>
            {currentPnl.isProfitVerified ? (
              <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-300 mt-2 tabular-nums">
                {formatINR(currentPnl.verifiedGrossProfit ?? 0)}
              </div>
            ) : currentPnl.profitStatus === 'UNCOSTED' || currentPnl.knownCostGrossProfit === null ? (
              <div className="mt-2">
                <div className="text-lg font-bold text-amber-900 dark:text-amber-200">
                  Profit Unverified
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-300 tabular-nums">
                  Uncosted Sales: {formatINR(currentPnl.uncostedRevenue)}
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <div className="text-2xl font-bold text-amber-900 dark:text-amber-200 tabular-nums">
                  {formatINR(currentPnl.knownCostGrossProfit)}
                  <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 ml-1">
                    (Known-Cost)
                  </span>
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-300 tabular-nums">
                  Uncosted Rev: {formatINR(currentPnl.uncostedRevenue)}
                </div>
              </div>
            )}
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>
                {currentPnl.isProfitVerified
                  ? `Margin: ${currentPnl.verifiedGrossMarginPct ?? 0}% · 100% costed`
                  : currentPnl.knownCostGrossMarginPct !== null
                  ? `Known-Cost Margin: ${currentPnl.knownCostGrossMarginPct}% · ${currentPnl.costCoveragePct}% costed`
                  : `Margin N/A · ${currentPnl.costCoveragePct}% costed`}
              </span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium group-hover:translate-x-0.5 transition-transform">P&amp;L View &rarr;</span>
            </div>
          </div>

          {/* 6. Net Profit (Verified vs Provisional) */}
          <div
            onClick={() => setActiveTab('ANALYTICS')}
            className={`p-4 rounded-xl border shadow-xs hover:shadow-md transition-all cursor-pointer group ${
              currentPnl.isProfitVerified
                ? 'bg-emerald-50/40 dark:bg-emerald-950/35 border-emerald-300 dark:border-emerald-800 hover:border-emerald-500'
                : 'bg-amber-50/40 dark:bg-amber-950/25 border-amber-300 dark:border-amber-800 hover:border-amber-500'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    currentPnl.isProfitVerified
                      ? 'text-emerald-950 dark:text-emerald-200'
                      : 'text-amber-950 dark:text-amber-200'
                  }`}
                >
                  {currentPnl.isProfitVerified ? 'Verified Net Profit' : 'Provisional Net Profit'}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    currentPnl.reviewStatus === 'RECONCILED'
                      ? 'bg-emerald-200/80 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200'
                      : 'bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {currentPnl.reviewStatus}
                </span>
              </div>
              <div
                className={`p-2 rounded-lg shrink-0 group-hover:scale-110 transition-transform ${
                  currentPnl.isProfitVerified
                    ? 'bg-emerald-200/80 dark:bg-emerald-900 text-emerald-950 dark:text-emerald-200'
                    : 'bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-200'
                }`}
              >
                <Percent className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-0.5">
              {currentPnl.isProfitVerified
                ? 'Net profit (dukan kharch katkar)'
                : 'Incomplete/unverified COGS — provisional only'}
            </div>
            {currentPnl.isProfitVerified ? (
              <div
                className={`text-2xl font-extrabold mt-2 tabular-nums ${
                  (currentPnl.verifiedNetOperatingProfit ?? 0) >= 0
                    ? 'text-emerald-950 dark:text-emerald-200'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {formatINR(currentPnl.verifiedNetOperatingProfit ?? 0)}
              </div>
            ) : currentPnl.profitStatus === 'UNCOSTED' || currentPnl.knownCostGrossProfit === null ? (
              <div className="mt-2">
                <div className="text-lg font-extrabold text-amber-900 dark:text-amber-200">
                  Profit Unverified
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-300 tabular-nums">
                  Op. Exp: {formatINR(currentPnl.operatingExpenses)} · Uncosted: {formatINR(currentPnl.uncostedRevenue)}
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <div
                  className={`text-2xl font-extrabold tabular-nums ${
                    currentPnl.knownCostGrossProfit - currentPnl.operatingExpenses >= 0
                      ? 'text-amber-900 dark:text-amber-200'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatINR(Math.round((currentPnl.knownCostGrossProfit - currentPnl.operatingExpenses) * 100) / 100)}
                  <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 ml-1">
                    (Known-Cost)
                  </span>
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-300 tabular-nums">
                  Excludes {formatINR(currentPnl.uncostedRevenue)} uncosted sales
                </div>
              </div>
            )}
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>
                {currentPnl.isProfitVerified
                  ? `Net Margin: ${currentPnl.verifiedNetMarginPct ?? 0}%`
                  : `Margin Unverified · ${currentPnl.costCoveragePct}% costed`}
              </span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium group-hover:translate-x-0.5 transition-transform">Detailed P&amp;L &rarr;</span>
            </div>
          </div>
        </div>

        {!currentPnl.isProfitVerified && (currentPnl.grossRevenue > 0 || currentPnl.salesReturns > 0) && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start sm:items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
              <span>
                <strong>Provisional P&amp;L ({currentPnl.reviewStatus}):</strong>{' '}
                Cost coverage is <strong>{currentPnl.costCoveragePct}%</strong> with{' '}
                <strong>{formatINR(currentPnl.uncostedRevenue)}</strong> in uncosted sales revenue.
                {(currentPnl.ambiguousReturnsCount > 0 ||
                  currentPnl.uncostedReturnsCount > 0 ||
                  currentPnl.unreconstructibleUnitItemsCount > 0) &&
                  ' Unresolved returns or missing units require manual review.'}{' '}
                Missing historical cost is never treated as ₹0 purchase cost.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('REPORTS')}
              className="text-xs font-bold text-amber-900 dark:text-amber-200 underline shrink-0 cursor-pointer self-start sm:self-auto"
            >
              Open Audit &rarr;
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* SECTION 2: BUSINESS OUTSTANDING (5 Key Indicators & Oldest Callout)*/}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
            2. Business Outstanding (Bakaya &amp; Dues)
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Customer Receivables &amp; Supplier Payables</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: Total Customer Dues */}
          <div
            onClick={() => setActiveTab('CUSTOMERS')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/70 shadow-xs hover:shadow-md hover:border-red-400 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total Customer Dues</span>
              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 group-hover:scale-110 transition-transform">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">Grahakon se lena hai (Udhar)</div>
            <div className="text-2xl sm:text-[1.65rem] font-extrabold tracking-tight text-rose-600 dark:text-rose-400 mt-2.5 tabular-nums leading-none">{formatINR(totalCustomerDues)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Receivables</span>
              <span className="text-red-600 dark:text-red-400 font-medium group-hover:translate-x-0.5 transition-transform">Open Khata &rarr;</span>
            </div>
          </div>

          {/* Card 2: Total Supplier Dues */}
          <div
            onClick={() => setActiveTab('SUPPLIERS')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/70 shadow-xs hover:shadow-md hover:border-amber-400 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total Supplier Dues</span>
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 group-hover:scale-110 transition-transform">
                <Truck className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">Vyapari ko dena hai</div>
            <div className="text-2xl sm:text-[1.65rem] font-extrabold tracking-tight text-amber-700 dark:text-amber-400 mt-2.5 tabular-nums leading-none">{formatINR(totalSupplierDues)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Payables</span>
              <span className="text-amber-700 dark:text-amber-400 font-medium group-hover:translate-x-0.5 transition-transform">Suppliers &rarr;</span>
            </div>
          </div>

          {/* Card 3: Customers with Pending Balances */}
          <div
            onClick={() => setActiveTab('CUSTOMERS')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-md hover:border-slate-400 dark:hover:border-slate-600 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Pending Customer Accounts</span>
              <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 group-hover:scale-110 transition-transform">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">Bakaya grahak count</div>
            <div className="text-2xl sm:text-[1.65rem] font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-2.5 tabular-nums leading-none">
              {customersWithDues.length} <span className="text-xs font-medium text-slate-400 dark:text-slate-500">of {customers.length} total</span>
            </div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Accounts with balance &gt; 0</span>
              <span className="text-slate-700 dark:text-slate-300 font-medium group-hover:translate-x-0.5 transition-transform">View All &rarr;</span>
            </div>
          </div>

          {/* Card 4: Overdue Customer Accounts */}
          <div
            onClick={() => setActiveTab('CUSTOMERS')}
            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/70 shadow-xs hover:shadow-md hover:border-red-400 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Overdue Accounts (&gt;30d)</span>
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 group-hover:scale-110 transition-transform">
                <Clock className="w-5 h-5" />
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1">30 din se purane khate</div>
            <div className="text-2xl sm:text-[1.65rem] font-extrabold tracking-tight text-rose-700 dark:text-rose-400 mt-2.5 tabular-nums leading-none">
              {overdueCustomerAccounts.length} <span className="text-xs font-medium text-slate-400 dark:text-slate-500">customers</span>
            </div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Needs immediate recovery</span>
              <span className="text-red-700 dark:text-red-400 font-medium group-hover:translate-x-0.5 transition-transform">Followup &rarr;</span>
            </div>
          </div>
        </div>

        {/* Card 5: Oldest Unpaid Customer Balance Specific Callout */}
        {oldestUnpaidCustomer && (
          <div
            onClick={() => {
              setSelectedCustomerId(oldestUnpaidCustomer.id);
              setActiveTab('CUSTOMERS');
            }}
            className="mt-3.5 p-4 rounded-xl bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-red-50 dark:hover:bg-red-950/45 cursor-pointer transition-colors"
          >
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2.5 bg-red-600 text-white rounded-xl shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase text-red-800 dark:text-red-300 tracking-wider">Oldest Unpaid Customer Balance</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-200 dark:bg-red-900/70 text-red-900 dark:text-red-200">
                    {oldestUnpaidCustomer.overdueDays} Days Pending
                  </span>
                </div>
                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-0.5">
                  {oldestUnpaidCustomer.name} · <span className="font-normal text-xs text-slate-600 dark:text-slate-300">Mob: {oldestUnpaidCustomer.phone}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {oldestUnpaidCustomer.notes || 'No notes added'}
                </p>
              </div>
            </div>

            <div className="flex items-center sm:text-right justify-between sm:justify-end gap-4 shrink-0 border-t sm:border-t-0 border-red-200/80 dark:border-red-900 pt-2 sm:pt-0">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Pending Amount</div>
                <div className="text-xl sm:text-2xl font-extrabold tracking-tight text-rose-700 dark:text-rose-400 tabular-nums leading-none mt-0.5">{formatINR(oldestUnpaidCustomer.currentBalance)}</div>
              </div>
              <span className="text-xs font-bold text-red-700 dark:text-red-300 px-3 py-1.5 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 rounded-lg shadow-2xs hover:bg-red-50 dark:hover:bg-red-950/60">
                Open Ledger &rarr;
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* SECTION 3: CASH FLOW (6 Cards With Strict Cash Rules)             */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
            3. Cash Flow (Rokad Aavak-Javak)
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {getDateFilterLabel(dateFilter, customDateRange)} drawer flow · Click to view Rokad Bahi
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* 1. Opening Cash */}
          <div
            onClick={() => setActiveTab('CASHBOOK')}
            className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-emerald-500 transition-all cursor-pointer"
          >
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">Opening Cash</div>
            <div className="text-[10px] text-slate-400">Shuruati galla</div>
            <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-1.5 tabular-nums">
              {formatINR(detailedCashFlow.openingCash)}
            </div>
          </div>

          {/* 2. Cash Received */}
          <div
            onClick={() => setActiveTab('CASHBOOK')}
            className="p-3.5 bg-emerald-50/20 dark:bg-emerald-950/25 rounded-xl border border-emerald-200 dark:border-emerald-900/70 shadow-xs hover:border-emerald-500 transition-all cursor-pointer"
          >
            <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">Cash Received</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">Nakad bikri + jama</div>
            <div className="text-lg sm:text-xl font-extrabold tracking-tight text-emerald-700 dark:text-emerald-300 mt-2 tabular-nums leading-none">
              + {formatINR(detailedCashFlow.cashReceived)}
            </div>
          </div>

          {/* 3. Cash Paid */}
          <div
            onClick={() => setActiveTab('CASHBOOK')}
            className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-red-200 dark:border-red-900/70 shadow-xs hover:border-red-400 transition-all cursor-pointer"
          >
            <div className="text-[11px] font-bold text-red-700 dark:text-red-400 uppercase">Cash Paid</div>
            <div className="text-[10px] text-red-500 dark:text-red-400">Vyapari nakad bhugtan</div>
            <div className="text-base sm:text-lg font-bold text-red-600 dark:text-red-400 mt-1.5 tabular-nums">
              - {formatINR(detailedCashFlow.cashPaid)}
            </div>
          </div>

          {/* 4. Daily Expenses */}
          <div
            onClick={() => setActiveTab('CASHBOOK')}
            className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-slate-400 transition-all cursor-pointer"
          >
            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">Daily Expenses</div>
            <div className="text-[10px] text-slate-400">Dukan nakad kharch</div>
            <div className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100 mt-2 tabular-nums leading-none">
              - {formatINR(detailedCashFlow.dailyExpenses)}
            </div>
          </div>

          {/* 5. Cash Withdrawals (Drawings) */}
          <div
            onClick={() => setActiveTab('CASHBOOK')}
            className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-amber-200/80 dark:border-amber-900/70 shadow-2xs hover:border-emerald-400 hover:shadow-xs transition-all cursor-pointer"
          >
            <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide">Cash Withdrawals</div>
            <div className="text-[10px] text-amber-600/90 dark:text-amber-400">Malik niji nikasi</div>
            <div className="text-lg sm:text-xl font-extrabold tracking-tight text-amber-800 dark:text-amber-200 mt-2 tabular-nums leading-none">
              - {formatINR(detailedCashFlow.cashWithdrawals)}
            </div>
          </div>

          {/* 6. Closing Cash Balance */}
          <div
            onClick={() => setActiveTab('CASHBOOK')}
            className="p-3.5 bg-emerald-50/40 dark:bg-emerald-950/35 rounded-xl border border-emerald-300 dark:border-emerald-800 shadow-xs hover:border-emerald-600 transition-all cursor-pointer"
          >
            <div className="text-[11px] font-bold text-emerald-950 dark:text-emerald-200 uppercase">Closing Cash</div>
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400">Galla antim shesh</div>
            <div className="text-lg sm:text-xl font-extrabold tracking-tight text-emerald-900 dark:text-emerald-200 mt-2 tabular-nums leading-none">
              {formatINR(detailedCashFlow.closingCash)}
            </div>
          </div>
        </div>

        {/* Non-Cash Bank / UPI Summary & Owner Capital Strip */}
        <div className="mt-3 px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 sm:gap-5 tabular-nums">
            <span className="font-bold text-slate-700 dark:text-slate-200">Non-Cash Bank / UPI (Separate from Drawer):</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
              Inflows: +{formatINR(bankUpiSummary.totalBankUpiInflows)}
            </span>
            <span className="text-red-600 dark:text-red-400 font-semibold">
              Outflows: -{formatINR(bankUpiSummary.totalBankUpiOutflows)}
            </span>
            <span className="font-bold text-slate-900 dark:text-slate-100">
              Net Digital Flow: {formatINR(bankUpiSummary.netBankUpiFlow)}
            </span>
          </div>
          {detailedCashFlow.ownerContributions > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 font-bold text-[11px] tabular-nums">
              Owner Capital In (Not Sales): {formatINR(detailedCashFlow.ownerContributions)}
            </span>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* SECTION 4: BUSINESS ANALYTICS CHARTS                             */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
            4. Business Analytics &amp; Visual Charts
          </h3>
          <button
            type="button"
            onClick={() => setActiveTab('ANALYTICS')}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
          >
            Open Full Analytics Suite &rarr;
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Chart 1: Daily and Monthly Sales Chart (7 cols) */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">Sales Trends &amp; Volume</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Calculated from actual completed counter invoices</p>
                </div>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setSalesChartMode('DAILY')}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      salesChartMode === 'DAILY' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-bold shadow-2xs' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Daily (14d)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesChartMode('MONTHLY')}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      salesChartMode === 'MONTHLY' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-bold shadow-2xs' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Monthly (6m)
                  </button>
                </div>
              </div>

              {/* Bar Chart Renderer */}
              <div className="py-5">
                {salesChartMode === 'DAILY' ? (
                  <div className="h-52 flex items-end justify-between gap-1 sm:gap-2 px-1">
                    {daily14DaysData.map((d, i) => {
                      const heightPct = Math.min(100, Math.max(10, (d.total / maxDailySale) * 100));
                      const cashPct = d.total > 0 ? (d.cash / d.total) * 100 : 100;
                      const creditPct = d.total > 0 ? (d.credit / d.total) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center h-full justify-end group">
                          <div className="text-[9px] font-bold text-slate-600 dark:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity mb-1 whitespace-nowrap">
                            {formatINR(d.total, false)}
                          </div>
                          <div
                            className="w-full max-w-[28px] rounded-t-sm overflow-hidden flex flex-col justify-end bg-slate-100 dark:bg-slate-800 shadow-2xs group-hover:brightness-105"
                            style={{ height: `${heightPct}%` }}
                          >
                            {creditPct > 0 && (
                              <div className="w-full bg-red-500" style={{ height: `${creditPct}%` }} />
                            )}
                            <div className="w-full bg-emerald-600" style={{ height: `${cashPct}%` }} />
                          </div>
                          <div className="mt-1.5 text-[9px] text-slate-500 dark:text-slate-400 truncate w-full text-center">
                            {d.label.split(' ')[0]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="h-52 flex items-end justify-between gap-3 px-3">
                      {monthly6MonthsData.map((m, i) => {
                        const heightPct = Math.min(100, Math.max(12, (m.totalSales / maxMonthlySale) * 100));
                        const hasActivity = m.totalSales > 0 || m.salesReturns > 0;
                        const isIncomplete = hasActivity && !m.isProfitVerified;
                        return (
                          <div
                            key={i}
                            className="flex-1 flex flex-col items-center h-full justify-end group"
                            title={`${m.label}: Sales ${formatINR(m.totalSales)} · ${m.costCoveragePct}% costed · Uncosted ${formatINR(m.uncostedRevenue)} · Status: ${m.reviewStatus}`}
                          >
                            <div className="text-[10px] font-bold text-slate-700 dark:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity mb-1 whitespace-nowrap">
                              {formatINR(m.totalSales)}
                            </div>
                            <div
                              className={`w-full max-w-[48px] rounded-t-lg transition-colors shadow-xs ${
                                isIncomplete
                                  ? 'bg-amber-600 group-hover:bg-amber-500 border-t-2 border-amber-300'
                                  : 'bg-emerald-700 group-hover:bg-emerald-600'
                              }`}
                              style={{ height: `${heightPct}%` }}
                            />
                            <div className="mt-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">{m.label}</div>
                            {hasActivity && (
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.2 rounded mt-0.5 ${
                                  m.isProfitVerified
                                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                                }`}
                              >
                                {m.isProfitVerified ? '100%' : `${m.costCoveragePct}%`}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* 6-Month P&L Coverage & Review Status Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      {monthly6MonthsData.map((m) => {
                        const hasActivity = m.totalSales > 0 || m.salesReturns > 0;
                        return (
                          <div
                            key={m.prefix}
                            className={`p-2 rounded-lg border text-[10px] ${
                              !hasActivity
                                ? 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500'
                                : m.isProfitVerified
                                ? 'bg-emerald-50/40 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900'
                                : 'bg-amber-50/50 dark:bg-amber-950/25 border-amber-200 dark:border-amber-800'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 font-bold text-slate-800 dark:text-slate-200">
                              <span>{m.label}</span>
                              {hasActivity && (
                                <span
                                  className={`px-1 py-0.2 rounded text-[9px] ${
                                    m.reviewStatus === 'RECONCILED'
                                      ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                                      : 'bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200'
                                  }`}
                                >
                                  {m.reviewStatus}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-600 dark:text-slate-400 tabular-nums mt-0.5">
                              Sales: {formatINR(m.totalSales)}
                            </div>
                            {hasActivity && (
                              <div className="tabular-nums mt-0.5">
                                {m.isProfitVerified ? (
                                  <span className="text-emerald-800 dark:text-emerald-300 font-semibold">
                                    Profit: {formatINR(m.verifiedGrossProfit ?? 0)} (100%)
                                  </span>
                                ) : m.profitStatus === 'UNCOSTED' || m.knownCostGrossProfit === null ? (
                                  <span className="text-amber-800 dark:text-amber-300 font-semibold">
                                    Unverified · {m.costCoveragePct}% costed
                                  </span>
                                ) : (
                                  <span className="text-amber-800 dark:text-amber-300 font-semibold">
                                    Prov: {formatINR(m.knownCostGrossProfit)} ({m.costCoveragePct}% costed)
                                  </span>
                                )}
                              </div>
                            )}
                            {m.uncostedRevenue > 0 && (
                              <div className="text-amber-700 dark:text-amber-400 tabular-nums">
                                Uncosted: {formatINR(m.uncostedRevenue)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
              {salesChartMode === 'DAILY' ? (
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" /> Cash / UPI Sales
                  </span>
                  <span className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-xs bg-red-500 inline-block" /> Credit (Udhar)
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-700 inline-block" /> 100% Costed (RECONCILED)
                  </span>
                  <span className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block" /> Provisional / Incomplete COGS
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setActiveTab('SALES')}
                className="text-emerald-700 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
              >
                View Register &rarr;
              </button>
            </div>
          </div>

          {/* Chart 2: Expense Category Breakdown (5 cols) */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">Expense Category Breakdown</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Operating costs proportion</p>
                </div>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatINR(totalExpenseSum)}</span>
              </div>

              <div className="py-4 space-y-3.5">
                {expenseBreakdown.length === 0 ? (
                  <div className="text-xs text-slate-400 py-8 text-center">No expenses recorded yet</div>
                ) : (
                  expenseBreakdown.map((item) => {
                    const pct = totalExpenseSum > 0 ? Math.round((item.amount / totalExpenseSum) * 100) : 0;
                    const color = categoryColors[item.category] || '#64748b';
                    return (
                      <div key={item.category} className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-slate-700 dark:text-slate-300 capitalize flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
                            <span>{item.category.toLowerCase().replace('_', ' ')}</span>
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                            {formatINR(item.amount)} <span className="text-slate-400 font-normal">({pct}%)</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-100/90 dark:bg-slate-800/90 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('EXPENSES')}
              className="w-full py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-center cursor-pointer"
            >
              Manage All Expenses &rarr;
            </button>
          </div>
        </div>

        {/* 3 Secondary Analytics Indicators: Cash vs Credit, Recovery Rate, Supplier Paid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-4">
          {/* A. Cash vs Credit Sales */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Cash vs Credit Sales</div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-bold text-emerald-800 dark:text-emerald-300">{cashSharePct}% Cash</span>
              <span className="text-xs font-bold text-red-600 dark:text-red-400">{creditSharePct}% Credit</span>
            </div>
            <div className="w-full bg-red-100 dark:bg-red-950/60 h-2.5 rounded-full overflow-hidden mt-2 flex">
              <div className="bg-emerald-600 h-full" style={{ width: `${cashSharePct}%` }} />
              <div className="bg-red-500 h-full" style={{ width: `${creditSharePct}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 flex justify-between">
              <span>Cash: {formatINR(totalCashSales)}</span>
              <span>Udhar: {formatINR(totalCreditSales)}</span>
            </div>
          </div>

          {/* B. Customer Payment Recovery Rate */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Udhar Recovery Rate</div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-bold text-emerald-800 dark:text-emerald-300">{recoveryRatePct}% Recovered</span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {recoveryRatePct >= 70 ? 'Good Pace' : 'Needs Collection'}
              </span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mt-2">
              <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${recoveryRatePct}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 flex justify-between">
              <span>Collected: {formatINR(totalPaymentsEverReceived)}</span>
              <span>Given: {formatINR(totalCreditEverGiven)}</span>
            </div>
          </div>

          {/* C. Supplier Payment Analysis */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Supplier Settlement Ratio</div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-bold text-blue-800 dark:text-blue-300">{supplierPaidPct}% Settled</span>
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Dues: {formatINR(totalSupplierDues)}</span>
            </div>
            <div className="w-full bg-amber-100 dark:bg-amber-950/60 h-2.5 rounded-full overflow-hidden mt-2">
              <div className="bg-blue-600 h-full rounded-full" style={{ width: `${supplierPaidPct}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 flex justify-between">
              <span>Paid: {formatINR(totalSupplierPaymentsEver)}</span>
              <span>Purchased: {formatINR(totalSupplierPurchasesEver)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* DUE PAYMENTS (>7 DAYS PENDING) DASHBOARD ALERT                   */}
      {/* ---------------------------------------------------------------- */}
      <div
        className={`rounded-2xl p-5 border shadow-xs transition-all ${
          dueOver7DaysCustomers.length > 0
            ? 'bg-red-50/40 dark:bg-red-950/25 border-red-200 dark:border-red-900'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200/80 dark:border-slate-800 gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl shrink-0 ${
                dueOver7DaysCustomers.length > 0
                  ? 'bg-red-600 text-white'
                  : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  Due Payments Alert (&gt;7 Days Pending)
                </h3>
                {dueOver7DaysCustomers.length > 0 ? (
                  <span className="text-xs font-extrabold px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/70 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800 tabular-nums">
                    {dueOver7DaysCustomers.length} {dueOver7DaysCustomers.length === 1 ? 'Customer' : 'Customers'} Due
                  </span>
                ) : (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                    All Dues Under 7 Days
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                Reminder to review customer Khata accounts with pending udhar ledger entries older than 7 days.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('CUSTOMERS')}
            className="text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-emerald-200 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-xs cursor-pointer flex items-center gap-1 shrink-0 self-start sm:self-auto"
          >
            <span>Open Customer Khata</span>
            <span>&rarr;</span>
          </button>
        </div>

        {dueOver7DaysCustomers.length === 0 ? (
          <div className="py-5 flex items-center gap-3 text-slate-600 dark:text-slate-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-slate-800 dark:text-slate-100">No pending customer dues older than 7 days.</span> All credit entries are within the 7-day cycle.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
            {dueOver7DaysCustomers.map((item) => (
              <div
                key={item.customer.id}
                className="p-3.5 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 flex flex-col justify-between gap-2.5 shadow-2xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                        {item.customer.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {item.customer.phone}
                      </div>
                    </div>
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/70 text-red-800 dark:text-red-200 shrink-0 tabular-nums">
                      {item.daysPending}d Pending
                    </span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-baseline justify-between">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Pending Balance</span>
                    <span className="text-base font-extrabold text-red-700 dark:text-red-400 tabular-nums">
                      {formatINR(item.amountDue)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId(item.customer.id);
                    setActiveTab('CUSTOMERS');
                  }}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition text-center cursor-pointer"
                >
                  Check Khata &rarr;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* AUTOMATED LOW-STOCK & APPROACHING REORDER NOTIFICATION SYSTEM    */}
      {/* ---------------------------------------------------------------- */}
      <div
        className={`rounded-2xl p-5 border shadow-xs transition-all ${
          lowStockProducts.length > 0 || approachingReorderProducts.length > 0
            ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200/80 dark:border-slate-800 gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl shrink-0 ${
                lowStockProducts.length > 0
                  ? 'bg-red-600 text-white'
                  : approachingReorderProducts.length > 0
                  ? 'bg-amber-500 text-white'
                  : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  Automated Low-Stock &amp; Reorder Alerts (Kam Stock Warning)
                </h3>
                {lowStockProducts.length > 0 && (
                  <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/70 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-700 animate-pulse">
                    {lowStockProducts.length} Below Limit
                  </span>
                )}
                {approachingReorderProducts.length > 0 && (
                  <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                    {approachingReorderProducts.length} Approaching Limit
                  </span>
                )}
                {lowStockProducts.length === 0 && approachingReorderProducts.length === 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                    Stock Healthy
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Real-time alerts when inventory reaches or approaches your reorder level. Prevents counter stockouts.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('INVENTORY')}
            className="text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-xs cursor-pointer flex items-center gap-1 shrink-0 self-start sm:self-auto"
          >
            <span>Full Inventory View</span>
            <span>&rarr;</span>
          </button>
        </div>

        {lowStockProducts.length === 0 && approachingReorderProducts.length === 0 ? (
          <div className="py-6 flex items-center gap-3 text-slate-600 dark:text-slate-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-slate-800 dark:text-slate-100">All grocery products have sufficient stock.</span> No items currently breach or approach their reorder thresholds.
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-3">
            {lowStockProducts.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {lowStockProducts.map((p) => {
                  const isOut = p.stockQty <= 0;
                  const deficit = Math.max(0, p.minStockAlert - p.stockQty);
                  return (
                    <div
                      key={p.id}
                      className={`p-3.5 rounded-xl border flex flex-col justify-between transition-shadow bg-white dark:bg-slate-900 ${
                        isOut ? 'border-red-300 dark:border-red-800 shadow-xs' : 'border-amber-200 dark:border-amber-800 shadow-xs'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                              {p.name}
                            </div>
                            {p.localName && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{p.localName}</div>
                            )}
                          </div>
                          <span
                            className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded shrink-0 ${
                              isOut
                                ? 'bg-red-600 text-white'
                                : 'bg-red-100 dark:bg-red-900/70 text-red-900 dark:text-red-100 font-bold'
                            }`}
                          >
                            {isOut ? 'OUT OF STOCK' : 'LOW STOCK'}
                          </span>
                        </div>

                        <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                          <div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">Available</span>
                            <span className={`font-extrabold text-sm tabular-nums ${isOut ? 'text-red-600 dark:text-red-400' : 'text-amber-800 dark:text-amber-300'}`}>
                              {p.stockQty} {p.unit}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">Threshold</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm tabular-nums">
                              {p.minStockAlert} {p.unit}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                          {isOut ? (
                            <span className="text-red-700 dark:text-red-400 font-semibold">Immediate reorder required from distributor</span>
                          ) : (
                            <span>
                              Deficit: <strong className="text-red-700 dark:text-red-400 tabular-nums">{deficit.toFixed(2)} {p.unit}</strong> below threshold
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProdForRestock(p);
                            setRestockQtyInput(String(Math.max(1, Math.ceil(p.minStockAlert * 1.5 - p.stockQty))));
                            setIsRestockModalOpen(true);
                          }}
                          className="flex-1 py-1 px-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition text-center cursor-pointer shadow-2xs"
                        >
                          + Quick Restock
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProdForThreshold(p);
                            setThresholdInput(String(p.minStockAlert));
                            setIsThresholdModalOpen(true);
                          }}
                          className="py-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition text-center cursor-pointer"
                          title="Adjust alert threshold"
                        >
                          Threshold
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {approachingReorderProducts.length > 0 && (
              <div className="pt-2 border-t border-amber-200/70 dark:border-amber-800/60">
                <div className="flex items-center gap-2 mb-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <h4 className="text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-200">
                    Approaching Reorder Level ({approachingReorderProducts.length}{' '}
                    {approachingReorderProducts.length === 1 ? 'Product' : 'Products'} Nearing Limit)
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {approachingReorderProducts.map(({ product: p, bufferRemaining }) => (
                    <div
                      key={p.id}
                      className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 flex flex-col justify-between shadow-xs"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                              {p.name}
                            </div>
                            {p.localName && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {p.localName}
                              </div>
                            )}
                          </div>
                          <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200 shrink-0">
                            APPROACHING
                          </span>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs bg-amber-50/70 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-100 dark:border-amber-900">
                          <div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">Current Stock</span>
                            <span className="font-extrabold text-sm text-amber-900 dark:text-amber-300 tabular-nums">
                              {p.stockQty} {p.unit}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">Reorder Limit</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm tabular-nums">
                              {p.minStockAlert} {p.unit}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 text-[11px] text-amber-900 dark:text-amber-300">
                          Only <strong className="tabular-nums">{bufferRemaining} {p.unit}</strong> buffer above reorder limit. Plan wholesale purchase soon.
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProdForRestock(p);
                            setRestockQtyInput(String(Math.max(1, Math.ceil(p.minStockAlert))));
                            setIsRestockModalOpen(true);
                          }}
                          className="flex-1 py-1 px-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition text-center cursor-pointer"
                        >
                          + Plan Restock
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProdForThreshold(p);
                            setThresholdInput(String(p.minStockAlert));
                            setIsThresholdModalOpen(true);
                          }}
                          className="py-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition text-center cursor-pointer"
                        >
                          Threshold
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* SECTIONS 6 & 7: RECENT ACTIVITY & SMART ALERTS                    */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* SECTION 6: RECENT ACTIVITY (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">Recent Activity (Haaliya Transactions)</h4>
              </div>
              <span className="text-xs text-slate-400">Live Counter Feed</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-1">
              {recentActivities.map((act) => (
                <div
                  key={act.id}
                  onClick={act.onClick}
                  className="py-3 flex items-center justify-between hover:bg-slate-50/70 dark:hover:bg-slate-800/70 rounded-lg px-1.5 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                        act.type === 'SALE'
                          ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                          : act.type === 'PAYMENT'
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : act.type === 'PURCHASE'
                          ? 'bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {act.type === 'SALE' && 'BIKRI'}
                      {act.type === 'PAYMENT' && 'JAMA'}
                      {act.type === 'PURCHASE' && 'KHARID'}
                      {act.type === 'EXPENSE' && 'KHARCH'}
                    </div>

                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                        {act.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {act.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`font-extrabold text-xs sm:text-sm tabular-nums ${
                        act.type === 'SALE' || act.type === 'PAYMENT'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : act.type === 'PURCHASE'
                          ? 'text-blue-800 dark:text-blue-300'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {act.type === 'SALE' || act.type === 'PAYMENT' ? `+ ${formatINR(act.amount)}` : `- ${formatINR(act.amount)}`}
                    </div>
                    <div className="text-[10px] text-slate-400 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                      View &rarr;
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
            <span>Chronological timeline</span>
            <button
              type="button"
              onClick={() => setActiveTab('REPORTS')}
              className="text-emerald-700 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
            >
              Export Statement &rarr;
            </button>
          </div>
        </div>

        {/* SECTION 7: SMART ALERTS (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">Smart Alerts (Zaroori Alerts)</h4>
              </div>
              <span className="text-xs font-bold text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/60 px-2 py-0.5 rounded-full">
                {smartAlerts.length} Active
              </span>
            </div>

            <div className="py-2 space-y-2.5">
              {smartAlerts.length === 0 ? (
                <div className="text-center py-10">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2 opacity-80" />
                  <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs">All business indicators healthy!</p>
                  <p className="text-[11px] text-slate-400">No overdue customer udhar or low-stock warnings.</p>
                </div>
              ) : (
                smartAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                      alert.severity === 'HIGH'
                        ? 'bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-900'
                        : 'bg-amber-50/40 dark:bg-amber-950/25 border-amber-200 dark:border-amber-900'
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">{alert.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-slate-100 text-xs truncate">{alert.title}</span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                            alert.severity === 'HIGH' ? 'bg-red-100 dark:bg-red-900/70 text-red-800 dark:text-red-200' : 'bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200'
                          }`}
                        >
                          {alert.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{alert.message}</p>
                      <button
                        type="button"
                        onClick={alert.action}
                        className="mt-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-emerald-200 underline cursor-pointer"
                      >
                        {alert.actionLabel} &rarr;
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Overdue alerts trigger automatically at 30, 60, 90+ days.
            </span>
          </div>
        </div>
      </div>

      {/* Modal: Quick Restock Product */}
      {isRestockModalOpen && selectedProdForRestock && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Boxes className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Quick Restock Product</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRestockModalOpen(false);
                  setSelectedProdForRestock(null);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRestockSubmit} className="py-4 space-y-3.5">
              {restockError && (
                <div role="alert" className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300">
                  {restockError}
                </div>
              )}
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">{selectedProdForRestock.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Current Stock:{' '}
                  <strong className="text-red-700 dark:text-red-400">
                    {selectedProdForRestock.stockQty} {selectedProdForRestock.unit}
                  </strong>{' '}
                  · Reorder Threshold: {selectedProdForRestock.minStockAlert}{' '}
                  {selectedProdForRestock.unit}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Quantity to Add ({selectedProdForRestock.unit}) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={restockQtyInput}
                  onChange={(e) => setRestockQtyInput(e.target.value)}
                  className="w-full text-base font-bold border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Restock Reason / Source *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={restockReasonInput}
                  onChange={(e) => {
                    setRestockReasonInput(e.target.value);
                    if (restockError) setRestockError(null);
                  }}
                  placeholder="e.g. APMC wholesale delivery"
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-2.5"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsRestockModalOpen(false);
                    setSelectedProdForRestock(null);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                >
                  Confirm Restock (+ Add)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adjust Low-Stock Threshold */}
      {isThresholdModalOpen && selectedProdForThreshold && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Adjust Alert Threshold</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsThresholdModalOpen(false);
                  setSelectedProdForThreshold(null);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateThresholdSubmit} className="py-4 space-y-3.5">
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">{selectedProdForThreshold.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Available in shop: {selectedProdForThreshold.stockQty} {selectedProdForThreshold.unit}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Minimum Reorder Threshold ({selectedProdForThreshold.unit}) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="w-full text-base font-bold border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-2.5 focus:ring-2 focus:ring-amber-500"
                  autoFocus
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  The app will trigger an automated dashboard warning when stock drops to or below this quantity.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsThresholdModalOpen(false);
                    setSelectedProdForThreshold(null);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-900 dark:bg-emerald-700 hover:bg-slate-800 dark:hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                >
                  Save Threshold
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
