import {
  Customer,
  CustomerTransaction,
  CustomerTransactionType,
  LedgerDateRange,
  PaymentMethod,
  SaleRecord,
} from '../types';
import { matchesLedgerDateFilter } from './accounting';
import { calculateInvoiceOutstanding } from './whatsappReminders';

export type SalePaymentStatusFilter = 'ALL' | 'PAID' | 'PARTIAL' | 'UNPAID';
export type SaleTransactionTypeFilter = 'ALL' | PaymentMethod;

export interface SalesMultiFilterCriteria {
  searchQuery?: string;
  dateRange: LedgerDateRange;
  customStartDate?: string;
  customEndDate?: string;
  transactionType: SaleTransactionTypeFilter;
  paymentStatus: SalePaymentStatusFilter;
  referenceNow?: Date;
}

export type CustomerPaymentStatusFilter =
  | 'ALL'
  | 'DUE'
  | 'OVERDUE'
  | 'CLEARED'
  | 'ADVANCE'
  | 'HAS_CANCELLED';

export type CustomerTxTypeFilter = 'ALL' | CustomerTransactionType;

export interface CustomersMultiFilterCriteria {
  searchQuery?: string;
  dateRange: LedgerDateRange;
  customStartDate?: string;
  customEndDate?: string;
  transactionType: CustomerTxTypeFilter;
  paymentStatus: CustomerPaymentStatusFilter;
  referenceNow?: Date;
}

export function getSalePaymentStatus(
  sale: SaleRecord,
  customers: Customer[],
  customerTransactions: CustomerTransaction[],
  allSales?: SaleRecord[]
): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (!sale.isCredit && sale.paymentMethod !== 'CREDIT') {
    return 'PAID';
  }

  const customer = sale.customerId
    ? customers.find((c) => c.id === sale.customerId)
    : undefined;

  if (!customer) {
    return sale.isCredit || sale.paymentMethod === 'CREDIT' ? 'UNPAID' : 'PAID';
  }

  const custSales = allSales
    ? allSales.filter((s) => s.customerId === customer.id && (s.isCredit || s.paymentMethod === 'CREDIT'))
    : undefined;

  const statusInfo = calculateInvoiceOutstanding(
    sale,
    customer,
    customerTransactions,
    custSales
  );

  if (statusInfo.status === 'PAID') return 'PAID';
  if (statusInfo.status === 'PARTIALLY_PAID') return 'PARTIAL';
  return 'UNPAID';
}

export function filterSalesMultiCriteria(
  sales: SaleRecord[],
  customers: Customer[],
  customerTransactions: CustomerTransaction[],
  criteria: SalesMultiFilterCriteria
): SaleRecord[] {
  const query = (criteria.searchQuery || '').trim().toLowerCase();
  const refNow = criteria.referenceNow ?? new Date();

  return sales.filter((sale) => {
    // 1. Date Range filter
    if (criteria.dateRange && criteria.dateRange !== 'ALL') {
      const dateMatch = matchesLedgerDateFilter(
        sale.date || sale.createdAt,
        criteria.dateRange,
        criteria.customStartDate,
        criteria.customEndDate,
        refNow
      );
      if (!dateMatch) return false;
    }

    // 2. Transaction Type filter (CASH / UPI / BANK / CREDIT)
    if (criteria.transactionType && criteria.transactionType !== 'ALL') {
      if (criteria.transactionType === 'CREDIT') {
        if (sale.paymentMethod !== 'CREDIT' && !sale.isCredit) return false;
      } else if (sale.paymentMethod !== criteria.transactionType) {
        return false;
      }
    }

    // 3. Payment Status filter (PAID / PARTIAL / UNPAID)
    if (criteria.paymentStatus && criteria.paymentStatus !== 'ALL') {
      const status = getSalePaymentStatus(sale, customers, customerTransactions, sales);
      if (status !== criteria.paymentStatus) return false;
    }

    // 4. Text Search filter (Invoice #, customer name, item names, notes)
    if (query) {
      const itemsText = (sale.items || []).map((i) => i.productName).join(' ').toLowerCase();
      const matches =
        sale.invoiceNo.toLowerCase().includes(query) ||
        (sale.customerName && sale.customerName.toLowerCase().includes(query)) ||
        (sale.notes && sale.notes.toLowerCase().includes(query)) ||
        itemsText.includes(query);
      if (!matches) return false;
    }

    return true;
  });
}

export function getCustomerPaymentStatus(customer: Customer): 'DUE' | 'CLEARED' | 'ADVANCE' {
  const bal = Number(customer.currentBalance) || 0;
  if (bal > 0) return 'DUE';
  if (bal < 0) return 'ADVANCE';
  return 'CLEARED';
}

export function filterCustomersMultiCriteria(
  customers: Customer[],
  customerTransactions: CustomerTransaction[],
  criteria: CustomersMultiFilterCriteria
): Customer[] {
  const query = (criteria.searchQuery || '').trim().toLowerCase();
  const refNow = criteria.referenceNow ?? new Date();
  const hasDateFilter = Boolean(criteria.dateRange && criteria.dateRange !== 'ALL');
  const hasTypeFilter = Boolean(criteria.transactionType && criteria.transactionType !== 'ALL');

  return customers.filter((customer) => {
    const custTx = customerTransactions.filter((tx) => tx.customerId === customer.id);

    // 1. Payment Status filter
    if (criteria.paymentStatus && criteria.paymentStatus !== 'ALL') {
      const bal = Number(customer.currentBalance) || 0;
      if (criteria.paymentStatus === 'DUE' && bal <= 0) return false;
      if (criteria.paymentStatus === 'OVERDUE' && !(bal > 0 && (customer.category === 'OVERDUE' || customer.overdueDays > 30))) {
        return false;
      }
      if (criteria.paymentStatus === 'CLEARED' && bal !== 0) return false;
      if (criteria.paymentStatus === 'ADVANCE' && bal >= 0) return false;
      if (
        criteria.paymentStatus === 'HAS_CANCELLED' &&
        !custTx.some((tx) => tx.status === 'CANCELLED' || tx.status === 'REVERSED')
      ) {
        return false;
      }
    }

    // 2. Combined Date Range + Transaction Type filter across customer's transactions
    if (hasDateFilter || hasTypeFilter) {
      const matchingTx = custTx.filter((tx) => {
        if (hasDateFilter) {
          const inRange = matchesLedgerDateFilter(
            tx.date || tx.createdAt,
            criteria.dateRange,
            criteria.customStartDate,
            criteria.customEndDate,
            refNow
          );
          if (!inRange) return false;
        }
        if (hasTypeFilter && tx.type !== criteria.transactionType) {
          return false;
        }
        return true;
      });

      // If filtering by transaction type, require at least one matching transaction
      if (hasTypeFilter && matchingTx.length === 0) return false;

      // If filtering by date range alone, match if customer has a tx in range OR lastTransactionDate/createdAt is in range
      if (hasDateFilter && matchingTx.length === 0) {
        const lastDateMatch = customer.lastTransactionDate
          ? matchesLedgerDateFilter(
              customer.lastTransactionDate,
              criteria.dateRange,
              criteria.customStartDate,
              criteria.customEndDate,
              refNow
            )
          : false;
        if (!lastDateMatch) return false;
      }
    }

    // 3. Text Search filter (Name, Phone, Address, Notes, or Invoice # / description in tx)
    if (query) {
      const basicMatch =
        customer.name.toLowerCase().includes(query) ||
        customer.phone.toLowerCase().includes(query) ||
        (customer.address && customer.address.toLowerCase().includes(query)) ||
        (customer.notes && customer.notes.toLowerCase().includes(query));

      const txMatch = custTx.some(
        (tx) =>
          (tx.invoiceNo && tx.invoiceNo.toLowerCase().includes(query)) ||
          (tx.description && tx.description.toLowerCase().includes(query))
      );

      if (!basicMatch && !txMatch) return false;
    }

    return true;
  });
}
