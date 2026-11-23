import React, { useState, useMemo } from 'react';
import { Product, SaleItem } from '../types';
import {
  getAllowedSellingUnits,
  convertToBaseUnit,
  calculateItemPricing,
  formatQuantityWithUnit,
  normalizeUnit,
} from '../utils/units';
import { formatINR } from '../utils/accounting';
import { buildSnapshottedSaleItems, validateSaleStock } from '../utils/inventoryEngine';
import {
  X,
  Search,
  Plus,
  Minus,
  Check,
  Percent,
  Trash2,
  AlertTriangle,
  ArrowRight,
  ShoppingBag,
  Sparkles,
  Package,
} from 'lucide-react';

export interface AddItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  initialItems: SaleItem[];
  onConfirmItems: (items: SaleItem[]) => void;
  allowCustomItem?: boolean;
  allowNegativeStock?: boolean;
}

interface DraftItemState {
  productId?: string;
  productName: string;
  baseUnit: string;
  basePrice: number;
  availableStock: number;
  selectedUnit: string;
  quantity: number;
  discount: number;
  discountType: 'FLAT' | 'PERCENT';
  showDiscountInput?: boolean;
}

export const AddItemsModal: React.FC<AddItemsModalProps> = ({
  isOpen,
  onClose,
  products,
  initialItems,
  onConfirmItems,
  allowCustomItem = true,
  allowNegativeStock = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  // Custom quick product entry state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customUnit, setCustomUnit] = useState('KG');

  // Working state: map of productId (or custom id) -> DraftItemState
  const [draftItems, setDraftItems] = useState<Record<string, DraftItemState>>(() => {
    const map: Record<string, DraftItemState> = {};
    initialItems.forEach((it) => {
      const prod = products.find((p) => p.id === it.productId);
      const key = it.productId || `custom-${it.productName}`;
      map[key] = {
        productId: it.productId,
        productName: it.productName,
        baseUnit: it.baseUnit || prod?.unit || it.unit,
        basePrice: prod ? prod.sellingPrice : it.rate,
        availableStock: prod ? prod.stockQty : 9999,
        selectedUnit: it.unit,
        quantity: it.quantity,
        discount: it.discount || 0,
        discountType: it.discountType || 'FLAT',
        showDiscountInput: Boolean(it.discount && it.discount > 0),
      };
    });
    return map;
  });

  // Re-sync when modal opens
  React.useEffect(() => {
    if (isOpen) {
      const map: Record<string, DraftItemState> = {};
      initialItems.forEach((it) => {
        const prod = products.find((p) => p.id === it.productId);
        const key = it.productId || `custom-${it.productName}`;
        map[key] = {
          productId: it.productId,
          productName: it.productName,
          baseUnit: it.baseUnit || prod?.unit || it.unit,
          basePrice: prod ? prod.sellingPrice : it.rate,
          availableStock: prod ? prod.stockQty : 9999,
          selectedUnit: it.unit,
          quantity: it.quantity,
          discount: it.discount || 0,
          discountType: it.discountType || 'FLAT',
          showDiscountInput: Boolean(it.discount && it.discount > 0),
        };
      });
      setDraftItems(map);
      setSearchQuery('');
      setShowSelectedOnly(false);
    }
  }, [isOpen, initialItems, products]);

  // Active products only (hide archived items from new billing counter)
  const activeProducts = useMemo(() => products.filter((p) => !p.isArchived), [products]);

  // Categories for filter chips
  const categories = ['ALL', ...Array.from(new Set(activeProducts.map((p) => p.category)))];

  // Filtering products
  const filteredProducts = activeProducts.filter((p) => {
    const isSelected = Boolean(draftItems[p.id] && draftItems[p.id].quantity > 0);
    if (showSelectedOnly && !isSelected) return false;

    if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.localName && p.localName.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
  });

  // Actions on draft items
  const handleAddItem = (prod: Product) => {
    if (!allowNegativeStock && prod.stockQty <= 0) {
      return;
    }
    const allowedUnits = getAllowedSellingUnits(prod.unit);
    const defaultUnit = allowedUnits[0]?.unit || normalizeUnit(prod.unit);
    const defaultStep = allowedUnits[0]?.step || 1;
    let defaultQty = defaultStep >= 1 ? 1 : defaultStep;
    if (!allowNegativeStock && prod.stockQty > 0) {
      const basePerDefault = convertToBaseUnit(defaultQty, defaultUnit, prod.unit);
      if (basePerDefault > prod.stockQty && defaultUnit === normalizeUnit(prod.unit)) {
        defaultQty = Math.max(0.001, Math.round(prod.stockQty * 1000) / 1000);
      }
    }

    setDraftItems((prev) => ({
      ...prev,
      [prod.id]: {
        productId: prod.id,
        productName: prod.name,
        baseUnit: prod.unit,
        basePrice: prod.sellingPrice,
        availableStock: prod.stockQty,
        selectedUnit: defaultUnit,
        quantity: defaultQty,
        discount: 0,
        discountType: 'FLAT',
      },
    }));
  };

  const handleRemoveItem = (key: string) => {
    setDraftItems((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleUpdateQuantity = (key: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(key);
      return;
    }
    setDraftItems((prev) => {
      const item = prev[key];
      if (!item) return prev;
      return {
        ...prev,
        [key]: {
          ...item,
          quantity: Math.round((newQty + Number.EPSILON) * 1000) / 1000,
        },
      };
    });
  };

  const handleStepQuantity = (key: string, delta: number) => {
    const item = draftItems[key];
    if (!item) return;
    const allowed = getAllowedSellingUnits(item.baseUnit);
    const currentUnitConfig = allowed.find((u) => u.unit === item.selectedUnit);
    const step = currentUnitConfig?.step || 1;
    const newQty = item.quantity + delta * step;
    handleUpdateQuantity(key, newQty);
  };

  const handleUnitSwitch = (key: string, newUnit: string) => {
    const item = draftItems[key];
    if (!item || item.selectedUnit === newUnit) return;

    // Convert existing quantity to new unit so price remains invariant
    const oldBaseQty = convertToBaseUnit(item.quantity, item.selectedUnit, item.baseUnit);
    const newAllowed = getAllowedSellingUnits(item.baseUnit);
    const newUnitConfig = newAllowed.find((u) => u.unit === newUnit);

    let convertedQty: number;
    if (newUnitConfig && newUnitConfig.ratioToBase > 0) {
      convertedQty = oldBaseQty / newUnitConfig.ratioToBase;
      convertedQty = Math.round((convertedQty + Number.EPSILON) * 1000) / 1000;
    } else {
      convertedQty = 1;
    }

    setDraftItems((prev) => ({
      ...prev,
      [key]: {
        ...item,
        selectedUnit: newUnit,
        quantity: Math.max(0.001, convertedQty),
      },
    }));
  };

  const handlePresetClick = (key: string, presetQty: number, presetUnit?: string) => {
    const item = draftItems[key];
    if (!item) return;
    setDraftItems((prev) => ({
      ...prev,
      [key]: {
        ...item,
        selectedUnit: presetUnit || item.selectedUnit,
        quantity: presetQty,
      },
    }));
  };

  const handleDiscountChange = (key: string, discount: number, discountType: 'FLAT' | 'PERCENT') => {
    setDraftItems((prev) => {
      const item = prev[key];
      if (!item) return prev;
      return {
        ...prev,
        [key]: {
          ...item,
          discount: Math.max(0, discount),
          discountType,
        },
      };
    });
  };

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || Number(customPrice) <= 0) return;
    const customKey = `custom-${Date.now()}`;
    const baseP = Number(customPrice);
    setDraftItems((prev) => ({
      ...prev,
      [customKey]: {
        productName: customName.trim(),
        baseUnit: customUnit,
        basePrice: baseP,
        availableStock: 9999,
        selectedUnit: customUnit,
        quantity: 1,
        discount: 0,
        discountType: 'FLAT',
      },
    }));
    setCustomName('');
    setCustomPrice('');
    setShowCustomModal(false);
  };

  // Compile calculations for all items currently in cart
  const selectedEntries = Object.entries(draftItems).filter(([, item]) => item.quantity > 0);

  const summary = useMemo(() => {
    let totalItems = 0;
    let totalGross = 0;
    let totalDiscount = 0;
    let totalFinal = 0;
    let totalBaseQuantity = 0;

    selectedEntries.forEach(([, item]) => {
      totalItems += 1;
      const calc = calculateItemPricing({
        basePrice: item.basePrice,
        baseUnit: item.baseUnit,
        quantity: item.quantity,
        selectedUnit: item.selectedUnit,
        discount: item.discount,
        discountType: item.discountType,
      });

      totalGross += calc.grossAmount;
      totalDiscount += calc.discountAmount;
      totalFinal += calc.finalTotal;
      totalBaseQuantity += calc.baseQuantity;
    });

    return {
      totalItems,
      totalGross: Math.round(totalGross * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalFinal: Math.round(totalFinal * 100) / 100,
      totalBaseQuantity: Math.round(totalBaseQuantity * 1000) / 1000,
    };
  }, [selectedEntries]);

  const compiledSaleItems = useMemo<SaleItem[]>(() => {
    const rawItems: SaleItem[] = selectedEntries.map(([, item]) => {
      const calc = calculateItemPricing({
        basePrice: item.basePrice,
        baseUnit: item.baseUnit,
        quantity: item.quantity,
        selectedUnit: item.selectedUnit,
        discount: item.discount,
        discountType: item.discountType,
      });

      return {
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.selectedUnit,
        baseUnit: item.baseUnit,
        baseQuantity: calc.baseQuantity,
        rate: calc.effectiveUnitPrice,
        discount: calc.discountAmount,
        discountType: item.discountType,
        total: calc.finalTotal,
      };
    });
    return buildSnapshottedSaleItems(rawItems, products);
  }, [selectedEntries, products]);

  const stockValidation = useMemo(
    () =>
      validateSaleStock({
        items: compiledSaleItems,
        products,
        allowNegativeStock,
      }),
    [compiledSaleItems, products, allowNegativeStock]
  );

  // Handle final confirmation
  const handleConfirm = () => {
    if (!stockValidation.valid) {
      return;
    }
    onConfirmItems(compiledSaleItems);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full h-[92vh] max-h-[820px] flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 bg-emerald-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-800 rounded-xl text-emerald-300">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base leading-tight">Add Items to Bill (Saman Jode)</h3>
                <span className="text-[10px] bg-emerald-800/80 text-emerald-200 px-2 py-0.5 rounded-full font-medium">
                  Smart Units
                </span>
              </div>
              <p className="text-xs text-emerald-300/80">Search kirana items, switch KG/GM and enter quantities</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 shrink-0 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search products by name, Hinglish name (Aalu, Daal, Aata)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-900 text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-emerald-600 shadow-2xs text-slate-900 dark:text-slate-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {allowCustomItem && (
              <button
                type="button"
                onClick={() => setShowCustomModal(true)}
                className="px-3 py-2 bg-white dark:bg-slate-900 border border-dashed border-emerald-600 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 shrink-0 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Custom Item</span>
              </button>
            )}
          </div>

          {/* Filter Chips & Selected Only Toggle */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
            <div className="flex items-center gap-1.5 shrink-0">
              {categories.slice(0, 5).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-emerald-800 text-white shadow-2xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {cat === 'ALL' ? 'All (Sabhi)' : cat}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowSelectedOnly(!showSelectedOnly)}
              className={`px-3 py-1 rounded-lg font-semibold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                showSelectedOnly
                  ? 'bg-emerald-700 text-white shadow-2xs'
                  : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Check className={`w-3.5 h-3.5 ${showSelectedOnly ? 'opacity-100' : 'opacity-40'}`} />
              <span>Selected only ({summary.totalItems})</span>
            </button>
          </div>
        </div>

        {/* Product Cards List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-slate-100/50 dark:bg-slate-950/60">
          {/* Custom Items if any added */}
          {selectedEntries
            .filter(([key]) => key.startsWith('custom-'))
            .map(([key, item]) => {
              const calc = calculateItemPricing({
                basePrice: item.basePrice,
                baseUnit: item.baseUnit,
                quantity: item.quantity,
                selectedUnit: item.selectedUnit,
                discount: item.discount,
                discountType: item.discountType,
              });

              return (
                <div
                  key={key}
                  className="bg-white dark:bg-slate-900 rounded-xl p-3 border-2 border-emerald-500 shadow-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{item.productName}</span>
                        <span className="text-[10px] bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded font-medium">
                          Custom
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Rate: {formatINR(item.basePrice)} / {item.baseUnit}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(key)}
                      className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => handleStepQuantity(key, -1)}
                        className="w-7 h-7 flex items-center justify-center bg-white dark:bg-slate-900 rounded text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min="0.1"
                        step="any"
                        value={item.quantity}
                        onChange={(e) => handleUpdateQuantity(key, parseFloat(e.target.value) || 0)}
                        className="w-14 text-center font-bold text-xs bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleStepQuantity(key, 1)}
                        className="w-7 h-7 flex items-center justify-center bg-white dark:bg-slate-900 rounded text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-extrabold text-emerald-900 dark:text-emerald-300">
                        {formatINR(calc.finalTotal)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

          {filteredProducts.length === 0 && selectedEntries.length === 0 ? (
            <div className="text-center py-12 px-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
              <Package className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">No products found</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Try searching for another kirana staple (e.g. Atta, Alu, Rice) or add a custom item.
              </p>
            </div>
          ) : (
            filteredProducts.map((prod) => {
              const draft = draftItems[prod.id];
              const isSelected = Boolean(draft && draft.quantity > 0);
              const allowedUnits = getAllowedSellingUnits(prod.unit);
              const isLowStock = prod.stockQty <= prod.minStockAlert;

              // Pricing calculation for active draft
              const calc = isSelected
                ? calculateItemPricing({
                    basePrice: prod.sellingPrice,
                    baseUnit: prod.unit,
                    quantity: draft.quantity,
                    selectedUnit: draft.selectedUnit,
                    discount: draft.discount,
                    discountType: draft.discountType,
                  })
                : null;

              // Check if stock is exceeded
              const isStockExceeded = isSelected && calc ? calc.baseQuantity > prod.stockQty : false;

              return (
                <div
                  key={prod.id}
                  className={`bg-white dark:bg-slate-900 rounded-xl p-3.5 transition-all border ${
                    isSelected
                      ? 'border-emerald-600 shadow-sm ring-1 ring-emerald-600/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'
                  }`}
                >
                  {/* Top Bar: Name, Category, Stock & Add Button */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug">{prod.name}</span>
                        {prod.localName && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">({prod.localName})</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs mt-1 flex-wrap">
                        <span className="font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200/60 dark:border-emerald-800">
                          {formatINR(prod.sellingPrice)} / {prod.unit}
                        </span>

                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                            isLowStock
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          Stock: {formatQuantityWithUnit(prod.stockQty, prod.unit)}
                        </span>

                        <span className="text-slate-400 text-[11px]">{prod.category}</span>
                      </div>
                    </div>

                    {!isSelected ? (
                      <button
                        type="button"
                        onClick={() => handleAddItem(prod)}
                        disabled={!allowNegativeStock && prod.stockQty <= 0}
                        className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shrink-0 flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{!allowNegativeStock && prod.stockQty <= 0 ? 'Out of Stock' : 'ADD'}</span>
                      </button>
                    ) : (
                      <div className="text-right shrink-0">
                        <div className="text-base font-extrabold text-emerald-900 dark:text-emerald-300">
                          {formatINR(calc?.finalTotal || 0)}
                        </div>
                        {calc && calc.discountAmount > 0 && (
                          <div className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                            (Saved {formatINR(calc.discountAmount)})
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Active Item Controls */}
                  {isSelected && draft && calc && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                      {/* Unit Switcher & Stepper row */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Smart Unit Switcher */}
                        {allowedUnits.length > 1 ? (
                          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            {allowedUnits.map((opt) => {
                              const active = draft.selectedUnit === opt.unit;
                              return (
                                <button
                                  key={opt.unit}
                                  type="button"
                                  onClick={() => handleUnitSwitch(prod.id, opt.unit)}
                                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                    active
                                      ? 'bg-emerald-700 text-white shadow-2xs'
                                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                  }`}
                                >
                                  {opt.shortLabel}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700">
                            Unit: {draft.selectedUnit}
                          </div>
                        )}

                        {/* Stepper with manual input */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStepQuantity(prod.id, -1)}
                            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold active:scale-95 transition-transform cursor-pointer"
                            title="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={draft.quantity}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                handleUpdateQuantity(prod.id, isNaN(val) ? 0 : val);
                              }}
                              className="w-20 text-center py-1 text-sm font-extrabold border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-emerald-600 bg-white dark:bg-slate-800"
                            />
                            <span className="text-[10px] text-slate-400 absolute right-1.5 bottom-1 font-semibold pointer-events-none">
                              {draft.selectedUnit}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleStepQuantity(prod.id, 1)}
                            className="w-8 h-8 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white flex items-center justify-center font-bold active:scale-95 transition-transform cursor-pointer shadow-2xs"
                            title="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(prod.id)}
                            className="w-8 h-8 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/60 flex items-center justify-center transition-colors cursor-pointer ml-1"
                            title="Remove from bill"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Quick Preset Chips for Faster Kirana Billing */}
                      {(() => {
                        const activeConfig = allowedUnits.find((u) => u.unit === draft.selectedUnit);
                        const presets = activeConfig?.presets || [];
                        if (presets.length === 0) return null;

                        return (
                          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 text-xs">
                            <span className="text-[10px] text-slate-400 uppercase font-semibold">Quick:</span>
                            {presets.map((presetVal) => {
                              const isCurrent = draft.quantity === presetVal;
                              return (
                                <button
                                  key={presetVal}
                                  type="button"
                                  onClick={() => handlePresetClick(prod.id, presetVal)}
                                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                                    isCurrent
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  {presetVal} {draft.selectedUnit}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* Item-Level Discount & Line Calculation Breakdown */}
                      <div className="flex items-center justify-between text-xs pt-1 text-slate-600 dark:text-slate-300 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftItems((prev) => ({
                                ...prev,
                                [prod.id]: {
                                  ...draft,
                                  showDiscountInput: !draft.showDiscountInput,
                                },
                              }))
                            }
                            className="text-[11px] text-emerald-800 dark:text-emerald-300 hover:underline flex items-center gap-1 font-medium cursor-pointer"
                          >
                            <Percent className="w-3 h-3" />
                            <span>
                              {draft.discount > 0
                                ? `Discount applied: ${
                                    draft.discountType === 'PERCENT'
                                      ? `${draft.discount}%`
                                      : formatINR(draft.discount)
                                  }`
                                : '+ Add Item Discount'}
                            </span>
                          </button>

                          {draft.showDiscountInput && (
                            <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-950/60 p-1 rounded-lg border border-amber-200 dark:border-amber-800">
                              <input
                                type="number"
                                min="0"
                                placeholder="Discount"
                                value={draft.discount || ''}
                                onChange={(e) =>
                                  handleDiscountChange(
                                    prod.id,
                                    parseFloat(e.target.value) || 0,
                                    draft.discountType
                                  )
                                }
                                className="w-14 text-center py-0.5 text-xs border border-amber-300 dark:border-amber-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              />
                              <div className="flex border border-amber-300 dark:border-amber-700 rounded overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => handleDiscountChange(prod.id, draft.discount, 'FLAT')}
                                  className={`px-1 text-[10px] font-bold ${
                                    draft.discountType === 'FLAT'
                                      ? 'bg-amber-600 text-white'
                                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  ₹
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDiscountChange(prod.id, draft.discount, 'PERCENT')}
                                  className={`px-1 text-[10px] font-bold ${
                                    draft.discountType === 'PERCENT'
                                      ? 'bg-amber-600 text-white'
                                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  %
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Calculated line rate explanation */}
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatQuantityWithUnit(draft.quantity, draft.selectedUnit)} ×{' '}
                          {formatINR(calc.effectiveUnitPrice)}/{draft.selectedUnit} ={' '}
                          <strong className="text-slate-900 dark:text-slate-100">{formatINR(calc.grossAmount)}</strong>
                        </div>
                      </div>

                      {/* Stock Exceeded Warning */}
                      {isStockExceeded && (
                        <div
                          role="alert"
                          className={`flex items-center gap-1.5 text-xs p-2 rounded-lg border ${
                            allowNegativeStock
                              ? 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800'
                              : 'text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 font-semibold'
                          }`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {allowNegativeStock
                              ? `Negative stock allowed: requested ${formatQuantityWithUnit(calc.baseQuantity, prod.unit)} vs available ${formatQuantityWithUnit(prod.stockQty, prod.unit)}.`
                              : `Insufficient stock: Available ${formatQuantityWithUnit(prod.stockQty, prod.unit)}, Requested ${formatQuantityWithUnit(calc.baseQuantity, prod.unit)}.`}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Custom Item Popover / Mini-Modal */}
        {showCustomModal && (
          <div className="fixed inset-0 z-70 bg-black/50 flex items-center justify-center p-4">
            <form
              onSubmit={handleAddCustomItem}
              className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 space-y-3.5 shadow-2xl border border-slate-200 dark:border-slate-800"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Add Custom Product (Anya Saman)</h4>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Khula Besan, Desi Gud"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 focus:outline-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Price (₹) *</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="e.g. 60"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 focus:outline-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                  <select
                    value={customUnit}
                    onChange={(e) => setCustomUnit(e.target.value)}
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
                  >
                    <option value="KG">KG</option>
                    <option value="GM">GM</option>
                    <option value="LITRE">LITRE</option>
                    <option value="ML">ML</option>
                    <option value="PCS">PCS</option>
                    <option value="PACKET">PACKET</option>
                    <option value="BOX">BOX</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-2xs cursor-pointer"
                >
                  Add to Bill
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Bottom Sticky Khatabook-inspired Invoice Summary Bar */}
        <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 shadow-lg space-y-2.5">
          {!stockValidation.valid && stockValidation.error && (
            <div
              role="alert"
              className="flex items-start gap-2 p-2.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-200"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{stockValidation.error}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {summary.totalItems} {summary.totalItems === 1 ? 'Item' : 'Items'} Selected
                </span>
                {summary.totalDiscount > 0 && (
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                    Saved {formatINR(summary.totalDiscount)}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight tabular-nums">
                  {formatINR(summary.totalFinal)}
                </span>
                {summary.totalDiscount > 0 && (
                  <span className="text-xs text-slate-400 line-through">
                    {formatINR(summary.totalGross)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white cursor-pointer hidden sm:block"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={summary.totalItems === 0 || !stockValidation.valid}
                className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-50 disabled:pointer-events-none text-white rounded-xl text-xs sm:text-sm font-bold shadow-md flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>CONTINUE (Bill me Jode)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
