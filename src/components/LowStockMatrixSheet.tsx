import React, { useEffect, useMemo, useState } from 'react';
import {
  LowStockItemView,
  buildHorizontalStorePurchaseMatrix,
  exportHorizontalLowStockCSV,
} from '../utils/lowStock';
import { formatINR } from '../utils/accounting';
import { downloadCSVFile } from '../utils/csv';
import { Supplier } from '../types';
import {
  Download,
  Edit2,
  Eye,
  EyeOff,
  PackagePlus,
  Plus,
  Store,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';

interface LowStockMatrixSheetProps {
  items: LowStockItemView[];
  suppliers: Supplier[];
  onAddPurchaseForProduct: (item: LowStockItemView) => void;
  onAssignStore: (item: LowStockItemView) => void;
  onEditProduct: (item: LowStockItemView) => void;
  onViewSupplier: (supplierId: string) => void;
  onAddSupplier?: (
    data: Omit<Supplier, 'id' | 'currentBalance' | 'totalPurchases' | 'totalPaid' | 'createdAt'>
  ) => string;
  onAddProduct?: () => void;
  onSwitchToTable: () => void;
  onOpenPurchasePlan?: () => void;
}

export const LowStockMatrixSheet: React.FC<LowStockMatrixSheetProps> = ({
  items,
  suppliers,
  onAddPurchaseForProduct,
  onAssignStore,
  onEditProduct,
  onViewSupplier,
  onAddSupplier,
  onAddProduct,
  onSwitchToTable,
  onOpenPurchasePlan,
}) => {
  const [showEmptyStores, setShowEmptyStores] = useState<boolean>(true);
  const [selectedCellCoord, setSelectedCellCoord] = useState<{
    colIndex: number;
    rowIndex: number;
  } | null>(null);

  const [isAddStoreOpen, setIsAddStoreOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStorePhone, setNewStorePhone] = useState('');
  const [newStoreAddress, setNewStoreAddress] = useState('');
  const [addStoreError, setAddStoreError] = useState<string | null>(null);

  const matrix = useMemo(
    () =>
      buildHorizontalStorePurchaseMatrix({
        items,
        suppliers,
        includeEmptySuppliers: showEmptyStores,
      }),
    [items, suppliers, showEmptyStores]
  );

  // Keep a valid selected cell in sync when items change
  const activeSelection = useMemo(() => {
    if (matrix.columns.length === 0) return null;
    if (selectedCellCoord) {
      const col = matrix.columns[selectedCellCoord.colIndex];
      const item = col?.items[selectedCellCoord.rowIndex];
      if (col && item) {
        return {
          colIndex: selectedCellCoord.colIndex,
          rowIndex: selectedCellCoord.rowIndex,
          col,
          item,
          coordLabel: `${col.colLetter}${selectedCellCoord.rowIndex + 3}`,
        };
      }
    }
    for (let c = 0; c < matrix.columns.length; c++) {
      if (matrix.columns[c].items.length > 0) {
        return {
          colIndex: c,
          rowIndex: 0,
          col: matrix.columns[c],
          item: matrix.columns[c].items[0],
          coordLabel: `${matrix.columns[c].colLetter}3`,
        };
      }
    }
    return null;
  }, [matrix, selectedCellCoord]);

  useEffect(() => {
    if (!activeSelection && selectedCellCoord !== null) {
      setSelectedCellCoord(null);
    }
  }, [activeSelection, selectedCellCoord]);

  const displayRows = Math.max(matrix.maxRows, 4);

  const handleExportCsv = () => {
    const csv = exportHorizontalLowStockCSV(matrix);
    const dateKey = new Date().toISOString().split('T')[0];
    downloadCSVFile(`low-stock-purchase-by-store-${dateKey}.csv`, csv);
  };

  const handleCreateStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddSupplier) return;
    const cleanName = newStoreName.trim();
    if (cleanName.length < 2) {
      setAddStoreError('Please enter a store / supplier name (at least 2 characters).');
      return;
    }
    const cleanPhone = newStorePhone.replace(/\D/g, '').slice(-10);
    if (cleanPhone && cleanPhone.length !== 10) {
      setAddStoreError('Enter a valid 10-digit phone number or leave phone blank.');
      return;
    }

    onAddSupplier({
      name: cleanName,
      phone: cleanPhone || 'Not Added',
      address: newStoreAddress.trim() || undefined,
      openingBalance: 0,
    });

    setShowEmptyStores(true);
    setNewStoreName('');
    setNewStorePhone('');
    setNewStoreAddress('');
    setAddStoreError(null);
    setIsAddStoreOpen(false);
  };

  return (
    <div className="bg-white dark:bg-slate-900 overflow-hidden">
      {/* Top Spreadsheet Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
            Low Stock — Purchase From Store Sheet
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {matrix.totalStoresCount} {matrix.totalStoresCount === 1 ? 'store' : 'stores'} across ·{' '}
            {matrix.totalLowStockCount} low-stock {matrix.totalLowStockCount === 1 ? 'item' : 'items'} · Est.{' '}
            {formatINR(matrix.grandEstimatedTotal)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
          {suppliers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEmptyStores((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] sm:text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              {showEmptyStores ? (
                <EyeOff className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              )}
              <span>{showEmptyStores ? 'Hide Empty' : 'Show All'}</span>
            </button>
          )}

          {onAddSupplier && (
            <button
              type="button"
              onClick={() => {
                setAddStoreError(null);
                setIsAddStoreOpen(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] sm:text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Store</span>
            </button>
          )}

          {matrix.columns.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] sm:text-xs font-semibold cursor-pointer whitespace-nowrap"
              title="Download horizontal purchase sheet as CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty Matrix State */}
      {matrix.columns.length === 0 ? (
        <div className="py-10 px-4 text-center space-y-3">
          <Store className="w-9 h-9 text-emerald-700 dark:text-emerald-400 mx-auto" />
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
              No Purchase Stores or Low-Stock Items Yet
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              Add your wholesale stores (e.g. Akash Store, Alam, Mahabali Trading) to view them horizontally across Row 1 with every low-stock item listed underneath.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {onAddSupplier && (
              <button
                type="button"
                onClick={() => {
                  setAddStoreError(null);
                  setIsAddStoreOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add First Store</span>
              </button>
            )}
            {onAddProduct && (
              <button
                type="button"
                onClick={onAddProduct}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Add Product</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Horizontal Spreadsheet Grid */}
          <div className="overflow-auto max-h-[380px] sm:max-h-[440px] bg-white dark:bg-slate-950">
            <table
              className="border-collapse text-xs w-max min-w-full"
              aria-label="Horizontal Store Purchase Low Stock Sheet"
            >
              <thead className="sticky top-0 z-20 shadow-[0_1px_0_0_rgba(203,213,225,0.8)] dark:shadow-[0_1px_0_0_rgba(51,65,85,0.8)]">
                {/* Column Letters Row (A, B, C, ...) */}
                <tr className="bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-mono text-[11px] border-b border-slate-200 dark:border-slate-800">
                  <th
                    scope="col"
                    className="sticky left-0 z-30 w-10 min-w-[40px] bg-slate-100 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 py-1.5 text-center font-semibold"
                  >
                    #
                  </th>
                  {matrix.columns.map((col) => {
                    const isActiveCol = activeSelection?.colIndex === col.columnIndex;
                    return (
                      <th
                        key={`letter-${col.groupKey}`}
                        scope="col"
                        className={`min-w-[175px] max-w-[210px] border-r border-slate-200 dark:border-slate-800 py-1.5 px-2.5 text-center font-bold transition-colors ${
                          isActiveCol
                            ? 'bg-emerald-100 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-300 border-b-2 border-b-emerald-600'
                            : 'bg-slate-100 dark:bg-slate-900'
                        }`}
                      >
                        {col.colLetter}
                      </th>
                    );
                  })}
                </tr>

                {/* Row 1: Horizontal Purchase Store Names */}
                <tr className="bg-slate-50 dark:bg-slate-900 border-b-2 border-slate-300 dark:border-slate-700">
                  <th
                    scope="row"
                    className="sticky left-0 z-30 w-10 min-w-[40px] bg-slate-100 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 py-2.5 text-center font-mono text-[11px] text-slate-500 dark:text-slate-400 font-semibold"
                  >
                    1
                  </th>
                  {matrix.columns.map((col) => {
                    const isActiveCol = activeSelection?.colIndex === col.columnIndex;
                    return (
                      <th
                        key={`store-${col.groupKey}`}
                        scope="col"
                        className={`min-w-[175px] max-w-[210px] border-r border-slate-200 dark:border-slate-800 p-0 text-left align-top ${
                          isActiveCol ? 'bg-emerald-50 dark:bg-emerald-950/60' : 'bg-slate-50 dark:bg-slate-900'
                        }`}
                      >
                        <div className="px-2.5 py-2 flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            {col.supplierId && !col.isUnassigned ? (
                              <button
                                type="button"
                                onClick={() => onViewSupplier(col.supplierId!)}
                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 text-xs sm:text-[13px] leading-snug truncate block w-full text-left cursor-pointer"
                                title={`${col.storeName}${col.storePhone ? ` (${col.storePhone})` : ''} — Open supplier account`}
                              >
                                {col.storeName}
                              </button>
                            ) : (
                              <span
                                className="font-bold text-amber-800 dark:text-amber-300 text-xs sm:text-[13px] leading-snug truncate block"
                                title={col.storeName}
                              >
                                {col.storeName}
                              </span>
                            )}
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal tabular-nums mt-0.5 whitespace-nowrap">
                              {col.items.length} {col.items.length === 1 ? 'item' : 'items'}
                              {col.estimatedTotal > 0 ? ` · ${formatINR(col.estimatedTotal)}` : ''}
                            </div>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {/* Row 2: Thin spreadsheet section divider matching screenshot */}
                <tr className="bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800">
                  <td className="sticky left-0 z-10 w-10 bg-slate-100 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 py-1 text-center font-mono text-[10px] text-slate-400">
                    2
                  </td>
                  {matrix.columns.map((col) => (
                    <td
                      key={`spacer-${col.groupKey}`}
                      className="border-r border-slate-200 dark:border-slate-800 py-1 px-2.5 text-[10px] text-slate-400 dark:text-slate-500 font-medium"
                    >
                      {col.items.length > 0 ? 'Items to buy' : 'No low-stock items'}
                    </td>
                  ))}
                </tr>

                {/* Vertical Item Rows (Row 3..N) */}
                {Array.from({ length: displayRows }).map((_, rowIndex) => {
                  const sheetRowNumber = rowIndex + 3;
                  return (
                    <tr
                      key={`row-${sheetRowNumber}`}
                      className="border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-900/30"
                    >
                      <td className="sticky left-0 z-10 w-10 bg-slate-100 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 py-1.5 text-center font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {sheetRowNumber}
                      </td>
                      {matrix.columns.map((col) => {
                        const item = col.items[rowIndex];
                        const isSelected =
                          activeSelection?.colIndex === col.columnIndex &&
                          activeSelection?.rowIndex === rowIndex;

                        if (!item) {
                          return (
                            <td
                              key={`empty-${col.groupKey}-${rowIndex}`}
                              className="min-w-[175px] max-w-[210px] border-r border-slate-200 dark:border-slate-800 h-10 bg-white dark:bg-slate-950"
                            />
                          );
                        }

                        const stockStateText =
                          item.status === 'OUT_OF_STOCK'
                            ? `0 ${item.product.unit} · Buy ${item.suggestedPurchaseQty}`
                            : `${item.currentStock} ${item.product.unit} left · Buy ${item.suggestedPurchaseQty}`;

                        return (
                          <td
                            key={item.product.id}
                            className="min-w-[175px] max-w-[210px] border-r border-slate-200 dark:border-slate-800 p-0 align-top"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedCellCoord({
                                  colIndex: col.columnIndex,
                                  rowIndex,
                                })
                              }
                              className={`w-full text-left px-2.5 py-1.5 transition-colors cursor-pointer block min-h-[40px] ${
                                isSelected
                                  ? 'ring-2 ring-inset ring-emerald-600 bg-emerald-50/90 dark:bg-emerald-950/60'
                                  : item.status === 'OUT_OF_STOCK'
                                  ? 'bg-red-50/40 dark:bg-red-950/20 hover:bg-red-50/80 dark:hover:bg-red-950/35'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                              }`}
                            >
                              <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs truncate">
                                {item.product.name}
                              </div>
                              <div
                                className={`text-[10px] tabular-nums truncate ${
                                  item.status === 'OUT_OF_STOCK'
                                    ? 'text-red-700 dark:text-red-400 font-semibold'
                                    : item.status === 'CRITICAL_STOCK'
                                    ? 'text-amber-700 dark:text-amber-400 font-medium'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {stockStateText}
                              </div>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Spreadsheet fx Formula & Active Cell Action Bar */}
          <div className="px-3.5 py-2.5 bg-slate-900 dark:bg-slate-950 text-white border-t border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            {activeSelection ? (
              <>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 text-emerald-400 font-mono text-xs font-bold shrink-0">
                    <span>fx</span>
                    <span>{activeSelection.coordLabel}</span>
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold text-white truncate">
                      {activeSelection.col.storeName} · {activeSelection.item.product.name}
                    </div>
                    <div className="text-[11px] text-slate-300 tabular-nums truncate">
                      Stock: {activeSelection.item.currentStock} / Limit: {activeSelection.item.lowStockLimit}{' '}
                      {activeSelection.item.product.unit} · Buy {activeSelection.item.suggestedPurchaseQty}{' '}
                      {activeSelection.item.product.unit} × {formatINR(activeSelection.item.lastPurchasePrice)} ={' '}
                      {formatINR(activeSelection.item.estimatedPurchaseCost)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onAddPurchaseForProduct(activeSelection.item)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    <PackagePlus className="w-3.5 h-3.5" />
                    <span>Add Purchase</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAssignStore(activeSelection.item)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    {activeSelection.item.hasPreferredSupplier ? (
                      <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span>{activeSelection.item.hasPreferredSupplier ? 'Change Store' : 'Assign Store'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditProduct(activeSelection.item)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="px-2 py-1 rounded bg-slate-800 text-emerald-400 font-mono font-bold">
                  fx
                </span>
                <span>
                  Stores are listed horizontally across Row 1. Assign products to stores or add low-stock items to inspect replenishment actions here.
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Spreadsheet Bottom Sheet Tabs (matching screenshot's Low stock sheet strip) */}
      <div className="bg-slate-950 text-slate-300 border-t border-slate-800 grid grid-cols-3 text-xs font-semibold">
        <div className="py-2.5 px-3 text-center text-emerald-400 bg-slate-900 border-b-2 border-emerald-500 font-bold truncate">
          Low stock
        </div>
        <button
          type="button"
          onClick={onSwitchToTable}
          className="py-2.5 px-3 text-center hover:bg-slate-900 hover:text-white transition-colors cursor-pointer border-l border-slate-800 truncate"
        >
          Detailed Table
        </button>
        {onOpenPurchasePlan ? (
          <button
            type="button"
            onClick={onOpenPurchasePlan}
            className="py-2.5 px-3 text-center hover:bg-slate-900 hover:text-white transition-colors cursor-pointer border-l border-slate-800 truncate"
          >
            Purchase Plan
          </button>
        ) : (
          <div className="py-2.5 px-3 text-center text-slate-500 border-l border-slate-800 truncate">
            {matrix.totalStoresCount} Stores
          </div>
        )}
      </div>

      {/* Add Store / Supplier Modal */}
      {isAddStoreOpen && onAddSupplier && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Add Purchase Store / Supplier
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Adds a new store column horizontally in your Low Stock sheet
                </p>
              </div>
              <button
                type="button"
                aria-label="Close add store modal"
                onClick={() => setIsAddStoreOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="py-4 space-y-3.5 text-xs">
              {addStoreError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold"
                >
                  {addStoreError}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Store / Supplier Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Akash Store, Mahabali Trading"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="10-digit WhatsApp / order number"
                  value={newStorePhone}
                  onChange={(e) => setNewStorePhone(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Market / Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Wholesale Kirana Mandi"
                  value={newStoreAddress}
                  onChange={(e) => setNewStoreAddress(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddStoreOpen(false)}
                  className="px-3.5 py-2 font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold cursor-pointer"
                >
                  Save Store Column
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
