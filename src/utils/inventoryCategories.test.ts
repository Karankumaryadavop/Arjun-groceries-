import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultProductCategories,
  getCategoryDefaults,
  addProductCategoryConfig,
  updateProductCategoryConfig,
  mergeProductCategoriesConfigs,
  deleteProductCategoryConfig,
} from './inventoryCategories';
import { Product, ProductCategoryConfig } from '../types';

const sampleProducts: Product[] = [
  {
    id: 'p1',
    name: 'Aashirvaad Atta',
    category: 'Grains & Flour',
    purchasePrice: 360,
    sellingPrice: 410,
    stockQty: 20,
    unit: 'kg',
    minStockAlert: 10,
    updatedAt: '2026-11-10T00:00:00Z',
  },
  {
    id: 'p2',
    name: 'Fortune Mustard Oil',
    category: 'Edible Oils & Ghee',
    purchasePrice: 130,
    sellingPrice: 155,
    stockQty: 15,
    unit: 'L',
    minStockAlert: 5,
    updatedAt: '2026-11-10T00:00:00Z',
  },
  {
    id: 'p3',
    name: 'Custom Spice Blend',
    category: 'Local Dry Masala',
    purchasePrice: 45,
    sellingPrice: 60,
    stockQty: 12,
    unit: 'pkt',
    minStockAlert: 6,
    updatedAt: '2026-11-10T00:00:00Z',
  },
];

test('buildDefaultProductCategories seeds standard categories plus custom product categories', () => {
  const categories = buildDefaultProductCategories(sampleProducts);
  assert.ok(categories.some((c) => c.name === 'Grains & Flour' && c.defaultUnit === 'kg'));
  assert.ok(categories.some((c) => c.name === 'Edible Oils & Ghee' && c.defaultUnit === 'L'));
  assert.ok(categories.some((c) => c.name === 'Local Dry Masala' && c.defaultUnit === 'pkt'));
});

test('getCategoryDefaults resolves existing category case-insensitively and returns null for unknown', () => {
  const categories = buildDefaultProductCategories(sampleProducts);
  const grains = getCategoryDefaults(categories, 'grains & flour');
  assert.equal(grains?.defaultUnit, 'kg');
  assert.equal(getCategoryDefaults(categories, 'Completely Unknown Category'), null);
});

test('addProductCategoryConfig creates a new category and rejects case-insensitive duplicates', () => {
  const initial = buildDefaultProductCategories(sampleProducts);
  const { categories, created } = addProductCategoryConfig(initial, {
    name: 'Pooja Essentials',
    defaultUnit: 'pkt',
    defaultMinStockAlert: 8,
  });

  assert.equal(created.name, 'Pooja Essentials');
  assert.equal(created.defaultUnit, 'pkt');
  assert.equal(created.defaultMinStockAlert, 8);
  assert.ok(categories.some((c) => c.id === created.id));

  assert.throws(() => {
    addProductCategoryConfig(categories, {
      name: '  pooja essentials ',
      defaultUnit: 'pcs',
    });
  }, /already exists/i);
});

test('updateProductCategoryConfig renames category and propagates name change to products', () => {
  const initial: ProductCategoryConfig[] = buildDefaultProductCategories(sampleProducts);
  const target = initial.find((c) => c.name === 'Local Dry Masala')!;

  const res = updateProductCategoryConfig(initial, sampleProducts, target.id, {
    name: 'Regional Masalas',
    defaultUnit: 'g',
    defaultMinStockAlert: 15,
  });

  assert.equal(res.renamedProductsCount, 1);
  assert.equal(res.products.find((p) => p.id === 'p3')?.category, 'Regional Masalas');
  assert.equal(res.updated.defaultUnit, 'g');
  assert.equal(res.updated.defaultMinStockAlert, 15);
});

test('mergeProductCategoriesConfigs moves all products from source to target and removes source', () => {
  const initial = buildDefaultProductCategories(sampleProducts);
  const source = initial.find((c) => c.name === 'Local Dry Masala')!;
  const target = initial.find((c) => c.name === 'Grains & Flour')!;

  const res = mergeProductCategoriesConfigs(initial, sampleProducts, source.id, target.id);
  assert.equal(res.movedProductsCount, 1);
  assert.equal(res.products.find((p) => p.id === 'p3')?.category, 'Grains & Flour');
  assert.equal(res.categories.some((c) => c.id === source.id), false);
  assert.equal(res.categories.some((c) => c.id === target.id), true);
});

test('deleteProductCategoryConfig requires reassignment when products use the category and reassigns cleanly', () => {
  const initial = buildDefaultProductCategories(sampleProducts);
  const usedCat = initial.find((c) => c.name === 'Local Dry Masala')!;

  assert.throws(() => {
    deleteProductCategoryConfig(initial, sampleProducts, usedCat.id);
  }, /Select a replacement category/i);

  const res = deleteProductCategoryConfig(initial, sampleProducts, usedCat.id, 'General Kirana');
  assert.equal(res.reassignedProductsCount, 1);
  assert.equal(res.products.find((p) => p.id === 'p3')?.category, 'General Kirana');
  assert.equal(res.categories.some((c) => c.id === usedCat.id), false);
});
