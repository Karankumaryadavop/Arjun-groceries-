import React, { useMemo } from 'react';
import { Layers, TrendingUp, TrendingDown, Award, AlertCircle } from 'lucide-react';
import { ExpenseRecord, Product, SaleRecord, SupplierTransaction } from '../types';
import { formatINR } from '../utils/accounting';
import { calculateCategoryProfitability } from '../utils/analyticsMetrics';

interface CategoryProfitabilityCardProps {
  products: Product[];
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  supplierTransactions: SupplierTransaction[];
}

export const CategoryProfitabilityCard: React.FC<CategoryProfitabilityCardProps> = ({
  products,
  sales,
  expenses,
  supplierTransactions,
}) => {
  const summary = useMemo(
    () =>
      calculateCategoryProfitability({
        products,
        sales,
        expenses,
        supplierTransactions,
      }),
    [products, sales, expenses, supplierTransactions]
  );

  const maxRevenue = useMemo(
    () => Math.max(1, ...summary.categories.map((c) => c.salesRevenue)),
    [summary.categories]
  );

  return (
    <section
      aria-label="Category Profitability Analysis"
      className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              <Layers className="w-5 h-5" />
            </span>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              Profitability by Category (Net Profit Margin)
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Calculates category net profit and margin % from historical sales rates, supplier purchase price history, and proportional operating expenses
          </p>
        </div>

        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border self-start sm:self-auto ${
            summary.isProfitVerified
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70'
          }`}
        >
          <span
            className={`text-[11px] font-bold uppercase ${
              summary.isProfitVerified
                ? 'text-emerald-800 dark:text-emerald-300'
                : 'text-amber-800 dark:text-amber-300'
            }`}
          >
            {summary.isProfitVerified ? 'Verified Net Margin:' : `Provisional (${summary.costCoveragePct}% Costed):`}
          </span>
          <span
            className={`text-sm font-black tabular-nums ${
              !summary.isProfitVerified
                ? 'text-amber-900 dark:text-amber-200'
                : summary.overallNetMarginPct >= 0
                ? 'text-emerald-900 dark:text-emerald-200'
                : 'text-red-700 dark:text-rose-400'
            }`}
          >
            {summary.isProfitVerified ? `${summary.overallNetMarginPct}%` : summary.reviewStatus}
          </span>
        </div>
      </div>

      {/* Top KPI Callout Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
            {summary.isProfitVerified ? 'Categorized Net Profit' : 'Provisional Category Profit'}
          </div>
          <div
            className={`text-xl font-extrabold mt-0.5 tabular-nums ${
              !summary.isProfitVerified
                ? 'text-amber-800 dark:text-amber-300'
                : summary.totalNetProfit >= 0
                ? 'text-emerald-800 dark:text-emerald-300'
                : 'text-red-600 dark:text-rose-400'
            }`}
          >
            {summary.isProfitVerified
              ? formatINR(summary.verifiedTotalNetProfit ?? 0)
              : `Unverified (${summary.costCoveragePct}% costed)`}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Revenue {formatINR(summary.totalRevenue)} · Expenses {formatINR(summary.totalOperatingExpenses)}
            {summary.totalUncostedRevenue > 0 && ` · Uncosted ${formatINR(summary.totalUncostedRevenue)}`}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
              <Award className="w-3.5 h-3.5" />
              <span>Most Profitable Category</span>
            </div>
            <div className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate mt-0.5">
              {summary.topNetMarginCategory?.category || 'No data'}
            </div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 tabular-nums">
              {summary.topNetMarginCategory
                ? summary.topNetMarginCategory.hasSalesHistory
                  ? `Net Profit ${formatINR(summary.topNetMarginCategory.netProfit)}`
                  : `Catalog Margin ${summary.topNetMarginCategory.catalogMarginPct}%`
                : '-'}
            </div>
          </div>
          {summary.topNetMarginCategory && (
            <div className="text-right shrink-0">
              <div className="text-xl font-black text-emerald-800 dark:text-emerald-300 tabular-nums flex items-center gap-0.5 justify-end">
                <TrendingUp className="w-4 h-4" />
                <span>
                  {summary.topNetMarginCategory.hasSalesHistory
                    ? summary.topNetMarginCategory.netMarginPct
                    : summary.topNetMarginCategory.catalogMarginPct}
                  %
                </span>
              </div>
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400">Net Margin</div>
            </div>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-amber-800 dark:text-amber-300 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Tightest Margin Category</span>
            </div>
            <div className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate mt-0.5">
              {summary.lowestNetMarginCategory?.category || 'No data'}
            </div>
            <div className="text-[11px] text-amber-700 dark:text-amber-400 tabular-nums">
              {summary.lowestNetMarginCategory
                ? summary.lowestNetMarginCategory.hasSalesHistory
                  ? `Gross ${summary.lowestNetMarginCategory.grossMarginPct}% · Net ${formatINR(summary.lowestNetMarginCategory.netProfit)}`
                  : `Catalog Margin ${summary.lowestNetMarginCategory.catalogMarginPct}%`
                : '-'}
            </div>
          </div>
          {summary.lowestNetMarginCategory && (
            <div className="text-right shrink-0">
              <div className="text-xl font-black text-amber-800 dark:text-amber-300 tabular-nums flex items-center gap-0.5 justify-end">
                <TrendingDown className="w-4 h-4" />
                <span>
                  {summary.lowestNetMarginCategory.hasSalesHistory
                    ? summary.lowestNetMarginCategory.netMarginPct
                    : summary.lowestNetMarginCategory.catalogMarginPct}
                  %
                </span>
              </div>
              <div className="text-[10px] text-amber-700 dark:text-amber-400">Net Margin</div>
            </div>
          )}
        </div>
      </div>

      {/* Detailed Category Net Margin Table */}
      {summary.categories.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
          Record product sales and purchases to analyze category-wise net profit margins.
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-3.5">Category</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Avg Cost → Sale</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Sales Revenue</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">COGS</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Alloc. Exp</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Net Profit</th>
                  <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Net Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {summary.categories.map((cat) => {
                  const displayMargin = cat.hasSalesHistory ? cat.netMarginPct : cat.catalogMarginPct;
                  const shareWidth = Math.max(4, Math.round((cat.salesRevenue / maxRevenue) * 100));
                  const marginBadgeClass =
                    displayMargin >= 15
                      ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-300'
                      : displayMargin >= 8
                      ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300'
                      : 'bg-rose-100 dark:bg-rose-950/70 text-rose-900 dark:text-rose-300';

                  return (
                    <tr key={cat.category} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3.5">
                        <div className="font-bold text-slate-900 dark:text-slate-100">{cat.category}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-20 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-600 rounded-full"
                              style={{ width: `${cat.hasSalesHistory ? shareWidth : 0}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {cat.hasSalesHistory
                              ? `${cat.unitsSold} units · ${cat.billsCount} bills`
                              : `${cat.skuCount} SKUs (no sales in period)`}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                        {formatINR(cat.avgPurchasePrice)} → {formatINR(cat.avgSellingPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {formatINR(cat.salesRevenue)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                        {formatINR(cat.cogs)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                        {formatINR(cat.allocatedExpenses)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold tabular-nums whitespace-nowrap ${
                          cat.hasSalesHistory && !cat.isProfitVerified
                            ? 'text-amber-700 dark:text-amber-300'
                            : cat.netProfit >= 0
                            ? 'text-emerald-800 dark:text-emerald-400'
                            : 'text-red-600 dark:text-rose-400'
                        }`}
                      >
                        {!cat.hasSalesHistory
                          ? formatINR(0)
                          : cat.isProfitVerified
                          ? formatINR(cat.verifiedNetProfit ?? 0)
                          : cat.knownCostGrossProfit !== null
                          ? `${formatINR(cat.knownCostGrossProfit)} (Prov.)`
                          : 'Unverified'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right tabular-nums whitespace-nowrap">
                        {!cat.hasSalesHistory ? (
                          <span className={`inline-block font-extrabold px-2 py-0.5 rounded text-[11px] ${marginBadgeClass}`}>
                            {cat.catalogMarginPct}% est.
                          </span>
                        ) : cat.isProfitVerified ? (
                          <span className={`inline-block font-extrabold px-2 py-0.5 rounded text-[11px] ${marginBadgeClass}`}>
                            {cat.verifiedNetMarginPct ?? 0}%
                          </span>
                        ) : (
                          <span className="inline-block font-extrabold px-2 py-0.5 rounded text-[11px] bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300">
                            {cat.reviewStatus} ({cat.costCoveragePct}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
