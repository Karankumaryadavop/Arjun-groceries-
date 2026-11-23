import React from 'react';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ShoppingBag,
  Package,
} from 'lucide-react';
import {
  CriticalStockWidgetData,
  computeStockCoverGaugePct,
} from '../utils/dashboardTrends';
import { StockVelocityItem } from '../utils/stockVelocity';
import { formatINR } from '../utils/accounting';

interface CriticalStockWidgetProps {
  data: CriticalStockWidgetData;
  reorderLeadDays?: number;
  lowStockWarningDays?: number;
  onOpenVelocityMonitor: () => void;
  onOpenInventory: () => void;
  onOrderItem: (item: StockVelocityItem) => void;
}

function formatQty(val: number): string {
  if (!Number.isFinite(val)) return '0';
  return Number.isInteger(val) ? String(val) : val.toFixed(1).replace(/\.0$/, '');
}

export const CriticalStockWidget: React.FC<CriticalStockWidgetProps> = ({
  data,
  reorderLeadDays = 7,
  lowStockWarningDays = 14,
  onOpenVelocityMonitor,
  onOpenInventory,
  onOrderItem,
}) => {
  const hasCritical = data.criticalCount > 0;
  const hasAnyFlagged = data.displayItems.length > 0;

  return (
    <section
      data-testid="critical-stock-widget"
      className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 shadow-2xs flex flex-col justify-between gap-3.5 h-full min-w-0"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {hasCritical ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            ) : hasAnyFlagged ? (
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
              Critical Stock
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            Reorder points · 30-day velocity
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenVelocityMonitor}
          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer shrink-0 pt-0.5"
        >
          <span>Stock Monitor</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Compact 3-Stat Tabular Summary */}
      <div className="grid grid-cols-3 gap-2.5 pt-1 pb-2.5 border-b border-slate-100 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            Reorder Point
          </p>
          <p
            className={`text-sm sm:text-base font-bold tabular-nums mt-0.5 ${
              data.criticalCount > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {data.criticalCount}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            Low Stock
          </p>
          <p
            className={`text-sm sm:text-base font-bold tabular-nums mt-0.5 ${
              data.lowStockCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {data.lowStockCount}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            Est. Restock
          </p>
          <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5 truncate">
            {formatINR(data.estimatedCriticalReorderCost)}
          </p>
        </div>
      </div>

      {/* Item List or Healthy State */}
      {!hasAnyFlagged ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 px-3 text-center">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mb-2.5">
            {data.totalActiveProducts > 0 ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <Package className="w-5 h-5" />
            )}
          </div>
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
            {data.totalActiveProducts > 0
              ? 'All active items above reorder point'
              : 'No active inventory products yet'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-[260px]">
            {data.totalActiveProducts > 0
              ? `All ${data.totalActiveProducts} tracked products have healthy cover based on 30-day sales velocity.`
              : 'Add products in Inventory to monitor reorder points automatically.'}
          </p>
          <button
            type="button"
            onClick={onOpenInventory}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
          >
            <span>Open Inventory</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex-1 divide-y divide-slate-100 dark:divide-slate-800 -mx-1">
          {data.displayItems.map((item) => {
            const isOutOfStock = item.currentStock <= 0;
            const isCritical = item.flag === 'REORDER';
            const gaugePct = computeStockCoverGaugePct(
              item,
              reorderLeadDays,
              lowStockWarningDays
            );

            const statusLabel = isOutOfStock
              ? 'Out of Stock'
              : isCritical
              ? 'Reorder Now'
              : 'Low Stock';

            const statusTextClass = isCritical
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-amber-600 dark:text-amber-400';

            const barFillClass = isCritical
              ? 'bg-rose-500 dark:bg-rose-400'
              : 'bg-amber-500 dark:bg-amber-400';

            const velocitySummary =
              item.dailySalesVelocity > 0
                ? `${formatQty(item.dailySalesVelocity)} ${item.product.unit}/day · ~${
                    item.daysOfStockLeft !== null ? formatQty(item.daysOfStockLeft) : '0'
                  }d cover`
                : item.minStockAlert > 0
                ? `Min alert: ${formatQty(item.minStockAlert)} ${item.product.unit}`
                : 'No recent velocity';

            return (
              <div
                key={item.product.id}
                data-testid={`critical-stock-row-${item.product.id}`}
                className="py-2.5 px-1 first:pt-0.5 last:pb-0.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {item.product.name}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold shrink-0 ${statusTextClass}`}
                    >
                      {isCritical ? (
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 shrink-0" />
                      )}
                      {statusLabel}
                    </span>
                  </div>

                  {/* Stock Cover Gauge */}
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barFillClass}`}
                      style={{ width: `${gaugePct}%` }}
                    />
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    <span className="font-medium text-slate-700 dark:text-slate-300 truncate">
                      {formatQty(item.currentStock)} {item.product.unit} left
                    </span>
                    <span className="truncate">{velocitySummary}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onOrderItem(item)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 text-slate-800 dark:text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer shrink-0 tabular-nums"
                  title={`Create purchase order for ${item.product.name}`}
                >
                  <ShoppingBag className="w-3 h-3 shrink-0" />
                  <span>Order +{formatQty(Math.max(1, item.recommendedReorderQty))}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer note if more items exist */}
      {data.criticalCount + data.lowStockCount > data.displayItems.length && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="tabular-nums">
            Showing top {data.displayItems.length} of{' '}
            {data.criticalCount + data.lowStockCount} flagged items
          </span>
          <button
            type="button"
            onClick={onOpenVelocityMonitor}
            className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
          >
            View all &rarr;
          </button>
        </div>
      )}
    </section>
  );
};
