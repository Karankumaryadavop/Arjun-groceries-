/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product } from '../types';
import { parseCSVRows } from './csv';

export interface ParsedInventoryImportRow {
  tempId: string;
  selected: boolean;
  name: string;
  localName: string;
  category: string;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  mrp?: number;
  stockQty: number;
  minStockAlert: number;
  desiredStockLevel?: number;
  preferredSupplierName: string;
  description: string;
  sourceFormat: 'CSV' | 'PDF' | 'MANUAL';
  sourceConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface InventoryBulkParseResult {
  rows: ParsedInventoryImportRow[];
  skipped: number;
  errors: string[];
}

export interface InventoryImportDuplicateMatch {
  matchedProduct: Product | null;
  matchReason?: 'NAME_AND_UNIT' | 'NAME';
}

function parsePositiveNumber(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback;
  const cleaned = String(raw).replace(/[₹,\s]/g, '').replace(/INR|RS\.?/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : fallback;
}

function parseOptionalPositiveNumber(raw: string | undefined): number | undefined {
  if (!raw || !String(raw).trim()) return undefined;
  const cleaned = String(raw).replace(/[₹,\s]/g, '').replace(/INR|RS\.?/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : undefined;
}

function normalizeUnitText(raw: string | undefined): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 'pcs';
  const lower = trimmed.toLowerCase();
  if (lower === 'kgs' || lower === 'kilogram' || lower === 'kilograms' || lower === 'kilo') return 'kg';
  if (lower === 'gm' || lower === 'gms' || lower === 'gram' || lower === 'grams') return 'g';
  if (lower === 'ltr' || lower === 'ltrs' || lower === 'litre' || lower === 'litres' || lower === 'liter' || lower === 'liters') return 'L';
  if (lower === 'packet' || lower === 'packets' || lower === 'pkts' || lower === 'pack') return 'pkt';
  if (lower === 'piece' || lower === 'pieces' || lower === 'pc') return 'pcs';
  if (lower === 'bag' || lower === 'sack') return 'bags';
  if (lower === 'box') return 'boxes';
  if (lower === 'dozen' || lower === 'doz') return 'dozens';
  return trimmed;
}

/**
 * Parse inventory products from CSV text with flexible column header detection.
 */
export function parseProductsFromCsvText(csvText: string): InventoryBulkParseResult {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) {
    return {
      rows: [],
      skipped: 0,
      errors: ['CSV file must contain a header row and at least 1 product row.'],
    };
  }

  const headerRow = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const nameIdx = headerRow.findIndex(
    (h) =>
      (h.includes('product') || h.includes('item') || h.includes('name') || h.includes('sku')) &&
      !h.includes('hindi') &&
      !h.includes('local') &&
      !h.includes('supplier') &&
      !h.includes('category')
  );
  const localNameIdx = headerRow.findIndex((h) => h.includes('hindi') || h.includes('local'));
  const categoryIdx = headerRow.findIndex((h) => h.includes('category') || h.includes('group') || h.includes('dept'));
  const costIdx = headerRow.findIndex(
    (h) =>
      (h.includes('cost') || h.includes('purchase') || h.includes('wholesale') || h.includes('buy')) &&
      !h.includes('lastpurchase') &&
      !h.includes('date')
  );
  const sellIdx = headerRow.findIndex(
    (h) =>
      (h.includes('sell') || h.includes('rate') || h.includes('price') || h.includes('retail')) &&
      !h.includes('purchase') &&
      !h.includes('cost') &&
      !h.includes('mrp')
  );
  const mrpIdx = headerRow.findIndex((h) => h.includes('mrp'));
  const stockIdx = headerRow.findIndex(
    (h) => (h.includes('stock') || h.includes('qty') || h.includes('quantity') || h.includes('avail')) && !h.includes('desired') && !h.includes('min') && !h.includes('reorder')
  );
  const unitIdx = headerRow.findIndex((h) => h.includes('unit') || h.includes('uom') || h.includes('packsize'));
  const thresholdIdx = headerRow.findIndex(
    (h) => h.includes('threshold') || h.includes('alert') || h.includes('reorder') || h.includes('minstock') || h === 'min'
  );
  const desiredStockIdx = headerRow.findIndex((h) => h.includes('desired'));
  const prefSupplierNameIdx = headerRow.findIndex((h) => h.includes('supplier') && !h.includes('id') && !h.includes('note'));
  const descIdx = headerRow.findIndex((h) => (h.includes('desc') || h.includes('note')) && !h.includes('supplier'));

  if (nameIdx === -1) {
    return {
      rows: [],
      skipped: 0,
      errors: ['Missing required column: "Product Name" (or "Item Name").'],
    };
  }

  const parsed: ParsedInventoryImportRow[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameIdx] || '').trim();
    if (!name) {
      skipped++;
      continue;
    }

    const purchasePrice = costIdx !== -1 ? parsePositiveNumber(r[costIdx], 0) : 0;
    const sellingPrice = sellIdx !== -1 ? parsePositiveNumber(r[sellIdx], purchasePrice) : purchasePrice;
    const mrp = mrpIdx !== -1 ? parseOptionalPositiveNumber(r[mrpIdx]) : undefined;
    const stockQty = stockIdx !== -1 ? parsePositiveNumber(r[stockIdx], 0) : 0;
    const minStockAlert = thresholdIdx !== -1 ? parsePositiveNumber(r[thresholdIdx], 5) : 5;
    const desiredStockLevel = desiredStockIdx !== -1 ? parseOptionalPositiveNumber(r[desiredStockIdx]) : undefined;

    parsed.push({
      tempId: `csv-prod-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      selected: true,
      name,
      localName: localNameIdx !== -1 ? (r[localNameIdx] || '').trim() : '',
      category: (categoryIdx !== -1 ? (r[categoryIdx] || '').trim() : '') || 'General Kirana',
      unit: normalizeUnitText(unitIdx !== -1 ? r[unitIdx] : 'pcs'),
      purchasePrice,
      sellingPrice,
      mrp,
      stockQty,
      minStockAlert,
      desiredStockLevel,
      preferredSupplierName: prefSupplierNameIdx !== -1 ? (r[prefSupplierNameIdx] || '').trim() : '',
      description: descIdx !== -1 ? (r[descIdx] || '').trim() : '',
      sourceFormat: 'CSV',
      sourceConfidence: 'HIGH',
    });
  }

  return {
    rows: parsed,
    skipped,
    errors: parsed.length === 0 ? ['No valid product rows found in the CSV file.'] : [],
  };
}

type PdfProductCol =
  | 'name'
  | 'localName'
  | 'category'
  | 'unit'
  | 'purchasePrice'
  | 'sellingPrice'
  | 'mrp'
  | 'stockQty'
  | 'minStockAlert'
  | 'preferredSupplierName'
  | 'description'
  | 'ignore';

function classifyProductPdfHeader(cell: string): PdfProductCol {
  const h = cell.trim().toLowerCase();
  if (!h || h === '#' || h === 's.no' || h === 'sno' || h === 'sr' || h === 'sr.') return 'ignore';
  if (h.includes('hindi') || h.includes('local')) return 'localName';
  if (h.includes('category') || h.includes('group')) return 'category';
  if (h.includes('unit') || h.includes('uom')) return 'unit';
  if (h.includes('cost') || h.includes('purchase') || h.includes('wholesale') || h.includes('buy')) return 'purchasePrice';
  if (h.includes('sell') || h.includes('rate') || h.includes('price') || h.includes('retail')) return 'sellingPrice';
  if (h.includes('mrp')) return 'mrp';
  if (h.includes('reorder') || h.includes('alert') || h.includes('min') || h.includes('threshold')) return 'minStockAlert';
  if (h.includes('stock') || h.includes('qty') || h.includes('quantity') || h.includes('avail')) return 'stockQty';
  if (h.includes('supplier') || h.includes('vendor')) return 'preferredSupplierName';
  if (h.includes('desc') || h.includes('note')) return 'description';
  if (h.includes('product') || h.includes('item') || h.includes('name')) return 'name';
  return 'ignore';
}

function splitPdfRowCells(line: string): string[] {
  if (line.includes('|')) {
    return line.split('|').map((c) => c.trim()).filter((_, idx, arr) => !(idx === 0 && arr[0] === '') && !(idx === arr.length - 1 && arr[arr.length - 1] === ''));
  }
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim());
  }
  if (/\s{2,}/.test(line)) {
    return line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  }
  return [line.trim()];
}

function parseTabularPdfProducts(lines: string[]): ParsedInventoryImportRow[] {
  let headerIdx = -1;
  let colMap: PdfProductCol[] = [];

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const cells = splitPdfRowCells(lines[i]);
    if (cells.length < 3) continue;
    const mapped = cells.map(classifyProductPdfHeader);
    const recognized = mapped.filter((c) => c !== 'ignore').length;
    if (mapped.includes('name') && recognized >= 3) {
      headerIdx = i;
      colMap = mapped;
      break;
    }
  }

  if (headerIdx === -1) return [];

  const results: ParsedInventoryImportRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^[-=_|+]{3,}$/.test(line)) continue;
    if (/^page\s+\d+/i.test(line) || /^generated\s+/i.test(line)) continue;

    const cells = splitPdfRowCells(line);
    if (cells.length < 2) continue;

    const draft: ParsedInventoryImportRow = {
      tempId: `pdf-prod-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      selected: true,
      name: '',
      localName: '',
      category: 'General Kirana',
      unit: 'pcs',
      purchasePrice: 0,
      sellingPrice: 0,
      mrp: undefined,
      stockQty: 0,
      minStockAlert: 5,
      preferredSupplierName: '',
      description: '',
      sourceFormat: 'PDF',
      sourceConfidence: 'HIGH',
    };

    colMap.forEach((kind, colIdx) => {
      const val = (cells[colIdx] || '').trim();
      if (!val || val === '-' || val === '--') return;
      switch (kind) {
        case 'name':
          draft.name = val;
          break;
        case 'localName':
          draft.localName = val;
          break;
        case 'category':
          draft.category = val;
          break;
        case 'unit':
          draft.unit = normalizeUnitText(val);
          break;
        case 'purchasePrice':
          draft.purchasePrice = parsePositiveNumber(val, 0);
          break;
        case 'sellingPrice':
          draft.sellingPrice = parsePositiveNumber(val, 0);
          break;
        case 'mrp':
          draft.mrp = parseOptionalPositiveNumber(val);
          break;
        case 'stockQty':
          draft.stockQty = parsePositiveNumber(val, 0);
          break;
        case 'minStockAlert':
          draft.minStockAlert = parsePositiveNumber(val, 5);
          break;
        case 'preferredSupplierName':
          draft.preferredSupplierName = val;
          break;
        case 'description':
          draft.description = val;
          break;
        default:
          break;
      }
    });

    if (draft.name) {
      if (draft.sellingPrice === 0 && draft.purchasePrice > 0) {
        draft.sellingPrice = draft.purchasePrice;
      }
      results.push(draft);
    }
  }

  return results;
}

function parseKeyValuePdfProducts(lines: string[]): ParsedInventoryImportRow[] {
  const results: ParsedInventoryImportRow[] = [];
  let current: ParsedInventoryImportRow | null = null;

  const commitCurrent = () => {
    if (current && current.name.trim()) {
      if (current.sellingPrice === 0 && current.purchasePrice > 0) {
        current.sellingPrice = current.purchasePrice;
      }
      results.push(current);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const kvMatch = raw.match(/^([A-Za-z][A-Za-z0-9\s/().-]{1,32})\s*[:=-]\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim().toLowerCase();
    const val = kvMatch[2].trim();
    if (!val) continue;

    if (
      (key.includes('product') || key.includes('item')) &&
      (key.includes('name') || key === 'product' || key === 'item')
    ) {
      commitCurrent();
      current = {
        tempId: `pdf-kv-prod-${Date.now()}-${i}`,
        selected: true,
        name: val,
        localName: '',
        category: 'General Kirana',
        unit: 'pcs',
        purchasePrice: 0,
        sellingPrice: 0,
        mrp: undefined,
        stockQty: 0,
        minStockAlert: 5,
        preferredSupplierName: '',
        description: '',
        sourceFormat: 'PDF',
        sourceConfidence: 'HIGH',
      };
      continue;
    }

    if (!current) continue;

    if (key.includes('hindi') || key.includes('local')) {
      current.localName = val;
    } else if (key.includes('category') || key.includes('group')) {
      current.category = val;
    } else if (key.includes('unit') || key.includes('uom')) {
      current.unit = normalizeUnitText(val);
    } else if (key.includes('cost') || key.includes('purchase') || key.includes('wholesale')) {
      current.purchasePrice = parsePositiveNumber(val, 0);
    } else if (key.includes('sell') || key.includes('rate') || key.includes('price')) {
      current.sellingPrice = parsePositiveNumber(val, 0);
    } else if (key.includes('mrp')) {
      current.mrp = parseOptionalPositiveNumber(val);
    } else if (key.includes('reorder') || key.includes('min') || key.includes('alert')) {
      current.minStockAlert = parsePositiveNumber(val, 5);
    } else if (key.includes('stock') || key.includes('qty') || key.includes('quantity')) {
      current.stockQty = parsePositiveNumber(val, 0);
    } else if (key.includes('supplier') || key.includes('vendor')) {
      current.preferredSupplierName = val;
    } else if (key.includes('desc') || key.includes('note')) {
      current.description = val;
    }
  }

  commitCurrent();
  return results;
}

/**
 * Parse inventory product rows from extracted PDF text (supports tabular lists and labeled cards).
 */
export function parseProductsFromExtractedPdfText(text: string): ParsedInventoryImportRow[] {
  if (!text || !text.trim()) return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const tabular = parseTabularPdfProducts(lines);
  if (tabular.length > 0) return tabular;

  const keyValue = parseKeyValuePdfProducts(lines);
  if (keyValue.length > 0) return keyValue;

  return [];
}

/**
 * Match an imported product row against existing inventory safely (avoids creating duplicate SKUs).
 */
export function matchExistingInventoryProduct(
  row: Pick<ParsedInventoryImportRow, 'name' | 'unit'>,
  existingProducts: Product[]
): InventoryImportDuplicateMatch {
  const cleanName = row.name.trim().toLowerCase();
  const cleanUnit = normalizeUnitText(row.unit).toLowerCase();
  if (!cleanName) return { matchedProduct: null };

  const exactBoth = existingProducts.find(
    (p) =>
      p.name.trim().toLowerCase() === cleanName &&
      normalizeUnitText(p.unit).toLowerCase() === cleanUnit
  );
  if (exactBoth) {
    return { matchedProduct: exactBoth, matchReason: 'NAME_AND_UNIT' };
  }

  const nameOnly = existingProducts.find((p) => p.name.trim().toLowerCase() === cleanName);
  if (nameOnly) {
    return { matchedProduct: nameOnly, matchReason: 'NAME' };
  }

  return { matchedProduct: null };
}

/**
 * Generate a downloadable Sample Inventory Catalog PDF for testing bulk PDF import offline.
 */
export async function generateSampleProductsPDF(): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { triggerVerifiedBlobDownload } = await import('./androidDownload');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Arjun Groceries - Sample Inventory Product Catalog (PDF Import)', 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    'Format: Pipe-separated columns for reliable offline browser PDF extraction.',
    14,
    23
  );

  const lines = [
    'Product Name | Category | Unit | Purchase Cost | Selling Rate | MRP | Stock Qty | Reorder Min | Supplier',
    'Aashirvaad Shudh Chakki Atta 10kg | Grains & Flour | bags | 380 | 425 | 455 | 24 | 6 | Balaji Grains Wholesale',
    'Fortune Sunlite Sunflower Oil 1L | Oils & Ghee | L | 122 | 142 | 160 | 40 | 10 | Shree Ganesh FMCG',
    'Tata Salt Iodized 1kg | Spices & Masala | pkt | 21 | 26 | 28 | 60 | 15 | Shree Ganesh FMCG',
    'Toor Dal Premium Loose | Pulses & Dal | kg | 132 | 155 | 170 | 32 | 10 | Balaji Grains Wholesale',
    'Parle-G Gold Biscuit Pack | Snacks & Biscuits | pkt | 8.5 | 10 | 10 | 85 | 20 | Shree Ganesh FMCG',
  ];

  doc.setFont('courier', 'normal');
  doc.setFontSize(8.5);
  let y = 34;
  lines.forEach((line, idx) => {
    if (idx === 0) doc.setFont('courier', 'bold');
    else doc.setFont('courier', 'normal');
    doc.text(line, 14, y);
    y += 9;
  });

  const blob = doc.output('blob');
  triggerVerifiedBlobDownload(blob, 'sample-inventory-catalog.pdf', 'application/pdf');
}
