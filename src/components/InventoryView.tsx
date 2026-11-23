import React, { useState, useRef, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import { Product } from '../types';
import {
  formatINR,
  calculateInventoryValuation,
  validateProductForm,
  hasProductTransactionHistory,
  getApproachingReorderProducts,
} from '../utils/accounting';
import {
  exportProductsToCSV,
  downloadCSVFile,
  getSampleProductCSV,
} from '../utils/csv';
import {
  Search,
  Plus,
  AlertTriangle,
  Edit2,
  Trash2,
  X,
  CheckCircle,
  Download,
  Upload,
  SlidersHorizontal,
  ClipboardList,
  Archive,
  RotateCcw,
  History,
  ShieldAlert,
  TrendingUp,
  Store,
  Layers,
  Tag,
  FileBarChart2,
  Activity,
} from 'lucide-react';
import { PurchaseOrderModal } from './PurchaseOrderModal';
import { LowStockSection } from './LowStockSection';
import { PurchasePlanningView } from './PurchasePlanningView';
import { InventoryBulkImportModal } from './InventoryBulkImportModal';
import { StockVelocityMonitorPanel } from './StockVelocityMonitorPanel';
import {
  LowStockItemView,
  buildLowStockItems,
  groupLowStockBySupplier,
} from '../utils/lowStock';
import {
  buildStockVelocityMonitorReport,
  DEFAULT_STOCK_VELOCITY_CONFIG,
  StockVelocityConfig,
  StockVelocityItem,
} from '../utils/stockVelocity';
import { getCategoryDefaults } from '../utils/inventoryCategories';

const KIRANA_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'pcs', label: 'Pieces (pcs)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'g', label: 'Grams (g)' },
  { value: 'L', label: 'Litres (L)' },
  { value: 'ml', label: 'Millilitres (ml)' },
  { value: 'pkt', label: 'Packets (pkt)' },
  { value: 'bags', label: 'Bags (bags)' },
  { value: 'boxes', label: 'Boxes (boxes)' },
  { value: 'dozens', label: 'Dozens (dozens)' },
];

const KIRANA_CATEGORY_SUGGESTIONS = [
  'Grains & Flour',
  'Pulses & Dal',
  'Oils & Ghee',
  'Spices & Masala',
  'Tea & Beverages',
  'Snacks & Biscuits',
  'Personal Care',
  'Household & Cleaning',
  'Dairy & Bakery',
  'General Kirana',
];

type StockStatusFilter = 'ALL' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'ARCHIVED';

function resolveUnitSelectValue(rawUnit: string): { selectValue: string; customValue: string } {
  const trimmed = (rawUnit || '').trim();
  const lower = trimmed.toLowerCase();
  const exact = KIRANA_UNIT_OPTIONS.find((opt) => opt.value.toLowerCase() === lower);
  if (exact) {
    return { selectValue: exact.value, customValue: '' };
  }
  // Map common canonical equivalents cleanly onto standard presets
  if (lower === 'litre' || lower === 'liter' || lower === 'ltr') {
    return { selectValue: 'L', customValue: '' };
  }
  if (lower === 'gm' || lower === 'gram' || lower === 'grams') {
    return { selectValue: 'g', customValue: '' };
  }
  if (lower === 'packet' || lower === 'packets' || lower === 'pack') {
    return { selectValue: 'pkt', customValue: '' };
  }
  if (lower === 'bag' || lower === 'sack') {
    return { selectValue: 'bags', customValue: '' };
  }
  if (lower === 'box') {
    return { selectValue: 'boxes', customValue: '' };
  }
  if (lower === 'dozen' || lower === 'doz') {
    return { selectValue: 'dozens', customValue: '' };
  }
  if (lower === 'piece' || lower === 'pieces' || lower === 'pc') {
    return { selectValue: 'pcs', customValue: '' };
  }
  if (!trimmed) {
    return { selectValue: 'pcs', customValue: '' };
  }
  return { selectValue: 'CUSTOM', customValue: trimmed };
}

export const InventoryView: React.FC = () => {
  const {
    products,
    productCategories,
    sales,
    stockAdjustments,
    suppliers,
    profile,
    addProduct,
    updateProduct,
    updateProductThreshold,
    adjustStock,
    archiveProduct,
    deleteProduct,
    bulkUpdateProductsCategory,
    bulkDeleteOrArchiveProducts,
    importProductsFromCSV,
    importProductsBatch,
    inventoryActiveTab,
    setInventoryActiveTab,
    addSupplier,
    openSupplierProfile,
    openAddPurchaseForProduct,
    openCategorySettings,
    openStockMovementReport,
  } = useStore();

  const inventoryTab = inventoryActiveTab;
  const setInventoryTab = setInventoryActiveTab;
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [velocityConfig, setVelocityConfig] = useState<StockVelocityConfig>(
    DEFAULT_STOCK_VELOCITY_CONFIG
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stockFilter, setStockFilter] = useState<StockStatusFilter>('ALL');

  // Stage 4: Multi-Select Bulk Actions State
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [bulkCategoryInput, setBulkCategoryInput] = useState<string>('Grains & Flour');
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);
  const [bulkStatusBanner, setBulkStatusBanner] = useState<string | null>(null);

  // Add / Edit Product Modal State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [pendingConfirmEdit, setPendingConfirmEdit] = useState(false);

  const [formName, setFormName] = useState('');
  const [formLocalName, setFormLocalName] = useState('');
  const [formCategory, setFormCategory] = useState('Grains & Flour');
  const [formPurchasePrice, setFormPurchasePrice] = useState('');
  const [formSellingPrice, setFormSellingPrice] = useState('');
  const [formMrp, setFormMrp] = useState('');
  const [formUnitSelect, setFormUnitSelect] = useState('kg');
  const [formCustomUnit, setFormCustomUnit] = useState('');
  const [unitManuallyEdited, setUnitManuallyEdited] = useState(false);
  const [formStockQty, setFormStockQty] = useState('');
  const [formMinStockAlert, setFormMinStockAlert] = useState('10');
  const [formDesiredStockLevel, setFormDesiredStockLevel] = useState('');
  const [formPreferredSupplierId, setFormPreferredSupplierId] = useState('');
  const [formLastPurchasePrice, setFormLastPurchasePrice] = useState('');
  const [formSupplierNotes, setFormSupplierNotes] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Stock Adjustment Modal State
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedProductForAdjust, setSelectedProductForAdjust] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustType, setAdjustType] = useState<'ADD' | 'SUBTRACT'>('ADD');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustDate, setAdjustDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Stock Adjustment History Modal State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyFilterProductId, setHistoryFilterProductId] = useState<string>('ALL');

  // Threshold Modal State
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState(false);
  const [selectedProdForThreshold, setSelectedProdForThreshold] = useState<Product | null>(null);
  const [newThresholdInput, setNewThresholdInput] = useState('');

  // Delete / Archive Confirmation Modal State
  const [deleteTargetProduct, setDeleteTargetProduct] = useState<Product | null>(null);
  const [deleteReason, setDeleteReason] = useState('Discontinued item');

  // Purchase Order Draft modal
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [focusPOProductId, setFocusPOProductId] = useState<string | null>(null);

  // CSV Import feedback
  const [importSummary, setImportSummary] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeProducts = useMemo(() => products.filter((p) => !p.isArchived), [products]);
  const archivedProducts = useMemo(() => products.filter((p) => !!p.isArchived), [products]);

  const categories = useMemo(
    () => Array.from(new Set(activeProducts.map((p) => p.category))),
    [activeProducts]
  );

  const managedCategoryNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...productCategories.map((c) => c.name),
          ...activeProducts.map((p) => p.category).filter(Boolean),
          ...KIRANA_CATEGORY_SUGGESTIONS,
        ])
      ),
    [productCategories, activeProducts]
  );

  const valuation = useMemo(() => calculateInventoryValuation(products), [products]);

  const approachingIds = useMemo(() => {
    const items = getApproachingReorderProducts(products);
    return new Set(items.map((it) => it.product.id));
  }, [products]);

  const outOfStockCount = useMemo(
    () => activeProducts.filter((p) => p.stockQty <= 0).length,
    [activeProducts]
  );

  const lowStockItems = useMemo(
    () => buildLowStockItems(products, suppliers),
    [products, suppliers]
  );

  const supplierPlanGroups = useMemo(
    () => groupLowStockBySupplier(lowStockItems, suppliers),
    [lowStockItems, suppliers]
  );

  const velocityReport = useMemo(
    () =>
      buildStockVelocityMonitorReport({
        products,
        sales,
        suppliers,
        config: velocityConfig,
      }),
    [products, sales, suppliers, velocityConfig]
  );

  const velocityByProductId = useMemo(() => {
    const map = new Map<string, StockVelocityItem>();
    velocityReport.items.forEach((it) => map.set(it.product.id, it));
    return map;
  }, [velocityReport.items]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return products.filter((p) => {
      if (stockFilter === 'ARCHIVED') {
        if (!p.isArchived) return false;
      } else {
        if (p.isArchived) return false;
        if (stockFilter === 'LOW_STOCK' && p.stockQty > p.minStockAlert) return false;
        if (stockFilter === 'OUT_OF_STOCK' && p.stockQty > 0) return false;
      }

      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;

      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.localName && p.localName.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.preferredSupplierName && p.preferredSupplierName.toLowerCase().includes(q)) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery, selectedCategory, stockFilter]);

  const visibleSelectedCount = useMemo(() => {
    let count = 0;
    for (const p of filteredProducts) {
      if (selectedProductIds.has(p.id)) count++;
    }
    return count;
  }, [filteredProducts, selectedProductIds]);

  const allVisibleSelected =
    filteredProducts.length > 0 && visibleSelectedCount === filteredProducts.length;

  const toggleSelectAllVisible = () => {
    setBulkConfirmDelete(false);
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredProducts.forEach((p) => next.delete(p.id));
      } else {
        filteredProducts.forEach((p) => next.add(p.id));
      }
      return next;
    });
  };

  const toggleSelectProduct = (productId: string) => {
    setBulkConfirmDelete(false);
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const handleBulkAssignCategory = () => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0 || !bulkCategoryInput.trim()) return;
    const updatedCount = bulkUpdateProductsCategory(ids, bulkCategoryInput.trim());
    setBulkStatusBanner(
      `Updated category to "${bulkCategoryInput.trim()}" for ${updatedCount} product(s).`
    );
    setSelectedProductIds(new Set());
    setBulkConfirmDelete(false);
  };

  const handleBulkDeleteOrArchive = () => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0) return;
    const res = bulkDeleteOrArchiveProducts(ids, 'Bulk action from inventory table');
    setBulkStatusBanner(
      `Bulk cleanup complete: ${res.archivedCount} archived (had bill/stock history), ${res.deletedCount} permanently deleted.`
    );
    setSelectedProductIds(new Set());
    setBulkConfirmDelete(false);
  };

  const openAddModal = () => {
    const initialCategory = productCategories[0]?.name || 'Grains & Flour';
    const defaults = getCategoryDefaults(productCategories, initialCategory) || {
      defaultUnit: 'pcs',
      defaultMinStockAlert: 5,
    };
    const resolvedUnit = resolveUnitSelectValue(defaults.defaultUnit);
    setEditingProduct(null);
    setFormName('');
    setFormLocalName('');
    setFormCategory(initialCategory);
    setFormPurchasePrice('');
    setFormSellingPrice('');
    setFormMrp('');
    setFormUnitSelect(resolvedUnit.selectValue);
    setFormCustomUnit(resolvedUnit.customValue);
    setUnitManuallyEdited(false);
    setFormStockQty('');
    setFormMinStockAlert(String(defaults.defaultMinStockAlert ?? 5));
    setFormDesiredStockLevel('');
    setFormPreferredSupplierId('');
    setFormLastPurchasePrice('');
    setFormSupplierNotes('');
    setFormDescription('');
    setFormErrors([]);
    setPendingConfirmEdit(false);
    setIsProductModalOpen(true);
  };

  const openEditModal = (prod: Product) => {
    setEditingProduct(prod);
    setFormName(prod.name);
    setFormLocalName(prod.localName || '');
    setFormCategory(prod.category || 'General Kirana');
    setFormPurchasePrice(String(prod.purchasePrice));
    setFormSellingPrice(String(prod.sellingPrice));
    setFormMrp(prod.mrp !== undefined ? String(prod.mrp) : '');
    const resolvedUnit = resolveUnitSelectValue(prod.unit);
    setFormUnitSelect(resolvedUnit.selectValue);
    setFormCustomUnit(resolvedUnit.customValue);
    setUnitManuallyEdited(true);
    setFormStockQty(String(prod.stockQty));
    setFormMinStockAlert(String(prod.minStockAlert));
    setFormDesiredStockLevel(
      prod.desiredStockLevel !== undefined && prod.desiredStockLevel > 0
        ? String(prod.desiredStockLevel)
        : ''
    );
    setFormPreferredSupplierId(prod.preferredSupplierId || '');
    setFormLastPurchasePrice(
      prod.lastPurchasePrice !== undefined ? String(prod.lastPurchasePrice) : ''
    );
    setFormSupplierNotes(prod.supplierNotes || '');
    setFormDescription(prod.description || '');
    setFormErrors([]);
    setPendingConfirmEdit(false);
    setIsProductModalOpen(true);
  };

  const effectiveFormUnit =
    formUnitSelect === 'CUSTOM' ? formCustomUnit.trim() : formUnitSelect;

  const parsedPurchasePrice =
    formPurchasePrice.trim() === '' ? 0 : Number(formPurchasePrice);
  const parsedSellingPrice = Number(formSellingPrice);
  const parsedMrp = formMrp.trim() === '' ? undefined : Number(formMrp);
  const parsedStockQty = formStockQty.trim() === '' ? 0 : Number(formStockQty);
  const parsedMinStockAlert =
    formMinStockAlert.trim() === '' ? 0 : Number(formMinStockAlert);

  const liveProfitPerItem =
    Number.isFinite(parsedSellingPrice) && Number.isFinite(parsedPurchasePrice)
      ? Math.round((parsedSellingPrice - parsedPurchasePrice) * 100) / 100
      : 0;
  const liveProfitMarginPct =
    parsedSellingPrice > 0
      ? Math.round((liveProfitPerItem / parsedSellingPrice) * 1000) / 10
      : 0;

  const handleSaveProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateProductForm({
      name: formName,
      purchasePrice: parsedPurchasePrice,
      sellingPrice: parsedSellingPrice,
      mrp: parsedMrp,
      stockQty: parsedStockQty,
      minStockAlert: parsedMinStockAlert,
      unit: effectiveFormUnit,
    });

    if (!validation.valid) {
      setFormErrors(validation.errors);
      return;
    }

    setFormErrors([]);

    const chosenSupplier = formPreferredSupplierId
      ? suppliers.find((s) => s.id === formPreferredSupplierId)
      : undefined;
    const parsedDesiredLevel =
      formDesiredStockLevel.trim() === ''
        ? undefined
        : Math.max(0, Number(formDesiredStockLevel));
    const parsedLastPurchasePrice =
      formLastPurchasePrice.trim() === ''
        ? undefined
        : Math.max(0, Number(formLastPurchasePrice));

    const supplierPatch = {
      desiredStockLevel:
        parsedDesiredLevel !== undefined && Number.isFinite(parsedDesiredLevel)
          ? parsedDesiredLevel
          : undefined,
      preferredSupplierId: chosenSupplier?.id || undefined,
      preferredSupplierName: chosenSupplier?.name || undefined,
      preferredSupplierPhone: chosenSupplier?.phone || undefined,
      lastPurchasePrice:
        parsedLastPurchasePrice !== undefined && Number.isFinite(parsedLastPurchasePrice)
          ? parsedLastPurchasePrice
          : undefined,
      supplierNotes: formSupplierNotes.trim() || undefined,
    };

    if (editingProduct) {
      const priceOrUnitOrStockChanged =
        editingProduct.purchasePrice !== parsedPurchasePrice ||
        editingProduct.sellingPrice !== parsedSellingPrice ||
        editingProduct.unit !== effectiveFormUnit ||
        editingProduct.stockQty !== parsedStockQty;

      if (priceOrUnitOrStockChanged && !pendingConfirmEdit) {
        setPendingConfirmEdit(true);
        return;
      }

      const stockDelta = Math.round((parsedStockQty - editingProduct.stockQty) * 10000) / 10000;

      if (stockDelta !== 0) {
        const adjResult = adjustStock(
          editingProduct.id,
          stockDelta,
          'Updated stock via Edit Product form',
          new Date().toISOString().split('T')[0],
          'EDIT'
        );
        if (!adjResult.success) {
          setFormErrors([adjResult.error || 'Unable to adjust stock quantity.']);
          setPendingConfirmEdit(false);
          return;
        }
      }

      updateProduct(editingProduct.id, {
        name: formName.trim(),
        localName: formLocalName.trim() || undefined,
        category: formCategory.trim() || 'General Kirana',
        purchasePrice: parsedPurchasePrice,
        sellingPrice: parsedSellingPrice,
        mrp: parsedMrp,
        unit: effectiveFormUnit,
        minStockAlert: parsedMinStockAlert,
        description: formDescription.trim() || undefined,
        ...supplierPatch,
      });
    } else {
      addProduct({
        name: formName.trim(),
        localName: formLocalName.trim() || undefined,
        category: formCategory.trim() || 'General Kirana',
        purchasePrice: parsedPurchasePrice,
        sellingPrice: parsedSellingPrice,
        mrp: parsedMrp,
        stockQty: parsedStockQty,
        unit: effectiveFormUnit,
        minStockAlert: parsedMinStockAlert,
        description: formDescription.trim() || undefined,
        ...supplierPatch,
        lastPurchasePrice:
          supplierPatch.lastPurchasePrice !== undefined
            ? supplierPatch.lastPurchasePrice
            : parsedPurchasePrice > 0
            ? parsedPurchasePrice
            : undefined,
      });
    }

    setPendingConfirmEdit(false);
    setIsProductModalOpen(false);
    setEditingProduct(null);
  };

  const handleAssignSupplierQuick = (
    productId: string,
    supplierId: string | undefined,
    desiredStockLevel?: number,
    supplierNotes?: string
  ) => {
    const sup = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
    updateProduct(productId, {
      preferredSupplierId: sup?.id || undefined,
      preferredSupplierName: sup?.name || undefined,
      preferredSupplierPhone: sup?.phone || undefined,
      ...(desiredStockLevel !== undefined ? { desiredStockLevel } : {}),
      supplierNotes,
    });
  };

  const handleOpenAddPurchaseForLowStock = (item: LowStockItemView) => {
    openAddPurchaseForProduct({
      productId: item.product.id,
      productName: item.product.name,
      unit: item.product.unit,
      supplierId: item.preferredSupplierId,
      suggestedQty: Math.max(1, item.suggestedPurchaseQty || 1),
      unitPurchasePrice: item.lastPurchasePrice,
      notes: item.supplierNotes,
    });
  };

  const openAdjustStockQuick = (prod: Product) => {
    setSelectedProductForAdjust(prod);
    setAdjustType('ADD');
    setAdjustQty('');
    setAdjustReason('');
    setAdjustDate(new Date().toISOString().split('T')[0]);
    setAdjustError(null);
    setIsAdjustModalOpen(true);
  };

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForAdjust) return;
    const qty = Number(adjustQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setAdjustError('Please enter a positive stock quantity greater than zero.');
      return;
    }
    const trimmedReason = adjustReason.trim();
    if (trimmedReason.length < 3) {
      setAdjustError('Please enter a clear reason (at least 3 characters) for manual stock adjustment.');
      return;
    }
    const change = adjustType === 'ADD' ? qty : -qty;
    const res = adjustStock(
      selectedProductForAdjust.id,
      change,
      trimmedReason,
      adjustDate,
      'MANUAL'
    );
    if (!res.success) {
      setAdjustError(res.error || 'Could not adjust stock.');
      return;
    }
    setAdjustError(null);
    setAdjustQty('');
    setAdjustReason('');
    setIsAdjustModalOpen(false);
  };

  const handleExportCSV = () => {
    const csvStr = exportProductsToCSV(products);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSVFile(`kirana-inventory-${dateStr}.csv`, csvStr);
  };

  const handleDownloadSample = () => {
    downloadCSVFile('sample-kirana-products.csv', getSampleProductCSV());
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const result = importProductsFromCSV(text);
        setImportSummary(result);
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const handleThresholdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProdForThreshold) return;
    const val = parseFloat(newThresholdInput);
    if (!isNaN(val) && val >= 0) {
      updateProductThreshold(selectedProdForThreshold.id, val);
    }
    setIsThresholdModalOpen(false);
    setSelectedProdForThreshold(null);
  };

  const targetHasHistory = useMemo(() => {
    if (!deleteTargetProduct) return false;
    return hasProductTransactionHistory(
      deleteTargetProduct.id,
      deleteTargetProduct.name,
      sales,
      stockAdjustments
    );
  }, [deleteTargetProduct, sales, stockAdjustments]);

  const filteredAdjustmentHistory = useMemo(() => {
    if (historyFilterProductId === 'ALL') return stockAdjustments;
    return stockAdjustments.filter((adj) => adj.productId === historyFilterProductId);
  }, [stockAdjustments, historyFilterProductId]);

  return (
    <div className="space-y-4 pb-12">
      {/* Top Valuation Summary & Actions */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide">
            Total Active Inventory Valuation (Dukan me Bhare Maal ka Mulya)
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-emerald-900 dark:text-emerald-300 tracking-tight mt-0.5 tabular-nums">
            {formatINR(valuation.totalCostValue)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Retail Selling Value:{' '}
            <strong className="text-slate-800 dark:text-slate-200 tabular-nums">
              {formatINR(valuation.totalRetailValue)}
            </strong>{' '}
            · Potential Profit:{' '}
            <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">
              {formatINR(valuation.potentialProfit)}
            </strong>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />

          <button
            type="button"
            onClick={openCategorySettings}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
            title="Manage product categories, default units, and merge categories"
          >
            <Tag className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            <span>Categories</span>
          </button>

          <button
            type="button"
            onClick={() => openStockMovementReport('ALL')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
            title="Open Full Stock Movement Audit Report"
          >
            <FileBarChart2 className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
            <span>Movement Report</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setHistoryFilterProductId('ALL');
              setIsHistoryModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
            title="View Stock Adjustment Log"
          >
            <History className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            <span>Stock History ({stockAdjustments.length})</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs cursor-pointer"
            title="Export full inventory to CSV spreadsheet"
          >
            <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setIsBulkImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
            title="Bulk import or update products from CSV or PDF file"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            <span>Import CSV / PDF</span>
          </button>

          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm px-4 py-2 rounded-xl shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* CSV Import Result Notification Banner */}
      {importSummary && (
        <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>
              <strong>CSV Import Completed:</strong> {importSummary.imported} product(s) successfully processed.{' '}
              {importSummary.skipped > 0 && `(${importSummary.skipped} rows skipped due to invalid formats).`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setImportSummary(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 font-bold ml-2 cursor-pointer"
          >
            &times; Dismiss
          </button>
        </div>
      )}

      {/* Sub-Navigation Tabs: All Inventory / Low Stock / Purchase Planning */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setInventoryTab('ALL')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer shrink-0 transition-colors ${
            inventoryTab === 'ALL'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All Inventory ({activeProducts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setInventoryTab('LOW_STOCK')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer shrink-0 transition-colors ${
            inventoryTab === 'LOW_STOCK'
              ? 'bg-red-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/30'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Low Stock ({lowStockItems.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setInventoryTab('VELOCITY_MONITOR')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer shrink-0 transition-colors ${
            inventoryTab === 'VELOCITY_MONITOR'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>
            Auto Stock Monitor ({velocityReport.flaggedItems.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setInventoryTab('PURCHASE_PLAN')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer shrink-0 transition-colors ${
            inventoryTab === 'PURCHASE_PLAN'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Store className="w-3.5 h-3.5" />
          <span>Purchase Planning ({supplierPlanGroups.length})</span>
        </button>
      </div>

      {/* Low Stock Warning Banner & Purchase Order Suggestion */}
      {inventoryTab === 'ALL' && valuation.lowStockItemsCount > 0 && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-600 text-white shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs sm:text-sm font-bold text-red-950 dark:text-red-200">
                Low Stock Alert: {valuation.lowStockItemsCount} {valuation.lowStockItemsCount === 1 ? 'item has' : 'items have'} reached minimum stock threshold
              </div>
              <div className="text-xs text-red-800 dark:text-red-300">
                Review preferred suppliers, suggested replenishment quantities, and purchase planning in the Low Stock section.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setInventoryTab('LOW_STOCK')}
              className="text-xs font-bold px-3 py-2 rounded-xl bg-white dark:bg-slate-900 hover:bg-red-100/60 dark:hover:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-800 cursor-pointer"
            >
              Open Low Stock ({lowStockItems.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusPOProductId(null);
                setIsPOModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-xs cursor-pointer"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Create Purchase Order</span>
            </button>
          </div>
        </div>
      )}

      {inventoryTab === 'VELOCITY_MONITOR' && (
        <StockVelocityMonitorPanel
          report={velocityReport}
          config={velocityConfig}
          onChangeConfig={(patch) =>
            setVelocityConfig((prev) => ({
              ...prev,
              ...patch,
            }))
          }
          onOrderProduct={(item) =>
            openAddPurchaseForProduct({
              productId: item.product.id,
              productName: item.product.name,
              unit: item.product.unit,
              supplierId: item.preferredSupplierId,
              suggestedQty: Math.max(1, item.recommendedReorderQty || 1),
              unitPurchasePrice: item.lastPurchasePrice,
              notes: `Auto Stock Monitor (${item.flagLabel}): ${item.reason}`,
            })
          }
        />
      )}

      {inventoryTab === 'LOW_STOCK' && (
        <LowStockSection
          products={products}
          suppliers={suppliers}
          stockAdjustments={stockAdjustments}
          onEditProduct={openEditModal}
          onAdjustStock={openAdjustStockQuick}
          onAssignSupplier={handleAssignSupplierQuick}
          onViewSupplier={openSupplierProfile}
          onAddPurchaseForProduct={handleOpenAddPurchaseForLowStock}
          onAddSupplier={addSupplier}
          onAddProduct={openAddModal}
          onOpenPurchasePlan={() => setInventoryTab('PURCHASE_PLAN')}
        />
      )}

      {inventoryTab === 'PURCHASE_PLAN' && (
        <PurchasePlanningView
          products={products}
          suppliers={suppliers}
          onViewSupplier={openSupplierProfile}
          onAddPurchaseForProduct={handleOpenAddPurchaseForLowStock}
          onSwitchToLowStock={() => setInventoryTab('LOW_STOCK')}
        />
      )}

      {/* Search, Stock Filters & Table (All Inventory Tab) */}
      {inventoryTab === 'ALL' && (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search without barcode mention */}
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search product by name, Hinglish name or note..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs sm:text-sm pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
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

            {/* Stock Status Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setStockFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                  stockFilter === 'ALL'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                All Products ({activeProducts.length})
              </button>
              <button
                type="button"
                onClick={() => setStockFilter('LOW_STOCK')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                  stockFilter === 'LOW_STOCK'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100'
                }`}
              >
                Low Stock ({valuation.lowStockItemsCount})
              </button>
              <button
                type="button"
                onClick={() => setStockFilter('OUT_OF_STOCK')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                  stockFilter === 'OUT_OF_STOCK'
                    ? 'bg-red-600 text-white shadow-2xs'
                    : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 hover:bg-red-100'
                }`}
              >
                Out of Stock ({outOfStockCount})
              </button>
              <button
                type="button"
                onClick={() => setStockFilter('ARCHIVED')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-colors flex items-center gap-1 ${
                  stockFilter === 'ARCHIVED'
                    ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 shadow-2xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archived ({archivedProducts.length})</span>
              </button>
            </div>
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-slate-900 dark:bg-emerald-600 text-white font-semibold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All Categories
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-emerald-800 text-white font-semibold'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk Status Feedback Banner */}
        {bulkStatusBanner && (
          <div className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/50 border-b border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
            <span className="font-semibold">{bulkStatusBanner}</span>
            <button
              type="button"
              onClick={() => setBulkStatusBanner(null)}
              className="text-emerald-700 dark:text-emerald-300 font-bold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Contextual Multi-Select Bulk Actions Bar */}
        {selectedProductIds.size > 0 && (
          <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200 dark:border-emerald-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-950 dark:text-emerald-100">
              <span className="px-2 py-0.5 rounded-md bg-emerald-700 text-white tabular-nums">
                {selectedProductIds.size} selected
              </span>
              <span>Apply bulk updates to selected items:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Bulk Category Selection"
                  value={bulkCategoryInput}
                  onChange={(e) => setBulkCategoryInput(e.target.value)}
                  className="text-xs border border-emerald-300 dark:border-emerald-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  {managedCategoryNames.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleBulkAssignCategory}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                >
                  Apply Category
                </button>
              </div>

              {!bulkConfirmDelete ? (
                <button
                  type="button"
                  onClick={() => setBulkConfirmDelete(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Archive / Delete Selected</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/60 px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-700">
                  <span className="text-[11px] font-bold text-red-800 dark:text-red-200">
                    Confirm {selectedProductIds.size} item(s)?
                  </span>
                  <button
                    type="button"
                    onClick={handleBulkDeleteOrArchive}
                    className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkConfirmDelete(false)}
                    className="px-2 py-1 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setSelectedProductIds(new Set());
                  setBulkConfirmDelete(false);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Improved Inventory Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold uppercase text-[11px]">
              <tr>
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all visible products"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="w-4 h-4 rounded accent-emerald-700 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Purchase Price (₹)</th>
                <th className="py-3 px-4 text-right">Selling Price (₹)</th>
                <th className="py-3 px-4 text-center">Available Stock</th>
                <th className="py-3 px-4 text-right">Stock Valuation</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    {stockFilter === 'ARCHIVED'
                      ? 'No archived products right now.'
                      : 'No products found matching your search or filter.'}
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isOutOfStock = p.stockQty <= 0;
                  const isLow = !p.isArchived && p.stockQty <= p.minStockAlert;
                  const isApproaching = !p.isArchived && approachingIds.has(p.id);
                  const deficit = Math.max(0, p.minStockAlert - p.stockQty);
                  const profitPerItem = p.sellingPrice - p.purchasePrice;
                  const isRowSelected = selectedProductIds.has(p.id);

                  const velocityInfo = velocityByProductId.get(p.id);

                  return (
                    <tr
                      key={p.id}
                      className={`transition-colors ${
                        isRowSelected
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/40'
                          : p.isArchived
                          ? 'bg-slate-50/70 dark:bg-slate-900/50 opacity-80'
                          : isOutOfStock
                          ? 'bg-red-100/70 dark:bg-red-950/35 hover:bg-red-100 dark:hover:bg-red-950/50'
                          : isLow
                          ? 'bg-red-50/75 dark:bg-red-950/25 hover:bg-red-50 dark:hover:bg-red-950/40'
                          : isApproaching
                          ? 'bg-amber-50/40 dark:bg-amber-950/15 hover:bg-amber-50/70 dark:hover:bg-amber-950/25'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.name}`}
                          checked={isRowSelected}
                          onChange={() => toggleSelectProduct(p.id)}
                          className="w-4 h-4 rounded accent-emerald-700 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-bold ${
                              isLow
                                ? 'text-red-950 dark:text-red-200'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {p.name}
                          </span>
                          {!p.isArchived && velocityInfo?.flag === 'REORDER' && (
                            <span
                              title={velocityInfo.reason}
                              className="text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800"
                            >
                              Reorder
                            </span>
                          )}
                          {!p.isArchived && velocityInfo?.flag === 'LOW_STOCK' && (
                            <span
                              title={velocityInfo.reason}
                              className="text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                            >
                              Low Stock
                            </span>
                          )}
                          {p.isArchived && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                          {p.localName && <span>{p.localName}</span>}
                          {p.mrp !== undefined && p.mrp > 0 && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                              MRP: {formatINR(p.mrp)}
                            </span>
                          )}
                        </div>
                        {p.preferredSupplierName && (
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                            <Store className="w-3 h-3 shrink-0" />
                            <span>Buy from: {p.preferredSupplierName}</span>
                          </div>
                        )}
                        {p.description && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                            {p.description}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <span className="font-medium text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300">
                          {p.category}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                        {formatINR(p.purchasePrice)}
                      </td>

                      <td className="py-3 px-4 text-right tabular-nums">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {formatINR(p.sellingPrice)}{' '}
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                            /{p.unit}
                          </span>
                        </div>
                        <div
                          className={`text-[10px] font-semibold ${
                            profitPerItem >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          Profit: {formatINR(profitPerItem)}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className={`font-extrabold text-xs px-2.5 py-0.5 rounded-lg tabular-nums ${
                              isOutOfStock
                                ? 'bg-red-700 text-white font-black'
                                : isLow
                                ? 'bg-red-100 dark:bg-red-900/70 text-red-900 dark:text-red-100 font-black ring-1 ring-red-400'
                                : isApproaching
                                ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 ring-1 ring-amber-400'
                                : 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                            }`}
                          >
                            {p.stockQty} {p.unit}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                            Limit: <strong>{p.minStockAlert} {p.unit}</strong>
                          </span>
                          {isLow && !isOutOfStock && (
                            <span className="text-[9px] font-bold text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/70 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-700 tabular-nums">
                              LOW STOCK · Need {deficit.toFixed(2)} {p.unit}
                            </span>
                          )}
                          {isApproaching && (
                            <span className="text-[9px] font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700">
                              NEARING REORDER
                            </span>
                          )}
                          {isOutOfStock && !p.isArchived && (
                            <span className="text-[9px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded">
                              OUT OF STOCK
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-bold text-emerald-900 dark:text-emerald-300 tabular-nums">
                        {formatINR(p.stockQty * p.purchasePrice)}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded text-xs font-semibold cursor-pointer"
                            title={`Edit ${p.name}`}
                            aria-label={`Edit ${p.name}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          {!p.isArchived && (
                            <>
                              {isLow && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFocusPOProductId(p.id);
                                    setIsPOModalOpen(true);
                                  }}
                                  className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold whitespace-nowrap cursor-pointer"
                                  title="Create Purchase Order Draft for this item"
                                >
                                  Create PO
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openAdjustStockQuick(p)}
                                className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-xs font-medium whitespace-nowrap cursor-pointer"
                                title="Adjust Stock Quantity"
                              >
                                ± Stock
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedProdForThreshold(p);
                                  setNewThresholdInput(String(p.minStockAlert));
                                  setIsThresholdModalOpen(true);
                                }}
                                className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-xs font-medium whitespace-nowrap cursor-pointer"
                                title="Change Low Stock Threshold"
                              >
                                Limit
                              </button>
                            </>
                          )}

                          {p.isArchived ? (
                            <button
                              type="button"
                              onClick={() =>
                                archiveProduct(p.id, false, 'Restored to active inventory')
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                              title="Restore Product to Active List"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Restore</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteTargetProduct(p);
                                setDeleteReason('Discontinued or seasonal item');
                              }}
                              className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                              title="Delete or Archive Item"
                              aria-label={`Delete or archive ${p.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Add / Edit Product Modal */}
      {isProductModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingProduct ? 'Edit Product Details' : 'Add New Kirana Product'}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 my-auto max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  {editingProduct ? 'Edit Product Details' : 'Add New Kirana Product'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {editingProduct
                    ? 'Updates apply only to future bills — past invoices stay preserved.'
                    : 'Enter manual product prices, units, and reorder limits.'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close product modal"
                onClick={() => {
                  setIsProductModalOpen(false);
                  setEditingProduct(null);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProductSubmit} className="py-4 space-y-3.5">
              {formErrors.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200 space-y-1">
                  {formErrors.map((err, idx) => (
                    <div key={idx} className="font-semibold">
                      • {err}
                    </div>
                  ))}
                </div>
              )}

              {pendingConfirmEdit && editingProduct && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-xs text-amber-950 dark:text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    <span>Confirm Price / Unit / Stock Changes</span>
                  </div>
                  <p>
                    You changed pricing, unit, or stock for <strong>{editingProduct.name}</strong>. Historical invoices remain untouched, and future bills will use the new settings. Click <strong>Confirm & Save Changes</strong> below to apply.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Aashirvaad Shudh Chakki Atta"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    setPendingConfirmEdit(false);
                  }}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Hindi / Local Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Aashirvaad Aata"
                    value={formLocalName}
                    onChange={(e) => setFormLocalName(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    list="kirana-category-list"
                    placeholder="e.g. Grains & Flour"
                    value={formCategory}
                    onChange={(e) => {
                      const nextCat = e.target.value;
                      setFormCategory(nextCat);
                      if (!editingProduct && !unitManuallyEdited) {
                        const defs = getCategoryDefaults(productCategories, nextCat);
                        if (defs) {
                          const resolved = resolveUnitSelectValue(defs.defaultUnit);
                          setFormUnitSelect(resolved.selectValue);
                          setFormCustomUnit(resolved.customValue);
                          if (defs.defaultMinStockAlert !== undefined) {
                            setFormMinStockAlert(String(defs.defaultMinStockAlert));
                          }
                        }
                      }
                    }}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Category default unit:{' '}
                    <strong>
                      {getCategoryDefaults(productCategories, formCategory)?.defaultUnit || 'pcs'}
                    </strong>
                  </p>
                  <datalist id="kirana-category-list">
                    {managedCategoryNames.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Pricing Row: Purchase Price, Selling Price, MRP */}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Purchase Price ₹
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 380"
                    value={formPurchasePrice}
                    onChange={(e) => {
                      setFormPurchasePrice(e.target.value);
                      setPendingConfirmEdit(false);
                    }}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Selling Price ₹ *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    placeholder="e.g. 425"
                    value={formSellingPrice}
                    onChange={(e) => {
                      setFormSellingPrice(e.target.value);
                      setPendingConfirmEdit(false);
                    }}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 font-bold bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    MRP ₹ (Optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 450"
                    value={formMrp}
                    onChange={(e) => setFormMrp(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>
              </div>

              {/* Live Profit Per Item Preview */}
              <div
                className={`rounded-xl p-2.5 border flex items-center justify-between text-xs ${
                  liveProfitPerItem < 0
                    ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                    : 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                }`}
              >
                <span className="flex items-center gap-1.5 font-semibold">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Profit per {effectiveFormUnit || 'item'}:</span>
                </span>
                <span className="font-extrabold tabular-nums">
                  {formatINR(liveProfitPerItem)} ({liveProfitMarginPct}% margin)
                </span>
              </div>

              {/* Unit, Stock, Low Alert */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Selling Unit *
                  </label>
                  <select
                    value={formUnitSelect}
                    onChange={(e) => {
                      setFormUnitSelect(e.target.value);
                      setUnitManuallyEdited(true);
                      setPendingConfirmEdit(false);
                    }}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 font-medium text-slate-900 dark:text-slate-100"
                  >
                    {KIRANA_UNIT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                    <option value="CUSTOM">Custom Unit...</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Current Stock
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 20"
                    value={formStockQty}
                    onChange={(e) => {
                      setFormStockQty(e.target.value);
                      setPendingConfirmEdit(false);
                    }}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Low Stock Alert Limit
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="5"
                    value={formMinStockAlert}
                    onChange={(e) => setFormMinStockAlert(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>
              </div>

              {formUnitSelect === 'CUSTOM' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Custom Unit Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. jar, tin, bottle, bundle"
                    value={formCustomUnit}
                    onChange={(e) => {
                      setFormCustomUnit(e.target.value);
                      setUnitManuallyEdited(true);
                      setPendingConfirmEdit(false);
                    }}
                    className="w-full text-sm border border-emerald-400 dark:border-emerald-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}

              {/* Purchase Source & Stock Planning (Where to Purchase From) */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                    <span>Where to Purchase From (Preferred Supplier)</span>
                  </span>
                  {formDesiredStockLevel.trim() !== '' && Number(formDesiredStockLevel) > parsedStockQty && (
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      Suggested Buy: {Math.max(0, Math.round((Number(formDesiredStockLevel) - parsedStockQty) * 100) / 100)} {effectiveFormUnit}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Preferred Supplier
                    </label>
                    <select
                      value={formPreferredSupplierId}
                      onChange={(e) => setFormPreferredSupplierId(e.target.value)}
                      className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      <option value="">-- Supplier Not Assigned --</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.phone})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Desired Stock Level ({effectiveFormUnit || 'units'})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="e.g. 25"
                      value={formDesiredStockLevel}
                      onChange={(e) => setFormDesiredStockLevel(e.target.value)}
                      className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Last Purchase Price ₹ (Optional)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Auto-updated on purchases"
                      value={formLastPurchasePrice}
                      onChange={(e) => setFormLastPurchasePrice(e.target.value)}
                      className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Supplier Notes (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 2% cash discount on bulk"
                      value={formSupplierNotes}
                      onChange={(e) => setFormSupplierNotes(e.target.value)}
                      className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Product Description / Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. 5kg Chakki Fresh family pack, rack 2"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsProductModalOpen(false);
                    setEditingProduct(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                >
                  {editingProduct
                    ? pendingConfirmEdit
                      ? 'Confirm & Save Changes'
                      : 'Save Product Updates'
                    : 'Save Product to Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {isAdjustModalOpen && selectedProductForAdjust && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Adjust Stock</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedProductForAdjust.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="py-4 space-y-3">
              {adjustError && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300">
                  {adjustError}
                </div>
              )}

              <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                Current Stock:{' '}
                <strong className="tabular-nums">
                  {selectedProductForAdjust.stockQty} {selectedProductForAdjust.unit}
                </strong>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustType('ADD')}
                  className={`py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                    adjustType === 'ADD'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-600'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  + Add Stock (Maal Aaya)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustType('SUBTRACT')}
                  className={`py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                    adjustType === 'SUBTRACT'
                      ? 'bg-red-50 dark:bg-red-950/60 text-red-900 dark:text-red-200 border-red-600'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  - Reduce / Damage (Nikasi)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Quantity ({selectedProductForAdjust.unit}) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    placeholder="e.g. 10"
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                    className="w-full text-base font-bold p-2.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Adjustment Date
                  </label>
                  <input
                    type="date"
                    required
                    value={adjustDate}
                    onChange={(e) => setAdjustDate(e.target.value)}
                    className="w-full text-xs sm:text-sm p-2.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reason *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  placeholder="e.g. Wholesaler delivery, damaged bag, physical count correction"
                  value={adjustReason}
                  onChange={(e) => {
                    setAdjustReason(e.target.value);
                    if (adjustError) setAdjustError(null);
                  }}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Confirm Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment History Modal */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-800">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                    Stock Adjustment History
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Audit log of manual stock updates and counter sales deductions
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between gap-3">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                Filter Product:
              </label>
              <select
                value={historyFilterProductId}
                onChange={(e) => setHistoryFilterProductId(e.target.value)}
                className="flex-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="ALL">All Products ({stockAdjustments.length} entries)</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {filteredAdjustmentHistory.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                  No stock adjustments recorded yet.
                </div>
              ) : (
                filteredAdjustmentHistory.map((adj) => {
                  const isIncrease = adj.quantityChange > 0;
                  return (
                    <div
                      key={adj.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                            {adj.productName}
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                            {adj.source}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {adj.date}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                          {adj.reason}
                        </p>
                      </div>

                      <div className="text-right shrink-0 tabular-nums">
                        <div
                          className={`text-sm font-extrabold ${
                            isIncrease
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {isIncrease ? `+${adj.quantityChange}` : adj.quantityChange} {adj.unit}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {adj.previousStock} → <strong>{adj.newStock}</strong> {adj.unit}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsHistoryModalOpen(false);
                  openStockMovementReport(historyFilterProductId);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-bold cursor-pointer"
              >
                <FileBarChart2 className="w-3.5 h-3.5" />
                <span>Open Full Movement Report</span>
              </button>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Threshold Modal */}
      {isThresholdModalOpen && selectedProdForThreshold && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  Set Low-Stock Reorder Limit
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsThresholdModalOpen(false);
                  setSelectedProdForThreshold(null);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleThresholdSubmit} className="py-4 space-y-3.5">
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {selectedProdForThreshold.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Current Stock: {selectedProdForThreshold.stockQty} {selectedProdForThreshold.unit}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alert Reorder Limit ({selectedProdForThreshold.unit}) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={newThresholdInput}
                  onChange={(e) => setNewThresholdInput(e.target.value)}
                  className="w-full text-base font-bold border border-amber-300 dark:border-amber-700 rounded-xl p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-amber-500"
                  autoFocus
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  When stock approaches or falls below this limit, the dashboard warns you before counter stockouts.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsThresholdModalOpen(false);
                    setSelectedProdForThreshold(null);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-900 dark:bg-emerald-700 hover:bg-slate-800 dark:hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                >
                  Save Limit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / Archive Confirmation Modal (Transaction-History Safe) */}
      {deleteTargetProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-xl ${
                    targetHasHistory
                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                      : 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                  }`}
                >
                  {targetHasHistory ? (
                    <Archive className="w-5 h-5" />
                  ) : (
                    <Trash2 className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                    {targetHasHistory ? 'Archive Product Instead?' : 'Remove or Archive Product'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {deleteTargetProduct.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTargetProduct(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {targetHasHistory ? (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                <strong>Protected Product:</strong> This product is linked to existing sales bills or purchase/stock history. Permanent deletion is disabled so past invoices and profit reports remain accurate. You can safely <strong>Archive</strong> it to hide it from active billing while keeping history intact.
              </div>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Are you sure you want to remove <strong>{deleteTargetProduct.name}</strong>? You can either archive it for later use or delete it permanently.
              </p>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Reason
              </label>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="e.g. Discontinued item"
                className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteTargetProduct(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  archiveProduct(deleteTargetProduct.id, true, deleteReason);
                  setDeleteTargetProduct(null);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archive Product</span>
              </button>
              {!targetHasHistory && (
                <button
                  type="button"
                  onClick={() => {
                    deleteProduct(
                      deleteTargetProduct.id,
                      deleteReason.trim() || 'Removed by store owner'
                    );
                    setDeleteTargetProduct(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Permanently</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk CSV / PDF Inventory Import Modal */}
      <InventoryBulkImportModal
        isOpen={isBulkImportOpen}
        onClose={() => setIsBulkImportOpen(false)}
        existingProducts={products}
        onImportRows={(rows, options) => importProductsBatch(rows, options)}
      />

      {/* Purchase Order Draft Modal */}
      {isPOModalOpen && (
        <PurchaseOrderModal
          products={activeProducts}
          suppliers={suppliers}
          profile={profile}
          focusProductId={focusPOProductId}
          onClose={() => {
            setIsPOModalOpen(false);
            setFocusPOProductId(null);
          }}
        />
      )}
    </div>
  );
};
