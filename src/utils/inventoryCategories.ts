/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, ProductCategoryConfig } from '../types';

export const COMMON_CATEGORY_UNITS = [
  'pcs',
  'kg',
  'g',
  'L',
  'ml',
  'pkt',
  'bags',
  'boxes',
  'dozens',
] as const;

export const DEFAULT_CATEGORY_UNIT_MAP: Record<string, { defaultUnit: string; defaultMinStockAlert: number }> = {
  'Grains & Flour': { defaultUnit: 'kg', defaultMinStockAlert: 10 },
  'Pulses & Dals': { defaultUnit: 'kg', defaultMinStockAlert: 10 },
  'Edible Oils & Ghee': { defaultUnit: 'L', defaultMinStockAlert: 8 },
  'Spices & Seasoning': { defaultUnit: 'pkt', defaultMinStockAlert: 12 },
  'Packaged Snacks': { defaultUnit: 'pkt', defaultMinStockAlert: 15 },
  'Personal Care': { defaultUnit: 'pcs', defaultMinStockAlert: 10 },
  'Household & Cleaning': { defaultUnit: 'pcs', defaultMinStockAlert: 8 },
  'Fresh Vegetables & Staples': { defaultUnit: 'kg', defaultMinStockAlert: 5 },
  'Tea & Beverages': { defaultUnit: 'pkt', defaultMinStockAlert: 10 },
  'Dairy & Bakery': { defaultUnit: 'pkt', defaultMinStockAlert: 8 },
  'General Kirana': { defaultUnit: 'pcs', defaultMinStockAlert: 5 },
};

function normalizeCategoryKey(name: string): string {
  return name.trim().toLowerCase();
}

export function createCategoryId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `cat-${slug || 'item'}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Ensures every product category present in inventory plus standard Kirana defaults
 * has an explicit ProductCategoryConfig entry with a default common unit.
 */
export function buildDefaultProductCategories(
  products: Product[],
  existing: ProductCategoryConfig[] = []
): ProductCategoryConfig[] {
  const now = new Date().toISOString();
  const byKey = new Map<string, ProductCategoryConfig>();

  for (const cat of existing) {
    const trimmed = String(cat.name || '').trim();
    if (!trimmed) continue;
    byKey.set(normalizeCategoryKey(trimmed), {
      ...cat,
      name: trimmed,
      defaultUnit: String(cat.defaultUnit || 'pcs').trim() || 'pcs',
      defaultMinStockAlert:
        cat.defaultMinStockAlert !== undefined && Number.isFinite(Number(cat.defaultMinStockAlert))
          ? Math.max(0, Number(cat.defaultMinStockAlert))
          : DEFAULT_CATEGORY_UNIT_MAP[trimmed]?.defaultMinStockAlert ?? 5,
    });
  }

  const inferUnitForCategory = (catName: string): { defaultUnit: string; defaultMinStockAlert: number } => {
    const mapped = DEFAULT_CATEGORY_UNIT_MAP[catName];
    if (mapped) return mapped;

    const matchingProduct = products.find(
      (p) => normalizeCategoryKey(p.category || '') === normalizeCategoryKey(catName)
    );
    if (matchingProduct) {
      return {
        defaultUnit: matchingProduct.unit || 'pcs',
        defaultMinStockAlert: Math.max(0, Number(matchingProduct.minStockAlert) || 5),
      };
    }

    const lower = catName.toLowerCase();
    if (lower.includes('oil') || lower.includes('ghee') || lower.includes('liquid') || lower.includes('milk')) {
      return { defaultUnit: 'L', defaultMinStockAlert: 5 };
    }
    if (lower.includes('grain') || lower.includes('flour') || lower.includes('dal') || lower.includes('pulse') || lower.includes('rice') || lower.includes('sugar')) {
      return { defaultUnit: 'kg', defaultMinStockAlert: 10 };
    }
    if (lower.includes('spice') || lower.includes('snack') || lower.includes('tea') || lower.includes('biscuit')) {
      return { defaultUnit: 'pkt', defaultMinStockAlert: 10 };
    }
    return { defaultUnit: 'pcs', defaultMinStockAlert: 5 };
  };

  // Seed categories referenced by products first
  for (const product of products) {
    const catName = String(product.category || '').trim();
    if (!catName) continue;
    const key = normalizeCategoryKey(catName);
    if (!byKey.has(key)) {
      const inferred = inferUnitForCategory(catName);
      byKey.set(key, {
        id: createCategoryId(catName),
        name: catName,
        defaultUnit: inferred.defaultUnit,
        defaultMinStockAlert: inferred.defaultMinStockAlert,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // If no existing categories were explicitly saved yet, also include standard Kirana defaults
  if (existing.length === 0) {
    for (const [catName, cfg] of Object.entries(DEFAULT_CATEGORY_UNIT_MAP)) {
      const key = normalizeCategoryKey(catName);
      if (!byKey.has(key)) {
        byKey.set(key, {
          id: createCategoryId(catName),
          name: catName,
          defaultUnit: cfg.defaultUnit,
          defaultMinStockAlert: cfg.defaultMinStockAlert,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getCategoryDefaults(
  categories: ProductCategoryConfig[],
  categoryName: string
): { defaultUnit: string; defaultMinStockAlert?: number } | null {
  const key = normalizeCategoryKey(categoryName || '');
  if (!key) return null;
  const found = categories.find((c) => normalizeCategoryKey(c.name) === key);
  if (found) {
    return {
      defaultUnit: found.defaultUnit || 'pcs',
      defaultMinStockAlert: found.defaultMinStockAlert,
    };
  }
  const preset = Object.entries(DEFAULT_CATEGORY_UNIT_MAP).find(
    ([name]) => normalizeCategoryKey(name) === key
  );
  return preset ? preset[1] : null;
}

export function addProductCategoryConfig(
  categories: ProductCategoryConfig[],
  input: { name: string; defaultUnit: string; defaultMinStockAlert?: number }
): { categories: ProductCategoryConfig[]; created: ProductCategoryConfig } {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Category name is required.');
  }
  const duplicate = categories.find(
    (c) => normalizeCategoryKey(c.name) === normalizeCategoryKey(trimmedName)
  );
  if (duplicate) {
    throw new Error(`Category "${duplicate.name}" already exists.`);
  }

  const trimmedUnit = input.defaultUnit.trim() || 'pcs';
  const now = new Date().toISOString();
  const created: ProductCategoryConfig = {
    id: createCategoryId(trimmedName),
    name: trimmedName,
    defaultUnit: trimmedUnit,
    defaultMinStockAlert:
      input.defaultMinStockAlert !== undefined && Number.isFinite(Number(input.defaultMinStockAlert))
        ? Math.max(0, Number(input.defaultMinStockAlert))
        : 5,
    createdAt: now,
    updatedAt: now,
  };

  return {
    categories: [...categories, created].sort((a, b) => a.name.localeCompare(b.name)),
    created,
  };
}

export function updateProductCategoryConfig(
  categories: ProductCategoryConfig[],
  products: Product[],
  id: string,
  patch: { name: string; defaultUnit: string; defaultMinStockAlert?: number }
): {
  categories: ProductCategoryConfig[];
  products: Product[];
  updated: ProductCategoryConfig;
  renamedProductsCount: number;
} {
  const existing = categories.find((c) => c.id === id);
  if (!existing) {
    throw new Error('Category not found.');
  }
  const nextName = patch.name.trim();
  if (!nextName) {
    throw new Error('Category name cannot be empty.');
  }
  const conflict = categories.find(
    (c) => c.id !== id && normalizeCategoryKey(c.name) === normalizeCategoryKey(nextName)
  );
  if (conflict) {
    throw new Error(`Another category named "${conflict.name}" already exists. Use Merge instead.`);
  }

  const nextUnit = patch.defaultUnit.trim() || existing.defaultUnit || 'pcs';
  const now = new Date().toISOString();
  const updated: ProductCategoryConfig = {
    ...existing,
    name: nextName,
    defaultUnit: nextUnit,
    defaultMinStockAlert:
      patch.defaultMinStockAlert !== undefined && Number.isFinite(Number(patch.defaultMinStockAlert))
        ? Math.max(0, Number(patch.defaultMinStockAlert))
        : existing.defaultMinStockAlert,
    updatedAt: now,
  };

  const nextCategories = categories
    .map((c) => (c.id === id ? updated : c))
    .sort((a, b) => a.name.localeCompare(b.name));

  const oldKey = normalizeCategoryKey(existing.name);
  let renamedProductsCount = 0;
  const nextProducts = products.map((p) => {
    if (normalizeCategoryKey(p.category || '') === oldKey) {
      renamedProductsCount++;
      return { ...p, category: nextName, updatedAt: now };
    }
    return p;
  });

  return {
    categories: nextCategories,
    products: nextProducts,
    updated,
    renamedProductsCount,
  };
}

export function mergeProductCategoriesConfigs(
  categories: ProductCategoryConfig[],
  products: Product[],
  sourceId: string,
  targetId: string
): {
  categories: ProductCategoryConfig[];
  products: Product[];
  sourceName: string;
  targetName: string;
  movedProductsCount: number;
} {
  if (sourceId === targetId) {
    throw new Error('Choose a different destination category to merge into.');
  }
  const source = categories.find((c) => c.id === sourceId);
  const target = categories.find((c) => c.id === targetId);
  if (!source || !target) {
    throw new Error('Source or target category not found.');
  }

  const now = new Date().toISOString();
  const sourceKey = normalizeCategoryKey(source.name);
  let movedProductsCount = 0;
  const nextProducts = products.map((p) => {
    if (normalizeCategoryKey(p.category || '') === sourceKey) {
      movedProductsCount++;
      return { ...p, category: target.name, updatedAt: now };
    }
    return p;
  });

  const nextCategories = categories
    .filter((c) => c.id !== source.id)
    .map((c) => (c.id === target.id ? { ...c, updatedAt: now } : c))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    categories: nextCategories,
    products: nextProducts,
    sourceName: source.name,
    targetName: target.name,
    movedProductsCount,
  };
}

export function deleteProductCategoryConfig(
  categories: ProductCategoryConfig[],
  products: Product[],
  id: string,
  reassignToCategoryName?: string
): {
  categories: ProductCategoryConfig[];
  products: Product[];
  deletedName: string;
  reassignedProductsCount: number;
} {
  const target = categories.find((c) => c.id === id);
  if (!target) {
    throw new Error('Category not found.');
  }
  const targetKey = normalizeCategoryKey(target.name);
  const affectedProducts = products.filter(
    (p) => normalizeCategoryKey(p.category || '') === targetKey
  );

  if (affectedProducts.length > 0 && (!reassignToCategoryName || !reassignToCategoryName.trim())) {
    throw new Error(
      `"${target.name}" has ${affectedProducts.length} products. Select a replacement category before deleting.`
    );
  }

  if (
    reassignToCategoryName &&
    normalizeCategoryKey(reassignToCategoryName) === targetKey
  ) {
    throw new Error('Replacement category must be different from the deleted category.');
  }

  const now = new Date().toISOString();
  const nextReplacement = reassignToCategoryName?.trim();
  let reassignedProductsCount = 0;

  const nextProducts = products.map((p) => {
    if (normalizeCategoryKey(p.category || '') === targetKey && nextReplacement) {
      reassignedProductsCount++;
      return { ...p, category: nextReplacement, updatedAt: now };
    }
    return p;
  });

  const nextCategories = categories.filter((c) => c.id !== id);
  return {
    categories: nextCategories,
    products: nextProducts,
    deletedName: target.name,
    reassignedProductsCount,
  };
}
