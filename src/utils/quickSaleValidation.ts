import { z } from 'zod';
import { PaymentMethod, SaleItem } from '../types';

export const MAX_SALE_QUANTITY = 1_000_000;
export const MAX_SALE_AMOUNT = 100_000_000;
export const MAX_BILL_NOTES_LENGTH = 500;

export type QuickSaleFieldName =
  | 'product'
  | 'addQty'
  | 'directAmount'
  | 'items'
  | 'customer'
  | 'loyaltyPoints'
  | 'notes';

export type QuickSaleFieldErrors = Partial<Record<QuickSaleFieldName, string>>;

export const paymentMethodSchema = z.enum(['CASH', 'UPI', 'BANK', 'CREDIT']);

const finiteNumber = (label: string) =>
  z.number({ error: `${label} must be a valid number.` }).finite(`${label} must be a valid number.`);

export const saleItemSchema = z
  .object({
    lineId: z.string().optional(),
    productId: z.string().optional(),
    productName: z
      .string({ error: 'Product name is required.' })
      .trim()
      .min(1, 'Product name cannot be empty.'),
    quantity: finiteNumber('Quantity')
      .gt(0, 'Quantity must be greater than zero.')
      .lte(MAX_SALE_QUANTITY, `Quantity cannot exceed ${MAX_SALE_QUANTITY.toLocaleString('en-IN')}.`),
    unit: z
      .string({ error: 'Unit is required.' })
      .trim()
      .min(1, 'Unit cannot be empty.'),
    baseUnit: z.string().trim().min(1).optional(),
    baseQuantity: finiteNumber('Base quantity')
      .gt(0, 'Base quantity must be greater than zero.')
      .optional(),
    unitCostAtSale: finiteNumber('Unit cost')
      .min(0, 'Unit cost cannot be negative.')
      .optional(),
    costSnapshotSource: z
      .enum(['PRODUCT_PURCHASE_PRICE', 'LAST_PURCHASE_PRICE', 'ZERO_COST'])
      .optional(),
    costCapturedAt: z.string().optional(),
    rate: finiteNumber('Item price')
      .gt(0, 'Item price must be greater than ₹0.')
      .lte(MAX_SALE_AMOUNT, `Item price cannot exceed ₹${MAX_SALE_AMOUNT.toLocaleString('en-IN')}.`),
    discount: finiteNumber('Item discount')
      .min(0, 'Item discount cannot be negative.')
      .optional(),
    discountType: z.enum(['FLAT', 'PERCENT']).optional(),
    total: finiteNumber('Item total')
      .gt(0, 'Item total must be greater than ₹0.')
      .lte(MAX_SALE_AMOUNT, `Item total cannot exceed ₹${MAX_SALE_AMOUNT.toLocaleString('en-IN')}.`),
  })
  .superRefine((item, ctx) => {
    const lineGross = Math.round(item.quantity * item.rate * 100) / 100;
    const discount = item.discount ?? 0;
    if (discount > lineGross + 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['discount'],
        message: `Discount for "${item.productName}" cannot exceed the item price.`,
      });
    }
  });

export const quickAddProductInputSchema = z.object({
  productId: z.string().trim().min(1, 'Please choose a product to add.'),
  productName: z.string().trim().min(1, 'Selected product has no name.'),
  unit: z.string().trim().min(1, 'Selected product has no unit.'),
  quantity: finiteNumber('Quantity')
    .gt(0, 'Quantity must be greater than zero.')
    .lte(MAX_SALE_QUANTITY, `Quantity cannot exceed ${MAX_SALE_QUANTITY.toLocaleString('en-IN')}.`),
  rate: finiteNumber('Selling price')
    .gt(0, 'Product selling price must be greater than ₹0 before adding to bill.')
    .lte(MAX_SALE_AMOUNT, 'Product selling price exceeds maximum allowed limit.'),
});

export const directAmountSchema = finiteNumber('Direct sale amount')
  .gt(0, 'Direct sale amount must be greater than ₹0.')
  .lte(
    MAX_SALE_AMOUNT,
    `Direct sale amount cannot exceed ₹${MAX_SALE_AMOUNT.toLocaleString('en-IN')}.`
  );

export const loyaltyPointsRedeemSchema = finiteNumber('Loyalty points')
  .int('Loyalty points must be a whole number.')
  .min(0, 'Loyalty points cannot be negative.');

export const billNotesSchema = z
  .string()
  .max(
    MAX_BILL_NOTES_LENGTH,
    `Bill note must be ${MAX_BILL_NOTES_LENGTH} characters or fewer.`
  );

export interface QuickSaleSubmissionInput {
  paymentMethod: PaymentMethod;
  customerId?: string;
  items: SaleItem[];
  directAmountRaw: string;
  grossAmount: number;
  netAmount: number;
  loyaltyPointsRaw: string;
  maxRedeemablePoints: number;
  loyaltyEnabled: boolean;
  notes: string;
}

export const quickSaleSubmissionSchema = z
  .object({
    paymentMethod: paymentMethodSchema,
    customerId: z.string().trim().optional(),
    items: z.array(saleItemSchema),
    directAmountRaw: z.string(),
    grossAmount: finiteNumber('Gross bill amount')
      .gt(0, 'Bill total must be greater than ₹0.')
      .lte(MAX_SALE_AMOUNT, 'Bill total exceeds maximum allowed limit.'),
    netAmount: finiteNumber('Net payable amount')
      .gt(0, 'Net payable amount must be greater than ₹0.')
      .lte(MAX_SALE_AMOUNT, 'Net payable amount exceeds maximum allowed limit.'),
    loyaltyPointsRaw: z.string(),
    maxRedeemablePoints: z.number().int().min(0),
    loyaltyEnabled: z.boolean(),
    notes: billNotesSchema,
  })
  .superRefine((data, ctx) => {
    // When no itemized products exist, validate the raw direct counter amount strictly
    if (data.items.length === 0) {
      const trimmed = data.directAmountRaw.trim();
      if (!trimmed) {
        ctx.addIssue({
          code: 'custom',
          path: ['directAmount'],
          message: 'Please add at least one product or enter a positive direct sale amount.',
        });
      } else {
        const parsedDirect = parseStrictNumberInput(trimmed);
        if (parsedDirect === null || parsedDirect <= 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['directAmount'],
            message: 'Direct sale amount must be greater than ₹0.',
          });
        } else if (parsedDirect > MAX_SALE_AMOUNT) {
          ctx.addIssue({
            code: 'custom',
            path: ['directAmount'],
            message: `Direct sale amount cannot exceed ₹${MAX_SALE_AMOUNT.toLocaleString('en-IN')}.`,
          });
        }
      }
    }

    if (data.paymentMethod === 'CREDIT' && !data.customerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['customer'],
        message: 'Please select a customer for Credit (Udhar) sale.',
      });
    }

    const trimmedLoyalty = data.loyaltyPointsRaw.trim();
    if (trimmedLoyalty !== '') {
      const parsedPoints = parseStrictNumberInput(trimmedLoyalty);
      if (parsedPoints === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['loyaltyPoints'],
          message: 'Loyalty points must be a valid whole number.',
        });
      } else if (parsedPoints < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['loyaltyPoints'],
          message: 'Loyalty points cannot be negative.',
        });
      } else if (!Number.isInteger(parsedPoints)) {
        ctx.addIssue({
          code: 'custom',
          path: ['loyaltyPoints'],
          message: 'Loyalty points must be a whole number.',
        });
      } else if (parsedPoints > 0 && data.loyaltyEnabled && parsedPoints > data.maxRedeemablePoints) {
        ctx.addIssue({
          code: 'custom',
          path: ['loyaltyPoints'],
          message: `You can redeem at most ${data.maxRedeemablePoints} points on this bill.`,
        });
      }
    }
  });

/**
 * Parses a numeric input string strictly without silent fallback.
 * Returns null if blank, non-numeric, or non-finite.
 */
export function parseStrictNumberInput(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ValidationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors: QuickSaleFieldErrors;
}

function mapIssuePathToField(path: PropertyKey[]): QuickSaleFieldName | null {
  const first = path[0];
  if (first === 'productId' || first === 'productName' || first === 'rate' || first === 'unit') {
    return 'product';
  }
  if (first === 'quantity') return 'addQty';
  if (first === 'directAmount' || first === 'directAmountRaw') return 'directAmount';
  if (first === 'items') return 'items';
  if (first === 'customer' || first === 'customerId') return 'customer';
  if (first === 'loyaltyPoints' || first === 'loyaltyPointsRaw') return 'loyaltyPoints';
  if (first === 'notes') return 'notes';
  return null;
}

export const quickAddQuantitySchema = finiteNumber('Quantity')
  .gt(0, 'Quantity must be greater than zero.')
  .lte(MAX_SALE_QUANTITY, `Quantity cannot exceed ${MAX_SALE_QUANTITY.toLocaleString('en-IN')}.`);

export function validateQuickAddQuantityField(raw: string): ValidationResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      success: false,
      error: 'Quantity must be greater than zero.',
      fieldErrors: { addQty: 'Quantity must be greater than zero.' },
    };
  }
  const parsedNum = parseStrictNumberInput(trimmed);
  if (parsedNum === null) {
    return {
      success: false,
      error: 'Quantity must be a valid number.',
      fieldErrors: { addQty: 'Quantity must be a valid number.' },
    };
  }
  const result = quickAddQuantitySchema.safeParse(parsedNum);
  if (result.success) {
    return { success: true, data: result.data, fieldErrors: {} };
  }
  const msg = result.error.issues[0]?.message || 'Quantity must be greater than zero.';
  return {
    success: false,
    error: msg,
    fieldErrors: { addQty: msg },
  };
}

export function validateQuickAddProductInput(input: {
  productId: string;
  productName: string;
  unit: string;
  quantityRaw: string | number;
  rate: number;
}): ValidationResult<{ quantity: number; rate: number }> {
  const parsedQty = parseStrictNumberInput(input.quantityRaw);
  if (parsedQty === null) {
    return {
      success: false,
      error: 'Please enter a valid quantity greater than zero.',
      fieldErrors: { addQty: 'Enter a valid quantity greater than 0.' },
    };
  }

  const parsed = quickAddProductInputSchema.safeParse({
    productId: input.productId,
    productName: input.productName,
    unit: input.unit,
    quantity: parsedQty,
    rate: input.rate,
  });

  if (parsed.success) {
    return {
      success: true,
      data: { quantity: parsed.data.quantity, rate: parsed.data.rate },
      fieldErrors: {},
    };
  }

  const fieldErrors: QuickSaleFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = mapIssuePathToField(issue.path) ?? 'product';
    if (!fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return {
    success: false,
    error: parsed.error.issues[0]?.message || 'Invalid product entry.',
    fieldErrors,
  };
}

export function validateDirectAmountField(raw: string): ValidationResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      success: false,
      error: 'Direct sale amount must be greater than ₹0.',
      fieldErrors: { directAmount: 'Enter a sale amount greater than ₹0.' },
    };
  }

  const parsedNum = parseStrictNumberInput(trimmed);
  if (parsedNum === null) {
    return {
      success: false,
      error: 'Direct sale amount must be a valid number.',
      fieldErrors: { directAmount: 'Enter a valid numeric amount.' },
    };
  }

  const result = directAmountSchema.safeParse(parsedNum);
  if (result.success) {
    return { success: true, data: result.data, fieldErrors: {} };
  }

  const msg = result.error.issues[0]?.message || 'Direct sale amount must be greater than ₹0.';
  return {
    success: false,
    error: msg,
    fieldErrors: { directAmount: msg },
  };
}

export function validateLoyaltyPointsField(
  raw: string,
  maxRedeemablePoints?: number
): ValidationResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { success: true, data: 0, fieldErrors: {} };
  }

  const parsedNum = parseStrictNumberInput(trimmed);
  if (parsedNum === null) {
    const msg = 'Loyalty points must be a valid whole number.';
    return { success: false, error: msg, fieldErrors: { loyaltyPoints: msg } };
  }

  const result = loyaltyPointsRedeemSchema.safeParse(parsedNum);
  if (!result.success) {
    const msg = result.error.issues[0]?.message || 'Invalid loyalty points value.';
    return { success: false, error: msg, fieldErrors: { loyaltyPoints: msg } };
  }

  if (
    typeof maxRedeemablePoints === 'number' &&
    result.data > 0 &&
    result.data > maxRedeemablePoints
  ) {
    const msg = `You can redeem at most ${maxRedeemablePoints} points on this bill.`;
    return { success: false, error: msg, fieldErrors: { loyaltyPoints: msg } };
  }

  return { success: true, data: result.data, fieldErrors: {} };
}

export function validateBillNotesField(notes: string): ValidationResult<string> {
  const result = billNotesSchema.safeParse(notes);
  if (result.success) {
    return { success: true, data: result.data, fieldErrors: {} };
  }
  const msg = result.error.issues[0]?.message || 'Bill note is too long.';
  return { success: false, error: msg, fieldErrors: { notes: msg } };
}

export function validateCartItems(items: SaleItem[]): ValidationResult<SaleItem[]> {
  const parsed = z.array(saleItemSchema).safeParse(items);
  if (parsed.success) {
    return { success: true, data: items, fieldErrors: {} };
  }

  const firstIssue = parsed.error.issues[0];
  const itemIdx = typeof firstIssue?.path[0] === 'number' ? firstIssue.path[0] : null;
  const itemName =
    itemIdx !== null && items[itemIdx]?.productName
      ? `"${items[itemIdx].productName}"`
      : itemIdx !== null
      ? `Item #${itemIdx + 1}`
      : 'Cart item';

  const msg = firstIssue
    ? `${itemName}: ${firstIssue.message}`
    : 'One or more cart items have invalid quantity or price.';

  return {
    success: false,
    error: msg,
    fieldErrors: { items: msg },
  };
}

export function validateQuickSaleSubmission(
  input: QuickSaleSubmissionInput
): ValidationResult<QuickSaleSubmissionInput> {
  // Check raw direct amount first when cart is empty so zero/negative direct amount gets priority over generic grossAmount error
  if (input.items.length === 0) {
    const trimmed = input.directAmountRaw.trim();
    if (!trimmed) {
      const msg = 'Please add at least one product or enter a positive direct sale amount.';
      return {
        success: false,
        error: msg,
        fieldErrors: { directAmount: msg },
      };
    }
    const directRes = validateDirectAmountField(trimmed);
    if (!directRes.success) {
      return {
        success: false,
        error: directRes.error,
        fieldErrors: directRes.fieldErrors,
      };
    }
  }

  const parsed = quickSaleSubmissionSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: input, fieldErrors: {} };
  }

  const fieldErrors: QuickSaleFieldErrors = {};
  let primaryMessage: string | undefined;

  for (const issue of parsed.error.issues) {
    const field = mapIssuePathToField(issue.path);
    let message = issue.message;

    if (issue.path[0] === 'items' && typeof issue.path[1] === 'number') {
      const badItem = input.items[issue.path[1]];
      const label = badItem?.productName ? `"${badItem.productName}"` : `Item #${issue.path[1] + 1}`;
      message = `${label}: ${issue.message}`;
    }

    if (!primaryMessage) {
      primaryMessage = message;
    }
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = message;
    }
  }

  return {
    success: false,
    error: primaryMessage || 'Please fix the highlighted sale fields before generating the bill.',
    fieldErrors,
  };
}
