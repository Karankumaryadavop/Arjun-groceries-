import {
  Product,
  PurchaseReturnLineItem,
  PurchaseReturnReason,
  Supplier,
  SupplierTransaction,
} from '../types';
import { convertToBaseUnitStrict, normalizeUnit } from './units';

export interface PurchaseReturnReasonOption {
  value: PurchaseReturnReason;
  label: string;
  shortLabel: string;
}

export const PURCHASE_RETURN_REASONS: PurchaseReturnReasonOption[] = [
  { value: 'DAMAGED', label: 'Damaged in Transit / Torn Packaging', shortLabel: 'Damaged' },
  { value: 'EXPIRED', label: 'Expired / Near Expiry Date', shortLabel: 'Expired' },
  { value: 'DEFECTIVE', label: 'Defective / Spoiled Goods', shortLabel: 'Defective' },
  { value: 'WRONG_ITEM', label: 'Wrong Item / Variant Delivered', shortLabel: 'Wrong Item' },
  { value: 'EXCESS_STOCK', label: 'Excess / Unordered Quantity', shortLabel: 'Excess Stock' },
  { value: 'QUALITY_ISSUE', label: 'Quality / Weight Mismatch', shortLabel: 'Quality Issue' },
  { value: 'OTHER', label: 'Other Supplier Return', shortLabel: 'Other' },
];

export function getPurchaseReturnReasonLabel(reason?: PurchaseReturnReason): string {
  const found = PURCHASE_RETURN_REASONS.find((r) => r.value === reason);
  return found ? found.shortLabel : 'Damaged / Return';
}

export interface PurchaseReturnLineInput {
  productId?: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  reason?: PurchaseReturnReason;
}

export function generateCreditNoteNumber(
  existingTransactions: SupplierTransaction[],
  dateIso?: string
): string {
  const parsedDate = dateIso ? new Date(dateIso) : new Date();
  const year = Number.isNaN(parsedDate.getTime())
    ? new Date().getFullYear()
    : parsedDate.getFullYear();

  const prefix = `CN-${year}-`;
  let maxSeq = 0;

  for (const tx of existingTransactions) {
    const candidates = [tx.creditNoteNo, tx.invoiceNo];
    for (const c of candidates) {
      if (!c) continue;
      if (c.toUpperCase().startsWith(prefix)) {
        const numPart = parseInt(c.slice(prefix.length).replace(/[^0-9]/g, ''), 10);
        if (Number.isFinite(numPart) && numPart > maxSeq) {
          maxSeq = numPart;
        }
      }
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

export function normalizePurchaseReturnItems(
  items: PurchaseReturnLineInput[],
  products: Product[],
  defaultReason: PurchaseReturnReason = 'DAMAGED'
): {
  valid: boolean;
  error?: string;
  items: PurchaseReturnLineItem[];
  totalAmount: number;
} {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      valid: false,
      error: 'Please add at least one item to return.',
      items: [],
      totalAmount: 0,
    };
  }

  const normalized: PurchaseReturnLineItem[] = [];
  let grandTotal = 0;

  for (const raw of items) {
    const qty = Number(raw.quantity);
    const price = Number(raw.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) {
      return {
        valid: false,
        error: `Return quantity for "${raw.productName || 'item'}" must be greater than zero.`,
        items: [],
        totalAmount: 0,
      };
    }
    if (!Number.isFinite(price) || price <= 0) {
      return {
        valid: false,
        error: `Unit credit rate for "${raw.productName || 'item'}" must be greater than zero.`,
        items: [],
        totalAmount: 0,
      };
    }

    const prod = raw.productId ? products.find((p) => p.id === raw.productId) : undefined;
    const effectiveName = (raw.productName || prod?.name || '').trim();
    if (!effectiveName) {
      return {
        valid: false,
        error: 'Each returned item must have a product name.',
        items: [],
        totalAmount: 0,
      };
    }

    const effectiveUnit = (raw.unit || prod?.unit || 'pcs').trim();
    let baseUnit: string | undefined;
    let baseQuantity: number | undefined;

    if (prod) {
      baseUnit = prod.unit;
      const converted = convertToBaseUnitStrict(qty, effectiveUnit, prod.unit);
      if (!converted.valid) {
        return {
          valid: false,
          error:
            converted.error ||
            `Unit "${effectiveUnit}" is incompatible with ${prod.name}'s inventory unit (${prod.unit}).`,
          items: [],
          totalAmount: 0,
        };
      }
      baseQuantity = Math.round(converted.baseQuantity * 10000) / 10000;
    }

    const lineTotal = Math.round(qty * price * 100) / 100;
    grandTotal = Math.round((grandTotal + lineTotal) * 100) / 100;

    normalized.push({
      productId: prod?.id || raw.productId,
      productName: effectiveName,
      quantity: Math.round(qty * 10000) / 10000,
      unit: effectiveUnit,
      baseUnit,
      baseQuantity,
      unitPrice: Math.round(price * 100) / 100,
      total: lineTotal,
      reason: raw.reason || defaultReason,
    });
  }

  return {
    valid: true,
    items: normalized,
    totalAmount: grandTotal,
  };
}

export function validatePurchaseReturnStockAvailability(params: {
  items: PurchaseReturnLineItem[];
  products: Product[];
  allowNegativeStock: boolean;
}): { valid: boolean; error?: string } {
  if (params.allowNegativeStock) {
    return { valid: true };
  }

  const requiredByProduct = new Map<string, number>();
  for (const item of params.items) {
    if (!item.productId) continue;
    const prod = params.products.find((p) => p.id === item.productId);
    if (!prod) continue;
    let baseQty: number;
    if (item.baseQuantity !== undefined) {
      baseQty = item.baseQuantity;
    } else {
      const converted = convertToBaseUnitStrict(item.quantity, item.unit, prod.unit);
      if (!converted.valid) {
        return {
          valid: false,
          error:
            converted.error ||
            `Unit "${item.unit}" is incompatible with ${prod.name}'s base unit (${prod.unit}).`,
        };
      }
      baseQty = converted.baseQuantity;
    }
    requiredByProduct.set(
      prod.id,
      Math.round(((requiredByProduct.get(prod.id) || 0) + baseQty) * 10000) / 10000
    );
  }

  for (const [productId, requiredBaseQty] of requiredByProduct.entries()) {
    const prod = params.products.find((p) => p.id === productId);
    if (!prod) continue;
    const currentStock = Number(prod.stockQty) || 0;
    if (currentStock + 0.0001 < requiredBaseQty) {
      return {
        valid: false,
        error: `Insufficient stock to return ${requiredBaseQty} ${prod.unit} of ${prod.name}. Available stock: ${currentStock} ${prod.unit}.`,
      };
    }
  }

  return { valid: true };
}

export function buildPurchaseReturnItemsSummary(items: PurchaseReturnLineItem[]): string {
  return items
    .map((it) => `${it.quantity} ${it.unit} ${it.productName}`)
    .join(', ');
}

export interface PurchaseReturnSummaryMetrics {
  totalReturnsCount: number;
  activeReturnsCount: number;
  cancelledReturnsCount: number;
  totalCreditNoteValue: number;
  totalUnitsReturned: number;
  damagedOrExpiredValue: number;
  suppliersCreditedCount: number;
  returns: SupplierTransaction[];
}

export function buildPurchaseReturnSummary(
  supplierTransactions: SupplierTransaction[],
  suppliers: Supplier[]
): PurchaseReturnSummaryMetrics {
  const returns = supplierTransactions
    .filter((tx) => tx.type === 'RETURN')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const active = returns.filter(
    (tx) => tx.status !== 'CANCELLED' && tx.status !== 'REVERSED'
  );
  const cancelled = returns.filter(
    (tx) => tx.status === 'CANCELLED' || tx.status === 'REVERSED'
  );

  let totalCreditNoteValue = 0;
  let totalUnitsReturned = 0;
  let damagedOrExpiredValue = 0;
  const creditedSupplierIds = new Set<string>();
  const validSupplierIds = new Set(suppliers.map((s) => s.id));

  for (const tx of active) {
    const amt = Math.max(0, Number(tx.amount) || 0);
    totalCreditNoteValue = Math.round((totalCreditNoteValue + amt) * 100) / 100;

    if (tx.supplierId && validSupplierIds.has(tx.supplierId)) {
      creditedSupplierIds.add(tx.supplierId);
    }

    if (
      tx.returnReason === 'DAMAGED' ||
      tx.returnReason === 'EXPIRED' ||
      tx.returnReason === 'DEFECTIVE'
    ) {
      damagedOrExpiredValue = Math.round((damagedOrExpiredValue + amt) * 100) / 100;
    }

    if (tx.returnItems && tx.returnItems.length > 0) {
      for (const item of tx.returnItems) {
        totalUnitsReturned =
          Math.round((totalUnitsReturned + (Number(item.quantity) || 0)) * 1000) / 1000;
      }
    } else if (tx.quantity && tx.quantity > 0) {
      totalUnitsReturned =
        Math.round((totalUnitsReturned + Number(tx.quantity)) * 1000) / 1000;
    }
  }

  return {
    totalReturnsCount: returns.length,
    activeReturnsCount: active.length,
    cancelledReturnsCount: cancelled.length,
    totalCreditNoteValue,
    totalUnitsReturned,
    damagedOrExpiredValue,
    suppliersCreditedCount: creditedSupplierIds.size,
    returns,
  };
}

export function buildCreditNoteReceiptText(params: {
  tx: SupplierTransaction;
  storeName: string;
  supplierName: string;
}): string {
  const cnNo = params.tx.creditNoteNo || params.tx.invoiceNo || params.tx.id;
  const lines = [
    `CREDIT NOTE: ${cnNo}`,
    `Store: ${params.storeName}`,
    `Supplier: ${params.supplierName}`,
    `Date: ${new Date(params.tx.date).toLocaleDateString('en-IN')}`,
    params.tx.originalInvoiceNo ? `Original Bill: #${params.tx.originalInvoiceNo}` : '',
    `Reason: ${getPurchaseReturnReasonLabel(params.tx.returnReason)}`,
    `Credit Value: Rs. ${Number(params.tx.amount || 0).toFixed(2)}`,
  ].filter(Boolean);

  if (params.tx.returnItems && params.tx.returnItems.length > 0) {
    lines.push('Items:');
    for (const item of params.tx.returnItems) {
      lines.push(
        `- ${item.productName}: ${item.quantity} ${normalizeUnit(item.unit)} @ Rs.${item.unitPrice} = Rs.${item.total}`
      );
    }
  } else if (params.tx.description) {
    lines.push(`Details: ${params.tx.description}`);
  }

  return lines.join('\n');
}
