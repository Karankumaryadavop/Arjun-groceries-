import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXPENSE_CATEGORY_SEEDS,
  addExpenseCategoryConfig,
  buildDefaultExpenseCategories,
  deleteExpenseCategoryConfig,
  resolveExpenseCategoryMeta,
  restoreMissingDefaultExpenseCategories,
  updateExpenseCategoryConfig,
} from './expenseCategories';
import { ExpenseCategoryConfig, ExpenseRecord, RecurringExpense } from '../types';

function makeExpense(overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: 'exp-1',
    title: 'Sample Expense',
    category: 'SHOP',
    amount: 100,
    isPersonalWithdrawal: false,
    paymentMethod: 'CASH',
    date: '2026-11-18',
    createdAt: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
}

function makeRecurring(overrides: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'rec-1',
    title: 'Monthly Rent',
    category: 'SHOP',
    amount: 5000,
    isPersonalWithdrawal: false,
    paymentMethod: 'CASH',
    frequency: 'MONTHLY',
    startDate: '2026-11-01',
    nextDueDate: '2026-12-01',
    autoCreateOnDue: true,
    isActive: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

test('buildDefaultExpenseCategories seeds all 9 standard categories when empty', () => {
  const result = buildDefaultExpenseCategories([], [], []);
  assert.equal(result.length, DEFAULT_EXPENSE_CATEGORY_SEEDS.length);
  assert.equal(result[0].id, 'SHOP');
  const drawing = result.find((c) => c.id === 'PERSONAL_DRAWING');
  assert.equal(drawing?.isPersonalDrawing, true);
});

test('buildDefaultExpenseCategories preserves custom edits and recovers orphaned IDs on records', () => {
  const saved: ExpenseCategoryConfig[] = [
    {
      id: 'CUSTOM_PACKAGING',
      label: 'Carry Bags & Boxes',
      icon: '🛍️',
      isPersonalDrawing: false,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];
  const expenses = [makeExpense({ category: 'SHOP' }), makeExpense({ id: 'exp-2', category: 'CUSTOM_COURIER' })];
  const recurring = [makeRecurring({ category: 'ELECTRICITY' })];

  const hydrated = buildDefaultExpenseCategories(expenses, recurring, saved);
  const ids = hydrated.map((c) => c.id);
  assert.ok(ids.includes('CUSTOM_PACKAGING'));
  assert.ok(ids.includes('SHOP'));
  assert.ok(ids.includes('ELECTRICITY'));
  assert.ok(ids.includes('CUSTOM_COURIER'));
  assert.equal(hydrated.find((c) => c.id === 'CUSTOM_COURIER')?.label, 'COURIER');
});

test('addExpenseCategoryConfig creates unique custom category and rejects duplicates/empty', () => {
  const initial = buildDefaultExpenseCategories([], [], []);
  assert.throws(() => addExpenseCategoryConfig(initial, { label: '   ' }), /required/i);
  assert.throws(
    () => addExpenseCategoryConfig(initial, { label: '  shop expenses (dukan kharch) ' }),
    /already exists/i
  );

  const { categories, created } = addExpenseCategoryConfig(initial, {
    label: 'Packaging & Carry Bags',
    icon: '🛍️',
    isPersonalDrawing: false,
  });
  assert.equal(categories.length, initial.length + 1);
  assert.equal(created.label, 'Packaging & Carry Bags');
  assert.equal(created.icon, '🛍️');
  assert.equal(created.id, 'CUSTOM_PACKAGING_CARRY_BAGS');
  assert.equal(created.isSystemDefault, false);
});

test('updateExpenseCategoryConfig renames label/icon and rejects duplicate names', () => {
  const initial = buildDefaultExpenseCategories([], [], []);
  assert.throws(
    () => updateExpenseCategoryConfig(initial, 'SHOP', { label: 'Electricity & Bills (Bijli)' }),
    /already exists/i
  );

  const { categories, updated } = updateExpenseCategoryConfig(initial, 'SHOP', {
    label: 'General Store Maintenance',
    icon: '🧹',
    isPersonalDrawing: false,
  });
  assert.equal(updated.label, 'General Store Maintenance');
  assert.equal(updated.icon, '🧹');
  assert.equal(categories.find((c) => c.id === 'SHOP')?.label, 'General Store Maintenance');
});

test('deleteExpenseCategoryConfig requires reassignment when referenced and updates linked expenses/recurring', () => {
  let categories = buildDefaultExpenseCategories([], [], []);
  const added = addExpenseCategoryConfig(categories, {
    label: 'Water Jar',
    icon: '💧',
    isPersonalDrawing: false,
  });
  categories = added.categories;
  const customId = added.created.id;

  const expenses = [makeExpense({ id: 'e1', category: customId }), makeExpense({ id: 'e2', category: 'SHOP' })];
  const recurring = [makeRecurring({ id: 'r1', category: customId })];

  assert.throws(
    () => deleteExpenseCategoryConfig(categories, expenses, recurring, customId),
    /Select a replacement/i
  );
  assert.throws(
    () => deleteExpenseCategoryConfig(categories, expenses, recurring, customId, customId),
    /must be different/i
  );

  const deleted = deleteExpenseCategoryConfig(categories, expenses, recurring, customId, 'PERSONAL_DRAWING');
  assert.equal(deleted.reassignedExpensesCount, 1);
  assert.equal(deleted.reassignedRecurringCount, 1);
  assert.equal(deleted.expenses[0].category, 'PERSONAL_DRAWING');
  assert.equal(deleted.expenses[0].isPersonalWithdrawal, true);
  assert.equal(deleted.recurringExpenses[0].category, 'PERSONAL_DRAWING');
  assert.ok(!deleted.categories.some((c) => c.id === customId));
});

test('deleteExpenseCategoryConfig refuses to delete the last category', () => {
  const single: ExpenseCategoryConfig[] = [
    {
      id: 'SHOP',
      label: 'Shop Expenses',
      icon: '🏪',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
    },
  ];
  assert.throws(() => deleteExpenseCategoryConfig(single, [], [], 'SHOP'), /at least one/i);
});

test('restoreMissingDefaultExpenseCategories adds missing defaults without duplicating custom or existing ones', () => {
  const base = buildDefaultExpenseCategories([], [], []);
  const added = addExpenseCategoryConfig(base, { label: 'Courier Postage', icon: '📦' }).categories;
  const pruned = added.filter((c) => c.id !== 'BREAKFAST' && c.id !== 'DINNER');

  const restored = restoreMissingDefaultExpenseCategories(pruned);
  assert.equal(restored.addedCount, 2);
  assert.ok(restored.categories.some((c) => c.id === 'BREAKFAST'));
  assert.ok(restored.categories.some((c) => c.id === 'DINNER'));
  assert.ok(restored.categories.some((c) => c.label === 'Courier Postage'));
});

test('resolveExpenseCategoryMeta resolves configured, default, and legacy IDs', () => {
  const categories = addExpenseCategoryConfig(buildDefaultExpenseCategories([], [], []), {
    label: 'Tea & Snacks',
    icon: '☕',
  }).categories;
  const custom = categories.find((c) => c.label === 'Tea & Snacks')!;
  assert.equal(resolveExpenseCategoryMeta(categories, custom.id).label, 'Tea & Snacks');
  assert.equal(resolveExpenseCategoryMeta([], 'ELECTRICITY').icon, '⚡');
  assert.equal(resolveExpenseCategoryMeta([], 'CUSTOM_OLD_BILLS').label, 'OLD BILLS');
});
