/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, SaleRecord, Supplier } from '../types';
import { isSaleActive } from './accounting';
import { convertToBaseUnitStrict } from './units';

export type StockVelocityFlag = 'REORDER' | 'LOW_STOCK' | 'HEALTHY';

export interface StockVelocityConfig {
  lookbackDays: number; // default 30 days
  reorderLeadDays: number; // default 7 days cover => REORDER flag
  lowStockWarningDays: number; // default 14 days cover => LOW_STOCK flag
  targetCoverDays: number; // default 21 days target stock for suggested reorder qty
}

export const DEFAULT_STOCK_VELOCITY_CONFIG: StockVelocityConfig = {
  lookbackDays: 30,
  reorderLeadDays: 7,
  lowStockWarningDays: 14,
  targetCoverDays: 21,
};

export interface StockVelocityItem {
  product: Product;
  currentStock: number;
  minStockAlert: number;
  soldLast30Days: number; // in product's base unit
  salesTransactionsCount: number;
  dailySalesVelocity: number; // base units / day
  daysOfStockLeft: number | null; // null when velocity === 0 and stock > 0
  flag: StockVelocityFlag;
  flagLabel: 'Reorder' | 'Low Stock' | 'Healthy';
  reason: string;
  recommendedReorderQty: number;
  estimatedReorderCost: number;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
  preferredSupplierPhone?: string;
  lastPurchasePrice: number;
}

export interface StockVelocitySummary {
  totalActiveProducts: number;
  reorderCount: number;
  lowStockCount: number;
  healthyCount: number;
  outOfStockCount: number;
  fastMovingAtRiskCount: number; // velocity > 0 and flagged REORDER or LOW_STOCK
  estimatedTotalReorderCost: number;
  lookbackDays: number;
}

export interface StockVelocityMonitorReport {
  items: StockVelocityItem[];
  flaggedItems: StockVelocityItem[];
  summary: StockVelocitySummary;
  config: StockVelocityConfig;
}

function roundQty(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val * 100) / 100;
}

function parseSaleTimestamp(dateStr: string): number {
  const ts = new Date(dateStr).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Computes automated stock monitoring flags ('Reorder' / 'Low Stock' / 'Healthy')
 * by comparing each active product's current inventory level against its recent
 * 30-day sales velocity (excluding cancelled/reversed sales).
 */
export function buildStockVelocityMonitorReport(params: {
  products: Product[];
  sales: SaleRecord[];
  suppliers?: Supplier[];
  now?: Date;
  config?: Partial<StockVelocityConfig>;
}): StockVelocityMonitorReport {
  const { products, sales, suppliers = [], now = new Date() } = params;

  const lookbackDays = Math.max(7, Math.min(90, Math.round(params.config?.lookbackDays ?? DEFAULT_STOCK_VELOCITY_CONFIG.lookbackDays)));
  const reorderLeadDays = Math.max(1, Math.min(60, Math.round(params.config?.reorderLeadDays ?? DEFAULT_STOCK_VELOCITY_CONFIG.reorderLeadDays)));
  const lowStockWarningDays = Math.max(
    reorderLeadDays + 1,
    Math.min(90, Math.round(params.config?.lowStockWarningDays ?? DEFAULT_STOCK_VELOCITY_CONFIG.lowStockWarningDays))
  );
  const targetCoverDays = Math.max(
    lowStockWarningDays,
    Math.min(120, Math.round(params.config?.targetCoverDays ?? DEFAULT_STOCK_VELOCITY_CONFIG.targetCoverDays))
  );

  const resolvedConfig: StockVelocityConfig = {
    lookbackDays,
    reorderLeadDays,
    lowStockWarningDays,
    targetCoverDays,
  };

  const nowMs = now.getTime();
  const windowStartMs = nowMs - lookbackDays * 24 * 60 * 60 * 1000;

  const activeProducts = products.filter((p) => !p.isArchived);
  const productById = new Map<string, Product>();
  const productByLowerName = new Map<string, Product>();
  for (const p of activeProducts) {
    productById.set(p.id, p);
    productByLowerName.set(p.name.trim().toLowerCase(), p);
  }

  const supplierById = new Map<string, Supplier>();
  for (const s of suppliers) {
    supplierById.set(s.id, s);
  }

  // Aggregate 30-day sold quantity per product in base units
  const soldByProductId = new Map<string, number>();
  const txCountByProductId = new Map<string, number>();

  for (const sale of sales) {
    if (!isSaleActive(sale)) continue;
    const saleTs = parseSaleTimestamp(sale.date);
    if (saleTs < windowStartMs || saleTs > nowMs + 86_400_000) continue;
    if (!Array.isArray(sale.items) || sale.items.length === 0) continue;

    const seenInSale = new Set<string>();
    for (const item of sale.items) {
      const matchedProduct =
        (item.productId ? productById.get(item.productId) : undefined) ||
        (item.productName ? productByLowerName.get(item.productName.trim().toLowerCase()) : undefined);

      if (!matchedProduct) continue;

      let baseQtySold = 0;
      if (typeof item.baseQuantity === 'number' && Number.isFinite(item.baseQuantity) && item.baseQuantity > 0) {
        baseQtySold = item.baseQuantity;
      } else if (item.quantity > 0) {
        const conversion = convertToBaseUnitStrict(
          item.quantity,
          item.unit || matchedProduct.unit,
          matchedProduct.unit
        );
        baseQtySold = conversion.valid ? conversion.baseQuantity : item.quantity;
      }

      if (baseQtySold > 0) {
        soldByProductId.set(
          matchedProduct.id,
          (soldByProductId.get(matchedProduct.id) || 0) + baseQtySold
        );
        if (!seenInSale.has(matchedProduct.id)) {
          seenInSale.add(matchedProduct.id);
          txCountByProductId.set(
            matchedProduct.id,
            (txCountByProductId.get(matchedProduct.id) || 0) + 1
          );
        }
      }
    }
  }

  const items: StockVelocityItem[] = activeProducts.map((product) => {
    const currentStock = Math.max(0, Number(product.stockQty) || 0);
    const minStockAlert = Math.max(0, Number(product.minStockAlert) || 0);
    const soldLast30Days = roundQty(soldByProductId.get(product.id) || 0);
    const salesTransactionsCount = txCountByProductId.get(product.id) || 0;
    const dailySalesVelocity = roundQty(soldLast30Days / lookbackDays);

    let daysOfStockLeft: number | null = null;
    if (currentStock <= 0) {
      daysOfStockLeft = 0;
    } else if (dailySalesVelocity > 0) {
      daysOfStockLeft = Math.round((currentStock / dailySalesVelocity) * 10) / 10;
    }

    // Automated Flag Classification
    let flag: StockVelocityFlag = 'HEALTHY';
    let reason =
      dailySalesVelocity > 0 && daysOfStockLeft !== null
        ? `~${daysOfStockLeft} days of stock at recent 30-day sales pace`
        : 'Stock above minimum threshold';

    if (currentStock <= 0) {
      flag = 'REORDER';
      reason =
        dailySalesVelocity > 0
          ? `Out of stock · sells ${dailySalesVelocity} ${product.unit}/day`
          : 'Out of stock (0 remaining)';
    } else if (daysOfStockLeft !== null && daysOfStockLeft <= reorderLeadDays) {
      flag = 'REORDER';
      reason = `Only ~${daysOfStockLeft} days left at ${dailySalesVelocity} ${product.unit}/day pace`;
    } else if (minStockAlert > 0 && currentStock <= minStockAlert * 0.5) {
      flag = 'REORDER';
      reason = `Critically low (${currentStock} <= 50% of min alert ${minStockAlert})`;
    } else if (daysOfStockLeft !== null && daysOfStockLeft <= lowStockWarningDays) {
      flag = 'LOW_STOCK';
      reason = `~${daysOfStockLeft} days left (under ${lowStockWarningDays}-day cover buffer)`;
    } else if (minStockAlert > 0 && currentStock <= minStockAlert) {
      flag = 'LOW_STOCK';
      reason = `At or below min alert (${currentStock} / ${minStockAlert} ${product.unit})`;
    }

    // Recommended Reorder Quantity: max of velocity-based target cover or desiredStockLevel / 2x minStockAlert
    const velocityTarget = dailySalesVelocity > 0 ? Math.ceil(dailySalesVelocity * targetCoverDays) : 0;
    const staticTarget =
      typeof product.desiredStockLevel === 'number' && product.desiredStockLevel > 0
        ? product.desiredStockLevel
        : Math.max(minStockAlert * 2, 10);

    const targetStock = flag === 'HEALTHY' ? currentStock : Math.max(velocityTarget, staticTarget);
    const recommendedReorderQty =
      flag === 'HEALTHY' ? 0 : Math.max(1, Math.ceil(targetStock - currentStock));

    const lastPurchasePrice =
      typeof product.lastPurchasePrice === 'number' && product.lastPurchasePrice > 0
        ? product.lastPurchasePrice
        : Math.max(0, Number(product.purchasePrice) || 0);
    const estimatedReorderCost = Math.round(recommendedReorderQty * lastPurchasePrice);

    const sup = product.preferredSupplierId ? supplierById.get(product.preferredSupplierId) : undefined;

    return {
      product,
      currentStock,
      minStockAlert,
      soldLast30Days,
      salesTransactionsCount,
      dailySalesVelocity,
      daysOfStockLeft,
      flag,
      flagLabel: flag === 'REORDER' ? 'Reorder' : flag === 'LOW_STOCK' ? 'Low Stock' : 'Healthy',
      reason,
      recommendedReorderQty,
      estimatedReorderCost,
      preferredSupplierId: sup?.id || product.preferredSupplierId,
      preferredSupplierName: sup?.name || product.preferredSupplierName,
      preferredSupplierPhone: sup?.phone || product.preferredSupplierPhone,
      lastPurchasePrice,
    };
  });

  // Sort: REORDER first (lowest daysOfStockLeft / highest velocity first), then LOW_STOCK, then HEALTHY
  const flagRank: Record<StockVelocityFlag, number> = {
    REORDER: 0,
    LOW_STOCK: 1,
    HEALTHY: 2,
  };

  items.sort((a, b) => {
    if (flagRank[a.flag] !== flagRank[b.flag]) {
      return flagRank[a.flag] - flagRank[b.flag];
    }
    const daysA = a.daysOfStockLeft ?? 99999;
    const daysB = b.daysOfStockLeft ?? 99999;
    if (daysA !== daysB) return daysA - daysB;
    if (b.dailySalesVelocity !== a.dailySalesVelocity) {
      return b.dailySalesVelocity - a.dailySalesVelocity;
    }
    return a.product.name.localeCompare(b.product.name);
  });

  const flaggedItems = items.filter((it) => it.flag !== 'HEALTHY');
  const reorderCount = items.filter((it) => it.flag === 'REORDER').length;
  const lowStockCount = items.filter((it) => it.flag === 'LOW_STOCK').length;
  const outOfStockCount = items.filter((it) => it.currentStock <= 0).length;
  const fastMovingAtRiskCount = flaggedItems.filter((it) => it.dailySalesVelocity > 0).length;
  const estimatedTotalReorderCost = flaggedItems.reduce((sum, it) => sum + it.estimatedReorderCost, 0);

  return {
    items,
    flaggedItems,
    summary: {
      totalActiveProducts: activeProducts.length,
      reorderCount,
      lowStockCount,
      healthyCount: activeProducts.length - flaggedItems.length,
      outOfStockCount,
      fastMovingAtRiskCount,
      estimatedTotalReorderCost,
      lookbackDays,
    },
    config: resolvedConfig,
  };
}
