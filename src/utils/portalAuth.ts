/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Customer,
  CustomerTransaction,
  PurchaseReturnLineItem,
  SaleItem,
  SaleRecord,
  StoreProfile,
  Supplier,
  SupplierTransaction,
} from '../types';
import { normalizeMobileDigits } from './loginValidation';

export function normalizeNameForLookup(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function phonesMatchLast10(a: string, b: string): boolean {
  const normA = normalizeMobileDigits(a);
  const normB = normalizeMobileDigits(b);
  if (normA.length < 10 || normB.length < 10) return false;
  return normA.slice(-10) === normB.slice(-10);
}

function namesMatchForPortal(enteredRaw: string, storedRaw: string): boolean {
  const entered = normalizeNameForLookup(enteredRaw);
  const stored = normalizeNameForLookup(storedRaw);
  if (!entered || !stored) return false;
  return entered === stored;
}

export interface CustomerLookupResult {
  matched: boolean;
  customer?: Customer;
  normalizedPhone?: string;
  error?: string;
}

export function lookupCustomerAccount(params: {
  customers: Customer[];
  name: string;
  phone: string;
}): CustomerLookupResult {
  const cleanName = params.name.trim();
  const normalizedPhone = normalizeMobileDigits(params.phone);

  if (cleanName.length < 2) {
    return {
      matched: false,
      error: 'Please enter your registered full name (at least 2 characters).',
    };
  }
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return {
      matched: false,
      error: 'Please enter a valid 10-digit registered mobile number.',
    };
  }

  const matched = params.customers.find(
    (c) =>
      phonesMatchLast10(c.phone, normalizedPhone) &&
      namesMatchForPortal(cleanName, c.name)
  );

  if (!matched) {
    return {
      matched: false,
      error:
        'No customer record matched this name and mobile number. Please check your registered details with the store.',
    };
  }

  return {
    matched: true,
    customer: matched,
    normalizedPhone,
  };
}

export interface SupplierLookupResult {
  matched: boolean;
  supplier?: Supplier;
  normalizedPhone?: string;
  error?: string;
}

export function lookupSupplierAccount(params: {
  suppliers: Supplier[];
  name: string;
  phone: string;
}): SupplierLookupResult {
  const cleanName = params.name.trim();
  const normalizedPhone = normalizeMobileDigits(params.phone);

  if (cleanName.length < 2) {
    return {
      matched: false,
      error: 'Please enter your registered supplier or contact name (at least 2 characters).',
    };
  }
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return {
      matched: false,
      error: 'Please enter a valid 10-digit registered mobile number.',
    };
  }

  const matched = params.suppliers.find(
    (s) =>
      phonesMatchLast10(s.phone, normalizedPhone) &&
      (namesMatchForPortal(cleanName, s.name) ||
        (s.contactPerson ? namesMatchForPortal(cleanName, s.contactPerson) : false))
  );

  if (!matched) {
    return {
      matched: false,
      error:
        'No supplier record matched this name and mobile number. Please verify your registered supplier details with the store.',
    };
  }

  return {
    matched: true,
    supplier: matched,
    normalizedPhone,
  };
}

export interface CreateAccountValidationResult {
  valid: boolean;
  storeName?: string;
  ownerName?: string;
  normalizedMobile?: string;
  normalizedPin?: string;
  error?: string;
}

export function validateCreateAccountInput(params: {
  storeName: string;
  ownerName: string;
  mobile: string;
  pin: string;
  confirmPin: string;
}): CreateAccountValidationResult {
  const storeName = params.storeName.trim();
  const ownerName = params.ownerName.trim();
  const normalizedMobile = normalizeMobileDigits(params.mobile);
  const normalizedPin = String(params.pin || '').trim();
  const normalizedConfirm = String(params.confirmPin || '').trim();

  if (storeName.length < 2) {
    return { valid: false, error: 'Please enter your shop or business name (at least 2 characters).' };
  }
  if (ownerName.length < 2) {
    return { valid: false, error: 'Please enter the owner full name (at least 2 characters).' };
  }
  if (normalizedMobile.length < 10 || normalizedMobile.length > 15) {
    return { valid: false, error: 'Please enter a valid 10-digit mobile number.' };
  }
  if (!/^\d{4}$/.test(normalizedPin)) {
    return { valid: false, error: 'Please choose a 4-digit numeric PIN.' };
  }
  if (normalizedPin !== normalizedConfirm) {
    return { valid: false, error: 'PIN and Confirm PIN do not match.' };
  }

  return {
    valid: true,
    storeName,
    ownerName,
    normalizedMobile,
    normalizedPin,
  };
}

export interface OfflineOwnerRecoveryResult {
  valid: boolean;
  normalizedMobile?: string;
  normalizedNewPin?: string;
  error?: string;
}

export function verifyOfflineOwnerRecovery(params: {
  profile: Pick<StoreProfile, 'storeName' | 'ownerName' | 'phone'>;
  enteredMobile: string;
  enteredOwnerName: string;
  enteredStoreName: string;
  newPin: string;
  confirmNewPin: string;
}): OfflineOwnerRecoveryResult {
  const normalizedMobile = normalizeMobileDigits(params.enteredMobile);
  if (normalizedMobile.length < 10 || normalizedMobile.length > 15) {
    return { valid: false, error: 'Please enter your valid 10-digit registered mobile number.' };
  }

  const registeredPhone = normalizeMobileDigits(params.profile.phone || '');
  if (registeredPhone.length >= 10 && !phonesMatchLast10(normalizedMobile, registeredPhone)) {
    return { valid: false, error: 'Mobile number does not match the registered store owner account.' };
  }

  const storedOwner = normalizeNameForLookup(params.profile.ownerName || '');
  const enteredOwner = normalizeNameForLookup(params.enteredOwnerName);
  if (!enteredOwner || (storedOwner && enteredOwner !== storedOwner)) {
    return {
      valid: false,
      error: 'Owner name does not match the registered store profile.',
    };
  }

  const storedShop = normalizeNameForLookup(params.profile.storeName || '');
  const enteredShop = normalizeNameForLookup(params.enteredStoreName);
  if (!enteredShop || (storedShop && enteredShop !== storedShop)) {
    return {
      valid: false,
      error: 'Store name does not match the registered store profile.',
    };
  }

  const normalizedNewPin = String(params.newPin || '').trim();
  const normalizedConfirm = String(params.confirmNewPin || '').trim();
  if (!/^\d{4}$/.test(normalizedNewPin)) {
    return { valid: false, error: 'New PIN must be exactly 4 numeric digits.' };
  }
  if (normalizedNewPin !== normalizedConfirm) {
    return { valid: false, error: 'New PIN and Confirm PIN do not match.' };
  }

  return {
    valid: true,
    normalizedMobile,
    normalizedNewPin,
  };
}

export interface CustomerPortalLedgerEntry {
  id: string;
  date: string;
  type: CustomerTransaction['type'];
  description: string;
  amount: number;
  signedDelta: number; // + increases customer udhar due, - reduces udhar due
  runningBalance: number;
  paymentMethod?: string;
  invoiceNo?: string;
  items?: SaleItem[];
  status: 'COMPLETED' | 'CANCELLED' | 'REVERSED';
}

export interface CustomerPortalSummary {
  customer: Customer;
  currentBalance: number;
  totalBilled: number;
  totalPaid: number;
  totalReturns: number;
  activeTransactionCount: number;
  loyaltyPoints: number;
  lifetimeLoyaltyPoints: number;
  entries: CustomerPortalLedgerEntry[]; // newest first
}

function txSortKey(dateStr: string, createdAt: string): number {
  const t1 = new Date(dateStr).getTime();
  if (Number.isFinite(t1)) return t1;
  const t2 = new Date(createdAt).getTime();
  return Number.isFinite(t2) ? t2 : 0;
}

export function buildCustomerPortalData(params: {
  customer: Customer;
  customerTransactions: CustomerTransaction[];
  sales: SaleRecord[];
}): CustomerPortalSummary {
  const { customer, customerTransactions, sales } = params;
  const saleByInvoiceNo = new Map<string, SaleRecord>();
  for (const s of sales) {
    if (s.customerId === customer.id && s.invoiceNo) {
      saleByInvoiceNo.set(s.invoiceNo, s);
    }
  }

  const mine = customerTransactions
    .filter((tx) => tx.customerId === customer.id)
    .slice()
    .sort((a, b) => {
      const diff = txSortKey(a.date, a.createdAt) - txSortKey(b.date, b.createdAt);
      if (diff !== 0) return diff;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

  let running = Number(customer.openingBalance) || 0;
  let totalBilled = 0;
  let totalPaid = 0;
  let totalReturns = 0;
  let activeTransactionCount = 0;

  const chronological: CustomerPortalLedgerEntry[] = mine.map((tx) => {
    const status = (tx.status || 'COMPLETED') as 'COMPLETED' | 'CANCELLED' | 'REVERSED';
    const isActive = status === 'COMPLETED';
    const amt = Math.max(0, Number(tx.amount) || 0);
    let signedDelta = 0;

    if (isActive) {
      activeTransactionCount += 1;
      if (tx.type === 'CREDIT' || tx.type === 'OPENING') {
        signedDelta = amt;
        if (tx.type === 'CREDIT') totalBilled += amt;
      } else if (tx.type === 'PAYMENT') {
        signedDelta = -amt;
        totalPaid += amt;
      } else if (tx.type === 'RETURN') {
        signedDelta = -amt;
        totalReturns += amt;
      } else if (tx.type === 'ADJUSTMENT') {
        signedDelta = -amt;
      }
      running = Math.round((running + signedDelta) * 100) / 100;
    }

    const linkedSale = tx.invoiceNo ? saleByInvoiceNo.get(tx.invoiceNo) : undefined;

    return {
      id: tx.id,
      date: tx.date || tx.createdAt,
      type: tx.type,
      description: tx.description || (tx.type === 'PAYMENT' ? 'Payment Received' : 'Store Entry'),
      amount: amt,
      signedDelta,
      runningBalance: running,
      paymentMethod: tx.paymentMethod,
      invoiceNo: linkedSale?.invoiceNo || tx.invoiceNo,
      items: linkedSale?.items && linkedSale.items.length > 0 ? linkedSale.items : undefined,
      status,
    };
  });

  // Also include non-credit cash/UPI sales linked to this customer that didn't create a CREDIT ledger tx
  const linkedInvoiceNos = new Set(mine.map((t) => t.invoiceNo).filter(Boolean));
  const cashLinkedSales = sales.filter(
    (s) =>
      s.customerId === customer.id &&
      !s.isCredit &&
      (!s.invoiceNo || !linkedInvoiceNos.has(s.invoiceNo)) &&
      s.status !== 'CANCELLED' &&
      s.status !== 'REVERSED'
  );
  for (const s of cashLinkedSales) {
    totalBilled += Math.max(0, Number(s.amount) || 0);
    totalPaid += Math.max(0, Number(s.amount) || 0);
    activeTransactionCount += 1;
    chronological.push({
      id: `sale-${s.id}`,
      date: s.date || s.createdAt,
      type: 'CREDIT',
      description: s.notes || `Counter Bill (${s.paymentMethod}) — Paid in Full`,
      amount: Math.max(0, Number(s.amount) || 0),
      signedDelta: 0,
      runningBalance: running,
      paymentMethod: s.paymentMethod,
      invoiceNo: s.invoiceNo,
      items: s.items && s.items.length > 0 ? s.items : undefined,
      status: 'COMPLETED',
    });
  }

  chronological.sort(
    (a, b) => txSortKey(b.date, b.date) - txSortKey(a.date, a.date)
  );

  return {
    customer,
    currentBalance: Math.round((Number(customer.currentBalance) || 0) * 100) / 100,
    totalBilled: Math.round(totalBilled * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalReturns: Math.round(totalReturns * 100) / 100,
    activeTransactionCount,
    loyaltyPoints: Math.max(0, Math.floor(Number(customer.loyaltyPointsBalance) || 0)),
    lifetimeLoyaltyPoints: Math.max(
      0,
      Math.floor(Number(customer.totalLoyaltyPointsEarned) || 0)
    ),
    entries: chronological,
  };
}

export interface SupplierPortalLedgerEntry {
  id: string;
  date: string;
  type: SupplierTransaction['type'];
  description: string;
  amount: number;
  signedDelta: number; // + increases store payable to supplier, - reduces payable
  runningPayable: number;
  paymentMethod?: string;
  paymentStatus?: SupplierTransaction['paymentStatus'];
  invoiceNo?: string;
  creditNoteNo?: string;
  returnReason?: string;
  returnItems?: PurchaseReturnLineItem[];
  status: 'COMPLETED' | 'CANCELLED' | 'REVERSED';
}

export interface SupplierPortalSummary {
  supplier: Supplier;
  currentPayable: number;
  totalPurchases: number;
  totalPaid: number;
  totalReturns: number;
  creditNotesCount: number;
  activeTransactionCount: number;
  entries: SupplierPortalLedgerEntry[]; // newest first
}

export function buildSupplierPortalData(params: {
  supplier: Supplier;
  supplierTransactions: SupplierTransaction[];
}): SupplierPortalSummary {
  const { supplier, supplierTransactions } = params;

  const mine = supplierTransactions
    .filter((tx) => tx.supplierId === supplier.id)
    .slice()
    .sort((a, b) => {
      const diff = txSortKey(a.date, a.createdAt) - txSortKey(b.date, b.createdAt);
      if (diff !== 0) return diff;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

  let running = Number(supplier.openingBalance) || 0;
  let totalPurchases = 0;
  let totalPaid = 0;
  let totalReturns = 0;
  let creditNotesCount = 0;
  let activeTransactionCount = 0;

  const chronological: SupplierPortalLedgerEntry[] = mine.map((tx) => {
    const status = (tx.status || 'COMPLETED') as 'COMPLETED' | 'CANCELLED' | 'REVERSED';
    const isActive = status === 'COMPLETED';
    const amt = Math.max(0, Number(tx.amount) || 0);
    let signedDelta = 0;

    if (isActive) {
      activeTransactionCount += 1;
      if (tx.type === 'PURCHASE') {
        signedDelta = amt;
        totalPurchases += amt;
      } else if (tx.type === 'PAYMENT') {
        signedDelta = -amt;
        totalPaid += amt;
      } else if (tx.type === 'RETURN') {
        signedDelta = -amt;
        totalReturns += amt;
        if (tx.creditNoteNo) creditNotesCount += 1;
      }
      running = Math.round((running + signedDelta) * 100) / 100;
    }

    return {
      id: tx.id,
      date: tx.date || tx.createdAt,
      type: tx.type,
      description:
        tx.description ||
        (tx.type === 'PURCHASE'
          ? 'Stock Purchase Invoice'
          : tx.type === 'RETURN'
          ? 'Purchase Return / Credit Note'
          : 'Supplier Payment'),
      amount: amt,
      signedDelta,
      runningPayable: running,
      paymentMethod: tx.paymentMethod,
      paymentStatus: tx.paymentStatus,
      invoiceNo: tx.invoiceNo,
      creditNoteNo: tx.creditNoteNo,
      returnReason: tx.returnReason,
      returnItems: tx.returnItems && tx.returnItems.length > 0 ? tx.returnItems : undefined,
      status,
    };
  });

  chronological.reverse();

  return {
    supplier,
    currentPayable: Math.round((Number(supplier.currentBalance) || 0) * 100) / 100,
    totalPurchases: Math.round(totalPurchases * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalReturns: Math.round(totalReturns * 100) / 100,
    creditNotesCount,
    activeTransactionCount,
    entries: chronological,
  };
}
