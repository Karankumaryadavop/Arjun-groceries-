/**
 * Pure unit conversion and pricing calculation utilities for SmartKirana Pro.
 * Provides accurate kirana unit switching (KG <-> GM, LITRE <-> ML, PCS <-> DOZEN),
 * fractional pricing, item discounts, and stock base unit conversions.
 */

export type UnitType = 'WEIGHT' | 'VOLUME' | 'COUNT' | 'PACKAGE';

export interface SellingUnitOption {
  unit: string;
  label: string;
  shortLabel: string;
  ratioToBase: number; // multiply selected quantity by this to get quantity in baseUnit
  step: number;
  presets: number[];
}

/**
 * Standardize unit strings into canonical form.
 */
export function normalizeUnit(rawUnit?: string): string {
  if (!rawUnit) return 'PCS';
  const u = rawUnit.trim().toLowerCase();

  if (u === 'kg' || u === 'kilogram' || u === 'kilo') return 'KG';
  if (u === 'gm' || u === 'g' || u === 'gram' || u === 'grams') return 'GM';
  if (u === 'litre' || u === 'liter' || u === 'l' || u === 'ltr' || u === 'ltrs' || u === 'litres' || u === 'liters') return 'LITRE';
  if (u === 'ml' || u === 'millilitre' || u === 'milliliter') return 'ML';
  if (u === 'pcs' || u === 'piece' || u === 'pieces' || u === 'pc') return 'PCS';
  if (u === 'dozen' || u === 'dozens' || u === 'doz') return 'DOZEN';
  if (u === 'packet' || u === 'packets' || u === 'pkt' || u === 'pkts' || u === 'pack' || u === 'family pack') return 'PACKET';
  if (u === 'box' || u === 'boxes') return 'BOX';
  if (u === 'bottle' || u === 'bottles') return 'BOTTLE';
  if (u === 'bag' || u === 'bags' || u === 'sack' || u === 'sacks') return 'BAG';
  if (u === 'pouch') return 'POUCH';

  // Specific compound units
  if (u.includes('kg')) return 'KG';
  if (u.includes('litre') || u.endsWith('l')) return 'LITRE';
  if (u.includes('gm') || u.includes('g ')) return 'GM';

  return rawUnit.toUpperCase();
}

/**
 * Determine the category of a unit.
 */
export function getUnitCategory(unit: string): UnitType {
  const norm = normalizeUnit(unit);
  switch (norm) {
    case 'KG':
    case 'GM':
      return 'WEIGHT';
    case 'LITRE':
    case 'ML':
      return 'VOLUME';
    case 'PCS':
    case 'DOZEN':
      return 'COUNT';
    case 'PACKET':
    case 'BOX':
    case 'BOTTLE':
    case 'BAG':
    case 'POUCH':
    default:
      return 'PACKAGE';
  }
}

/**
 * Return allowed selling unit options for a given product base unit.
 * Weight: KG <-> GM (1 KG = 1000 GM)
 * Volume: LITRE <-> ML (1 LITRE = 1000 ML)
 * Count: PCS <-> DOZEN (1 DOZEN = 12 PCS)
 * Other packaged units (PACKET, BOX, BOTTLE, etc.): Only the configured unit
 */
export function getAllowedSellingUnits(baseUnit: string): SellingUnitOption[] {
  const norm = normalizeUnit(baseUnit);

  if (norm === 'KG') {
    return [
      {
        unit: 'KG',
        label: 'KG (Kilo)',
        shortLabel: 'KG',
        ratioToBase: 1,
        step: 0.25,
        presets: [0.5, 1, 1.5, 2, 5],
      },
      {
        unit: 'GM',
        label: 'GRAM (Gram)',
        shortLabel: 'GM',
        ratioToBase: 0.001,
        step: 50,
        presets: [100, 250, 500, 750],
      },
    ];
  }

  if (norm === 'GM') {
    return [
      {
        unit: 'GM',
        label: 'GRAM (Gram)',
        shortLabel: 'GM',
        ratioToBase: 1,
        step: 50,
        presets: [100, 250, 500, 750],
      },
      {
        unit: 'KG',
        label: 'KG (Kilo)',
        shortLabel: 'KG',
        ratioToBase: 1000,
        step: 0.25,
        presets: [0.5, 1, 1.5, 2],
      },
    ];
  }

  if (norm === 'LITRE') {
    return [
      {
        unit: 'LITRE',
        label: 'LITRE (Litre)',
        shortLabel: 'L',
        ratioToBase: 1,
        step: 0.5,
        presets: [0.5, 1, 2, 5],
      },
      {
        unit: 'ML',
        label: 'ML (Millilitre)',
        shortLabel: 'ML',
        ratioToBase: 0.001,
        step: 50,
        presets: [100, 200, 250, 500],
      },
    ];
  }

  if (norm === 'ML') {
    return [
      {
        unit: 'ML',
        label: 'ML (Millilitre)',
        shortLabel: 'ML',
        ratioToBase: 1,
        step: 50,
        presets: [100, 250, 500],
      },
      {
        unit: 'LITRE',
        label: 'LITRE (Litre)',
        shortLabel: 'L',
        ratioToBase: 1000,
        step: 0.5,
        presets: [0.5, 1, 2],
      },
    ];
  }

  if (norm === 'PCS') {
    return [
      {
        unit: 'PCS',
        label: 'PCS (Piece)',
        shortLabel: 'PCS',
        ratioToBase: 1,
        step: 1,
        presets: [1, 2, 5, 10],
      },
      {
        unit: 'DOZEN',
        label: 'DOZEN (Darjan)',
        shortLabel: 'DOZ',
        ratioToBase: 12,
        step: 0.5,
        presets: [0.5, 1, 2],
      },
    ];
  }

  if (norm === 'DOZEN') {
    return [
      {
        unit: 'DOZEN',
        label: 'DOZEN (Darjan)',
        shortLabel: 'DOZ',
        ratioToBase: 1,
        step: 0.5,
        presets: [0.5, 1, 2],
      },
      {
        unit: 'PCS',
        label: 'PCS (Piece)',
        shortLabel: 'PCS',
        ratioToBase: 1 / 12,
        step: 1,
        presets: [1, 6, 12],
      },
    ];
  }

  // Packaged / Discrete units (PACKET, BOX, BOTTLE, etc.)
  return [
    {
      unit: norm,
      label: norm,
      shortLabel: norm,
      ratioToBase: 1,
      step: 1,
      presets: [1, 2, 5, 10],
    },
  ];
}

export function areUnitsCompatible(unitA: string, unitB: string): boolean {
  const normA = normalizeUnit(unitA);
  const normB = normalizeUnit(unitB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if ((normA === 'KG' || normA === 'GM') && (normB === 'KG' || normB === 'GM')) {
    return true;
  }
  if ((normA === 'LITRE' || normA === 'ML') && (normB === 'LITRE' || normB === 'ML')) {
    return true;
  }
  if ((normA === 'PCS' || normA === 'DOZEN') && (normB === 'PCS' || normB === 'DOZEN')) {
    return true;
  }
  return false;
}

export interface StrictUnitConversionResult {
  valid: boolean;
  baseQuantity: number;
  normalizedSelectedUnit: string;
  normalizedBaseUnit: string;
  error?: string;
}

/**
 * Strictly convert quantity from selectedUnit into baseUnit.
 * Never invents 1:1 fallback conversions across incompatible or unknown unit categories.
 */
export function convertToBaseUnitStrict(
  quantity: number,
  selectedUnit: string,
  baseUnit: string
): StrictUnitConversionResult {
  const normSelected = normalizeUnit(selectedUnit);
  const normBase = normalizeUnit(baseUnit);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      valid: false,
      baseQuantity: 0,
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
      error: 'Quantity must be greater than zero.',
    };
  }

  if (!areUnitsCompatible(normSelected, normBase)) {
    return {
      valid: false,
      baseQuantity: 0,
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
      error: `Incompatible unit conversion: cannot convert "${selectedUnit}" (${normSelected}) to base unit "${baseUnit}" (${normBase}).`,
    };
  }

  if (normSelected === normBase) {
    return {
      valid: true,
      baseQuantity: roundNumber(quantity, 4),
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
    };
  }

  if (normBase === 'KG' && normSelected === 'GM') {
    return {
      valid: true,
      baseQuantity: roundNumber(quantity / 1000, 4),
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
    };
  }
  if (normBase === 'GM' && normSelected === 'KG') {
    return {
      valid: true,
      baseQuantity: roundNumber(quantity * 1000, 4),
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
    };
  }

  if (normBase === 'LITRE' && normSelected === 'ML') {
    return {
      valid: true,
      baseQuantity: roundNumber(quantity / 1000, 4),
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
    };
  }
  if (normBase === 'ML' && normSelected === 'LITRE') {
    return {
      valid: true,
      baseQuantity: roundNumber(quantity * 1000, 4),
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
    };
  }

  if (normBase === 'PCS' && normSelected === 'DOZEN') {
    return {
      valid: true,
      baseQuantity: roundNumber(quantity * 12, 4),
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
    };
  }
  if (normBase === 'DOZEN' && normSelected === 'PCS') {
    return {
      valid: true,
      baseQuantity: roundNumber(quantity / 12, 4),
      normalizedSelectedUnit: normSelected,
      normalizedBaseUnit: normBase,
    };
  }

  return {
    valid: false,
    baseQuantity: 0,
    normalizedSelectedUnit: normSelected,
    normalizedBaseUnit: normBase,
    error: `Unsupported unit conversion from "${selectedUnit}" to "${baseUnit}".`,
  };
}

/**
 * Convert quantity from selected selling unit into the product's base unit.
 * Used for deducting inventory accurately without rounding corruptions.
 */
export function convertToBaseUnit(
  quantity: number,
  selectedUnit: string,
  baseUnit: string
): number {
  const strict = convertToBaseUnitStrict(quantity, selectedUnit, baseUnit);
  return strict.valid ? strict.baseQuantity : 0;
}

/**
 * Calculate item pricing, line discount, and base quantity.
 */
export interface LinePriceCalculation {
  baseQuantity: number;
  grossAmount: number;
  discountAmount: number;
  finalTotal: number;
  effectiveUnitPrice: number; // Price per 1 of the selectedUnit
}

export function calculateItemPricing(params: {
  basePrice: number; // Price per 1 base unit
  baseUnit: string;
  quantity: number; // Quantity in selectedUnit
  selectedUnit: string;
  discount?: number;
  discountType?: 'FLAT' | 'PERCENT';
}): LinePriceCalculation {
  const {
    basePrice,
    baseUnit,
    quantity,
    selectedUnit,
    discount = 0,
    discountType = 'FLAT',
  } = params;

  if (quantity <= 0 || basePrice <= 0) {
    return {
      baseQuantity: 0,
      grossAmount: 0,
      discountAmount: 0,
      finalTotal: 0,
      effectiveUnitPrice: 0,
    };
  }

  const baseQuantity = convertToBaseUnit(quantity, selectedUnit, baseUnit);
  const ratioToBase = baseQuantity / quantity;
  const effectiveUnitPrice = roundCurrency(basePrice * ratioToBase);

  // Gross amount based on accurate baseQuantity * basePrice
  const grossAmount = roundCurrency(baseQuantity * basePrice);

  let discountAmount = 0;
  if (discount > 0) {
    if (discountType === 'PERCENT') {
      discountAmount = roundCurrency((grossAmount * Math.min(100, discount)) / 100);
    } else {
      discountAmount = roundCurrency(Math.min(grossAmount, discount));
    }
  }

  const finalTotal = roundCurrency(Math.max(0, grossAmount - discountAmount));

  return {
    baseQuantity,
    grossAmount,
    discountAmount,
    finalTotal,
    effectiveUnitPrice,
  };
}

/**
 * Helper to round decimals safely
 */
export function roundNumber(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Format quantity display cleanly (e.g. 1.5 KG, 500 GM, 19.84 KG)
 */
export function formatQuantityWithUnit(qty: number, unit: string): string {
  const norm = normalizeUnit(unit);
  const formattedQty = Number(roundNumber(qty, 3)).toString();
  return `${formattedQty} ${norm}`;
}
