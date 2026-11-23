import { Customer } from '../types';

/**
 * Normalizes a phone string to digits only for fast mobile number matching.
 */
export function normalizePhoneDigits(phone?: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Filters and ranks customers for live Udhar billing search by full name,
 * partial name, phone/mobile number, or digits-only suffix/substring.
 * Pure & non-mutating: never alters customer records or balances.
 */
export function filterCustomersForQuickSale(
  customers: Customer[],
  rawQuery: string
): Customer[] {
  if (!Array.isArray(customers) || customers.length === 0) return [];

  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return customers;
  }

  const queryDigits = normalizePhoneDigits(query);
  const scored: Array<{ customer: Customer; score: number }> = [];

  for (const customer of customers) {
    const nameLower = (customer.name || '').toLowerCase();
    const phoneRawLower = (customer.phone || '').toLowerCase();
    const phoneDigits = normalizePhoneDigits(customer.phone);

    let score = 0;

    if (nameLower === query) {
      score = 100;
    } else if (nameLower.startsWith(query)) {
      score = 90;
    } else if (nameLower.includes(query)) {
      score = 70;
    } else if (queryDigits.length > 0 && phoneDigits === queryDigits) {
      score = 95;
    } else if (queryDigits.length > 0 && phoneDigits.startsWith(queryDigits)) {
      score = 85;
    } else if (
      phoneRawLower.includes(query) ||
      (queryDigits.length > 0 && phoneDigits.includes(queryDigits))
    ) {
      score = 65;
    }

    if (score > 0) {
      scored.push({ customer, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.customer.name || '').localeCompare(b.customer.name || '', 'en-IN');
  });

  return scored.map((entry) => entry.customer);
}

/**
 * Computes a read-only visual preview of what the customer's Udhar balance
 * would become after saving a credit sale of `saleAmount`.
 * Does NOT mutate any customer or transaction record.
 */
export function calculateProjectedUdharBalance(
  currentBalance: number,
  saleAmount: number
): number {
  const base = Number(currentBalance) || 0;
  const add = Math.max(0, Number(saleAmount) || 0);
  return Math.round((base + add) * 100) / 100;
}
