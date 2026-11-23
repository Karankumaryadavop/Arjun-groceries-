/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Customer,
  CustomerInvoiceSummary,
  CustomerReminderItem,
  CustomerTransaction,
  SaleRecord,
  StoreProfile,
  WhatsAppReminderBatch,
} from '../types';
import { renderWhatsAppTemplateMessage } from './whatsappTemplate';

/**
 * Normalizes and validates mobile phone numbers for WhatsApp Business Cloud API.
 * - Enforces 10-digit Indian mobile standard starting with 6, 7, 8, 9 (normalized to 91XXXXXXXXXX).
 * - Also accepts explicit international E.164 numbers starting with '+' and valid country code (8-15 digits).
 */
export function formatWhatsAppPhoneNumber(phone: string | undefined | null): {
  isValid: boolean;
  raw: string;
  cleaned: string;
  formattedE164: string;
  error?: string;
} {
  const raw = phone ? String(phone).trim() : '';
  if (!raw) {
    return {
      isValid: false,
      raw: '',
      cleaned: '',
      formattedE164: '',
      error: 'Phone number is missing',
    };
  }

  // Remove spaces, hyphens, parentheses, plus signs
  let digits = raw.replace(/\D/g, '');

  // Explicit international number with '+' and non-India country code
  const hasExplicitPlus = raw.startsWith('+');
  if (hasExplicitPlus && !digits.startsWith('91') && !digits.startsWith('0')) {
    const isValidInternational = /^[1-9]\d{7,14}$/.test(digits);
    if (!isValidInternational) {
      return {
        isValid: false,
        raw,
        cleaned: digits,
        formattedE164: '',
        error: 'Invalid international E.164 phone number (expected 8-15 digits)',
      };
    }
    return {
      isValid: true,
      raw,
      cleaned: digits,
      formattedE164: digits,
    };
  }

  // Strip leading 0 if 11 digits
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Strip leading 91 if 12 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }

  // Enforce standard Indian 10-digit mobile number starting with 6, 7, 8, or 9
  const isIndianMobile = /^[6-9]\d{9}$/.test(digits);

  if (!isIndianMobile) {
    return {
      isValid: false,
      raw,
      cleaned: digits,
      formattedE164: digits ? `91${digits}` : '',
      error: 'Invalid phone: Indian mobile numbers must be 10 digits starting with 6-9 (or use +countrycode)',
    };
  }

  return {
    isValid: true,
    raw,
    cleaned: digits,
    formattedE164: `91${digits}`,
  };
}

/**
 * Calculates the weekly Sunday 12:00 PM Asia/Kolkata (IST) schedule execution time and the preceding
 * 7-day window (seven consecutive 24-hour periods immediately before 12:00 PM IST).
 *
 * IST is exactly UTC + 05:30 (+330 minutes).
 */
export function getWeeklyISTWindow(
  referenceDate: Date = new Date(),
  targetExecution: 'UPCOMING_SUNDAY' | 'PAST_SUNDAY' = 'UPCOMING_SUNDAY'
): {
  scheduledExecution: Date;
  scheduledExecutionISO: string;
  windowStart: Date;
  windowStartISO: string;
  windowEnd: Date;
  windowEndISO: string;
  nextScheduledExecution: Date;
  nextScheduledExecutionISO: string;
  weekId: string;
} {
  // Convert referenceDate to IST timestamp
  const utcTime = referenceDate.getTime();
  const istOffsetMs = 5.5 * 60 * 60 * 1000; // 5 hours 30 mins
  const istTime = new Date(utcTime + istOffsetMs);

  const istDay = istTime.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const istHours = istTime.getUTCHours();
  const istMinutes = istTime.getUTCMinutes();

  let daysDeltaToSunday = 0;

  if (targetExecution === 'UPCOMING_SUNDAY') {
    // Determine upcoming or current Sunday 12:00 PM IST
    if (istDay === 0) {
      // It's Sunday. If past 12:00 PM IST, next execution is next Sunday (+7 days)
      if (istHours > 12 || (istHours === 12 && istMinutes > 0)) {
        daysDeltaToSunday = 0; // The active batch for today Sunday 12:00 PM
      } else {
        daysDeltaToSunday = 0; // Today Sunday at 12:00 PM
      }
    } else {
      // Monday through Saturday: target the upcoming Sunday
      daysDeltaToSunday = 7 - istDay;
    }
  } else {
    // Past Sunday 12:00 PM IST
    let daysBack = istDay;
    if (istDay === 0 && (istHours < 12 || (istHours === 12 && istMinutes === 0))) {
      daysBack = 7;
    }
    daysDeltaToSunday = -daysBack;
  }

  const targetYear = istTime.getUTCFullYear();
  const targetMonth = istTime.getUTCMonth();
  const targetDate = istTime.getUTCDate() + daysDeltaToSunday;

  // Construct Sunday 12:00:00.000 in IST, then convert back to UTC
  // 12:00:00 IST is 06:30:00 UTC
  const executionInIST = new Date(Date.UTC(targetYear, targetMonth, targetDate, 6, 30, 0, 0));

  // The 7-day window is precisely 7 consecutive 24-hour periods immediately preceding execution
  const windowEnd = new Date(executionInIST.getTime());
  const windowStart = new Date(executionInIST.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Next scheduled Sunday 12:00 PM IST
  const nextScheduledExecution = new Date(executionInIST.getTime());
  if (executionInIST.getTime() <= utcTime) {
    nextScheduledExecution.setTime(nextScheduledExecution.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  // Deterministic week identifier (e.g. 2026-W46)
  const d = new Date(executionInIST);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const weekId = `${executionInIST.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

  return {
    scheduledExecution: executionInIST,
    scheduledExecutionISO: executionInIST.toISOString(),
    windowStart,
    windowStartISO: windowStart.toISOString(),
    windowEnd,
    windowEndISO: windowEnd.toISOString(),
    nextScheduledExecution,
    nextScheduledExecutionISO: nextScheduledExecution.toISOString(),
    weekId,
  };
}

function isActiveTx(tx: CustomerTransaction): boolean {
  return tx.status !== 'CANCELLED' && tx.status !== 'REVERSED';
}

function getCreditSettlementAmountForTx(tx: CustomerTransaction): number {
  if (!isActiveTx(tx)) return 0;
  const amt = Number(tx.amount) || 0;
  if (tx.type === 'PAYMENT' || tx.type === 'RETURN') {
    return Math.max(0, amt);
  }
  if (tx.type === 'ADJUSTMENT') {
    // Negative adjustments (credit notes / discounts) reduce customer dues
    return amt < 0 ? Math.abs(amt) : 0;
  }
  return 0;
}

/**
 * Calculates the allocated payments and accurate outstanding balance for a specific invoice.
 *
 * Rules:
 * 1. Cancelled/reversed transactions are ignored.
 * 2. If the customer's total ledger balance (currentBalance) is <= 0, customer has cleared all debts.
 * 3. Direct payments, returns, and credit adjustments matching tx.invoiceNo directly reduce this invoice.
 * 4. If `allCustomerSales` is provided, general unallocated payments/returns/adjustments (without invoiceNo)
 *    are allocated FIFO from oldest invoice to newest invoice.
 * 5. Outstanding invoice balance is always capped at customer's actual current ledger balance.
 */
export function calculateInvoiceOutstanding(
  sale: SaleRecord,
  customer: Customer,
  customerTransactions: CustomerTransaction[],
  allCustomerSales?: SaleRecord[]
): {
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  isFullyPaid: boolean;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
} {
  const original = Math.max(0, Number(sale.amount) || 0);
  const ledgerBalance = Math.max(0, Number(customer.currentBalance) || 0);

  // If customer has settled everything or has advance, outstanding balance is 0
  if (ledgerBalance <= 0 || original <= 0) {
    return {
      originalAmount: original,
      paidAmount: original,
      outstandingAmount: 0,
      isFullyPaid: true,
      status: 'PAID',
    };
  }

  const custTxList = customerTransactions.filter(
    (tx) => tx.customerId === customer.id && isActiveTx(tx)
  );

  // 1. Direct payments / returns / credit-note adjustments tagged to this invoiceNo
  const directSettlements = sale.invoiceNo
    ? custTxList
        .filter((tx) => tx.invoiceNo === sale.invoiceNo)
        .reduce((sum, tx) => sum + getCreditSettlementAmountForTx(tx), 0)
    : 0;

  let remainingOnInvoice = Math.max(0, original - directSettlements);

  // 2. FIFO allocation for unallocated settlements (payments/returns/credit-notes without invoiceNo)
  // when full customer sales history is provided
  if (allCustomerSales && allCustomerSales.length > 0 && remainingOnInvoice > 0) {
    const knownInvoiceNos = new Set(
      allCustomerSales.map((s) => s.invoiceNo).filter(Boolean)
    );
    const unallocatedPoolTotal = custTxList
      .filter((tx) => !tx.invoiceNo || !knownInvoiceNos.has(tx.invoiceNo))
      .reduce((sum, tx) => sum + getCreditSettlementAmountForTx(tx), 0);

    if (unallocatedPoolTotal > 0) {
      const creditSalesSorted = [...allCustomerSales]
        .filter((s) => s.customerId === customer.id && (s.isCredit || s.paymentMethod === 'CREDIT'))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Check how much opening balance existed before credit sales: opening balance sits oldest in FIFO
      const totalCreditSalesSum = creditSalesSorted.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const totalDirectOnSales = custTxList
        .filter((tx) => tx.invoiceNo && knownInvoiceNos.has(tx.invoiceNo))
        .reduce((sum, tx) => sum + getCreditSettlementAmountForTx(tx), 0);

      // Only allocate pool against credit sales if pool exceeds pre-sale opening balance
      const impliedOpening = Math.max(0, Number(customer.openingBalance) || 0);
      let availableForSales = Math.max(0, unallocatedPoolTotal - impliedOpening);

      // However, if totalCreditGiven matches totalCreditSalesSum closely (or no opening balance), check consistency
      if (impliedOpening === 0) {
        availableForSales = unallocatedPoolTotal;
      } else {
        const expectedTotalCredits = impliedOpening + totalCreditSalesSum;
        const actualCredits = Number(customer.totalCreditGiven) || expectedTotalCredits;
        if (actualCredits <= totalCreditSalesSum + 0.01 && totalDirectOnSales >= 0) {
          availableForSales = unallocatedPoolTotal;
        }
      }

      for (const s of creditSalesSorted) {
        const sDirect = s.invoiceNo
          ? custTxList
              .filter((tx) => tx.invoiceNo === s.invoiceNo)
              .reduce((sum, tx) => sum + getCreditSettlementAmountForTx(tx), 0)
          : 0;
        const sAfterDirect = Math.max(0, (Number(s.amount) || 0) - sDirect);
        const fifoApplied = Math.min(sAfterDirect, availableForSales);
        availableForSales = Math.max(0, availableForSales - fifoApplied);

        if (s.id === sale.id) {
          remainingOnInvoice = Math.max(0, sAfterDirect - fifoApplied);
          break;
        }
      }
    }
  }

  // 3. Outstanding cannot exceed customer's overall current ledger balance
  remainingOnInvoice = Math.min(remainingOnInvoice, ledgerBalance);
  remainingOnInvoice = Math.round(remainingOnInvoice * 100) / 100;

  const effectivePaid = Math.max(0, Math.round((original - remainingOnInvoice) * 100) / 100);

  return {
    originalAmount: original,
    paidAmount: effectivePaid,
    outstandingAmount: remainingOnInvoice,
    isFullyPaid: remainingOnInvoice <= 0,
    status: remainingOnInvoice <= 0 ? 'PAID' : remainingOnInvoice < original ? 'PARTIALLY_PAID' : 'UNPAID',
  };
}

/**
 * Filters sales invoices to locate eligible unpaid customer invoices created strictly within
 * the 7-day scheduled window.
 */
export function findEligibleWeeklyInvoices(
  sales: SaleRecord[],
  customers: Customer[],
  customerTransactions: CustomerTransaction[],
  windowStart: Date,
  windowEnd: Date
): {
  eligibleSales: SaleRecord[];
  ineligibleCount: number;
  excludedReasons: Record<string, string>;
} {
  const customerMap = new Map<string, Customer>();
  customers.forEach((c) => customerMap.set(c.id, c));

  const salesByCustomer = new Map<string, SaleRecord[]>();
  sales.forEach((s) => {
    if (!s.customerId) return;
    const arr = salesByCustomer.get(s.customerId) || [];
    arr.push(s);
    salesByCustomer.set(s.customerId, arr);
  });

  const eligibleSales: SaleRecord[] = [];
  const excludedReasons: Record<string, string> = {};
  let ineligibleCount = 0;

  sales.forEach((sale) => {
    const saleDate = new Date(sale.date);

    // 1. Date window check: [windowStart, windowEnd)
    if (saleDate < windowStart || saleDate >= windowEnd) {
      return; // Outside window, silently skip
    }

    // 2. Must be associated with a valid customer
    if (!sale.customerId) {
      ineligibleCount++;
      excludedReasons[sale.id] = 'Counter sale without customer record';
      return;
    }

    const customer = customerMap.get(sale.customerId);
    if (!customer) {
      ineligibleCount++;
      excludedReasons[sale.id] = `Customer ${sale.customerId} not found`;
      return;
    }

    // 3. Must be a credit sale or have an unpaid credit balance
    if (!sale.isCredit && sale.paymentMethod !== 'CREDIT') {
      ineligibleCount++;
      excludedReasons[sale.id] = 'Cash/UPI paid bill at counter (Not Udhar)';
      return;
    }

    // 4. Calculate accurate outstanding balance with FIFO unallocated payment & return awareness
    const custSales = salesByCustomer.get(customer.id) || [];
    const balanceInfo = calculateInvoiceOutstanding(sale, customer, customerTransactions, custSales);
    if (balanceInfo.outstandingAmount <= 0 || balanceInfo.isFullyPaid) {
      ineligibleCount++;
      excludedReasons[sale.id] = 'Fully paid / settled in Khata';
      return;
    }

    eligibleSales.push(sale);
  });

  return {
    eligibleSales,
    ineligibleCount,
    excludedReasons,
  };
}

/**
 * Formats standard Hindi & English reminder text with dynamic variables for WhatsApp message preview.
 */
export function generateReminderMessageText(
  customerName: string,
  storeProfile: StoreProfile,
  totalOutstanding: number,
  invoices: CustomerInvoiceSummary[]
): string {
  if (storeProfile.whatsappTemplateConfig?.bodyTemplate?.trim()) {
    return renderWhatsAppTemplateMessage(storeProfile.whatsappTemplateConfig, {
      customerName,
      storeProfile,
      totalOutstanding,
      invoices,
    });
  }

  const storeName = storeProfile.storeName || 'Arjun Groceries';
  const upiId = storeProfile.upiId || '';

  const invoiceSummaryLines = invoices
    .map(
      (inv) =>
        `• ${inv.invoiceNo} (${new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}): ₹${inv.outstandingAmount.toLocaleString('en-IN')}`
    )
    .join('\n');

  return (
    `Namaste ${customerName} ji,\n\n` +
    `Aapke ${storeName} account mein pichhle hafte ke bills ka kul ₹${totalOutstanding.toLocaleString('en-IN')} payment pending hai.\n\n` +
    `Pending Bill Details:\n` +
    `${invoiceSummaryLines}\n\n` +
    `Kripya apni suvidha ke anusaar payment kar dein${upiId ? ` via UPI: ${upiId}` : ''} ya dukan par aakar jama karayein.\n\n` +
    `Dhanyavaad!\n` +
    `${storeName}`
  );
}

/**
 * Groups eligible invoices by customer and produces customer-level reminder items.
 * Enforces consent checks, phone number validation, duplicate idempotency key generation, and single-reminder grouping.
 */
export function groupInvoicesByCustomer(
  eligibleSales: SaleRecord[],
  customers: Customer[],
  customerTransactions: CustomerTransaction[],
  storeProfile: StoreProfile,
  windowStartISO: string,
  windowEndISO: string,
  storeId: string = 'store-1',
  allSales?: SaleRecord[]
): {
  customerItems: CustomerReminderItem[];
  totalEligibleCustomers: number;
  totalEligibleInvoices: number;
  totalOutstandingAmount: number;
  customersWithMissingPhone: number;
  customersWithoutConsent: number;
} {
  const customerMap = new Map<string, Customer>();
  customers.forEach((c) => customerMap.set(c.id, c));

  // Group sales by customerId
  const salesByCustomer = new Map<string, SaleRecord[]>();
  eligibleSales.forEach((sale) => {
    if (!sale.customerId) return;
    const existing = salesByCustomer.get(sale.customerId) || [];
    existing.push(sale);
    salesByCustomer.set(sale.customerId, existing);
  });

  const allSalesByCustomer = new Map<string, SaleRecord[]>();
  (allSales || eligibleSales).forEach((sale) => {
    if (!sale.customerId) return;
    const existing = allSalesByCustomer.get(sale.customerId) || [];
    existing.push(sale);
    allSalesByCustomer.set(sale.customerId, existing);
  });

  const customerItems: CustomerReminderItem[] = [];
  let totalEligibleInvoices = 0;
  let totalOutstandingAmount = 0;
  let customersWithMissingPhone = 0;
  let customersWithoutConsent = 0;

  salesByCustomer.forEach((salesList, customerId) => {
    const customer = customerMap.get(customerId);
    if (!customer) return;

    // Validate phone number
    const phoneCheck = formatWhatsAppPhoneNumber(customer.phone);
    // Check consent: default to true unless explicitly false
    const hasConsent = customer.whatsappConsent !== false;

    // Calculate invoice summaries (and cap combined total at actual Khata currentBalance)
    const invoices: CustomerInvoiceSummary[] = [];
    let customerTotalOutstanding = 0;
    const customerFullSales = allSalesByCustomer.get(customerId) || salesList;

    salesList.forEach((sale) => {
      const balance = calculateInvoiceOutstanding(sale, customer, customerTransactions, customerFullSales);
      if (balance.outstandingAmount > 0) {
        invoices.push({
          invoiceId: sale.id,
          invoiceNo: sale.invoiceNo,
          date: sale.date,
          originalAmount: balance.originalAmount,
          paidAmount: balance.paidAmount,
          outstandingAmount: balance.outstandingAmount,
          itemsSummary: sale.items?.map((it) => it.productName).join(', ') || undefined,
        });
        customerTotalOutstanding += balance.outstandingAmount;
        totalEligibleInvoices++;
      }
    });

    customerTotalOutstanding = Math.min(
      Math.round(customerTotalOutstanding * 100) / 100,
      Math.max(0, Number(customer.currentBalance) || 0)
    );

    if (invoices.length === 0 || customerTotalOutstanding <= 0) {
      return;
    }

    // Determine eligibility status
    let eligibilityStatus: CustomerReminderItem['eligibilityStatus'] = 'ELIGIBLE';
    if (!phoneCheck.isValid) {
      eligibilityStatus = 'MISSING_PHONE';
      customersWithMissingPhone++;
    } else if (!hasConsent) {
      eligibilityStatus = 'NO_CONSENT';
      customersWithoutConsent++;
    }

    // Generate deterministic idempotency key for this customer in this batch window
    const invoiceNosSorted = invoices.map((i) => i.invoiceNo).sort().join('_');
    const idempotencyKey = `waba_${storeId}_${windowStartISO.slice(0, 10)}_${customerId}_${invoiceNosSorted}`;

    const messageText = generateReminderMessageText(
      customer.name,
      storeProfile,
      customerTotalOutstanding,
      invoices
    );

    const isEligible = eligibilityStatus === 'ELIGIBLE';
    if (isEligible) {
      totalOutstandingAmount += customerTotalOutstanding;
    }

    customerItems.push({
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      formattedPhone: phoneCheck.formattedE164,
      hasValidPhone: phoneCheck.isValid,
      hasConsent,
      eligibilityStatus,
      invoices,
      totalOutstanding: customerTotalOutstanding,
      lastReminderDate: customer.lastReminderSentAt,
      messageText,
      status: isEligible ? 'PENDING' : 'EXCLUDED',
      idempotencyKey,
      approved: isEligible, // pre-selected by default if fully eligible, shopkeeper can toggle
      errorReason: !phoneCheck.isValid ? phoneCheck.error : !hasConsent ? 'Customer opted out of WhatsApp reminders' : undefined,
    });
  });

  const totalEligibleCustomers = customerItems.filter((i) => i.eligibilityStatus === 'ELIGIBLE').length;

  return {
    customerItems,
    totalEligibleCustomers,
    totalEligibleInvoices,
    totalOutstandingAmount,
    customersWithMissingPhone,
    customersWithoutConsent,
  };
}

/**
 * Creates a fully prepared WhatsApp reminder batch for owner review.
 */
export function createWeeklyReminderBatch(
  sales: SaleRecord[],
  customers: Customer[],
  customerTransactions: CustomerTransaction[],
  storeProfile: StoreProfile,
  referenceDate: Date = new Date()
): WhatsAppReminderBatch {
  const windowInfo = getWeeklyISTWindow(referenceDate);

  const { eligibleSales } = findEligibleWeeklyInvoices(
    sales,
    customers,
    customerTransactions,
    windowInfo.windowStart,
    windowInfo.windowEnd
  );

  const grouped = groupInvoicesByCustomer(
    eligibleSales,
    customers,
    customerTransactions,
    storeProfile,
    windowInfo.windowStartISO,
    windowInfo.windowEndISO,
    storeProfile.id || 'store-1',
    sales
  );

  const batchId = `batch_${storeProfile.id || 'store'}_${windowInfo.weekId}_${windowInfo.scheduledExecutionISO.slice(0, 10)}`;
  const idempotencyKey = `batch_key_${storeProfile.id || 'store'}_${windowInfo.windowStartISO.slice(0, 10)}_${windowInfo.windowEndISO.slice(0, 10)}`;

  const nowIso = new Date().toISOString();

  return {
    id: batchId,
    idempotencyKey,
    scheduledExecutionTime: windowInfo.scheduledExecutionISO,
    dateWindowStart: windowInfo.windowStartISO,
    dateWindowEnd: windowInfo.windowEndISO,
    status: grouped.totalEligibleCustomers > 0 ? 'READY_FOR_REVIEW' : 'COMPLETED',
    totalEligibleCustomers: grouped.totalEligibleCustomers,
    totalEligibleInvoices: grouped.totalEligibleInvoices,
    totalOutstandingAmount: grouped.totalOutstandingAmount,
    customersWithMissingPhone: grouped.customersWithMissingPhone,
    customersWithoutConsent: grouped.customersWithoutConsent,
    excludedCustomersCount: grouped.customersWithMissingPhone + grouped.customersWithoutConsent,
    items: grouped.customerItems,
    notes: `Weekly 7-day batch from ${windowInfo.windowStartISO.slice(0, 10)} to ${windowInfo.windowEndISO.slice(0, 10)} (Sunday 12:00 PM IST)`,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
