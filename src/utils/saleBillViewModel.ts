/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Customer, CustomerTransaction, PaymentMethod, SaleItem, SaleRecord } from '../types';
import { calculateCustomerLedgerWithRunningBalance } from './accounting';
import { calculateProjectedUdharBalance } from './customerSearch';
import { formatQuantityWithUnit, normalizeUnit } from './units';

export type SaleBillStatusKind = 'DRAFT' | 'COMPLETED' | 'PENDING' | 'PARTIAL' | 'CANCELLED';

export interface SaleBillFinancialSummary {
  subtotal: number;
  itemDiscountTotal: number;
  loyaltyDiscount: number;
  totalDiscount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  remainingOutstanding: number;
}

export interface SaleBillCustomerSummary {
  customerId: string;
  name: string;
  phone?: string;
  currentBillAmount: number;
  previousOutstanding: number;
  newOutstanding: number;
  currentLedgerBalance: number;
  isCreditImpact: boolean;
}

/**
 * Pure presentation formatter for compact grocery quantity + unit strings
 * (e.g., "1 pkt", "2 kg", "500 gm", "1 L", "3 pcs") without altering stored units.
 */
export function formatCompactBillQty(quantity: number, unit?: string): string {
  const safeQty = Number.isFinite(Number(quantity)) ? Number(quantity) : 0;
  if (!unit || !unit.trim()) {
    return `${safeQty} pcs`;
  }
  const normalized = normalizeUnit(unit);
  const compactLabels: Record<string, string> = {
    KG: 'kg',
    GM: 'gm',
    LITRE: 'L',
    ML: 'ml',
    PCS: 'pcs',
    PACKET: 'pkt',
    BOX: 'box',
    DOZEN: 'dz',
  };
  const label = compactLabels[normalized];
  if (label) {
    const cleanQty = Number.isInteger(safeQty)
      ? String(safeQty)
      : Number(safeQty.toFixed(3)).toString();
    return `${cleanQty} ${label}`;
  }
  return formatQuantityWithUnit(safeQty, unit);
}

/**
 * Computes presentation-only financial breakdown rows strictly from existing
 * SaleItem / SaleRecord / loyalty values without modifying accounting formulas.
 */
export function buildSaleBillFinancialSummary(params: {
  items: SaleItem[];
  grossAmount: number;
  netTotal: number;
  loyaltyDiscount?: number;
  paymentMethod: PaymentMethod;
  isCredit?: boolean;
  isCancelled?: boolean;
  existingOutstandingForSale?: number;
}): SaleBillFinancialSummary {
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  const itemDiscountTotal = round2(
    params.items.reduce((sum, item) => sum + Math.max(0, Number(item.discount) || 0), 0)
  );
  const loyaltyDiscount = round2(Math.max(0, Number(params.loyaltyDiscount) || 0));
  const grandTotal = round2(Math.max(0, Number(params.netTotal) || 0));

  // If items have line discounts, reconstruct pre-discount subtotal safely from item lines
  const itemsGrossBeforeLineDiscounts = round2(
    params.items.reduce((sum, item) => {
      const lineTotal = Math.max(0, Number(item.total) || 0);
      const lineDisc = Math.max(0, Number(item.discount) || 0);
      return sum + lineTotal + lineDisc;
    }, 0)
  );

  const subtotal =
    params.items.length > 0
      ? Math.max(itemsGrossBeforeLineDiscounts, round2(Math.max(0, Number(params.grossAmount) || 0)))
      : round2(Math.max(Number(params.grossAmount) || 0, grandTotal + loyaltyDiscount));

  const totalDiscount = round2(itemDiscountTotal + loyaltyDiscount);
  const isCreditSale = params.paymentMethod === 'CREDIT' || Boolean(params.isCredit);

  let amountPaid = 0;
  let remainingOutstanding = 0;

  if (params.isCancelled) {
    amountPaid = 0;
    remainingOutstanding = 0;
  } else if (isCreditSale) {
    const outstanding =
      typeof params.existingOutstandingForSale === 'number' &&
      Number.isFinite(params.existingOutstandingForSale)
        ? Math.max(0, Math.min(grandTotal, round2(params.existingOutstandingForSale)))
        : grandTotal;
    remainingOutstanding = outstanding;
    amountPaid = round2(Math.max(0, grandTotal - remainingOutstanding));
  } else {
    amountPaid = grandTotal;
    remainingOutstanding = 0;
  }

  return {
    subtotal,
    itemDiscountTotal,
    loyaltyDiscount,
    totalDiscount,
    taxAmount: 0,
    grandTotal,
    amountPaid,
    remainingOutstanding,
  };
}

/**
 * Computes display customer balances for both Draft (pre-save) and Finalized (post-save)
 * bills using the existing customer ledger balance & projected Udhar helper.
 */
export function buildSaleBillCustomerSummary(params: {
  customer: Customer | null | undefined;
  billAmount: number;
  paymentMethod: PaymentMethod;
  isCredit?: boolean;
  isFinalized: boolean;
  isCancelled?: boolean;
  invoiceNo?: string;
  customerTransactions?: CustomerTransaction[];
}): SaleBillCustomerSummary | null {
  if (!params.customer) return null;
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const currentBillAmount = round2(Math.max(0, Number(params.billAmount) || 0));
  const isCreditImpact =
    !params.isCancelled && (params.paymentMethod === 'CREDIT' || Boolean(params.isCredit));
  const ledgerBalance = round2(Number(params.customer.currentBalance) || 0);

  if (params.isFinalized) {
    if (isCreditImpact && params.invoiceNo && params.customerTransactions?.length) {
      const ledgerSummary = calculateCustomerLedgerWithRunningBalance(
        params.customer,
        params.customerTransactions
      );
      const matchedEntry = ledgerSummary.entries.find(
        (entry) =>
          !entry.isCancelled &&
          entry.type === 'CREDIT' &&
          entry.invoiceNo === params.invoiceNo
      );
      if (matchedEntry) {
        return {
          customerId: params.customer.id,
          name: params.customer.name,
          phone: params.customer.phone || undefined,
          currentBillAmount,
          previousOutstanding: round2(matchedEntry.previousBalance),
          newOutstanding: round2(matchedEntry.runningBalance),
          currentLedgerBalance: ledgerBalance,
          isCreditImpact,
        };
      }
    }

    // Fallback when viewing an immediate credit completion without ledger entry lookup
    const newOutstanding = ledgerBalance;
    const previousOutstanding = isCreditImpact
      ? round2(Math.max(0, ledgerBalance - currentBillAmount))
      : ledgerBalance;
    return {
      customerId: params.customer.id,
      name: params.customer.name,
      phone: params.customer.phone || undefined,
      currentBillAmount,
      previousOutstanding,
      newOutstanding,
      currentLedgerBalance: ledgerBalance,
      isCreditImpact,
    };
  }

  // Draft mode: customer.currentBalance is the previous outstanding before saving
  const previousOutstanding = ledgerBalance;
  const newOutstanding = isCreditImpact
    ? round2(calculateProjectedUdharBalance(previousOutstanding, currentBillAmount))
    : previousOutstanding;

  return {
    customerId: params.customer.id,
    name: params.customer.name,
    phone: params.customer.phone || undefined,
    currentBillAmount,
    previousOutstanding,
    newOutstanding,
    currentLedgerBalance: ledgerBalance,
    isCreditImpact,
  };
}

/**
 * Resolves the clean status badge label for a Sale Bill header.
 */
export function resolveSaleBillStatus(params: {
  isFinalized: boolean;
  sale?: SaleRecord | null;
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';
}): { kind: SaleBillStatusKind; label: string } {
  if (!params.isFinalized) {
    return { kind: 'DRAFT', label: 'Pending' };
  }
  if (params.sale && (params.sale.status === 'CANCELLED' || params.sale.status === 'REVERSED')) {
    return { kind: 'CANCELLED', label: 'Cancelled' };
  }
  if (params.paymentStatus === 'PARTIAL') {
    return { kind: 'PARTIAL', label: 'Partial' };
  }
  if (params.paymentStatus === 'UNPAID' || params.sale?.isCredit || params.sale?.paymentMethod === 'CREDIT') {
    return { kind: 'PENDING', label: 'Credit Due' };
  }
  return { kind: 'COMPLETED', label: 'Completed' };
}

/**
 * Maps a product name to a deterministic, warm grocery-pack visual accent and
 * clean 2-letter monogram so every item row has a tidy pack badge without broken images.
 */
export function getProductBadgeMeta(productName: string): {
  initials: string;
  bgClass: string;
  textClass: string;
} {
  const cleaned = String(productName || 'Item').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const initials =
    words.length >= 2
      ? `${words[0][0]}${words[1][0]}`.toUpperCase()
      : cleaned.slice(0, 2).toUpperCase() || 'IT';

  const palettes = [
    { bgClass: 'bg-amber-400', textClass: 'text-amber-950' },
    { bgClass: 'bg-orange-400', textClass: 'text-orange-950' },
    { bgClass: 'bg-emerald-400', textClass: 'text-emerald-950' },
    { bgClass: 'bg-sky-400', textClass: 'text-sky-950' },
    { bgClass: 'bg-lime-400', textClass: 'text-lime-950' },
    { bgClass: 'bg-rose-400', textClass: 'text-rose-950' },
  ];

  let hash = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    hash = (hash * 31 + cleaned.charCodeAt(i)) >>> 0;
  }
  const palette = palettes[hash % palettes.length];
  return { initials, ...palette };
}
