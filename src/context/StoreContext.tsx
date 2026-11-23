import React, { createContext, useContext, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { apiFetch, clearInMemoryApiSession, isApiAuthUnavailable } from '../utils/apiClient';
import {
  AUTH_SESSION_KEY_META_KEY,
  AUTH_SESSION_META_KEY,
  AuthInitStage,
  AuthLifecycleStatus,
  AuthNotice,
  AuthSessionPayload,
  createSignedAuthSession,
  isAuthSessionExpired,
  PersistedAuthSessionRecord,
  resolveAuthInitStage,
  resolveAuthLifecycleStatus,
  StoreAuthMode,
  verifyPersistedAuthSession,
} from '../utils/authSession';
import {
  lookupCustomerAccount,
  lookupSupplierAccount,
  validateCreateAccountInput,
  verifyOfflineOwnerRecovery,
} from '../utils/portalAuth';
import {
  AccountingReconciliationReport,
  AlertNotification,
  AppBackupSummary,
  AuditLog,
  AutoBackupSettings,
  BackupReconciliationReport,
  BillAttachment,
  CashbookEntry,
  CloudAuthUser,
  CloudBackupConfig,
  CloudBackupRemoteEntry,
  CloudBackupStatus,
  Customer,
  CustomerTransaction,
  CustomerTransactionType,
  DailySalesTargetConfig,
  DateFilterRange,
  ExpenseCategoryConfig,
  ExpenseRecord,
  LocalBackupSnapshot,
  NavTab,
  PaymentMethod,
  PinSecurityRecord,
  Product,
  ProductCategoryConfig,
  PurchasePrefillContext,
  PurchaseReturnReason,
  RecurringExpense,
  ReportsTab,
  SaleItem,
  SaleRecord,
  StockAdjustmentRecord,
  StorageStatusSummary,
  StoreBusinessDataset,
  StoreProfile,
  Supplier,
  SupplierTransaction,
  SupplierTransactionType,
  WhatsAppApiConfig,
  WhatsAppApiResponseSummary,
  WhatsAppAuditLog,
  WhatsAppReminderBatch,
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
} from '../utils/initialData';
import {
  analyzeDemoVsRealDataset,
  createEmptyBusinessDataset,
  createEmptyStoreProfile,
  DemoVsRealAnalysis,
  removeDemoRecordsOnly,
  shouldRequireFirstTimeSetup,
} from '../utils/freshInstall';
import {
  advanceRecurringDueDate,
  calculateCashbookSummary,
  calculateCustomerAging,
  calculateCustomerLedgerWithRunningBalance,
  calculateInventoryValuation,
  calculateMonthlySalesGrowth,
  calculateOverdueDays,
  calculateProfitAndLoss,
  calculateSupplierLedgerWithRunningBalance,
  calculateWorkingCapital,
  getApproachingReorderProducts,
  getCustomersWithDuePaymentsOlderThanDays,
  getDueRecurringExpenses,
  getLocalTodayKey,
  hasProductTransactionHistory,
  isCashbookEntryActive,
  isSaleActive,
  matchesLedgerDateFilter,
  resolveSupplierPurchaseUpfrontPaid,
  toLocalDateTimeIso,
  toLocalDayKey,
} from '../utils/accounting';
import { generateAccountingReconciliationReport } from '../utils/accountingReconciliation';
import {
  generateBackupData,
  serializeBackupJSON,
  downloadBackupJSONFile,
  validateAndParseBackupJSON,
} from '../utils/backup';
import {
  AtomicAuditDescriptor,
  prepareAtomicCancelSale,
  prepareAtomicCancelSupplierTransaction,
  prepareAtomicCustomerTransaction,
  prepareAtomicProductPurchase,
  prepareAtomicPurchaseReturn,
  prepareAtomicSale,
  prepareAtomicSupplierTransaction,
} from '../utils/atomicTransactions';
import { PurchaseReturnLineInput } from '../utils/purchaseReturns';
import {
  applyManualStockAdjustment,
  applyPurchaseReturnStockDecrease,
  applyPurchaseStockIncrease,
  applySaleStockDeduction,
  applySalesReturnStockIncrease,
  buildSnapshottedSaleItems,
  ReturnStockItemInput,
  roundStockQty,
} from '../utils/inventoryEngine';
import {
  getAllBillDocuments,
  importDocumentsFromBackup,
  readLegacyBillsDbDocuments,
} from '../utils/billDatabase';
import { parseCustomersCSV, parseSuppliersCSV, parseProductsCSV } from '../utils/csv';
import {
  clearLegacyLocalStorageBusinessKeys,
  createMemoryLocalDbAdapter,
  deduplicateById,
  DEFAULT_AUTO_BACKUP_SETTINGS,
  formatStorageError,
  hasLegacyLocalStorageBusinessData,
  listLocalBackups,
  LOCAL_DB_NAME,
  LOCAL_DB_VERSION,
  LocalDbAdapter,
  migrateLegacyLocalStorageToLocalDb,
  MigrationReport,
  openLocalDatabase,
  recalculateLedgerBalancesFromHistory,
  registerActiveLocalDbAdapter,
  requestAndCheckStorageQuota,
  sanitizeProfileForStorage,
  STORE_NAMES,
} from '../utils/localDatabase';
import {
  BackupExportMethod,
  buildEncryptedBackupFileContent,
  buildVerifiedBackupEnvelope,
  createLocalBackupSnapshot,
  CriticalRestoreRollbackError,
  exportBackupFileWithPickerFallback,
  exportBinaryFileWithPickerFallback,
  restoreBackupSafelyWithRollback,
  VerifiedRestoreCounts,
} from '../utils/localBackupManager';
import { exportBackupReportPdfBytes } from '../utils/backupReportPdf';
import { generateBackupExcelBuffer } from '../utils/backupExcel';
import {
  clearPinAttemptState,
  getPinCooldownRemainingSeconds,
  hashPinWithSalt,
  recordFailedPinAttempt,
  verifyPinHash,
} from '../utils/securityCrypto';
import {
  registerFirebaseEmailOwnerAccount,
  sendFirebasePasswordResetEmail,
  signInWithGoogleForCloudBackup,
  signOutFirebaseSync,
  storage as firebaseStorage,
  subscribeToFirebaseAuth,
  testFirestoreConnection,
  waitForFirebaseAuthReady,
} from '../firebase';
import { ensureStoreWorkspaceDoc } from '../utils/firestoreSyncTransport';
import {
  mapFirebaseAuthErrorToMessage,
  maskEmailForNotice,
  resolvePasswordResetIdentifier,
  StoreRegistrationInput,
  validateStoreRegistrationInput,
} from '../utils/firebaseAuthFlows';
import {
  createPassphraseVerifier,
  validateCloudPassphrase,
  verifyPassphraseVerifier,
} from '../utils/cloudBackupCrypto';
import {
  CloudBackupOwnerMismatchError,
  createFirebaseCloudBackupTransport,
  DEFAULT_CLOUD_BACKUP_CONFIG,
  DEFAULT_CLOUD_BACKUP_STATUS,
  downloadAndInspectCloudBackup,
  getIstDateKey,
  InspectedCloudDownloadResult,
  listUserCloudBackups,
  restoreCloudBackupSafely,
  shouldRunDailyCloudBackup,
  uploadEncryptedCloudBackup,
} from '../utils/cloudBackupManager';
import { InspectedBackupResult } from '../utils/localBackupManager';
import {
  addProductCategoryConfig,
  buildDefaultProductCategories,
  deleteProductCategoryConfig,
  mergeProductCategoriesConfigs,
  updateProductCategoryConfig,
} from '../utils/inventoryCategories';
import {
  addExpenseCategoryConfig,
  buildDefaultExpenseCategories,
  deleteExpenseCategoryConfig,
  restoreMissingDefaultExpenseCategories,
  updateExpenseCategoryConfig,
} from '../utils/expenseCategories';
import { normalizePreferredPaymentMethod, ParsedPdfSupplierRow } from '../utils/supplierPdfImport';
import {
  matchExistingInventoryProduct,
  ParsedInventoryImportRow,
} from '../utils/inventoryBulkImport';
import {
  ACCENT_STORAGE_KEY,
  AccentRamp,
  applyAccentColorToDocument,
  DEFAULT_ACCENT_COLOR,
  generateAccentRamp,
  normalizeHexColor,
} from '../utils/accentTheme';

interface DateRange {
  startDate: string;
  endDate: string;
}

interface StoreContextType {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  dateFilter: DateFilterRange;
  setDateFilter: (filter: DateFilterRange) => void;
  customDateRange: DateRange;
  setCustomDateRange: (range: DateRange) => void;

  profile: StoreProfile;
  updateProfile: (profile: Partial<StoreProfile>) => void;

  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  addCustomer: (data: Omit<Customer, 'id' | 'currentBalance' | 'totalCreditGiven' | 'totalPaymentReceived' | 'overdueDays' | 'category' | 'createdAt'>) => string;
  updateCustomer: (id: string, data: Partial<Customer>) => void;
  deleteCustomer: (id: string, reason: string) => void;
  addCustomerTransaction: (tx: {
    customerId: string;
    type: CustomerTransactionType;
    amount: number;
    description: string;
    date?: string;
    paymentMethod?: 'CASH' | 'UPI' | 'BANK';
    invoiceNo?: string;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
    productId?: string;
    quantity?: number;
    unit?: string;
    saleLineId?: string;
    items?: ReturnStockItemInput[];
  }) => { success: boolean; transactionId?: string; error?: string; duplicate?: boolean };
  cancelCustomerTransaction: (id: string, reason: string) => boolean;
  recordCustomerPayment: (
    customerId: string,
    amount: number,
    description?: string,
    paymentMethod?: 'CASH' | 'UPI' | 'BANK',
    attachments?: BillAttachment[]
  ) => void;

  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  addSupplier: (data: Omit<Supplier, 'id' | 'currentBalance' | 'totalPurchases' | 'totalPaid' | 'createdAt'>) => string;
  updateSupplier: (id: string, data: Partial<Supplier>) => void;
  deleteSupplier: (id: string, reason: string) => void;
  addSupplierTransaction: (tx: {
    supplierId: string;
    type: SupplierTransactionType;
    amount: number;
    paidAmount?: number;
    date?: string;
    paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';
    paymentMethod?: 'CASH' | 'UPI' | 'BANK';
    description: string;
    invoiceNo?: string;
    itemsSummary?: string;
    productId?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
  }) => { success: boolean; transactionId?: string; error?: string; duplicate?: boolean };
  cancelSupplierTransaction: (id: string, reason: string) => boolean;
  recordProductPurchase: (data: {
    supplierId: string;
    productId: string;
    quantity: number;
    unit?: string;
    unitPurchasePrice: number;
    paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
    paidAmount?: number;
    paymentMethod?: 'CASH' | 'UPI' | 'BANK';
    invoiceNo?: string;
    notes?: string;
    attachments?: BillAttachment[];
    date?: string;
    setAsPreferredSupplier?: boolean;
    idempotencyKey?: string;
  }) => { success: boolean; error?: string; duplicate?: boolean; transactionId?: string };
  recordPurchaseReturn: (data: {
    supplierId: string;
    items: PurchaseReturnLineInput[];
    reason: PurchaseReturnReason;
    creditNoteNo?: string;
    originalInvoiceNo?: string;
    originalPurchaseId?: string;
    settlementMode?: 'ADJUST_PAYABLE' | 'CASH_REFUND' | 'BANK_REFUND';
    notes?: string;
    date?: string;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
  }) => {
    success: boolean;
    error?: string;
    duplicate?: boolean;
    transactionId?: string;
    creditNoteNo?: string;
  };

  sales: SaleRecord[];
  filteredSales: SaleRecord[];
  recordSale: (data: {
    amount: number;
    grossAmount?: number;
    loyaltyPointsRedeemed?: number;
    paymentMethod: PaymentMethod;
    customerId?: string;
    customerName?: string;
    items?: SaleItem[];
    notes?: string;
    isCredit?: boolean;
    date?: string;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
  }) => {
    success: boolean;
    saleId?: string;
    invoiceNo?: string;
    loyaltyPointsEarned?: number;
    loyaltyPointsRedeemed?: number;
    loyaltyDiscountAmount?: number;
    error?: string;
    duplicate?: boolean;
  };
  cancelSale: (saleId: string, reason: string) => boolean;

  expenses: ExpenseRecord[];
  filteredExpenses: ExpenseRecord[];
  expenseCategories: ExpenseCategoryConfig[];
  addExpense: (data: {
    title: string;
    category: ExpenseRecord['category'];
    amount: number;
    isPersonalWithdrawal: boolean;
    paymentMethod: 'CASH' | 'UPI' | 'BANK';
    notes?: string;
    date?: string;
    attachments?: BillAttachment[];
  }) => void;
  deleteExpense: (id: string, reason: string) => void;
  addExpenseCategory: (input: {
    label: string;
    icon?: string;
    isPersonalDrawing?: boolean;
  }) => { success: boolean; error?: string; category?: ExpenseCategoryConfig };
  updateExpenseCategory: (
    id: string,
    patch: { label: string; icon?: string; isPersonalDrawing?: boolean }
  ) => { success: boolean; error?: string; category?: ExpenseCategoryConfig };
  deleteExpenseCategory: (
    id: string,
    reassignToId?: string
  ) => {
    success: boolean;
    error?: string;
    reassignedExpensesCount?: number;
    reassignedRecurringCount?: number;
  };
  restoreDefaultExpenseCategories: () => { addedCount: number };

  cashbookEntries: CashbookEntry[];
  filteredCashbookEntries: CashbookEntry[];
  addCashbookEntry: (data: {
    type: 'IN' | 'OUT';
    category: string;
    description: string;
    amount: number;
    refType: CashbookEntry['refType'];
    refId?: string;
    date?: string;
    attachments?: BillAttachment[];
  }) => void;

  products: Product[];
  productCategories: ProductCategoryConfig[];
  stockAdjustments: StockAdjustmentRecord[];
  addProduct: (data: Omit<Product, 'id' | 'updatedAt'>) => void;
  updateProduct: (id: string, data: Partial<Product>) => void;
  updateProductThreshold: (id: string, newMinStock: number) => void;
  adjustStock: (
    id: string,
    qtyChange: number,
    reason: string,
    date?: string,
    source?: StockAdjustmentRecord['source'],
    options?: {
      idempotencyKey?: string;
      referenceId?: string;
      referenceType?: StockAdjustmentRecord['referenceType'];
    }
  ) => { success: boolean; error?: string; duplicate?: boolean };
  archiveProduct: (id: string, isArchived: boolean, reason?: string) => void;
  deleteProduct: (id: string, reason: string) => void;
  addProductCategory: (input: {
    name: string;
    defaultUnit: string;
    defaultMinStockAlert?: number;
  }) => { success: boolean; error?: string; category?: ProductCategoryConfig };
  updateProductCategory: (
    id: string,
    patch: { name: string; defaultUnit: string; defaultMinStockAlert?: number }
  ) => { success: boolean; error?: string; renamedProductsCount?: number };
  mergeProductCategories: (
    sourceId: string,
    targetId: string
  ) => { success: boolean; error?: string; movedProductsCount?: number };
  deleteProductCategory: (
    id: string,
    reassignToCategoryName?: string
  ) => { success: boolean; error?: string; reassignedProductsCount?: number };
  importCustomersFromCSV: (csvText: string) => { imported: number; skipped: number; errors: string[] };
  importSuppliersFromCSV: (csvText: string) => { imported: number; skipped: number; errors: string[] };
  importSuppliersBatch: (
    rows: Array<
      Pick<
        ParsedPdfSupplierRow,
        | 'name'
        | 'contactPerson'
        | 'phone'
        | 'address'
        | 'gstin'
        | 'creditTerms'
        | 'preferredPaymentMethod'
        | 'openingBalance'
        | 'notes'
      >
    >,
    options?: { duplicateMode?: 'UPDATE' | 'SKIP' }
  ) => { imported: number; updated: number; skipped?: number };
  importProductsFromCSV: (csvText: string) => { imported: number; skipped: number; errors: string[] };
  importProductsBatch: (
    rows: ParsedInventoryImportRow[],
    options?: { duplicateMode?: 'UPDATE' | 'SKIP' }
  ) => { imported: number; updated: number; skipped: number };

  auditLogs: AuditLog[];
  alerts: AlertNotification[];
  markAlertRead: (id: string) => void;
  dismissAllAlerts: () => void;

  // Global Quick Sale Modal State
  isQuickSaleOpen: boolean;
  setIsQuickSaleOpen: (open: boolean) => void;

  // Daily Closing Report Modal & Theme Toggle
  isDailyClosingOpen: boolean;
  setIsDailyClosingOpen: (open: boolean) => void;
  lastClosedDate: string | null;
  markDayClosed: (dateKey: string, notes?: string) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  accentColor: string;
  accentRamp: AccentRamp;
  setAccentColor: (hex: string) => void;
  resetAccentColor: () => void;

  // Selected customer for detailed ledger view
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;

  // Selected supplier for detailed ledger view
  selectedSupplierId: string | null;
  setSelectedSupplierId: (id: string | null) => void;
  openSupplierProfile: (supplierId: string) => void;

  // Deep navigation states for Settings Categories & Reports Stock Movement
  settingsActiveSection: 'GENERAL' | 'CATEGORIES' | 'THERMAL_PRINT' | 'BACKUP' | 'WHATSAPP';
  setSettingsActiveSection: (
    section: 'GENERAL' | 'CATEGORIES' | 'THERMAL_PRINT' | 'BACKUP' | 'WHATSAPP'
  ) => void;
  openCategorySettings: () => void;
  openThermalPrintSettings: () => void;
  inventoryActiveTab: 'ALL' | 'LOW_STOCK' | 'VELOCITY_MONITOR' | 'PURCHASE_PLAN';
  setInventoryActiveTab: (tab: 'ALL' | 'LOW_STOCK' | 'VELOCITY_MONITOR' | 'PURCHASE_PLAN') => void;
  openInventoryVelocityMonitor: () => void;
  reportsActiveTab: ReportsTab;
  setReportsActiveTab: (tab: ReportsTab) => void;
  stockReportProductFilter: string;
  setStockReportProductFilter: (productId: string) => void;
  openStockMovementReport: (productId?: string) => void;

  // Low-stock to Purchase prefill flow (never auto-creates purchases)
  purchasePrefill: PurchasePrefillContext | null;
  setPurchasePrefill: (prefill: PurchasePrefillContext | null) => void;
  openAddPurchaseForProduct: (prefill: PurchasePrefillContext) => void;

  // Pin & persistent store session authentication (PBKDF2 salted hash + signed IndexedDB session)
  authStatus: AuthLifecycleStatus;
  authInitStage: AuthInitStage;
  isAuthInitializing: boolean;
  isAuthenticated: boolean;
  isFirebaseAuthReady: boolean;
  authSession: AuthSessionPayload | null;
  authNotice: AuthNotice | null;
  clearAuthNotice: () => void;
  completeStoreLogin: (params: {
    authMode: StoreAuthMode;
    mobile?: string;
    portalEntityId?: string;
    portalEntityName?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  createOwnerAccount: (params: {
    storeName: string;
    ownerName: string;
    mobile: string;
    pin: string;
    confirmPin: string;
  }) => Promise<{ success: boolean; error?: string }>;
  registerStoreOwnerWithFirebase: (params: StoreRegistrationInput) => Promise<{
    success: boolean;
    error?: string;
    firestoreInitialized?: boolean;
    verificationEmailSent?: boolean;
    cloudUserEmail?: string | null;
    providerDisabled?: boolean;
    notice?: string;
  }>;
  requestPasswordResetEmail: (identifier: string) => Promise<{
    success: boolean;
    maskedEmail?: string;
    message?: string;
    error?: string;
    needsEmailInput?: boolean;
    providerDisabled?: boolean;
  }>;
  recoverOwnerWithStoreDetails: (params: {
    mobile: string;
    ownerName: string;
    storeName: string;
    newPin: string;
    confirmNewPin: string;
  }) => Promise<{ success: boolean; error?: string }>;
  recoverOwnerWithGoogle: (params: {
    newPin: string;
    confirmNewPin: string;
  }) => Promise<{ success: boolean; error?: string }>;
  loginAsCustomer: (params: {
    name: string;
    phone: string;
  }) => Promise<{ success: boolean; error?: string; customerId?: string }>;
  loginAsSupplier: (params: {
    name: string;
    phone: string;
  }) => Promise<{ success: boolean; error?: string; supplierId?: string }>;
  logout: () => Promise<void>;
  isLocked: boolean;
  needsPinSetup: boolean;
  hasPinConfigured: boolean;
  verifyPin: (pin: string) => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  completePinSetupRecovery: (newPin: string) => Promise<{ success: boolean; error?: string }>;
  updatePinSecurity: (
    newPin?: string,
    isPinEnabled?: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  lockApp: () => void;

  // Stage 4: Daily Sales Target, Bulk Inventory & Recurring Expenses
  dailySalesTarget: DailySalesTargetConfig | null;
  setDailySalesTarget: (targetAmount: number) => void;
  bulkUpdateProductsCategory: (ids: string[], category: string) => number;
  bulkDeleteOrArchiveProducts: (
    ids: string[],
    reason?: string
  ) => { archivedCount: number; deletedCount: number };
  recurringExpenses: RecurringExpense[];
  addRecurringExpense: (
    data: Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'>
  ) => string;
  updateRecurringExpense: (id: string, patch: Partial<RecurringExpense>) => void;
  deleteRecurringExpense: (id: string) => void;
  generateDueRecurringExpense: (id: string, customDate?: string) => boolean;
  billDocuments: BillAttachment[];
  refreshBillDocuments: () => Promise<void>;

  // Computed financial KPIs
  financials: {
    todaySales: number;
    monthlySales: number;
    grossMonthlySales: number;
    monthlySalesReturns: number;
    todayPurchases: number;
    monthlyPurchases: number;
    todayExpenses: number;
    monthlyExpenses: number;
    estimatedGrossProfit: number;
    estimatedNetProfit: number;
    hasCompleteCogs: boolean;
    costCoveragePct: number;
    uncostedRevenue: number;
    costedRevenue: number;
    reviewStatus: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
    profitStatus: 'VERIFIED' | 'PROVISIONAL_PARTIAL' | 'UNCOSTED' | 'NEEDS_REVIEW';
    isProfitVerified: boolean;
    knownCostGrossProfit: number | null;
    knownCostGrossMarginPct: number | null;
    verifiedGrossProfit: number | null;
    verifiedNetProfit: number | null;
    bankRevenue: number;
    totalCustomerOutstanding: number;
    totalSupplierOutstanding: number;
    availableCash: number;
    totalInventoryValue: number;
    salesGrowthPct: number;
    hasPriorGrowthBaseline: boolean;
  };
  accountingReconciliation: AccountingReconciliationReport;

  resetToDemoData: () => void;
  exportBackupJSON: (customFilename?: string) => void;
  importBackupJSON: (jsonStr: string) => boolean;
  restoreBackupFromJSON: (jsonStr: string) => { success: boolean; error?: string; count?: number };
  getBackupJSONString: () => string;
  getBackupSummary: () => AppBackupSummary;
  isBackupModalOpen: boolean;
  setIsBackupModalOpen: (open: boolean) => void;

  // WhatsApp Bulk Payment Reminders
  whatsappBatches: WhatsAppReminderBatch[];
  currentBatch: WhatsAppReminderBatch | null;
  whatsappConfig: WhatsAppApiConfig | null;
  whatsappAuditLogs: WhatsAppAuditLog[];
  nextScheduleInfo: { nextExecutionISO: string; day: string; time: string; timezone: string } | null;
  isLoadingWhatsApp: boolean;
  loadWhatsAppBatches: () => Promise<void>;
  generateWhatsAppBatch: (force?: boolean) => Promise<WhatsAppReminderBatch | null>;
  approveWhatsAppBatch: (batchId: string, approvedCustomerIds: string[]) => Promise<WhatsAppReminderBatch | null>;
  cancelWhatsAppBatch: (batchId: string, reason?: string) => Promise<WhatsAppReminderBatch | null>;
  sendApprovedWhatsAppBatch: (batchId: string) => Promise<{ sentCount: number; failedCount: number; skippedCount: number }>;
  updateWhatsAppConfig: (
    patch: Partial<WhatsAppApiConfig> & {
      accessToken?: string;
      webhookVerifyToken?: string;
      verifiedTestNumber?: string;
    }
  ) => Promise<WhatsAppApiConfig | null>;
  testWhatsAppConnection: () => Promise<{ success: boolean; message: string }>;
  sendTestWhatsAppMessage: (payload: {
    testPhoneNumber?: string;
    customerName?: string;
    outstandingAmount?: number;
  }) => Promise<{
    success: boolean;
    message: string;
    messageId?: string;
    formattedPhone?: string;
    sandboxSimulated?: boolean;
    apiResponseSummary?: WhatsAppApiResponseSummary;
  }>;
  toggleCustomerWhatsAppConsent: (customerId: string, consent: boolean) => void;

  // Local-First IndexedDB & Encrypted Backup State (Single-Phone Architecture)
  isDbHydrated: boolean;
  dbInitError: string | null;
  needsFirstTimeSetup: boolean;
  retryDatabaseInit: () => void;
  completeFirstTimeSetup: (input: {
    storeName: string;
    ownerName?: string;
    phone?: string;
    upiId?: string;
    address?: string;
    gstin?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  demoDataAnalysis: DemoVsRealAnalysis;
  clearDemoRecordsOnly: () => Promise<{ removedCount: number; preservedReferencedCount: number }>;
  migrationReport: MigrationReport | null;
  storageStatus: StorageStatusSummary;
  clearStorageError: () => void;
  localBackups: LocalBackupSnapshot[];
  autoBackupSettings: AutoBackupSettings;
  createManualLocalBackup: (reason?: string) => Promise<LocalBackupSnapshot | null>;
  restoreFromLocalBackupSnapshot: (
    snapshotId: string
  ) => Promise<{
    success: boolean;
    error?: string;
    count?: number;
    verifiedCounts?: VerifiedRestoreCounts;
    reconciliationReport?: BackupReconciliationReport;
    warnings?: string[];
  }>;
  deleteLocalBackupSnapshot: (snapshotId: string) => Promise<void>;
  getCurrentBusinessDataset: () => StoreBusinessDataset;
  exportBackupPdfReport: (
    customFilename?: string,
    preferShareSheet?: boolean
  ) => Promise<{ savedVia?: BackupExportMethod; cancelled?: boolean; fileName?: string; byteSize?: number }>;
  exportBackupExcelFile: (
    customFilename?: string,
    preferShareSheet?: boolean
  ) => Promise<{ savedVia?: BackupExportMethod; cancelled?: boolean; fileName?: string; byteSize?: number }>;
  exportVerifiedBackupFile: (
    customFilename?: string,
    preferShareSheet?: boolean
  ) => Promise<{
    savedVia?: BackupExportMethod;
    cancelled?: boolean;
    fileName?: string;
    byteSize?: number;
    checksum?: string;
  }>;
  exportEncryptedBackupFile: (
    passphrase: string,
    customFilename?: string,
    preferShareSheet?: boolean
  ) => Promise<{
    savedVia?: BackupExportMethod;
    cancelled?: boolean;
    fileName?: string;
    byteSize?: number;
    checksum?: string;
  }>;
  restoreBackupFromJSONSafe: (
    contentStr: string,
    passphrase?: string
  ) => Promise<{
    success: boolean;
    error?: string;
    count?: number;
    rollbackCheckpointId?: string;
    verifiedCounts?: VerifiedRestoreCounts;
    reconciliationReport?: BackupReconciliationReport;
    warnings?: string[];
  }>;
  updateAutoBackupSettings: (patch: Partial<AutoBackupSettings>) => Promise<void>;
  refreshStorageTelemetry: () => Promise<void>;
  purgeLegacyLocalStorageArchive: () => Promise<void>;

  // Phase 5: Encrypted Firebase Cloud Storage Backup & Disaster Recovery (LOCAL_ONLY primary)
  cloudAuthUser: CloudAuthUser | null;
  cloudBackupConfig: CloudBackupConfig;
  cloudBackupStatus: CloudBackupStatus;
  cloudBackupHistory: CloudBackupRemoteEntry[];
  isCloudPassphraseUnlocked: boolean;
  isCloudBackupBusy: boolean;
  signInCloudBackupAccount: () => Promise<{ success: boolean; error?: string; redirectStarted?: boolean }>;
  signOutCloudBackupAccount: () => Promise<void>;
  unlockCloudBackupPassphrase: (
    passphrase: string,
    mode?: 'UNLOCK' | 'SET_NEW'
  ) => Promise<{ success: boolean; error?: string }>;
  lockCloudBackupPassphrase: () => void;
  updateCloudBackupConfig: (patch: Partial<CloudBackupConfig>) => Promise<void>;
  refreshCloudBackupHistory: () => Promise<CloudBackupRemoteEntry[]>;
  backupNowToCloud: (options?: {
    passphrase?: string;
    bucket?: 'daily' | 'manual';
    allowRebindOwner?: boolean;
  }) => Promise<{ success: boolean; error?: string; entry?: CloudBackupRemoteEntry }>;
  previewCloudBackupForRestore: (params: {
    fullPath: string;
    passphrase: string;
  }) => Promise<{
    success: boolean;
    error?: string;
    inspected?: InspectedBackupResult;
    rawEncryptedJson?: string;
    sizeBytes?: number;
    ciphertextSha256?: string;
  }>;
  restoreFromCloudBackup: (params: {
    fullPath: string;
    passphrase: string;
    allowRebindOwner?: boolean;
  }) => Promise<{
    success: boolean;
    error?: string;
    criticalRecoveryFailure?: boolean;
    count?: number;
    rollbackCheckpointId?: string;
    verifiedCounts?: VerifiedRestoreCounts;
    reconciliationReport?: BackupReconciliationReport;
    warnings?: string[];
  }>;
}

const STORAGE_KEYS = {
  THEME: 'kirana_pro_theme_v1',
};

const StoreContext = createContext<StoreContextType | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavTab>('DASHBOARD');
  const [dateFilter, setDateFilter] = useState<DateFilterRange>('THIS_MONTH');
  const [customDateRange, setCustomDateRange] = useState<DateRange>(() => {
    const todayKey = getLocalTodayKey();
    return {
      startDate: `${todayKey.slice(0, 7)}-01`,
      endDate: todayKey,
    };
  });

  const [isQuickSaleOpen, setIsQuickSaleOpen] = useState(false);
  const [isDailyClosingOpen, setIsDailyClosingOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [purchasePrefill, setPurchasePrefill] = useState<PurchasePrefillContext | null>(null);
  const [settingsActiveSection, setSettingsActiveSection] = useState<
    'GENERAL' | 'CATEGORIES' | 'THERMAL_PRINT' | 'BACKUP' | 'WHATSAPP'
  >('GENERAL');
  const [inventoryActiveTab, setInventoryActiveTab] = useState<
    'ALL' | 'LOW_STOCK' | 'VELOCITY_MONITOR' | 'PURCHASE_PLAN'
  >('ALL');
  const [reportsActiveTab, setReportsActiveTab] = useState<ReportsTab>('BUSINESS');
  const [stockReportProductFilter, setStockReportProductFilter] = useState<string>('ALL');

  const openSupplierProfile = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setActiveTab('SUPPLIERS');
  };

  const openCategorySettings = () => {
    setSettingsActiveSection('CATEGORIES');
    setActiveTab('SETTINGS');
  };

  const openThermalPrintSettings = () => {
    setSettingsActiveSection('THERMAL_PRINT');
    setActiveTab('SETTINGS');
  };

  const openInventoryVelocityMonitor = () => {
    setInventoryActiveTab('VELOCITY_MONITOR');
    setActiveTab('INVENTORY');
  };

  const openStockMovementReport = (productId?: string) => {
    setStockReportProductFilter(productId || 'ALL');
    setReportsActiveTab('STOCK_MOVEMENT');
    setActiveTab('REPORTS');
  };

  const openAddPurchaseForProduct = (prefill: PurchasePrefillContext) => {
    setPurchasePrefill(prefill);
    setActiveTab('PURCHASES');
  };

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.THEME);
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    try {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const [accentColor, setAccentColorState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
      return normalizeHexColor(saved) ?? DEFAULT_ACCENT_COLOR;
    } catch {
      return DEFAULT_ACCENT_COLOR;
    }
  });

  const accentRamp = useMemo(() => generateAccentRamp(accentColor), [accentColor]);

  const setAccentColor = useCallback((hex: string) => {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return;
    setAccentColorState(normalized);
  }, []);

  const resetAccentColor = useCallback(() => {
    setAccentColorState(DEFAULT_ACCENT_COLOR);
  }, []);

  useEffect(() => {
    try {
      applyAccentColorToDocument(accentColor);
      localStorage.setItem(ACCENT_STORAGE_KEY, accentColor);
    } catch {
      // ignore storage errors
    }
  }, [accentColor]);

  const [lastClosedDate, setLastClosedDate] = useState<string | null>(null);

  // Profile & Auth Session State (starts strictly in 'auth-initializing' until DB + session + Firebase Auth settle)
  const [profile, setProfile] = useState<StoreProfile>(() => createEmptyStoreProfile());
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [needsPinSetup, setNeedsPinSetup] = useState<boolean>(false);
  const [hasPinConfigured, setHasPinConfigured] = useState<boolean>(false);
  const [isDbOpened, setIsDbOpened] = useState<boolean>(false);
  const [isStoreSessionChecked, setIsStoreSessionChecked] = useState<boolean>(false);
  const [isFirebaseAuthReady, setIsFirebaseAuthReady] = useState<boolean>(false);
  const [hasVerifiedStoreSession, setHasVerifiedStoreSession] = useState<boolean>(false);
  const [authSession, setAuthSession] = useState<AuthSessionPayload | null>(null);
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);

  // Entities State (hydrated from IndexedDB)
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierTransactions, setSupplierTransactions] = useState<SupplierTransaction[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [cashbookEntries, setCashbookEntries] = useState<CashbookEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategoryConfig[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryConfig[]>([]);
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustmentRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [whatsappBatches, setWhatsappBatches] = useState<WhatsAppReminderBatch[]>([]);
  const [whatsappAuditLogs, setWhatsappAuditLogs] = useState<WhatsAppAuditLog[]>([]);
  const [billDocuments, setBillDocuments] = useState<BillAttachment[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [dailySalesTarget, setDailySalesTargetState] = useState<DailySalesTargetConfig | null>(null);

  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppApiConfig | null>(null);
  const [nextScheduleInfo, setNextScheduleInfo] = useState<{
    nextExecutionISO: string;
    day: string;
    time: string;
    timezone: string;
  } | null>(null);
  const [isLoadingWhatsApp, setIsLoadingWhatsApp] = useState(false);

  const [alerts, setAlerts] = useState<AlertNotification[]>([]);

  // Local-First IndexedDB Adapter & Telemetry State
  const dbRef = useRef<LocalDbAdapter | null>(null);
  const isDbWritableRef = useRef<boolean>(false);
  const pinSecurityRef = useRef<PinSecurityRecord | null>(null);
  const lastBatchBackupTsRef = useRef<number>(0);
  const lastTxTotalRef = useRef<number>(-1);
  const [isDbHydrated, setIsDbHydrated] = useState(false);
  const [dbInitError, setDbInitError] = useState<string | null>(null);
  const [needsFirstTimeSetup, setNeedsFirstTimeSetup] = useState<boolean>(false);
  const [bootAttempt, setBootAttempt] = useState<number>(0);
  const [migrationReport, setMigrationReport] = useState<MigrationReport | null>(null);
  const [localBackups, setLocalBackups] = useState<LocalBackupSnapshot[]>([]);
  const [autoBackupSettings, setAutoBackupSettings] = useState<AutoBackupSettings>(DEFAULT_AUTO_BACKUP_SETTINGS);
  const [cloudAuthUser, setCloudAuthUser] = useState<CloudAuthUser | null>(null);
  const [cloudBackupConfig, setCloudBackupConfig] = useState<CloudBackupConfig>(DEFAULT_CLOUD_BACKUP_CONFIG);
  const [cloudBackupStatus, setCloudBackupStatus] = useState<CloudBackupStatus>(DEFAULT_CLOUD_BACKUP_STATUS);
  const [cloudBackupHistory, setCloudBackupHistory] = useState<CloudBackupRemoteEntry[]>([]);
  const [isCloudPassphraseUnlocked, setIsCloudPassphraseUnlocked] = useState<boolean>(false);
  const [isCloudBackupBusy, setIsCloudBackupBusy] = useState<boolean>(false);
  // Session-only memory ref: never write plaintext passphrase to localStorage or IndexedDB
  const cloudSessionPassphraseRef = useRef<string | null>(null);
  const cloudUploadInFlightRef = useRef<boolean>(false);
  const cloudTransportRef = useRef(createFirebaseCloudBackupTransport(firebaseStorage));
  const [storageStatus, setStorageStatus] = useState<StorageStatusSummary>({
    storageMode: 'LOCAL_ONLY',
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isPersistedStorage: false,
    usageBytes: 0,
    quotaBytes: 0,
    usagePct: 0,
    quotaWarning: false,
    storageError: null,
    dbName: LOCAL_DB_NAME,
    dbVersion: LOCAL_DB_VERSION,
    migratedFromLocalStorage: false,
    pendingSyncCount: 0,
    failedSyncCount: 0,
    conflictCount: 0,
    billDocumentsCount: 0,
    legacyArchivePresent: false,
  });

  const clearStorageError = useCallback(() => {
    setStorageStatus((prev) => ({ ...prev, storageError: null }));
  }, []);

  const currentDatasetSnapshot = useMemo<StoreBusinessDataset>(
    () => ({
      profile,
      customers,
      customerTransactions,
      suppliers,
      supplierTransactions,
      sales,
      expenses,
      cashbookEntries,
      products,
      productCategories,
      expenseCategories,
      stockAdjustments,
      auditLogs,
      whatsappBatches,
      whatsappAuditLogs,
      billDocuments,
      recurringExpenses,
      dailySalesTarget,
      lastClosedDate,
    }),
    [
      profile,
      customers,
      customerTransactions,
      suppliers,
      supplierTransactions,
      sales,
      expenses,
      cashbookEntries,
      products,
      productCategories,
      expenseCategories,
      stockAdjustments,
      auditLogs,
      whatsappBatches,
      whatsappAuditLogs,
      billDocuments,
      recurringExpenses,
      dailySalesTarget,
      lastClosedDate,
    ]
  );

  const latestDatasetRef = useRef<StoreBusinessDataset>(currentDatasetSnapshot);
  latestDatasetRef.current = currentDatasetSnapshot;

  const refreshStorageTelemetry = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [backups, quotaInfo, lastBackupMeta, savedAutoSettings, storedDocs, savedCloudConfig, savedCloudStatus] = await Promise.all([
      listLocalBackups(db),
      requestAndCheckStorageQuota(),
      db.getMeta<{ lastBackupAt: string; status: 'SUCCESS' | 'FAILED' }>('lastBackupMeta'),
      db.getMeta<AutoBackupSettings>('autoBackupSettings'),
      db.getAll<BillAttachment>(STORE_NAMES.BILL_DOCUMENTS),
      db.getMeta<CloudBackupConfig>('cloudBackupConfig'),
      db.getMeta<CloudBackupStatus>('cloudBackupStatus'),
    ]);

    setLocalBackups(backups);
    if (savedAutoSettings) {
      setAutoBackupSettings(savedAutoSettings);
    }
    if (savedCloudConfig) {
      setCloudBackupConfig({ ...DEFAULT_CLOUD_BACKUP_CONFIG, ...savedCloudConfig });
    }
    if (savedCloudStatus) {
      setCloudBackupStatus({ ...DEFAULT_CLOUD_BACKUP_STATUS, ...savedCloudStatus });
    }

    const legacyArchivePresent = hasLegacyLocalStorageBusinessData(
      typeof window !== 'undefined' ? window.localStorage : null
    );

    setStorageStatus((prev) => ({
      ...prev,
      storageMode: 'LOCAL_ONLY',
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isPersistedStorage: quotaInfo.isPersisted,
      usageBytes: quotaInfo.usageBytes,
      quotaBytes: quotaInfo.quotaBytes,
      usagePct: quotaInfo.usagePct,
      quotaWarning: quotaInfo.quotaWarning,
      lastBackupAt: lastBackupMeta?.lastBackupAt || backups[0]?.createdAt,
      lastBackupStatus: lastBackupMeta?.status || backups[0]?.status,
      pendingSyncCount: 0,
      failedSyncCount: 0,
      conflictCount: 0,
      billDocumentsCount: storedDocs.length,
      legacyArchivePresent,
    }));
  }, []);

  const refreshBillDocuments = useCallback(async () => {
    try {
      const docs = await getAllBillDocuments();
      setBillDocuments(docs);
      await refreshStorageTelemetry();
    } catch (err) {
      const msg = formatStorageError(err, 'read bill attachments').message;
      setStorageStatus((prev) => ({ ...prev, storageError: msg }));
    }
  }, [refreshStorageTelemetry]);

  const authInitSignals = useMemo(
    () => ({
      isDbOpened,
      isDbHydrated,
      isStoreSessionChecked,
      isFirebaseAuthReady,
      hasVerifiedSession: hasVerifiedStoreSession,
    }),
    [
      isDbOpened,
      isDbHydrated,
      isStoreSessionChecked,
      isFirebaseAuthReady,
      hasVerifiedStoreSession,
    ]
  );

  const authStatus = useMemo<AuthLifecycleStatus>(
    () => resolveAuthLifecycleStatus(authInitSignals),
    [authInitSignals]
  );

  const authInitStage = useMemo<AuthInitStage>(
    () => resolveAuthInitStage(authInitSignals),
    [authInitSignals]
  );

  const isAuthInitializing = authStatus === 'auth-initializing';
  const isAuthenticated = authStatus === 'authenticated';

  const retryDatabaseInit = useCallback(() => {
    setIsDbOpened(false);
    setIsDbHydrated(false);
    setIsStoreSessionChecked(false);
    setDbInitError(null);
    setBootAttempt((prev) => prev + 1);
  }, []);

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null);
  }, []);

  const persistNewAuthSession = useCallback(
    async (params: {
      authMode: StoreAuthMode;
      mobile?: string;
      portalEntityId?: string;
      portalEntityName?: string;
      pinRecordOverride?: PinSecurityRecord | null;
    }): Promise<AuthSessionPayload> => {
      const effectivePin =
        params.pinRecordOverride !== undefined ? params.pinRecordOverride : pinSecurityRef.current;
      const { record, key } = await createSignedAuthSession({
        authMode: params.authMode,
        mobile: params.mobile,
        portalEntityId: params.portalEntityId,
        portalEntityName: params.portalEntityName,
        pinRecord: effectivePin,
      });
      if (dbRef.current) {
        await dbRef.current.setMeta(AUTH_SESSION_KEY_META_KEY, key);
        await dbRef.current.setMeta(AUTH_SESSION_META_KEY, record);
      }
      setAuthSession(record.payload);
      setHasVerifiedStoreSession(true);
      setIsLocked(false);
      setAuthNotice(null);
      return record.payload;
    },
    []
  );

  const revokePersistedAuthSession = useCallback(async () => {
    if (dbRef.current) {
      try {
        await dbRef.current.setMeta(AUTH_SESSION_META_KEY, null);
        await dbRef.current.setMeta(AUTH_SESSION_KEY_META_KEY, null);
      } catch {
        // ignore storage cleanup errors
      }
    }
    clearInMemoryApiSession();
    setAuthSession(null);
    setHasVerifiedStoreSession(false);
  }, []);

  // Boot: Open Unified IndexedDB v2, run non-destructive localStorage & Bills DB migration, process due auto-recurring expenses
  useEffect(() => {
    let active = true;
    isDbWritableRef.current = false;
    (async () => {
      try {
        const db = await openLocalDatabase();
        if (!active) {
          db.close?.();
          return;
        }
        dbRef.current = db;
        registerActiveLocalDbAdapter(db);
        setIsDbOpened(true);

        const { dataset, report } = await migrateLegacyLocalStorageToLocalDb(
          db,
          createEmptyBusinessDataset(),
          typeof window !== 'undefined' ? window.localStorage : null,
          readLegacyBillsDbDocuments
        );
        if (!active) return;

        const savedPin = await db.getMeta<PinSecurityRecord>('pinSecurity');
        pinSecurityRef.current = savedPin;
        setHasPinConfigured(Boolean(savedPin?.hashBase64));

        const savedSetupFlag = await db.getMeta<boolean>('firstTimeSetupCompleted');

        // Idempotent auto-creation for recurring expenses that are due today
        const todayKey = getLocalTodayKey();
        let workingExpenses = [...dataset.expenses];
        let workingCashbook = [...dataset.cashbookEntries];
        let workingAudits = [...dataset.auditLogs];
        const existingExpIds = new Set(workingExpenses.map((e) => e.id));
        const dueAutos = getDueRecurringExpenses(dataset.recurringExpenses || [], todayKey).filter(
          (s) => s.autoCreateOnDue && s.lastGeneratedDate !== todayKey
        );
        const updatedScheduleMap = new Map<string, RecurringExpense>();

        for (const sched of dueAutos) {
          const idempId = `exp-rec-${sched.id}-${sched.nextDueDate}`;
          if (!existingExpIds.has(idempId)) {
            const nowIso = new Date().toISOString();
            const newExp: ExpenseRecord = {
              id: idempId,
              title: `${sched.title} (Auto-Recurring)`,
              category: sched.category,
              amount: sched.amount,
              isPersonalWithdrawal: false,
              paymentMethod: sched.paymentMethod,
              date: todayKey,
              notes: sched.notes ? `${sched.notes} • Auto-recorded` : `Auto-recorded ${sched.frequency} expense`,
              attachments: [],
              createdAt: nowIso,
            };
            workingExpenses = [newExp, ...workingExpenses];
            existingExpIds.add(idempId);

            if (sched.paymentMethod === 'CASH') {
              workingCashbook = [
                {
                  id: `cb-rec-${sched.id}-${sched.nextDueDate}`,
                  date: todayKey,
                  type: 'OUT',
                  category: 'EXPENSE',
                  description: `${sched.title} (Auto-Recurring ${sched.category})`,
                  amount: sched.amount,
                  paymentMode: 'CASH',
                  refType: 'EXPENSE',
                  refId: idempId,
                  attachments: [],
                  createdAt: nowIso,
                },
                ...workingCashbook,
              ];
            }

            workingAudits = [
              {
                id: `log-rec-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                timestamp: nowIso,
                action: 'RECURRING_EXPENSE_AUTO',
                details: `Auto-recorded due recurring expense "${sched.title}" (₹${sched.amount})`,
                entityType: 'EXPENSE',
                entityId: idempId,
                user: dataset.profile.ownerName || 'Store Manager',
              },
              ...workingAudits.slice(0, 199),
            ];
          }

          updatedScheduleMap.set(sched.id, {
            ...sched,
            lastGeneratedDate: todayKey,
            nextDueDate: advanceRecurringDueDate(sched.nextDueDate, sched.frequency),
            updatedAt: new Date().toISOString(),
          });
        }

        const finalRecurring = (dataset.recurringExpenses || []).map(
          (r) => updatedScheduleMap.get(r.id) || r
        );

        const hydratedProfile = sanitizeProfileForStorage(dataset.profile);
        const hydratedDataset: StoreBusinessDataset = {
          ...dataset,
          profile: hydratedProfile,
          expenses: workingExpenses,
          cashbookEntries: workingCashbook,
          auditLogs: workingAudits,
          recurringExpenses: finalRecurring,
        };

        const requiresSetup = shouldRequireFirstTimeSetup({
          firstTimeSetupCompleted: savedSetupFlag,
          dataset: hydratedDataset,
        });
        if (!requiresSetup && savedSetupFlag !== true) {
          await db.setMeta('firstTimeSetupCompleted', true);
        }

        const savedSessionRecord = await db.getMeta<PersistedAuthSessionRecord | null>(
          AUTH_SESSION_META_KEY
        );
        const savedSessionKey = await db.getMeta<CryptoKey | null>(AUTH_SESSION_KEY_META_KEY);
        const sessionCheck = await verifyPersistedAuthSession({
          record: savedSessionRecord,
          key: savedSessionKey,
          pinRecord: savedPin,
          isPinEnabled: Boolean(hydratedProfile.isPinEnabled),
          registeredPhone: hydratedProfile.phone,
        });

        setProfile(hydratedProfile);
        const missingPinHash = Boolean(hydratedProfile.isPinEnabled && !savedPin?.hashBase64);
        setNeedsPinSetup(missingPinHash);

        let restoredSessionValid = sessionCheck.status === 'VALID' && Boolean(sessionCheck.session);
        let restoredInvalidReason = sessionCheck.reason;

        if (restoredSessionValid && sessionCheck.session) {
          if (sessionCheck.session.authMode === 'CUSTOMER') {
            const exists = dataset.customers.some(
              (c) => c.id === sessionCheck.session?.portalEntityId
            );
            if (!exists) {
              restoredSessionValid = false;
              restoredInvalidReason =
                'Your customer profile could not be found in store records. Please sign in again.';
            }
          } else if (sessionCheck.session.authMode === 'SUPPLIER') {
            const exists = dataset.suppliers.some(
              (s) => s.id === sessionCheck.session?.portalEntityId
            );
            if (!exists) {
              restoredSessionValid = false;
              restoredInvalidReason =
                'Your supplier profile could not be found in store records. Please sign in again.';
            }
          }
        }

        if (restoredSessionValid && sessionCheck.session) {
          setAuthSession(sessionCheck.session);
          setHasVerifiedStoreSession(true);
          setIsLocked(false);
          setAuthNotice(null);
        } else {
          if (sessionCheck.status !== 'MISSING') {
            await db.setMeta(AUTH_SESSION_META_KEY, null);
            await db.setMeta(AUTH_SESSION_KEY_META_KEY, null);
            setAuthNotice({
              type: sessionCheck.status === 'EXPIRED' ? 'expired' : 'error',
              message:
                restoredInvalidReason ||
                'Your session is no longer valid. Please log in again.',
            });
          } else {
            setAuthNotice(null);
          }
          setAuthSession(null);
          setHasVerifiedStoreSession(false);
          setIsLocked(Boolean(hydratedProfile.isPinEnabled));
        }
        setIsStoreSessionChecked(true);
        setCustomers(dataset.customers);
        setCustomerTransactions(dataset.customerTransactions);
        setSuppliers(dataset.suppliers);
        setSupplierTransactions(dataset.supplierTransactions);
        setSales(dataset.sales);
        setExpenses(workingExpenses);
        setCashbookEntries(workingCashbook);
        setProducts(dataset.products);
        setProductCategories(
          buildDefaultProductCategories(dataset.products, dataset.productCategories || [])
        );
        setExpenseCategories(
          buildDefaultExpenseCategories(
            workingExpenses,
            finalRecurring,
            dataset.expenseCategories || []
          )
        );
        setStockAdjustments(dataset.stockAdjustments);
        setAuditLogs(workingAudits);
        setWhatsappBatches(dataset.whatsappBatches);
        setWhatsappAuditLogs(dataset.whatsappAuditLogs);
        setBillDocuments(dataset.billDocuments || []);
        setRecurringExpenses(finalRecurring);
        setDailySalesTargetState(dataset.dailySalesTarget ?? null);
        setLastClosedDate(dataset.lastClosedDate ?? null);
        setMigrationReport(report);
        setNeedsFirstTimeSetup(requiresSetup);

        lastTxTotalRef.current =
          dataset.sales.length +
          dataset.customerTransactions.length +
          dataset.supplierTransactions.length +
          workingExpenses.length;

        // Ensure an initial baseline local backup exists once shop setup is active
        const existingBackups = await listLocalBackups(db);
        if (existingBackups.length === 0 && !requiresSetup) {
          await createLocalBackupSnapshot(
            db,
            hydratedDataset,
            'AUTO_INTERVAL',
            'Initial IndexedDB baseline snapshot'
          );
        }

        setStorageStatus((prev) => ({
          ...prev,
          migratedFromLocalStorage: report.migrated,
          migratedAt: report.migratedAt,
          storageError: null,
        }));

        isDbWritableRef.current = true;
        setDbInitError(null);
        setIsDbHydrated(true);
        await refreshStorageTelemetry();
      } catch (err) {
        isDbWritableRef.current = false;
        const msg = formatStorageError(err, 'open local IndexedDB database').message;
        setDbInitError(msg);
        setStorageStatus((prev) => ({ ...prev, storageError: msg }));
        setIsStoreSessionChecked(true);
        setIsDbHydrated(true);
      }
    })();

    return () => {
      active = false;
      isDbWritableRef.current = false;
      registerActiveLocalDbAdapter(null);
      dbRef.current?.close?.();
    };
  }, [refreshStorageTelemetry, bootAttempt]);

  // Subscribe to Firebase Google Auth session (persisted via browserLocalPersistence)
  // Wait for setPersistence + auth.authStateReady() + redirect result + initial onAuthStateChanged
  // before releasing the 'auth-initializing' gate so restored Firebase sessions are never dropped.
  useEffect(() => {
    let active = true;
    let resolvedOnce = false;
    let listenerFired = false;
    let authReadySettled = false;

    const tryMarkFirebaseReady = () => {
      if (!resolvedOnce && active && listenerFired && authReadySettled) {
        resolvedOnce = true;
        setIsFirebaseAuthReady(true);
      }
    };

    const forceMarkFirebaseReady = () => {
      if (!resolvedOnce && active) {
        resolvedOnce = true;
        setIsFirebaseAuthReady(true);
      }
    };

    // Ensure offline / slow network environments never block startup initialization indefinitely
    const offlineFallbackTimer = setTimeout(forceMarkFirebaseReady, 2500);

    const unsubscribe = subscribeToFirebaseAuth(
      (user) => {
        if (!active) return;
        setCloudAuthUser(user);
        setStorageStatus((prev) => ({
          ...prev,
          cloudSyncConfigured: Boolean(user?.emailVerified),
          cloudUserEmail: user?.email ?? null,
        }));
        listenerFired = true;
        tryMarkFirebaseReady();
      },
      (error) => {
        if (!active) return;
        setCloudBackupStatus((prev) => ({
          ...prev,
          state: 'ERROR',
          lastError: error?.message || 'Authentication state could not be restored.',
        }));
        listenerFired = true;
        tryMarkFirebaseReady();
      }
    );

    void testFirestoreConnection();

    waitForFirebaseAuthReady()
      .then((restoredUser) => {
        if (!active) return;
        if (restoredUser) {
          setCloudAuthUser(restoredUser);
          setStorageStatus((prev) => ({
            ...prev,
            cloudSyncConfigured: Boolean(restoredUser.emailVerified),
            cloudUserEmail: restoredUser.email ?? null,
          }));
        }
        authReadySettled = true;
        tryMarkFirebaseReady();
      })
      .catch((err) => {
        if (!active) return;
        setCloudBackupStatus((prev) => ({
          ...prev,
          state: 'ERROR',
          lastError: err instanceof Error ? err.message : 'Google sign-in session check failed.',
        }));
        authReadySettled = true;
        tryMarkFirebaseReady();
      });

    return () => {
      active = false;
      clearTimeout(offlineFallbackTimer);
      unsubscribe();
    };
  }, []);

  // Live expiration guard: revoke session automatically if it expires while the app is open
  useEffect(() => {
    if (!isAuthenticated || !authSession) return;
    const enforceExpiry = () => {
      if (isAuthSessionExpired(authSession)) {
        void revokePersistedAuthSession();
        setIsLocked(Boolean(profile.isPinEnabled));
        setAuthNotice({
          type: 'expired',
          message: 'Your session has expired. Please log in again to continue.',
        });
      }
    };
    enforceExpiry();
    const intervalId = setInterval(enforceExpiry, 30_000);
    const handleVisibility = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        enforceExpiry();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', enforceExpiry);
      document.addEventListener('visibilitychange', handleVisibility);
    }
    return () => {
      clearInterval(intervalId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', enforceExpiry);
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [isAuthenticated, authSession, profile.isPinEnabled, revokePersistedAuthSession]);

  // Listen for browser online/offline network transitions (UI indicator + deferred cloud backup retry)
  useEffect(() => {
    const handleOnline = () => {
      setStorageStatus((prev) => ({ ...prev, isOnline: true }));
    };
    const handleOffline = () => {
      setStorageStatus((prev) => ({ ...prev, isOnline: false }));
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, []);

  // Atomic IndexedDB Primary Persistence (IndexedDB is sole source of truth — never writes on failed DB init)
  useEffect(() => {
    if (!isDbHydrated || !isDbWritableRef.current || dbInitError) return;
    let cancelled = false;
    const db = dbRef.current;
    if (!db) {
      setStorageStatus((prev) => ({
        ...prev,
        storageError: 'IndexedDB database handle unavailable. Please reload or export a backup.',
      }));
      return;
    }

    (async () => {
      try {
        await db.commitBusinessDatasetAtomic(currentDatasetSnapshot);

        // Auto-backup after important transaction additions (cooldown 3 minutes)
        const currentTxTotal =
          currentDatasetSnapshot.sales.length +
          currentDatasetSnapshot.customerTransactions.length +
          currentDatasetSnapshot.supplierTransactions.length +
          currentDatasetSnapshot.expenses.length;

        const nowMs = Date.now();
        if (
          autoBackupSettings.enabled &&
          autoBackupSettings.backupAfterImportantBatch &&
          lastTxTotalRef.current >= 0 &&
          currentTxTotal > lastTxTotalRef.current &&
          nowMs - lastBatchBackupTsRef.current > 3 * 60 * 1000
        ) {
          lastBatchBackupTsRef.current = nowMs;
          await createLocalBackupSnapshot(
            db,
            currentDatasetSnapshot,
            'AUTO_BATCH',
            'Auto-snapshot after business transaction batch',
            autoBackupSettings
          );
        }
        lastTxTotalRef.current = currentTxTotal;

        if (!cancelled) {
          setStorageStatus((prev) => (prev.storageError ? { ...prev, storageError: null } : prev));
          await refreshStorageTelemetry();
        }
      } catch (err) {
        if (!cancelled) {
          const msg = formatStorageError(err, 'save changes to IndexedDB').message;
          setStorageStatus((prev) => ({ ...prev, storageError: msg }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDbHydrated, currentDatasetSnapshot, autoBackupSettings, refreshStorageTelemetry]);

  // Active-session periodic auto-backup timer (runs while app is open)
  useEffect(() => {
    if (!isDbHydrated || !autoBackupSettings.enabled) return;
    const intervalMs = Math.max(5, autoBackupSettings.intervalMinutes || 30) * 60 * 1000;
    const timer = setInterval(async () => {
      const db = dbRef.current;
      if (!db) return;
      try {
        await createLocalBackupSnapshot(
          db,
          latestDatasetRef.current,
          'AUTO_INTERVAL',
          `Scheduled active-session backup (every ${autoBackupSettings.intervalMinutes} min)`,
          autoBackupSettings
        );
        await refreshStorageTelemetry();
      } catch (err) {
        console.warn('Scheduled auto-backup failed:', err);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isDbHydrated, autoBackupSettings, refreshStorageTelemetry]);

  // Append Audit Log Helper
  const logAudit = (action: string, details: string, entityType: AuditLog['entityType'], entityId?: string) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      action,
      details,
      entityType,
      entityId,
      user: profile.ownerName || 'Store Manager',
    };
    setAuditLogs((prev) => [newLog, ...prev.slice(0, 199)]);
  };

  // Date Filter Evaluator using canonical local calendar YYYY-MM-DD comparisons
  const isDateInRange = useCallback(
    (dateStr: string) =>
      matchesLedgerDateFilter(
        dateStr,
        dateFilter,
        customDateRange.startDate,
        customDateRange.endDate
      ),
    [dateFilter, customDateRange]
  );

  // Filtered lists based on active date range
  const filteredSales = useMemo(() => sales.filter((s) => isDateInRange(s.date)), [sales, dateFilter, customDateRange]);
  const filteredExpenses = useMemo(() => expenses.filter((e) => isDateInRange(e.date)), [expenses, dateFilter, customDateRange]);
  const filteredCashbookEntries = useMemo(() => cashbookEntries.filter((cb) => isDateInRange(cb.date)), [cashbookEntries, dateFilter, customDateRange]);

  // Recalculate customer category and overdue days
  useEffect(() => {
    const todayStr = new Date().toISOString();
    setCustomers((prev) =>
      prev.map((c) => {
        const days = calculateOverdueDays(c.lastTransactionDate, todayStr);
        let category = c.category;
        if (c.currentBalance <= 0) {
          category = 'CLEARED';
        } else if (c.currentBalance >= 5000) {
          category = 'HIGH_CREDIT';
        } else if (days >= 30) {
          category = 'OVERDUE';
        } else {
          category = 'REGULAR';
        }
        return {
          ...c,
          overdueDays: days,
          category,
        };
      })
    );
  }, [customerTransactions.length]);

  // Compute Alerts Automatically
  useEffect(() => {
    const newAlerts: AlertNotification[] = [];

    // 1. Due Payment Alerts for Pending Ledger Entries > 7 Days
    const dueOver7Days = getCustomersWithDuePaymentsOlderThanDays(
      customers,
      customerTransactions,
      7
    );
    dueOver7Days.forEach((item) => {
      let severity: AlertNotification['severity'] = 'MEDIUM';
      if (item.daysPending >= 30 || item.amountDue >= 5000) severity = 'HIGH';
      newAlerts.push({
        id: `alert-cust-${item.customer.id}`,
        type: 'OVERDUE_CREDIT',
        title: `Due Payment (>7 Days): ${item.customer.name}`,
        message: `Pending udhar of ₹${item.amountDue.toLocaleString('en-IN')} has entries pending for ${item.daysPending} days. Check Khata ledger.`,
        severity,
        date: new Date().toISOString(),
        read: false,
        customerId: item.customer.id,
      });
    });

    // 2. Low Stock Alerts (active products only)
    products.forEach((prod) => {
      if (prod.isArchived) return;
      if (prod.stockQty <= prod.minStockAlert) {
        newAlerts.push({
          id: `alert-stock-${prod.id}`,
          type: 'LOW_STOCK',
          title: `Low Stock: ${prod.name}`,
          message: `Only ${prod.stockQty} ${prod.unit} left (Alert threshold is ${prod.minStockAlert}). Reorder soon!`,
          severity: prod.stockQty <= 2 ? 'HIGH' : 'MEDIUM',
          date: new Date().toISOString(),
          read: false,
        });
      }
    });

    // 2b. Approaching Reorder Level Alerts
    const approachingItems = getApproachingReorderProducts(products);
    approachingItems.forEach(({ product, bufferRemaining }) => {
      newAlerts.push({
        id: `alert-approaching-${product.id}`,
        type: 'APPROACHING_REORDER',
        title: `Approaching Reorder: ${product.name}`,
        message: `${product.stockQty} ${product.unit} left — only ${bufferRemaining} ${product.unit} above reorder limit (${product.minStockAlert} ${product.unit}).`,
        severity: 'INFO',
        date: new Date().toISOString(),
        read: false,
      });
    });

    // 3. Unpaid Supplier Bills
    suppliers.forEach((sup) => {
      if (sup.currentBalance >= 15000) {
        newAlerts.push({
          id: `alert-sup-${sup.id}`,
          type: 'SUPPLIER_DUE',
          title: `Supplier Payable: ${sup.name}`,
          message: `Outstanding payment of ₹${sup.currentBalance.toLocaleString('en-IN')} is awaiting settlement.`,
          severity: 'MEDIUM',
          date: new Date().toISOString(),
          read: false,
        });
      }
    });

    // 4. Cash In Hand check
    const cashSummary = calculateCashbookSummary(0, cashbookEntries);
    if (cashSummary.closingCash < 1000) {
      newAlerts.push({
        id: 'alert-cash-low',
        type: 'NEGATIVE_CASH',
        title: 'Low Cash In Counter',
        message: `Counter cash balance is low (₹${cashSummary.closingCash.toLocaleString('en-IN')}). Ensure enough change for daily customers.`,
        severity: cashSummary.closingCash < 0 ? 'HIGH' : 'MEDIUM',
        date: new Date().toISOString(),
        read: false,
      });
    }

    setAlerts(newAlerts);
  }, [customers, customerTransactions, products, suppliers, cashbookEntries]);

  // Overall Financial KPIs (Phase 6: Local calendar, cancelled exclusion, returns, dynamic growth)
  const financials = useMemo(() => {
    const today = getLocalTodayKey();
    const thisMonthPrefix = today.substring(0, 7); // e.g. "2026-11"
    const isOpeningDesc = (desc?: string) =>
      Boolean(desc && desc.toLowerCase().includes('opening balance'));

    const activeSales = sales.filter(isSaleActive);

    // Today's Sales (net of same-day active sales returns)
    const todayGrossSales = activeSales
      .filter((s) => toLocalDayKey(s.date || s.createdAt) === today)
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const todayReturns = customerTransactions
      .filter(
        (tx) =>
          tx.status !== 'CANCELLED' &&
          tx.status !== 'REVERSED' &&
          tx.type === 'RETURN' &&
          toLocalDayKey(tx.date || tx.createdAt) === today
      )
      .reduce((sum, tx) => sum + Math.max(0, Number(tx.amount) || 0), 0);
    const todaySales = Math.round((todayGrossSales - todayReturns) * 100) / 100;

    // Today's & Monthly Net Purchases (exclude OPENING entries, cancelled entries, subtract RETURNS)
    const calcNetPurchasesForMatch = (predicate: (dayKey: string) => boolean) => {
      let purchasesSum = 0;
      let returnsSum = 0;
      for (const st of supplierTransactions) {
        if (st.status === 'CANCELLED' || st.status === 'REVERSED') continue;
        const dayKey = toLocalDayKey(st.date || st.createdAt);
        if (!predicate(dayKey)) continue;
        if (st.type === 'PURCHASE' && !isOpeningDesc(st.description)) {
          purchasesSum += Number(st.amount) || 0;
        } else if (st.type === 'RETURN') {
          returnsSum += Math.max(0, Number(st.amount) || 0);
        }
      }
      return Math.round((purchasesSum - returnsSum) * 100) / 100;
    };

    const todayPurchases = calcNetPurchasesForMatch((dk) => dk === today);
    const monthlyPurchases = calcNetPurchasesForMatch((dk) => dk.startsWith(thisMonthPrefix));

    // Today's & Monthly Expenses (Operating only, strictly exclude personal drawings)
    const todayExpenses = expenses
      .filter(
        (e) =>
          !e.isPersonalWithdrawal &&
          e.category !== 'PERSONAL_DRAWING' &&
          toLocalDayKey(e.date || e.createdAt) === today
      )
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const monthlyExpenses = expenses
      .filter(
        (e) =>
          !e.isPersonalWithdrawal &&
          e.category !== 'PERSONAL_DRAWING' &&
          toLocalDayKey(e.date || e.createdAt).startsWith(thisMonthPrefix)
      )
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // Profit & Loss calculation for this month (excluding cancelled sales & deducting returns)
    const productsMap = new Map<string, Product>();
    products.forEach((p) => productsMap.set(p.id, p));
    const thisMonthSales = sales.filter((s) =>
      toLocalDayKey(s.date || s.createdAt).startsWith(thisMonthPrefix)
    );
    const thisMonthExpenses = expenses.filter((e) =>
      toLocalDayKey(e.date || e.createdAt).startsWith(thisMonthPrefix)
    );
    const thisMonthCustomerTxs = customerTransactions.filter((t) =>
      toLocalDayKey(t.date || t.createdAt).startsWith(thisMonthPrefix)
    );
    const pnl = calculateProfitAndLoss(
      thisMonthSales,
      thisMonthExpenses,
      productsMap,
      thisMonthCustomerTxs
    );

    // Customer & Supplier Outstandings
    const totalCustomerOutstanding = customers.reduce(
      (sum, c) => sum + Math.max(0, Number(c.currentBalance) || 0),
      0
    );

    const totalSupplierOutstanding = suppliers.reduce(
      (sum, s) => sum + Math.max(0, Number(s.currentBalance) || 0),
      0
    );

    // Cashbook (active entries only)
    const cashSummary = calculateCashbookSummary(0, cashbookEntries);
    const availableCash = cashSummary.closingCash;

    // Inventory Valuation
    const inv = calculateInventoryValuation(products);

    // True dynamic month-over-month sales growth
    const growth = calculateMonthlySalesGrowth(sales);

    return {
      todaySales,
      monthlySales: pnl.totalRevenue,
      grossMonthlySales: pnl.grossRevenue,
      monthlySalesReturns: pnl.salesReturns,
      todayPurchases,
      monthlyPurchases,
      todayExpenses,
      monthlyExpenses,
      estimatedGrossProfit: Math.round(pnl.grossProfit),
      estimatedNetProfit: Math.round(pnl.netOperatingProfit),
      hasCompleteCogs: pnl.hasCompleteCogs,
      costCoveragePct: pnl.costCoveragePct,
      uncostedRevenue: pnl.uncostedRevenue,
      costedRevenue: pnl.costedRevenue,
      reviewStatus: pnl.reviewStatus,
      profitStatus: pnl.profitStatus,
      isProfitVerified: pnl.isProfitVerified,
      knownCostGrossProfit: pnl.knownCostGrossProfit !== null ? Math.round(pnl.knownCostGrossProfit) : null,
      knownCostGrossMarginPct: pnl.knownCostGrossMarginPct,
      verifiedGrossProfit: pnl.verifiedGrossProfit !== null ? Math.round(pnl.verifiedGrossProfit) : null,
      verifiedNetProfit: pnl.verifiedNetOperatingProfit !== null ? Math.round(pnl.verifiedNetOperatingProfit) : null,
      bankRevenue: pnl.bankRevenue,
      totalCustomerOutstanding,
      totalSupplierOutstanding,
      availableCash,
      totalInventoryValue: inv.totalCostValue,
      salesGrowthPct: growth.growthPct,
      hasPriorGrowthBaseline: growth.hasPriorBaseline,
    };
  }, [sales, expenses, supplierTransactions, customerTransactions, customers, suppliers, cashbookEntries, products]);

  const accountingReconciliation = useMemo(
    () => generateAccountingReconciliationReport(currentDatasetSnapshot),
    [currentDatasetSnapshot]
  );

  // Profile & PBKDF2 PIN actions
  const updateProfile = (patch: Partial<StoreProfile>) => {
    const prevPhone = profile.phone;
    const cleanPatch = sanitizeProfileForStorage({ ...profile, ...patch });
    setProfile(cleanPatch);
    if (
      isAuthenticated &&
      authSession &&
      typeof patch.phone === 'string' &&
      cleanPatch.phone !== prevPhone
    ) {
      void persistNewAuthSession({
        authMode: authSession.authMode,
        mobile: cleanPatch.phone,
      }).catch(() => undefined);
    }
    logAudit('UPDATE_PROFILE', 'Updated store business profile & settings', 'SETTINGS');
  };

  const completeStoreLogin = async (params: {
    authMode: StoreAuthMode;
    mobile?: string;
    portalEntityId?: string;
    portalEntityName?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (params.authMode === 'GUEST' && profile.isPinEnabled) {
      return {
        success: false,
        error: 'Store Counter Lock is active. Please enter your 4-digit PIN to login.',
      };
    }
    try {
      await persistNewAuthSession({
        authMode: params.authMode,
        mobile: params.mobile ?? profile.phone,
        portalEntityId: params.portalEntityId,
        portalEntityName: params.portalEntityName,
      });
      logAudit(
        'STORE_LOGIN',
        params.authMode === 'PIN'
          ? 'Authenticated store session with PBKDF2-verified PIN'
          : params.authMode === 'CUSTOMER'
          ? `Started Customer Portal session (${params.portalEntityName || 'Customer'})`
          : params.authMode === 'SUPPLIER'
          ? `Started Supplier Portal session (${params.portalEntityName || 'Supplier'})`
          : 'Started local store session (Guest mode)',
        'SETTINGS'
      );
      return { success: true };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not establish a persistent login session. Please try again.';
      return { success: false, error: msg };
    }
  };

  const createOwnerAccount = async (params: {
    storeName: string;
    ownerName: string;
    mobile: string;
    pin: string;
    confirmPin: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (hasPinConfigured && profile.phone && profile.phone.replace(/\D/g, '').length >= 10) {
      return {
        success: false,
        error:
          'A store owner account is already registered on this device. Please use Login or Forgot your password to sign in.',
      };
    }

    const validation = validateCreateAccountInput(params);
    if (
      !validation.valid ||
      !validation.storeName ||
      !validation.ownerName ||
      !validation.normalizedMobile ||
      !validation.normalizedPin
    ) {
      return {
        success: false,
        error: validation.error || 'Please check all account registration fields.',
      };
    }

    try {
      const hashed = await hashPinWithSalt(validation.normalizedPin);
      pinSecurityRef.current = hashed;
      setHasPinConfigured(true);
      setNeedsPinSetup(false);
      clearPinAttemptState();

      const nextProfile = sanitizeProfileForStorage({
        ...profile,
        storeName: validation.storeName,
        ownerName: validation.ownerName,
        phone: validation.normalizedMobile,
        isPinEnabled: true,
      });
      setProfile(nextProfile);
      setNeedsFirstTimeSetup(false);

      if (dbRef.current) {
        await dbRef.current.setMeta('pinSecurity', hashed);
        await dbRef.current.setMeta('firstTimeSetupCompleted', true);
      }

      await persistNewAuthSession({
        authMode: 'PIN',
        mobile: validation.normalizedMobile,
        pinRecordOverride: hashed,
      });
      logAudit(
        'ACCOUNT_CREATED',
        `Registered store owner account for ${validation.storeName} (${validation.ownerName})`,
        'SETTINGS'
      );
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Could not create your store account. Please try again.',
      };
    }
  };

  const registerStoreOwnerWithFirebase = async (
    params: StoreRegistrationInput
  ): Promise<{
    success: boolean;
    error?: string;
    firestoreInitialized?: boolean;
    verificationEmailSent?: boolean;
    cloudUserEmail?: string | null;
    providerDisabled?: boolean;
    notice?: string;
  }> => {
    const validation = validateStoreRegistrationInput(params);
    if (!validation.valid || !validation.data) {
      return {
        success: false,
        error: validation.error || 'Please check all registration details.',
      };
    }

    const v = validation.data;
    try {
      let firebaseUser: CloudAuthUser | null = null;
      let verificationEmailSent = false;

      if (v.authMethod === 'GOOGLE') {
        const res = await signInWithGoogleForCloudBackup();
        if (res.redirectStarted) {
          return {
            success: false,
            error:
              'Google sign-in opened in redirect mode. Complete Google sign-in and finish store setup.',
          };
        }
        firebaseUser = res.user;
      } else {
        if (!v.email || !v.password) {
          return {
            success: false,
            error: 'Email address and password are required for email sign-up.',
          };
        }
        const reg = await registerFirebaseEmailOwnerAccount({
          email: v.email,
          password: v.password,
          displayName: v.ownerName,
        });
        firebaseUser = reg.user;
        verificationEmailSent = reg.verificationEmailSent;
      }

      if (!firebaseUser) {
        return {
          success: false,
          error: 'Could not authenticate with Firebase. Please try again.',
        };
      }

      const hashed = await hashPinWithSalt(v.normalizedPin);
      pinSecurityRef.current = hashed;
      setHasPinConfigured(true);
      setNeedsPinSetup(false);
      clearPinAttemptState();

      const nextProfile = sanitizeProfileForStorage({
        ...profile,
        storeName: v.storeName,
        ownerName: v.ownerName,
        phone: v.normalizedMobile,
        address: v.address || profile.address,
        upiId: v.upiId || profile.upiId,
        gstin: v.gstin || profile.gstin,
        isPinEnabled: true,
      });

      const nextCloudConfig: CloudBackupConfig = {
        ...cloudBackupConfig,
        boundOwnerUid: firebaseUser.uid,
        boundOwnerEmail: firebaseUser.email || v.email || cloudBackupConfig.boundOwnerEmail || null,
      };

      let firestoreInitialized = false;
      if (firebaseUser.emailVerified) {
        await ensureStoreWorkspaceDoc(firebaseUser.uid, nextProfile, lastClosedDate);
        firestoreInitialized = true;
      }

      setCloudAuthUser(firebaseUser);
      setCloudBackupConfig(nextCloudConfig);
      setProfile(nextProfile);
      setNeedsFirstTimeSetup(false);
      setStorageStatus((prev) => ({
        ...prev,
        storageMode: 'CLOUD_SYNC_ENABLED',
        cloudSyncConfigured: Boolean(firebaseUser?.emailVerified),
        cloudUserEmail: firebaseUser?.email ?? v.email ?? null,
      }));

      if (dbRef.current) {
        await dbRef.current.setMeta('pinSecurity', hashed);
        await dbRef.current.setMeta('firstTimeSetupCompleted', true);
        await dbRef.current.setMeta('cloudBackupConfig', nextCloudConfig);
      }

      await persistNewAuthSession({
        authMode: 'PIN',
        mobile: v.normalizedMobile,
        pinRecordOverride: hashed,
      });

      logAudit(
        'ACCOUNT_REGISTERED_FIREBASE',
        `Registered store "${v.storeName}" (${v.ownerName}) with Firebase Auth${
          firestoreInitialized ? ' and initialized Firestore store document' : ' (pending email verification for Firestore sync)'
        }`,
        'SETTINGS'
      );

      return {
        success: true,
        firestoreInitialized,
        verificationEmailSent,
        cloudUserEmail: firebaseUser.email ?? v.email ?? null,
        notice: firestoreInitialized
          ? 'Store account created and Firestore workspace initialized.'
          : 'Firebase account created and verification email sent. Verify your email to activate Firestore cloud sync.',
      };
    } catch (err) {
      const mapped = mapFirebaseAuthErrorToMessage(err);
      return {
        success: false,
        error: mapped.message,
        providerDisabled: mapped.providerDisabled,
      };
    }
  };

  const requestPasswordResetEmail = async (
    identifier: string
  ): Promise<{
    success: boolean;
    maskedEmail?: string;
    message?: string;
    error?: string;
    needsEmailInput?: boolean;
    providerDisabled?: boolean;
  }> => {
    const resolved = resolvePasswordResetIdentifier({
      input: identifier,
      registeredProfilePhone: profile.phone,
      boundOwnerEmail: cloudBackupConfig.boundOwnerEmail,
      signedInEmail: cloudAuthUser?.email,
    });

    if (!resolved.valid || !resolved.email) {
      return {
        success: false,
        error: resolved.error,
        needsEmailInput: resolved.needsEmailInput,
      };
    }

    try {
      await sendFirebasePasswordResetEmail(resolved.email);
      const maskedEmail = maskEmailForNotice(resolved.email);
      return {
        success: true,
        maskedEmail,
        message: resolved.resolvedFromMobile
          ? `A password reset link has been sent to the email linked to your mobile number (${maskedEmail}). Please check your inbox and spam folder.`
          : `If an account is registered for ${maskedEmail}, a password reset link has been sent. Please check your inbox and spam folder.`,
      };
    } catch (err) {
      const mapped = mapFirebaseAuthErrorToMessage(err);
      return {
        success: false,
        error: mapped.message,
        providerDisabled: mapped.providerDisabled,
      };
    }
  };

  const recoverOwnerWithStoreDetails = async (params: {
    mobile: string;
    ownerName: string;
    storeName: string;
    newPin: string;
    confirmNewPin: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const check = verifyOfflineOwnerRecovery({
      profile,
      enteredMobile: params.mobile,
      enteredOwnerName: params.ownerName,
      enteredStoreName: params.storeName,
      newPin: params.newPin,
      confirmNewPin: params.confirmNewPin,
    });
    if (!check.valid || !check.normalizedMobile || !check.normalizedNewPin) {
      return {
        success: false,
        error: check.error || 'Could not verify registered store details.',
      };
    }

    try {
      const hashed = await hashPinWithSalt(check.normalizedNewPin);
      pinSecurityRef.current = hashed;
      setHasPinConfigured(true);
      setNeedsPinSetup(false);
      setIsLocked(false);
      clearPinAttemptState();

      if (dbRef.current) {
        await dbRef.current.setMeta('pinSecurity', hashed);
      }

      const verifiedMobile = check.normalizedMobile;
      if (!profile.phone || profile.phone.replace(/\D/g, '').length < 10) {
        setProfile((prev) =>
          sanitizeProfileForStorage({ ...prev, phone: verifiedMobile || prev.phone })
        );
      }

      await persistNewAuthSession({
        authMode: 'PIN',
        mobile: check.normalizedMobile,
        pinRecordOverride: hashed,
      });
      logAudit(
        'OWNER_PIN_RECOVERED',
        'Reset store security PIN via verified store owner details',
        'SETTINGS'
      );
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'PIN recovery failed. Please try again.',
      };
    }
  };

  const recoverOwnerWithGoogle = async (params: {
    newPin: string;
    confirmNewPin: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const trimmed = params.newPin.trim();
    if (!/^\d{4}$/.test(trimmed)) {
      return { success: false, error: 'Please choose a new 4-digit numeric PIN.' };
    }
    if (trimmed !== params.confirmNewPin.trim()) {
      return { success: false, error: 'New PIN and Confirm PIN do not match.' };
    }

    try {
      const { user, redirectStarted } = await signInWithGoogleForCloudBackup();
      if (redirectStarted) {
        return {
          success: false,
          error: 'Google sign-in opened in redirect mode. Complete Google verification and retry.',
        };
      }
      if (!user || !user.emailVerified) {
        return {
          success: false,
          error: 'A verified Google account is required to reset your store PIN.',
        };
      }
      if (cloudBackupConfig.boundOwnerUid && cloudBackupConfig.boundOwnerUid !== user.uid) {
        return {
          success: false,
          error: `Please sign in with the linked store Google account (${cloudBackupConfig.boundOwnerEmail || 'linked owner email'}).`,
        };
      }

      setCloudAuthUser(user);
      const hashed = await hashPinWithSalt(trimmed);
      pinSecurityRef.current = hashed;
      setHasPinConfigured(true);
      setNeedsPinSetup(false);
      setIsLocked(false);
      clearPinAttemptState();

      if (dbRef.current) {
        await dbRef.current.setMeta('pinSecurity', hashed);
      }

      await persistNewAuthSession({
        authMode: 'PIN',
        mobile: profile.phone,
        pinRecordOverride: hashed,
      });
      logAudit(
        'OWNER_PIN_RECOVERED_GOOGLE',
        `Reset store security PIN via verified Google account (${user.email || user.uid})`,
        'SETTINGS'
      );
      return { success: true };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google account verification failed. Please try again.';
      return { success: false, error: msg };
    }
  };

  const loginAsCustomer = async (params: {
    name: string;
    phone: string;
  }): Promise<{ success: boolean; error?: string; customerId?: string }> => {
    const check = lookupCustomerAccount({
      customers,
      name: params.name,
      phone: params.phone,
    });
    if (!check.matched || !check.customer) {
      return {
        success: false,
        error:
          check.error ||
          'No customer account matched this name and phone number in our database.',
      };
    }

    const res = await completeStoreLogin({
      authMode: 'CUSTOMER',
      mobile: check.normalizedPhone || check.customer.phone,
      portalEntityId: check.customer.id,
      portalEntityName: check.customer.name,
    });
    if (!res.success) return res;
    return { success: true, customerId: check.customer.id };
  };

  const loginAsSupplier = async (params: {
    name: string;
    phone: string;
  }): Promise<{ success: boolean; error?: string; supplierId?: string }> => {
    const check = lookupSupplierAccount({
      suppliers,
      name: params.name,
      phone: params.phone,
    });
    if (!check.matched || !check.supplier) {
      return {
        success: false,
        error:
          check.error ||
          'No supplier account matched this name and phone number in our database.',
      };
    }

    const res = await completeStoreLogin({
      authMode: 'SUPPLIER',
      mobile: check.normalizedPhone || check.supplier.phone,
      portalEntityId: check.supplier.id,
      portalEntityName: check.supplier.name,
    });
    if (!res.success) return res;
    return { success: true, supplierId: check.supplier.id };
  };

  const logout = async (): Promise<void> => {
    await revokePersistedAuthSession();
    setIsLocked(Boolean(profile.isPinEnabled));
    setAuthNotice({
      type: 'logged_out',
      message: 'You have been logged out safely.',
    });
    logAudit('STORE_LOGOUT', 'Explicitly logged out and revoked persisted store session', 'SETTINGS');
  };

  const verifyPin = async (pin: string): Promise<boolean> => {
    if (getPinCooldownRemainingSeconds() > 0) return false;
    if (pinSecurityRef.current && pinSecurityRef.current.hashBase64) {
      return verifyPinHash(pin, pinSecurityRef.current);
    }
    if (!profile.isPinEnabled) return true;
    return false;
  };

  const unlockWithPin = async (pin: string): Promise<boolean> => {
    if (getPinCooldownRemainingSeconds() > 0) {
      return false;
    }
    const ok = await verifyPin(pin);
    if (ok) {
      clearPinAttemptState();
      setIsLocked(false);
      setNeedsPinSetup(false);
      if (pinSecurityRef.current?.hashBase64) {
        try {
          await persistNewAuthSession({
            authMode: 'PIN',
            mobile: profile.phone,
            pinRecordOverride: pinSecurityRef.current,
          });
        } catch {
          // Keep unlocked state even if Web Crypto session persistence is unavailable
        }
      }
    } else {
      recordFailedPinAttempt();
    }
    return ok;
  };

  const completePinSetupRecovery = async (
    newPin: string
  ): Promise<{ success: boolean; error?: string }> => {
    const trimmed = newPin.trim();
    if (!/^\d{4}$/.test(trimmed)) {
      return { success: false, error: 'Security PIN must be exactly 4 numeric digits.' };
    }
    const hashed = await hashPinWithSalt(trimmed);
    pinSecurityRef.current = hashed;
    setHasPinConfigured(true);
    if (dbRef.current) {
      await dbRef.current.setMeta('pinSecurity', hashed);
    }
    clearPinAttemptState();
    setNeedsPinSetup(false);
    setIsLocked(false);
    try {
      await persistNewAuthSession({
        authMode: 'PIN',
        mobile: profile.phone,
        pinRecordOverride: hashed,
      });
    } catch {
      // ignore if session write fails
    }
    logAudit('PIN_RECOVERY_SETUP', 'Configured new 4-digit store security PIN after restore/recovery', 'SETTINGS');
    return { success: true };
  };

  const updatePinSecurity = async (
    newPin?: string,
    isPinEnabled?: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    const db = dbRef.current;
    const trimmed = newPin?.trim();
    let updatedHash: PinSecurityRecord | null = null;
    if (trimmed && trimmed.length > 0) {
      if (!/^\d{4}$/.test(trimmed)) {
        return { success: false, error: 'Security PIN must be exactly 4 numeric digits.' };
      }
      const hashed = await hashPinWithSalt(trimmed);
      updatedHash = hashed;
      pinSecurityRef.current = hashed;
      setHasPinConfigured(true);
      setNeedsPinSetup(false);
      if (db) {
        await db.setMeta('pinSecurity', hashed);
      }
      clearPinAttemptState();
      logAudit('UPDATE_PIN', 'Updated store security PIN (PBKDF2 salted hash)', 'SETTINGS');
    } else if (isPinEnabled === true && !pinSecurityRef.current?.hashBase64) {
      return {
        success: false,
        error: 'Please enter a 4-digit security PIN before enabling Counter Screen Lock.',
      };
    }

    if (typeof isPinEnabled === 'boolean') {
      setProfile((prev) => sanitizeProfileForStorage({ ...prev, isPinEnabled }));
      if (!isPinEnabled) {
        setNeedsPinSetup(false);
        setIsLocked(false);
      }
    }

    // Re-bind active authenticated session to the new PIN hash so refresh stays signed in
    if (updatedHash && isAuthenticated) {
      try {
        await persistNewAuthSession({
          authMode: 'PIN',
          mobile: profile.phone,
          pinRecordOverride: updatedHash,
        });
      } catch {
        // ignore if session re-bind fails
      }
    } else if (isPinEnabled === true && authSession?.authMode === 'GUEST') {
      // Guest session cannot persist once Counter Lock is turned on without verifying PIN
      await revokePersistedAuthSession();
      setIsLocked(true);
    }

    return { success: true };
  };

  const lockApp = () => {
    if (profile.isPinEnabled) {
      void revokePersistedAuthSession();
      setNeedsPinSetup(!pinSecurityRef.current?.hashBase64);
      setIsLocked(true);
    }
  };

  // Customer actions
  const addCustomer = (data: Omit<Customer, 'id' | 'currentBalance' | 'totalCreditGiven' | 'totalPaymentReceived' | 'overdueDays' | 'category' | 'createdAt'>): string => {
    const id = `cust-${Date.now()}`;
    const openBal = Number(data.openingBalance) || 0;
    const nowIso = toLocalDateTimeIso();
    const newCustomer: Customer = {
      ...data,
      id,
      openingBalance: openBal,
      currentBalance: openBal,
      totalCreditGiven: 0,
      totalPaymentReceived: 0,
      overdueDays: 0,
      category: openBal > 5000 ? 'HIGH_CREDIT' : 'REGULAR',
      createdAt: nowIso,
      lastTransactionDate: nowIso,
    };

    setCustomers((prev) => [newCustomer, ...prev]);

    if (openBal > 0) {
      const initTx: CustomerTransaction = {
        id: `ctx-${Date.now()}`,
        customerId: id,
        type: 'OPENING',
        amount: openBal,
        date: nowIso,
        description: 'Opening Balance (Khata Start)',
        status: 'COMPLETED',
        createdAt: nowIso,
      };
      setCustomerTransactions((prev) => [initTx, ...prev]);
    }

    logAudit('ADD_CUSTOMER', `Added new customer ${data.name} (Opening: ₹${openBal})`, 'CUSTOMER', id);
    return id;
  };

  const updateCustomer = (id: string, patch: Partial<Customer>) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
    logAudit('UPDATE_CUSTOMER', `Updated details for customer ${patch.name || id}`, 'CUSTOMER', id);
  };

  const deleteCustomer = (id: string, reason: string) => {
    const cust = customers.find((c) => c.id === id);
    if (!cust) return;
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    logAudit('DELETE_CUSTOMER', `Deleted customer ${cust.name}. Reason: ${reason}. Unsettled balance was ₹${cust.currentBalance}`, 'CUSTOMER', id);
  };

  const applyAtomicDatasetUpdate = (
    nextDataset: StoreBusinessDataset,
    auditEvent?: AtomicAuditDescriptor
  ) => {
    latestDatasetRef.current = {
      ...nextDataset,
      auditLogs: latestDatasetRef.current.auditLogs,
    };
    setProducts(nextDataset.products);
    setStockAdjustments(nextDataset.stockAdjustments);
    setCustomers(nextDataset.customers);
    setCustomerTransactions(nextDataset.customerTransactions);
    setSuppliers(nextDataset.suppliers);
    setSupplierTransactions(nextDataset.supplierTransactions);
    setSales(nextDataset.sales);
    setCashbookEntries(nextDataset.cashbookEntries);
    if (auditEvent) {
      logAudit(
        auditEvent.action,
        auditEvent.details,
        auditEvent.entityType,
        auditEvent.entityId
      );
    }
  };

  const addCustomerTransaction = (tx: {
    customerId: string;
    type: CustomerTransactionType;
    amount: number;
    description: string;
    date?: string;
    paymentMethod?: 'CASH' | 'UPI' | 'BANK';
    invoiceNo?: string;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
    productId?: string;
    quantity?: number;
    unit?: string;
    saleLineId?: string;
    items?: ReturnStockItemInput[];
  }): { success: boolean; transactionId?: string; error?: string; duplicate?: boolean } => {
    const res = prepareAtomicCustomerTransaction(latestDatasetRef.current, tx);
    if (!res.success || !res.nextDataset) {
      return {
        success: false,
        duplicate: res.duplicate,
        transactionId: res.extra?.transactionId,
        error: res.error,
      };
    }
    applyAtomicDatasetUpdate(res.nextDataset, res.auditEvent);
    return { success: true, transactionId: res.extra?.transactionId };
  };

  const cancelCustomerTransaction = (txId: string, reason: string): boolean => {
    const liveTxs = latestDatasetRef.current.customerTransactions;
    const liveCusts = latestDatasetRef.current.customers;
    const targetTx = liveTxs.find((t) => t.id === txId);
    if (!targetTx || targetTx.status === 'CANCELLED' || targetTx.status === 'REVERSED') {
      return false;
    }
    const cust = liveCusts.find((c) => c.id === targetTx.customerId);
    if (!cust) return false;

    const cancelDate = new Date().toISOString();
    const updatedTxList = liveTxs.map((t) =>
      t.id === txId
        ? {
            ...t,
            status: 'CANCELLED' as const,
            cancelReason: reason,
            cancelledAt: cancelDate,
          }
        : t
    );

    const summary = calculateCustomerLedgerWithRunningBalance(cust, updatedTxList);
    const nextCustomers = liveCusts.map((c) =>
      c.id === cust.id
        ? {
            ...c,
            currentBalance: summary.closingBalance,
            totalCreditGiven: summary.totalCreditGiven,
            totalPaymentReceived: summary.totalPaymentReceived,
            lastTransactionDate: summary.lastTransactionDate || c.createdAt,
          }
        : c
    );

    // Reverse any linked active Cashbook entry created by this customer payment/return
    const nextCashbook = latestDatasetRef.current.cashbookEntries.map((cb) =>
      cb.refId === txId &&
      (cb.refType === 'CUSTOMER_PAYMENT' || cb.refType === 'SALES_RETURN') &&
      isCashbookEntryActive(cb)
        ? {
            ...cb,
            status: 'CANCELLED' as const,
            cancelReason: `Customer tx cancelled: ${reason}`,
            cancelledAt: cancelDate,
          }
        : cb
    );

    latestDatasetRef.current = {
      ...latestDatasetRef.current,
      customers: nextCustomers,
      customerTransactions: updatedTxList,
      cashbookEntries: nextCashbook,
    };

    setCustomers(nextCustomers);
    setCustomerTransactions(updatedTxList);
    setCashbookEntries(nextCashbook);

    logAudit(
      'CANCEL_TRANSACTION',
      `Cancelled customer transaction ${txId} (${targetTx.type} Rs.${targetTx.amount}) for ${cust.name}. Reason: ${reason}. Updated balance: Rs.${summary.closingBalance}`,
      'CUSTOMER',
      cust.id
    );

    return true;
  };

  const recordCustomerPayment = (
    customerId: string,
    amount: number,
    description = 'Payment received',
    paymentMethod: 'CASH' | 'UPI' | 'BANK' = 'UPI',
    attachments?: BillAttachment[]
  ) => {
    addCustomerTransaction({
      customerId,
      type: 'PAYMENT',
      amount,
      description,
      paymentMethod,
      attachments,
    });
  };

  // Supplier actions
  const addSupplier = (data: Omit<Supplier, 'id' | 'currentBalance' | 'totalPurchases' | 'totalPaid' | 'createdAt'>): string => {
    const id = `sup-${Date.now()}`;
    const openBal = Number(data.openingBalance) || 0;
    const nowIso = toLocalDateTimeIso();
    const newSupplier: Supplier = {
      ...data,
      id,
      openingBalance: openBal,
      currentBalance: openBal,
      totalPurchases: 0,
      totalPaid: 0,
      createdAt: nowIso,
      lastTransactionDate: nowIso,
    };
    setSuppliers((prev) => [newSupplier, ...prev]);

    if (openBal > 0) {
      const initTx: SupplierTransaction = {
        id: `stx-${Date.now()}`,
        supplierId: id,
        type: 'OPENING',
        amount: openBal,
        date: nowIso,
        paymentStatus: 'UNPAID',
        description: 'Opening Balance (Old Bills)',
        status: 'COMPLETED',
        createdAt: nowIso,
      };
      setSupplierTransactions((prev) => [initTx, ...prev]);
    }

    logAudit('ADD_SUPPLIER', `Added supplier ${data.name} (Opening: ₹${openBal})`, 'SUPPLIER', id);
    return id;
  };

  const updateSupplier = (id: string, patch: Partial<Supplier>) => {
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    if (patch.name !== undefined || patch.phone !== undefined) {
      setProducts((prev) =>
        prev.map((p) =>
          p.preferredSupplierId === id
            ? {
                ...p,
                preferredSupplierName: patch.name !== undefined ? patch.name : p.preferredSupplierName,
                preferredSupplierPhone: patch.phone !== undefined ? patch.phone : p.preferredSupplierPhone,
              }
            : p
        )
      );
    }
    logAudit('UPDATE_SUPPLIER', `Updated supplier ${patch.name || id}`, 'SUPPLIER', id);
  };

  const deleteSupplier = (id: string, reason: string) => {
    const sup = suppliers.find((s) => s.id === id);
    if (!sup) return;
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    logAudit('DELETE_SUPPLIER', `Deleted supplier ${sup.name}. Reason: ${reason}. Outstanding was ₹${sup.currentBalance}`, 'SUPPLIER', id);
  };

  const addSupplierTransaction = (tx: {
    supplierId: string;
    type: SupplierTransactionType;
    amount: number;
    paidAmount?: number;
    date?: string;
    paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';
    paymentMethod?: 'CASH' | 'UPI' | 'BANK';
    description: string;
    invoiceNo?: string;
    itemsSummary?: string;
    productId?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
  }): { success: boolean; transactionId?: string; error?: string; duplicate?: boolean } => {
    const res = prepareAtomicSupplierTransaction(latestDatasetRef.current, tx);
    if (!res.success || !res.nextDataset) {
      return {
        success: false,
        duplicate: res.duplicate,
        transactionId: res.extra?.transactionId,
        error: res.error,
      };
    }
    applyAtomicDatasetUpdate(res.nextDataset, res.auditEvent);
    return { success: true, transactionId: res.extra?.transactionId };
  };

  const recordProductPurchase = (data: {
    supplierId: string;
    productId: string;
    quantity: number;
    unit?: string;
    unitPurchasePrice: number;
    paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
    paidAmount?: number;
    paymentMethod?: 'CASH' | 'UPI' | 'BANK';
    invoiceNo?: string;
    notes?: string;
    attachments?: BillAttachment[];
    date?: string;
    setAsPreferredSupplier?: boolean;
    idempotencyKey?: string;
  }): { success: boolean; error?: string; duplicate?: boolean; transactionId?: string } => {
    const res = prepareAtomicProductPurchase(latestDatasetRef.current, data);
    if (!res.success || !res.nextDataset) {
      return {
        success: false,
        duplicate: res.duplicate,
        transactionId: res.extra?.transactionId,
        error: res.error,
      };
    }
    applyAtomicDatasetUpdate(res.nextDataset, res.auditEvent);
    return { success: true, transactionId: res.extra?.transactionId };
  };

  const recordPurchaseReturn = (data: {
    supplierId: string;
    items: PurchaseReturnLineInput[];
    reason: PurchaseReturnReason;
    creditNoteNo?: string;
    originalInvoiceNo?: string;
    originalPurchaseId?: string;
    settlementMode?: 'ADJUST_PAYABLE' | 'CASH_REFUND' | 'BANK_REFUND';
    notes?: string;
    date?: string;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
  }): {
    success: boolean;
    error?: string;
    duplicate?: boolean;
    transactionId?: string;
    creditNoteNo?: string;
  } => {
    const res = prepareAtomicPurchaseReturn(latestDatasetRef.current, data);
    if (!res.success || !res.nextDataset) {
      return {
        success: false,
        duplicate: res.duplicate,
        transactionId: res.extra?.transactionId,
        creditNoteNo: res.extra?.creditNoteNo,
        error: res.error,
      };
    }
    applyAtomicDatasetUpdate(res.nextDataset, res.auditEvent);
    return {
      success: true,
      transactionId: res.extra?.transactionId,
      creditNoteNo: res.extra?.creditNoteNo,
    };
  };

  const cancelSupplierTransaction = (txId: string, reason: string): boolean => {
    const res = prepareAtomicCancelSupplierTransaction(latestDatasetRef.current, txId, reason);
    if (!res.success || !res.nextDataset) {
      return false;
    }
    applyAtomicDatasetUpdate(res.nextDataset, res.auditEvent);
    return true;
  };

  // Cashbook actions
  const addCashbookEntry = (data: {
    type: 'IN' | 'OUT';
    category: string;
    description: string;
    amount: number;
    refType: CashbookEntry['refType'];
    refId?: string;
    date?: string;
    attachments?: BillAttachment[];
  }) => {
    const amt = Number(data.amount) || 0;
    const nowIso = toLocalDateTimeIso(data.date);
    const dayKey = toLocalDayKey(data.date || nowIso) || getLocalTodayKey();
    const entryId = `cb-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;

    const newEntry: CashbookEntry = {
      id: entryId,
      date: dayKey,
      type: data.type,
      category: data.category,
      description: data.description,
      amount: amt,
      paymentMode: 'CASH',
      refType: data.refType,
      refId: data.refId,
      status: 'COMPLETED',
      attachments: data.attachments || [],
      createdAt: nowIso,
    };

    const nextCashbook = [newEntry, ...latestDatasetRef.current.cashbookEntries];
    latestDatasetRef.current = {
      ...latestDatasetRef.current,
      cashbookEntries: nextCashbook,
    };
    setCashbookEntries(nextCashbook);
    logAudit('CASHBOOK_ENTRY', `Cash ${data.type} of ₹${amt} (${data.description})`, 'SETTINGS');
  };

  // Sales actions
  const recordSale = (data: {
    amount: number;
    grossAmount?: number;
    loyaltyPointsRedeemed?: number;
    paymentMethod: PaymentMethod;
    customerId?: string;
    customerName?: string;
    items?: SaleItem[];
    notes?: string;
    isCredit?: boolean;
    date?: string;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
  }): {
    success: boolean;
    saleId?: string;
    invoiceNo?: string;
    loyaltyPointsEarned?: number;
    loyaltyPointsRedeemed?: number;
    loyaltyDiscountAmount?: number;
    error?: string;
    duplicate?: boolean;
  } => {
    const res = prepareAtomicSale(latestDatasetRef.current, data);
    if (!res.success || !res.nextDataset) {
      return {
        success: false,
        duplicate: res.duplicate,
        saleId: res.extra?.saleId,
        invoiceNo: res.extra?.invoiceNo,
        error: res.error,
      };
    }
    applyAtomicDatasetUpdate(res.nextDataset, res.auditEvent);
    return {
      success: true,
      saleId: res.extra?.saleId,
      invoiceNo: res.extra?.invoiceNo,
      loyaltyPointsEarned: res.extra?.loyaltyPointsEarned,
      loyaltyPointsRedeemed: res.extra?.loyaltyPointsRedeemed,
      loyaltyDiscountAmount: res.extra?.loyaltyDiscountAmount,
    };
  };

  const cancelSale = (saleId: string, reason: string): boolean => {
    const res = prepareAtomicCancelSale(latestDatasetRef.current, saleId, reason);
    if (!res.success || !res.nextDataset) {
      return false;
    }
    applyAtomicDatasetUpdate(res.nextDataset, res.auditEvent);
    return true;
  };

  // Expense actions
  const addExpense = (data: {
    title: string;
    category: ExpenseRecord['category'];
    amount: number;
    isPersonalWithdrawal: boolean;
    paymentMethod: 'CASH' | 'UPI' | 'BANK';
    notes?: string;
    date?: string;
    attachments?: BillAttachment[];
  }) => {
    const amt = Number(data.amount) || 0;
    const expDayKey = toLocalDayKey(data.date) || getLocalTodayKey();
    const expId = `exp-${Date.now()}`;

    const newExpense: ExpenseRecord = {
      id: expId,
      title: data.title,
      category: data.category,
      amount: amt,
      isPersonalWithdrawal: data.isPersonalWithdrawal,
      paymentMethod: data.paymentMethod,
      date: expDayKey,
      notes: data.notes,
      attachments: data.attachments || [],
      createdAt: new Date().toISOString(),
    };

    const nextExpenses = [newExpense, ...latestDatasetRef.current.expenses];
    latestDatasetRef.current = {
      ...latestDatasetRef.current,
      expenses: nextExpenses,
    };
    setExpenses(nextExpenses);

    // If paid via physical CASH, record in cashbook on exact expense date
    if (data.paymentMethod === 'CASH') {
      addCashbookEntry({
        type: 'OUT',
        category: data.isPersonalWithdrawal ? 'DRAWING' : 'EXPENSE',
        description: `${data.title} (${data.category})`,
        amount: amt,
        refType: data.isPersonalWithdrawal ? 'DRAWING' : 'EXPENSE',
        refId: expId,
        date: expDayKey,
        attachments: data.attachments,
      });
    }

    logAudit(
      'ADD_EXPENSE',
      `Expense recorded: ₹${amt} for ${data.title} (${data.isPersonalWithdrawal ? 'Personal Drawing' : 'Shop Expense'})`,
      'EXPENSE',
      expId
    );
  };

  const deleteExpense = (id: string, reason: string) => {
    const exp = latestDatasetRef.current.expenses.find((e) => e.id === id);
    if (!exp) return;

    const cancelDate = new Date().toISOString();
    const nextExpenses = latestDatasetRef.current.expenses.filter((e) => e.id !== id);
    const nextCashbook = latestDatasetRef.current.cashbookEntries.map((cb) =>
      cb.refId === id &&
      (cb.refType === 'EXPENSE' || cb.refType === 'DRAWING') &&
      isCashbookEntryActive(cb)
        ? {
            ...cb,
            status: 'CANCELLED' as const,
            cancelReason: `Expense deleted: ${reason}`,
            cancelledAt: cancelDate,
          }
        : cb
    );

    latestDatasetRef.current = {
      ...latestDatasetRef.current,
      expenses: nextExpenses,
      cashbookEntries: nextCashbook,
    };

    setExpenses(nextExpenses);
    setCashbookEntries(nextCashbook);
    logAudit('DELETE_EXPENSE', `Deleted expense '${exp.title}' for ₹${exp.amount}. Reason: ${reason}`, 'EXPENSE', id);
  };

  // Inventory actions
  const addProduct = (data: Omit<Product, 'id' | 'updatedAt'>) => {
    const id = `p-${Date.now()}`;
    const newProduct: Product = {
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    };
    setProducts((prev) => [newProduct, ...prev]);
    logAudit('ADD_PRODUCT', `Added stock product: ${data.name} (${data.stockQty} ${data.unit})`, 'STOCK', id);
  };

  const updateProduct = (id: string, patch: Partial<Product>) => {
    const safePatch: Partial<Product> = { ...patch };
    if (safePatch.stockQty !== undefined) {
      safePatch.stockQty = roundStockQty(Number(safePatch.stockQty) || 0);
    }
    const nextProducts = latestDatasetRef.current.products.map((p) =>
      p.id === id ? { ...p, ...safePatch, updatedAt: new Date().toISOString() } : p
    );
    latestDatasetRef.current = {
      ...latestDatasetRef.current,
      products: nextProducts,
    };
    setProducts(nextProducts);
    logAudit('UPDATE_PRODUCT', `Updated product details: ${patch.name || id}`, 'STOCK', id);
  };

  const adjustStock = (
    id: string,
    qtyChange: number,
    reason: string,
    date?: string,
    source: StockAdjustmentRecord['source'] = 'MANUAL',
    options?: {
      idempotencyKey?: string;
      referenceId?: string;
      referenceType?: StockAdjustmentRecord['referenceType'];
    }
  ): { success: boolean; error?: string; duplicate?: boolean } => {
    const res = applyManualStockAdjustment({
      products: latestDatasetRef.current.products,
      stockAdjustments: latestDatasetRef.current.stockAdjustments,
      productId: id,
      qtyChange,
      reason,
      date,
      source,
      allowNegativeStock: Boolean(profile.allowNegativeStock),
      referenceId: options?.referenceId,
      referenceType: options?.referenceType,
      idempotencyKey: options?.idempotencyKey,
    });

    if (!res.success) {
      return { success: false, duplicate: res.duplicate, error: res.error };
    }

    latestDatasetRef.current = {
      ...latestDatasetRef.current,
      products: res.products,
      stockAdjustments: res.stockAdjustments,
    };
    setProducts(res.products);
    setStockAdjustments(res.stockAdjustments);

    const targetProd = res.products.find((p) => p.id === id);
    const formattedChange = Math.abs(qtyChange) < 1 ? Number(qtyChange.toFixed(3)) : qtyChange;
    logAudit(
      'STOCK_ADJUSTMENT',
      `Stock adjusted for ${targetProd?.name || id}: ${qtyChange > 0 ? `+${formattedChange}` : formattedChange}. Reason: ${reason.trim()}`,
      'STOCK',
      id
    );

    return { success: true };
  };

  const archiveProduct = (id: string, isArchived: boolean, reason = '') => {
    const p = products.find((prod) => prod.id === id);
    if (!p) return;
    setProducts((prev) =>
      prev.map((prod) =>
        prod.id === id ? { ...prod, isArchived, updatedAt: new Date().toISOString() } : prod
      )
    );
    logAudit(
      isArchived ? 'ARCHIVE_PRODUCT' : 'RESTORE_PRODUCT',
      `${isArchived ? 'Archived' : 'Restored'} product ${p.name}${reason ? `. Reason: ${reason}` : ''}`,
      'STOCK',
      id
    );
  };

  const deleteProduct = (id: string, reason: string) => {
    const p = products.find((prod) => prod.id === id);
    if (!p) return;
    setProducts((prev) => prev.filter((prod) => prod.id !== id));
    logAudit('DELETE_PRODUCT', `Deleted product ${p.name}. Reason: ${reason}`, 'STOCK', id);
  };

  const updateProductThreshold = (id: string, newMinStock: number) => {
    const safeThreshold = Math.max(0, Number(newMinStock) || 0);
    setProducts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, minStockAlert: safeThreshold, updatedAt: new Date().toISOString() } : p
      )
    );
    const prod = products.find((p) => p.id === id);
    logAudit('UPDATE_THRESHOLD', `Updated low-stock alert threshold for ${prod?.name || id} to ${safeThreshold} ${prod?.unit || 'units'}`, 'STOCK', id);
  };

  const importCustomersFromCSV = (csvText: string) => {
    const { valid, skipped, errors } = parseCustomersCSV(csvText);
    if (valid.length > 0) {
      setCustomers((prev) => {
        const phoneMap = new Map<string, Customer>();
        prev.forEach((c) => {
          if (c.phone) phoneMap.set(c.phone, c);
          else phoneMap.set(c.id, c);
        });

        valid.forEach((newC) => {
          if (newC.phone && phoneMap.has(newC.phone)) {
            const existing = phoneMap.get(newC.phone)!;
            phoneMap.set(newC.phone, {
              ...existing,
              ...newC,
              id: existing.id,
              currentBalance: existing.currentBalance || newC.openingBalance,
            });
          } else {
            phoneMap.set(newC.phone || newC.id, newC);
          }
        });

        return Array.from(phoneMap.values());
      });

      logAudit(
        'CSV_IMPORT_CUSTOMERS',
        `Imported ${valid.length} customers via bulk CSV (${skipped} skipped rows)`,
        'CUSTOMER'
      );
    }
    return { imported: valid.length, skipped, errors };
  };

  const importSuppliersFromCSV = (csvText: string) => {
    const { valid, skipped, errors } = parseSuppliersCSV(csvText);
    if (valid.length > 0) {
      setSuppliers((prev) => {
        const nameMap = new Map<string, Supplier>();
        prev.forEach((s) => nameMap.set(s.name.toLowerCase().trim(), s));

        valid.forEach((newS) => {
          const key = newS.name.toLowerCase().trim();
          if (nameMap.has(key)) {
            const existing = nameMap.get(key)!;
            nameMap.set(key, { ...existing, ...newS, id: existing.id });
          } else {
            nameMap.set(key, newS);
          }
        });

        return Array.from(nameMap.values());
      });

      logAudit(
        'CSV_IMPORT_SUPPLIERS',
        `Imported ${valid.length} suppliers via bulk CSV (${skipped} skipped rows)`,
        'SUPPLIER'
      );
    }
    return { imported: valid.length, skipped, errors };
  };

  const importSuppliersBatch = (
    rows: Array<
      Pick<
        ParsedPdfSupplierRow,
        | 'name'
        | 'contactPerson'
        | 'phone'
        | 'address'
        | 'gstin'
        | 'creditTerms'
        | 'preferredPaymentMethod'
        | 'openingBalance'
        | 'notes'
      >
    >,
    options?: { duplicateMode?: 'UPDATE' | 'SKIP' }
  ): { imported: number; updated: number; skipped: number } => {
    const cleanRows = rows.filter((r) => r.name && r.name.trim().length > 0);
    if (cleanRows.length === 0) return { imported: 0, updated: 0, skipped: 0 };

    const duplicateMode = options?.duplicateMode ?? 'UPDATE';
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const newOpeningTxs: SupplierTransaction[] = [];
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.split('T')[0];

    setSuppliers((prev) => {
      const next = [...prev];
      const byPhone = new Map<string, number>();
      const byName = new Map<string, number>();

      next.forEach((s, idx) => {
        const cleanPh = (s.phone || '').replace(/\D/g, '');
        if (cleanPh.length >= 10) byPhone.set(cleanPh.slice(-10), idx);
        byName.set(s.name.toLowerCase().trim(), idx);
      });

      for (const row of cleanRows) {
        const cleanName = row.name.trim();
        const cleanPhone = (row.phone || '').replace(/\D/g, '').slice(-10) || (row.phone || '').trim();
        const matchIdx =
          (cleanPhone.length >= 10 ? byPhone.get(cleanPhone) : undefined) ??
          byName.get(cleanName.toLowerCase());

        const payMethod = row.preferredPaymentMethod
          ? normalizePreferredPaymentMethod(row.preferredPaymentMethod)
          : undefined;
        const openBal = Math.max(0, Number(row.openingBalance) || 0);

        if (matchIdx !== undefined) {
          if (duplicateMode === 'SKIP') {
            skippedCount++;
            continue;
          }
          const existing = next[matchIdx];
          next[matchIdx] = {
            ...existing,
            contactPerson: row.contactPerson?.trim() || existing.contactPerson,
            phone: cleanPhone || existing.phone,
            address: row.address?.trim() || existing.address,
            gstin: row.gstin?.trim() || existing.gstin,
            creditTerms: row.creditTerms?.trim() || existing.creditTerms,
            preferredPaymentMethod: payMethod || existing.preferredPaymentMethod,
            notes: row.notes?.trim() || existing.notes,
          };
          updatedCount++;
        } else {
          const id = `sup-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const created: Supplier = {
            id,
            name: cleanName,
            contactPerson: row.contactPerson?.trim() || undefined,
            phone: cleanPhone,
            address: row.address?.trim() || undefined,
            gstin: row.gstin?.trim() || undefined,
            creditTerms: row.creditTerms?.trim() || undefined,
            preferredPaymentMethod: payMethod,
            openingBalance: openBal,
            currentBalance: openBal,
            totalPurchases: openBal,
            totalPaid: 0,
            lastTransactionDate: nowIso,
            notes: row.notes?.trim() || undefined,
            createdAt: todayDate,
          };
          next.push(created);
          if (cleanPhone.length >= 10) byPhone.set(cleanPhone, next.length - 1);
          byName.set(cleanName.toLowerCase(), next.length - 1);

          if (openBal > 0) {
            newOpeningTxs.push({
              id: `stx-open-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              supplierId: id,
              type: 'OPENING',
              amount: openBal,
              date: nowIso,
              paymentStatus: 'UNPAID',
              description: 'Opening Balance (Imported from PDF)',
              createdAt: nowIso,
            });
          }
          importedCount++;
        }
      }

      return next;
    });

    if (newOpeningTxs.length > 0) {
      setSupplierTransactions((prev) => [...newOpeningTxs, ...prev]);
    }

    logAudit(
      'BULK_IMPORT_SUPPLIERS',
      `Bulk CSV/PDF supplier import: ${importedCount} added, ${updatedCount} updated, ${skippedCount} skipped`,
      'SUPPLIER'
    );

    return { imported: importedCount, updated: updatedCount, skipped: skippedCount };
  };

  const addProductCategory = (input: {
    name: string;
    defaultUnit: string;
    defaultMinStockAlert?: number;
  }): { success: boolean; error?: string; category?: ProductCategoryConfig } => {
    try {
      const res = addProductCategoryConfig(productCategories, input);
      setProductCategories(res.categories);
      logAudit(
        'ADD_PRODUCT_CATEGORY',
        `Added product category "${res.created.name}" (default unit: ${res.created.defaultUnit})`,
        'STOCK',
        res.created.id
      );
      return { success: true, category: res.created };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add category.' };
    }
  };

  const updateProductCategory = (
    id: string,
    patch: { name: string; defaultUnit: string; defaultMinStockAlert?: number }
  ): { success: boolean; error?: string; renamedProductsCount?: number } => {
    try {
      const res = updateProductCategoryConfig(productCategories, products, id, patch);
      setProductCategories(res.categories);
      if (res.renamedProductsCount > 0) {
        setProducts(res.products);
      }
      logAudit(
        'UPDATE_PRODUCT_CATEGORY',
        `Updated category "${res.updated.name}" (default unit: ${res.updated.defaultUnit}, ${res.renamedProductsCount} products updated)`,
        'STOCK',
        id
      );
      return { success: true, renamedProductsCount: res.renamedProductsCount };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to update category.' };
    }
  };

  const mergeProductCategories = (
    sourceId: string,
    targetId: string
  ): { success: boolean; error?: string; movedProductsCount?: number } => {
    try {
      const res = mergeProductCategoriesConfigs(productCategories, products, sourceId, targetId);
      setProductCategories(res.categories);
      setProducts(res.products);
      logAudit(
        'MERGE_PRODUCT_CATEGORIES',
        `Merged category "${res.sourceName}" into "${res.targetName}" (${res.movedProductsCount} products moved)`,
        'STOCK',
        targetId
      );
      return { success: true, movedProductsCount: res.movedProductsCount };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to merge categories.' };
    }
  };

  const deleteProductCategory = (
    id: string,
    reassignToCategoryName?: string
  ): { success: boolean; error?: string; reassignedProductsCount?: number } => {
    try {
      const res = deleteProductCategoryConfig(
        productCategories,
        products,
        id,
        reassignToCategoryName
      );
      setProductCategories(res.categories);
      if (res.reassignedProductsCount > 0) {
        setProducts(res.products);
      }
      logAudit(
        'DELETE_PRODUCT_CATEGORY',
        `Deleted category "${res.deletedName}"${reassignToCategoryName ? ` (${res.reassignedProductsCount} products reassigned to "${reassignToCategoryName}")` : ''}`,
        'STOCK',
        id
      );
      return { success: true, reassignedProductsCount: res.reassignedProductsCount };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to delete category.' };
    }
  };

  const addExpenseCategory = (input: {
    label: string;
    icon?: string;
    isPersonalDrawing?: boolean;
  }): { success: boolean; error?: string; category?: ExpenseCategoryConfig } => {
    try {
      const res = addExpenseCategoryConfig(expenseCategories, input);
      setExpenseCategories(res.categories);
      logAudit(
        'ADD_EXPENSE_CATEGORY',
        `Added custom expense category "${res.created.label}" (${res.created.isPersonalDrawing ? 'Owner Drawing' : 'Business Operating'})`,
        'EXPENSE',
        res.created.id
      );
      return { success: true, category: res.created };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to add expense category.',
      };
    }
  };

  const updateExpenseCategory = (
    id: string,
    patch: { label: string; icon?: string; isPersonalDrawing?: boolean }
  ): { success: boolean; error?: string; category?: ExpenseCategoryConfig } => {
    try {
      const res = updateExpenseCategoryConfig(expenseCategories, id, patch);
      setExpenseCategories(res.categories);
      logAudit(
        'UPDATE_EXPENSE_CATEGORY',
        `Updated expense category "${res.updated.label}"`,
        'EXPENSE',
        id
      );
      return { success: true, category: res.updated };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update expense category.',
      };
    }
  };

  const deleteExpenseCategory = (
    id: string,
    reassignToId?: string
  ): {
    success: boolean;
    error?: string;
    reassignedExpensesCount?: number;
    reassignedRecurringCount?: number;
  } => {
    try {
      const res = deleteExpenseCategoryConfig(
        expenseCategories,
        expenses,
        recurringExpenses,
        id,
        reassignToId
      );
      setExpenseCategories(res.categories);
      if (res.reassignedExpensesCount > 0) {
        setExpenses(res.expenses);
      }
      if (res.reassignedRecurringCount > 0) {
        setRecurringExpenses(res.recurringExpenses);
      }
      logAudit(
        'DELETE_EXPENSE_CATEGORY',
        `Deleted expense category "${res.deletedLabel}"${
          res.reassignedExpensesCount || res.reassignedRecurringCount
            ? ` (reassigned ${res.reassignedExpensesCount} expenses, ${res.reassignedRecurringCount} recurring bills)`
            : ''
        }`,
        'EXPENSE',
        id
      );
      return {
        success: true,
        reassignedExpensesCount: res.reassignedExpensesCount,
        reassignedRecurringCount: res.reassignedRecurringCount,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete expense category.',
      };
    }
  };

  const restoreDefaultExpenseCategories = (): { addedCount: number } => {
    const res = restoreMissingDefaultExpenseCategories(expenseCategories);
    if (res.addedCount > 0) {
      setExpenseCategories(res.categories);
      logAudit(
        'RESTORE_EXPENSE_CATEGORIES',
        `Restored ${res.addedCount} default expense categories`,
        'EXPENSE'
      );
    }
    return { addedCount: res.addedCount };
  };

  const importProductsFromCSV = (csvText: string) => {
    const { valid, skipped, errors } = parseProductsCSV(csvText);
    if (valid.length > 0) {
      setProducts((prev) => {
        const nameMap = new Map<string, Product>();
        prev.forEach((p) => nameMap.set(p.name.toLowerCase().trim(), p));

        valid.forEach((newP) => {
          const key = newP.name.toLowerCase().trim();
          if (nameMap.has(key)) {
            const existing = nameMap.get(key)!;
            nameMap.set(key, {
              ...existing,
              ...newP,
              id: existing.id,
              stockQty: newP.stockQty !== undefined ? newP.stockQty : existing.stockQty,
              updatedAt: new Date().toISOString(),
            });
          } else {
            nameMap.set(key, newP);
          }
        });

        return Array.from(nameMap.values());
      });

      logAudit(
        'CSV_IMPORT_PRODUCTS',
        `Imported ${valid.length} inventory products via bulk CSV (${skipped} skipped rows)`,
        'STOCK'
      );
    }
    return { imported: valid.length, skipped, errors };
  };

  const importProductsBatch = (
    rows: ParsedInventoryImportRow[],
    options?: { duplicateMode?: 'UPDATE' | 'SKIP' }
  ): { imported: number; updated: number; skipped: number } => {
    const cleanRows = rows.filter((r) => r.name && r.name.trim().length > 0);
    if (cleanRows.length === 0) return { imported: 0, updated: 0, skipped: 0 };

    const duplicateMode = options?.duplicateMode ?? 'UPDATE';
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const nowIso = new Date().toISOString();

    const supplierByLowerName = new Map<string, Supplier>();
    suppliers.forEach((s) => supplierByLowerName.set(s.name.trim().toLowerCase(), s));

    setProducts((prev) => {
      const next = [...prev];

      for (const row of cleanRows) {
        const match = matchExistingInventoryProduct(row, next);
        const linkedSup = row.preferredSupplierName?.trim()
          ? supplierByLowerName.get(row.preferredSupplierName.trim().toLowerCase())
          : undefined;

        if (match.matchedProduct) {
          if (duplicateMode === 'SKIP') {
            skippedCount++;
            continue;
          }
          const idx = next.findIndex((p) => p.id === match.matchedProduct!.id);
          if (idx !== -1) {
            const existing = next[idx];
            next[idx] = {
              ...existing,
              localName: row.localName?.trim() || existing.localName,
              category: row.category?.trim() || existing.category,
              unit: row.unit?.trim() || existing.unit,
              purchasePrice:
                row.purchasePrice > 0 ? row.purchasePrice : existing.purchasePrice,
              sellingPrice:
                row.sellingPrice > 0 ? row.sellingPrice : existing.sellingPrice,
              mrp: row.mrp !== undefined ? row.mrp : existing.mrp,
              stockQty: Number.isFinite(row.stockQty) ? Math.max(0, row.stockQty) : existing.stockQty,
              minStockAlert: Number.isFinite(row.minStockAlert)
                ? Math.max(0, row.minStockAlert)
                : existing.minStockAlert,
              desiredStockLevel:
                row.desiredStockLevel !== undefined
                  ? row.desiredStockLevel
                  : existing.desiredStockLevel,
              preferredSupplierId: linkedSup?.id || existing.preferredSupplierId,
              preferredSupplierName:
                linkedSup?.name || row.preferredSupplierName?.trim() || existing.preferredSupplierName,
              preferredSupplierPhone: linkedSup?.phone || existing.preferredSupplierPhone,
              description: row.description?.trim() || existing.description,
              isArchived: false,
              updatedAt: nowIso,
            };
            updatedCount++;
          }
        } else {
          const created: Product = {
            id: `p-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            name: row.name.trim(),
            localName: row.localName?.trim() || undefined,
            category: row.category?.trim() || 'General Kirana',
            purchasePrice: Math.max(0, Number(row.purchasePrice) || 0),
            sellingPrice: Math.max(0, Number(row.sellingPrice) || 0),
            mrp: row.mrp,
            stockQty: Math.max(0, Number(row.stockQty) || 0),
            unit: row.unit?.trim() || 'pcs',
            minStockAlert: Math.max(0, Number(row.minStockAlert) || 5),
            desiredStockLevel: row.desiredStockLevel,
            preferredSupplierId: linkedSup?.id,
            preferredSupplierName: linkedSup?.name || row.preferredSupplierName?.trim() || undefined,
            preferredSupplierPhone: linkedSup?.phone,
            lastPurchasePrice:
              Number(row.purchasePrice) > 0 ? Number(row.purchasePrice) : undefined,
            description: row.description?.trim() || undefined,
            updatedAt: nowIso,
          };
          next.push(created);
          importedCount++;
        }
      }

      return next;
    });

    logAudit(
      'BULK_IMPORT_PRODUCTS',
      `Bulk CSV/PDF inventory import: ${importedCount} added, ${updatedCount} updated, ${skippedCount} skipped`,
      'STOCK'
    );

    return { imported: importedCount, updated: updatedCount, skipped: skippedCount };
  };

  const markAlertRead = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
  };

  const dismissAllAlerts = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  };

  const bulkUpdateProductsCategory = (ids: string[], category: string): number => {
    const idSet = new Set(ids);
    const trimmedCategory = category.trim();
    if (idSet.size === 0 || !trimmedCategory) return 0;
    const nowIso = new Date().toISOString();
    let updatedCount = 0;
    setProducts((prev) =>
      prev.map((p) => {
        if (!idSet.has(p.id)) return p;
        updatedCount += 1;
        return { ...p, category: trimmedCategory, updatedAt: nowIso };
      })
    );
    logAudit(
      'BULK_UPDATE_CATEGORY',
      `Updated category to "${trimmedCategory}" for ${idSet.size} inventory items`,
      'STOCK'
    );
    return updatedCount || idSet.size;
  };

  const bulkDeleteOrArchiveProducts = (
    ids: string[],
    reason = 'Bulk inventory cleanup'
  ): { archivedCount: number; deletedCount: number } => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return { archivedCount: 0, deletedCount: 0 };

    const archiveSet = new Set<string>();
    const deleteSet = new Set<string>();

    products.forEach((p) => {
      if (!idSet.has(p.id)) return;
      if (hasProductTransactionHistory(p.id, p.name, sales, stockAdjustments)) {
        archiveSet.add(p.id);
      } else {
        deleteSet.add(p.id);
      }
    });

    const nowIso = new Date().toISOString();
    setProducts((prev) =>
      prev
        .filter((p) => !deleteSet.has(p.id))
        .map((p) => (archiveSet.has(p.id) ? { ...p, isArchived: true, updatedAt: nowIso } : p))
    );

    logAudit(
      'BULK_DELETE_ARCHIVE_PRODUCTS',
      `Bulk inventory action (${reason}): ${deleteSet.size} deleted permanently, ${archiveSet.size} archived (had sales/purchase history)`,
      'STOCK'
    );
    return { archivedCount: archiveSet.size, deletedCount: deleteSet.size };
  };

  const setDailySalesTarget = (targetAmount: number) => {
    const cleanTarget = Math.max(0, Math.round((Number(targetAmount) || 0) * 100) / 100);
    const config: DailySalesTargetConfig = {
      amount: cleanTarget,
      updatedAt: new Date().toISOString(),
    };
    setDailySalesTargetState(config);
    logAudit(
      'UPDATE_SALES_TARGET',
      `Updated daily sales target to ₹${cleanTarget.toLocaleString('en-IN')}`,
      'SETTINGS'
    );
  };

  const addRecurringExpense = (
    data: Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'>
  ): string => {
    const id = `rexp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const record: RecurringExpense = {
      ...data,
      id,
      amount: Math.max(0, Number(data.amount) || 0),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setRecurringExpenses((prev) => [record, ...prev]);
    logAudit(
      'ADD_RECURRING_EXPENSE',
      `Created ${data.frequency} recurring expense schedule "${data.title}" (₹${record.amount})`,
      'EXPENSE',
      id
    );
    return id;
  };

  const updateRecurringExpense = (id: string, patch: Partial<RecurringExpense>) => {
    const nowIso = new Date().toISOString();
    setRecurringExpenses((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: nowIso } : r))
    );
    logAudit('UPDATE_RECURRING_EXPENSE', `Updated recurring expense ${patch.title || id}`, 'EXPENSE', id);
  };

  const deleteRecurringExpense = (id: string) => {
    const target = recurringExpenses.find((r) => r.id === id);
    setRecurringExpenses((prev) => prev.filter((r) => r.id !== id));
    if (target) {
      logAudit(
        'DELETE_RECURRING_EXPENSE',
        `Removed recurring expense schedule "${target.title}" (₹${target.amount})`,
        'EXPENSE',
        id
      );
    }
  };

  const generateDueRecurringExpense = (id: string, customDate?: string): boolean => {
    const sched = recurringExpenses.find((r) => r.id === id);
    if (!sched) return false;
    const recordDate = customDate || getLocalTodayKey();

    const schedCat = expenseCategories.find((c) => c.id === sched.category);
    addExpense({
      title: sched.title,
      category: sched.category,
      amount: sched.amount,
      isPersonalWithdrawal: Boolean(
        sched.isPersonalWithdrawal || schedCat?.isPersonalDrawing || sched.category === 'PERSONAL_DRAWING'
      ),
      paymentMethod: sched.paymentMethod,
      notes: sched.notes
        ? `${sched.notes} • Recurring (${sched.frequency})`
        : `Recurring ${sched.frequency} expense`,
      date: recordDate,
    });

    const nextDue = advanceRecurringDueDate(sched.nextDueDate, sched.frequency);
    setRecurringExpenses((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              lastGeneratedDate: recordDate,
              nextDueDate: nextDue,
              updatedAt: new Date().toISOString(),
            }
          : r
      )
    );
    return true;
  };

  const markDayClosed = (dateKey: string, notes?: string) => {
    setLastClosedDate(dateKey);
    logAudit(
      'DAILY_CLOSING',
      `Shop daily closing completed for ${dateKey}${notes ? ` (${notes})` : ''}`,
      'SETTINGS'
    );
  };

  const demoDataAnalysis = useMemo(
    () => analyzeDemoVsRealDataset(currentDatasetSnapshot),
    [currentDatasetSnapshot]
  );

  const completeFirstTimeSetup = async (input: {
    storeName: string;
    ownerName?: string;
    phone?: string;
    upiId?: string;
    address?: string;
    gstin?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const cleanStoreName = (input.storeName || '').trim();
    if (!cleanStoreName) {
      return { success: false, error: 'Please enter your Shop / Store Name to continue.' };
    }
    const cleanPhone = (input.phone || '').trim();
    if (cleanPhone && !/^[0-9+\-\s]{7,15}$/.test(cleanPhone)) {
      return { success: false, error: 'Please enter a valid mobile number or leave it blank.' };
    }

    const resolvedPhone = cleanPhone || profile.phone || '';
    const nextProfile: StoreProfile = sanitizeProfileForStorage({
      ...profile,
      id: profile.id || 'store-1',
      storeName: cleanStoreName,
      ownerName: (input.ownerName || '').trim(),
      phone: resolvedPhone,
      upiId: (input.upiId || '').trim(),
      address: (input.address || '').trim(),
      gstin: (input.gstin || '').trim().toUpperCase() || undefined,
      currencySymbol: profile.currencySymbol || '₹',
      isPinEnabled: false,
    });

    const db = dbRef.current;
    if (db) {
      try {
        await db.setMeta('firstTimeSetupCompleted', true);
      } catch (err) {
        return {
          success: false,
          error: formatStorageError(err, 'save first-time shop setup').message,
        };
      }
    }

    setProfile(nextProfile);
    setNeedsFirstTimeSetup(false);
    if (isAuthenticated && authSession && resolvedPhone !== authSession.mobile) {
      try {
        await persistNewAuthSession({
          authMode: authSession.authMode,
          mobile: resolvedPhone,
        });
      } catch {
        // Non-fatal: active session remains valid in memory
      }
    }
    logAudit(
      'SHOP_INITIALIZED',
      `Initialized fresh shop profile for "${cleanStoreName}"`,
      'SETTINGS'
    );
    return { success: true };
  };

  const clearDemoRecordsOnly = async (): Promise<{
    removedCount: number;
    preservedReferencedCount: number;
  }> => {
    const { cleanedDataset, removedCount, preservedReferencedIds } = removeDemoRecordsOnly(
      latestDatasetRef.current
    );
    setProfile(sanitizeProfileForStorage(cleanedDataset.profile));
    setCustomers(cleanedDataset.customers);
    setCustomerTransactions(cleanedDataset.customerTransactions);
    setSuppliers(cleanedDataset.suppliers);
    setSupplierTransactions(cleanedDataset.supplierTransactions);
    setProducts(cleanedDataset.products);
    setStockAdjustments(cleanedDataset.stockAdjustments);
    setSales(cleanedDataset.sales);
    setExpenses(cleanedDataset.expenses);
    setCashbookEntries(cleanedDataset.cashbookEntries);
    setAuditLogs([
      {
        id: `log-cleandemo-${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: 'CLEAN_DEMO_DATA',
        details: `Manually removed ${removedCount} unreferenced sample demo records while preserving all real shop records`,
        entityType: 'SETTINGS',
        user: cleanedDataset.profile.ownerName || 'Owner',
      },
      ...cleanedDataset.auditLogs,
    ]);
    return {
      removedCount,
      preservedReferencedCount: preservedReferencedIds.length,
    };
  };

  const resetToDemoData = () => {
    setProfile(sanitizeProfileForStorage(initialStoreProfile));
    setCustomers(initialCustomers);
    setCustomerTransactions(initialCustomerTransactions);
    setSuppliers(initialSuppliers);
    setSupplierTransactions(initialSupplierTransactions);
    setSales(initialSales);
    setExpenses(initialExpenses);
    setCashbookEntries(initialCashbookEntries);
    setProducts(initialProducts);
    setProductCategories(buildDefaultProductCategories(initialProducts));
    setExpenseCategories(buildDefaultExpenseCategories(initialExpenses, []));
    setStockAdjustments(initialStockAdjustments);
    setAuditLogs(initialAuditLogs);
    setRecurringExpenses([]);
    setDailySalesTargetState(null);
    setIsLocked(false);
    setNeedsFirstTimeSetup(false);
    if (dbRef.current) {
      void dbRef.current.setMeta('firstTimeSetupCompleted', true);
    }
    logAudit('RESET_DEMO', 'Loaded sample demo dataset manually from Settings', 'SETTINGS');
  };

  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  const getBackupSummary = (): AppBackupSummary => {
    const backup = generateBackupData({
      profile,
      customers,
      customerTransactions,
      suppliers,
      supplierTransactions,
      sales,
      expenses,
      cashbookEntries,
      products,
      productCategories,
      expenseCategories,
      stockAdjustments,
      auditLogs,
      whatsappBatches,
      whatsappAuditLogs,
      billDocuments,
      recurringExpenses,
      dailySalesTarget,
      lastClosedDate,
    });
    return backup.summary;
  };

  const currentBatch = useMemo(() => {
    if (!whatsappBatches || whatsappBatches.length === 0) return null;
    const pending = whatsappBatches.find(
      (b) => b.status === 'READY_FOR_REVIEW' || b.status === 'AWAITING_APPROVAL' || b.status === 'SCHEDULED'
    );
    return pending || whatsappBatches[0];
  }, [whatsappBatches]);

  const loadWhatsAppBatches = async () => {
    setIsLoadingWhatsApp(true);
    try {
      const readJsonIfOk = async (res: Response): Promise<Record<string, any>> =>
        res.ok ? res.json() : {};
      const [batchesRes, configRes] = await Promise.all([
        apiFetch('/api/whatsapp/batches').then(readJsonIfOk).catch(() => ({} as Record<string, any>)),
        apiFetch('/api/whatsapp/config').then(readJsonIfOk).catch(() => ({} as Record<string, any>)),
      ]);

      if (batchesRes.success) {
        if (Array.isArray(batchesRes.batches) && batchesRes.batches.length > 0) {
          setWhatsappBatches(batchesRes.batches);
        }
        if (Array.isArray(batchesRes.auditLogs)) {
          setWhatsappAuditLogs(batchesRes.auditLogs);
        }
        if (batchesRes.nextSchedule) {
          setNextScheduleInfo(batchesRes.nextSchedule);
        }
      }

      if (configRes.success && configRes.config) {
        setWhatsappConfig(configRes.config);
      }
    } catch (err) {
      console.warn('Failed to load WhatsApp data from server:', err);
    } finally {
      setIsLoadingWhatsApp(false);
    }
  };

  useEffect(() => {
    loadWhatsAppBatches();
  }, []);

  // Debounced sync of ledger snapshot to server for autonomous Sunday 12:00 PM IST preparation
  useEffect(() => {
    if (isApiAuthUnavailable() || !profile?.storeName?.trim()) return;
    const timer = setTimeout(() => {
      if (isApiAuthUnavailable()) return;
      apiFetch('/api/whatsapp/store-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales,
          customers,
          customerTransactions,
          storeProfile: profile,
        }),
      }).catch(() => {
        // Silent background sync fallback
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [sales, customers, customerTransactions, profile]);

  const generateWhatsAppBatch = async (forceRegenerate = false): Promise<WhatsAppReminderBatch | null> => {
    setIsLoadingWhatsApp(true);
    try {
      const res = await apiFetch('/api/whatsapp/batch/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales,
          customers,
          customerTransactions,
          storeProfile: profile,
          forceRegenerate,
        }),
      });
      const data = await res.json();
      if (data.success && data.batch) {
        setWhatsappBatches((prev) => {
          const filtered = prev.filter((b) => b.id !== data.batch.id && b.idempotencyKey !== data.batch.idempotencyKey);
          return [data.batch, ...filtered];
        });
        logAudit(
          'WHATSAPP_BATCH_PREPARED',
          `Generated weekly reminder batch: ${data.batch.totalEligibleCustomers} customers, ₹${data.batch.totalOutstandingAmount} total dues`,
          'SETTINGS'
        );
        return data.batch;
      }
      return null;
    } catch (err) {
      console.error('Failed to generate WhatsApp batch:', err);
      return null;
    } finally {
      setIsLoadingWhatsApp(false);
    }
  };

  const approveWhatsAppBatch = async (
    batchId: string,
    approvedCustomerIds: string[]
  ): Promise<WhatsAppReminderBatch | null> => {
    setIsLoadingWhatsApp(true);
    try {
      const res = await apiFetch('/api/whatsapp/batch/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          approvedCustomerIds,
          approvedBy: profile.ownerName || 'Store Owner',
        }),
      });
      const data = await res.json();
      if (data.success && data.batch) {
        setWhatsappBatches((prev) => prev.map((b) => (b.id === batchId ? data.batch : b)));
        logAudit(
          'WHATSAPP_BATCH_APPROVED',
          `Approved weekly reminder batch for ${approvedCustomerIds.length} customers by ${profile.ownerName || 'Owner'}`,
          'SETTINGS'
        );
        return data.batch;
      }
      return null;
    } catch (err) {
      console.error('Failed to approve WhatsApp batch:', err);
      return null;
    } finally {
      setIsLoadingWhatsApp(false);
    }
  };

  const cancelWhatsAppBatch = async (
    batchId: string,
    reason = 'Cancelled by owner'
  ): Promise<WhatsAppReminderBatch | null> => {
    setIsLoadingWhatsApp(true);
    try {
      const res = await apiFetch('/api/whatsapp/batch/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, reason }),
      });
      const data = await res.json();
      if (data.success && data.batch) {
        setWhatsappBatches((prev) => prev.map((b) => (b.id === batchId ? data.batch : b)));
        logAudit('WHATSAPP_BATCH_CANCELLED', `Cancelled reminder batch ${batchId}. Reason: ${reason}`, 'SETTINGS');
        return data.batch;
      }
      return null;
    } catch (err) {
      console.error('Failed to cancel WhatsApp batch:', err);
      return null;
    } finally {
      setIsLoadingWhatsApp(false);
    }
  };

  const sendApprovedWhatsAppBatch = async (
    batchId: string
  ): Promise<{ sentCount: number; failedCount: number; skippedCount: number }> => {
    setIsLoadingWhatsApp(true);
    try {
      const res = await apiFetch('/api/whatsapp/batch/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          storeName: profile.storeName,
          upiId: profile.upiId,
          currentCustomers: customers,
          currentTransactions: customerTransactions,
          currentSales: sales,
        }),
      });
      const data = await res.json();
      if (data.success && data.batch) {
        setWhatsappBatches((prev) => prev.map((b) => (b.id === batchId ? data.batch : b)));
        const nowIso = new Date().toISOString();
        const sentCustomerIds = new Set(
          data.batch.items
            .filter((item: any) => item.status === 'SENT')
            .map((item: any) => item.customerId)
        );
        if (sentCustomerIds.size > 0) {
          setCustomers((prev) =>
            prev.map((c) =>
              sentCustomerIds.has(c.id)
                ? {
                    ...c,
                    lastReminderSentAt: nowIso,
                    reminderCount: (c.reminderCount || 0) + 1,
                  }
                : c
            )
          );
        }
        await loadWhatsAppBatches();
        return {
          sentCount: data.sentCount || 0,
          failedCount: data.failedCount || 0,
          skippedCount: data.skippedCount || 0,
        };
      }
      throw new Error(data.error || 'Failed to dispatch reminders');
    } catch (err: any) {
      console.error('Failed to send WhatsApp batch:', err);
      throw err;
    } finally {
      setIsLoadingWhatsApp(false);
    }
  };

  const updateWhatsAppConfig = async (
    patch: Partial<WhatsAppApiConfig> & {
      accessToken?: string;
      webhookVerifyToken?: string;
      verifiedTestNumber?: string;
    }
  ): Promise<WhatsAppApiConfig | null> => {
    setIsLoadingWhatsApp(true);
    try {
      const res = await apiFetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.success && data.config) {
        setWhatsappConfig(data.config);
        logAudit('UPDATE_WHATSAPP_CONFIG', 'Updated WhatsApp Business API configuration', 'SETTINGS');
        await loadWhatsAppBatches();
        return data.config;
      }
      return null;
    } catch (err) {
      console.error('Failed to update WhatsApp config:', err);
      return null;
    } finally {
      setIsLoadingWhatsApp(false);
    }
  };

  const testWhatsAppConnection = async (): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await apiFetch('/api/whatsapp/test-connection', { method: 'POST' });
      const data = await res.json();
      if (data.config) {
        setWhatsappConfig(data.config);
      }
      await loadWhatsAppBatches();
      return {
        success: data.success,
        message: data.message || (data.success ? 'Connected successfully' : 'Connection failed'),
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection test failed' };
    }
  };

  const sendTestWhatsAppMessage = async (payload: {
    testPhoneNumber?: string;
    customerName?: string;
    outstandingAmount?: number;
  }) => {
    try {
      const res = await apiFetch('/api/whatsapp/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testPhoneNumber: payload.testPhoneNumber,
          customerName: payload.customerName,
          outstandingAmount: payload.outstandingAmount,
          storeName: profile.storeName,
          upiId: profile.upiId,
        }),
      });
      const data = await res.json();
      await loadWhatsAppBatches();
      return {
        success: Boolean(data.success),
        message: data.message || (data.success ? 'Test message dispatched' : 'Test message failed'),
        messageId: data.messageId,
        formattedPhone: data.formattedPhone,
        sandboxSimulated: data.sandboxSimulated,
        apiResponseSummary: data.apiResponseSummary,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to send test message',
      };
    }
  };

  const toggleCustomerWhatsAppConsent = (customerId: string, consent: boolean) => {
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId
          ? {
              ...c,
              whatsappConsent: consent,
              whatsappOptOutDate: consent ? undefined : new Date().toISOString(),
            }
          : c
      )
    );
    const target = customers.find((c) => c.id === customerId);
    logAudit(
      'UPDATE_CUSTOMER',
      `Updated WhatsApp reminder preference for ${target?.name || customerId} to ${consent ? 'CONSENTED' : 'OPTED_OUT'}`,
      'CUSTOMER',
      customerId
    );
  };

  const getBackupJSONString = (): string => {
    const backup = generateBackupData({
      profile,
      customers,
      customerTransactions,
      suppliers,
      supplierTransactions,
      sales,
      expenses,
      cashbookEntries,
      products,
      productCategories,
      expenseCategories,
      stockAdjustments,
      auditLogs,
      whatsappBatches,
      whatsappAuditLogs,
      billDocuments,
      recurringExpenses,
      dailySalesTarget,
      lastClosedDate,
    });
    return serializeBackupJSON(backup, true);
  };

  const exportBackupJSON = (customFilename?: string) => {
    const backup = generateBackupData({
      profile,
      customers,
      customerTransactions,
      suppliers,
      supplierTransactions,
      sales,
      expenses,
      cashbookEntries,
      products,
      productCategories,
      expenseCategories,
      stockAdjustments,
      auditLogs,
      whatsappBatches,
      whatsappAuditLogs,
      billDocuments,
      recurringExpenses,
      dailySalesTarget,
      lastClosedDate,
    });
    const jsonStr = serializeBackupJSON(backup, true);
    const dateFormatted = getLocalTodayKey();
    const filename = customFilename || `arjun-groceries-backup-${dateFormatted}.json`;
    downloadBackupJSONFile(jsonStr, filename);

    logAudit(
      'MANUAL_BACKUP_EXPORT',
      `Manual JSON backup generated: ${backup.summary.totalTransactions} transactions (${backup.summary.salesCount} sales, ${backup.summary.customerTransactionsCount} customer dues/payments, ${backup.summary.expenseCount} expenses, ${backup.summary.cashbookCount} cash entries, ${backup.summary.billDocumentsCount || 0} bill docs)`,
      'SETTINGS'
    );
  };

  const restoreBackupFromJSON = (
    jsonStr: string
  ): { success: boolean; error?: string; count?: number } => {
    const parsed = validateAndParseBackupJSON(jsonStr);
    if (!parsed.valid || !parsed.data) {
      return { success: false, error: parsed.error || 'Invalid backup schema' };
    }

    const { data, summary } = parsed;
    const rawDataset: StoreBusinessDataset = {
      profile: sanitizeProfileForStorage(data.profile),
      customers: deduplicateById(data.customers || []),
      customerTransactions: deduplicateById(data.customerTransactions || []),
      suppliers: deduplicateById(data.suppliers || []),
      supplierTransactions: deduplicateById(data.supplierTransactions || []),
      sales: deduplicateById(data.sales || []),
      expenses: deduplicateById(data.expenses || []),
      cashbookEntries: deduplicateById(data.cashbookEntries || []),
      products: deduplicateById(data.products || []),
      productCategories: buildDefaultProductCategories(data.products || [], data.productCategories || []),
      expenseCategories: buildDefaultExpenseCategories(
        data.expenses || [],
        data.recurringExpenses || [],
        data.expenseCategories || []
      ),
      stockAdjustments: deduplicateById(data.stockAdjustments || []),
      auditLogs: deduplicateById(data.auditLogs || []),
      whatsappBatches: deduplicateById(data.whatsappBatches || []),
      whatsappAuditLogs: deduplicateById(data.whatsappAuditLogs || []),
      billDocuments: deduplicateById(data.billDocuments || []),
      recurringExpenses: deduplicateById(data.recurringExpenses || []),
      dailySalesTarget: data.dailySalesTarget ?? null,
      lastClosedDate: data.lastClosedDate ?? null,
    };

    const reconciled = recalculateLedgerBalancesFromHistory(rawDataset);
    setProfile(reconciled.profile);
    setCustomers(reconciled.customers);
    setCustomerTransactions(reconciled.customerTransactions);
    setSuppliers(reconciled.suppliers);
    setSupplierTransactions(reconciled.supplierTransactions);
    setSales(reconciled.sales);
    setExpenses(reconciled.expenses);
    setCashbookEntries(reconciled.cashbookEntries);
    setProducts(reconciled.products);
    setProductCategories(reconciled.productCategories || []);
    setExpenseCategories(reconciled.expenseCategories || []);
    setStockAdjustments(reconciled.stockAdjustments);
    setAuditLogs(reconciled.auditLogs);
    setWhatsappBatches(reconciled.whatsappBatches);
    setWhatsappAuditLogs(reconciled.whatsappAuditLogs);
    setRecurringExpenses(reconciled.recurringExpenses || []);
    setDailySalesTargetState(reconciled.dailySalesTarget ?? null);
    setLastClosedDate(reconciled.lastClosedDate ?? null);
    setBillDocuments(reconciled.billDocuments || []);
    setNeedsPinSetup(Boolean(reconciled.profile.isPinEnabled && !pinSecurityRef.current?.hashBase64));

    if ((reconciled.billDocuments || []).length > 0) {
      importDocumentsFromBackup(reconciled.billDocuments || []).catch((err) => {
        setStorageStatus((prev) => ({
          ...prev,
          storageError: formatStorageError(err, 'restore bill attachments').message,
        }));
      });
    }

    const count = summary?.totalTransactions || 0;
    const storeTarget = data.profile?.storeName || 'Store';
    logAudit(
      'BACKUP_RESTORE',
      `Restored complete business data for "${storeTarget}" from external JSON backup (${count} transactions, ${reconciled.customers.length} customers, ${reconciled.products.length} inventory items)`,
      'SETTINGS'
    );
    return { success: true, count };
  };

  const importBackupJSON = (jsonStr: string): boolean => {
    const res = restoreBackupFromJSON(jsonStr);
    return res.success;
  };

  // Stage 2 & Stage 3 Local IndexedDB & Encrypted Backup Actions
  const applyRestoredDatasetState = (restored: StoreBusinessDataset) => {
    const cleanProfile = sanitizeProfileForStorage(restored.profile);
    const mergedDocs = deduplicateById(restored.billDocuments || []);
    const docMap = new Map(mergedDocs.map((d) => [d.id, d]));
    const hydrateAtts = (atts?: BillAttachment[]) =>
      atts?.map((att) => {
        const match = docMap.get(att.id);
        return match && match.dataUrl ? { ...att, dataUrl: match.dataUrl } : att;
      });

    setProfile(cleanProfile);
    setCustomers(deduplicateById(restored.customers || []));
    setCustomerTransactions(
      deduplicateById(restored.customerTransactions || []).map((t) => ({
        ...t,
        attachments: hydrateAtts(t.attachments),
      }))
    );
    setSuppliers(deduplicateById(restored.suppliers || []));
    setSupplierTransactions(
      deduplicateById(restored.supplierTransactions || []).map((t) => ({
        ...t,
        attachments: hydrateAtts(t.attachments),
      }))
    );
    setSales(
      deduplicateById(restored.sales || []).map((s) => ({
        ...s,
        attachments: hydrateAtts(s.attachments),
      }))
    );
    setExpenses(
      deduplicateById(restored.expenses || []).map((e) => ({
        ...e,
        attachments: hydrateAtts(e.attachments),
      }))
    );
    setCashbookEntries(
      deduplicateById(restored.cashbookEntries || []).map((c) => ({
        ...c,
        attachments: hydrateAtts(c.attachments),
      }))
    );
    setProducts(deduplicateById(restored.products || []));
    setProductCategories(
      buildDefaultProductCategories(restored.products || [], restored.productCategories || [])
    );
    setExpenseCategories(
      buildDefaultExpenseCategories(
        restored.expenses || [],
        restored.recurringExpenses || [],
        restored.expenseCategories || []
      )
    );
    setStockAdjustments(deduplicateById(restored.stockAdjustments || []));
    setAuditLogs(deduplicateById(restored.auditLogs || []));
    if (restored.whatsappBatches) setWhatsappBatches(deduplicateById(restored.whatsappBatches));
    if (restored.whatsappAuditLogs) setWhatsappAuditLogs(deduplicateById(restored.whatsappAuditLogs));
    setBillDocuments(mergedDocs);
    setRecurringExpenses(deduplicateById(restored.recurringExpenses || []));
    setDailySalesTargetState(restored.dailySalesTarget ?? null);
    if (restored.lastClosedDate !== undefined) setLastClosedDate(restored.lastClosedDate ?? null);
    setNeedsPinSetup(Boolean(cleanProfile.isPinEnabled && !pinSecurityRef.current?.hashBase64));
    setNeedsFirstTimeSetup(false);
    if (dbRef.current) {
      void dbRef.current.setMeta('firstTimeSetupCompleted', true);
    }
  };

  /**
   * Consolidates live React dataset with all bill documents in IndexedDB & legacy SmartKirana_Bills_DB
   * so every backup / PDF / Excel export captures linked and standalone attachments cleanly.
   */
  const buildConsolidatedDataset = useCallback(async (): Promise<StoreBusinessDataset> => {
    const snap = latestDatasetRef.current;
    let vaultDocs: BillAttachment[] = [];
    try {
      vaultDocs = await getAllBillDocuments();
    } catch {
      vaultDocs = [];
    }
    const mergedDocs = deduplicateById([...(snap.billDocuments || []), ...vaultDocs]);
    const docMap = new Map(mergedDocs.map((d) => [d.id, d]));
    const hydrateAtts = (atts?: BillAttachment[]) =>
      atts?.map((att) => {
        const match = docMap.get(att.id);
        return match && match.dataUrl ? { ...att, dataUrl: match.dataUrl } : att;
      });

    return {
      ...snap,
      profile: sanitizeProfileForStorage(snap.profile),
      billDocuments: mergedDocs,
      sales: snap.sales.map((s) => ({ ...s, attachments: hydrateAtts(s.attachments) })),
      expenses: snap.expenses.map((e) => ({ ...e, attachments: hydrateAtts(e.attachments) })),
      customerTransactions: snap.customerTransactions.map((t) => ({
        ...t,
        attachments: hydrateAtts(t.attachments),
      })),
      supplierTransactions: snap.supplierTransactions.map((t) => ({
        ...t,
        attachments: hydrateAtts(t.attachments),
      })),
      cashbookEntries: snap.cashbookEntries.map((c) => ({
        ...c,
        attachments: hydrateAtts(c.attachments),
      })),
    };
  }, []);

  const createManualLocalBackup = async (reason?: string): Promise<LocalBackupSnapshot | null> => {
    const db = dbRef.current;
    if (!db) return null;
    try {
      const consolidated = await buildConsolidatedDataset();
      const snap = await createLocalBackupSnapshot(
        db,
        consolidated,
        'MANUAL',
        reason || 'Manual snapshot from Local Storage & Backup Dashboard',
        autoBackupSettings
      );
      logAudit(
        'MANUAL_LOCAL_SNAPSHOT',
        `Created local IndexedDB snapshot (${snap.summary.totalTransactions} transactions, checksum ${snap.checksum.slice(0, 10)})`,
        'SETTINGS'
      );
      await refreshStorageTelemetry();
      return snap;
    } catch (err) {
      setStorageStatus((prev) => ({
        ...prev,
        storageError: formatStorageError(err, 'create local backup snapshot').message,
      }));
      return null;
    }
  };

  const getCurrentBusinessDataset = useCallback((): StoreBusinessDataset => {
    const snap = latestDatasetRef.current;
    return {
      ...snap,
      profile: sanitizeProfileForStorage(snap.profile),
    };
  }, []);

  const restoreBackupFromJSONSafe = async (
    contentStr: string,
    passphrase?: string
  ): Promise<{
    success: boolean;
    error?: string;
    criticalRecoveryFailure?: boolean;
    count?: number;
    rollbackCheckpointId?: string;
    verifiedCounts?: VerifiedRestoreCounts;
    reconciliationReport?: BackupReconciliationReport;
    warnings?: string[];
  }> => {
    const db = dbRef.current || createMemoryLocalDbAdapter();
    try {
      const res = await restoreBackupSafelyWithRollback(
        db,
        latestDatasetRef.current,
        contentStr,
        passphrase
      );
      if (!res.success || !res.restoredDataset) {
        return {
          success: false,
          criticalRecoveryFailure: res.criticalRecoveryFailure,
          error: res.error || 'Restore aborted safely',
          reconciliationReport: res.reconciliationReport,
          rollbackCheckpointId: res.rollbackCheckpointId,
        };
      }
      applyRestoredDatasetState(res.restoredDataset);
      const count = res.summary?.totalTransactions || 0;
      logAudit(
        'SAFE_BACKUP_RESTORE',
        `Safely restored ${count} transactions (${res.restoredDataset.billDocuments?.length || 0} bill docs) with rollback checkpoint ${res.rollbackCheckpointId || ''}`,
        'SETTINGS'
      );
      await refreshStorageTelemetry();
      return {
        success: true,
        count,
        rollbackCheckpointId: res.rollbackCheckpointId,
        verifiedCounts: res.verifiedCounts,
        reconciliationReport: res.reconciliationReport,
        warnings: res.warnings,
      };
    } catch (err: unknown) {
      if (err instanceof CriticalRestoreRollbackError) {
        return {
          success: false,
          criticalRecoveryFailure: true,
          error: err.message,
          reconciliationReport: err.reconciliationReport,
          rollbackCheckpointId: err.rollbackCheckpointId,
        };
      }
      return {
        success: false,
        criticalRecoveryFailure: true,
        error:
          err instanceof Error
            ? `CRITICAL RECOVERY FAILURE: ${err.message}`
            : 'CRITICAL RECOVERY FAILURE: Unexpected error during backup restore.',
      };
    }
  };

  const restoreFromLocalBackupSnapshot = async (
    snapshotId: string
  ): Promise<{
    success: boolean;
    error?: string;
    count?: number;
    verifiedCounts?: VerifiedRestoreCounts;
    reconciliationReport?: BackupReconciliationReport;
    warnings?: string[];
  }> => {
    const db = dbRef.current;
    if (!db) return { success: false, error: 'Local database not ready' };
    const snap = await db.getByKey<LocalBackupSnapshot>(STORE_NAMES.LOCAL_BACKUPS, snapshotId);
    if (!snap) {
      return { success: false, error: 'Snapshot no longer exists in IndexedDB.' };
    }
    return restoreBackupFromJSONSafe(snap.payloadJson);
  };

  const deleteLocalBackupSnapshot = async (snapshotId: string): Promise<void> => {
    const db = dbRef.current;
    if (!db) return;
    await db.deleteOne(STORE_NAMES.LOCAL_BACKUPS, snapshotId);
    await refreshStorageTelemetry();
  };

  const exportBackupPdfReport = async (customFilename?: string, preferShareSheet = false) => {
    const dataset = await buildConsolidatedDataset();
    const pdfBytes = await exportBackupReportPdfBytes(dataset);
    const dateFormatted = getLocalTodayKey();
    const filename = customFilename || `arjun-groceries-report-${dateFormatted}.pdf`;
    const result = await exportBinaryFileWithPickerFallback(pdfBytes, filename, {
      mimeType: 'application/pdf',
      description: 'Arjun Groceries PDF Report',
      extensions: ['.pdf'],
      title: 'Arjun Groceries PDF Report',
      preferShareSheet,
    });
    if (!result.cancelled) {
      logAudit(
        'PDF_BACKUP_EXPORT',
        `Exported formatted PDF business backup report (${dataset.sales.length} sales, ${dataset.customers.length} customers, ${result.byteSize || pdfBytes.byteLength} bytes, via ${result.savedVia})`,
        'SETTINGS'
      );
    }
    return { ...result, fileName: filename };
  };

  const exportBackupExcelFile = async (customFilename?: string, preferShareSheet = false) => {
    const dataset = await buildConsolidatedDataset();
    const xlsxBytes = await generateBackupExcelBuffer(dataset);
    const dateFormatted = getLocalTodayKey();
    const filename = customFilename || `arjun-groceries-backup-${dateFormatted}.xlsx`;
    const result = await exportBinaryFileWithPickerFallback(xlsxBytes, filename, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      description: 'Arjun Groceries Excel Workbook',
      extensions: ['.xlsx'],
      title: 'Arjun Groceries Excel Backup',
      preferShareSheet,
    });
    if (!result.cancelled) {
      logAudit(
        'EXCEL_BACKUP_EXPORT',
        `Exported 11-sheet Excel backup workbook (.xlsx: ${dataset.sales.length} sales, ${dataset.customers.length} customers, ${dataset.products.length} items, ${result.byteSize || xlsxBytes.byteLength} bytes, via ${result.savedVia})`,
        'SETTINGS'
      );
    }
    return { ...result, fileName: filename };
  };

  const exportVerifiedBackupFile = async (customFilename?: string, preferShareSheet = false) => {
    const consolidated = await buildConsolidatedDataset();
    const envelope = await buildVerifiedBackupEnvelope(consolidated);
    const dateFormatted = getLocalTodayKey();
    const filename = customFilename || `arjun-groceries-backup-${dateFormatted}.json`;
    const result = await exportBackupFileWithPickerFallback(envelope.jsonString, filename, {
      preferShareSheet,
    });
    if (!result.cancelled) {
      logAudit(
        'VERIFIED_BACKUP_EXPORT',
        `Exported checksum-verified JSON backup (${envelope.backup.summary.totalTransactions} transactions, ${envelope.backup.summary.billDocumentsCount || 0} bill docs, ${result.byteSize || envelope.sizeBytes} bytes, via ${result.savedVia})`,
        'SETTINGS'
      );
    }
    return {
      ...result,
      fileName: filename,
      byteSize: result.byteSize || envelope.sizeBytes,
      checksum: envelope.checksum,
    };
  };

  const exportEncryptedBackupFile = async (
    passphrase: string,
    customFilename?: string,
    preferShareSheet = false
  ) => {
    const consolidated = await buildConsolidatedDataset();
    const envelope = await buildEncryptedBackupFileContent(consolidated, passphrase);
    const dateFormatted = getLocalTodayKey();
    const filename = customFilename || `arjun-groceries-backup-${dateFormatted}.skbackup.json`;
    const result = await exportBackupFileWithPickerFallback(envelope.jsonString, filename, {
      preferShareSheet,
    });
    if (!result.cancelled) {
      logAudit(
        'ENCRYPTED_BACKUP_EXPORT',
        `Exported AES-256-GCM encrypted backup (${envelope.backup.summary.totalTransactions} transactions, ${envelope.backup.summary.billDocumentsCount || 0} bill docs, ${result.byteSize || envelope.sizeBytes} bytes, via ${result.savedVia})`,
        'SETTINGS'
      );
    }
    return {
      ...result,
      fileName: filename,
      byteSize: result.byteSize || envelope.sizeBytes,
      checksum: envelope.checksum,
    };
  };

  const updateAutoBackupSettings = async (patch: Partial<AutoBackupSettings>) => {
    const next: AutoBackupSettings = { ...autoBackupSettings, ...patch };
    setAutoBackupSettings(next);
    if (dbRef.current) {
      await dbRef.current.setMeta('autoBackupSettings', next);
      await refreshStorageTelemetry();
    }
  };

  const purgeLegacyLocalStorageArchive = async (): Promise<void> => {
    clearLegacyLocalStorageBusinessKeys(
      typeof window !== 'undefined' ? window.localStorage : null
    );
    logAudit(
      'PURGE_LEGACY_LOCALSTORAGE',
      'Cleared migrated legacy localStorage business archive keys after user confirmation',
      'SETTINGS'
    );
    await refreshStorageTelemetry();
  };

  // Phase 5: Encrypted Firebase Cloud Storage Backup & Disaster Recovery Handlers
  const persistCloudConfig = useCallback(async (nextConfig: CloudBackupConfig) => {
    setCloudBackupConfig(nextConfig);
    if (dbRef.current) {
      await dbRef.current.setMeta('cloudBackupConfig', nextConfig);
    }
  }, []);

  const persistCloudStatus = useCallback(async (nextStatus: CloudBackupStatus) => {
    setCloudBackupStatus(nextStatus);
    if (dbRef.current) {
      await dbRef.current.setMeta('cloudBackupStatus', nextStatus);
    }
  }, []);

  const refreshCloudBackupHistory = useCallback(async (): Promise<CloudBackupRemoteEntry[]> => {
    if (!cloudAuthUser?.uid || !cloudAuthUser.emailVerified) {
      setCloudBackupHistory([]);
      return [];
    }
    try {
      const entries = await listUserCloudBackups(cloudTransportRef.current, cloudAuthUser.uid);
      setCloudBackupHistory(entries);
      return entries;
    } catch {
      return [];
    }
  }, [cloudAuthUser]);

  const signInCloudBackupAccount = async (): Promise<{
    success: boolean;
    error?: string;
    redirectStarted?: boolean;
  }> => {
    try {
      const res = await signInWithGoogleForCloudBackup();
      if (res.redirectStarted) {
        return { success: true, redirectStarted: true };
      }
      if (res.user) {
        setCloudAuthUser(res.user);
        if (!cloudBackupConfig.boundOwnerUid) {
          await persistCloudConfig({
            ...cloudBackupConfig,
            boundOwnerUid: res.user.uid,
            boundOwnerEmail: res.user.email,
          });
        }
        const entries = await listUserCloudBackups(cloudTransportRef.current, res.user.uid).catch(
          () => [] as CloudBackupRemoteEntry[]
        );
        setCloudBackupHistory(entries);
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      await persistCloudStatus({ ...cloudBackupStatus, state: 'ERROR', lastError: msg });
      return { success: false, error: msg };
    }
  };

  const signOutCloudBackupAccount = async (): Promise<void> => {
    await signOutFirebaseSync();
    cloudSessionPassphraseRef.current = null;
    setIsCloudPassphraseUnlocked(false);
    setCloudAuthUser(null);
    setCloudBackupHistory([]);
  };

  const unlockCloudBackupPassphrase = async (
    passphrase: string,
    mode: 'UNLOCK' | 'SET_NEW' = 'UNLOCK'
  ): Promise<{ success: boolean; error?: string }> => {
    const trimmed = passphrase.trim();
    const check = validateCloudPassphrase(trimmed);
    if (!check.valid) {
      return { success: false, error: check.error };
    }

    if (mode === 'UNLOCK' && cloudBackupConfig.passphraseVerifier) {
      const matches = await verifyPassphraseVerifier(trimmed, cloudBackupConfig.passphraseVerifier);
      if (!matches) {
        return {
          success: false,
          error: 'Cloud recovery passphrase does not match the configured store recovery passphrase.',
        };
      }
    }

    if (mode === 'SET_NEW' || !cloudBackupConfig.passphraseVerifier) {
      const verifier = await createPassphraseVerifier(trimmed);
      await persistCloudConfig({
        ...cloudBackupConfig,
        passphraseVerifier: verifier,
        passphraseConfiguredAt: verifier.updatedAt,
      });
    }

    cloudSessionPassphraseRef.current = trimmed;
    setIsCloudPassphraseUnlocked(true);
    return { success: true };
  };

  const lockCloudBackupPassphrase = () => {
    cloudSessionPassphraseRef.current = null;
    setIsCloudPassphraseUnlocked(false);
  };

  const updateCloudBackupConfig = async (patch: Partial<CloudBackupConfig>): Promise<void> => {
    const next: CloudBackupConfig = {
      ...cloudBackupConfig,
      ...patch,
    };
    await persistCloudConfig(next);
  };

  const backupNowToCloud = useCallback(
    async (options?: {
      passphrase?: string;
      bucket?: 'daily' | 'manual';
      allowRebindOwner?: boolean;
    }): Promise<{ success: boolean; error?: string; entry?: CloudBackupRemoteEntry }> => {
      if (cloudUploadInFlightRef.current) {
        return { success: false, error: 'A cloud backup upload is already in progress.' };
      }

      const activePass = options?.passphrase?.trim() || cloudSessionPassphraseRef.current || '';
      const passCheck = validateCloudPassphrase(activePass);
      if (!passCheck.valid) {
        return { success: false, error: passCheck.error };
      }

      if (cloudBackupConfig.passphraseVerifier && !options?.allowRebindOwner) {
        const matches = await verifyPassphraseVerifier(activePass, cloudBackupConfig.passphraseVerifier);
        if (!matches) {
          return {
            success: false,
            error: 'Entered passphrase does not match your configured cloud recovery passphrase.',
          };
        }
      }

      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : storageStatus.isOnline;
      const now = new Date();
      const istToday = getIstDateKey(now);

      if (!isOnline) {
        const deferredStatus: CloudBackupStatus = {
          ...cloudBackupStatus,
          state: 'OFFLINE_DEFERRED',
          pendingDailyBackupIst: true,
          lastAttemptAt: now.toISOString(),
          lastAttemptDateKeyIst: istToday,
          lastError: 'Device offline. Backup deferred safely; IndexedDB remains intact.',
        };
        await persistCloudStatus(deferredStatus);
        return { success: false, error: deferredStatus.lastError || 'Device is offline.' };
      }

      cloudUploadInFlightRef.current = true;
      setIsCloudBackupBusy(true);
      await persistCloudStatus({
        ...cloudBackupStatus,
        state: 'UPLOADING',
        lastError: null,
      });

      try {
        // Keep session passphrase in memory only & bind verifier if unset
        cloudSessionPassphraseRef.current = activePass;
        setIsCloudPassphraseUnlocked(true);

        let effectiveConfig = cloudBackupConfig;
        if (!effectiveConfig.passphraseVerifier || (options?.allowRebindOwner && cloudAuthUser?.uid)) {
          const verifier = effectiveConfig.passphraseVerifier || (await createPassphraseVerifier(activePass));
          effectiveConfig = {
            ...effectiveConfig,
            boundOwnerUid:
              options?.allowRebindOwner || !effectiveConfig.boundOwnerUid
                ? cloudAuthUser?.uid
                : effectiveConfig.boundOwnerUid,
            boundOwnerEmail:
              options?.allowRebindOwner || !effectiveConfig.boundOwnerUid
                ? cloudAuthUser?.email
                : effectiveConfig.boundOwnerEmail,
            passphraseVerifier: verifier,
            passphraseConfiguredAt: effectiveConfig.passphraseConfiguredAt || verifier.updatedAt,
          };
          await persistCloudConfig(effectiveConfig);
        }

        const consolidated = await buildConsolidatedDataset();
        const res = await uploadEncryptedCloudBackup({
          transport: cloudTransportRef.current,
          authUser: cloudAuthUser,
          config: effectiveConfig,
          dataset: consolidated,
          passphrase: activePass,
          bucket: options?.bucket || 'manual',
          isOnline,
          now,
          allowRebindOwner: options?.allowRebindOwner,
        });

        await persistCloudStatus(res.status);
        const updatedEntries = await listUserCloudBackups(
          cloudTransportRef.current,
          cloudAuthUser!.uid
        ).catch(() => [res.uploadedEntry]);
        setCloudBackupHistory(updatedEntries);

        logAudit(
          options?.bucket === 'daily' ? 'CLOUD_DAILY_BACKUP' : 'CLOUD_MANUAL_BACKUP',
          `Uploaded AES-256-GCM encrypted cloud snapshot (${res.uploadedEntry.name}, ${res.uploadedEntry.sizeBytes} bytes, pruned ${res.prunedPaths.length} expired)`,
          'SETTINGS'
        );

        return { success: true, entry: res.uploadedEntry };
      } catch (err) {
        const msg =
          err instanceof CloudBackupOwnerMismatchError || err instanceof Error
            ? err.message
            : 'Cloud backup upload failed.';
        await persistCloudStatus({
          ...cloudBackupStatus,
          state: 'ERROR',
          verificationStatus: 'FAILED',
          lastAttemptAt: now.toISOString(),
          lastAttemptDateKeyIst: istToday,
          pendingDailyBackupIst: true,
          lastError: msg,
        });
        return { success: false, error: msg };
      } finally {
        cloudUploadInFlightRef.current = false;
        setIsCloudBackupBusy(false);
      }
    },
    [
      cloudAuthUser,
      cloudBackupConfig,
      cloudBackupStatus,
      storageStatus.isOnline,
      buildConsolidatedDataset,
      persistCloudConfig,
      persistCloudStatus,
    ]
  );

  // Phase 5: Daily IST Auto-Backup Scheduler (once per IST day; strictly skips offline; never syncs live records)
  useEffect(() => {
    if (!isDbHydrated || needsFirstTimeSetup) return;

    const maybeRunDailyBackup = () => {
      if (
        !shouldRunDailyCloudBackup({
          config: cloudBackupConfig,
          status: cloudBackupStatus,
          authUser: cloudAuthUser,
          sessionPassphrase: cloudSessionPassphraseRef.current,
          isOnline: storageStatus.isOnline,
        })
      ) {
        return;
      }
      void backupNowToCloud({ bucket: 'daily' });
    };

    maybeRunDailyBackup();

    const intervalId = setInterval(maybeRunDailyBackup, 15 * 60 * 1000);
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        maybeRunDailyBackup();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    return () => {
      clearInterval(intervalId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [
    isDbHydrated,
    needsFirstTimeSetup,
    cloudBackupConfig,
    cloudBackupStatus,
    cloudAuthUser,
    isCloudPassphraseUnlocked,
    storageStatus.isOnline,
    backupNowToCloud,
  ]);

  const previewCloudBackupForRestore = async (params: {
    fullPath: string;
    passphrase: string;
  }): Promise<{
    success: boolean;
    error?: string;
    inspected?: InspectedBackupResult;
    rawEncryptedJson?: string;
    sizeBytes?: number;
    ciphertextSha256?: string;
  }> => {
    if (!cloudAuthUser?.uid || !cloudAuthUser.emailVerified) {
      return { success: false, error: 'Sign in with your verified Google account first.' };
    }
    setIsCloudBackupBusy(true);
    try {
      const downloaded: InspectedCloudDownloadResult = await downloadAndInspectCloudBackup({
        transport: cloudTransportRef.current,
        uid: cloudAuthUser.uid,
        fullPath: params.fullPath,
        passphrase: params.passphrase,
      });
      return {
        success: true,
        inspected: downloaded.inspected,
        rawEncryptedJson: downloaded.rawEncryptedJson,
        sizeBytes: downloaded.sizeBytes,
        ciphertextSha256: downloaded.ciphertextSha256,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unable to download or decrypt cloud backup.',
      };
    } finally {
      setIsCloudBackupBusy(false);
    }
  };

  const restoreFromCloudBackup = async (params: {
    fullPath: string;
    passphrase: string;
    allowRebindOwner?: boolean;
  }): Promise<{
    success: boolean;
    error?: string;
    criticalRecoveryFailure?: boolean;
    count?: number;
    rollbackCheckpointId?: string;
    verifiedCounts?: VerifiedRestoreCounts;
    reconciliationReport?: BackupReconciliationReport;
    warnings?: string[];
  }> => {
    const db = dbRef.current || createMemoryLocalDbAdapter();
    setIsCloudBackupBusy(true);
    await persistCloudStatus({
      ...cloudBackupStatus,
      state: 'RESTORING',
      lastError: null,
    });

    try {
      const res = await restoreCloudBackupSafely({
        db,
        currentDataset: latestDatasetRef.current,
        transport: cloudTransportRef.current,
        authUser: cloudAuthUser,
        config: cloudBackupConfig,
        fullPath: params.fullPath,
        passphrase: params.passphrase,
        allowRebindOwner: params.allowRebindOwner,
      });

      if (!res.success || !res.restoredDataset) {
        await persistCloudStatus({
          ...cloudBackupStatus,
          state: 'ERROR',
          lastError: res.error || 'Cloud restore aborted safely.',
        });
        return {
          success: false,
          criticalRecoveryFailure: res.criticalRecoveryFailure,
          error: res.error || 'Cloud restore aborted safely.',
          reconciliationReport: res.reconciliationReport,
          rollbackCheckpointId: res.rollbackCheckpointId,
        };
      }

      applyRestoredDatasetState(res.restoredDataset);
      cloudSessionPassphraseRef.current = params.passphrase.trim();
      setIsCloudPassphraseUnlocked(true);

      const verifier = await createPassphraseVerifier(params.passphrase.trim());
      if (cloudAuthUser?.uid) {
        await persistCloudConfig({
          ...cloudBackupConfig,
          boundOwnerUid: cloudAuthUser.uid,
          boundOwnerEmail: cloudAuthUser.email,
          passphraseVerifier: verifier,
          passphraseConfiguredAt: verifier.updatedAt,
        });
      }
      await persistCloudStatus({
        ...cloudBackupStatus,
        state: 'IDLE',
        lastError: null,
      });

      const count = res.summary?.totalTransactions || 0;
      logAudit(
        'CLOUD_DISASTER_RECOVERY_RESTORE',
        `Restored encrypted cloud snapshot (${count} transactions, ${res.restoredDataset.billDocuments?.length || 0} bill docs) via verified atomic rollback guard`,
        'SETTINGS'
      );
      await refreshStorageTelemetry();

      return {
        success: true,
        count,
        rollbackCheckpointId: res.rollbackCheckpointId,
        verifiedCounts: res.verifiedCounts,
        reconciliationReport: res.reconciliationReport,
        warnings: res.warnings,
      };
    } catch (err) {
      if (err instanceof CriticalRestoreRollbackError) {
        await persistCloudStatus({
          ...cloudBackupStatus,
          state: 'ERROR',
          lastError: err.message,
        });
        return {
          success: false,
          criticalRecoveryFailure: true,
          error: err.message,
          reconciliationReport: err.reconciliationReport,
          rollbackCheckpointId: err.rollbackCheckpointId,
        };
      }
      const msg = err instanceof Error ? err.message : 'Cloud backup restore failed.';
      await persistCloudStatus({
        ...cloudBackupStatus,
        state: 'ERROR',
        lastError: msg,
      });
      return {
        success: false,
        error: msg,
      };
    } finally {
      setIsCloudBackupBusy(false);
    }
  };

  return (
    <StoreContext.Provider
      value={{
        activeTab,
        setActiveTab,
        dateFilter,
        setDateFilter,
        customDateRange,
        setCustomDateRange,

        profile,
        updateProfile,

        customers,
        customerTransactions,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        addCustomerTransaction,
        cancelCustomerTransaction,
        recordCustomerPayment,

        suppliers,
        supplierTransactions,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        addSupplierTransaction,
        cancelSupplierTransaction,
        recordProductPurchase,
        recordPurchaseReturn,

        sales,
        filteredSales,
        recordSale,
        cancelSale,

        expenses,
        filteredExpenses,
        expenseCategories,
        addExpense,
        deleteExpense,
        addExpenseCategory,
        updateExpenseCategory,
        deleteExpenseCategory,
        restoreDefaultExpenseCategories,

        cashbookEntries,
        filteredCashbookEntries,
        addCashbookEntry,

        products,
        productCategories,
        stockAdjustments,
        addProduct,
        updateProduct,
        updateProductThreshold,
        adjustStock,
        archiveProduct,
        deleteProduct,
        addProductCategory,
        updateProductCategory,
        mergeProductCategories,
        deleteProductCategory,
        importCustomersFromCSV,
        importSuppliersFromCSV,
        importSuppliersBatch,
        importProductsFromCSV,
        importProductsBatch,

        auditLogs,
        alerts,
        markAlertRead,
        dismissAllAlerts,

        isQuickSaleOpen,
        setIsQuickSaleOpen,

        isDailyClosingOpen,
        setIsDailyClosingOpen,
        lastClosedDate,
        markDayClosed,
        theme,
        setTheme,
        toggleTheme,
        accentColor,
        accentRamp,
        setAccentColor,
        resetAccentColor,

        selectedCustomerId,
        setSelectedCustomerId,
        selectedSupplierId,
        setSelectedSupplierId,
        openSupplierProfile,
        settingsActiveSection,
        setSettingsActiveSection,
        openCategorySettings,
        openThermalPrintSettings,
        inventoryActiveTab,
        setInventoryActiveTab,
        openInventoryVelocityMonitor,
        reportsActiveTab,
        setReportsActiveTab,
        stockReportProductFilter,
        setStockReportProductFilter,
        openStockMovementReport,
        purchasePrefill,
        setPurchasePrefill,
        openAddPurchaseForProduct,

        authStatus,
        authInitStage,
        isAuthInitializing,
        isAuthenticated,
        isFirebaseAuthReady,
        authSession,
        authNotice,
        clearAuthNotice,
        completeStoreLogin,
        createOwnerAccount,
        registerStoreOwnerWithFirebase,
        requestPasswordResetEmail,
        recoverOwnerWithStoreDetails,
        recoverOwnerWithGoogle,
        loginAsCustomer,
        loginAsSupplier,
        logout,
        isLocked,
        needsPinSetup,
        hasPinConfigured,
        verifyPin,
        unlockWithPin,
        completePinSetupRecovery,
        updatePinSecurity,
        lockApp,

        dailySalesTarget,
        setDailySalesTarget,
        bulkUpdateProductsCategory,
        bulkDeleteOrArchiveProducts,
        recurringExpenses,
        addRecurringExpense,
        updateRecurringExpense,
        deleteRecurringExpense,
        generateDueRecurringExpense,
        billDocuments,
        refreshBillDocuments,

        financials,
        accountingReconciliation,
        resetToDemoData,
        exportBackupJSON,
        importBackupJSON,
        restoreBackupFromJSON,
        getBackupJSONString,
        getBackupSummary,
        isBackupModalOpen,
        setIsBackupModalOpen,

        // WhatsApp Bulk Payment Reminders
        whatsappBatches,
        currentBatch,
        whatsappConfig,
        whatsappAuditLogs,
        nextScheduleInfo,
        isLoadingWhatsApp,
        loadWhatsAppBatches,
        generateWhatsAppBatch,
        approveWhatsAppBatch,
        cancelWhatsAppBatch,
        sendApprovedWhatsAppBatch,
        updateWhatsAppConfig,
        testWhatsAppConnection,
        sendTestWhatsAppMessage,
        toggleCustomerWhatsAppConsent,

        // Local-First IndexedDB & Encrypted Backup Telemetry
        isDbHydrated,
        dbInitError,
        needsFirstTimeSetup,
        retryDatabaseInit,
        completeFirstTimeSetup,
        demoDataAnalysis,
        clearDemoRecordsOnly,
        migrationReport,
        storageStatus,
        clearStorageError,
        localBackups,
        autoBackupSettings,
        createManualLocalBackup,
        restoreFromLocalBackupSnapshot,
        deleteLocalBackupSnapshot,
        getCurrentBusinessDataset,
        exportBackupPdfReport,
        exportBackupExcelFile,
        exportVerifiedBackupFile,
        exportEncryptedBackupFile,
        restoreBackupFromJSONSafe,
        updateAutoBackupSettings,
        refreshStorageTelemetry,
        purgeLegacyLocalStorageArchive,

        // Phase 5: Encrypted Firebase Cloud Backup & Disaster Recovery
        cloudAuthUser,
        cloudBackupConfig,
        cloudBackupStatus,
        cloudBackupHistory,
        isCloudPassphraseUnlocked,
        isCloudBackupBusy,
        signInCloudBackupAccount,
        signOutCloudBackupAccount,
        unlockCloudBackupPassphrase,
        lockCloudBackupPassphrase,
        updateCloudBackupConfig,
        refreshCloudBackupHistory,
        backupNowToCloud,
        previewCloudBackupForRestore,
        restoreFromCloudBackup,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
};
