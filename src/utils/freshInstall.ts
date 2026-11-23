/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuditLog,
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  Product,
  SaleRecord,
  StockAdjustmentRecord,
  StoreBusinessDataset,
  StoreProfile,
  Supplier,
  SupplierTransaction,
} from '../types';
import {
  initialAuditLogs,
  initialCashbookEntries,
  initialCustomers,
  initialCustomerTransactions,
  initialExpenses,
  initialProducts,
  initialSales,
  initialStockAdjustments,
  initialStoreProfile,
  initialSuppliers,
  initialSupplierTransactions,
} from './initialData';
import {
  calculateCustomerLedgerWithRunningBalance,
  calculateSupplierLedgerWithRunningBalance,
} from './accounting';

export const DEMO_ENTITY_IDS = {
  products: new Set(initialProducts.map((p) => p.id)),
  stockAdjustments: new Set(initialStockAdjustments.map((s) => s.id)),
  customers: new Set(initialCustomers.map((c) => c.id)),
  customerTransactions: new Set(initialCustomerTransactions.map((t) => t.id)),
  suppliers: new Set(initialSuppliers.map((s) => s.id)),
  supplierTransactions: new Set(initialSupplierTransactions.map((t) => t.id)),
  expenses: new Set(initialExpenses.map((e) => e.id)),
  sales: new Set(initialSales.map((s) => s.id)),
  cashbookEntries: new Set(initialCashbookEntries.map((c) => c.id)),
  auditLogs: new Set(initialAuditLogs.map((a) => a.id)),
} as const;

/**
 * Returns a clean, empty StoreProfile for a brand-new installation.
 * Never pre-populates fake owner names, phone numbers, UPI IDs, addresses, or GSTINs.
 */
export function createEmptyStoreProfile(): StoreProfile {
  return {
    id: 'store-1',
    storeName: '',
    ownerName: '',
    phone: '',
    upiId: '',
    address: '',
    gstin: undefined,
    tagline: '',
    currencySymbol: '₹',
    isPinEnabled: false,
    allowNegativeStock: false,
  };
}

/**
 * Returns a completely empty business dataset for a genuinely fresh installation.
 */
export function createEmptyBusinessDataset(): StoreBusinessDataset {
  return {
    profile: createEmptyStoreProfile(),
    customers: [],
    customerTransactions: [],
    suppliers: [],
    supplierTransactions: [],
    sales: [],
    expenses: [],
    cashbookEntries: [],
    products: [],
    productCategories: [],
    expenseCategories: [],
    stockAdjustments: [],
    auditLogs: [],
    whatsappBatches: [],
    whatsappAuditLogs: [],
    billDocuments: [],
    recurringExpenses: [],
    dailySalesTarget: null,
    lastClosedDate: null,
  };
}

export function hasNonEmptyProfileDetails(
  profile: Partial<StoreProfile> | undefined | null
): boolean {
  if (!profile) return false;
  return Boolean(
    profile.storeName?.trim() ||
      profile.ownerName?.trim() ||
      profile.phone?.trim() ||
      profile.upiId?.trim() ||
      profile.address?.trim() ||
      profile.gstin?.trim()
  );
}

/**
 * Checks whether a dataset has any persisted records or configured shop profile details.
 * Used to distinguish an existing shop installation from a genuinely fresh install.
 */
export function hasAnyPersistedBusinessData(
  dataset: Partial<StoreBusinessDataset> | undefined | null
): boolean {
  if (!dataset) return false;
  if (hasNonEmptyProfileDetails(dataset.profile)) return true;
  return Boolean(
    (dataset.customers?.length || 0) > 0 ||
      (dataset.customerTransactions?.length || 0) > 0 ||
      (dataset.suppliers?.length || 0) > 0 ||
      (dataset.supplierTransactions?.length || 0) > 0 ||
      (dataset.sales?.length || 0) > 0 ||
      (dataset.expenses?.length || 0) > 0 ||
      (dataset.cashbookEntries?.length || 0) > 0 ||
      (dataset.products?.length || 0) > 0 ||
      (dataset.stockAdjustments?.length || 0) > 0 ||
      (dataset.auditLogs?.length || 0) > 0 ||
      (dataset.whatsappBatches?.length || 0) > 0 ||
      (dataset.whatsappAuditLogs?.length || 0) > 0 ||
      (dataset.recurringExpenses?.length || 0) > 0 ||
      (dataset.billDocuments?.length || 0) > 0 ||
      Boolean(dataset.dailySalesTarget) ||
      Boolean(dataset.lastClosedDate)
  );
}

/**
 * Determines whether the first-time shop setup screen should be presented.
 * Existing installations NEVER see the setup screen.
 */
export function shouldRequireFirstTimeSetup(params: {
  firstTimeSetupCompleted: boolean | null;
  dataset: Partial<StoreBusinessDataset>;
}): boolean {
  if (params.firstTimeSetupCompleted === true) {
    return false;
  }
  if (hasAnyPersistedBusinessData(params.dataset)) {
    return false;
  }
  return true;
}

export function isDemoProfileFingerprint(
  profile: Partial<StoreProfile> | undefined | null
): boolean {
  if (!profile) return false;
  return Boolean(
    profile.ownerName === initialStoreProfile.ownerName ||
      profile.phone === initialStoreProfile.phone ||
      profile.upiId === initialStoreProfile.upiId ||
      (profile.gstin && profile.gstin === initialStoreProfile.gstin) ||
      profile.address === initialStoreProfile.address
  );
}

export interface CollectionDemoSplit {
  demoCount: number;
  realCount: number;
}

export interface DemoVsRealAnalysis {
  hasDemoRecords: boolean;
  hasRealRecords: boolean;
  hasMixedData: boolean;
  hasDemoProfileFields: boolean;
  totalDemoRecords: number;
  totalRealRecords: number;
  referencedDemoCustomerIds: string[];
  referencedDemoSupplierIds: string[];
  referencedDemoProductIds: string[];
  breakdown: {
    customers: CollectionDemoSplit;
    customerTransactions: CollectionDemoSplit;
    suppliers: CollectionDemoSplit;
    supplierTransactions: CollectionDemoSplit;
    products: CollectionDemoSplit;
    stockAdjustments: CollectionDemoSplit;
    sales: CollectionDemoSplit;
    expenses: CollectionDemoSplit;
    cashbookEntries: CollectionDemoSplit;
    auditLogs: CollectionDemoSplit;
  };
}

function splitDemoVsReal<T extends { id: string }>(
  items: T[] | undefined,
  demoIds: ReadonlySet<string>
): CollectionDemoSplit {
  let demoCount = 0;
  let realCount = 0;
  for (const item of items || []) {
    if (demoIds.has(item.id)) demoCount++;
    else realCount++;
  }
  return { demoCount, realCount };
}

/**
 * Inspects a dataset to clearly distinguish pre-existing demo fixtures from real shop records,
 * and identifies any demo master records (customers/suppliers/products) referenced by real transactions.
 */
export function analyzeDemoVsRealDataset(dataset: StoreBusinessDataset): DemoVsRealAnalysis {
  const breakdown = {
    customers: splitDemoVsReal(dataset.customers, DEMO_ENTITY_IDS.customers),
    customerTransactions: splitDemoVsReal(
      dataset.customerTransactions,
      DEMO_ENTITY_IDS.customerTransactions
    ),
    suppliers: splitDemoVsReal(dataset.suppliers, DEMO_ENTITY_IDS.suppliers),
    supplierTransactions: splitDemoVsReal(
      dataset.supplierTransactions,
      DEMO_ENTITY_IDS.supplierTransactions
    ),
    products: splitDemoVsReal(dataset.products, DEMO_ENTITY_IDS.products),
    stockAdjustments: splitDemoVsReal(dataset.stockAdjustments, DEMO_ENTITY_IDS.stockAdjustments),
    sales: splitDemoVsReal(dataset.sales, DEMO_ENTITY_IDS.sales),
    expenses: splitDemoVsReal(dataset.expenses, DEMO_ENTITY_IDS.expenses),
    cashbookEntries: splitDemoVsReal(dataset.cashbookEntries, DEMO_ENTITY_IDS.cashbookEntries),
    auditLogs: splitDemoVsReal(dataset.auditLogs, DEMO_ENTITY_IDS.auditLogs),
  };

  // Detect any real records that reference demo master entities so manual cleanup never orphans them
  const referencedCustomerIds = new Set<string>();
  const referencedSupplierIds = new Set<string>();
  const referencedProductIds = new Set<string>();

  for (const tx of dataset.customerTransactions || []) {
    if (!DEMO_ENTITY_IDS.customerTransactions.has(tx.id) && DEMO_ENTITY_IDS.customers.has(tx.customerId)) {
      referencedCustomerIds.add(tx.customerId);
    }
    if (!DEMO_ENTITY_IDS.customerTransactions.has(tx.id) && tx.productId && DEMO_ENTITY_IDS.products.has(tx.productId)) {
      referencedProductIds.add(tx.productId);
    }
  }

  for (const sale of dataset.sales || []) {
    if (DEMO_ENTITY_IDS.sales.has(sale.id)) continue;
    if (sale.customerId && DEMO_ENTITY_IDS.customers.has(sale.customerId)) {
      referencedCustomerIds.add(sale.customerId);
    }
    for (const item of sale.items || []) {
      if (item.productId && DEMO_ENTITY_IDS.products.has(item.productId)) {
        referencedProductIds.add(item.productId);
      }
    }
  }

  for (const stx of dataset.supplierTransactions || []) {
    if (DEMO_ENTITY_IDS.supplierTransactions.has(stx.id)) continue;
    if (DEMO_ENTITY_IDS.suppliers.has(stx.supplierId)) {
      referencedSupplierIds.add(stx.supplierId);
    }
    if (stx.productId && DEMO_ENTITY_IDS.products.has(stx.productId)) {
      referencedProductIds.add(stx.productId);
    }
  }

  for (const adj of dataset.stockAdjustments || []) {
    if (!DEMO_ENTITY_IDS.stockAdjustments.has(adj.id) && DEMO_ENTITY_IDS.products.has(adj.productId)) {
      referencedProductIds.add(adj.productId);
    }
  }

  const totalDemoRecords = Object.values(breakdown).reduce((sum, b) => sum + b.demoCount, 0);
  const totalRealRecords =
    Object.values(breakdown).reduce((sum, b) => sum + b.realCount, 0) +
    (dataset.recurringExpenses?.length || 0) +
    (dataset.billDocuments?.length || 0) +
    (dataset.whatsappBatches?.length || 0);

  const hasDemoProfileFields = isDemoProfileFingerprint(dataset.profile);

  return {
    hasDemoRecords: totalDemoRecords > 0 || hasDemoProfileFields,
    hasRealRecords: totalRealRecords > 0,
    hasMixedData: (totalDemoRecords > 0 || hasDemoProfileFields) && totalRealRecords > 0,
    hasDemoProfileFields,
    totalDemoRecords,
    totalRealRecords,
    referencedDemoCustomerIds: Array.from(referencedCustomerIds),
    referencedDemoSupplierIds: Array.from(referencedSupplierIds),
    referencedDemoProductIds: Array.from(referencedProductIds),
    breakdown,
  };
}

/**
 * Manually removes ONLY pre-existing unreferenced demo records from a dataset while strictly
 * preserving every real business record and any demo entity referenced by real transactions.
 * Never called automatically — must only be invoked by explicit user confirmation.
 */
export function removeDemoRecordsOnly(dataset: StoreBusinessDataset): {
  cleanedDataset: StoreBusinessDataset;
  removedCount: number;
  preservedReferencedIds: string[];
} {
  const analysis = analyzeDemoVsRealDataset(dataset);
  const keepDemoCustIds = new Set(analysis.referencedDemoCustomerIds);
  const keepDemoSuppIds = new Set(analysis.referencedDemoSupplierIds);
  const keepDemoProdIds = new Set(analysis.referencedDemoProductIds);

  const customers: Customer[] = (dataset.customers || []).filter(
    (c) => !DEMO_ENTITY_IDS.customers.has(c.id) || keepDemoCustIds.has(c.id)
  );
  const customerTransactions: CustomerTransaction[] = (dataset.customerTransactions || []).filter(
    (t) => !DEMO_ENTITY_IDS.customerTransactions.has(t.id)
  );
  const suppliers: Supplier[] = (dataset.suppliers || []).filter(
    (s) => !DEMO_ENTITY_IDS.suppliers.has(s.id) || keepDemoSuppIds.has(s.id)
  );
  const supplierTransactions: SupplierTransaction[] = (dataset.supplierTransactions || []).filter(
    (t) => !DEMO_ENTITY_IDS.supplierTransactions.has(t.id)
  );
  const products: Product[] = (dataset.products || []).filter(
    (p) => !DEMO_ENTITY_IDS.products.has(p.id) || keepDemoProdIds.has(p.id)
  );
  const stockAdjustments: StockAdjustmentRecord[] = (dataset.stockAdjustments || []).filter(
    (a) => !DEMO_ENTITY_IDS.stockAdjustments.has(a.id)
  );
  const sales: SaleRecord[] = (dataset.sales || []).filter((s) => !DEMO_ENTITY_IDS.sales.has(s.id));
  const expenses: ExpenseRecord[] = (dataset.expenses || []).filter(
    (e) => !DEMO_ENTITY_IDS.expenses.has(e.id)
  );
  const cashbookEntries: CashbookEntry[] = (dataset.cashbookEntries || []).filter(
    (c) => !DEMO_ENTITY_IDS.cashbookEntries.has(c.id)
  );
  const auditLogs: AuditLog[] = (dataset.auditLogs || []).filter(
    (a) => !DEMO_ENTITY_IDS.auditLogs.has(a.id)
  );

  // Strip only exact demo placeholder profile fields; preserve real owner edits
  const nextProfile: StoreProfile = {
    ...dataset.profile,
    ownerName:
      dataset.profile.ownerName === initialStoreProfile.ownerName ? '' : dataset.profile.ownerName,
    phone: dataset.profile.phone === initialStoreProfile.phone ? '' : dataset.profile.phone,
    upiId: dataset.profile.upiId === initialStoreProfile.upiId ? '' : dataset.profile.upiId,
    address: dataset.profile.address === initialStoreProfile.address ? '' : dataset.profile.address,
    gstin:
      dataset.profile.gstin === initialStoreProfile.gstin ? undefined : dataset.profile.gstin,
    tagline:
      dataset.profile.tagline === initialStoreProfile.tagline ? '' : dataset.profile.tagline,
  };

  // Recalculate customer & supplier balances from surviving transactions
  const recalculatedCustomers = customers.map((cust) => {
    const summary = calculateCustomerLedgerWithRunningBalance(cust, customerTransactions);
    if (summary.activeCount === 0) {
      return {
        ...cust,
        currentBalance: Number(cust.openingBalance ?? 0) || 0,
        totalCreditGiven: 0,
        totalPaymentReceived: 0,
      };
    }
    return {
      ...cust,
      currentBalance: summary.closingBalance,
      totalCreditGiven: summary.totalCreditGiven,
      totalPaymentReceived: summary.totalPaymentReceived,
      lastTransactionDate: summary.lastTransactionDate || cust.lastTransactionDate,
    };
  });

  const recalculatedSuppliers = suppliers.map((sup) => {
    const summary = calculateSupplierLedgerWithRunningBalance(sup, supplierTransactions);
    if (summary.activeCount === 0) {
      return {
        ...sup,
        currentBalance: Number(sup.openingBalance ?? 0) || 0,
        totalPurchases: 0,
        totalPaid: 0,
      };
    }
    return {
      ...sup,
      currentBalance: summary.closingBalance,
      totalPurchases: summary.totalPurchases,
      totalPaid: summary.totalPaid,
      lastTransactionDate: summary.lastTransactionDate || sup.lastTransactionDate,
    };
  });

  const beforeTotal =
    (dataset.customers?.length || 0) +
    (dataset.customerTransactions?.length || 0) +
    (dataset.suppliers?.length || 0) +
    (dataset.supplierTransactions?.length || 0) +
    (dataset.products?.length || 0) +
    (dataset.stockAdjustments?.length || 0) +
    (dataset.sales?.length || 0) +
    (dataset.expenses?.length || 0) +
    (dataset.cashbookEntries?.length || 0) +
    (dataset.auditLogs?.length || 0);

  const afterTotal =
    recalculatedCustomers.length +
    customerTransactions.length +
    recalculatedSuppliers.length +
    supplierTransactions.length +
    products.length +
    stockAdjustments.length +
    sales.length +
    expenses.length +
    cashbookEntries.length +
    auditLogs.length;

  return {
    cleanedDataset: {
      ...dataset,
      profile: nextProfile,
      customers: recalculatedCustomers,
      customerTransactions,
      suppliers: recalculatedSuppliers,
      supplierTransactions,
      products,
      stockAdjustments,
      sales,
      expenses,
      cashbookEntries,
      auditLogs,
    },
    removedCount: Math.max(0, beforeTotal - afterTotal),
    preservedReferencedIds: [
      ...analysis.referencedDemoCustomerIds,
      ...analysis.referencedDemoSupplierIds,
      ...analysis.referencedDemoProductIds,
    ],
  };
}
