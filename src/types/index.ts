export type PaymentMethod = 'CASH' | 'UPI' | 'BANK' | 'CREDIT';

export interface WhatsAppTemplateConfig {
  templateName: string;
  bodyTemplate: string;
  footerText?: string;
  includeInvoiceList: boolean;
  includeUpiId: boolean;
  updatedAt: string;
}

export interface PinSecurityRecord {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  hashBase64: string;
  updatedAt: string;
}

export interface DailySalesTargetConfig {
  amount: number;
  updatedAt: string;
}

export type RecurringExpenseFrequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurringExpense {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  isPersonalWithdrawal: boolean;
  paymentMethod: 'CASH' | 'UPI' | 'BANK';
  frequency: RecurringExpenseFrequency;
  startDate: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  lastGeneratedDate?: string; // YYYY-MM-DD
  autoCreateOnDue: boolean;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedBackupEnvelope {
  format: 'SKPRO_ENC_V1';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  createdAt: string;
  metadata?: {
    storeName?: string;
    schemaVersion?: string;
    checksum?: string;
    recordCounts?: Record<string, number>;
  };
}

export type ThermalPaperWidth = '58mm' | '80mm';

export interface ThermalPrintConfig {
  paperWidth: ThermalPaperWidth;
  showLogo: boolean;
  logoMode: 'DEFAULT' | 'CUSTOM';
  customLogoDataUrl?: string;
  logoHeightPx: number;
  headerAlignment: 'CENTER' | 'LEFT';
  headerTitle?: string;
  headerLines: string[];
  footerLines: string[];
  showAddress: boolean;
  showPhone: boolean;
  showGstin: boolean;
  showUpiId: boolean;
  showUpiQr: boolean;
  showCustomerBalance: boolean;
  showItemDiscount: boolean;
  updatedAt?: string;
}

export interface LoyaltyProgramConfig {
  enabled: boolean;
  pointsPer100Rupees: number; // e.g. 5 points earned per ₹100 net spent
  rupeeValuePerPoint: number; // e.g. ₹1 discount per 1 point redeemed
  minRedeemPoints: number; // minimum points required to redeem on a bill
  maxDiscountPercent: number; // cap loyalty discount as % of bill subtotal (1-100)
  updatedAt?: string;
}

export interface StoreProfile {
  id: string;
  storeName: string;
  ownerName: string;
  phone: string;
  upiId: string;
  address: string;
  gstin?: string;
  tagline?: string;
  currencySymbol: string;
  pinCode?: string; // Legacy migration only; never persisted or revealed in v2+
  isPinEnabled: boolean;
  allowNegativeStock?: boolean; // Explicitly opt-in only; false/undefined disallows overselling
  whatsappTemplateConfig?: WhatsAppTemplateConfig;
  thermalPrintConfig?: ThermalPrintConfig;
  loyaltyConfig?: LoyaltyProgramConfig;
}

export type CustomerCategory = 'REGULAR' | 'HIGH_CREDIT' | 'OVERDUE' | 'CLEARED';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  openingBalance: number; // positive = customer owes store (Udhar)
  currentBalance: number; // positive = customer owes store, negative = advance
  totalCreditGiven: number;
  totalPaymentReceived: number;
  lastTransactionDate?: string;
  overdueDays: number;
  category: CustomerCategory;
  notes?: string;
  photoDataUrl?: string; // Compressed JPEG data URL from device camera or upload
  whatsappConsent?: boolean; // Default true: consent to receive WhatsApp payment reminders
  whatsappOptOutDate?: string;
  lastReminderSentAt?: string;
  reminderCount?: number;
  loyaltyPointsBalance?: number;
  totalLoyaltyPointsEarned?: number;
  totalLoyaltyPointsRedeemed?: number;
  createdAt: string;
}

export interface BillOcrItem {
  name: string;
  quantity: number;
  unit: string;
  rate: number;
  total: number;
}

export interface BillOcrExtractedData {
  partyName?: string;
  billNumber?: string;
  billDate?: string;
  items?: BillOcrItem[];
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  notes?: string;
  confidence?: number;
  extractedAt: string;
}

export interface BillAttachment {
  id: string;
  name: string;
  type: 'IMAGE' | 'PDF';
  dataUrl: string; // Base64 compressed image or PDF data URI
  size: number; // in bytes
  uploadedAt: string;
  rotation?: number; // 0, 90, 180, 270
  ocrData?: BillOcrExtractedData;
  transactionId?: string;
  transactionType?: 'SALE' | 'PURCHASE' | 'EXPENSE' | 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT' | 'CASHBOOK';
  fileHash?: string;
}

export type TransactionStatus = 'COMPLETED' | 'CANCELLED' | 'REVERSED';

export type CustomerTransactionType =
  | 'CREDIT'       // Udhar Diya (+ balance)
  | 'PAYMENT'      // Jama Liya (- balance)
  | 'RETURN'       // Sales Return (- balance)
  | 'ADJUSTMENT'   // Credit note / Debit adjustment
  | 'OPENING';     // Account opening balance

export interface CustomerTransaction {
  id: string;
  customerId: string;
  type: CustomerTransactionType;
  amount: number;
  date: string;
  description: string;
  invoiceNo?: string;
  paymentMethod?: 'CASH' | 'UPI' | 'BANK';
  itemsSummary?: string;
  attachments?: BillAttachment[];
  status?: TransactionStatus;
  cancelReason?: string;
  cancelledAt?: string;
  previousBalance?: number;
  runningBalance?: number;
  idempotencyKey?: string;
  productId?: string;
  quantity?: number;
  unit?: string;
  baseUnit?: string;
  baseQuantity?: number;
  unitCostAtSale?: number;
  saleLineId?: string;
  needsManualReview?: boolean;
  returnMatchStatus?:
    | 'MATCHED_LINE'
    | 'AMBIGUOUS_SALE_LINE'
    | 'UNMATCHED_SALE_LINE'
    | 'CANCELLED_ORIGINAL_SALE'
    | 'UNLINKED';
  returnReviewReason?: string;
  items?: Array<{
    productId?: string;
    productName: string;
    quantity: number;
    unit: string;
    baseUnit?: string;
    baseQuantity?: number;
    unitCostAtSale?: number;
    saleLineId?: string;
    returnMatchStatus?:
      | 'MATCHED_LINE'
      | 'AMBIGUOUS_SALE_LINE'
      | 'UNMATCHED_SALE_LINE'
      | 'CANCELLED_ORIGINAL_SALE'
      | 'UNLINKED';
    stockReconciliationStatus?: 'APPLIED' | 'SKIPPED_INCOMPATIBLE_UNIT';
  }>;
  createdAt: string;
}

export interface CustomerLedgerEntry extends CustomerTransaction {
  debitAmount: number;   // Udhar / Credit given (+)
  creditAmount: number;  // Jama / Payment received (-)
  previousBalance: number;
  runningBalance: number;
  isCancelled: boolean;
}

export type LedgerDateRange =
  | 'ALL'
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'CUSTOM';

export interface CustomerLedgerSummary {
  customer: Customer;
  entries: CustomerLedgerEntry[];
  totalCreditGiven: number;
  totalCredit?: number; // Alias for backward compatibility
  totalPaymentReceived: number;
  totalPayment?: number; // Alias for backward compatibility
  netReturnsAndAdjustments: number;
  openingBalance: number;
  closingBalance: number;
  isAdvance: boolean;
  advanceAmount: number;
  accountStatus: 'DUE' | 'CLEARED' | 'ADVANCE';
  status?: 'DUE' | 'CLEARED' | 'ADVANCE'; // Alias
  firstTransactionDate?: string;
  lastTransactionDate?: string;
  activeCount: number;
  cancelledCount: number;
  salesReturns?: number;
  filteredEntriesCount?: number;
  totalEntriesCount?: number;
}

export type SupplierPreferredPaymentMethod =
  | 'CASH'
  | 'UPI'
  | 'BANK_TRANSFER'
  | 'CHEQUE'
  | 'CREDIT';

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone: string;
  address?: string;
  gstin?: string;
  creditTerms?: string;
  preferredPaymentMethod?: SupplierPreferredPaymentMethod;
  openingBalance: number; // positive = store owes supplier
  currentBalance: number; // positive = store owes supplier
  totalPurchases: number;
  totalPaid: number;
  lastTransactionDate?: string;
  notes?: string;
  createdAt: string;
}

export type SupplierTransactionType =
  | 'PURCHASE'     // Maal Kharida (+ payable)
  | 'PAYMENT'      // Bhugtan Kiya (- payable)
  | 'RETURN'       // Purchase Return / Maal Vapsi (- payable)
  | 'ADJUSTMENT'   // Debit / Credit note
  | 'OPENING';     // Opening balance

export type PurchaseReturnReason =
  | 'DAMAGED'
  | 'EXPIRED'
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'EXCESS_STOCK'
  | 'QUALITY_ISSUE'
  | 'OTHER';

export interface PurchaseReturnLineItem {
  productId?: string;
  productName: string;
  quantity: number;
  unit: string;
  baseUnit?: string;
  baseQuantity?: number;
  unitPrice: number;
  total: number;
  reason?: PurchaseReturnReason;
}

export interface SupplierTransaction {
  id: string;
  supplierId: string;
  type: SupplierTransactionType;
  amount: number;
  paidAmount?: number; // Explicit upfront payment on PAID/PARTIAL purchase invoices
  date: string;
  invoiceNo?: string;
  creditNoteNo?: string; // Auto-generated credit note reference for PURCHASE RETURN
  originalInvoiceNo?: string; // Linked inward purchase invoice being returned against
  originalPurchaseId?: string; // Linked SupplierTransaction ID of original purchase
  returnReason?: PurchaseReturnReason;
  returnItems?: PurchaseReturnLineItem[];
  settlementMode?: 'ADJUST_PAYABLE' | 'CASH_REFUND' | 'BANK_REFUND';
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  paymentMethod?: 'CASH' | 'UPI' | 'BANK';
  description: string;
  itemsSummary?: string;
  productId?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  attachments?: BillAttachment[];
  status?: TransactionStatus;
  cancelReason?: string;
  cancelledAt?: string;
  previousBalance?: number;
  runningBalance?: number;
  idempotencyKey?: string;
  createdAt: string;
}

export interface SupplierLedgerEntry extends SupplierTransaction {
  purchaseAmount: number; // Maal Kharida (+)
  paymentAmount: number;  // Bhugtan Kiya (-)
  upfrontPaidAmount?: number; // Explicit or legacy upfront paid on PURCHASE
  previousBalance: number;
  runningBalance: number;
  isCancelled: boolean;
}

export interface SupplierLedgerSummary {
  supplier: Supplier;
  entries: SupplierLedgerEntry[];
  totalPurchases: number;
  grossPurchases?: number;
  purchaseReturns?: number;
  totalPaid: number;
  netReturnsAndAdjustments: number;
  openingBalance: number;
  closingBalance: number;
  isAdvance: boolean;
  advanceAmount: number;
  accountStatus: 'PAYABLE' | 'CLEARED' | 'ADVANCE';
  status?: 'PAYABLE' | 'CLEARED' | 'ADVANCE'; // Alias
  firstTransactionDate?: string;
  lastTransactionDate?: string;
  activeCount: number;
  cancelledCount: number;
  filteredEntriesCount?: number;
  totalEntriesCount?: number;
}

export interface LedgerFilterOptions {
  dateRange: LedgerDateRange;
  customStartDate?: string;
  customEndDate?: string;
  typeFilter: 'ALL' | 'CREDIT_OR_PURCHASE' | 'CREDIT' | 'PURCHASE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT' | 'CANCELLED';
  type?: 'ALL' | 'CREDIT_OR_PURCHASE' | 'CREDIT' | 'PURCHASE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT' | 'CANCELLED'; // Alias
  paymentStatus?: 'ALL' | 'COMPLETED' | 'PAID' | 'DUE' | 'CANCELLED';
  searchQuery?: string;
}


export type SaleItemCostSnapshotSource =
  | 'PRODUCT_PURCHASE_PRICE'
  | 'LAST_PURCHASE_PRICE'
  | 'ZERO_COST';

export interface SaleItem {
  lineId?: string;
  productId?: string;
  productName: string;
  quantity: number;
  unit: string;
  baseUnit?: string;
  baseQuantity?: number; // Normalized quantity in product's base unit for stock deductions & COGS
  unitCostAtSale?: number; // Immutable purchase cost per baseUnit captured at time of sale
  costSnapshotSource?: SaleItemCostSnapshotSource;
  costCapturedAt?: string;
  rate: number;
  discount?: number; // Item-level discount amount in ₹
  discountType?: 'FLAT' | 'PERCENT';
  total: number;
}

export interface SaleRecord {
  id: string;
  invoiceNo: string;
  date: string;
  customerId?: string;
  customerName?: string;
  grossAmount?: number; // Subtotal before loyalty point redemption discount
  amount: number; // Net payable bill amount after loyalty discount
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyDiscountAmount?: number;
  paymentMethod: PaymentMethod;
  items: SaleItem[];
  notes?: string;
  isCredit: boolean;
  status?: TransactionStatus;
  cancelReason?: string;
  cancelledAt?: string;
  attachments?: BillAttachment[];
  idempotencyKey?: string;
  createdAt: string;
}

export type ExpenseCategory =
  | 'SHOP'
  | 'TRANSPORT'
  | 'ELECTRICITY'
  | 'BREAKFAST'
  | 'LUNCH'
  | 'DINNER'
  | 'STAFF'
  | 'PERSONAL_DRAWING'
  | 'OTHER'
  | (string & {});

export interface ExpenseCategoryConfig {
  id: string;
  label: string;
  icon: string;
  isPersonalDrawing?: boolean;
  isSystemDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRecord {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  isPersonalWithdrawal: boolean; // if true: Drawings (equity), not operating expense
  paymentMethod: 'CASH' | 'UPI' | 'BANK';
  date: string;
  notes?: string;
  attachments?: BillAttachment[];
  createdAt: string;
}

export type ProductUnitType = 'WEIGHT' | 'VOLUME' | 'COUNT' | 'PACKAGE';

export interface ProductCategoryConfig {
  id: string;
  name: string;
  defaultUnit: string;
  defaultMinStockAlert?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  localName?: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  mrp?: number;
  stockQty: number;
  unit: string; // Base inventory unit: kg, L, pcs, pkt, bags, boxes, dozens, or custom
  unitType?: ProductUnitType;
  allowedUnits?: string[];
  minStockAlert: number;
  desiredStockLevel?: number;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
  preferredSupplierPhone?: string;
  lastPurchasePrice?: number;
  lastPurchaseDate?: string;
  supplierNotes?: string;
  description?: string;
  isArchived?: boolean;
  barcode?: string; // Legacy hidden field only for historical data compatibility
  updatedAt: string;
}

export interface PurchasePrefillContext {
  productId: string;
  productName: string;
  unit: string;
  supplierId?: string;
  suggestedQty: number;
  unitPurchasePrice: number;
  notes?: string;
}

export interface StockAdjustmentRecord {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  type: 'ADD' | 'REDUCE';
  quantityChange: number;
  previousStock: number;
  newStock: number;
  reason: string;
  date: string;
  source: 'MANUAL' | 'SALE' | 'PURCHASE' | 'EDIT' | 'SALES_RETURN' | 'PURCHASE_RETURN';
  referenceId?: string;
  referenceType?: 'SALE' | 'PURCHASE' | 'SALES_RETURN' | 'PURCHASE_RETURN' | 'MANUAL' | 'EDIT';
  idempotencyKey?: string;
  reconciliationStatus?: 'APPLIED' | 'SKIPPED_INCOMPATIBLE_UNIT';
  historicalUnit?: string;
  historicalQuantity?: number;
  saleLineId?: string;
  createdAt: string;
}

export interface CashbookEntry {
  id: string;
  date: string;
  type: 'IN' | 'OUT';
  category: string;
  description: string;
  amount: number;
  paymentMode: 'CASH'; // Cashbook strictly records physical cash
  refType:
    | 'SALE'
    | 'CUSTOMER_PAYMENT'
    | 'SUPPLIER_PAYMENT'
    | 'EXPENSE'
    | 'DRAWING'
    | 'PURCHASE'
    | 'OPENING'
    | 'SALES_RETURN'
    | 'OWNER_CONTRIBUTION'
    | 'OTHER';
  refId?: string;
  status?: TransactionStatus;
  cancelReason?: string;
  cancelledAt?: string;
  attachments?: BillAttachment[];
  createdAt: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  details: string;
  entityType: 'CUSTOMER' | 'SUPPLIER' | 'SALE' | 'EXPENSE' | 'STOCK' | 'SETTINGS';
  entityId?: string;
  user?: string;
}

export interface AlertNotification {
  id: string;
  type: 'OVERDUE_CREDIT' | 'LOW_STOCK' | 'APPROACHING_REORDER' | 'SUPPLIER_DUE' | 'NEGATIVE_CASH' | 'LARGE_EXPENSE';
  title: string;
  message: string;
  severity: 'HIGH' | 'MEDIUM' | 'INFO';
  date: string;
  read: boolean;
  actionUrl?: string;
  customerId?: string;
}

export type DateFilterRange =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'CUSTOM';
export interface AppBackupSummary {
  totalTransactions: number;
  salesCount: number;
  salesTotalVolume: number;
  customerTransactionsCount: number;
  supplierTransactionsCount: number;
  expenseCount: number;
  expenseTotalVolume: number;
  cashbookCount: number;
  customersCount: number;
  suppliersCount: number;
  productsCount: number;
  billDocumentsCount?: number;
  openingBalances?: {
    totalCustomerOpening: number;
    totalSupplierOpening: number;
    cashOpeningBalance: number;
  };
}

export interface AppBackupData {
  appName: string;
  version: string;
  schemaVersion: string;
  schema: string;
  backupDate: string;
  exportedAt: string;
  storeProfile: StoreProfile;
  summary: AppBackupSummary;
  transactions: {
    sales: SaleRecord[];
    customerTransactions: CustomerTransaction[];
    supplierTransactions: SupplierTransaction[];
    expenses: ExpenseRecord[];
    cashbookEntries: CashbookEntry[];
  };
  masterData: {
    customers: Customer[];
    suppliers: Supplier[];
    products: Product[];
  };
  auditTrail: AuditLog[];
  // Top-level aliases for legacy compatibility
  profile?: StoreProfile;
  customers?: Customer[];
  customerTransactions?: CustomerTransaction[];
  suppliers?: Supplier[];
  supplierTransactions?: SupplierTransaction[];
  sales?: SaleRecord[];
  expenses?: ExpenseRecord[];
  cashbookEntries?: CashbookEntry[];
  products?: Product[];
  auditLogs?: AuditLog[];
  billDocuments?: BillAttachment[];
  stockAdjustments?: StockAdjustmentRecord[];
  productCategories?: ProductCategoryConfig[];
  expenseCategories?: ExpenseCategoryConfig[];
  recurringExpenses?: RecurringExpense[];
  dailySalesTarget?: DailySalesTargetConfig | null;
  lastClosedDate?: string | null;
  whatsappBatches?: WhatsAppReminderBatch[];
  whatsappAuditLogs?: WhatsAppAuditLog[];
  recordCounts?: Record<string, number>;
  checksumAlgorithm?: string;
  checksum?: string;
}

export type BatchStatus =
  | 'SCHEDULED'
  | 'PREPARING'
  | 'READY_FOR_REVIEW'
  | 'AWAITING_APPROVAL'
  | 'SENDING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'CANCELLED';

export type ReminderMessageStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'EXCLUDED'
  | 'SENDING'
  | 'ACCEPTED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED';

export interface CustomerInvoiceSummary {
  invoiceId: string;
  invoiceNo: string;
  date: string;
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  itemsSummary?: string;
}

export interface WhatsAppApiResponseSummary {
  httpStatus?: number;
  wabaMessageId?: string;
  messagingProduct?: string;
  recipientWaId?: string;
  errorCode?: number;
  errorSubcode?: number;
  fbtraceId?: string;
  attempts?: number;
  sandboxSimulated?: boolean;
  timestamp: string;
}

export interface CustomerReminderItem {
  customerId: string;
  customerName: string;
  phone: string;
  formattedPhone: string;
  hasValidPhone: boolean;
  hasConsent: boolean;
  eligibilityStatus: 'ELIGIBLE' | 'MISSING_PHONE' | 'NO_CONSENT' | 'ZERO_OUTSTANDING' | 'EXCLUDED';
  invoices: CustomerInvoiceSummary[];
  totalOutstanding: number;
  lastReminderDate?: string;
  messageText: string;
  customizedMessage?: string;
  status: ReminderMessageStatus;
  idempotencyKey: string;
  wabaMessageId?: string;
  errorReason?: string;
  attempts?: number;
  lastAttemptAt?: string;
  apiResponseSummary?: WhatsAppApiResponseSummary;
  approved: boolean;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
}

export interface WhatsAppReminderBatch {
  id: string; // e.g. batch-2026-w46-...
  idempotencyKey: string;
  scheduledExecutionTime: string; // ISO string representing Sunday 12:00 PM IST
  dateWindowStart: string; // 7 days prior at 12:00 PM IST
  dateWindowEnd: string; // Execution time Sunday 12:00 PM IST
  status: BatchStatus;
  totalEligibleCustomers: number;
  totalEligibleInvoices: number;
  totalOutstandingAmount: number;
  customersWithMissingPhone: number;
  customersWithoutConsent: number;
  excludedCustomersCount: number;
  items: CustomerReminderItem[];
  approvedAt?: string;
  approvedBy?: string;
  cancelledAt?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppApiConfig {
  businessAccountId: string;
  phoneNumberId: string;
  accessTokenMasked?: string;
  hasAccessToken: boolean;
  webhookVerifyTokenMasked?: string;
  hasWebhookVerifyToken?: boolean;
  configuredViaEnv?: boolean;
  templateName: string;
  templateLanguage: string;
  templateStatus?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NOT_FOUND' | 'UNKNOWN';
  templateVerifiedAt?: string;
  verifiedBusinessName?: string;
  verifiedDisplayPhone?: string;
  verifiedTestNumber?: string;
  isConfigured: boolean;
  sandboxMode: boolean;
  lastTestedAt?: string;
  testStatus?: 'SUCCESS' | 'FAILED';
  testErrorMessage?: string;
}

export interface WhatsAppAuditLog {
  id: string;
  timestamp: string;
  batchId?: string;
  customerId?: string;
  customerName?: string;
  phone?: string;
  action:
    | 'BATCH_GENERATED'
    | 'BATCH_APPROVED'
    | 'BATCH_CANCELLED'
    | 'MESSAGE_QUEUED'
    | 'MESSAGE_SENT'
    | 'MESSAGE_FAILED'
    | 'TEST_MESSAGE_SENT'
    | 'TEST_MESSAGE_FAILED'
    | 'STATUS_WEBHOOK'
    | 'CONFIG_UPDATED';
  details: string;
  wabaMessageId?: string;
  status?: string;
  performedBy?: string;
}

export type NavTab =
  | 'DASHBOARD'
  | 'BILLS_AUDIT'
  | 'FINANCIAL_OVERVIEW'
  | 'CUSTOMERS'
  | 'SUPPLIERS'
  | 'SALES'
  | 'PURCHASES'
  | 'EXPENSES'
  | 'CASHBOOK'
  | 'INVENTORY'
  | 'DOCUMENTS'
  | 'ANALYTICS'
  | 'REPORTS'
  | 'WHATSAPP_REMINDERS'
  | 'SETTINGS';

export type BackupTriggerType =
  | 'AUTO_INTERVAL'
  | 'AUTO_BATCH'
  | 'MANUAL'
  | 'PRE_RESTORE'
  | 'PRE_MIGRATION';
export type BackupRetentionBucket = 'DAILY' | 'WEEKLY' | 'MANUAL' | 'RECOVERY';

export interface BackupReconciliationCustomerDrift {
  customerId: string;
  customerName: string;
  storedBalance: number;
  recalculatedBalance: number;
  difference: number;
  openingBalance: number;
  transactionsCount: number;
}

export interface BackupReconciliationSupplierDrift {
  supplierId: string;
  supplierName: string;
  storedBalance: number;
  recalculatedBalance: number;
  difference: number;
  openingBalance: number;
  transactionsCount: number;
}

export interface BackupReconciliationIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
}

export interface BackupReconciliationReport {
  reconciledAt: string;
  hasDiscrepancies: boolean;
  hasCriticalIssues: boolean;
  customerSummary: {
    totalCustomers: number;
    storedTotalOutstanding: number;
    recalculatedTotalOutstanding: number;
    netDelta: number;
    driftedCustomers: BackupReconciliationCustomerDrift[];
    orphanedTransactionsCount: number;
    creditSalesMissingCustomerCount: number;
  };
  supplierSummary: {
    totalSuppliers: number;
    storedTotalPayable: number;
    recalculatedTotalPayable: number;
    netDelta: number;
    driftedSuppliers: BackupReconciliationSupplierDrift[];
    orphanedTransactionsCount: number;
  };
  cashbookSummary: {
    entriesCount: number;
    openingEntriesCount: number;
    openingBalance: number;
    totalInflowsExcludingOpening: number;
    totalOutflows: number;
    closingBalance: number;
    negativeCashBalance: boolean;
    cashSalesMissingCashbookCount: number;
  };
  inventorySummary: {
    productsCount: number;
    negativeStockProductsCount: number;
    orphanedAdjustmentsCount: number;
    attachmentsTotalCount: number;
    missingAttachmentDataCount: number;
  };
  issues: BackupReconciliationIssue[];
}

export interface LocalBackupSnapshot {
  id: string;
  createdAt: string;
  dateKey: string; // YYYY-MM-DD
  weekKey: string; // YYYY-Www
  trigger: BackupTriggerType;
  bucket: BackupRetentionBucket;
  reason?: string;
  schemaVersion: string;
  checksum: string;
  sizeBytes: number;
  status: 'SUCCESS' | 'FAILED';
  summary: AppBackupSummary;
  payloadJson: string;
}

export interface AutoBackupSettings {
  enabled: boolean;
  intervalMinutes: number; // default 30 while active
  backupAfterImportantBatch: boolean;
  dailyRetentionCount: number; // default 7
  weeklyRetentionCount: number; // default 4
  lastAutoBackupAt?: string;
}

export type StorageMode = 'LOCAL_ONLY' | 'CLOUD_SYNC_ENABLED';

export type SyncRecordStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface CloudAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

export interface SyncQueueItem {
  id: string;
  idempotencyKey: string;
  entityType:
    | 'PROFILE'
    | 'SETTINGS'
    | 'CUSTOMER'
    | 'CUSTOMER_TX'
    | 'SUPPLIER'
    | 'SUPPLIER_TX'
    | 'SALE'
    | 'EXPENSE'
    | 'CASHBOOK'
    | 'PRODUCT'
    | 'STOCK_ADJUSTMENT'
    | 'WHATSAPP_BATCH'
    | 'BACKUP_META';
  entityId: string;
  operation: 'UPSERT' | 'DELETE';
  status: SyncRecordStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  localUpdatedAt: string;
  createdAt: string;
  syncedAt?: string;
  payloadHash: string;
}

export interface SyncConflictRecord {
  id: string;
  entityType: SyncQueueItem['entityType'];
  entityId: string;
  entityLabel: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localSnapshot: Record<string, unknown>;
  remoteSnapshot: Record<string, unknown>;
  detectedAt: string;
  resolved: boolean;
  resolution?: 'KEEP_LOCAL' | 'KEEP_REMOTE';
  resolvedAt?: string;
}

export interface StorageStatusSummary {
  storageMode: StorageMode;
  cloudSyncConfigured?: boolean;
  firebaseProjectId?: string;
  cloudUserEmail?: string | null;
  isOnline: boolean;
  isPersistedStorage: boolean;
  usageBytes: number;
  quotaBytes: number;
  usagePct?: number;
  quotaWarning?: boolean;
  storageError?: string | null;
  billDocumentsCount?: number;
  legacyArchivePresent?: boolean;
  dbName: string;
  dbVersion: number;
  migratedFromLocalStorage: boolean;
  migratedAt?: string;
  lastBackupAt?: string;
  lastBackupStatus?: 'SUCCESS' | 'FAILED';
  lastSyncAt?: string;
  pendingSyncCount: number;
  failedSyncCount: number;
  conflictCount: number;
}

export type FirestoreSyncState =
  | 'IDLE'
  | 'SYNCING'
  | 'SYNCED'
  | 'NEEDS_VERIFICATION'
  | 'ERROR';

export interface FirestoreSyncedCounts {
  customers: number;
  customerTransactions: number;
  suppliers: number;
  supplierTransactions: number;
  sales: number;
  expenses: number;
  cashbookEntries: number;
  products: number;
}

export interface FirestoreSyncStatus {
  enabled: boolean;
  projectId: string;
  state: FirestoreSyncState;
  lastSyncedAt?: string | null;
  lastPulledAt?: string | null;
  lastError?: string | null;
  permissionDenied?: boolean;
  syncedCounts?: FirestoreSyncedCounts | null;
}

export interface StoreBusinessDataset {
  profile: StoreProfile;
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  cashbookEntries: CashbookEntry[];
  products: Product[];
  productCategories?: ProductCategoryConfig[];
  expenseCategories?: ExpenseCategoryConfig[];
  stockAdjustments: StockAdjustmentRecord[];
  auditLogs: AuditLog[];
  whatsappBatches: WhatsAppReminderBatch[];
  whatsappAuditLogs: WhatsAppAuditLog[];
  billDocuments?: BillAttachment[];
  recurringExpenses?: RecurringExpense[];
  dailySalesTarget?: DailySalesTargetConfig | null;
  lastClosedDate?: string | null;
}

export interface CustomerReminderHistoryEntry {
  id: string;
  batchId: string;
  sentAt: string;
  status: ReminderMessageStatus | 'TEST_SENT';
  outstandingAtTime: number;
  invoicesCount: number;
  invoiceNumbers: string[];
  messageText: string;
  wabaMessageId?: string;
  errorReason?: string;
  sandboxSimulated?: boolean;
}

export type CloudBackupBucket = 'daily' | 'weekly' | 'manual' | 'pre-restore';

export interface CloudPassphraseVerifier {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  hashBase64: string;
  updatedAt: string;
}

export interface CloudBackupConfig {
  autoDailyEnabled: boolean;
  dailyRetentionCount: number; // default 7
  weeklyRetentionCount: number; // default 4
  manualRetentionCount: number; // default 5
  boundOwnerUid?: string;
  boundOwnerEmail?: string | null;
  passphraseVerifier?: CloudPassphraseVerifier | null;
  passphraseConfiguredAt?: string;
}

export type CloudBackupRunState =
  | 'IDLE'
  | 'UPLOADING'
  | 'RESTORING'
  | 'ERROR'
  | 'OFFLINE_DEFERRED';

export interface CloudBackupStatus {
  state: CloudBackupRunState;
  lastAttemptAt?: string;
  lastAttemptDateKeyIst?: string;
  lastSuccessAt?: string;
  lastSuccessDateKeyIst?: string;
  lastSuccessBucket?: CloudBackupBucket;
  lastUploadedPath?: string;
  lastUploadedBytes?: number;
  lastUploadedChecksum?: string;
  lastUploadedFileName?: string;
  verificationStatus?: 'COMPLETE' | 'VERIFIED' | 'FAILED';
  verifiedAt?: string;
  pendingDailyBackupIst?: boolean;
  lastError?: string | null;
}

export interface CloudBackupRemoteEntry {
  fullPath: string;
  name: string;
  bucket: CloudBackupBucket;
  dateKey: string;
  createdAt: string;
  sizeBytes: number;
  ciphertextSha256?: string;
  format?: string;
  schemaVersion?: string;
}

export type ReportsTab = 'BUSINESS' | 'STOCK_MOVEMENT' | 'RECONCILIATION';

export type ReconciliationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type ReconciliationSectionId =
  | 'CUSTOMERS'
  | 'SUPPLIERS'
  | 'CASHBOOK'
  | 'INVENTORY'
  | 'PROFIT_COGS'
  | 'INTEGRITY';

export interface ReconciliationFinding {
  id: string;
  code: string;
  section: ReconciliationSectionId;
  severity: ReconciliationSeverity;
  title: string;
  description: string;
  affectedCount?: number;
  financialImpact?: number;
  entityIds?: string[];
}

export interface AccountingReconciliationReport {
  generatedAt: string;
  hasCriticalIssues: boolean;
  hasWarnings: boolean;
  isFullyReconciled: boolean;
  countsBySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
  customerAudit: {
    totalCustomers: number;
    storedReceivables: number;
    recalculatedReceivables: number;
    netDelta: number;
    driftedCount: number;
    openingStoredAsCreditCount: number;
    creditSalesMissingLedgerCount: number;
    orphanedTxCount: number;
  };
  supplierAudit: {
    totalSuppliers: number;
    storedPayables: number;
    recalculatedPayables: number;
    netDelta: number;
    driftedCount: number;
    legacyPartialWithoutPaidAmountCount: number;
    openingStoredAsPurchaseCount: number;
    orphanedTxCount: number;
  };
  cashbookAudit: {
    totalEntries: number;
    activeEntries: number;
    cancelledEntries: number;
    closingCash: number;
    negativeCashDaysCount: number;
    cashSalesMissingCashbookCount: number;
    cashPaymentsMissingCashbookCount: number;
    upfrontCashPurchasesMissingCashbookCount: number;
    orphanedExpenseCashbookCount: number;
    dateMismatchCount: number;
  };
  inventoryAudit: {
    activeProductsCount: number;
    catalogCostValuation: number;
    historicalWeightedValuation: number;
    valuationDifference: number;
    negativeStockCount: number;
    zeroCostSoldProductsCount: number;
    stockAdjustmentDivergenceCount: number;
    orphanedAdjustmentsCount: number;
  };
  profitAudit: {
    activeSalesCount: number;
    cancelledSalesCount: number;
    grossSalesRevenue: number;
    salesReturnsAmount: number;
    netSalesRevenue: number;
    knownCogs: number;
    costedRevenue: number;
    uncostedRevenue: number;
    uncostedItemsCount: number;
    missingHistoricalCostCount?: number;
    missingHistoricalCostRevenue?: number;
    uncostedSaleIds?: string[];
    uncostedReturnsCount?: number;
    uncostedReturnsAmount?: number;
    uncostedReturnIds?: string[];
    unreconstructibleUnitItemsCount?: number;
    unreconstructibleUnitItemIds?: string[];
    ambiguousReturnsCount?: number;
    ambiguousReturnIds?: string[];
    skippedIncompatibleStockReturnsCount?: number;
    reviewStatus?: 'RECONCILED' | 'UNCOSTED' | 'NEEDS_REVIEW';
    costCoveragePct: number;
  };
  integrityAudit: {
    duplicateIdsCount: number;
    duplicateIdDetails: string[];
  };
  findings: ReconciliationFinding[];
}
