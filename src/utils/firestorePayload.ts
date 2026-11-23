/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CashbookEntry,
  Customer,
  CustomerTransaction,
  ExpenseRecord,
  LocalBackupSnapshot,
  Product,
  SaleRecord,
  StoreProfile,
  Supplier,
  SupplierTransaction,
} from '../types';

function clip(val: unknown, maxLen: number): string {
  const str = typeof val === 'string' ? val : String(val ?? '');
  return str.slice(0, maxLen);
}

function safeId(val: unknown, fallback = 'id-0'): string {
  const cleaned = String(val ?? fallback)
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 128);
  return cleaned || fallback;
}

function num(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Pure payload builders matching firebase-blueprint.json and firestore.rules strict keys/maxLengths.
 * Prevents shadow fields, unbounded strings, and JSON string blobs.
 */
export function buildStoreWorkspacePayload(
  ownerId: string,
  profile: StoreProfile,
  lastClosedDate: string | null,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ownerId: safeId(ownerId),
    storeName: clip(String(profile.storeName || '').trim() || 'Arjun Groceries', 160),
    ownerName: clip(profile.ownerName || '', 120),
    phone: clip(profile.phone || '', 32),
    address: clip(profile.address || '', 300),
    upiId: clip(profile.upiId || '', 120),
    gstin: clip(profile.gstin || '', 32),
    lastClosedDate: clip(lastClosedDate || '', 32),
    localUpdatedAt: clip(nowIso, 40),
  };

  if (profile.whatsappTemplateConfig) {
    payload.whatsappTemplateConfig = {
      templateName: clip(profile.whatsappTemplateConfig.templateName, 80),
      bodyTemplate: clip(profile.whatsappTemplateConfig.bodyTemplate, 1000),
      footerText: clip(profile.whatsappTemplateConfig.footerText || '', 120),
      includeInvoiceList: Boolean(profile.whatsappTemplateConfig.includeInvoiceList),
      includeUpiId: Boolean(profile.whatsappTemplateConfig.includeUpiId),
      updatedAt: clip(profile.whatsappTemplateConfig.updatedAt || nowIso, 40),
    };
  }

  return payload;
}

export function buildCustomerCloudPayload(
  ownerId: string,
  customer: Customer,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  return {
    id: safeId(customer.id),
    ownerId: safeId(ownerId),
    name: clip(String(customer.name || '').trim() || 'Customer', 160),
    phone: clip(customer.phone || '', 32),
    address: clip(customer.address || '', 300),
    openingBalance: num(customer.openingBalance),
    currentBalance: num(customer.currentBalance),
    totalCreditGiven: num(customer.totalCreditGiven),
    totalPaymentReceived: num(customer.totalPaymentReceived),
    whatsappConsent: customer.whatsappConsent !== false,
    localUpdatedAt: clip(nowIso, 40),
  };
}

export function buildCustomerTxCloudPayload(
  ownerId: string,
  tx: CustomerTransaction,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  return {
    id: safeId(tx.id),
    ownerId: safeId(ownerId),
    customerId: safeId(tx.customerId),
    type: tx.type,
    amount: num(tx.amount),
    date: clip(tx.date || nowIso, 40),
    description: clip(tx.description || '', 400),
    paymentMethod: clip(tx.paymentMethod || 'CASH', 20),
    invoiceNo: clip(tx.invoiceNo || '', 64),
    status: clip(tx.status || 'COMPLETED', 32),
    localUpdatedAt: clip(tx.cancelledAt || tx.createdAt || nowIso, 40),
  };
}

export function buildSupplierCloudPayload(
  ownerId: string,
  supplier: Supplier,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  return {
    id: safeId(supplier.id),
    ownerId: safeId(ownerId),
    name: clip(String(supplier.name || '').trim() || 'Supplier', 160),
    phone: clip(supplier.phone || '', 32),
    category: clip(supplier.notes || '', 100),
    address: clip(supplier.address || '', 300),
    openingBalance: num(supplier.openingBalance),
    currentBalance: num(supplier.currentBalance),
    totalPurchases: num(supplier.totalPurchases),
    totalPaid: num(supplier.totalPaid),
    localUpdatedAt: clip(supplier.lastTransactionDate || nowIso, 40),
  };
}

export function buildSupplierTxCloudPayload(
  ownerId: string,
  tx: SupplierTransaction,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  return {
    id: safeId(tx.id),
    ownerId: safeId(ownerId),
    supplierId: safeId(tx.supplierId),
    type: tx.type,
    amount: num(tx.amount),
    date: clip(tx.date || nowIso, 40),
    paymentStatus: clip(tx.paymentStatus || 'PAID', 24),
    paymentMethod: clip(tx.paymentMethod || 'BANK', 20),
    description: clip(tx.description || '', 400),
    invoiceNo: clip(tx.invoiceNo || '', 64),
    status: clip(tx.status || 'COMPLETED', 32),
    localUpdatedAt: clip(tx.cancelledAt || tx.createdAt || nowIso, 40),
  };
}

export function buildSaleCloudPayload(
  ownerId: string,
  sale: SaleRecord,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  const allowedMethod = ['CASH', 'UPI', 'CARD', 'CREDIT', 'BANK'].includes(sale.paymentMethod)
    ? sale.paymentMethod
    : 'CASH';
  return {
    id: safeId(sale.id),
    ownerId: safeId(ownerId),
    invoiceNo: clip(String(sale.invoiceNo || sale.id || '').trim() || 'INV-0', 64),
    date: clip(sale.date || nowIso, 40),
    customerId: clip(sale.customerId || '', 128),
    customerName: clip(sale.customerName || '', 160),
    amount: num(sale.amount),
    paymentMethod: allowedMethod,
    isCredit: Boolean(sale.isCredit),
    items: (sale.items || []).slice(0, 100).map((it) => ({
      productId: safeId(it.productId || 'item'),
      productName: clip(it.productName, 160),
      quantity: num(it.quantity),
      unit: clip(it.unit, 32),
      rate: num(it.rate),
      total: num(it.total),
    })),
    notes: clip(sale.notes || '', 400),
    localUpdatedAt: clip(sale.createdAt || nowIso, 40),
  };
}

export function buildExpenseCloudPayload(
  ownerId: string,
  exp: ExpenseRecord,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  return {
    id: safeId(exp.id),
    ownerId: safeId(ownerId),
    title: clip(String(exp.title || '').trim() || 'Expense', 180),
    category: clip(exp.category || 'misc', 40),
    amount: num(exp.amount),
    isPersonalWithdrawal: Boolean(exp.isPersonalWithdrawal),
    paymentMethod: clip(exp.paymentMethod || 'CASH', 20),
    date: clip(exp.date || nowIso, 40),
    notes: clip(exp.notes || '', 400),
    localUpdatedAt: clip(exp.createdAt || nowIso, 40),
  };
}

export function buildCashbookCloudPayload(
  ownerId: string,
  entry: CashbookEntry,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  return {
    id: safeId(entry.id),
    ownerId: safeId(ownerId),
    date: clip(entry.date || nowIso, 40),
    type: entry.type === 'OUT' ? 'OUT' : 'IN',
    category: clip(entry.category || 'GENERAL', 64),
    description: clip(entry.description || '', 400),
    amount: num(entry.amount),
    paymentMode: clip(entry.paymentMode || 'CASH', 20),
    refType: clip(entry.refType || 'MANUAL', 40),
    refId: clip(entry.refId || '', 128),
    localUpdatedAt: clip(entry.createdAt || nowIso, 40),
  };
}

export function buildProductCloudPayload(
  ownerId: string,
  product: Product,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  return {
    id: safeId(product.id),
    ownerId: safeId(ownerId),
    name: clip(String(product.name || '').trim() || 'Item', 180),
    category: clip(product.category || 'Grocery', 80),
    unit: clip(String(product.unit || '').trim() || 'pcs', 32),
    costPrice: num(product.purchasePrice),
    sellingPrice: num(product.sellingPrice),
    mrp: num(product.mrp),
    stockQty: num(product.stockQty),
    minStockAlert: num(product.minStockAlert),
    preferredSupplierId: clip(product.preferredSupplierId || '', 128),
    preferredSupplierName: clip(product.preferredSupplierName || '', 160),
    isArchived: Boolean(product.isArchived),
    localUpdatedAt: clip(product.updatedAt || nowIso, 40),
  };
}

export function buildBackupManifestCloudPayload(
  ownerId: string,
  snap: LocalBackupSnapshot
): Record<string, unknown> {
  return {
    id: safeId(snap.id),
    ownerId: safeId(ownerId),
    bucket: snap.bucket,
    trigger: snap.trigger,
    checksum: clip((snap.checksum || '00000000').padEnd(8, '0'), 128),
    sizeBytes: num(snap.sizeBytes),
    totalTransactions: num(snap.summary?.totalTransactions),
    salesCount: num(snap.summary?.salesCount),
    customersCount: num(snap.summary?.customersCount),
    productsCount: num(snap.summary?.productsCount),
    localCreatedAt: clip(snap.createdAt, 40),
  };
}
