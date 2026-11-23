import React, { useMemo, useState } from 'react';
import { Award, AlertTriangle, Grid, Layers, TrendingDown, TrendingUp } from 'lucide-react';
import { Product, SaleRecord } from '../types';
import {
  calculateCategoryProfitMargins,
  CategoryProfitMarginStat,
  formatINR,
} from '../utils/accounting';

interface CategoryMarginHeatmapProps {
  products: Product[];
  sales: SaleRecord[];
}

function getHeatmapTileStyle(stat: CategoryProfitMarginStat): {
  container: string;
  badge: string;
  label: string;
} {
  if (stat.marginPct >= 22) {
    return {
      container: 'bg-emerald-700 text-white border-emerald-800',
      badge: 'bg-emerald-900/50 text-emerald-50 border border-emerald-500/40',
      label: 'High Margin',
    };
  }
  if (stat.marginPct >= 18) {
    return {
      container: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-100 border-emerald-300 dark:border-emerald-700',
      badge: 'bg-emerald-700 text-white',
      label: 'Strong',
    };
  }
  if (stat.marginPct >= 14) {
    return {
      container: 'bg-amber-50 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100 border-amber-300 dark:border-amber-700',
      badge: 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100',
      label: 'Moderate',
    };
  }
  return {
    container: 'bg-rose-100 dark:bg-rose-950/50 text-rose-950 dark:text-rose-100 border-rose-300 dark:border-rose-700',
    badge: 'bg-rose-700 text-white',
    label: 'Low Margin',
  };
}

export const CategoryMarginHeatmap: React.FC<CategoryMarginHeatmapProps> = ({
  products,
  sales,
}) => {
  const categoryStats = useMemo(
    () => calculateCategoryProfitMargins(products, sales),
    [products, sales]
  );

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const highestCategory = categoryStats[0] || null;
  const lowestCategory = categoryStats.length > 0 ? categoryStats[categoryStats.length - 1] : null;

  const activeCategoryName =
    selectedCategory && categoryStats.some((c) => c.category === selectedCategory)
      ? selectedCategory
      : highestCategory?.category || null;

  const categoryProducts = useMemo(() => {
    if (!activeCategoryName) return [];
    return products
      .filter((p) => (p.category || 'Uncategorized').trim() === activeCategoryName)
      .map((p) => {
        const marginPct =
          p.sellingPrice > 0
            ? Math.round(((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 1000) / 10
            : 0;
        return { ...p, marginPct };
      })
      .sort((a, b) => b.marginPct - a.marginPct);
  }, [products, activeCategoryName]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              <Grid className="w-5 h-5" />
            </span>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              Category Profit Margin Heatmap (Nafa Heatmap)
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Compares wholesale purchase cost vs. retail selling rate across product categories to spot top and low performers
          </p>
        </div>

        {/* Explicit Heatmap Legend */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-800">
            Low &lt;14%
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
            Moderate 14–18%
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
            Strong 18–22%
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-700 text-white">
            High 22%+
          </span>
        </div>
      </div>

      {categoryStats.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
          Add products to your Inventory to analyze category-wise profit margins.
        </div>
      ) : (
        <>
          {/* Highest vs Lowest Category Callouts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {highestCategory && (
              <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 rounded-lg bg-emerald-700 text-white shrink-0">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase text-emerald-800 dark:text-emerald-300">
                      Highest Margin Category
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                      {highestCategory.category}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                      Top SKU: {highestCategory.topMarginProductName} ({highestCategory.topMarginProductPct}%)
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-extrabold text-emerald-800 dark:text-emerald-400 tabular-nums">
                    {highestCategory.marginPct}%
                  </div>
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                    {highestCategory.skuCount} SKUs
                  </div>
                </div>
              </div>
            )}

            {lowestCategory && (
              <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-950/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 rounded-lg bg-rose-700 text-white shrink-0">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase text-rose-800 dark:text-rose-300">
                      Lowest Margin Category
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                      {lowestCategory.category}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                      Lowest SKU: {lowestCategory.lowestMarginProductName} ({lowestCategory.lowestMarginProductPct}%)
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-extrabold text-rose-800 dark:text-rose-400 tabular-nums">
                    {lowestCategory.marginPct}%
                  </div>
                  <div className="text-[10px] text-rose-700 dark:text-rose-400">
                    {lowestCategory.skuCount} SKUs
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Heatmap Matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {categoryStats.map((stat) => {
              const style = getHeatmapTileStyle(stat);
              const isSelected = activeCategoryName === stat.category;

              return (
                <button
                  key={stat.category}
                  type="button"
                  onClick={() => setSelectedCategory(stat.category)}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    style.container
                  } ${isSelected ? 'ring-2 ring-slate-900 dark:ring-emerald-400 ring-offset-1 dark:ring-offset-slate-900' : 'hover:opacity-95'}`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <span className="font-bold text-xs sm:text-sm leading-snug">
                      {stat.category}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${style.badge}`}
                    >
                      {style.label}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-2xl font-extrabold tabular-nums">
                      {stat.marginPct}%
                    </span>
                    <span className="text-[11px] opacity-80 tabular-nums">
                      {stat.skuCount} {stat.skuCount === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  <div className="text-[11px] opacity-85 border-t border-current/15 pt-1.5 flex justify-between tabular-nums">
                    <span>Stock Profit</span>
                    <span className="font-bold">{formatINR(stat.potentialProfitValue)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Drilldown for Selected Category */}
          {activeCategoryName && categoryProducts.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Layers className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>SKU Breakdown: {activeCategoryName}</span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Click any heatmap cell above to inspect SKUs
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="py-2 px-4">Product</th>
                      <th className="py-2 px-4 text-right">Purchase Rate</th>
                      <th className="py-2 px-4 text-right">Selling Rate</th>
                      <th className="py-2 px-4 text-right">Profit / Unit</th>
                      <th className="py-2 px-4 text-right">Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {categoryProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-4 font-semibold text-slate-900 dark:text-slate-100">{p.name}</td>
                        <td className="py-2 px-4 text-right text-slate-600 dark:text-slate-400 tabular-nums">
                          {formatINR(p.purchasePrice)}
                        </td>
                        <td className="py-2 px-4 text-right font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatINR(p.sellingPrice)}
                        </td>
                        <td className="py-2 px-4 text-right text-emerald-800 dark:text-emerald-400 font-semibold tabular-nums">
                          {formatINR(p.sellingPrice - p.purchasePrice)}
                        </td>
                        <td className="py-2 px-4 text-right tabular-nums">
                          <span
                            className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                              p.marginPct >= 20
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300'
                                : p.marginPct >= 14
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300'
                                : 'bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-300'
                            }`}
                          >
                            {p.marginPct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
