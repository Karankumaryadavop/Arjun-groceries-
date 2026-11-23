import React, { useMemo, useState } from 'react';
import { formatINR } from '../utils/accounting';
import {
  StockVelocityConfig,
  StockVelocityFlag,
  StockVelocityItem,
  StockVelocityMonitorReport,
} from '../utils/stockVelocity';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';

interface StockVelocityMonitorPanelProps {
  report: StockVelocityMonitorReport;
  config: StockVelocityConfig;
  onChangeConfig: (patch: Partial<StockVelocityConfig>) => void;
  onOrderProduct: (item: StockVelocityItem) => void;
}

type VelocityFilter = 'FLAGGED' | 'REORDER' | 'LOW_STOCK' | 'ALL';

export const StockVelocityMonitorPanel: React.FC<StockVelocityMonitorPanelProps> = ({
  report,
  config,
  onChangeConfig,
  onOrderProduct,
}) => {
  const [filter, setFilter] = useState<VelocityFilter>('FLAGGED');
  const [searchQuery, setSearchQuery] = useState('');
  const [showThresholdControls, setShowThresholdControls] = useState(false);

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.items.filter((item) => {
      if (filter === 'FLAGGED' && item.flag === 'HEALTHY') return false;
      if (filter === 'REORDER' && item.flag !== 'REORDER') return false;
      if (filter === 'LOW_STOCK' && item.flag !== 'LOW_STOCK') return false;

      if (!q) return true;
      return (
        item.product.name.toLowerCase().includes(q) ||
        item.product.category.toLowerCase().includes(q) ||
        (item.preferredSupplierName || '').toLowerCase().includes(q)
      );
    });
  }, [report.items, filter, searchQuery]);

  const renderFlagBadge = (flag: StockVelocityFlag) => {
    if (flag === 'REORDER') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800 text-[11px] font-extrabold uppercase tracking-wide whitespace-nowrap">
          <AlertOctagon className="w-3 h-3" />
          <span>Reorder</span>
        </span>
      );
    }
    if (flag === 'LOW_STOCK') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[11px] font-extrabold uppercase tracking-wide whitespace-nowrap">
          <AlertTriangle className="w-3 h-3" />
          <span>Low Stock</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold whitespace-nowrap">
        <CheckCircle2 className="w-3 h-3" />
        <span>Healthy</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-red-200 dark:border-red-900/70 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
            Reorder Now
          </div>
          <div className="text-2xl font-black text-red-700 dark:text-red-300 mt-1 tabular-nums">
            {report.summary.reorderCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            &le; {config.reorderLeadDays}d cover or out of stock
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-amber-200 dark:border-amber-900/70 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Low Stock Watch
          </div>
          <div className="text-2xl font-black text-amber-700 dark:text-amber-300 mt-1 tabular-nums">
            {report.summary.lowStockCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            &le; {config.lowStockWarningDays}d cover or min alert
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-blue-200 dark:border-blue-900/70 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
            Fast-Moving At Risk
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {report.summary.fastMovingAtRiskCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Active {config.lookbackDays}-day sales velocity
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Est. Restock Budget
          </div>
          <div className="text-2xl font-black text-emerald-800 dark:text-emerald-300 mt-1 tabular-nums">
            {formatINR(report.summary.estimatedTotalReorderCost)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            For {config.targetCoverDays}-day stock cover
          </div>
        </div>
      </div>

      {/* Controls & Filters Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Automated Stock Velocity Monitor ({config.lookbackDays}-Day Sales Pace)</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Compares current stock levels against recent {config.lookbackDays}-day sales velocity to suggest &apos;Reorder&apos; and &apos;Low Stock&apos; flags automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowThresholdControls((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Monitoring Rules</span>
            </button>
          </div>

          {showThresholdControls && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
              <label className="space-y-1">
                <span className="font-bold text-slate-700 dark:text-slate-300 block">
                  Reorder Lead Time (Days)
                </span>
                <input
                  type="number"
                  min={1}
                  max={45}
                  value={config.reorderLeadDays}
                  onChange={(e) =>
                    onChangeConfig({ reorderLeadDays: Math.max(1, Number(e.target.value) || 7) })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="font-bold text-slate-700 dark:text-slate-300 block">
                  Low Stock Buffer (Days)
                </span>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={config.lowStockWarningDays}
                  onChange={(e) =>
                    onChangeConfig({
                      lowStockWarningDays: Math.max(2, Number(e.target.value) || 14),
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="font-bold text-slate-700 dark:text-slate-300 block">
                  Target Stock Cover (Days)
                </span>
                <input
                  type="number"
                  min={7}
                  max={90}
                  value={config.targetCoverDays}
                  onChange={(e) =>
                    onChangeConfig({ targetCoverDays: Math.max(7, Number(e.target.value) || 21) })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </label>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'FLAGGED', label: `Flagged (${report.flaggedItems.length})` },
                  { id: 'REORDER', label: `Reorder (${report.summary.reorderCount})` },
                  { id: 'LOW_STOCK', label: `Low Stock (${report.summary.lowStockCount})` },
                  { id: 'ALL', label: `All Products (${report.summary.totalActiveProducts})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    filter === tab.id
                      ? 'bg-emerald-700 text-white shadow-2xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search product or supplier..."
                aria-label="Filter monitored stock items"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-emerald-600"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {visibleItems.length === 0 ? (
          <div className="p-8 text-center space-y-1">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {filter === 'FLAGGED'
                ? 'No Reorder or Low Stock flags right now'
                : 'No products match this filter'}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All active inventory items have healthy stock cover relative to recent 30-day sales velocity.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                <tr>
                  <th className="py-2.5 px-4">Product &amp; Flag</th>
                  <th className="py-2.5 px-3 text-right">Current Stock</th>
                  <th className="py-2.5 px-3 text-right">30-Day Sold</th>
                  <th className="py-2.5 px-3 text-right">Daily Velocity</th>
                  <th className="py-2.5 px-3 text-right">Est. Days Left</th>
                  <th className="py-2.5 px-3 text-right">Suggested Order</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleItems.map((item) => (
                  <tr
                    key={item.product.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {item.product.name}
                        </span>
                        {renderFlagBadge(item.flag)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {item.reason}
                        {item.preferredSupplierName && (
                          <span> · Supplier: {item.preferredSupplierName}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {item.currentStock} {item.product.unit}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {item.soldLast30Days} {item.product.unit}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                      {item.dailySalesVelocity > 0 ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-400">
                          <TrendingUp className="w-3 h-3" />
                          {item.dailySalesVelocity}/{item.product.unit === 'pcs' ? 'd' : `d`}
                        </span>
                      ) : (
                        <span className="text-slate-400">0/day</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-bold whitespace-nowrap">
                      {item.daysOfStockLeft === null ? (
                        <span className="text-slate-400 font-normal">No 30d sales</span>
                      ) : item.daysOfStockLeft <= config.reorderLeadDays ? (
                        <span className="text-red-700 dark:text-red-400">
                          {item.daysOfStockLeft}d
                        </span>
                      ) : item.daysOfStockLeft <= config.lowStockWarningDays ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          {item.daysOfStockLeft}d
                        </span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {item.daysOfStockLeft}d
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                      {item.recommendedReorderQty > 0 ? (
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100">
                            +{item.recommendedReorderQty} {item.product.unit}
                          </div>
                          {item.estimatedReorderCost > 0 && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              ~{formatINR(item.estimatedReorderCost)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOrderProduct(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold cursor-pointer"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>Order Stock</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
