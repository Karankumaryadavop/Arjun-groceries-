import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { ExpenseCategoryConfig } from '../types';
import { EXPENSE_CATEGORY_ICON_PRESETS } from '../utils/expenseCategories';
import {
  Check,
  Edit2,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from 'lucide-react';

interface ExpenseCategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExpenseCategoryManagerModal: React.FC<ExpenseCategoryManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    expenses,
    recurringExpenses,
    expenseCategories,
    addExpenseCategory,
    updateExpenseCategory,
    deleteExpenseCategory,
    restoreDefaultExpenseCategories,
  } = useStore();

  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState<string>('🛍️');
  const [newIsDrawing, setNewIsDrawing] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIcon, setEditIcon] = useState('📝');
  const [editIsDrawing, setEditIsDrawing] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const usageCounts = useMemo(() => {
    const map = new Map<string, { expenses: number; recurring: number }>();
    for (const exp of expenses) {
      const current = map.get(exp.category) || { expenses: 0, recurring: 0 };
      current.expenses += 1;
      map.set(exp.category, current);
    }
    for (const rec of recurringExpenses) {
      const current = map.get(rec.category) || { expenses: 0, recurring: 0 };
      current.recurring += 1;
      map.set(rec.category, current);
    }
    return map;
  }, [expenses, recurringExpenses]);

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const res = addExpenseCategory({
      label: newLabel,
      icon: newIcon,
      isPersonalDrawing: newIsDrawing,
    });
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Could not add category.' });
      return;
    }
    setNotice({
      type: 'success',
      message: `Added "${res.category?.icon} ${res.category?.label}" to your expense categories.`,
    });
    setNewLabel('');
    setNewIcon('🛍️');
    setNewIsDrawing(false);
  };

  const beginEdit = (cat: ExpenseCategoryConfig) => {
    setDeletingId(null);
    setEditingId(cat.id);
    setEditLabel(cat.label);
    setEditIcon(cat.icon || '📝');
    setEditIsDrawing(Boolean(cat.isPersonalDrawing));
  };

  const handleSaveEdit = (id: string) => {
    const res = updateExpenseCategory(id, {
      label: editLabel,
      icon: editIcon,
      isPersonalDrawing: editIsDrawing,
    });
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Could not update category.' });
      return;
    }
    setEditingId(null);
    setNotice({
      type: 'success',
      message: `Updated category "${res.category?.icon} ${res.category?.label}".`,
    });
  };

  const beginDelete = (cat: ExpenseCategoryConfig) => {
    setEditingId(null);
    const others = expenseCategories.filter((c) => c.id !== cat.id);
    setDeletingId(cat.id);
    setReassignTargetId(others[0]?.id || '');
  };

  const handleConfirmDelete = (cat: ExpenseCategoryConfig) => {
    const counts = usageCounts.get(cat.id) || { expenses: 0, recurring: 0 };
    const totalUsed = counts.expenses + counts.recurring;
    const res = deleteExpenseCategory(cat.id, totalUsed > 0 ? reassignTargetId : undefined);
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Could not delete category.' });
      return;
    }
    setDeletingId(null);
    const targetName = expenseCategories.find((c) => c.id === reassignTargetId)?.label;
    setNotice({
      type: 'success',
      message:
        totalUsed > 0 && targetName
          ? `Deleted "${cat.label}" and moved ${totalUsed} record(s) to "${targetName}".`
          : `Deleted category "${cat.label}".`,
    });
  };

  const handleRestoreDefaults = () => {
    const res = restoreDefaultExpenseCategories();
    if (res.addedCount === 0) {
      setNotice({ type: 'success', message: 'All 9 standard expense categories are already active.' });
    } else {
      setNotice({
        type: 'success',
        message: `Restored ${res.addedCount} standard expense ${res.addedCount === 1 ? 'category' : 'categories'}.`,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-category-manager-title"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h3
              id="expense-category-manager-title"
              className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2"
            >
              <Tag className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Customize Expense Categories</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Add custom kharch headings, rename existing items, choose icons, or remove categories you don&apos;t use.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customize expense categories"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {notice && (
            <div
              className={`px-3.5 py-2.5 rounded-xl text-xs font-medium border flex items-center justify-between gap-2 ${
                notice.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-rose-950/40 border-red-200 dark:border-rose-800 text-red-800 dark:text-rose-200'
              }`}
            >
              <span>{notice.message}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="font-bold underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Add Custom Category Form */}
          <form
            onSubmit={handleAdd}
            className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 sm:p-4 border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Add Custom Expense Category
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-7">
                <label
                  htmlFor="new-exp-cat-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Category Name *
                </label>
                <input
                  id="new-exp-cat-name"
                  type="text"
                  required
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Packaging & Carry Bags"
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 focus:outline-emerald-600"
                />
              </div>

              <div className="sm:col-span-5">
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Accounting Type
                </span>
                <div className="grid grid-cols-2 rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setNewIsDrawing(false)}
                    className={`py-2 px-2 text-xs font-semibold cursor-pointer ${
                      !newIsDrawing
                        ? 'bg-emerald-700 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    Operating
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewIsDrawing(true)}
                    className={`py-2 px-2 text-xs font-semibold cursor-pointer border-l border-slate-200 dark:border-slate-700 ${
                      newIsDrawing
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    Drawing
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Icon
                </span>
                <div className="flex flex-wrap gap-1">
                  {EXPENSE_CATEGORY_ICON_PRESETS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNewIcon(emoji)}
                      aria-label={`Select icon ${emoji}`}
                      className={`w-7 h-7 rounded-md text-sm flex items-center justify-center border cursor-pointer transition-colors ${
                        newIcon === emoji
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 ring-1 ring-emerald-600'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs cursor-pointer shrink-0 self-start sm:self-end"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Category</span>
              </button>
            </div>
          </form>

          {/* Existing Categories List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Active Categories ({expenseCategories.length})
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Shown in Expense &amp; Recurring dropdowns
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
              {expenseCategories.map((cat) => {
                const counts = usageCounts.get(cat.id) || { expenses: 0, recurring: 0 };
                const totalUsage = counts.expenses + counts.recurring;
                const isEditing = editingId === cat.id;
                const isDeleting = deletingId === cat.id;
                const otherCategories = expenseCategories.filter((c) => c.id !== cat.id);

                return (
                  <div key={cat.id} className="p-3 sm:px-4 bg-white dark:bg-slate-900">
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                          <div className="sm:col-span-7">
                            <label className="sr-only" htmlFor={`edit-cat-${cat.id}`}>
                              Category name
                            </label>
                            <input
                              id={`edit-cat-${cat.id}`}
                              type="text"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <div className="sm:col-span-5 grid grid-cols-2 rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setEditIsDrawing(false)}
                              className={`py-1.5 text-xs font-semibold cursor-pointer ${
                                !editIsDrawing
                                  ? 'bg-emerald-700 text-white'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Operating
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditIsDrawing(true)}
                              className={`py-1.5 text-xs font-semibold cursor-pointer border-l border-slate-200 dark:border-slate-700 ${
                                editIsDrawing
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Drawing
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-1">
                            {EXPENSE_CATEGORY_ICON_PRESETS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => setEditIcon(emoji)}
                                className={`w-7 h-7 rounded-md text-sm flex items-center justify-center border cursor-pointer ${
                                  editIcon === emoji
                                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'
                                }`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(cat.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Save</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span
                            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-base shrink-0"
                            aria-hidden="true"
                          >
                            {cat.icon || '📝'}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {cat.label}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                              <span
                                className={
                                  cat.isPersonalDrawing
                                    ? 'font-semibold text-amber-700 dark:text-amber-300'
                                    : 'font-semibold text-blue-700 dark:text-blue-300'
                                }
                              >
                                {cat.isPersonalDrawing ? 'Owner Drawing' : 'Business Operating'}
                              </span>
                              <span> · </span>
                              <span>
                                {totalUsage === 0
                                  ? 'Unused'
                                  : `${counts.expenses} expense${counts.expenses === 1 ? '' : 's'}${
                                      counts.recurring > 0 ? `, ${counts.recurring} recurring` : ''
                                    }`}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => beginEdit(cat)}
                            aria-label={`Edit category ${cat.label}`}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="Rename / edit icon"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => beginDelete(cat)}
                            disabled={expenseCategories.length <= 1}
                            aria-label={`Delete category ${cat.label}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-rose-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            title={
                              expenseCategories.length <= 1
                                ? 'Keep at least one category'
                                : 'Delete category'
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {isDeleting && (
                      <div className="mt-3 p-3 rounded-xl bg-red-50/70 dark:bg-rose-950/30 border border-red-200 dark:border-rose-800/70 space-y-2.5">
                        {totalUsage > 0 ? (
                          <>
                            <div className="text-xs font-semibold text-red-900 dark:text-rose-200">
                              &ldquo;{cat.label}&rdquo; is used in {totalUsage} saved record(s). Move them to another category before deleting:
                            </div>
                            <select
                              value={reassignTargetId}
                              onChange={(e) => setReassignTargetId(e.target.value)}
                              className="w-full text-xs sm:text-sm border border-red-300 dark:border-rose-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                            >
                              {otherCategories.map((other) => (
                                <option key={other.id} value={other.id}>
                                  {other.icon} {other.label}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <div className="text-xs font-semibold text-red-900 dark:text-rose-200">
                            Remove &ldquo;{cat.label}&rdquo; from your expense categories list?
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfirmDelete(cat)}
                            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                          >
                            {totalUsage > 0 ? 'Move & Delete' : 'Confirm Delete'}
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

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Missing Defaults</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 dark:bg-emerald-700 hover:bg-slate-800 dark:hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
