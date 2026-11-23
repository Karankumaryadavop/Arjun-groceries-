import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { ProductCategoryConfig } from '../types';
import { COMMON_CATEGORY_UNITS } from '../utils/inventoryCategories';
import {
  Tag,
  Plus,
  Edit2,
  GitMerge,
  Trash2,
  Check,
  X,
  AlertTriangle,
  Package,
} from 'lucide-react';

export const CategoryManagerView: React.FC = () => {
  const {
    products,
    productCategories,
    addProductCategory,
    updateProductCategory,
    mergeProductCategories,
    deleteProductCategory,
    setActiveTab,
  } = useStore();

  // Add Category Form State
  const [newName, setNewName] = useState('');
  const [newUnitPreset, setNewUnitPreset] = useState<string>('kg');
  const [newCustomUnit, setNewCustomUnit] = useState('');
  const [newMinStock, setNewMinStock] = useState('5');

  // Inline Editing State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnitPreset, setEditUnitPreset] = useState<string>('pcs');
  const [editCustomUnit, setEditCustomUnit] = useState('');
  const [editMinStock, setEditMinStock] = useState('5');

  // Merge State
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>('');

  // Delete Confirmation State
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteReassignName, setDeleteReassignName] = useState<string>('');

  // Feedback Banner
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const productCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      const key = (p.category || '').trim().toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [products]);

  const getProductCount = (catName: string): number =>
    productCountByCategory.get(catName.trim().toLowerCase()) || 0;

  const resolveUnit = (preset: string, custom: string) =>
    preset === '__CUSTOM__' ? custom.trim() || 'pcs' : preset;

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const defaultUnit = resolveUnit(newUnitPreset, newCustomUnit);
    const res = addProductCategory({
      name: newName,
      defaultUnit,
      defaultMinStockAlert: Math.max(0, Number(newMinStock) || 0),
    });
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Could not add category.' });
      return;
    }
    setNotice({
      type: 'success',
      message: `Added category "${res.category?.name}" with default unit "${res.category?.defaultUnit}".`,
    });
    setNewName('');
    setNewCustomUnit('');
    setNewUnitPreset('kg');
    setNewMinStock('5');
  };

  const startEdit = (cat: ProductCategoryConfig) => {
    setMergingId(null);
    setDeletingId(null);
    setEditingId(cat.id);
    setEditName(cat.name);
    const isCommon = (COMMON_CATEGORY_UNITS as readonly string[]).includes(cat.defaultUnit);
    setEditUnitPreset(isCommon ? cat.defaultUnit : '__CUSTOM__');
    setEditCustomUnit(isCommon ? '' : cat.defaultUnit);
    setEditMinStock(String(cat.defaultMinStockAlert ?? 5));
  };

  const handleSaveEdit = (id: string) => {
    const defaultUnit = resolveUnit(editUnitPreset, editCustomUnit);
    const res = updateProductCategory(id, {
      name: editName,
      defaultUnit,
      defaultMinStockAlert: Math.max(0, Number(editMinStock) || 0),
    });
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Could not update category.' });
      return;
    }
    setEditingId(null);
    setNotice({
      type: 'success',
      message: `Updated category "${editName.trim()}" (default unit: ${defaultUnit}${
        res.renamedProductsCount ? `, renamed on ${res.renamedProductsCount} products` : ''
      }).`,
    });
  };

  const startMerge = (cat: ProductCategoryConfig) => {
    setEditingId(null);
    setDeletingId(null);
    const firstOther = productCategories.find((c) => c.id !== cat.id);
    setMergingId(cat.id);
    setMergeTargetId(firstOther?.id || '');
  };

  const handleConfirmMerge = (sourceCat: ProductCategoryConfig) => {
    if (!mergeTargetId) {
      setNotice({ type: 'error', message: 'Select a target category to merge into.' });
      return;
    }
    const targetCat = productCategories.find((c) => c.id === mergeTargetId);
    const res = mergeProductCategories(sourceCat.id, mergeTargetId);
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Merge failed.' });
      return;
    }
    setMergingId(null);
    setNotice({
      type: 'success',
      message: `Merged "${sourceCat.name}" into "${targetCat?.name || 'target'}" (${res.movedProductsCount || 0} products moved).`,
    });
  };

  const startDelete = (cat: ProductCategoryConfig) => {
    setEditingId(null);
    setMergingId(null);
    const others = productCategories.filter((c) => c.id !== cat.id);
    setDeletingId(cat.id);
    setDeleteReassignName(others[0]?.name || '');
  };

  const handleConfirmDelete = (cat: ProductCategoryConfig) => {
    const count = getProductCount(cat.name);
    const res = deleteProductCategory(cat.id, count > 0 ? deleteReassignName : undefined);
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Delete failed.' });
      return;
    }
    setDeletingId(null);
    setNotice({
      type: 'success',
      message: `Deleted category "${cat.name}"${
        res.reassignedProductsCount
          ? ` and reassigned ${res.reassignedProductsCount} products to "${deleteReassignName}"`
          : ''
      }.`,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header Summary Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
            <Tag className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <span>Product Categories &amp; Default Common Units</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Add, rename, merge, or delete inventory categories and define the default unit (kg, L, pcs, pkt) auto-selected when adding new products.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('INVENTORY')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap cursor-pointer self-start sm:self-auto"
        >
          <Package className="w-3.5 h-3.5" />
          <span>Open Inventory</span>
        </button>
      </div>

      {notice && (
        <div
          className={`p-3 rounded-xl text-xs font-medium border flex items-center justify-between gap-2 ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-rose-950/40 border-red-200 dark:border-rose-800 text-red-800 dark:text-rose-200'
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-bold underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Add Category Card */}
      <form
        onSubmit={handleAddCategory}
        className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
      >
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Add New Product Category
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Category Name *
            </label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Dry Fruits & Nuts"
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 focus:outline-emerald-600"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Default Common Unit
            </label>
            <select
              value={newUnitPreset}
              onChange={(e) => setNewUnitPreset(e.target.value)}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 focus:outline-emerald-600"
            >
              {COMMON_CATEGORY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
              <option value="__CUSTOM__">Custom unit...</option>
            </select>
          </div>

          {newUnitPreset === '__CUSTOM__' && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Custom Unit *
              </label>
              <input
                type="text"
                required
                value={newCustomUnit}
                onChange={(e) => setNewCustomUnit(e.target.value)}
                placeholder="e.g. tins"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 focus:outline-emerald-600"
              />
            </div>
          )}

          <div className={newUnitPreset === '__CUSTOM__' ? 'sm:col-span-2' : 'sm:col-span-2'}>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Default Min Alert
            </label>
            <input
              type="number"
              min="0"
              value={newMinStock}
              onChange={(e) => setNewMinStock(e.target.value)}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 tabular-nums focus:outline-emerald-600"
            />
          </div>

          <div className={newUnitPreset === '__CUSTOM__' ? 'sm:col-span-12 flex justify-end' : 'sm:col-span-2'}>
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Category</span>
            </button>
          </div>
        </div>
      </form>

      {/* Managed Categories List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
            Configured Categories ({productCategories.length})
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Total Inventory Items: {products.length}
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {productCategories.map((cat) => {
            const count = getProductCount(cat.name);
            const isEditing = editingId === cat.id;
            const isMerging = mergingId === cat.id;
            const isDeleting = deletingId === cat.id;

            return (
              <div key={cat.id} className="p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                      {cat.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Default Unit: <strong className="text-slate-700 dark:text-slate-200">{cat.defaultUnit}</strong>
                      {' · '}
                      Default Min Alert: <strong className="tabular-nums text-slate-700 dark:text-slate-200">{cat.defaultMinStockAlert ?? 5}</strong>
                      {' · '}
                      <span className="tabular-nums">{count} {count === 1 ? 'product' : 'products'}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditingId(null) : startEdit(cat))}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit / Rename</span>
                    </button>

                    {productCategories.length > 1 && (
                      <button
                        type="button"
                        onClick={() => (isMerging ? setMergingId(null) : startMerge(cat))}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-xs font-semibold text-blue-800 dark:text-blue-300 cursor-pointer"
                      >
                        <GitMerge className="w-3.5 h-3.5" />
                        <span>Merge</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={productCategories.length <= 1}
                      onClick={() => (isDeleting ? setDeletingId(null) : startDelete(cat))}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-rose-900 bg-red-50/70 dark:bg-rose-950/40 hover:bg-red-100 dark:hover:bg-rose-900/50 disabled:opacity-40 text-xs font-semibold text-red-700 dark:text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* Inline Edit Form */}
                {isEditing && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Category Name *
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Default Common Unit
                      </label>
                      <select
                        value={editUnitPreset}
                        onChange={(e) => setEditUnitPreset(e.target.value)}
                        className="w-full text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5"
                      >
                        {COMMON_CATEGORY_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                        <option value="__CUSTOM__">Custom unit...</option>
                      </select>
                    </div>
                    {editUnitPreset === '__CUSTOM__' && (
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Custom Unit
                        </label>
                        <input
                          type="text"
                          value={editCustomUnit}
                          onChange={(e) => setEditCustomUnit(e.target.value)}
                          placeholder="e.g. tins"
                          className="w-full text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5"
                        />
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Min Alert
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editMinStock}
                        onChange={(e) => setEditMinStock(e.target.value)}
                        className="w-full text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5 tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-12 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(cat.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Save Changes</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline Merge Form */}
                {isMerging && (
                  <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                    <div className="flex-1 space-y-1">
                      <div className="font-bold text-blue-950 dark:text-blue-200">
                        Merge &quot;{cat.name}&quot; ({count} products) into:
                      </div>
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        className="w-full sm:max-w-xs text-xs border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5"
                      >
                        {productCategories
                          .filter((c) => c.id !== cat.id)
                          .map((other) => (
                            <option key={other.id} value={other.id}>
                              {other.name} ({getProductCount(other.name)} items · {other.defaultUnit})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setMergingId(null)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmMerge(cat)}
                        className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                      >
                        Confirm Merge
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline Delete Form */}
                {isDeleting && (
                  <div className="p-3 rounded-xl bg-red-50/70 dark:bg-rose-950/30 border border-red-200 dark:border-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                    <div className="flex-1 space-y-1.5">
                      <div className="font-bold text-red-900 dark:text-rose-200 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>Delete category &quot;{cat.name}&quot;?</span>
                      </div>
                      {count > 0 ? (
                        <div className="space-y-1">
                          <div className="text-red-800 dark:text-rose-300">
                            {count} {count === 1 ? 'product uses' : 'products use'} this category. Reassign them to:
                          </div>
                          <select
                            value={deleteReassignName}
                            onChange={(e) => setDeleteReassignName(e.target.value)}
                            className="w-full sm:max-w-xs text-xs border border-red-300 dark:border-rose-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5"
                          >
                            {productCategories
                              .filter((c) => c.id !== cat.id)
                              .map((other) => (
                                <option key={other.id} value={other.name}>
                                  {other.name}
                                </option>
                              ))}
                          </select>
                        </div>
                      ) : (
                        <div className="text-red-800 dark:text-rose-300">
                          No products are currently assigned to this category.
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setDeletingId(null)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmDelete(cat)}
                        className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
                      >
                        Confirm Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
