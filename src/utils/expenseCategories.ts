/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ExpenseCategoryConfig,
  ExpenseRecord,
  RecurringExpense,
} from '../types';

export const EXPENSE_CATEGORY_ICON_PRESETS = [
  '🏪',
  '🚚',
  '⚡',
  '☕',
  '🍱',
  '🍲',
  '👥',
  '🏠',
  '📝',
  '🛍️',
  '📦',
  '🛵',
  '💧',
  '🧹',
  '📱',
  '🔧',
  '🧰',
  '🧾',
] as const;

export const DEFAULT_EXPENSE_CATEGORY_SEEDS: ReadonlyArray<{
  id: string;
  label: string;
  icon: string;
  isPersonalDrawing: boolean;
}> = [
  { id: 'SHOP', label: 'Shop Expenses (Dukan Kharch)', icon: '🏪', isPersonalDrawing: false },
  { id: 'TRANSPORT', label: 'Transport & Freight (Bhada)', icon: '🚚', isPersonalDrawing: false },
  { id: 'ELECTRICITY', label: 'Electricity & Bills (Bijli)', icon: '⚡', isPersonalDrawing: false },
  { id: 'BREAKFAST', label: 'Morning Tea / Breakfast (Chai-Nashta)', icon: '☕', isPersonalDrawing: false },
  { id: 'LUNCH', label: 'Lunch / Meals (Dopahar Khana)', icon: '🍱', isPersonalDrawing: false },
  { id: 'DINNER', label: 'Dinner / Food (Raat ka Khana)', icon: '🍲', isPersonalDrawing: false },
  { id: 'STAFF', label: 'Staff Salary & Wages (Majdoori)', icon: '👥', isPersonalDrawing: false },
  { id: 'PERSONAL_DRAWING', label: 'Owner House Withdrawal (Malik Niji Kharch)', icon: '🏠', isPersonalDrawing: true },
  { id: 'OTHER', label: 'Other Sundry (Anya)', icon: '📝', isPersonalDrawing: false },
];

const DEFAULT_SEED_BY_ID = new Map(DEFAULT_EXPENSE_CATEGORY_SEEDS.map((s) => [s.id, s]));

function normalizeLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

export function createExpenseCategoryId(label: string, existingIds: ReadonlySet<string>): string {
  const slug = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  const base = `CUSTOM_${slug || 'EXPENSE'}`;
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}_${suffix}`)) {
    suffix++;
  }
  return `${base}_${suffix}`;
}

function makeSeedConfig(
  seed: { id: string; label: string; icon: string; isPersonalDrawing: boolean },
  now: string
): ExpenseCategoryConfig {
  return {
    id: seed.id,
    label: seed.label,
    icon: seed.icon,
    isPersonalDrawing: seed.isPersonalDrawing,
    isSystemDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Hydrates the store's expense categories list.
 * - If `existing` has saved entries, preserves user's exact list, labels, icons, and deletions.
 * - If `existing` is empty (fresh install or pre-upgrade DB), seeds all 9 standard defaults.
 * - Always ensures any category ID referenced by existing expenses or recurring bills is present.
 */
export function buildDefaultExpenseCategories(
  expenses: ExpenseRecord[] = [],
  recurringExpenses: RecurringExpense[] = [],
  existing: ExpenseCategoryConfig[] = []
): ExpenseCategoryConfig[] {
  const now = new Date().toISOString();
  const byId = new Map<string, ExpenseCategoryConfig>();

  if (existing.length > 0) {
    for (const item of existing) {
      const id = String(item.id || '').trim();
      const label = String(item.label || '').trim();
      if (!id || !label || byId.has(id)) continue;
      const defaultMeta = DEFAULT_SEED_BY_ID.get(id);
      byId.set(id, {
        id,
        label,
        icon: String(item.icon || defaultMeta?.icon || '📝').trim() || '📝',
        isPersonalDrawing:
          item.isPersonalDrawing !== undefined
            ? Boolean(item.isPersonalDrawing)
            : id === 'PERSONAL_DRAWING',
        isSystemDefault: item.isSystemDefault ?? Boolean(defaultMeta),
        createdAt: item.createdAt || now,
        updatedAt: item.updatedAt || now,
      });
    }
  } else {
    for (const seed of DEFAULT_EXPENSE_CATEGORY_SEEDS) {
      byId.set(seed.id, makeSeedConfig(seed, now));
    }
  }

  // Ensure any category ID already referenced in saved expenses or recurring bills has an entry
  const referencedIds: Array<{ id: string; isDrawingHint?: boolean }> = [];
  for (const exp of expenses) {
    const id = String(exp.category || '').trim();
    if (id) {
      referencedIds.push({ id, isDrawingHint: Boolean(exp.isPersonalWithdrawal) });
    }
  }
  for (const rec of recurringExpenses) {
    const id = String(rec.category || '').trim();
    if (id) {
      referencedIds.push({ id, isDrawingHint: Boolean(rec.isPersonalWithdrawal) });
    }
  }

  for (const ref of referencedIds) {
    if (byId.has(ref.id)) continue;
    const defaultMeta = DEFAULT_SEED_BY_ID.get(ref.id);
    if (defaultMeta) {
      byId.set(ref.id, makeSeedConfig(defaultMeta, now));
    } else {
      const readable = ref.id
        .replace(/^CUSTOM_/, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      byId.set(ref.id, {
        id: ref.id,
        label: readable || ref.id,
        icon: ref.isDrawingHint ? '🏠' : '📝',
        isPersonalDrawing: ref.id === 'PERSONAL_DRAWING' || Boolean(ref.isDrawingHint),
        isSystemDefault: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return Array.from(byId.values());
}

export function addExpenseCategoryConfig(
  categories: ExpenseCategoryConfig[],
  input: { label: string; icon?: string; isPersonalDrawing?: boolean }
): { categories: ExpenseCategoryConfig[]; created: ExpenseCategoryConfig } {
  const trimmedLabel = String(input.label || '').trim();
  if (!trimmedLabel) {
    throw new Error('Category name is required.');
  }
  const duplicate = categories.find(
    (c) => normalizeLabelKey(c.label) === normalizeLabelKey(trimmedLabel)
  );
  if (duplicate) {
    throw new Error(`Expense category "${duplicate.label}" already exists.`);
  }

  const now = new Date().toISOString();
  const existingIds = new Set(categories.map((c) => c.id));
  const id = createExpenseCategoryId(trimmedLabel, existingIds);
  const isPersonalDrawing = Boolean(input.isPersonalDrawing);
  const icon = String(input.icon || '').trim() || (isPersonalDrawing ? '🏠' : '📝');

  const created: ExpenseCategoryConfig = {
    id,
    label: trimmedLabel,
    icon,
    isPersonalDrawing,
    isSystemDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  return {
    categories: [...categories, created],
    created,
  };
}

export function updateExpenseCategoryConfig(
  categories: ExpenseCategoryConfig[],
  id: string,
  patch: { label: string; icon?: string; isPersonalDrawing?: boolean }
): { categories: ExpenseCategoryConfig[]; updated: ExpenseCategoryConfig } {
  const existing = categories.find((c) => c.id === id);
  if (!existing) {
    throw new Error('Expense category not found.');
  }
  const nextLabel = String(patch.label || '').trim();
  if (!nextLabel) {
    throw new Error('Category name cannot be empty.');
  }
  const conflict = categories.find(
    (c) => c.id !== id && normalizeLabelKey(c.label) === normalizeLabelKey(nextLabel)
  );
  if (conflict) {
    throw new Error(`Another expense category named "${conflict.label}" already exists.`);
  }

  const now = new Date().toISOString();
  const updated: ExpenseCategoryConfig = {
    ...existing,
    label: nextLabel,
    icon: String(patch.icon ?? existing.icon).trim() || '📝',
    isPersonalDrawing:
      patch.isPersonalDrawing !== undefined
        ? Boolean(patch.isPersonalDrawing)
        : Boolean(existing.isPersonalDrawing),
    updatedAt: now,
  };

  return {
    categories: categories.map((c) => (c.id === id ? updated : c)),
    updated,
  };
}

export function deleteExpenseCategoryConfig(
  categories: ExpenseCategoryConfig[],
  expenses: ExpenseRecord[],
  recurringExpenses: RecurringExpense[],
  id: string,
  reassignToId?: string
): {
  categories: ExpenseCategoryConfig[];
  expenses: ExpenseRecord[];
  recurringExpenses: RecurringExpense[];
  deletedLabel: string;
  reassignedExpensesCount: number;
  reassignedRecurringCount: number;
} {
  const target = categories.find((c) => c.id === id);
  if (!target) {
    throw new Error('Expense category not found.');
  }
  if (categories.length <= 1) {
    throw new Error('Keep at least one expense category.');
  }

  const affectedExpenses = expenses.filter((e) => e.category === id);
  const affectedRecurring = recurringExpenses.filter((r) => r.category === id);
  const totalAffected = affectedExpenses.length + affectedRecurring.length;

  let replacement: ExpenseCategoryConfig | undefined;
  if (totalAffected > 0) {
    const cleanTargetId = String(reassignToId || '').trim();
    if (!cleanTargetId) {
      throw new Error(
        `"${target.label}" is used in ${totalAffected} record(s). Select a replacement category before deleting.`
      );
    }
    if (cleanTargetId === id) {
      throw new Error('Replacement category must be different from the deleted category.');
    }
    replacement = categories.find((c) => c.id === cleanTargetId);
    if (!replacement) {
      throw new Error('Selected replacement category does not exist.');
    }
  }

  const now = new Date().toISOString();
  let reassignedExpensesCount = 0;
  let reassignedRecurringCount = 0;

  const nextExpenses = replacement
    ? expenses.map((e) => {
        if (e.category === id) {
          reassignedExpensesCount++;
          return {
            ...e,
            category: replacement!.id,
            isPersonalWithdrawal: Boolean(replacement!.isPersonalDrawing),
          };
        }
        return e;
      })
    : expenses;

  const nextRecurring = replacement
    ? recurringExpenses.map((r) => {
        if (r.category === id) {
          reassignedRecurringCount++;
          return {
            ...r,
            category: replacement!.id,
            isPersonalWithdrawal: Boolean(replacement!.isPersonalDrawing),
            updatedAt: now,
          };
        }
        return r;
      })
    : recurringExpenses;

  return {
    categories: categories.filter((c) => c.id !== id),
    expenses: nextExpenses,
    recurringExpenses: nextRecurring,
    deletedLabel: target.label,
    reassignedExpensesCount,
    reassignedRecurringCount,
  };
}

export function restoreMissingDefaultExpenseCategories(
  categories: ExpenseCategoryConfig[]
): { categories: ExpenseCategoryConfig[]; addedCount: number } {
  const now = new Date().toISOString();
  const existingIds = new Set(categories.map((c) => c.id));
  const existingLabels = new Set(categories.map((c) => normalizeLabelKey(c.label)));
  const additions: ExpenseCategoryConfig[] = [];

  for (const seed of DEFAULT_EXPENSE_CATEGORY_SEEDS) {
    if (!existingIds.has(seed.id) && !existingLabels.has(normalizeLabelKey(seed.label))) {
      additions.push(makeSeedConfig(seed, now));
    }
  }

  return {
    categories: [...categories, ...additions],
    addedCount: additions.length,
  };
}

export function resolveExpenseCategoryMeta(
  categories: ExpenseCategoryConfig[],
  categoryId: string
): { id: string; label: string; icon: string; isPersonalDrawing: boolean } {
  const found = categories.find((c) => c.id === categoryId);
  if (found) {
    return {
      id: found.id,
      label: found.label,
      icon: found.icon || '📝',
      isPersonalDrawing: Boolean(found.isPersonalDrawing || found.id === 'PERSONAL_DRAWING'),
    };
  }
  const seed = DEFAULT_SEED_BY_ID.get(categoryId);
  if (seed) {
    return {
      id: seed.id,
      label: seed.label,
      icon: seed.icon,
      isPersonalDrawing: seed.isPersonalDrawing,
    };
  }
  const readable = String(categoryId || 'Other')
    .replace(/^CUSTOM_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return {
    id: categoryId,
    label: readable || 'Other',
    icon: categoryId === 'PERSONAL_DRAWING' ? '🏠' : '📝',
    isPersonalDrawing: categoryId === 'PERSONAL_DRAWING',
  };
}
