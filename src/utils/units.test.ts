import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUnit,
  getUnitCategory,
  getAllowedSellingUnits,
  convertToBaseUnit,
  calculateItemPricing,
  formatQuantityWithUnit,
} from './units';

describe('SmartKirana Unit Conversions & Pricing Logic', () => {
  it('normalizes units correctly', () => {
    assert.equal(normalizeUnit('kg'), 'KG');
    assert.equal(normalizeUnit('KG'), 'KG');
    assert.equal(normalizeUnit('gm'), 'GM');
    assert.equal(normalizeUnit('gram'), 'GM');
    assert.equal(normalizeUnit('litre'), 'LITRE');
    assert.equal(normalizeUnit('ml'), 'ML');
    assert.equal(normalizeUnit('pcs'), 'PCS');
    assert.equal(normalizeUnit('dozen'), 'DOZEN');
    assert.equal(normalizeUnit('packet'), 'PACKET');
    assert.equal(normalizeUnit('box'), 'BOX');
    assert.equal(normalizeUnit('bottle'), 'BOTTLE');
  });

  it('determines the right unit category', () => {
    assert.equal(getUnitCategory('KG'), 'WEIGHT');
    assert.equal(getUnitCategory('GM'), 'WEIGHT');
    assert.equal(getUnitCategory('LITRE'), 'VOLUME');
    assert.equal(getUnitCategory('ML'), 'VOLUME');
    assert.equal(getUnitCategory('PCS'), 'COUNT');
    assert.equal(getUnitCategory('DOZEN'), 'COUNT');
    assert.equal(getUnitCategory('PACKET'), 'PACKAGE');
    assert.equal(getUnitCategory('BOX'), 'PACKAGE');
  });

  it('provides allowed selling units for KG base products', () => {
    const units = getAllowedSellingUnits('KG');
    const unitCodes = units.map((u) => u.unit);
    assert.deepEqual(unitCodes, ['KG', 'GM']);
  });

  it('provides allowed selling units for LITRE base products', () => {
    const units = getAllowedSellingUnits('LITRE');
    const unitCodes = units.map((u) => u.unit);
    assert.deepEqual(unitCodes, ['LITRE', 'ML']);
  });

  it('provides allowed selling units for PCS base products', () => {
    const units = getAllowedSellingUnits('PCS');
    const unitCodes = units.map((u) => u.unit);
    assert.deepEqual(unitCodes, ['PCS', 'DOZEN']);
  });

  it('does NOT show irrelevant unit options for packaged products', () => {
    const units = getAllowedSellingUnits('PACKET');
    const unitCodes = units.map((u) => u.unit);
    assert.deepEqual(unitCodes, ['PACKET']);
  });

  it('converts quantities to base units accurately for inventory deduction', () => {
    // 500 GM ALU -> 0.5 KG
    assert.equal(convertToBaseUnit(500, 'GM', 'KG'), 0.5);
    // 250 GM ALU -> 0.25 KG
    assert.equal(convertToBaseUnit(250, 'GM', 'KG'), 0.25);
    // 1.5 KG ALU -> 1.5 KG
    assert.equal(convertToBaseUnit(1.5, 'KG', 'KG'), 1.5);
    // 500 ML Oil -> 0.5 LITRE
    assert.equal(convertToBaseUnit(500, 'ML', 'LITRE'), 0.5);
    // 1 DOZEN -> 12 PCS
    assert.equal(convertToBaseUnit(1, 'DOZEN', 'PCS'), 12);
    // 6 PCS -> 0.5 DOZEN
    assert.equal(convertToBaseUnit(6, 'PCS', 'DOZEN'), 0.5);
  });

  it('matches prompt specification for ALU @ ₹30/KG', () => {
    const basePrice = 30; // ₹30 per KG
    const baseUnit = 'KG';

    // 1 KG = ₹30
    const calc1Kg = calculateItemPricing({
      basePrice,
      baseUnit,
      quantity: 1,
      selectedUnit: 'KG',
    });
    assert.equal(calc1Kg.finalTotal, 30);
    assert.equal(calc1Kg.baseQuantity, 1);

    // 500 GM = ₹15
    const calc500Gm = calculateItemPricing({
      basePrice,
      baseUnit,
      quantity: 500,
      selectedUnit: 'GM',
    });
    assert.equal(calc500Gm.finalTotal, 15);
    assert.equal(calc500Gm.baseQuantity, 0.5);

    // 250 GM = ₹7.50
    const calc250Gm = calculateItemPricing({
      basePrice,
      baseUnit,
      quantity: 250,
      selectedUnit: 'GM',
    });
    assert.equal(calc250Gm.finalTotal, 7.5);
    assert.equal(calc250Gm.baseQuantity, 0.25);

    // 1.5 KG = ₹45
    const calc1_5Kg = calculateItemPricing({
      basePrice,
      baseUnit,
      quantity: 1.5,
      selectedUnit: 'KG',
    });
    assert.equal(calc1_5Kg.finalTotal, 45);
    assert.equal(calc1_5Kg.baseQuantity, 1.5);
  });

  it('handles item discounts accurately (FLAT and PERCENT)', () => {
    // ₹100 item with ₹10 flat discount
    const flatDiscountCalc = calculateItemPricing({
      basePrice: 100,
      baseUnit: 'PCS',
      quantity: 1,
      selectedUnit: 'PCS',
      discount: 10,
      discountType: 'FLAT',
    });
    assert.equal(flatDiscountCalc.grossAmount, 100);
    assert.equal(flatDiscountCalc.discountAmount, 10);
    assert.equal(flatDiscountCalc.finalTotal, 90);

    // ₹200 item with 15% discount
    const pctDiscountCalc = calculateItemPricing({
      basePrice: 200,
      baseUnit: 'PCS',
      quantity: 1,
      selectedUnit: 'PCS',
      discount: 15,
      discountType: 'PERCENT',
    });
    assert.equal(pctDiscountCalc.grossAmount, 200);
    assert.equal(pctDiscountCalc.discountAmount, 30);
    assert.equal(pctDiscountCalc.finalTotal, 170);
  });

  it('formats quantities with units cleanly', () => {
    assert.equal(formatQuantityWithUnit(1.5, 'KG'), '1.5 KG');
    assert.equal(formatQuantityWithUnit(500, 'GM'), '500 GM');
    assert.equal(formatQuantityWithUnit(19.84, 'KG'), '19.84 KG');
  });
});
