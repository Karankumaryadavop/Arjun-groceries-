/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, Supplier } from '../types';

export type LowStockStatus = 'OUT_OF_STOCK' | 'CRITICAL_STOCK' | 'LOW_STOCK' | 'OK' | 'ARCHIVED';

export interface LowStockItemView {
  product: Product;
  status: 'OUT_OF_STOCK' | 'CRITICAL_STOCK' | 'LOW_STOCK';
  currentStock: number;
  lowStockLimit: number;
  desiredStockLevel: number;
  suggestedPurchaseQty: number;
  lastPurchasePrice: number;
  lastPurchaseDate?: string;
  estimatedPurchaseCost: number;
  preferredSupplier?: Supplier;
  preferredSupplierId?: string;
  preferredSupplierName: string;
  preferredSupplierPhone?: string;
  hasPreferredSupplier: boolean;
  supplierNotes?: string;
}

export interface LowStockDashboardSummary {
  totalLowStockProducts: number;
  outOfStockCount: number;
  criticalStockCount: number;
  lowStockOnlyCount: number;
  unassignedSupplierCount: number;
  estimatedReplenishmentCost: number;
}

export interface SupplierPurchasePlanGroup {
  groupKey: string; // supplierId or 'UNASSIGNED'
  isUnassigned: boolean;
  supplier?: Supplier;
  supplierId?: string;
  supplierName: string;
  supplierPhone?: string;
  items: LowStockItemView[];
  totalItemsCount: number;
  totalSuggestedQty: number;
  estimatedSupplierTotal: number;
  outOfStockCount: number;
  criticalStockCount: number;
}

export function roundQty(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.round((val + Number.EPSILON) * 1000) / 1000);
}

export function roundCurrency(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.round((val + Number.EPSILON) * 100) / 100);
}

/**
 * Classifies product inventory health:
 * - OUT_OF_STOCK: active product with stockQty <= 0
 * - CRITICAL_STOCK: active product with 0 < stockQty <= critical threshold (<= 50% of limit or <= 1 when limit >= 2)
 * - LOW_STOCK: active product with stockQty <= minStockAlert (and above critical threshold)
 * - OK: stockQty > minStockAlert
 */
export function classifyStockStatus(product: Product): LowStockStatus {
  if (product.isArchived) return 'ARCHIVED';
  const stock = Number(product.stockQty) || 0;
  const limit = Math.max(0, Number(product.minStockAlert) || 0);

  if (stock <= 0) {
    return 'OUT_OF_STOCK';
  }
  if (stock > limit) {
    return 'OK';
  }

  // stock > 0 and stock <= limit
  if (limit >= 2 && stock <= Math.max(1, limit * 0.5)) {
    return 'CRITICAL_STOCK';
  }
  return 'LOW_STOCK';
}

/**
 * Resolves the target Desired Stock Level for replenishment planning.
 * Uses user-configured desiredStockLevel if explicitly provided (> 0),
 * otherwise falls back to max(minStockAlert * 2, minStockAlert + 5).
 */
export function resolveDesiredStockLevel(product: Product): number {
  const configured = Number(product.desiredStockLevel);
  if (Number.isFinite(configured) && configured > 0) {
    return roundQty(configured);
  }
  const limit = Math.max(0, Number(product.minStockAlert) || 0);
  if (limit === 0) {
    return 5;
  }
  return roundQty(Math.max(limit * 2, limit + 5));
}

/**
 * Suggested Purchase Qty = max(0, Desired Stock Level - Current Stock).
 */
export function calculateSuggestedPurchaseQty(product: Product): number {
  const desired = resolveDesiredStockLevel(product);
  const current = Math.max(0, Number(product.stockQty) || 0);
  return roundQty(Math.max(0, desired - current));
}

/**
 * Resolves last known unit purchase cost separately from sellingPrice.
 */
export function resolveLastPurchasePrice(product: Product): number {
  if (product.lastPurchasePrice !== undefined && Number.isFinite(Number(product.lastPurchasePrice)) && Number(product.lastPurchasePrice) >= 0) {
    return Number(product.lastPurchasePrice);
  }
  return Math.max(0, Number(product.purchasePrice) || 0);
}

/**
 * Builds enriched low-stock rows with preferred supplier info, suggested replenishment qty,
 * and estimated cost without fabricating fake suppliers or altering historical records.
 */
export function buildLowStockItems(
  products: Product[],
  suppliers: Supplier[] = []
): LowStockItemView[] {
  const supplierMap = new Map<string, Supplier>();
  suppliers.forEach((s) => supplierMap.set(s.id, s));

  const severityRank: Record<LowStockItemView['status'], number> = {
    OUT_OF_STOCK: 0,
    CRITICAL_STOCK: 1,
    LOW_STOCK: 2,
  };

  const rows: LowStockItemView[] = [];

  for (const product of products) {
    const status = classifyStockStatus(product);
    if (status !== 'OUT_OF_STOCK' && status !== 'CRITICAL_STOCK' && status !== 'LOW_STOCK') {
      continue;
    }

    const currentStock = Math.max(0, Number(product.stockQty) || 0);
    const lowStockLimit = Math.max(0, Number(product.minStockAlert) || 0);
    const desiredStockLevel = resolveDesiredStockLevel(product);
    const suggestedPurchaseQty = calculateSuggestedPurchaseQty(product);
    const lastPurchasePrice = resolveLastPurchasePrice(product);
    const estimatedPurchaseCost = roundCurrency(suggestedPurchaseQty * lastPurchasePrice);

    const liveSupplier = product.preferredSupplierId
      ? supplierMap.get(product.preferredSupplierId)
      : undefined;

    const resolvedSupplierName =
      liveSupplier?.name?.trim() ||
      product.preferredSupplierName?.trim() ||
      '';
    const hasPreferredSupplier = !!resolvedSupplierName && (!!liveSupplier || !!product.preferredSupplierId);

    rows.push({
      product,
      status,
      currentStock,
      lowStockLimit,
      desiredStockLevel,
      suggestedPurchaseQty,
      lastPurchasePrice,
      lastPurchaseDate: product.lastPurchaseDate,
      estimatedPurchaseCost,
      preferredSupplier: liveSupplier,
      preferredSupplierId: liveSupplier?.id || (hasPreferredSupplier ? product.preferredSupplierId : undefined),
      preferredSupplierName: hasPreferredSupplier ? resolvedSupplierName : 'Supplier Not Assigned',
      preferredSupplierPhone: liveSupplier?.phone || product.preferredSupplierPhone,
      hasPreferredSupplier,
      supplierNotes: product.supplierNotes,
    });
  }

  return rows.sort((a, b) => {
    const rankDiff = severityRank[a.status] - severityRank[b.status];
    if (rankDiff !== 0) return rankDiff;
    const ratioA = a.lowStockLimit > 0 ? a.currentStock / a.lowStockLimit : 0;
    const ratioB = b.lowStockLimit > 0 ? b.currentStock / b.lowStockLimit : 0;
    if (ratioA !== ratioB) return ratioA - ratioB;
    return a.product.name.localeCompare(b.product.name);
  });
}

export function calculateLowStockSummary(items: LowStockItemView[]): LowStockDashboardSummary {
  let outOfStockCount = 0;
  let criticalStockCount = 0;
  let lowStockOnlyCount = 0;
  let unassignedSupplierCount = 0;
  let estimatedReplenishmentCost = 0;

  for (const item of items) {
    if (item.status === 'OUT_OF_STOCK') outOfStockCount++;
    else if (item.status === 'CRITICAL_STOCK') criticalStockCount++;
    else lowStockOnlyCount++;

    if (!item.hasPreferredSupplier) unassignedSupplierCount++;
    estimatedReplenishmentCost += item.estimatedPurchaseCost;
  }

  return {
    totalLowStockProducts: items.length,
    outOfStockCount,
    criticalStockCount,
    lowStockOnlyCount,
    unassignedSupplierCount,
    estimatedReplenishmentCost: roundCurrency(estimatedReplenishmentCost),
  };
}

export interface LowStockFilterOptions {
  statusFilter: 'ALL' | 'OUT_OF_STOCK' | 'CRITICAL_STOCK' | 'LOW_STOCK';
  category: string;
  supplierFilter: string; // 'ALL' | 'UNASSIGNED' | supplierId
  searchQuery: string;
}

export function filterLowStockItems(
  items: LowStockItemView[],
  filter: LowStockFilterOptions
): LowStockItemView[] {
  const q = (filter.searchQuery || '').trim().toLowerCase();

  return items.filter((item) => {
    if (filter.statusFilter !== 'ALL' && item.status !== filter.statusFilter) {
      return false;
    }
    if (filter.category && filter.category !== 'ALL' && item.product.category !== filter.category) {
      return false;
    }
    if (filter.supplierFilter && filter.supplierFilter !== 'ALL') {
      if (filter.supplierFilter === 'UNASSIGNED') {
        if (item.hasPreferredSupplier) return false;
      } else if (item.preferredSupplierId !== filter.supplierFilter) {
        return false;
      }
    }
    if (q) {
      const nameMatch = item.product.name.toLowerCase().includes(q);
      const localMatch = (item.product.localName || '').toLowerCase().includes(q);
      const catMatch = (item.product.category || '').toLowerCase().includes(q);
      const supMatch = item.preferredSupplierName.toLowerCase().includes(q);
      if (!nameMatch && !localMatch && !catMatch && !supMatch) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Groups low-stock products by preferred supplier (and an Unassigned group)
 * for Supplier-Wise Purchase Planning. Never auto-creates purchases.
 */
export function groupLowStockBySupplier(
  items: LowStockItemView[],
  suppliers: Supplier[] = []
): SupplierPurchasePlanGroup[] {
  const supplierMap = new Map<string, Supplier>();
  suppliers.forEach((s) => supplierMap.set(s.id, s));

  const groupMap = new Map<string, LowStockItemView[]>();

  for (const item of items) {
    const key = item.hasPreferredSupplier && item.preferredSupplierId
      ? item.preferredSupplierId
      : 'UNASSIGNED';
    const list = groupMap.get(key) || [];
    list.push(item);
    groupMap.set(key, list);
  }

  const groups: SupplierPurchasePlanGroup[] = [];

  groupMap.forEach((groupItems, groupKey) => {
    const isUnassigned = groupKey === 'UNASSIGNED';
    const sup = !isUnassigned ? supplierMap.get(groupKey) || groupItems[0]?.preferredSupplier : undefined;

    const totalSuggestedQty = roundQty(
      groupItems.reduce((sum, it) => sum + it.suggestedPurchaseQty, 0)
    );
    const estimatedSupplierTotal = roundCurrency(
      groupItems.reduce((sum, it) => sum + it.estimatedPurchaseCost, 0)
    );
    const outOfStockCount = groupItems.filter((it) => it.status === 'OUT_OF_STOCK').length;
    const criticalStockCount = groupItems.filter((it) => it.status === 'CRITICAL_STOCK').length;

    groups.push({
      groupKey,
      isUnassigned,
      supplier: sup,
      supplierId: isUnassigned ? undefined : groupKey,
      supplierName: isUnassigned
        ? 'Supplier Not Assigned'
        : sup?.name || groupItems[0]?.preferredSupplierName || 'Preferred Supplier',
      supplierPhone: isUnassigned ? undefined : sup?.phone || groupItems[0]?.preferredSupplierPhone,
      items: groupItems,
      totalItemsCount: groupItems.length,
      totalSuggestedQty,
      estimatedSupplierTotal,
      outOfStockCount,
      criticalStockCount,
    });
  });

  // Sort assigned suppliers first by estimated total descending, keep UNASSIGNED last
  return groups.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    return b.estimatedSupplierTotal - a.estimatedSupplierTotal;
  });
}

export interface StorePurchaseColumn {
  columnIndex: number;
  colLetter: string;
  groupKey: string;
  supplier?: Supplier;
  supplierId?: string;
  storeName: string;
  storePhone?: string;
  isUnassigned: boolean;
  items: LowStockItemView[];
  estimatedTotal: number;
  outOfStockCount: number;
  criticalStockCount: number;
}

export interface HorizontalStorePurchaseMatrix {
  columns: StorePurchaseColumn[];
  maxRows: number;
  totalLowStockCount: number;
  totalStoresCount: number;
  grandEstimatedTotal: number;
}

export function formatSpreadsheetColumnLabel(index: number): string {
  if (!Number.isFinite(index) || index < 0) return 'A';
  let n = Math.floor(index);
  let label = '';
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/**
 * Arranges low-stock items into a horizontal Purchase-From-Store matrix
 * where each column is a supplier/store name across Row 1 and its needed
 * low-stock products run vertically underneath.
 */
export function buildHorizontalStorePurchaseMatrix(params: {
  items: LowStockItemView[];
  suppliers?: Supplier[];
  includeEmptySuppliers?: boolean;
}): HorizontalStorePurchaseMatrix {
  const suppliersList = params.suppliers || [];
  const includeEmpty = Boolean(params.includeEmptySuppliers);
  const supplierMap = new Map<string, Supplier>(suppliersList.map((s) => [s.id, s]));
  const itemsBySupplier = new Map<string, LowStockItemView[]>();
  const unassignedItems: LowStockItemView[] = [];

  for (const item of params.items) {
    if (item.hasPreferredSupplier && item.preferredSupplierId) {
      const list = itemsBySupplier.get(item.preferredSupplierId) || [];
      list.push(item);
      itemsBySupplier.set(item.preferredSupplierId, list);
    } else {
      unassignedItems.push(item);
    }
  }

  const assignedColumnsRaw: Omit<StorePurchaseColumn, 'columnIndex' | 'colLetter'>[] = [];
  const seenSupplierIds = new Set<string>();

  for (const [supId, colItems] of itemsBySupplier.entries()) {
    seenSupplierIds.add(supId);
    const sup = supplierMap.get(supId) || colItems[0]?.preferredSupplier;
    assignedColumnsRaw.push({
      groupKey: supId,
      supplier: sup,
      supplierId: supId,
      storeName: sup?.name || colItems[0]?.preferredSupplierName || 'Preferred Store',
      storePhone: sup?.phone || colItems[0]?.preferredSupplierPhone,
      isUnassigned: false,
      items: colItems,
      estimatedTotal: roundCurrency(colItems.reduce((sum, it) => sum + it.estimatedPurchaseCost, 0)),
      outOfStockCount: colItems.filter((it) => it.status === 'OUT_OF_STOCK').length,
      criticalStockCount: colItems.filter((it) => it.status === 'CRITICAL_STOCK').length,
    });
  }

  assignedColumnsRaw.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return a.storeName.localeCompare(b.storeName);
  });

  if (includeEmpty) {
    const emptySuppliers = suppliersList
      .filter((s) => !seenSupplierIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const sup of emptySuppliers) {
      assignedColumnsRaw.push({
        groupKey: sup.id,
        supplier: sup,
        supplierId: sup.id,
        storeName: sup.name,
        storePhone: sup.phone,
        isUnassigned: false,
        items: [],
        estimatedTotal: 0,
        outOfStockCount: 0,
        criticalStockCount: 0,
      });
    }
  }

  if (unassignedItems.length > 0) {
    assignedColumnsRaw.push({
      groupKey: 'UNASSIGNED',
      isUnassigned: true,
      storeName: 'Unassigned Store',
      items: unassignedItems,
      estimatedTotal: roundCurrency(unassignedItems.reduce((sum, it) => sum + it.estimatedPurchaseCost, 0)),
      outOfStockCount: unassignedItems.filter((it) => it.status === 'OUT_OF_STOCK').length,
      criticalStockCount: unassignedItems.filter((it) => it.status === 'CRITICAL_STOCK').length,
    });
  }

  const columns: StorePurchaseColumn[] = assignedColumnsRaw.map((col, idx) => ({
    ...col,
    columnIndex: idx,
    colLetter: formatSpreadsheetColumnLabel(idx),
  }));

  const maxRows = columns.reduce((max, col) => Math.max(max, col.items.length), 0);
  const grandEstimatedTotal = roundCurrency(
    columns.reduce((sum, col) => sum + col.estimatedTotal, 0)
  );

  return {
    columns,
    maxRows,
    totalLowStockCount: params.items.length,
    totalStoresCount: columns.length,
    grandEstimatedTotal,
  };
}

function escapeCsvCell(value: string): string {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportHorizontalLowStockCSV(matrix: HorizontalStorePurchaseMatrix): string {
  if (matrix.columns.length === 0) {
    return 'No Purchase Stores Configured\n';
  }
  const headerRow = matrix.columns.map((c) => escapeCsvCell(c.storeName)).join(',');
  const lines = [headerRow];

  for (let r = 0; r < matrix.maxRows; r++) {
    const rowCells = matrix.columns.map((col) => {
      const item = col.items[r];
      if (!item) return '';
      return escapeCsvCell(
        `${item.product.name} (Buy ${item.suggestedPurchaseQty} ${item.product.unit})`
      );
    });
    lines.push(rowCells.join(','));
  }

  return `${lines.join('\n')}\n`;
}

