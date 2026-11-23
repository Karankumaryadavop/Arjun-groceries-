import {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  CustomerTransactionType,
  PaymentMethod,
  Product,
  PurchaseReturnReason,
  SaleItem,
  SaleRecord,
  StoreBusinessDataset,
  Supplier,
  SupplierTransaction,
  SupplierTransactionType,
  BillAttachment,
} from '../types';
import {
  calculateCustomerLedgerWithRunningBalance,
  calculateSupplierLedgerWithRunningBalance,
  getLocalTodayKey,
  isCashbookEntryActive,
  isSaleActive,
  resolveSupplierPurchaseUpfrontPaid,
  toLocalDateTimeIso,
  toLocalDayKey,
} from './accounting';
import {
  applyPurchaseReturnStockDecrease,
  applyPurchaseStockIncrease,
  applySaleStockDeduction,
  applySalesReturnStockIncrease,
  buildSnapshottedSaleItems,
  enrichCustomerReturnItemsWithSaleCost,
  ReturnStockItemInput,
  validateCustomerReturnAgainstSale,
} from './inventoryEngine';
import {
  buildPurchaseReturnItemsSummary,
  generateCreditNoteNumber,
  getPurchaseReturnReasonLabel,
  normalizePurchaseReturnItems,
  PurchaseReturnLineInput,
  validatePurchaseReturnStockAvailability,
} from './purchaseReturns';
import {
  buildCustomerLoyaltyLedger,
  calculateLoyaltyRedemption,
  calculatePointsEarned,
  resolveLoyaltyConfig,
} from './loyalty';
import { LocalDbAdapter } from './localDatabase';

export interface AtomicAuditDescriptor {
  action: string;
  details: string;
  entityType: 'CUSTOMER' | 'SUPPLIER' | 'SALE' | 'EXPENSE' | 'STOCK' | 'SETTINGS';
  entityId?: string;
}

export interface AtomicTransitionResult<Extra extends Record<string, unknown> = Record<string, never>> {
  success: boolean;
  error?: string;
  duplicate?: boolean;
  nextDataset?: StoreBusinessDataset;
  auditEvent?: AtomicAuditDescriptor;
  extra?: Extra;
}

function buildRandomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

function appendAuditEntry(
  dataset: StoreBusinessDataset,
  auditEvent?: AtomicAuditDescriptor
): StoreBusinessDataset {
  if (!auditEvent) return dataset;
  const nowIso = new Date().toISOString();
  return {
    ...dataset,
    auditLogs: [
      {
        id: buildRandomId('aud'),
        timestamp: nowIso,
        action: auditEvent.action,
        details: auditEvent.details,
        entityType: auditEvent.entityType,
        entityId: auditEvent.entityId,
      },
      ...dataset.auditLogs,
    ],
  };
}

export function prepareAtomicCustomerTransaction(
  dataset: StoreBusinessDataset,
  tx: {
    customerId: string;
    type: CustomerTransactionType;
    amount: number;
    date?: string;
    description: string;
    invoiceNo?: string;
    paymentMethod?: 'CASH' | 'UPI' | 'BANK';
    attachments?: BillAttachment[];
    idempotencyKey?: string;
    productId?: string;
    quantity?: number;
    unit?: string;
    saleLineId?: string;
    items?: ReturnStockItemInput[];
  }
): AtomicTransitionResult<{ transactionId: string }> {
  const cust = dataset.customers.find((c) => c.id === tx.customerId);
  if (!cust) {
    return { success: false, error: 'Please select a valid customer.' };
  }

  if (tx.idempotencyKey) {
    const existing = dataset.customerTransactions.find(
      (t) => t.idempotencyKey === tx.idempotencyKey
    );
    if (existing) {
      return {
        success: false,
        duplicate: true,
        error: 'Duplicate customer transaction prevented.',
        extra: { transactionId: existing.id },
      };
    }
  }

  const amt = Number(tx.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { success: false, error: 'Transaction amount must be greater than zero.' };
  }

  const txId = buildRandomId('ctx');
  const nowIso = toLocalDateTimeIso(tx.date);

  const rawReturnItems: ReturnStockItemInput[] =
    tx.items && tx.items.length > 0
      ? tx.items.map((it) => ({
          ...it,
          ...(it.saleLineId ? {} : tx.saleLineId ? { saleLineId: tx.saleLineId } : {}),
        }))
      : tx.productId && tx.quantity && tx.quantity > 0
      ? [
          {
            productId: tx.productId,
            productName:
              dataset.products.find((p) => p.id === tx.productId)?.name || 'Returned Item',
            quantity: tx.quantity,
            unit: tx.unit,
            ...(tx.saleLineId ? { saleLineId: tx.saleLineId } : {}),
          },
        ]
      : [];

  const returnValidation =
    tx.type === 'RETURN'
      ? validateCustomerReturnAgainstSale({
          sales: dataset.sales,
          customerTransactions: dataset.customerTransactions,
          products: dataset.products,
          invoiceNo: tx.invoiceNo,
          items: rawReturnItems,
        })
      : { valid: true as const };

  if (!returnValidation.valid) {
    return {
      success: false,
      error: returnValidation.error || 'Customer return validation failed.',
    };
  }

  const returnItems =
    tx.type === 'RETURN' && rawReturnItems.length > 0
      ? enrichCustomerReturnItemsWithSaleCost({
          items: rawReturnItems,
          sales: dataset.sales,
          products: dataset.products,
          invoiceNo: tx.invoiceNo,
        })
      : rawReturnItems;

  let nextProducts = dataset.products;
  let nextStockAdjustments = dataset.stockAdjustments;
  let skippedIncompatibleItems:
    | Array<{
        productId: string;
        productName: string;
        historicalUnit: string;
        historicalQuantity: number;
        catalogUnit: string;
        saleLineId?: string;
      }>
    | undefined;

  if (tx.type === 'RETURN' && returnItems.length > 0) {
    const stockRes = applySalesReturnStockIncrease({
      products: dataset.products,
      stockAdjustments: dataset.stockAdjustments,
      items: returnItems,
      customerName: cust.name,
      invoiceNo: tx.invoiceNo,
      referenceId: txId,
      date: nowIso,
      reason: tx.description,
      idempotencyKey: tx.idempotencyKey,
    });

    if (!stockRes.success) {
      return {
        success: false,
        duplicate: stockRes.duplicate,
        error: stockRes.error,
      };
    }

    nextProducts = stockRes.products;
    nextStockAdjustments = stockRes.stockAdjustments;
    skippedIncompatibleItems = stockRes.skippedIncompatibleItems;
  }

  const hasAmbiguousItem = returnItems.some(
    (it) =>
      it.returnMatchStatus === 'AMBIGUOUS_SALE_LINE' ||
      it.returnMatchStatus === 'UNMATCHED_SALE_LINE' ||
      it.returnMatchStatus === 'CANCELLED_ORIGINAL_SALE'
  );
  const topReturnMatchStatus =
    tx.type === 'RETURN'
      ? returnValidation.needsManualReview || hasAmbiguousItem
        ? returnValidation.returnMatchStatus ||
          returnItems.find((it) => it.returnMatchStatus && it.returnMatchStatus !== 'MATCHED_LINE')
            ?.returnMatchStatus ||
          'AMBIGUOUS_SALE_LINE'
        : returnItems[0]?.returnMatchStatus || returnValidation.returnMatchStatus
      : undefined;

  const isSkippedItem = (it: ReturnStockItemInput) =>
    Boolean(
      skippedIncompatibleItems?.some(
        (sk) =>
          sk.productId === it.productId &&
          (!sk.saleLineId || !it.saleLineId || sk.saleLineId === it.saleLineId)
      )
    );

  const newTx: CustomerTransaction = {
    id: txId,
    customerId: tx.customerId,
    type: tx.type,
    amount: amt,
    date: nowIso,
    description: tx.description,
    invoiceNo: tx.invoiceNo,
    paymentMethod: tx.paymentMethod || 'CASH',
    status: 'COMPLETED',
    attachments: tx.attachments || [],
    idempotencyKey: tx.idempotencyKey,
    productId: tx.productId,
    quantity: tx.quantity,
    unit: tx.unit,
    ...(tx.saleLineId || (returnItems.length === 1 && returnItems[0].saleLineId)
      ? { saleLineId: tx.saleLineId || returnItems[0].saleLineId }
      : {}),
    ...(tx.type === 'RETURN' && (returnValidation.needsManualReview || hasAmbiguousItem)
      ? {
          needsManualReview: true,
          returnMatchStatus: topReturnMatchStatus,
          ...(returnValidation.reviewReason
            ? { returnReviewReason: returnValidation.reviewReason }
            : {}),
        }
      : topReturnMatchStatus
      ? { returnMatchStatus: topReturnMatchStatus }
      : {}),
    items:
      returnItems.length > 0
        ? returnItems.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            quantity: it.quantity,
            unit: it.unit || '',
            baseUnit: it.baseUnit,
            baseQuantity: it.baseQuantity,
            ...(it.saleLineId ? { saleLineId: it.saleLineId } : {}),
            ...(it.returnMatchStatus ? { returnMatchStatus: it.returnMatchStatus } : {}),
            ...(tx.type === 'RETURN' && it.productId
              ? {
                  stockReconciliationStatus: isSkippedItem(it)
                    ? ('SKIPPED_INCOMPATIBLE_UNIT' as const)
                    : ('APPLIED' as const),
                }
              : {}),
            ...(it.unitCostAtSale !== undefined ? { unitCostAtSale: it.unitCostAtSale } : {}),
          }))
        : undefined,
    createdAt: nowIso,
  };

  const nextTxList = [newTx, ...dataset.customerTransactions];
  const summary = calculateCustomerLedgerWithRunningBalance(cust, nextTxList);

  const nextCustomers: Customer[] = dataset.customers.map((c) =>
    c.id === tx.customerId
      ? {
          ...c,
          currentBalance: summary.closingBalance,
          totalCreditGiven: summary.totalCreditGiven,
          totalPaymentReceived: summary.totalPaymentReceived,
          lastTransactionDate: nowIso,
          overdueDays: summary.closingBalance <= 0 ? 0 : c.overdueDays,
        }
      : c
  );

  let nextCashbook = dataset.cashbookEntries;
  if (tx.type === 'PAYMENT' && tx.paymentMethod === 'CASH') {
    const dayKey = toLocalDayKey(tx.date || nowIso) || getLocalTodayKey();
    const cbEntry: CashbookEntry = {
      id: buildRandomId('cb'),
      date: dayKey,
      type: 'IN',
      category: 'CUSTOMER_PAYMENT',
      description: `Cash received from ${cust.name} (Khata Payment)`,
      amount: amt,
      paymentMode: 'CASH',
      refType: 'CUSTOMER_PAYMENT',
      refId: txId,
      status: 'COMPLETED',
      attachments: [],
      createdAt: nowIso,
    };
    nextCashbook = [cbEntry, ...nextCashbook];
  }

  const auditNotes: string[] = [];
  if (returnValidation.needsManualReview) {
    auditNotes.push('Flagged for manual review (ambiguous sale line match)');
  }
  if (skippedIncompatibleItems && skippedIncompatibleItems.length > 0) {
    auditNotes.push(
      `Stock skipped for ${skippedIncompatibleItems.length} item(s) due to incompatible catalog unit`
    );
  }

  const auditEvent: AtomicAuditDescriptor = {
    action:
      tx.type === 'CREDIT'
        ? 'CREDIT_GIVEN'
        : tx.type === 'RETURN'
        ? 'SALES_RETURN'
        : 'PAYMENT_RECEIVED',
    details: `${
      tx.type === 'CREDIT'
        ? 'Credit given to'
        : tx.type === 'RETURN'
        ? 'Sales return from'
        : 'Payment received from'
    } ${cust.name}: Rs.${amt}. New balance: Rs.${summary.closingBalance}${
      auditNotes.length > 0 ? ` [${auditNotes.join('; ')}]` : ''
    }`,
    entityType: 'CUSTOMER',
    entityId: cust.id,
  };

  const nextDataset = appendAuditEntry(
    {
      ...dataset,
      products: nextProducts,
      stockAdjustments: nextStockAdjustments,
      customers: nextCustomers,
      customerTransactions: nextTxList,
      cashbookEntries: nextCashbook,
    },
    auditEvent
  );

  return {
    success: true,
    nextDataset,
    auditEvent,
    extra: { transactionId: txId },
  };
}

export function prepareAtomicSale(
  dataset: StoreBusinessDataset,
  data: {
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
  }
): AtomicTransitionResult<{
  saleId: string;
  invoiceNo: string;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyDiscountAmount?: number;
}> {
  if (data.idempotencyKey) {
    const existingSale = dataset.sales.find((s) => s.idempotencyKey === data.idempotencyKey);
    if (existingSale) {
      return {
        success: false,
        duplicate: true,
        error: `Duplicate sale prevented: bill #${existingSale.invoiceNo} was already recorded.`,
        extra: { saleId: existingSale.id, invoiceNo: existingSale.invoiceNo },
      };
    }
  }

  const rawInputAmount = Number(data.amount) || 0;
  const rawGrossAmount =
    data.grossAmount !== undefined && Number.isFinite(Number(data.grossAmount))
      ? Number(data.grossAmount)
      : rawInputAmount;

  if (!Number.isFinite(rawGrossAmount) || rawGrossAmount <= 0) {
    return { success: false, error: 'Sale amount must be greater than zero.' };
  }

  const isCredit = data.paymentMethod === 'CREDIT' || !!data.isCredit;
  const matchedCustomer = data.customerId
    ? dataset.customers.find((c) => c.id === data.customerId)
    : undefined;

  if (isCredit) {
    if (!data.customerId) {
      return { success: false, error: 'Please select a valid customer for Credit (Udhar) sale.' };
    }
    if (!matchedCustomer) {
      return { success: false, error: 'Selected customer for Credit (Udhar) sale was not found.' };
    }
  }

  // Loyalty points redemption & earning calculation
  const loyaltyConfig = resolveLoyaltyConfig(dataset.profile);
  const requestedRedeemPoints = Math.max(0, Math.floor(Number(data.loyaltyPointsRedeemed) || 0));
  let loyaltyPointsRedeemed = 0;
  let loyaltyDiscountAmount = 0;
  let amt = Math.round(rawGrossAmount * 100) / 100;

  if (requestedRedeemPoints > 0) {
    if (!matchedCustomer) {
      return {
        success: false,
        error: 'Select a registered customer to redeem loyalty points.',
      };
    }
    const custLedger = buildCustomerLoyaltyLedger(
      matchedCustomer,
      dataset.sales,
      loyaltyConfig
    );
    const redemption = calculateLoyaltyRedemption({
      availablePoints: custLedger.availablePoints,
      requestedPoints: requestedRedeemPoints,
      grossBillAmount: rawGrossAmount,
      config: loyaltyConfig,
    });
    if (!redemption.valid) {
      return {
        success: false,
        error: redemption.error || 'Unable to apply loyalty points redemption.',
      };
    }
    loyaltyPointsRedeemed = redemption.pointsToRedeem;
    loyaltyDiscountAmount = redemption.discountAmount;
    amt = redemption.netPayableAmount;
  }

  if (!Number.isFinite(amt) || amt <= 0) {
    return { success: false, error: 'Sale amount must be greater than zero.' };
  }

  const loyaltyPointsEarned =
    matchedCustomer && loyaltyConfig.enabled
      ? calculatePointsEarned(amt, loyaltyConfig)
      : 0;

  const nowIso = toLocalDateTimeIso(data.date);
  const saleId = buildRandomId('sale');
  const invoiceNo = `BILL-${Math.floor(1000 + Math.random() * 9000)}`;
  const saleItems = buildSnapshottedSaleItems(data.items || [], dataset.products, nowIso);

  let nextProducts = dataset.products;
  let nextStockAdjustments = dataset.stockAdjustments;

  if (saleItems.length > 0) {
    const stockRes = applySaleStockDeduction({
      products: dataset.products,
      stockAdjustments: dataset.stockAdjustments,
      items: saleItems,
      saleId,
      invoiceNo,
      date: nowIso,
      allowNegativeStock: Boolean(dataset.profile.allowNegativeStock),
      idempotencyKey: data.idempotencyKey,
    });

    if (!stockRes.success) {
      return {
        success: false,
        duplicate: stockRes.duplicate,
        error: stockRes.error,
      };
    }

    nextProducts = stockRes.products;
    nextStockAdjustments = stockRes.stockAdjustments;
  }

  const newSale: SaleRecord = {
    id: saleId,
    invoiceNo,
    date: nowIso,
    customerId: data.customerId,
    customerName: data.customerName,
    ...(loyaltyDiscountAmount > 0 ? { grossAmount: Math.round(rawGrossAmount * 100) / 100 } : {}),
    amount: amt,
    ...(loyaltyPointsEarned > 0 ? { loyaltyPointsEarned } : {}),
    ...(loyaltyPointsRedeemed > 0 ? { loyaltyPointsRedeemed } : {}),
    ...(loyaltyDiscountAmount > 0 ? { loyaltyDiscountAmount } : {}),
    paymentMethod: data.paymentMethod,
    items: saleItems,
    notes: data.notes,
    isCredit,
    status: 'COMPLETED',
    attachments: data.attachments || [],
    idempotencyKey: data.idempotencyKey,
    createdAt: nowIso,
  };

  const nextSalesList = [newSale, ...dataset.sales];

  // Refresh cached customer loyalty totals atomically when customer is linked
  let nextCustomersForLoyalty = dataset.customers;
  if (matchedCustomer && (loyaltyPointsEarned > 0 || loyaltyPointsRedeemed > 0)) {
    const updatedLoyalty = buildCustomerLoyaltyLedger(
      matchedCustomer,
      nextSalesList,
      loyaltyConfig
    );
    nextCustomersForLoyalty = dataset.customers.map((c) =>
      c.id === matchedCustomer.id
        ? {
            ...c,
            loyaltyPointsBalance: updatedLoyalty.availablePoints,
            totalLoyaltyPointsEarned: updatedLoyalty.totalEarned,
            totalLoyaltyPointsRedeemed: updatedLoyalty.totalRedeemed,
          }
        : c
    );
  }

  let workingDataset: StoreBusinessDataset = {
    ...dataset,
    products: nextProducts,
    stockAdjustments: nextStockAdjustments,
    customers: nextCustomersForLoyalty,
    sales: nextSalesList,
  };

  if (data.paymentMethod === 'CASH') {
    const dayKey = toLocalDayKey(data.date || nowIso) || getLocalTodayKey();
    const cbEntry: CashbookEntry = {
      id: buildRandomId('cb'),
      date: dayKey,
      type: 'IN',
      category: 'SALE',
      description: `Counter Cash Sale #${invoiceNo}`,
      amount: amt,
      paymentMode: 'CASH',
      refType: 'SALE',
      refId: saleId,
      status: 'COMPLETED',
      attachments: data.attachments || [],
      createdAt: nowIso,
    };
    workingDataset = {
      ...workingDataset,
      cashbookEntries: [cbEntry, ...workingDataset.cashbookEntries],
    };
  }

  if (isCredit && data.customerId) {
    const creditRes = prepareAtomicCustomerTransaction(workingDataset, {
      customerId: data.customerId,
      type: 'CREDIT',
      amount: amt,
      date: nowIso,
      description: `Credit Sale #${invoiceNo} (${saleItems.length ? `${saleItems.length} items` : 'Ration'})`,
      invoiceNo,
      attachments: data.attachments,
      idempotencyKey: data.idempotencyKey ? `${data.idempotencyKey}:credit` : undefined,
    });
    if (!creditRes.success || !creditRes.nextDataset) {
      return {
        success: false,
        duplicate: creditRes.duplicate,
        error: creditRes.error || 'Failed to record linked credit ledger entry.',
      };
    }
    workingDataset = creditRes.nextDataset;
  }

  const loyaltyNote =
    loyaltyPointsRedeemed > 0 || loyaltyPointsEarned > 0
      ? ` [Loyalty: ${loyaltyPointsRedeemed > 0 ? `-${loyaltyPointsRedeemed} pts (₹${loyaltyDiscountAmount} off)` : ''}${
          loyaltyPointsRedeemed > 0 && loyaltyPointsEarned > 0 ? ', ' : ''
        }${loyaltyPointsEarned > 0 ? `+${loyaltyPointsEarned} pts earned` : ''}]`
      : '';

  const auditEvent: AtomicAuditDescriptor = {
    action: 'SALE_COMPLETED',
    details: `Sale #${invoiceNo} recorded: ₹${amt} via ${data.paymentMethod}${loyaltyNote}`,
    entityType: 'SALE',
    entityId: saleId,
  };

  return {
    success: true,
    nextDataset: appendAuditEntry(workingDataset, auditEvent),
    auditEvent,
    extra: {
      saleId,
      invoiceNo,
      loyaltyPointsEarned,
      loyaltyPointsRedeemed,
      loyaltyDiscountAmount,
    },
  };
}

export function prepareAtomicSupplierTransaction(
  dataset: StoreBusinessDataset,
  tx: {
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
  }
): AtomicTransitionResult<{ transactionId: string }> {
  const sup = dataset.suppliers.find((s) => s.id === tx.supplierId);
  if (!sup) {
    return { success: false, error: 'Please select a valid supplier.' };
  }

  if (tx.idempotencyKey) {
    const existing = dataset.supplierTransactions.find(
      (t) => t.idempotencyKey === tx.idempotencyKey
    );
    if (existing) {
      return {
        success: false,
        duplicate: true,
        error: 'Duplicate supplier transaction prevented.',
        extra: { transactionId: existing.id },
      };
    }
  }

  const amt = Number(tx.amount) || 0;
  if (!Number.isFinite(amt) || amt <= 0) {
    return { success: false, error: 'Transaction amount must be greater than zero.' };
  }

  const nowIso = toLocalDateTimeIso(tx.date);
  const txId = buildRandomId('stx');

  const effectivePaymentStatus =
    tx.paymentStatus || (tx.type === 'PURCHASE' ? 'UNPAID' : 'PAID');
  let explicitPaidAmount: number | undefined = undefined;
  if (tx.type === 'PURCHASE') {
    if (tx.paidAmount !== undefined && Number.isFinite(Number(tx.paidAmount))) {
      explicitPaidAmount =
        Math.round(Math.min(amt, Math.max(0, Number(tx.paidAmount))) * 100) / 100;
    } else if (effectivePaymentStatus === 'PAID') {
      explicitPaidAmount = amt;
    } else if (effectivePaymentStatus === 'UNPAID') {
      explicitPaidAmount = 0;
    }
  }

  let nextProducts = dataset.products;
  let nextStockAdjustments = dataset.stockAdjustments;

  if (tx.type === 'RETURN' && tx.productId && tx.quantity && tx.quantity > 0) {
    const stockRes = applyPurchaseReturnStockDecrease({
      products: dataset.products,
      stockAdjustments: dataset.stockAdjustments,
      productId: tx.productId,
      quantity: tx.quantity,
      unit: tx.unit,
      supplierName: sup.name,
      invoiceNo: tx.invoiceNo,
      referenceId: txId,
      date: nowIso,
      reason: tx.description,
      allowNegativeStock: Boolean(dataset.profile.allowNegativeStock),
      idempotencyKey: tx.idempotencyKey,
    });

    if (!stockRes.success) {
      return {
        success: false,
        duplicate: stockRes.duplicate,
        error: stockRes.error,
      };
    }

    nextProducts = stockRes.products;
    nextStockAdjustments = stockRes.stockAdjustments;
  }

  const newTx: SupplierTransaction = {
    id: txId,
    supplierId: tx.supplierId,
    type: tx.type,
    amount: amt,
    paidAmount: explicitPaidAmount,
    date: nowIso,
    paymentStatus: effectivePaymentStatus,
    paymentMethod: tx.paymentMethod || 'CASH',
    status: 'COMPLETED',
    description: tx.description,
    invoiceNo: tx.invoiceNo,
    itemsSummary: tx.itemsSummary,
    productId: tx.productId,
    quantity: tx.quantity,
    unit: tx.unit,
    unitPrice: tx.unitPrice,
    attachments: tx.attachments || [],
    idempotencyKey: tx.idempotencyKey,
    createdAt: nowIso,
  };

  const nextTxList = [newTx, ...dataset.supplierTransactions];
  const summary = calculateSupplierLedgerWithRunningBalance(sup, nextTxList);

  const nextSuppliers: Supplier[] = dataset.suppliers.map((s) =>
    s.id === tx.supplierId
      ? {
          ...s,
          currentBalance: summary.closingBalance,
          totalPurchases: summary.totalPurchases,
          totalPaid: summary.totalPaid,
          lastTransactionDate: nowIso,
        }
      : s
  );

  let nextCashbook = dataset.cashbookEntries;
  const dayKey = toLocalDayKey(tx.date || nowIso) || getLocalTodayKey();
  if (tx.type === 'PAYMENT' && tx.paymentMethod === 'CASH') {
    const cbEntry: CashbookEntry = {
      id: buildRandomId('cb'),
      date: dayKey,
      type: 'OUT',
      category: 'SUPPLIER_PAYMENT',
      description: `Cash paid to supplier ${sup.name}`,
      amount: amt,
      paymentMode: 'CASH',
      refType: 'SUPPLIER_PAYMENT',
      refId: txId,
      status: 'COMPLETED',
      attachments: [],
      createdAt: nowIso,
    };
    nextCashbook = [cbEntry, ...nextCashbook];
  } else if (tx.type === 'PURCHASE' && newTx.paymentMethod === 'CASH') {
    const upfrontCash = resolveSupplierPurchaseUpfrontPaid(newTx);
    if (upfrontCash > 0) {
      const cbEntry: CashbookEntry = {
        id: buildRandomId('cb'),
        date: dayKey,
        type: 'OUT',
        category: 'PURCHASE',
        description: `Cash purchase (${sup.name})${tx.invoiceNo ? ` #${tx.invoiceNo}` : ''}`,
        amount: upfrontCash,
        paymentMode: 'CASH',
        refType: 'PURCHASE',
        refId: txId,
        status: 'COMPLETED',
        attachments: tx.attachments || [],
        createdAt: nowIso,
      };
      nextCashbook = [cbEntry, ...nextCashbook];
    }
  }

  const auditEvent: AtomicAuditDescriptor = {
    action:
      tx.type === 'PURCHASE'
        ? 'PURCHASE_RECORDED'
        : tx.type === 'RETURN'
        ? 'PURCHASE_RETURN'
        : 'SUPPLIER_PAYMENT',
    details: `${
      tx.type === 'PURCHASE'
        ? 'Purchase invoice from'
        : tx.type === 'RETURN'
        ? 'Purchase return to'
        : 'Payment made to'
    } ${sup.name}: Rs.${amt}. Updated payable: Rs.${summary.closingBalance}`,
    entityType: 'SUPPLIER',
    entityId: sup.id,
  };

  return {
    success: true,
    nextDataset: appendAuditEntry(
      {
        ...dataset,
        products: nextProducts,
        stockAdjustments: nextStockAdjustments,
        suppliers: nextSuppliers,
        supplierTransactions: nextTxList,
        cashbookEntries: nextCashbook,
      },
      auditEvent
    ),
    auditEvent,
    extra: { transactionId: txId },
  };
}

export function prepareAtomicProductPurchase(
  dataset: StoreBusinessDataset,
  data: {
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
  }
): AtomicTransitionResult<{ transactionId: string }> {
  const sup = dataset.suppliers.find((s) => s.id === data.supplierId);
  if (!sup) {
    return { success: false, error: 'Please select a valid supplier.' };
  }
  const prod = dataset.products.find((p) => p.id === data.productId);
  if (!prod) {
    return { success: false, error: 'Selected product was not found in inventory.' };
  }

  if (data.idempotencyKey) {
    const existingTx = dataset.supplierTransactions.find(
      (t) => t.idempotencyKey === data.idempotencyKey
    );
    if (existingTx) {
      return {
        success: false,
        duplicate: true,
        error: 'Duplicate purchase prevented: this bill was already recorded.',
        extra: { transactionId: existingTx.id },
      };
    }
  }

  const qty = Number(data.quantity);
  const unitPrice = Number(data.unitPurchasePrice);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { success: false, error: 'Quantity must be greater than zero.' };
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { success: false, error: 'Purchase price cannot be negative.' };
  }

  const totalAmount = Math.round(qty * unitPrice * 100) / 100;
  if (totalAmount <= 0) {
    return { success: false, error: 'Total purchase amount must be greater than zero.' };
  }

  if (
    data.paymentStatus === 'PARTIAL' &&
    data.paidAmount !== undefined &&
    (Number(data.paidAmount) < 0 || Number(data.paidAmount) > totalAmount)
  ) {
    return {
      success: false,
      error: `Partial paid amount must be between ₹0 and ₹${totalAmount.toLocaleString('en-IN')}.`,
    };
  }

  const effectiveUnit = data.unit || prod.unit;
  const nowDateStr = toLocalDayKey(data.date) || getLocalTodayKey();
  const nowIso = toLocalDateTimeIso(data.date);
  const desc =
    data.notes?.trim() ||
    `Stock purchase: ${qty} ${effectiveUnit} ${prod.name} @ Rs.${unitPrice}/${effectiveUnit}`;

  const purchaseTxRes = prepareAtomicSupplierTransaction(dataset, {
    supplierId: sup.id,
    type: 'PURCHASE',
    amount: totalAmount,
    paidAmount: data.paidAmount,
    date: nowIso,
    paymentStatus: data.paymentStatus,
    paymentMethod: data.paymentMethod || 'BANK',
    invoiceNo: data.invoiceNo?.trim() || undefined,
    description: desc,
    itemsSummary: `${qty} ${effectiveUnit} ${prod.name}`,
    productId: prod.id,
    quantity: qty,
    unit: effectiveUnit,
    unitPrice,
    attachments: data.attachments,
    idempotencyKey: data.idempotencyKey,
  });

  if (!purchaseTxRes.success || !purchaseTxRes.nextDataset || !purchaseTxRes.extra?.transactionId) {
    return {
      success: false,
      duplicate: purchaseTxRes.duplicate,
      error: purchaseTxRes.error || 'Could not record purchase bill.',
    };
  }

  const stockRes = applyPurchaseStockIncrease({
    products: purchaseTxRes.nextDataset.products,
    stockAdjustments: purchaseTxRes.nextDataset.stockAdjustments,
    productId: prod.id,
    quantity: qty,
    unit: effectiveUnit,
    unitPrice,
    supplierName: sup.name,
    invoiceNo: data.invoiceNo,
    referenceId: purchaseTxRes.extra.transactionId,
    date: nowDateStr,
    preferredSupplierPatch: data.setAsPreferredSupplier
      ? {
          preferredSupplierId: sup.id,
          preferredSupplierName: sup.name,
          preferredSupplierPhone: sup.phone,
        }
      : undefined,
    idempotencyKey: data.idempotencyKey,
  });

  if (!stockRes.success) {
    return {
      success: false,
      duplicate: stockRes.duplicate,
      error: stockRes.error,
    };
  }

  const auditEvent: AtomicAuditDescriptor = {
    action: 'STOCK_PURCHASE_RESTOCK',
    details: `Restocked ${qty} ${effectiveUnit} of ${prod.name} from ${sup.name} @ Rs.${unitPrice} (Total Rs.${totalAmount})`,
    entityType: 'STOCK',
    entityId: prod.id,
  };

  return {
    success: true,
    nextDataset: appendAuditEntry(
      {
        ...purchaseTxRes.nextDataset,
        products: stockRes.products,
        stockAdjustments: stockRes.stockAdjustments,
      },
      auditEvent
    ),
    auditEvent,
    extra: { transactionId: purchaseTxRes.extra.transactionId },
  };
}

/**
 * Atomically records a multi-item Purchase Return to a supplier with:
 * - Auto-generated Credit Note number (CN-YYYY-NNNN)
 * - Automated inventory stock deductions + PURCHASE_RETURN adjustment audit records
 * - Supplier payable ledger credit adjustment (or Cashbook IN for cash refunds)
 */
export function prepareAtomicPurchaseReturn(
  dataset: StoreBusinessDataset,
  data: {
    supplierId: string;
    items: PurchaseReturnLineInput[];
    reason: PurchaseReturnReason;
    originalInvoiceNo?: string;
    originalPurchaseId?: string;
    creditNoteNo?: string;
    settlementMode?: 'ADJUST_PAYABLE' | 'CASH_REFUND' | 'BANK_REFUND';
    date?: string;
    notes?: string;
    attachments?: BillAttachment[];
    idempotencyKey?: string;
  }
): AtomicTransitionResult<{ transactionId: string; creditNoteNo: string }> {
  const sup = dataset.suppliers.find((s) => s.id === data.supplierId);
  if (!sup) {
    return { success: false, error: 'Please select a valid supplier.' };
  }

  if (data.idempotencyKey) {
    const existing = dataset.supplierTransactions.find(
      (t) => t.idempotencyKey === data.idempotencyKey
    );
    if (existing) {
      return {
        success: false,
        duplicate: true,
        error: `Duplicate purchase return prevented: Credit Note ${existing.creditNoteNo || existing.invoiceNo || existing.id} already recorded.`,
        extra: {
          transactionId: existing.id,
          creditNoteNo: existing.creditNoteNo || existing.invoiceNo || existing.id,
        },
      };
    }
  }

  const normalized = normalizePurchaseReturnItems(data.items, dataset.products, data.reason);
  if (!normalized.valid || normalized.totalAmount <= 0) {
    return {
      success: false,
      error: normalized.error || 'Please add valid returned items.',
    };
  }

  const stockCheck = validatePurchaseReturnStockAvailability({
    items: normalized.items,
    products: dataset.products,
    allowNegativeStock: Boolean(dataset.profile.allowNegativeStock),
  });
  if (!stockCheck.valid) {
    return {
      success: false,
      error: stockCheck.error || 'Insufficient inventory stock for purchase return.',
    };
  }

  const nowIso = toLocalDateTimeIso(data.date);
  const dayKey = toLocalDayKey(data.date || nowIso) || getLocalTodayKey();
  const txId = buildRandomId('prtn');
  const creditNoteNo =
    data.creditNoteNo?.trim() || generateCreditNoteNumber(dataset.supplierTransactions, nowIso);
  const settlementMode = data.settlementMode || 'ADJUST_PAYABLE';
  const reasonLabel = getPurchaseReturnReasonLabel(data.reason);

  let nextProducts = dataset.products;
  let nextStockAdjustments = dataset.stockAdjustments;

  for (let idx = 0; idx < normalized.items.length; idx++) {
    const item = normalized.items[idx];
    if (!item.productId) continue;
    const stockRes = applyPurchaseReturnStockDecrease({
      products: nextProducts,
      stockAdjustments: nextStockAdjustments,
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      supplierName: sup.name,
      invoiceNo: creditNoteNo,
      referenceId: txId,
      date: nowIso,
      reason: `Purchase Return (${reasonLabel}) · Credit Note ${creditNoteNo}${
        data.originalInvoiceNo ? ` (Orig Bill #${data.originalInvoiceNo})` : ''
      }`,
      allowNegativeStock: Boolean(dataset.profile.allowNegativeStock),
      idempotencyKey: data.idempotencyKey ? `${data.idempotencyKey}:item:${idx}` : undefined,
    });
    if (!stockRes.success) {
      return {
        success: false,
        duplicate: stockRes.duplicate,
        error: stockRes.error || `Could not deduct stock for ${item.productName}.`,
      };
    }
    nextProducts = stockRes.products;
    nextStockAdjustments = stockRes.stockAdjustments;
  }

  const itemsSummary = buildPurchaseReturnItemsSummary(normalized.items);
  const firstItem = normalized.items[0];
  const description =
    data.notes?.trim() ||
    `Purchase Return (${reasonLabel}): ${itemsSummary}${
      data.originalInvoiceNo ? ` [Orig #${data.originalInvoiceNo}]` : ''
    }`;

  const newTx: SupplierTransaction = {
    id: txId,
    supplierId: sup.id,
    type: 'RETURN',
    amount: normalized.totalAmount,
    date: nowIso,
    invoiceNo: creditNoteNo,
    creditNoteNo,
    originalInvoiceNo: data.originalInvoiceNo?.trim() || undefined,
    originalPurchaseId: data.originalPurchaseId || undefined,
    returnReason: data.reason,
    returnItems: normalized.items,
    settlementMode,
    paymentStatus: 'PAID',
    paymentMethod:
      settlementMode === 'CASH_REFUND'
        ? 'CASH'
        : settlementMode === 'BANK_REFUND'
        ? 'BANK'
        : 'BANK',
    status: 'COMPLETED',
    description,
    itemsSummary,
    productId: normalized.items.length === 1 ? firstItem.productId : undefined,
    quantity: normalized.items.length === 1 ? firstItem.quantity : undefined,
    unit: normalized.items.length === 1 ? firstItem.unit : undefined,
    unitPrice: normalized.items.length === 1 ? firstItem.unitPrice : undefined,
    attachments: data.attachments || [],
    idempotencyKey: data.idempotencyKey,
    createdAt: nowIso,
  };

  const nextTxList = [newTx, ...dataset.supplierTransactions];
  const summary = calculateSupplierLedgerWithRunningBalance(sup, nextTxList);

  const nextSuppliers: Supplier[] = dataset.suppliers.map((s) =>
    s.id === sup.id
      ? {
          ...s,
          currentBalance: summary.closingBalance,
          totalPurchases: summary.totalPurchases,
          totalPaid: summary.totalPaid,
          lastTransactionDate: nowIso,
        }
      : s
  );

  let nextCashbook = dataset.cashbookEntries;
  if (settlementMode === 'CASH_REFUND') {
    const cbEntry: CashbookEntry = {
      id: buildRandomId('cb'),
      date: dayKey,
      type: 'IN',
      category: 'PURCHASE_RETURN',
      description: `Cash refund from ${sup.name} (${creditNoteNo})`,
      amount: normalized.totalAmount,
      paymentMode: 'CASH',
      refType: 'PURCHASE',
      refId: txId,
      status: 'COMPLETED',
      attachments: data.attachments || [],
      createdAt: nowIso,
    };
    nextCashbook = [cbEntry, ...nextCashbook];
  }

  const auditEvent: AtomicAuditDescriptor = {
    action: 'PURCHASE_RETURN',
    details: `Credit Note ${creditNoteNo} issued to ${sup.name} (${reasonLabel}): Rs.${normalized.totalAmount} for ${itemsSummary}. Updated payable: Rs.${summary.closingBalance}`,
    entityType: 'SUPPLIER',
    entityId: sup.id,
  };

  return {
    success: true,
    nextDataset: appendAuditEntry(
      {
        ...dataset,
        products: nextProducts,
        stockAdjustments: nextStockAdjustments,
        suppliers: nextSuppliers,
        supplierTransactions: nextTxList,
        cashbookEntries: nextCashbook,
      },
      auditEvent
    ),
    auditEvent,
    extra: { transactionId: txId, creditNoteNo },
  };
}

export function prepareAtomicCancelSale(
  dataset: StoreBusinessDataset,
  saleId: string,
  reason: string
): AtomicTransitionResult {
  const targetSale = dataset.sales.find((s) => s.id === saleId);
  if (!targetSale || !isSaleActive(targetSale)) {
    return { success: false, error: 'Sale record not found or already cancelled.' };
  }

  const cancelDate = new Date().toISOString();
  const cleanReason = reason.trim() || 'Cancelled by store';

  const existingProdIds = new Set(dataset.products.map((p) => p.id));
  const returnItems: ReturnStockItemInput[] = (targetSale.items || [])
    .filter((it) => Boolean(it.productId) && existingProdIds.has(it.productId!))
    .map((it) => ({
      productId: it.productId!,
      productName: it.productName,
      quantity: Number(it.quantity) || 0,
      unit: it.unit,
      baseUnit: it.baseUnit,
      baseQuantity: it.baseQuantity,
      ...(it.lineId ? { saleLineId: it.lineId } : {}),
    }))
    .filter((it) => it.quantity > 0);

  let nextProducts = dataset.products;
  let nextStockAdjustments = dataset.stockAdjustments;

  if (returnItems.length > 0) {
    const stockRes = applySalesReturnStockIncrease({
      products: dataset.products,
      stockAdjustments: dataset.stockAdjustments,
      items: returnItems,
      customerName: targetSale.customerName || 'Cancelled Bill',
      invoiceNo: targetSale.invoiceNo,
      referenceId: saleId,
      date: cancelDate,
      reason: `Cancelled Bill #${targetSale.invoiceNo}: ${cleanReason}`,
      idempotencyKey: `cancel-sale-${saleId}`,
    });
    if (!stockRes.success) {
      return { success: false, error: stockRes.error || 'Could not restore sale stock.' };
    }
    nextProducts = stockRes.products;
    nextStockAdjustments = stockRes.stockAdjustments;
  }

  const nextSales = dataset.sales.map((s) =>
    s.id === saleId
      ? {
          ...s,
          status: 'CANCELLED' as const,
          cancelReason: cleanReason,
          cancelledAt: cancelDate,
        }
      : s
  );

  const nextCashbook = dataset.cashbookEntries.map((cb) =>
    cb.refType === 'SALE' && cb.refId === saleId && isCashbookEntryActive(cb)
      ? {
          ...cb,
          status: 'CANCELLED' as const,
          cancelReason: `Bill #${targetSale.invoiceNo} cancelled: ${cleanReason}`,
          cancelledAt: cancelDate,
        }
      : cb
  );

  let nextCustTxs = dataset.customerTransactions;
  let nextCustomers = dataset.customers;
  if ((targetSale.isCredit || targetSale.paymentMethod === 'CREDIT') && targetSale.customerId) {
    const matchedTx = nextCustTxs.find(
      (tx) =>
        tx.customerId === targetSale.customerId &&
        tx.type === 'CREDIT' &&
        tx.status !== 'CANCELLED' &&
        tx.status !== 'REVERSED' &&
        ((targetSale.invoiceNo && tx.invoiceNo === targetSale.invoiceNo) ||
          (Math.abs((Number(tx.amount) || 0) - (Number(targetSale.amount) || 0)) < 0.01 &&
            toLocalDayKey(tx.date || tx.createdAt) ===
              toLocalDayKey(targetSale.date || targetSale.createdAt)))
    );

    if (matchedTx) {
      nextCustTxs = nextCustTxs.map((tx) =>
        tx.id === matchedTx.id
          ? {
              ...tx,
              status: 'CANCELLED' as const,
              cancelReason: `Bill #${targetSale.invoiceNo} cancelled: ${cleanReason}`,
              cancelledAt: cancelDate,
            }
          : tx
      );
      const cust = nextCustomers.find((c) => c.id === targetSale.customerId);
      if (cust) {
        const summary = calculateCustomerLedgerWithRunningBalance(cust, nextCustTxs);
        nextCustomers = nextCustomers.map((c) =>
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
      }
    }
  }

  // Refresh customer cached loyalty balances whenever a customer-linked sale is cancelled
  if (targetSale.customerId) {
    const targetCust = nextCustomers.find((c) => c.id === targetSale.customerId);
    if (targetCust) {
      const loyaltyCfg = resolveLoyaltyConfig(dataset.profile);
      const updatedLoyalty = buildCustomerLoyaltyLedger(targetCust, nextSales, loyaltyCfg);
      nextCustomers = nextCustomers.map((c) =>
        c.id === targetCust.id
          ? {
              ...c,
              loyaltyPointsBalance: updatedLoyalty.availablePoints,
              totalLoyaltyPointsEarned: updatedLoyalty.totalEarned,
              totalLoyaltyPointsRedeemed: updatedLoyalty.totalRedeemed,
            }
          : c
      );
    }
  }

  const auditEvent: AtomicAuditDescriptor = {
    action: 'CANCEL_SALE',
    details: `Cancelled Bill #${targetSale.invoiceNo} (₹${targetSale.amount} ${targetSale.paymentMethod}). Reason: ${cleanReason}`,
    entityType: 'SALE',
    entityId: saleId,
  };

  return {
    success: true,
    nextDataset: appendAuditEntry(
      {
        ...dataset,
        products: nextProducts,
        stockAdjustments: nextStockAdjustments,
        sales: nextSales,
        cashbookEntries: nextCashbook,
        customerTransactions: nextCustTxs,
        customers: nextCustomers,
      },
      auditEvent
    ),
    auditEvent,
  };
}

export function prepareAtomicCancelSupplierTransaction(
  dataset: StoreBusinessDataset,
  txId: string,
  reason: string
): AtomicTransitionResult {
  const targetTx = dataset.supplierTransactions.find((t) => t.id === txId);
  if (!targetTx || targetTx.status === 'CANCELLED' || targetTx.status === 'REVERSED') {
    return { success: false, error: 'Supplier transaction not found or already cancelled.' };
  }
  const sup = dataset.suppliers.find((s) => s.id === targetTx.supplierId);
  if (!sup) {
    return { success: false, error: 'Supplier not found.' };
  }

  const cancelDayKey = getLocalTodayKey();
  const cancelDate = toLocalDateTimeIso();

  let nextProducts = dataset.products;
  let nextStockAdjustments = dataset.stockAdjustments;
  if (
    targetTx.type === 'PURCHASE' &&
    targetTx.productId &&
    targetTx.quantity &&
    targetTx.quantity > 0
  ) {
    const prodExists = nextProducts.some((p) => p.id === targetTx.productId);
    if (prodExists) {
      const stockRes = applyPurchaseReturnStockDecrease({
        products: nextProducts,
        stockAdjustments: nextStockAdjustments,
        productId: targetTx.productId,
        quantity: targetTx.quantity,
        unit: targetTx.unit,
        supplierName: sup.name,
        reason: `Cancelled purchase bill${targetTx.invoiceNo ? ` #${targetTx.invoiceNo}` : ''}: ${reason}`,
        referenceId: txId,
        date: cancelDayKey,
        allowNegativeStock: Boolean(dataset.profile.allowNegativeStock),
      });
      if (!stockRes.success) {
        return { success: false, error: stockRes.error };
      }
      nextProducts = stockRes.products;
      nextStockAdjustments = stockRes.stockAdjustments;
    }
  } else if (targetTx.type === 'RETURN') {
    // Restore inventory stock deducted when this purchase return was originally recorded
    const itemsToRestore: Array<{
      productId: string;
      quantity: number;
      unit?: string;
      unitPrice: number;
    }> =
      targetTx.returnItems && targetTx.returnItems.length > 0
        ? targetTx.returnItems
            .filter((it) => Boolean(it.productId) && it.quantity > 0)
            .map((it) => ({
              productId: it.productId!,
              quantity: it.quantity,
              unit: it.unit,
              unitPrice: it.unitPrice,
            }))
        : targetTx.productId && targetTx.quantity && targetTx.quantity > 0
        ? [
            {
              productId: targetTx.productId,
              quantity: targetTx.quantity,
              unit: targetTx.unit,
              unitPrice: targetTx.unitPrice || 0,
            },
          ]
        : [];

    for (let idx = 0; idx < itemsToRestore.length; idx++) {
      const it = itemsToRestore[idx];
      const prod = nextProducts.find((p) => p.id === it.productId);
      if (!prod) continue;
      const restoreRes = applyPurchaseStockIncrease({
        products: nextProducts,
        stockAdjustments: nextStockAdjustments,
        productId: prod.id,
        quantity: it.quantity,
        unit: it.unit || prod.unit,
        unitPrice: prod.purchasePrice,
        supplierName: sup.name,
        invoiceNo: targetTx.creditNoteNo || targetTx.invoiceNo,
        referenceId: txId,
        date: cancelDayKey,
        idempotencyKey: `cancel-prtn-${txId}-${idx}`,
      });
      if (restoreRes.success) {
        nextProducts = restoreRes.products;
        nextStockAdjustments = restoreRes.stockAdjustments;
      }
    }
  }

  const updatedTxList = dataset.supplierTransactions.map((t) =>
    t.id === txId
      ? {
          ...t,
          status: 'CANCELLED' as const,
          cancelReason: reason,
          cancelledAt: cancelDate,
        }
      : t
  );

  const summary = calculateSupplierLedgerWithRunningBalance(sup, updatedTxList);
  const nextSuppliers = dataset.suppliers.map((s) =>
    s.id === sup.id
      ? {
          ...s,
          currentBalance: summary.closingBalance,
          totalPurchases: summary.totalPurchases,
          totalPaid: summary.totalPaid,
          lastTransactionDate: summary.lastTransactionDate || s.createdAt,
        }
      : s
  );

  const nextCashbook = dataset.cashbookEntries.map((cb) =>
    cb.refId === txId &&
    (cb.refType === 'SUPPLIER_PAYMENT' || cb.refType === 'PURCHASE') &&
    isCashbookEntryActive(cb)
      ? {
          ...cb,
          status: 'CANCELLED' as const,
          cancelReason: `Supplier tx cancelled: ${reason}`,
          cancelledAt: cancelDate,
        }
      : cb
  );

  const auditEvent: AtomicAuditDescriptor = {
    action: 'CANCEL_TRANSACTION',
    details: `Cancelled supplier transaction ${txId} (${targetTx.type} Rs.${targetTx.amount}) for ${sup.name}. Reason: ${reason}. Updated payable: Rs.${summary.closingBalance}`,
    entityType: 'SUPPLIER',
    entityId: sup.id,
  };

  return {
    success: true,
    nextDataset: appendAuditEntry(
      {
        ...dataset,
        products: nextProducts,
        stockAdjustments: nextStockAdjustments,
        suppliers: nextSuppliers,
        supplierTransactions: updatedTxList,
        cashbookEntries: nextCashbook,
      },
      auditEvent
    ),
    auditEvent,
  };
}

/**
 * Executes an atomic transition against a LocalDbAdapter so persistence failures
 * cannot leave partial business records committed in storage.
 */
export async function commitAtomicTransitionWithDb<Extra extends Record<string, unknown>>(
  db: LocalDbAdapter,
  transition: AtomicTransitionResult<Extra>
): Promise<{
  success: boolean;
  error?: string;
  duplicate?: boolean;
  dataset?: StoreBusinessDataset;
  extra?: Extra;
}> {
  if (!transition.success || !transition.nextDataset) {
    return {
      success: false,
      duplicate: transition.duplicate,
      error: transition.error || 'Transaction failed validation.',
      extra: transition.extra,
    };
  }
  try {
    await db.commitBusinessDatasetAtomic(transition.nextDataset);
    return {
      success: true,
      dataset: transition.nextDataset,
      extra: transition.extra,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Atomic database commit failed.',
    };
  }
}
