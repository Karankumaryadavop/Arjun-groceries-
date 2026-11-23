import {
  CustomerTransaction,
  Product,
  SaleItem,
  SaleItemCostSnapshotSource,
  SaleRecord,
  StockAdjustmentRecord,
} from '../types';
import { areUnitsCompatible, convertToBaseUnitStrict, formatQuantityWithUnit, normalizeUnit } from './units';

const FLOAT_TOLERANCE = 1e-9;

export interface StockValidationIssue {
  productId: string;
  productName: string;
  unit: string;
  availableQty: number;
  requestedQty: number;
  shortageQty: number;
}

export interface StockValidationResult {
  valid: boolean;
  error?: string;
  issues: StockValidationIssue[];
  aggregatedRequests: Map<string, number>;
}

export interface SkippedIncompatibleStockReturn {
  productId: string;
  productName: string;
  historicalUnit: string;
  historicalQuantity: number;
  catalogUnit: string;
  saleLineId?: string;
}

export interface StockMutationResult {
  success: boolean;
  error?: string;
  duplicate?: boolean;
  issues?: StockValidationIssue[];
  products: Product[];
  stockAdjustments: StockAdjustmentRecord[];
  addedAdjustments: StockAdjustmentRecord[];
  skippedIncompatibleItems?: SkippedIncompatibleStockReturn[];
}

export type ReturnSaleLineMatchStatus =
  | 'MATCHED_LINE'
  | 'AMBIGUOUS_SALE_LINE'
  | 'UNMATCHED_SALE_LINE'
  | 'CANCELLED_ORIGINAL_SALE'
  | 'UNLINKED';

export interface ReturnStockItemInput {
  productId?: string;
  productName: string;
  quantity: number;
  unit?: string;
  baseUnit?: string;
  baseQuantity?: number;
  unitCostAtSale?: number;
  saleLineId?: string;
  returnMatchStatus?: ReturnSaleLineMatchStatus;
  stockReconciliationStatus?: 'APPLIED' | 'SKIPPED_INCOMPATIBLE_UNIT';
}

export function roundStockQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  return Object.is(rounded, -0) || Math.abs(rounded) < 1e-9 ? 0 : rounded;
}

export function resolveProductUnitCostAtSale(product: Product): {
  unitCostAtSale: number;
  costSnapshotSource: SaleItemCostSnapshotSource;
} {
  const catalogCost = Number(product.purchasePrice);
  if (Number.isFinite(catalogCost) && catalogCost > 0) {
    return {
      unitCostAtSale: roundStockQty(catalogCost),
      costSnapshotSource: 'PRODUCT_PURCHASE_PRICE',
    };
  }
  const lastCost = Number(product.lastPurchasePrice);
  if (product.lastPurchasePrice !== undefined && Number.isFinite(lastCost) && lastCost > 0) {
    return {
      unitCostAtSale: roundStockQty(lastCost),
      costSnapshotSource: 'LAST_PURCHASE_PRICE',
    };
  }
  return {
    unitCostAtSale: 0,
    costSnapshotSource: 'ZERO_COST',
  };
}

/**
 * Normalizes new sale items with baseUnit, baseQuantity, and an immutable historical
 * unitCostAtSale snapshot captured at sale time so later catalog edits never mutate past COGS.
 */
export function buildSnapshottedSaleItems(
  items: SaleItem[],
  products: Product[],
  capturedAt: string = new Date().toISOString()
): SaleItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const productMap = new Map<string, Product>(products.map((p) => [p.id, p]));
  const batchToken = Date.now().toString(36);

  return items.map((item, idx) => {
    const stableLineId =
      item.lineId && item.lineId.trim()
        ? item.lineId.trim()
        : `sline-${idx + 1}-${batchToken}-${Math.random().toString(36).slice(2, 6)}`;

    const prod = item.productId ? productMap.get(item.productId) : undefined;
    if (!prod) {
      return {
        ...item,
        lineId: stableLineId,
      };
    }

    const effectiveBaseUnit = normalizeUnit(
      item.baseUnit && item.baseUnit.trim() ? item.baseUnit : prod.unit
    );
    const strictQty = resolveBaseQuantityStrict({
      quantity: Number(item.quantity) || 0,
      selectedUnit: item.unit || effectiveBaseUnit,
      baseUnit: effectiveBaseUnit,
      explicitBaseQuantity: item.baseQuantity,
    });
    const normalizedBaseQty = strictQty.valid ? strictQty.baseQuantity : undefined;

    const hasExistingSnapshot =
      item.unitCostAtSale !== undefined &&
      item.unitCostAtSale !== null &&
      Number.isFinite(Number(item.unitCostAtSale));

    const snapshot = hasExistingSnapshot
      ? {
          unitCostAtSale: roundStockQty(Math.max(0, Number(item.unitCostAtSale))),
          costSnapshotSource: item.costSnapshotSource || 'PRODUCT_PURCHASE_PRICE',
        }
      : resolveProductUnitCostAtSale(prod);

    return {
      ...item,
      lineId: stableLineId,
      baseUnit: effectiveBaseUnit,
      baseQuantity: normalizedBaseQty,
      unitCostAtSale: snapshot.unitCostAtSale,
      costSnapshotSource: snapshot.costSnapshotSource,
      costCapturedAt: item.costCapturedAt || capturedAt,
    };
  });
}

export interface SaleLineMatchResult {
  status: ReturnSaleLineMatchStatus;
  matchedSale?: SaleRecord;
  matchedLine?: SaleItem;
  candidateLines: SaleItem[];
  reason?: string;
}

function doesSaleLineMatchProduct(
  si: SaleItem,
  productId?: string,
  productName?: string
): boolean {
  if (productId && si.productId) {
    return si.productId === productId;
  }
  const cleanName = (productName || '').trim().toLowerCase();
  if (!cleanName) return false;
  return (si.productName || '').trim().toLowerCase() === cleanName;
}

/**
 * Matches a customer return item to its original active SaleRecord line.
 * - Prefers stable `saleLineId` when provided.
 * - Rejects matching against CANCELLED/REVERSED original sales.
 * - Refuses to silently pick candidateLines[0] when multiple lines for the same product
 *   exist on an invoice with ambiguous historical cost or base unit.
 */
export function matchOriginalSaleLine(params: {
  sales: SaleRecord[];
  invoiceNo?: string;
  saleLineId?: string;
  productId?: string;
  productName?: string;
}): SaleLineMatchResult {
  const { sales, invoiceNo, saleLineId, productId, productName } = params;
  const cleanInv = (invoiceNo || '').trim().toLowerCase();
  const cleanLineId = (saleLineId || '').trim();

  if (!cleanInv && !cleanLineId) {
    return { status: 'UNLINKED', candidateLines: [] };
  }

  let matchingSales: SaleRecord[] = [];
  if (cleanInv) {
    matchingSales = sales.filter(
      (s) => (s.invoiceNo || '').trim().toLowerCase() === cleanInv
    );
    if (matchingSales.length === 0) {
      return { status: 'UNLINKED', candidateLines: [] };
    }
  } else {
    // Only saleLineId provided without invoiceNo: find sales containing that lineId
    matchingSales = sales.filter((s) =>
      (s.items || []).some((si) => (si.lineId || '').trim() === cleanLineId)
    );
    if (matchingSales.length === 0) {
      return {
        status: 'UNMATCHED_SALE_LINE',
        candidateLines: [],
        reason: `Original sale line ID "${saleLineId}" was not found.`,
      };
    }
  }

  const activeSales = matchingSales.filter(
    (s) => s.status !== 'CANCELLED' && s.status !== 'REVERSED'
  );
  if (activeSales.length === 0) {
    return {
      status: 'CANCELLED_ORIGINAL_SALE',
      candidateLines: [],
      reason: invoiceNo
        ? `Original invoice #${invoiceNo} is cancelled or reversed.`
        : 'Original sale is cancelled or reversed.',
    };
  }

  if (cleanLineId) {
    const matches: Array<{ sale: SaleRecord; line: SaleItem }> = [];
    for (const s of activeSales) {
      for (const si of s.items || []) {
        if ((si.lineId || '').trim() === cleanLineId) {
          matches.push({ sale: s, line: si });
        }
      }
    }
    if (matches.length === 1) {
      const m = matches[0];
      if (productId && m.line.productId && m.line.productId !== productId) {
        return {
          status: 'UNMATCHED_SALE_LINE',
          matchedSale: m.sale,
          candidateLines: [],
          reason: `Sale line ID "${saleLineId}" belongs to a different product than returned.`,
        };
      }
      return {
        status: 'MATCHED_LINE',
        matchedSale: m.sale,
        matchedLine: m.line,
        candidateLines: [m.line],
      };
    }
    if (matches.length > 1) {
      return {
        status: 'AMBIGUOUS_SALE_LINE',
        matchedSale: activeSales[0],
        candidateLines: matches.map((m) => m.line),
        reason: `Multiple active sale lines share lineId "${saleLineId}".`,
      };
    }
    return {
      status: 'UNMATCHED_SALE_LINE',
      matchedSale: activeSales[0],
      candidateLines: [],
      reason: invoiceNo
        ? `Sale line ID "${saleLineId}" was not found on invoice #${invoiceNo}.`
        : `Sale line ID "${saleLineId}" was not found on active sales.`,
    };
  }

  if (activeSales.length > 1) {
    return {
      status: 'AMBIGUOUS_SALE_LINE',
      matchedSale: activeSales[0],
      candidateLines: [],
      reason: `Multiple active sales share invoice #${invoiceNo}; specify saleLineId.`,
    };
  }

  const origSale = activeSales[0];
  const candidateLines = (origSale.items || []).filter((si) =>
    doesSaleLineMatchProduct(si, productId, productName)
  );

  if (candidateLines.length === 0) {
    return {
      status: 'UNMATCHED_SALE_LINE',
      matchedSale: origSale,
      candidateLines: [],
      reason: `Product "${productName || productId || 'unknown'}" was not found on invoice #${origSale.invoiceNo}.`,
    };
  }

  if (candidateLines.length === 1) {
    return {
      status: 'MATCHED_LINE',
      matchedSale: origSale,
      matchedLine: candidateLines[0],
      candidateLines,
    };
  }

  // Multiple lines for the same product on the original invoice without a saleLineId:
  // Only allow unambiguous matching if EVERY candidate line has the exact same valid baseUnit & finite unitCostAtSale.
  const distinctBaseUnits = new Set<string>();
  const distinctCosts = new Set<number>();
  let allHaveBaseUnit = true;
  let allHaveCost = true;

  for (const cl of candidateLines) {
    const bu = (cl.baseUnit || '').trim();
    if (!bu) {
      allHaveBaseUnit = false;
    } else {
      distinctBaseUnits.add(normalizeUnit(bu));
    }

    const hasCost =
      cl.unitCostAtSale !== undefined &&
      cl.unitCostAtSale !== null &&
      Number.isFinite(Number(cl.unitCostAtSale));
    if (!hasCost) {
      allHaveCost = false;
    } else {
      distinctCosts.add(roundStockQty(Number(cl.unitCostAtSale)));
    }
  }

  const isUnambiguous =
    allHaveBaseUnit &&
    allHaveCost &&
    distinctBaseUnits.size === 1 &&
    distinctCosts.size === 1;

  if (!isUnambiguous) {
    return {
      status: 'AMBIGUOUS_SALE_LINE',
      matchedSale: origSale,
      candidateLines,
      reason: `Product appears ${candidateLines.length} times on invoice #${origSale.invoiceNo} with differing or missing historical unit/cost and no saleLineId.`,
    };
  }

  return {
    status: 'MATCHED_LINE',
    matchedSale: origSale,
    matchedLine: candidateLines[0],
    candidateLines,
  };
}

/**
 * Enriches customer sales return items with immutable historical `unitCostAtSale`,
 * `baseUnit`, `saleLineId`, and normalized `baseQuantity` from the linked original SaleRecord when uniquely matched.
 * Never guesses from candidateLines[0] on ambiguous multi-line invoices, never uses cancelled/reversed sales,
 * and never invents a historical baseUnit or cost from current catalog product settings.
 */
export function enrichCustomerReturnItemsWithSaleCost(params: {
  items: ReturnStockItemInput[];
  sales: SaleRecord[];
  products: Product[];
  invoiceNo?: string;
}): ReturnStockItemInput[] {
  const { items, sales, invoiceNo } = params;
  if (!Array.isArray(items) || items.length === 0) return [];

  return items.map((item) => {
    const match = matchOriginalSaleLine({
      sales,
      invoiceNo,
      saleLineId: item.saleLineId,
      productId: item.productId,
      productName: item.productName,
    });

    const matchedLine = match.status === 'MATCHED_LINE' ? match.matchedLine : undefined;

    const historicalBase =
      matchedLine?.baseUnit && matchedLine.baseUnit.trim()
        ? normalizeUnit(matchedLine.baseUnit)
        : match.status === 'UNLINKED' && item.baseUnit && item.baseUnit.trim()
        ? normalizeUnit(item.baseUnit)
        : matchedLine === undefined && match.status === 'MATCHED_LINE' && item.baseUnit && item.baseUnit.trim()
        ? normalizeUnit(item.baseUnit)
        : undefined;

    const strictQty = historicalBase
      ? resolveHistoricalBaseQuantityStrict({
          quantity: Number(item.quantity) || 0,
          selectedUnit: item.unit || historicalBase,
          historicalBaseUnit: historicalBase,
          explicitBaseQuantity: item.baseQuantity,
        })
      : { valid: false, baseUnit: '', baseQuantity: 0 };

    const hasOriginalCost =
      matchedLine &&
      matchedLine.unitCostAtSale !== undefined &&
      matchedLine.unitCostAtSale !== null &&
      Number.isFinite(Number(matchedLine.unitCostAtSale));

    const resolvedSaleLineId =
      item.saleLineId ||
      (match.status === 'MATCHED_LINE' && match.candidateLines.length === 1
        ? matchedLine?.lineId
        : undefined);

    const canPreserveInputCost =
      match.status === 'UNLINKED' || match.status === 'MATCHED_LINE';

    return {
      ...item,
      ...(resolvedSaleLineId ? { saleLineId: resolvedSaleLineId } : {}),
      returnMatchStatus: match.status,
      unit: item.unit || historicalBase || '',
      ...(historicalBase ? { baseUnit: historicalBase } : {}),
      ...(strictQty.valid
        ? { baseQuantity: strictQty.baseQuantity }
        : item.baseQuantity !== undefined
        ? { baseQuantity: item.baseQuantity }
        : {}),
      ...(canPreserveInputCost &&
      item.unitCostAtSale !== undefined &&
      Number.isFinite(Number(item.unitCostAtSale))
        ? { unitCostAtSale: roundStockQty(Math.max(0, Number(item.unitCostAtSale))) }
        : hasOriginalCost
        ? { unitCostAtSale: roundStockQty(Math.max(0, Number(matchedLine!.unitCostAtSale))) }
        : {}),
    };
  });
}

export interface CustomerReturnValidationResult {
  valid: boolean;
  error?: string;
  needsManualReview?: boolean;
  returnMatchStatus?: ReturnSaleLineMatchStatus;
  reviewReason?: string;
}

/**
 * Validates a customer sales return against its referenced original invoice:
 * - Blocks returns against CANCELLED or REVERSED original sales.
 * - Ignores CANCELLED or REVERSED prior returns when summing previously returned quantities.
 * - Prevents returned quantities from exceeding the remaining returnable quantity on the invoice/sale line.
 * - Flags ambiguous multi-line matches for manual review without guessing cost/unit.
 */
export function validateCustomerReturnAgainstSale(params: {
  sales: SaleRecord[];
  customerTransactions: CustomerTransaction[];
  products: Product[];
  invoiceNo?: string;
  items: ReturnStockItemInput[];
}): CustomerReturnValidationResult {
  const { sales, customerTransactions, products, invoiceNo, items } = params;
  const cleanInv = (invoiceNo || '').trim().toLowerCase();

  // Check for explicit saleLineId even if invoiceNo wasn't passed
  const hasExplicitLineId = items.some((it) => Boolean(it.saleLineId && it.saleLineId.trim()));
  if (!cleanInv && !hasExplicitLineId) {
    return { valid: true, returnMatchStatus: 'UNLINKED' };
  }

  let matchingSales: SaleRecord[] = [];
  if (cleanInv) {
    matchingSales = sales.filter(
      (s) => (s.invoiceNo || '').trim().toLowerCase() === cleanInv
    );
    if (matchingSales.length === 0) {
      return { valid: true, returnMatchStatus: 'UNLINKED' };
    }
  } else {
    const firstLineId = items.find((it) => it.saleLineId?.trim())?.saleLineId?.trim();
    matchingSales = sales.filter((s) =>
      (s.items || []).some((si) => (si.lineId || '').trim() === firstLineId)
    );
    if (matchingSales.length === 0) {
      return {
        valid: false,
        error: `Original sale line "${firstLineId}" was not found.`,
      };
    }
  }

  const activeSales = matchingSales.filter(
    (s) => s.status !== 'CANCELLED' && s.status !== 'REVERSED'
  );
  if (activeSales.length === 0) {
    return {
      valid: false,
      returnMatchStatus: 'CANCELLED_ORIGINAL_SALE',
      error: invoiceNo
        ? `Cannot record customer return: original bill #${invoiceNo} is cancelled or reversed.`
        : 'Cannot record customer return: original sale is cancelled or reversed.',
    };
  }

  if (items.length === 0) {
    return { valid: true, returnMatchStatus: 'MATCHED_LINE' };
  }

  const productMap = new Map<string, Product>(products.map((p) => [p.id, p]));
  const origSale = activeSales[0];
  const effectiveInvKey = (origSale.invoiceNo || invoiceNo || '').trim().toLowerCase();

  // Compute sold quantities on origSale per line and per productKey in their historical base unit (or legacy catalog fallback for cap check only)
  const resolveSoldLineQty = (
    si: SaleItem
  ): { valid: boolean; baseUnit: string; baseQuantity: number } => {
    const bu = (si.baseUnit || '').trim();
    if (bu) {
      const r = resolveHistoricalBaseQuantityStrict({
        quantity: Number(si.quantity) || 0,
        selectedUnit: si.unit,
        historicalBaseUnit: bu,
        explicitBaseQuantity: si.baseQuantity,
      });
      return { valid: r.valid, baseUnit: r.baseUnit, baseQuantity: r.baseQuantity };
    }
    const fallbackUnit =
      (si.productId && productMap.get(si.productId)?.unit) || si.unit || '';
    if (!fallbackUnit) {
      return { valid: false, baseUnit: '', baseQuantity: 0 };
    }
    const r = resolveBaseQuantityStrict({
      quantity: Number(si.quantity) || 0,
      selectedUnit: si.unit || fallbackUnit,
      baseUnit: fallbackUnit,
      explicitBaseQuantity: si.baseQuantity,
    });
    return { valid: r.valid, baseUnit: normalizeUnit(fallbackUnit), baseQuantity: r.baseQuantity };
  };

  const getProdKey = (productId?: string, productName?: string) =>
    productId && productId.trim()
      ? `id:${productId.trim()}`
      : `name:${(productName || '').trim().toLowerCase()}`;

  const soldByLineId = new Map<string, { baseUnit: string; qty: number; line: SaleItem }>();
  const soldLinesByProdKey = new Map<string, SaleItem[]>();

  for (let i = 0; i < (origSale.items || []).length; i++) {
    const si = origSale.items[i];
    const lineKey = (si.lineId || `__idx_${i}`).trim();
    const resolved = resolveSoldLineQty(si);
    if (resolved.valid) {
      soldByLineId.set(lineKey, {
        baseUnit: resolved.baseUnit,
        qty: resolved.baseQuantity,
        line: si,
      });
    }
    const pk = getProdKey(si.productId, si.productName);
    const list = soldLinesByProdKey.get(pk) || [];
    list.push(si);
    soldLinesByProdKey.set(pk, list);
  }

  // Gather prior COMPLETED/active returns against this invoice (strictly exclude CANCELLED/REVERSED returns)
  const priorReturnedByLineId = new Map<string, number>();
  const priorReturnedByProdKeyUnit = new Map<string, number>(); // key: `${pk}::${baseUnit}`

  for (const prevTx of customerTransactions) {
    if (prevTx.status === 'CANCELLED' || prevTx.status === 'REVERSED') continue;
    if (prevTx.type !== 'RETURN') continue;
    const txInv = (prevTx.invoiceNo || '').trim().toLowerCase();
    const matchesInv = effectiveInvKey && txInv === effectiveInvKey;
    const prevItems =
      prevTx.items && prevTx.items.length > 0
        ? prevTx.items.map((pi) => ({
            productId: pi.productId,
            productName: pi.productName,
            quantity: Number(pi.quantity) || 0,
            unit: pi.unit,
            baseUnit: pi.baseUnit,
            baseQuantity: pi.baseQuantity,
            saleLineId: pi.saleLineId || prevTx.saleLineId,
          }))
        : prevTx.productId && prevTx.quantity && prevTx.quantity > 0
        ? [
            {
              productId: prevTx.productId,
              productName: productMap.get(prevTx.productId)?.name || '',
              quantity: Number(prevTx.quantity),
              unit: prevTx.unit || '',
              baseUnit: prevTx.baseUnit,
              baseQuantity: prevTx.baseQuantity,
              saleLineId: prevTx.saleLineId,
            },
          ]
        : [];

    for (const pi of prevItems) {
      const hasMatchingLineId =
        pi.saleLineId && soldByLineId.has(pi.saleLineId.trim());
      if (!matchesInv && !hasMatchingLineId) continue;

      const pk = getProdKey(pi.productId, pi.productName);
      const lineCandidates = soldLinesByProdKey.get(pk) || [];
      const targetLine = hasMatchingLineId
        ? soldByLineId.get(pi.saleLineId!.trim())
        : lineCandidates.length === 1 && lineCandidates[0].lineId
        ? soldByLineId.get(lineCandidates[0].lineId.trim())
        : undefined;

      const effectiveBu =
        (pi.baseUnit || '').trim() ||
        targetLine?.baseUnit ||
        (lineCandidates.length > 0 ? resolveSoldLineQty(lineCandidates[0]).baseUnit : '');
      if (!effectiveBu) continue;

      const prevStrict = resolveBaseQuantityStrict({
        quantity: pi.quantity,
        selectedUnit: pi.unit || effectiveBu,
        baseUnit: effectiveBu,
        explicitBaseQuantity: pi.baseQuantity,
      });
      if (!prevStrict.valid) continue;

      if (hasMatchingLineId) {
        const lid = pi.saleLineId!.trim();
        priorReturnedByLineId.set(
          lid,
          roundStockQty((priorReturnedByLineId.get(lid) || 0) + prevStrict.baseQuantity)
        );
      } else if (lineCandidates.length === 1 && lineCandidates[0].lineId) {
        const lid = lineCandidates[0].lineId.trim();
        priorReturnedByLineId.set(
          lid,
          roundStockQty((priorReturnedByLineId.get(lid) || 0) + prevStrict.baseQuantity)
        );
      }

      const normBu = normalizeUnit(effectiveBu);
      // Credit against compatible sold units for this product
      const compatibleSoldUnits = new Set<string>();
      for (const cl of lineCandidates) {
        const r = resolveSoldLineQty(cl);
        if (r.valid && areUnitsCompatible(normBu, r.baseUnit)) {
          compatibleSoldUnits.add(r.baseUnit);
        }
      }
      if (compatibleSoldUnits.size === 0) {
        compatibleSoldUnits.add(normBu);
      }
      for (const sbu of compatibleSoldUnits) {
        const conv = convertToBaseUnitStrict(prevStrict.baseQuantity, normBu, sbu);
        if (conv.valid) {
          const mapKey = `${pk}::${sbu}`;
          priorReturnedByProdKeyUnit.set(
            mapKey,
            roundStockQty((priorReturnedByProdKeyUnit.get(mapKey) || 0) + conv.baseQuantity)
          );
        }
      }
    }
  }

  // Track cumulative requested quantities within this single return payload
  const reqByLineId = new Map<string, number>();
  const reqByProdKeyUnit = new Map<string, number>();

  let needsManualReview = false;
  let reviewStatus: ReturnSaleLineMatchStatus = 'MATCHED_LINE';
  const reviewReasons: string[] = [];

  for (const item of items) {
    const match = matchOriginalSaleLine({
      sales,
      invoiceNo: origSale.invoiceNo,
      saleLineId: item.saleLineId,
      productId: item.productId,
      productName: item.productName,
    });

    if (match.status === 'CANCELLED_ORIGINAL_SALE') {
      return {
        valid: false,
        returnMatchStatus: 'CANCELLED_ORIGINAL_SALE',
        error: match.reason || 'Original invoice is cancelled or reversed.',
      };
    }

    if (match.status === 'UNMATCHED_SALE_LINE') {
      return {
        valid: false,
        returnMatchStatus: 'UNMATCHED_SALE_LINE',
        error:
          match.reason ||
          `Item "${item.productName}" does not match any sold line on invoice #${origSale.invoiceNo}.`,
      };
    }

    if (item.saleLineId && match.matchedLine) {
      const lid = (match.matchedLine.lineId || item.saleLineId).trim();
      const soldEntry = soldByLineId.get(lid);
      if (!soldEntry) {
        return {
          valid: false,
          error: `Could not verify original sold quantity for line "${lid}" on invoice #${origSale.invoiceNo}.`,
        };
      }
      const reqCheck = resolveBaseQuantityStrict({
        quantity: Number(item.quantity) || 0,
        selectedUnit: item.unit || soldEntry.baseUnit,
        baseUnit: soldEntry.baseUnit,
        explicitBaseQuantity: item.baseQuantity,
      });
      if (!reqCheck.valid || reqCheck.baseQuantity <= 0) {
        return {
          valid: false,
          error:
            reqCheck.error ||
            `Return unit "${item.unit}" is incompatible with original line unit "${soldEntry.baseUnit}".`,
        };
      }

      const priorLine = priorReturnedByLineId.get(lid) || 0;
      const newLineTotal = roundStockQty((reqByLineId.get(lid) || 0) + reqCheck.baseQuantity);
      const lineRemaining = roundStockQty(Math.max(0, soldEntry.qty - priorLine));

      if (newLineTotal - lineRemaining > FLOAT_TOLERANCE) {
        return {
          valid: false,
          error: `Return quantity (${formatQuantityWithUnit(
            newLineTotal,
            soldEntry.baseUnit
          )}) exceeds remaining returnable quantity (${formatQuantityWithUnit(
            lineRemaining,
            soldEntry.baseUnit
          )}) for "${item.productName}" on invoice #${origSale.invoiceNo} (Sold: ${formatQuantityWithUnit(
            soldEntry.qty,
            soldEntry.baseUnit
          )}, Previously returned: ${formatQuantityWithUnit(priorLine, soldEntry.baseUnit)}).`,
        };
      }
      reqByLineId.set(lid, newLineTotal);

      // Also verify aggregate product-on-invoice cap
      const pk = getProdKey(item.productId || match.matchedLine.productId, item.productName || match.matchedLine.productName);
      const candidates = soldLinesByProdKey.get(pk) || [match.matchedLine];
      let totalSoldCompat = 0;
      for (const cl of candidates) {
        const sr = resolveSoldLineQty(cl);
        if (sr.valid && areUnitsCompatible(sr.baseUnit, soldEntry.baseUnit)) {
          const conv = convertToBaseUnitStrict(sr.baseQuantity, sr.baseUnit, soldEntry.baseUnit);
          if (conv.valid) totalSoldCompat = roundStockQty(totalSoldCompat + conv.baseQuantity);
        }
      }
      const mapKey = `${pk}::${soldEntry.baseUnit}`;
      const priorProd = priorReturnedByProdKeyUnit.get(mapKey) || 0;
      const newProdTotal = roundStockQty((reqByProdKeyUnit.get(mapKey) || 0) + reqCheck.baseQuantity);
      const prodRemaining = roundStockQty(Math.max(0, totalSoldCompat - priorProd));
      if (newProdTotal - prodRemaining > FLOAT_TOLERANCE) {
        return {
          valid: false,
          error: `Cumulative returned quantity (${formatQuantityWithUnit(
            newProdTotal,
            soldEntry.baseUnit
          )}) exceeds remaining sold quantity (${formatQuantityWithUnit(
            prodRemaining,
            soldEntry.baseUnit
          )}) for "${item.productName}" on invoice #${origSale.invoiceNo}.`,
        };
      }
      reqByProdKeyUnit.set(mapKey, newProdTotal);
    } else {
      // Matched single line without saleLineId OR ambiguous multi-line without saleLineId
      if (match.status === 'AMBIGUOUS_SALE_LINE') {
        needsManualReview = true;
        reviewStatus = 'AMBIGUOUS_SALE_LINE';
        if (match.reason) reviewReasons.push(match.reason);
      }

      const pk = getProdKey(item.productId, item.productName);
      const candidates =
        match.candidateLines.length > 0
          ? match.candidateLines
          : soldLinesByProdKey.get(pk) || [];

      if (candidates.length === 0) {
        return {
          valid: false,
          error: `Product "${item.productName}" was not sold on invoice #${origSale.invoiceNo}.`,
        };
      }

      // Find candidate lines compatible with requested return unit
      const resolvedCandidates = candidates
        .map((cl) => ({ cl, r: resolveSoldLineQty(cl) }))
        .filter((x) => x.r.valid);

      const selectedUnit = (item.unit || resolvedCandidates[0]?.r.baseUnit || '').trim();
      const compatCandidates = resolvedCandidates.filter((x) =>
        selectedUnit ? areUnitsCompatible(selectedUnit, x.r.baseUnit) : true
      );

      if (compatCandidates.length === 0) {
        const expectedUnits = Array.from(new Set(resolvedCandidates.map((x) => x.r.baseUnit))).join(', ');
        return {
          valid: false,
          error: `Return unit "${item.unit || 'unknown'}" is incompatible with original invoice unit(s) (${expectedUnits}) for "${item.productName}".`,
        };
      }

      const targetBaseUnit = compatCandidates[0].r.baseUnit;
      const reqCheck = resolveBaseQuantityStrict({
        quantity: Number(item.quantity) || 0,
        selectedUnit: selectedUnit || targetBaseUnit,
        baseUnit: targetBaseUnit,
        explicitBaseQuantity: item.baseQuantity,
      });
      if (!reqCheck.valid || reqCheck.baseQuantity <= 0) {
        return {
          valid: false,
          error: reqCheck.error || `Invalid return quantity for "${item.productName}".`,
        };
      }

      let totalSoldCompat = 0;
      for (const c of compatCandidates) {
        const conv = convertToBaseUnitStrict(c.r.baseQuantity, c.r.baseUnit, targetBaseUnit);
        if (conv.valid) {
          totalSoldCompat = roundStockQty(totalSoldCompat + conv.baseQuantity);
        }
      }

      const mapKey = `${pk}::${targetBaseUnit}`;
      const priorProd = priorReturnedByProdKeyUnit.get(mapKey) || 0;
      const newProdTotal = roundStockQty((reqByProdKeyUnit.get(mapKey) || 0) + reqCheck.baseQuantity);
      const prodRemaining = roundStockQty(Math.max(0, totalSoldCompat - priorProd));

      if (newProdTotal - prodRemaining > FLOAT_TOLERANCE) {
        return {
          valid: false,
          error: `Return quantity (${formatQuantityWithUnit(
            newProdTotal,
            targetBaseUnit
          )}) exceeds remaining returnable quantity (${formatQuantityWithUnit(
            prodRemaining,
            targetBaseUnit
          )}) for "${item.productName}" on invoice #${origSale.invoiceNo} (Sold: ${formatQuantityWithUnit(
            totalSoldCompat,
            targetBaseUnit
          )}, Previously returned: ${formatQuantityWithUnit(priorProd, targetBaseUnit)}).`,
        };
      }
      reqByProdKeyUnit.set(mapKey, newProdTotal);
    }
  }

  return {
    valid: true,
    needsManualReview,
    returnMatchStatus: reviewStatus,
    reviewReason: reviewReasons.length > 0 ? reviewReasons.join(' | ') : undefined,
  };
}

export interface HistoricalBaseQuantityResult {
  valid: boolean;
  baseUnit: string;
  baseQuantity: number;
  reason?:
    | 'MISSING_HISTORICAL_BASE_UNIT'
    | 'MISSING_SELECTED_UNIT'
    | 'INCOMPATIBLE_UNITS'
    | 'INVALID_QUANTITY';
  error?: string;
}

/**
 * Resolves a historical transaction line's base quantity strictly against its own
 * recorded historical `baseUnit`. Never uses current catalog `product.unit` and never
 * guesses a baseUnit when historical unit metadata is missing.
 */
export function resolveHistoricalBaseQuantityStrict(params: {
  quantity: number;
  selectedUnit?: string;
  historicalBaseUnit?: string;
  explicitBaseQuantity?: number;
}): HistoricalBaseQuantityResult {
  const rawHistoricalBase = (params.historicalBaseUnit || '').trim();
  if (!rawHistoricalBase) {
    return {
      valid: false,
      baseUnit: '',
      baseQuantity: 0,
      reason: 'MISSING_HISTORICAL_BASE_UNIT',
      error: 'Missing historical baseUnit; cannot reconstruct historical quantity without guessing.',
    };
  }

  const normBaseUnit = normalizeUnit(rawHistoricalBase);
  const rawSelected = (params.selectedUnit || '').trim();

  if (
    params.explicitBaseQuantity !== undefined &&
    Number.isFinite(params.explicitBaseQuantity) &&
    params.explicitBaseQuantity > 0
  ) {
    if (rawSelected && !areUnitsCompatible(rawSelected, normBaseUnit)) {
      return {
        valid: false,
        baseUnit: normBaseUnit,
        baseQuantity: 0,
        reason: 'INCOMPATIBLE_UNITS',
        error: `Incompatible historical units: item unit "${rawSelected}" cannot convert to historical baseUnit "${normBaseUnit}".`,
      };
    }
    return {
      valid: true,
      baseUnit: normBaseUnit,
      baseQuantity: roundStockQty(params.explicitBaseQuantity),
    };
  }

  if (!rawSelected) {
    return {
      valid: false,
      baseUnit: normBaseUnit,
      baseQuantity: 0,
      reason: 'MISSING_SELECTED_UNIT',
      error: 'Missing historical item selling unit for base-unit conversion.',
    };
  }

  const unitCheck = convertToBaseUnitStrict(
    Number(params.quantity) || 0,
    rawSelected,
    normBaseUnit
  );
  if (!unitCheck.valid) {
    return {
      valid: false,
      baseUnit: normBaseUnit,
      baseQuantity: 0,
      reason: Number(params.quantity) > 0 ? 'INCOMPATIBLE_UNITS' : 'INVALID_QUANTITY',
      error: unitCheck.error,
    };
  }

  return {
    valid: true,
    baseUnit: normBaseUnit,
    baseQuantity: roundStockQty(unitCheck.baseQuantity),
  };
}

export function resolveBaseQuantityStrict(params: {
  quantity: number;
  selectedUnit: string | undefined;
  baseUnit: string;
  explicitBaseQuantity?: number;
}): { valid: boolean; baseQuantity: number; error?: string } {
  const effectiveSelected = params.selectedUnit || params.baseUnit;
  const unitCheck = convertToBaseUnitStrict(
    Number(params.quantity) || 0,
    effectiveSelected,
    params.baseUnit
  );
  if (!unitCheck.valid) {
    return {
      valid: false,
      baseQuantity: 0,
      error: unitCheck.error,
    };
  }
  if (
    params.explicitBaseQuantity !== undefined &&
    Number.isFinite(params.explicitBaseQuantity) &&
    params.explicitBaseQuantity > 0
  ) {
    return {
      valid: true,
      baseQuantity: roundStockQty(params.explicitBaseQuantity),
    };
  }
  return {
    valid: true,
    baseQuantity: roundStockQty(unitCheck.baseQuantity),
  };
}

export function resolveBaseQuantity(
  quantity: number,
  selectedUnit: string | undefined,
  baseUnit: string,
  explicitBaseQuantity?: number
): number {
  const strict = resolveBaseQuantityStrict({
    quantity,
    selectedUnit,
    baseUnit,
    explicitBaseQuantity,
  });
  return strict.valid ? strict.baseQuantity : 0;
}

function buildAdjustmentId(): string {
  return `adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

export function validateSaleStock(params: {
  items: SaleItem[];
  products: Product[];
  allowNegativeStock?: boolean;
}): StockValidationResult {
  const { items, products, allowNegativeStock = false } = params;
  const productMap = new Map(products.map((p) => [p.id, p]));
  const aggregatedRequests = new Map<string, number>();
  const issues: StockValidationIssue[] = [];

  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return {
        valid: false,
        error: `Quantity for "${item.productName}" must be greater than zero.`,
        issues: [],
        aggregatedRequests,
      };
    }

    if (!item.productId) {
      // Custom ad-hoc item without an inventory SKU
      continue;
    }

    const prod = productMap.get(item.productId);
    if (!prod) {
      return {
        valid: false,
        error: `Product "${item.productName}" was not found in inventory.`,
        issues: [],
        aggregatedRequests,
      };
    }

    const strictQty = resolveBaseQuantityStrict({
      quantity: qty,
      selectedUnit: item.unit,
      baseUnit: prod.unit,
      explicitBaseQuantity: item.baseQuantity,
    });
    if (!strictQty.valid || strictQty.baseQuantity <= 0) {
      return {
        valid: false,
        error: strictQty.error || `Converted stock quantity for "${prod.name}" must be greater than zero.`,
        issues: [],
        aggregatedRequests,
      };
    }

    const prevReq = aggregatedRequests.get(prod.id) || 0;
    aggregatedRequests.set(prod.id, roundStockQty(prevReq + strictQty.baseQuantity));
  }

  if (!allowNegativeStock) {
    for (const [productId, requestedQty] of aggregatedRequests.entries()) {
      const prod = productMap.get(productId);
      if (!prod) continue;
      const availableQty = roundStockQty(Number(prod.stockQty) || 0);
      if (requestedQty - availableQty > FLOAT_TOLERANCE) {
        const shortageQty = roundStockQty(requestedQty - availableQty);
        issues.push({
          productId: prod.id,
          productName: prod.name,
          unit: prod.unit,
          availableQty,
          requestedQty,
          shortageQty,
        });
      }
    }
  }

  if (issues.length > 0) {
    const details = issues
      .map(
        (iss) =>
          `${iss.productName} (Available: ${formatQuantityWithUnit(
            iss.availableQty,
            iss.unit
          )}, Requested: ${formatQuantityWithUnit(iss.requestedQty, iss.unit)})`
      )
      .join('; ');
    return {
      valid: false,
      error: `Insufficient stock: ${details}.`,
      issues,
      aggregatedRequests,
    };
  }

  return {
    valid: true,
    issues: [],
    aggregatedRequests,
  };
}

export function applySaleStockDeduction(params: {
  products: Product[];
  stockAdjustments: StockAdjustmentRecord[];
  items: SaleItem[];
  saleId: string;
  invoiceNo: string;
  date: string;
  allowNegativeStock?: boolean;
  idempotencyKey?: string;
}): StockMutationResult {
  const {
    products,
    stockAdjustments,
    items,
    saleId,
    invoiceNo,
    date,
    allowNegativeStock = false,
    idempotencyKey,
  } = params;

  if (
    idempotencyKey &&
    stockAdjustments.some(
      (adj) =>
        adj.idempotencyKey === idempotencyKey &&
        (adj.referenceType === 'SALE' || adj.source === 'SALE')
    )
  ) {
    return {
      success: false,
      duplicate: true,
      error: `Duplicate stock deduction prevented for sale #${invoiceNo}.`,
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const validation = validateSaleStock({ items, products, allowNegativeStock });
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      issues: validation.issues,
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const nowIso = new Date().toISOString();
  const dateKey = (date || nowIso).split('T')[0];
  const workingMap = new Map<string, Product>(products.map((p) => [p.id, { ...p }]));
  const addedAdjustments: StockAdjustmentRecord[] = [];

  for (const item of items) {
    if (!item.productId) continue;
    const prod = workingMap.get(item.productId);
    if (!prod) continue;

    const strictDeduction = resolveBaseQuantityStrict({
      quantity: Number(item.quantity),
      selectedUnit: item.unit,
      baseUnit: prod.unit,
      explicitBaseQuantity: item.baseQuantity,
    });
    if (!strictDeduction.valid || strictDeduction.baseQuantity <= 0) {
      return {
        success: false,
        error: strictDeduction.error || `Invalid unit or quantity for ${prod.name}.`,
        products,
        stockAdjustments,
        addedAdjustments: [],
      };
    }
    const deductionQty = strictDeduction.baseQuantity;

    const prevQty = roundStockQty(Number(prod.stockQty) || 0);
    const newQty = roundStockQty(prevQty - deductionQty);

    if (!allowNegativeStock && newQty < -FLOAT_TOLERANCE) {
      return {
        success: false,
        error: `Insufficient stock for ${prod.name}: Available ${formatQuantityWithUnit(
          prevQty,
          prod.unit
        )}, Requested ${formatQuantityWithUnit(deductionQty, prod.unit)}.`,
        products,
        stockAdjustments,
        addedAdjustments: [],
      };
    }

    const updatedProd: Product = {
      ...prod,
      stockQty: newQty,
      updatedAt: nowIso,
    };
    workingMap.set(prod.id, updatedProd);

    addedAdjustments.push({
      id: buildAdjustmentId(),
      productId: prod.id,
      productName: prod.name,
      unit: prod.unit,
      type: 'REDUCE',
      quantityChange: roundStockQty(-deductionQty),
      previousStock: prevQty,
      newStock: newQty,
      reason: `Sold in bill #${invoiceNo} (${formatQuantityWithUnit(item.quantity, item.unit)})`,
      date: dateKey,
      source: 'SALE',
      referenceId: saleId,
      referenceType: 'SALE',
      idempotencyKey,
      createdAt: nowIso,
    });
  }

  const nextProducts = products.map((p) => workingMap.get(p.id) || p);
  const nextAdjustments =
    addedAdjustments.length > 0
      ? [...addedAdjustments.reverse(), ...stockAdjustments]
      : stockAdjustments;

  return {
    success: true,
    products: nextProducts,
    stockAdjustments: nextAdjustments,
    addedAdjustments,
  };
}

export function applyPurchaseStockIncrease(params: {
  products: Product[];
  stockAdjustments: StockAdjustmentRecord[];
  productId: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  supplierName: string;
  invoiceNo?: string;
  referenceId: string;
  date: string;
  preferredSupplierPatch?: {
    preferredSupplierId: string;
    preferredSupplierName: string;
    preferredSupplierPhone: string;
  };
  idempotencyKey?: string;
}): StockMutationResult {
  const {
    products,
    stockAdjustments,
    productId,
    quantity,
    unit,
    unitPrice,
    supplierName,
    invoiceNo,
    referenceId,
    date,
    preferredSupplierPatch,
    idempotencyKey,
  } = params;

  if (
    idempotencyKey &&
    stockAdjustments.some(
      (adj) =>
        adj.idempotencyKey === idempotencyKey &&
        (adj.referenceType === 'PURCHASE' || adj.source === 'PURCHASE')
    )
  ) {
    return {
      success: false,
      duplicate: true,
      error: 'Duplicate purchase stock addition prevented.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const prod = products.find((p) => p.id === productId);
  if (!prod) {
    return {
      success: false,
      error: 'Selected product was not found in inventory.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const strictPurchaseQty = resolveBaseQuantityStrict({
    quantity,
    selectedUnit: unit,
    baseUnit: prod.unit,
  });
  if (!strictPurchaseQty.valid || strictPurchaseQty.baseQuantity <= 0) {
    return {
      success: false,
      error: strictPurchaseQty.error || 'Purchase quantity must be greater than zero.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }
  const baseQty = strictPurchaseQty.baseQuantity;

  const nowIso = new Date().toISOString();
  const dateKey = (date || nowIso).split('T')[0];
  const prevQty = roundStockQty(Number(prod.stockQty) || 0);
  const newQty = roundStockQty(prevQty + baseQty);

  const nextProducts = products.map((p) => {
    if (p.id !== prod.id) return p;
    return {
      ...p,
      stockQty: newQty,
      ...(unitPrice !== undefined && Number.isFinite(unitPrice)
        ? { lastPurchasePrice: unitPrice, lastPurchaseDate: dateKey }
        : {}),
      ...(preferredSupplierPatch || {}),
      updatedAt: nowIso,
    };
  });

  const adjRecord: StockAdjustmentRecord = {
    id: buildAdjustmentId(),
    productId: prod.id,
    productName: prod.name,
    unit: prod.unit,
    type: 'ADD',
    quantityChange: baseQty,
    previousStock: prevQty,
    newStock: newQty,
    reason: `Purchase from ${supplierName}${invoiceNo ? ` (#${invoiceNo.trim()})` : ''}`,
    date: dateKey,
    source: 'PURCHASE',
    referenceId,
    referenceType: 'PURCHASE',
    idempotencyKey,
    createdAt: nowIso,
  };

  return {
    success: true,
    products: nextProducts,
    stockAdjustments: [adjRecord, ...stockAdjustments],
    addedAdjustments: [adjRecord],
  };
}

export function applySalesReturnStockIncrease(params: {
  products: Product[];
  stockAdjustments: StockAdjustmentRecord[];
  items: ReturnStockItemInput[];
  customerName: string;
  invoiceNo?: string;
  referenceId: string;
  date: string;
  reason?: string;
  idempotencyKey?: string;
}): StockMutationResult {
  const {
    products,
    stockAdjustments,
    items,
    customerName,
    invoiceNo,
    referenceId,
    date,
    reason,
    idempotencyKey,
  } = params;

  if (
    idempotencyKey &&
    stockAdjustments.some(
      (adj) =>
        adj.idempotencyKey === idempotencyKey &&
        (adj.referenceType === 'SALES_RETURN' || adj.source === 'SALES_RETURN')
    )
  ) {
    return {
      success: false,
      duplicate: true,
      error: 'Duplicate sales return stock adjustment prevented.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const nowIso = new Date().toISOString();
  const dateKey = (date || nowIso).split('T')[0];
  const workingMap = new Map<string, Product>(products.map((p) => [p.id, { ...p }]));
  const addedAdjustments: StockAdjustmentRecord[] = [];
  const skippedIncompatibleItems: SkippedIncompatibleStockReturn[] = [];

  for (const item of items) {
    if (!item.productId) continue;
    const prod = workingMap.get(item.productId);
    if (!prod) {
      return {
        success: false,
        error: `Returned product "${item.productName}" was not found in inventory.`,
        products,
        stockAdjustments,
        addedAdjustments: [],
      };
    }

    // Validate historical unit compatibility first when a historical baseUnit was carried from a linked sale
    const hasHistoricalBase = Boolean(item.baseUnit && item.baseUnit.trim());
    if (hasHistoricalBase) {
      const histCheck = resolveHistoricalBaseQuantityStrict({
        quantity: Number(item.quantity),
        selectedUnit: item.unit || item.baseUnit,
        historicalBaseUnit: item.baseUnit,
        explicitBaseQuantity: item.baseQuantity,
      });
      if (!histCheck.valid || histCheck.baseQuantity <= 0) {
        return {
          success: false,
          error: histCheck.error || `Return quantity for "${prod.name}" must be greater than zero.`,
          products,
          stockAdjustments,
          addedAdjustments: [],
        };
      }
      // If product catalog unit was later edited to an incompatible unit (e.g. KG -> BAG),
      // preserve financial return accuracy without corrupting BAG stock count, AND record
      // a zero-qty-change reconciliation entry in stockAdjustments for full auditability.
      if (!areUnitsCompatible(histCheck.baseUnit, prod.unit)) {
        const currentQty = roundStockQty(Number(prod.stockQty) || 0);
        skippedIncompatibleItems.push({
          productId: prod.id,
          productName: prod.name,
          historicalUnit: histCheck.baseUnit,
          historicalQuantity: histCheck.baseQuantity,
          catalogUnit: prod.unit,
          saleLineId: item.saleLineId,
        });
        addedAdjustments.push({
          id: buildAdjustmentId(),
          productId: prod.id,
          productName: prod.name,
          unit: prod.unit,
          type: 'ADD',
          quantityChange: 0,
          previousStock: currentQty,
          newStock: currentQty,
          reconciliationStatus: 'SKIPPED_INCOMPATIBLE_UNIT',
          historicalUnit: histCheck.baseUnit,
          historicalQuantity: histCheck.baseQuantity,
          ...(item.saleLineId ? { saleLineId: item.saleLineId } : {}),
          reason: `Reconciliation required: Sales return from ${customerName}${
            invoiceNo ? ` (#${invoiceNo})` : ''
          } of ${formatQuantityWithUnit(
            histCheck.baseQuantity,
            histCheck.baseUnit
          )} could not update "${prod.name}" stock because catalog unit is now "${prod.unit}".`,
          date: dateKey,
          source: 'SALES_RETURN',
          referenceId,
          referenceType: 'SALES_RETURN',
          idempotencyKey,
          createdAt: nowIso,
        });
        continue;
      }
    }

    if (
      !hasHistoricalBase &&
      item.returnMatchStatus === 'AMBIGUOUS_SALE_LINE' &&
      item.unit &&
      !areUnitsCompatible(item.unit, prod.unit)
    ) {
      const currentQty = roundStockQty(Number(prod.stockQty) || 0);
      const normItemUnit = normalizeUnit(item.unit);
      const itemQty = roundStockQty(Number(item.quantity) || 0);
      skippedIncompatibleItems.push({
        productId: prod.id,
        productName: prod.name,
        historicalUnit: normItemUnit,
        historicalQuantity: itemQty,
        catalogUnit: prod.unit,
        saleLineId: item.saleLineId,
      });
      addedAdjustments.push({
        id: buildAdjustmentId(),
        productId: prod.id,
        productName: prod.name,
        unit: prod.unit,
        type: 'ADD',
        quantityChange: 0,
        previousStock: currentQty,
        newStock: currentQty,
        reconciliationStatus: 'SKIPPED_INCOMPATIBLE_UNIT',
        historicalUnit: normItemUnit,
        historicalQuantity: itemQty,
        reason: `Reconciliation required: Ambiguous sales return from ${customerName}${
          invoiceNo ? ` (#${invoiceNo})` : ''
        } of ${formatQuantityWithUnit(itemQty, normItemUnit)} could not update "${
          prod.name
        }" stock because catalog unit is now "${prod.unit}".`,
        date: dateKey,
        source: 'SALES_RETURN',
        referenceId,
        referenceType: 'SALES_RETURN',
        idempotencyKey,
        createdAt: nowIso,
      });
      continue;
    }

    const canReuseExplicitForProdUnit =
      item.baseQuantity !== undefined &&
      item.baseQuantity > 0 &&
      (!hasHistoricalBase || normalizeUnit(item.baseUnit) === normalizeUnit(prod.unit));

    const strictReturnQty = resolveBaseQuantityStrict({
      quantity: Number(item.quantity),
      selectedUnit: item.unit || prod.unit,
      baseUnit: prod.unit,
      explicitBaseQuantity: canReuseExplicitForProdUnit ? item.baseQuantity : undefined,
    });
    if (!strictReturnQty.valid || strictReturnQty.baseQuantity <= 0) {
      return {
        success: false,
        error: strictReturnQty.error || `Return quantity for "${prod.name}" must be greater than zero.`,
        products,
        stockAdjustments,
        addedAdjustments: [],
      };
    }
    const baseQty = strictReturnQty.baseQuantity;

    const prevQty = roundStockQty(Number(prod.stockQty) || 0);
    const newQty = roundStockQty(prevQty + baseQty);

    workingMap.set(prod.id, {
      ...prod,
      stockQty: newQty,
      updatedAt: nowIso,
    });

    addedAdjustments.push({
      id: buildAdjustmentId(),
      productId: prod.id,
      productName: prod.name,
      unit: prod.unit,
      type: 'ADD',
      quantityChange: baseQty,
      previousStock: prevQty,
      newStock: newQty,
      reconciliationStatus: 'APPLIED',
      ...(item.saleLineId ? { saleLineId: item.saleLineId } : {}),
      reason:
        reason?.trim() ||
        `Sales return from ${customerName}${invoiceNo ? ` (#${invoiceNo})` : ''} (+${formatQuantityWithUnit(
          item.quantity,
          item.unit || prod.unit
        )})`,
      date: dateKey,
      source: 'SALES_RETURN',
      referenceId,
      referenceType: 'SALES_RETURN',
      idempotencyKey,
      createdAt: nowIso,
    });
  }

  const nextProducts = products.map((p) => workingMap.get(p.id) || p);
  const nextAdjustments =
    addedAdjustments.length > 0
      ? [...addedAdjustments.reverse(), ...stockAdjustments]
      : stockAdjustments;

  return {
    success: true,
    products: nextProducts,
    stockAdjustments: nextAdjustments,
    addedAdjustments,
    ...(skippedIncompatibleItems.length > 0 ? { skippedIncompatibleItems } : {}),
  };
}

export function applyPurchaseReturnStockDecrease(params: {
  products: Product[];
  stockAdjustments: StockAdjustmentRecord[];
  productId: string;
  quantity: number;
  unit?: string;
  supplierName: string;
  invoiceNo?: string;
  referenceId: string;
  date: string;
  reason?: string;
  allowNegativeStock?: boolean;
  idempotencyKey?: string;
}): StockMutationResult {
  const {
    products,
    stockAdjustments,
    productId,
    quantity,
    unit,
    supplierName,
    invoiceNo,
    referenceId,
    date,
    reason,
    allowNegativeStock = false,
    idempotencyKey,
  } = params;

  if (
    idempotencyKey &&
    stockAdjustments.some(
      (adj) =>
        adj.idempotencyKey === idempotencyKey &&
        (adj.referenceType === 'PURCHASE_RETURN' || adj.source === 'PURCHASE_RETURN')
    )
  ) {
    return {
      success: false,
      duplicate: true,
      error: 'Duplicate purchase return stock deduction prevented.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const prod = products.find((p) => p.id === productId);
  if (!prod) {
    return {
      success: false,
      error: 'Product selected for purchase return was not found in inventory.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const strictPurchaseRetQty = resolveBaseQuantityStrict({
    quantity,
    selectedUnit: unit || prod.unit,
    baseUnit: prod.unit,
  });
  if (!strictPurchaseRetQty.valid || strictPurchaseRetQty.baseQuantity <= 0) {
    return {
      success: false,
      error: strictPurchaseRetQty.error || 'Purchase return quantity must be greater than zero.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }
  const baseQty = strictPurchaseRetQty.baseQuantity;

  const prevQty = roundStockQty(Number(prod.stockQty) || 0);
  if (!allowNegativeStock && baseQty - prevQty > FLOAT_TOLERANCE) {
    return {
      success: false,
      error: `Insufficient stock to return ${prod.name} to supplier: Available ${formatQuantityWithUnit(
        prevQty,
        prod.unit
      )}, Requested return ${formatQuantityWithUnit(baseQty, prod.unit)}.`,
      issues: [
        {
          productId: prod.id,
          productName: prod.name,
          unit: prod.unit,
          availableQty: prevQty,
          requestedQty: baseQty,
          shortageQty: roundStockQty(baseQty - prevQty),
        },
      ],
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const nowIso = new Date().toISOString();
  const dateKey = (date || nowIso).split('T')[0];
  const newQty = roundStockQty(prevQty - baseQty);

  const nextProducts = products.map((p) =>
    p.id === prod.id ? { ...p, stockQty: newQty, updatedAt: nowIso } : p
  );

  const adjRecord: StockAdjustmentRecord = {
    id: buildAdjustmentId(),
    productId: prod.id,
    productName: prod.name,
    unit: prod.unit,
    type: 'REDUCE',
    quantityChange: roundStockQty(-baseQty),
    previousStock: prevQty,
    newStock: newQty,
    reason:
      reason?.trim() ||
      `Purchase return to ${supplierName}${invoiceNo ? ` (#${invoiceNo})` : ''} (-${formatQuantityWithUnit(
        quantity,
        unit || prod.unit
      )})`,
    date: dateKey,
    source: 'PURCHASE_RETURN',
    referenceId,
    referenceType: 'PURCHASE_RETURN',
    idempotencyKey,
    createdAt: nowIso,
  };

  return {
    success: true,
    products: nextProducts,
    stockAdjustments: [adjRecord, ...stockAdjustments],
    addedAdjustments: [adjRecord],
  };
}

export function applyManualStockAdjustment(params: {
  products: Product[];
  stockAdjustments: StockAdjustmentRecord[];
  productId: string;
  qtyChange: number;
  reason: string;
  date?: string;
  source?: StockAdjustmentRecord['source'];
  allowNegativeStock?: boolean;
  referenceId?: string;
  referenceType?: StockAdjustmentRecord['referenceType'];
  idempotencyKey?: string;
}): StockMutationResult {
  const {
    products,
    stockAdjustments,
    productId,
    qtyChange,
    reason,
    date,
    source = 'MANUAL',
    allowNegativeStock = false,
    referenceId,
    referenceType,
    idempotencyKey,
  } = params;

  if (
    idempotencyKey &&
    stockAdjustments.some((adj) => adj.idempotencyKey === idempotencyKey)
  ) {
    return {
      success: false,
      duplicate: true,
      error: 'Duplicate stock adjustment prevented.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const prod = products.find((p) => p.id === productId);
  if (!prod) {
    return {
      success: false,
      error: 'Product not found in inventory.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const safeChange = roundStockQty(Number(qtyChange));
  if (!Number.isFinite(safeChange) || safeChange === 0) {
    return {
      success: false,
      error: 'Stock adjustment quantity must be non-zero.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const trimmedReason = (reason || '').trim();
  if ((source === 'MANUAL' || source === 'EDIT') && trimmedReason.length < 3) {
    return {
      success: false,
      error: 'Please enter a clear reason (at least 3 characters) for stock adjustment.',
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const prevQty = roundStockQty(Number(prod.stockQty) || 0);
  const newQty = roundStockQty(prevQty + safeChange);

  if (!allowNegativeStock && safeChange < 0 && newQty < -FLOAT_TOLERANCE) {
    const requestedReduction = roundStockQty(Math.abs(safeChange));
    return {
      success: false,
      error: `Insufficient stock for ${prod.name}: Available ${formatQuantityWithUnit(
        prevQty,
        prod.unit
      )}, Requested reduction ${formatQuantityWithUnit(requestedReduction, prod.unit)}.`,
      issues: [
        {
          productId: prod.id,
          productName: prod.name,
          unit: prod.unit,
          availableQty: prevQty,
          requestedQty: requestedReduction,
          shortageQty: roundStockQty(requestedReduction - prevQty),
        },
      ],
      products,
      stockAdjustments,
      addedAdjustments: [],
    };
  }

  const nowIso = new Date().toISOString();
  const dateKey = (date || nowIso).split('T')[0];

  const nextProducts = products.map((p) =>
    p.id === prod.id ? { ...p, stockQty: newQty, updatedAt: nowIso } : p
  );

  const adjRecord: StockAdjustmentRecord = {
    id: buildAdjustmentId(),
    productId: prod.id,
    productName: prod.name,
    unit: prod.unit,
    type: safeChange >= 0 ? 'ADD' : 'REDUCE',
    quantityChange: safeChange,
    previousStock: prevQty,
    newStock: newQty,
    reason: trimmedReason || 'Stock Adjustment',
    date: dateKey,
    source,
    referenceId,
    referenceType: referenceType || (source === 'EDIT' ? 'EDIT' : 'MANUAL'),
    idempotencyKey,
    createdAt: nowIso,
  };

  return {
    success: true,
    products: nextProducts,
    stockAdjustments: [adjRecord, ...stockAdjustments],
    addedAdjustments: [adjRecord],
  };
}
