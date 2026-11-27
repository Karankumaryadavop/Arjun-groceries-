import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BILL_NOTES_LENGTH,
  validateBillNotesField,
  validateCartItems,
  validateDirectAmountField,
  validateLoyaltyPointsField,
  validateQuickAddProductInput,
  validateQuickSaleSubmission,
} from './quickSaleValidation';
import { SaleItem } from '../types';

const makeValidItem = (overrides: Partial<SaleItem> = {}): SaleItem => ({
  productId: 'prod-1',
  productName: 'Aashirvaad Atta 5kg',
  quantity: 2,
  unit: 'PACK',
  baseUnit: 'PACK',
  baseQuantity: 2,
  unitCostAtSale: 220,
  rate: 250,
  total: 500,
  ...overrides,
});

test('validateQuickAddProductInput rejects zero, negative, and blank quantities', () => {
  const zeroQty = validateQuickAddProductInput({
    productId: 'prod-1',
    productName: 'Sugar',
    unit: 'KG',
    quantityRaw: '0',
    rate: 45,
  });
  assert.equal(zeroQty.success, false);
  assert.ok(zeroQty.fieldErrors.addQty);

  const negativeQty = validateQuickAddProductInput({
    productId: 'prod-1',
    productName: 'Sugar',
    unit: 'KG',
    quantityRaw: '-3',
    rate: 45,
  });
  assert.equal(negativeQty.success, false);
  assert.ok(negativeQty.fieldErrors.addQty);

  const emptyQty = validateQuickAddProductInput({
    productId: 'prod-1',
    productName: 'Sugar',
    unit: 'KG',
    quantityRaw: '   ',
    rate: 45,
  });
  assert.equal(emptyQty.success, false);
  assert.ok(emptyQty.fieldErrors.addQty);
});

test('validateQuickAddProductInput rejects zero or negative product selling prices', () => {
  const zeroPrice = validateQuickAddProductInput({
    productId: 'prod-zero',
    productName: 'Free Sample',
    unit: 'PCS',
    quantityRaw: '1',
    rate: 0,
  });
  assert.equal(zeroPrice.success, false);
  assert.ok(zeroPrice.fieldErrors.product);
  assert.match(zeroPrice.error || '', /greater than ₹0/i);

  const negativePrice = validateQuickAddProductInput({
    productId: 'prod-neg',
    productName: 'Bad Product',
    unit: 'PCS',
    quantityRaw: '2',
    rate: -10,
  });
  assert.equal(negativePrice.success, false);
  assert.ok(negativePrice.fieldErrors.product);
});

test('validateQuickAddProductInput accepts positive decimal quantities and positive prices', () => {
  const ok = validateQuickAddProductInput({
    productId: 'prod-1',
    productName: 'Toor Dal',
    unit: 'KG',
    quantityRaw: '1.5',
    rate: 160,
  });
  assert.equal(ok.success, true);
  assert.equal(ok.data?.quantity, 1.5);
  assert.equal(ok.data?.rate, 160);
});

test('validateDirectAmountField rejects zero, negative, NaN, and empty values', () => {
  for (const bad of ['', '0', '-50', 'abc', 'Infinity']) {
    const res = validateDirectAmountField(bad);
    assert.equal(res.success, false, `Expected "${bad}" to fail validation`);
    assert.ok(res.fieldErrors.directAmount);
  }

  const good = validateDirectAmountField('275.5');
  assert.equal(good.success, true);
  assert.equal(good.data, 275.5);
});

test('validateCartItems catches negative quantities, zero prices, zero totals, and excessive discounts', () => {
  const negQtyRes = validateCartItems([makeValidItem({ quantity: -1 })]);
  assert.equal(negQtyRes.success, false);
  assert.ok(negQtyRes.fieldErrors.items);

  const zeroRateRes = validateCartItems([makeValidItem({ rate: 0 })]);
  assert.equal(zeroRateRes.success, false);
  assert.match(zeroRateRes.error || '', /greater than ₹0/i);

  const zeroTotalRes = validateCartItems([makeValidItem({ total: 0 })]);
  assert.equal(zeroTotalRes.success, false);

  const overDiscountRes = validateCartItems([makeValidItem({ quantity: 1, rate: 100, discount: 150, total: 10 })]);
  assert.equal(overDiscountRes.success, false);

  const validRes = validateCartItems([makeValidItem()]);
  assert.equal(validRes.success, true);
});

test('validateLoyaltyPointsField rejects negative, decimal, and over-limit points', () => {
  assert.equal(validateLoyaltyPointsField('').success, true);
  assert.equal(validateLoyaltyPointsField('0').success, true);
  assert.equal(validateLoyaltyPointsField('20', 50).success, true);

  assert.equal(validateLoyaltyPointsField('-5', 50).success, false);
  assert.equal(validateLoyaltyPointsField('10.5', 50).success, false);
  assert.equal(validateLoyaltyPointsField('60', 50).success, false);
});

test('validateBillNotesField enforces maximum length', () => {
  assert.equal(validateBillNotesField('Delivered to home').success, true);
  assert.equal(validateBillNotesField('a'.repeat(MAX_BILL_NOTES_LENGTH + 1)).success, false);
});

test('validateQuickSaleSubmission blocks invalid sales before local DB write', () => {
  // 1. Empty cart & zero direct amount
  const zeroDirect = validateQuickSaleSubmission({
    paymentMethod: 'CASH',
    items: [],
    directAmountRaw: '0',
    grossAmount: 0,
    netAmount: 0,
    loyaltyPointsRaw: '',
    maxRedeemablePoints: 0,
    loyaltyEnabled: true,
    notes: '',
  });
  assert.equal(zeroDirect.success, false);
  assert.ok(zeroDirect.fieldErrors.directAmount);

  // 2. Empty cart & negative direct amount
  const negDirect = validateQuickSaleSubmission({
    paymentMethod: 'UPI',
    items: [],
    directAmountRaw: '-120',
    grossAmount: -120,
    netAmount: -120,
    loyaltyPointsRaw: '',
    maxRedeemablePoints: 0,
    loyaltyEnabled: true,
    notes: '',
  });
  assert.equal(negDirect.success, false);
  assert.ok(negDirect.fieldErrors.directAmount);

  // 3. Cart item with zero rate
  const zeroPriceItem = validateQuickSaleSubmission({
    paymentMethod: 'CASH',
    items: [makeValidItem({ rate: 0, total: 100 })],
    directAmountRaw: '',
    grossAmount: 100,
    netAmount: 100,
    loyaltyPointsRaw: '',
    maxRedeemablePoints: 0,
    loyaltyEnabled: true,
    notes: '',
  });
  assert.equal(zeroPriceItem.success, false);
  assert.ok(zeroPriceItem.fieldErrors.items);

  // 4. Credit sale without selected customer
  const creditNoCustomer = validateQuickSaleSubmission({
    paymentMethod: 'CREDIT',
    customerId: '',
    items: [makeValidItem()],
    directAmountRaw: '',
    grossAmount: 500,
    netAmount: 500,
    loyaltyPointsRaw: '',
    maxRedeemablePoints: 0,
    loyaltyEnabled: true,
    notes: '',
  });
  assert.equal(creditNoCustomer.success, false);
  assert.ok(creditNoCustomer.fieldErrors.customer);

  // 5. Valid itemized credit sale with customer passes cleanly
  const validSale = validateQuickSaleSubmission({
    paymentMethod: 'CREDIT',
    customerId: 'cust-1',
    items: [makeValidItem()],
    directAmountRaw: '',
    grossAmount: 500,
    netAmount: 480,
    loyaltyPointsRaw: '20',
    maxRedeemablePoints: 50,
    loyaltyEnabled: true,
    notes: 'Monthly groceries',
  });
  assert.equal(validSale.success, true);
  assert.deepEqual(validSale.fieldErrors, {});
});
