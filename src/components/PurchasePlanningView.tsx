/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  LowStockItemView,
  buildLowStockItems,
  groupLowStockBySupplier,
} from '../utils/lowStock';
import { formatINR } from '../utils/accounting';
import { Product, Supplier } from '../types';
import {
  CheckCircle2,
  PackagePlus,
  Phone,
  Store,
  UserCheck,
  AlertCircle,
} from 'lucide-react';

interface PurchasePlanningViewProps {
  products: Product[];
  suppliers: Supplier[];
  onViewSupplier: (supplierId: string) => void;
  onAddPurchaseForProduct: (item: LowStockItemView) => void;
  onSwitchToLowStock: () => void;
}

export const PurchasePlanningView: React.FC<PurchasePlanningViewProps> = ({
  products,
  suppliers,
  onViewSupplier,
  onAddPurchaseForProduct,
  onSwitchToLowStock,
}) => {
  const lowStockItems = useMemo(
    () => buildLowStockItems(products, suppliers),
    [products, suppliers]
  );

  const groups = useMemo(
    () => groupLowStockBySupplier(lowStockItems, suppliers),
    [lowStockItems, suppliers]
  );

  const grandTotal = useMemo(
    () => groups.reduce((sum, g) => sum + g.estimatedSupplierTotal, 0),
    [groups]
  );

  if (lowStockItems.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-10 border border-slate-200 dark:border-slate-800 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
          No Replenishment Needed Right Now
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          When products fall below their low-stock limits, supplier-wise purchase plans will appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Summary */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
            Supplier-Wise Purchase Planning
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Review items grouped by Preferred Supplier before recording purchases. No purchases are auto-saved without your confirmation.
          </p>
        </div>
        <div className="text-left sm:text-right shrink-0 tabular-nums">
          <div className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400">
            Total Estimated Plan ({groups.length} {groups.length === 1 ? 'Group' : 'Groups'})
          </div>
          <div className="text-xl font-extrabold text-emerald-900 dark:text-emerald-300">
            {formatINR(grandTotal)}
          </div>
        </div>
      </div>

      {/* Supplier Groups */}
      <div className="space-y-4">
        {groups.map((group) => (
          <div
            key={group.groupKey}
            className={`bg-white dark:bg-slate-900 rounded-2xl border shadow-xs overflow-hidden ${
              group.isUnassigned
                ? 'border-amber-300 dark:border-amber-800'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            {/* Group Header */}
            <div
              className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                group.isUnassigned
                  ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                  : 'bg-slate-50/80 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`p-2 rounded-xl shrink-0 ${
                    group.isUnassigned
                      ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300'
                      : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                  }`}
                >
                  {group.isUnassigned ? (
                    <AlertCircle className="w-5 h-5" />
                  ) : (
                    <Store className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                    {group.supplierName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                    {group.supplierPhone && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Phone className="w-3 h-3" />
                        {group.supplierPhone}
                      </span>
                    )}
                    <span>
                      {group.totalItemsCount} {group.totalItemsCount === 1 ? 'item' : 'items'}
                    </span>
                    {group.outOfStockCount > 0 && (
                      <span className="text-red-700 dark:text-red-400 font-bold">
                        {group.outOfStockCount} out of stock
                      </span>
                    )}
                    {group.criticalStockCount > 0 && (
                      <span className="text-amber-700 dark:text-amber-400 font-bold">
                        {group.criticalStockCount} critical
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3">
                <div className="text-left sm:text-right tabular-nums">
                  <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                    Estimated Supplier Total
                  </div>
                  <div className="text-lg font-extrabold text-emerald-900 dark:text-emerald-300">
                    {formatINR(group.estimatedSupplierTotal)}
                  </div>
                </div>

                {!group.isUnassigned && group.supplierId ? (
                  <button
                    type="button"
                    onClick={() => onViewSupplier(group.supplierId!)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold cursor-pointer shrink-0"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                    <span>View Supplier</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSwitchToLowStock}
                    className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer shrink-0"
                  >
                    Assign Suppliers
                  </button>
                )}
              </div>
            </div>

            {/* Group Items */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {group.items.map((item) => (
                <div
                  key={item.product.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                        {item.product.name}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          item.status === 'OUT_OF_STOCK'
                            ? 'bg-red-700 text-white'
                            : item.status === 'CRITICAL_STOCK'
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200'
                        }`}
                      >
                        {item.status === 'OUT_OF_STOCK'
                          ? 'Out of Stock'
                          : item.status === 'CRITICAL_STOCK'
                          ? 'Critical Stock'
                          : 'Low Stock'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      Stock: <strong>{item.currentStock}</strong> / Limit: {item.lowStockLimit} {item.product.unit} · Target: {item.desiredStockLevel} {item.product.unit}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 tabular-nums">
                    <div className="text-left sm:text-right text-xs">
                      <div className="font-bold text-emerald-800 dark:text-emerald-300">
                        Buy {item.suggestedPurchaseQty} {item.product.unit} × {formatINR(item.lastPurchasePrice)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Est: <strong className="text-slate-900 dark:text-slate-100">{formatINR(item.estimatedPurchaseCost)}</strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onAddPurchaseForProduct(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold cursor-pointer shrink-0"
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      <span>Add Purchase</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
