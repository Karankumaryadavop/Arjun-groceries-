/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  LowStockItemView,
  buildLowStockItems,
  calculateLowStockSummary,
  filterLowStockItems,
} from '../utils/lowStock';
import { formatINR } from '../utils/accounting';
import { Product, StockAdjustmentRecord, Supplier } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Eye,
  LayoutGrid,
  PackagePlus,
  Phone,
  Search,
  SlidersHorizontal,
  Store,
  Table2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { LowStockMatrixSheet } from './LowStockMatrixSheet';

interface LowStockSectionProps {
  products: Product[];
  suppliers: Supplier[];
  stockAdjustments: StockAdjustmentRecord[];
  onEditProduct: (product: Product) => void;
  onAdjustStock: (product: Product) => void;
  onAssignSupplier: (
    productId: string,
    supplierId: string | undefined,
    desiredStockLevel?: number,
    supplierNotes?: string
  ) => void;
  onViewSupplier: (supplierId: string) => void;
  onAddPurchaseForProduct: (item: LowStockItemView) => void;
  onAddSupplier?: (
    data: Omit<Supplier, 'id' | 'currentBalance' | 'totalPurchases' | 'totalPaid' | 'createdAt'>
  ) => string;
  onAddProduct?: () => void;
  onOpenPurchasePlan?: () => void;
}

const STATUS_BADGE: Record<
  LowStockItemView['status'],
  { label: string; badgeClass: string; rowClass: string }
> = {
  OUT_OF_STOCK: {
    label: 'Out of Stock',
    badgeClass: 'bg-red-700 text-white',
    rowClass: 'bg-red-50/75 dark:bg-red-950/25',
  },
  CRITICAL_STOCK: {
    label: 'Critical Stock',
    badgeClass: 'bg-amber-600 text-white',
    rowClass: 'bg-amber-50/60 dark:bg-amber-950/20',
  },
  LOW_STOCK: {
    label: 'Low Stock',
    badgeClass:
      'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700',
    rowClass: '',
  },
};

export const LowStockSection: React.FC<LowStockSectionProps> = ({
  products,
  suppliers,
  stockAdjustments,
  onEditProduct,
  onAdjustStock,
  onAssignSupplier,
  onViewSupplier,
  onAddPurchaseForProduct,
  onAddSupplier,
  onAddProduct,
  onOpenPurchasePlan,
}) => {
  const [viewMode, setViewMode] = useState<'SHEET' | 'TABLE'>('SHEET');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'OUT_OF_STOCK' | 'CRITICAL_STOCK' | 'LOW_STOCK'
  >('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [supplierFilter, setSupplierFilter] = useState<string>('ALL');

  // Quick Product Detail modal state
  const [viewingItem, setViewingItem] = useState<LowStockItemView | null>(null);

  // Quick Assign Preferred Supplier modal state
  const [assigningItem, setAssigningItem] = useState<LowStockItemView | null>(null);
  const [assignSupplierId, setAssignSupplierId] = useState<string>('');
  const [assignDesiredLevel, setAssignDesiredLevel] = useState<string>('');
  const [assignNotes, setAssignNotes] = useState<string>('');

  const lowStockItems = useMemo(
    () => buildLowStockItems(products, suppliers),
    [products, suppliers]
  );

  const summary = useMemo(() => calculateLowStockSummary(lowStockItems), [lowStockItems]);

  const categories = useMemo(
    () => Array.from(new Set(lowStockItems.map((it) => it.product.category))).sort(),
    [lowStockItems]
  );

  const filteredItems = useMemo(
    () =>
      filterLowStockItems(lowStockItems, {
        statusFilter,
        category: categoryFilter,
        supplierFilter,
        searchQuery,
      }),
    [lowStockItems, statusFilter, categoryFilter, supplierFilter, searchQuery]
  );

  const openAssignModal = (item: LowStockItemView) => {
    setAssigningItem(item);
    setAssignSupplierId(item.preferredSupplierId || '');
    setAssignDesiredLevel(String(item.desiredStockLevel));
    setAssignNotes(item.supplierNotes || '');
  };

  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningItem) return;
    const parsedDesired =
      assignDesiredLevel.trim() === '' ? undefined : Math.max(0, Number(assignDesiredLevel));
    onAssignSupplier(
      assigningItem.product.id,
      assignSupplierId || undefined,
      Number.isFinite(parsedDesired) ? parsedDesired : undefined,
      assignNotes.trim() || undefined
    );
    setAssigningItem(null);
  };

  const viewingProductHistory = useMemo(() => {
    if (!viewingItem) return [];
    return stockAdjustments
      .filter((adj) => adj.productId === viewingItem.product.id)
      .slice(0, 6);
  }, [viewingItem, stockAdjustments]);

  return (
    <div className="space-y-4">
      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total Low Stock Products
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {summary.totalLowStockProducts}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {summary.unassignedSupplierCount} unassigned supplier
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-red-200 dark:border-red-900/70 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400">
            Out of Stock Products
          </div>
          <div className="text-2xl font-extrabold text-red-700 dark:text-red-400 mt-1 tabular-nums">
            {summary.outOfStockCount}
          </div>
          <div className="text-[11px] text-red-600/90 dark:text-red-300/80 mt-1">
            Immediate restock needed
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-amber-200 dark:border-amber-900/70 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Critical Stock Products
          </div>
          <div className="text-2xl font-extrabold text-amber-700 dark:text-amber-400 mt-1 tabular-nums">
            {summary.criticalStockCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            + {summary.lowStockOnlyCount} standard low stock
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-emerald-200 dark:border-emerald-900/70 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
            Estimated Replenishment Cost
          </div>
          <div className="text-2xl font-extrabold text-emerald-900 dark:text-emerald-300 mt-1 tabular-nums">
            {formatINR(summary.estimatedReplenishmentCost)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Based on last purchase prices
          </div>
        </div>
      </div>

      {/* Filters & Toolbar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative w-full lg:w-80">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search item, category, or store..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs sm:text-sm pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Clear low stock search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status filter buttons */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                All ({lowStockItems.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('OUT_OF_STOCK')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  statusFilter === 'OUT_OF_STOCK'
                    ? 'bg-red-700 text-white'
                    : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                Out of Stock ({summary.outOfStockCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('CRITICAL_STOCK')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  statusFilter === 'CRITICAL_STOCK'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                }`}
              >
                Critical Stock ({summary.criticalStockCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('LOW_STOCK')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  statusFilter === 'LOW_STOCK'
                    ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Low Stock ({summary.lowStockOnlyCount})
              </button>
            </div>
          </div>

          {/* Dropdown filters: Category, Supplier, Unassigned shortcut */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter low stock by category"
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              aria-label="Filter low stock by preferred supplier"
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Preferred Suppliers</option>
              <option value="UNASSIGNED">
                Supplier Not Assigned ({summary.unassignedSupplierCount})
              </option>
              {suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>
                  {sup.name}
                </option>
              ))}
            </select>

            {summary.unassignedSupplierCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSupplierFilter(supplierFilter === 'UNASSIGNED' ? 'ALL' : 'UNASSIGNED')
                }
                className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer border ${
                  supplierFilter === 'UNASSIGNED'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                }`}
              >
                Only Unassigned ({summary.unassignedSupplierCount})
              </button>
            )}

            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 ml-auto">
              <button
                type="button"
                onClick={() => setViewMode('SHEET')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold cursor-pointer transition-colors ${
                  viewMode === 'SHEET'
                    ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Store Sheet</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TABLE')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold cursor-pointer transition-colors ${
                  viewMode === 'TABLE'
                    ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Table</span>
              </button>
            </div>
          </div>
        </div>

        {/* Store Matrix Sheet View (Horizontal Purchase-From-Store Columns) */}
        {viewMode === 'SHEET' ? (
          <LowStockMatrixSheet
            items={filteredItems}
            suppliers={suppliers}
            onAddPurchaseForProduct={onAddPurchaseForProduct}
            onAssignStore={openAssignModal}
            onEditProduct={(item) => onEditProduct(item.product)}
            onViewSupplier={onViewSupplier}
            onAddSupplier={onAddSupplier}
            onAddProduct={onAddProduct}
            onSwitchToTable={() => setViewMode('TABLE')}
            onOpenPurchasePlan={onOpenPurchasePlan}
          />
        ) : (
        <>
        {/* Empty State */}
        {lowStockItems.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
              All Active Products Are Well Stocked
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              Every active item is currently above its low-stock alert limit. Adjust individual product limits anytime from Inventory.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
            No low-stock items match your active filters.
          </div>
        ) : (
          <>
            {/* Desktop Spreadsheet-Style Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold uppercase text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Product & Category</th>
                    <th className="py-3 px-3 text-center">Stock Status</th>
                    <th className="py-3 px-3 text-right">Current / Limit</th>
                    <th className="py-3 px-3 text-right">Suggested Buy Qty</th>
                    <th className="py-3 px-3 text-right">Last Purchase Price</th>
                    <th className="py-3 px-3.5">Preferred Supplier (Where to Buy)</th>
                    <th className="py-3 px-3 text-right">Est. Cost</th>
                    <th className="py-3 px-3.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredItems.map((item) => {
                    const meta = STATUS_BADGE[item.status];
                    return (
                      <tr
                        key={item.product.id}
                        className={`${meta.rowClass} hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors`}
                      >
                        <td className="py-3 px-3.5 max-w-[230px]">
                          <div className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                            {item.product.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-medium">
                              {item.product.category}
                            </span>
                            <span className="tabular-nums">
                              Sell: {formatINR(item.product.sellingPrice)}/{item.product.unit}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                          <div className="font-extrabold text-slate-900 dark:text-slate-100">
                            {item.currentStock} {item.product.unit}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Limit: {item.lowStockLimit} {item.product.unit}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                          <div className="font-extrabold text-emerald-800 dark:text-emerald-300">
                            {item.suggestedPurchaseQty} {item.product.unit}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Target: {item.desiredStockLevel} {item.product.unit}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatINR(item.lastPurchasePrice)}/{item.product.unit}
                          </div>
                          {item.lastPurchaseDate && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {new Date(item.lastPurchaseDate).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                              })}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3.5 min-w-[190px]">
                          {item.hasPreferredSupplier ? (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
                                <Store className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                                <span>{item.preferredSupplierName}</span>
                              </div>
                              {item.preferredSupplierPhone && (
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 tabular-nums">
                                  <Phone className="w-3 h-3" />
                                  <span>{item.preferredSupplierPhone}</span>
                                </div>
                              )}
                              {item.supplierNotes && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                                  Note: {item.supplierNotes}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded">
                                Supplier Not Assigned
                              </span>
                              <button
                                type="button"
                                onClick={() => openAssignModal(item)}
                                className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                              >
                                Assign
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right font-extrabold text-emerald-900 dark:text-emerald-300 tabular-nums whitespace-nowrap">
                          {formatINR(item.estimatedPurchaseCost)}
                        </td>

                        <td className="py-3 px-3.5">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            <button
                              type="button"
                              onClick={() => onAddPurchaseForProduct(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-[11px] font-bold cursor-pointer whitespace-nowrap"
                              title="Open Purchase Form for this product"
                            >
                              <PackagePlus className="w-3 h-3" />
                              <span>Add Purchase</span>
                            </button>

                            {item.hasPreferredSupplier && item.preferredSupplierId ? (
                              <button
                                type="button"
                                onClick={() => onViewSupplier(item.preferredSupplierId!)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                title="View Preferred Supplier Account"
                              >
                                <UserCheck className="w-3 h-3" />
                                <span>View Supplier</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openAssignModal(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                title="Assign Preferred Supplier"
                              >
                                <UserPlus className="w-3 h-3" />
                                <span>Assign</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setViewingItem(item)}
                              className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              title="View Product Details"
                              aria-label={`View ${item.product.name}`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => onEditProduct(item.product)}
                              className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              title="Edit Product"
                              aria-label={`Edit ${item.product.name}`}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => onAdjustStock(item.product)}
                              className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              title="Adjust Stock Quantity"
                              aria-label={`Adjust stock for ${item.product.name}`}
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Layout */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {filteredItems.map((item) => {
                const meta = STATUS_BADGE[item.status];
                return (
                  <div key={item.product.id} className={`p-3.5 space-y-2.5 ${meta.rowClass}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {item.product.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {item.product.category} · Last buy: {formatINR(item.lastPurchasePrice)}/{item.product.unit}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs tabular-nums">
                      <div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">Current / Limit</div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {item.currentStock} / {item.lowStockLimit} {item.product.unit}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">Buy Qty</div>
                        <div className="font-bold text-emerald-700 dark:text-emerald-400">
                          {item.suggestedPurchaseQty} {item.product.unit}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">Est. Cost</div>
                        <div className="font-extrabold text-emerald-900 dark:text-emerald-300">
                          {formatINR(item.estimatedPurchaseCost)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs">
                      {item.hasPreferredSupplier ? (
                        <div className="text-slate-700 dark:text-slate-300 font-semibold truncate">
                          From: {item.preferredSupplierName}
                          {item.preferredSupplierPhone ? ` (${item.preferredSupplierPhone})` : ''}
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                          Supplier Not Assigned
                        </span>
                      )}
                      {item.hasPreferredSupplier && item.preferredSupplierId ? (
                        <button
                          type="button"
                          onClick={() => onViewSupplier(item.preferredSupplierId!)}
                          className="text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0 cursor-pointer"
                        >
                          View Supplier
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAssignModal(item)}
                          className="text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0 cursor-pointer"
                        >
                          Assign Supplier
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <button
                        type="button"
                        onClick={() => onAddPurchaseForProduct(item)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold cursor-pointer"
                      >
                        <PackagePlus className="w-3.5 h-3.5" />
                        <span>Add Purchase</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewingItem(item)}
                        className="py-2 px-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditProduct(item.product)}
                        className="py-2 px-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onAdjustStock(item.product)}
                        className="py-2 px-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Adjust ±
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        </>
        )}
      </div>

      {/* View Product Quick Modal */}
      {viewingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  {viewingItem.product.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {viewingItem.product.category} · Unit: {viewingItem.product.unit}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs bg-slate-50 dark:bg-slate-800/70 p-3 rounded-xl border border-slate-200 dark:border-slate-700 tabular-nums">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Current Stock</div>
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  {viewingItem.currentStock} {viewingItem.product.unit}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Low Limit / Desired</div>
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  {viewingItem.lowStockLimit} / {viewingItem.desiredStockLevel} {viewingItem.product.unit}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Last Purchase Price</div>
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  {formatINR(viewingItem.lastPurchasePrice)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Counter Selling Price</div>
                <div className="font-bold text-emerald-700 dark:text-emerald-400">
                  {formatINR(viewingItem.product.sellingPrice)}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <div className="font-bold text-slate-800 dark:text-slate-200">
                Preferred Supplier (Purchase Source)
              </div>
              <div className="text-slate-700 dark:text-slate-300">
                {viewingItem.hasPreferredSupplier
                  ? `${viewingItem.preferredSupplierName}${viewingItem.preferredSupplierPhone ? ` · ${viewingItem.preferredSupplierPhone}` : ''}`
                  : 'Supplier Not Assigned'}
              </div>
              {viewingItem.lastPurchaseDate && (
                <div className="text-slate-500 dark:text-slate-400">
                  Last Purchase Date: {new Date(viewingItem.lastPurchaseDate).toLocaleDateString('en-IN')}
                </div>
              )}
              {viewingItem.supplierNotes && (
                <div className="text-slate-500 dark:text-slate-400">
                  Notes: {viewingItem.supplierNotes}
                </div>
              )}
            </div>

            {viewingProductHistory.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Recent Stock Movements
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {viewingProductHistory.map((h) => (
                    <div
                      key={h.id}
                      className="text-[11px] flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 rounded-lg"
                    >
                      <span className="truncate text-slate-700 dark:text-slate-300 mr-2">
                        {h.date} · {h.reason}
                      </span>
                      <span
                        className={`font-bold tabular-nums shrink-0 ${
                          h.quantityChange >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {h.quantityChange >= 0 ? `+${h.quantityChange}` : h.quantityChange} {h.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = viewingItem;
                  setViewingItem(null);
                  onAddPurchaseForProduct(target);
                }}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Add Purchase ({viewingItem.suggestedPurchaseQty} {viewingItem.product.unit})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Assign Preferred Supplier Modal */}
      {assigningItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Assign Preferred Supplier
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {assigningItem.product.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssigningItem(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="py-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Select Existing Supplier
                </label>
                <select
                  value={assignSupplierId}
                  onChange={(e) => setAssignSupplierId(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">-- Supplier Not Assigned --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.phone})
                    </option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Add suppliers in Suppliers section first to assign them here.</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Desired Stock Level ({assigningItem.product.unit})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={assignDesiredLevel}
                  onChange={(e) => setAssignDesiredLevel(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Suggested Qty = max(0, Desired Stock Level - Current Stock)
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supplier Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Call before 11 AM for same-day delivery"
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAssigningItem(null)}
                  className="px-3.5 py-2 font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold cursor-pointer"
                >
                  Save Purchase Source
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
