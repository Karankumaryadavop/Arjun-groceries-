/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupplierPreferredPaymentMethod } from '../types';

export interface ParsedPdfSupplierRow {
  tempId: string;
  selected: boolean;
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  gstin: string;
  creditTerms: string;
  preferredPaymentMethod: SupplierPreferredPaymentMethod;
  openingBalance: number;
  notes: string;
  sourceConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const SUPPLIER_PAYMENT_METHOD_LABELS: Record<SupplierPreferredPaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer (NEFT/RTGS/IMPS)',
  CHEQUE: 'Cheque',
  CREDIT: 'Credit Account',
};

export function normalizePreferredPaymentMethod(
  raw?: string | null
): SupplierPreferredPaymentMethod {
  const clean = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');

  if (!clean) return 'BANK_TRANSFER';
  if (clean.includes('UPI') || clean.includes('GPAY') || clean.includes('PHONEPE') || clean.includes('PAYTM')) {
    return 'UPI';
  }
  if (clean.includes('CHEQUE') || clean.includes('CHECK') || clean.includes('PDC')) {
    return 'CHEQUE';
  }
  if (clean.includes('CASH') || clean === 'COD') {
    return 'CASH';
  }
  if (clean.includes('CREDIT') || clean.includes('UDHAR') || clean.includes('LEDGER')) {
    return 'CREDIT';
  }
  if (
    clean.includes('BANK') ||
    clean.includes('NEFT') ||
    clean.includes('RTGS') ||
    clean.includes('IMPS') ||
    clean.includes('TRANSFER')
  ) {
    return 'BANK_TRANSFER';
  }
  return 'BANK_TRANSFER';
}

function cleanPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return raw.trim();
}

function parseNumericBalance(raw: string): number {
  const cleaned = String(raw || '').replace(/[₹,\s]/g, '').replace(/INR/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
}

const GSTIN_REGEX = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/i;
const INDIAN_PHONE_REGEX = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/;

type ColumnKind =
  | 'name'
  | 'contactPerson'
  | 'phone'
  | 'address'
  | 'gstin'
  | 'creditTerms'
  | 'preferredPaymentMethod'
  | 'openingBalance'
  | 'notes'
  | 'ignore';

function classifyHeaderColumn(headerCell: string): ColumnKind {
  const h = headerCell.trim().toLowerCase();
  if (!h) return 'ignore';
  if (h === 's.no' || h === 'sno' || h === '#' || h === 'sr' || h === 'sr.') return 'ignore';
  if (h.includes('contact') || h.includes('rep') || h.includes('owner') || h.includes('person')) {
    return 'contactPerson';
  }
  if (h.includes('phone') || h.includes('mobile') || h.includes('whatsapp') || h.includes('tel')) {
    return 'phone';
  }
  if (h.includes('gst')) return 'gstin';
  if (h.includes('credit') && (h.includes('term') || h.includes('day') || h.includes('period'))) {
    return 'creditTerms';
  }
  if (h.includes('payment') || h.includes('mode') || h.includes('method')) {
    return 'preferredPaymentMethod';
  }
  if (h.includes('opening') || h.includes('balance') || h.includes('due') || h.includes('payable')) {
    return 'openingBalance';
  }
  if (h.includes('address') || h.includes('city') || h.includes('location') || h.includes('market')) {
    return 'address';
  }
  if (h.includes('note') || h.includes('remark') || h.includes('category')) {
    return 'notes';
  }
  if (h.includes('supplier') || h.includes('vendor') || h.includes('company') || h.includes('name') || h.includes('party') || h.includes('firm')) {
    return 'name';
  }
  return 'ignore';
}

function splitDelimitedColumns(line: string): string[] {
  if (line.includes('|')) {
    return line
      .split('|')
      .map((s) => s.trim())
      .filter((s, idx, arr) => !(idx === 0 && s === '') && !(idx === arr.length - 1 && s === ''));
  }
  if (line.includes('\t')) {
    return line.split('\t').map((s) => s.trim());
  }
  // 2+ spaces is standard column gap produced by PDF coordinate extraction
  return line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
}

function isLikelyHeaderRow(cols: string[]): boolean {
  if (cols.length < 2) return false;
  let matched = 0;
  for (const col of cols) {
    if (classifyHeaderColumn(col) !== 'ignore') {
      matched++;
    }
  }
  return matched >= 2;
}

function makeEmptyParsedRow(index: number): ParsedPdfSupplierRow {
  return {
    tempId: `pdf-sup-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    selected: true,
    name: '',
    contactPerson: '',
    phone: '',
    address: '',
    gstin: '',
    creditTerms: 'Net 15 Days',
    preferredPaymentMethod: 'BANK_TRANSFER',
    openingBalance: 0,
    notes: '',
    sourceConfidence: 'MEDIUM',
  };
}

/**
 * Pure deterministic parser for supplier contact lists extracted from PDF text.
 * Supports:
 * 1. Tabular layouts (header row + pipe/tab/multi-space separated columns)
 * 2. Key-value labeled blocks (`Supplier Name:`, `Phone:`, `Credit Terms:`, `Preferred Payment Method:`, etc.)
 * 3. Unstructured fallback lines containing supplier names + 10-digit Indian phone numbers.
 */
export function parseSuppliersFromExtractedText(rawText: string): ParsedPdfSupplierRow[] {
  const normalized = String(rawText || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Strategy 1: Key-Value labeled blocks (`Supplier: ...`, `Credit Terms: ...`, etc.)
  const keyPattern = /^(supplier(?:\s*name)?|vendor(?:\s*name)?|party(?:\s*name)?|firm(?:\s*name)?|name|contact(?:\s*person)?|representative|phone|mobile|tel|whatsapp|address|location|gstin|gst(?:\s*no\.?)?|credit\s*terms?|payment\s*terms?|preferred\s*payment(?:\s*method|\s*mode)?|payment\s*(?:method|mode)|opening\s*balance|balance|notes?)\s*[:\-]\s*(.+)$/i;

  const keyHits = lines.filter((l) => keyPattern.test(l));
  if (keyHits.length >= 2) {
    const blocks: ParsedPdfSupplierRow[] = [];
    let current: ParsedPdfSupplierRow | null = null;

    const flushCurrent = () => {
      if (current && (current.name.trim() || current.phone.trim())) {
        if (!current.name.trim()) current.name = `Supplier ${blocks.length + 1}`;
        current.sourceConfidence = current.name && current.phone ? 'HIGH' : 'MEDIUM';
        blocks.push(current);
      }
      current = null;
    };

    for (const line of lines) {
      if (/^[-=_]{3,}$/.test(line)) {
        flushCurrent();
        continue;
      }
      const match = line.match(keyPattern);
      if (!match) continue;
      const rawKey = match[1].toLowerCase();
      const rawVal = match[2].trim();

      const isStartKey =
        rawKey.startsWith('supplier') ||
        rawKey.startsWith('vendor') ||
        rawKey.startsWith('party') ||
        rawKey.startsWith('firm') ||
        rawKey === 'name';

      if (isStartKey && current && (current.name || current.phone)) {
        flushCurrent();
      }
      if (!current) {
        current = makeEmptyParsedRow(blocks.length);
      }

      if (isStartKey) {
        current.name = rawVal;
      } else if (rawKey.startsWith('contact') || rawKey.startsWith('rep')) {
        current.contactPerson = rawVal;
      } else if (rawKey.startsWith('phone') || rawKey.startsWith('mobile') || rawKey.startsWith('tel') || rawKey.startsWith('whatsapp')) {
        current.phone = cleanPhoneNumber(rawVal);
      } else if (rawKey.startsWith('address') || rawKey.startsWith('location')) {
        current.address = rawVal;
      } else if (rawKey.startsWith('gst')) {
        current.gstin = rawVal.toUpperCase();
      } else if (rawKey.includes('credit') || rawKey.includes('payment term')) {
        current.creditTerms = rawVal;
      } else if (rawKey.includes('payment') || rawKey.includes('mode') || rawKey.includes('method')) {
        current.preferredPaymentMethod = normalizePreferredPaymentMethod(rawVal);
      } else if (rawKey.includes('balance')) {
        current.openingBalance = parseNumericBalance(rawVal);
      } else if (rawKey.startsWith('note')) {
        current.notes = rawVal;
      }
    }
    flushCurrent();
    if (blocks.length > 0) return blocks;
  }

  // Strategy 2: Tabular PDF rows
  let columnMap: ColumnKind[] | null = null;
  const tableRows: ParsedPdfSupplierRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[-=_|+]{4,}$/.test(line)) continue;
    if (/^(page\s+\d+|supplier\s+(directory|list|contacts|master)|generated\s+on)/i.test(line) && !INDIAN_PHONE_REGEX.test(line)) {
      continue;
    }

    const cols = splitDelimitedColumns(line);
    if (isLikelyHeaderRow(cols)) {
      columnMap = cols.map(classifyHeaderColumn);
      continue;
    }

    if (columnMap && cols.length >= 2) {
      const row = makeEmptyParsedRow(tableRows.length);
      let assignedAny = false;
      for (let cIdx = 0; cIdx < Math.min(cols.length, columnMap.length); cIdx++) {
        const val = cols[cIdx].trim();
        if (!val || val === '-' || val.toLowerCase() === 'n/a') continue;
        const kind = columnMap[cIdx];
        if (kind === 'name') {
          row.name = val.replace(/^\d+[.)]\s*/, '');
          assignedAny = true;
        } else if (kind === 'contactPerson') {
          row.contactPerson = val;
        } else if (kind === 'phone') {
          row.phone = cleanPhoneNumber(val);
          assignedAny = true;
        } else if (kind === 'address') {
          row.address = val;
        } else if (kind === 'gstin') {
          row.gstin = val.toUpperCase();
        } else if (kind === 'creditTerms') {
          row.creditTerms = val;
        } else if (kind === 'preferredPaymentMethod') {
          row.preferredPaymentMethod = normalizePreferredPaymentMethod(val);
        } else if (kind === 'openingBalance') {
          row.openingBalance = parseNumericBalance(val);
        } else if (kind === 'notes') {
          row.notes = val;
        }
      }

      if (assignedAny && row.name) {
        row.sourceConfidence = row.phone ? 'HIGH' : 'MEDIUM';
        tableRows.push(row);
        continue;
      }
    }

    // Strategy 3: Heuristic line with phone number
    const phoneMatch = line.match(INDIAN_PHONE_REGEX);
    if (phoneMatch) {
      const row = makeEmptyParsedRow(tableRows.length);
      row.phone = cleanPhoneNumber(phoneMatch[0]);
      const gstMatch = line.match(GSTIN_REGEX);
      if (gstMatch) row.gstin = gstMatch[0].toUpperCase();

      const creditMatch = line.match(/\b(Net\s*\d+\s*Days?|\d+\s*Days?\s*Credit|Cash\s*on\s*Delivery|COD|Advance|Weekly|Monthly)\b/i);
      if (creditMatch) row.creditTerms = creditMatch[0].trim();

      const payMatch = line.match(/\b(Bank\s*Transfer|NEFT|RTGS|IMPS|UPI|Cheque|Cash|Credit)\b/i);
      if (payMatch) row.preferredPaymentMethod = normalizePreferredPaymentMethod(payMatch[0]);

      const firstSegment = cols[0] || line.slice(0, phoneMatch.index).trim();
      row.name = firstSegment.replace(/^\d+[.)]\s*/, '').replace(/[,|-]+$/, '').trim() || `Supplier ${tableRows.length + 1}`;
      row.sourceConfidence = cols.length >= 2 ? 'MEDIUM' : 'LOW';
      tableRows.push(row);
    }
  }

  return tableRows;
}

/**
 * Extracts coordinate-aligned plain text lines from a PDF File completely offline in the browser
 * using pdfjs-dist (bundled worker via Vite `?url`).
 */
export async function extractTextFromPdfFile(
  file: File
): Promise<{ text: string; pageCount: number }> {
  const pdfjsLib = await import('pdfjs-dist');
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      interface PositionedChunk {
        str: string;
        x: number;
        y: number;
        width: number;
      }

      const chunks: PositionedChunk[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str || !item.str.trim()) continue;
        const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        chunks.push({
          str: item.str.trim(),
          x: Number(transform[4]) || 0,
          y: Number(transform[5]) || 0,
          width: Number(item.width) || 0,
        });
      }

      // Group chunks into visual lines by Y coordinate (tolerance 4pt)
      chunks.sort((a, b) => {
        if (Math.abs(b.y - a.y) > 4) return b.y - a.y;
        return a.x - b.x;
      });

      const lines: PositionedChunk[][] = [];
      for (const chunk of chunks) {
        const lastLine = lines[lines.length - 1];
        if (!lastLine || Math.abs(lastLine[0].y - chunk.y) > 4) {
          lines.push([chunk]);
        } else {
          lastLine.push(chunk);
        }
      }

      const renderedLines = lines.map((lineChunks) => {
        lineChunks.sort((a, b) => a.x - b.x);
        let lineStr = '';
        let prevEndX = 0;
        for (let idx = 0; idx < lineChunks.length; idx++) {
          const c = lineChunks[idx];
          if (idx === 0) {
            lineStr = c.str;
          } else {
            const gap = c.x - prevEndX;
            // Insert double-space separator when PDF column gap is wide
            lineStr += gap > 14 ? `  ${c.str}` : ` ${c.str}`;
          }
          prevEndX = c.x + Math.max(c.width, c.str.length * 4);
        }
        return lineStr;
      });

      pageTexts.push(renderedLines.join('\n'));
    }

    return {
      text: pageTexts.join('\n'),
      pageCount: pdf.numPages,
    };
  } finally {
    await Promise.resolve(pdf.cleanup?.()).catch(() => {});
    await loadingTask.destroy().catch(() => {});
  }
}

/**
 * Generates and downloads a clean sample Supplier Directory PDF with Credit Terms
 * and Preferred Payment Method columns so store owners can test or format their PDFs easily.
 */
export async function generateSampleSuppliersPDF(): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Arjun Groceries — Sample Supplier Contact Directory', 14, 16);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Generated template supporting Credit Terms, Preferred Payment Method, GSTIN & Opening Balance', 14, 22);

  const headers = [
    'Supplier Name',
    'Contact',
    'Phone',
    'GSTIN',
    'Credit Terms',
    'Preferred Payment',
    'Opening Bal',
    'Address',
  ];
  const rows = [
    [
      'Annapurna Grain Mills',
      'Rameshwar Patel',
      '9811223344',
      '27AABCA1234F1Z5',
      'Net 15 Days',
      'Bank Transfer',
      '18500',
      'APMC Grain Market, Navi Mumbai',
    ],
    [
      'Kaveri Edible Oil Depot',
      'Suresh Nair',
      '9820445566',
      '27AAACK9988G1Z2',
      '7 Days Credit',
      'UPI',
      '9200',
      'Turbhe Wholesale Hub, Sector 19',
    ],
    [
      'Swastik Masala & Spices',
      'Mahendra Shah',
      '9765112299',
      '27AADCS7766H1Z8',
      'Net 30 Days',
      'Cheque',
      '0',
      'Vashi Masala Bazaar, Shop 14',
    ],
    [
      'Shree Ganesh Dairy & FMCG',
      'Vikram Deshmukh',
      '9930887766',
      '27AAGCS4455M1Z1',
      'Cash on Delivery',
      'Cash',
      '0',
      'Koparkhairane Main Road',
    ],
  ];

  // Use pipe-delimited mono-aligned grid so pdfjs coordinate extraction parses 100% deterministically
  let y = 34;
  doc.setFont('courier', 'bold');
  doc.setFontSize(8.2);
  doc.text(headers.join(' | '), 14, y);
  y += 4;
  doc.line(14, y, 283, y);
  y += 6;

  doc.setFont('courier', 'normal');
  for (const row of rows) {
    doc.text(row.join(' | '), 14, y);
    y += 8;
  }

  doc.save('sample-suppliers-directory.pdf');
}

function splitCsvMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  if (!csvText || !csvText.trim()) return rows;
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (insideQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        insideQuotes = false;
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      insideQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\r') {
      if (next === '\n') i++;
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else if (ch === '\n') {
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }
  return rows.filter((r) => r.length > 0 && r.some((c) => c !== ''));
}

/**
 * Parses a supplier contact database CSV into editable ParsedPdfSupplierRow[] preview rows.
 */
export function parseSuppliersFromCsvText(csvText: string): {
  rows: ParsedPdfSupplierRow[];
  skipped: number;
  errors: string[];
} {
  const matrix = splitCsvMatrix(csvText);
  if (matrix.length < 2) {
    return {
      rows: [],
      skipped: 0,
      errors: ['CSV file must have a header row and at least 1 supplier contact row.'],
    };
  }

  const colMap = matrix[0].map(classifyHeaderColumn);
  if (!colMap.includes('name')) {
    return {
      rows: [],
      skipped: 0,
      errors: ['Missing required column: "Supplier / Firm Name" (or "Company Name").'],
    };
  }

  const rows: ParsedPdfSupplierRow[] = [];
  let skipped = 0;

  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i];
    const draft: ParsedPdfSupplierRow = {
      tempId: `csv-sup-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      selected: true,
      name: '',
      contactPerson: '',
      phone: '',
      address: '',
      gstin: '',
      creditTerms: 'Net 15 Days',
      preferredPaymentMethod: 'BANK_TRANSFER',
      openingBalance: 0,
      notes: '',
      sourceConfidence: 'HIGH',
    };

    colMap.forEach((kind, idx) => {
      const val = (cells[idx] || '').trim();
      if (!val) return;
      switch (kind) {
        case 'name':
          draft.name = val;
          break;
        case 'contactPerson':
          draft.contactPerson = val;
          break;
        case 'phone':
          draft.phone = cleanPhoneNumber(val);
          break;
        case 'address':
          draft.address = val;
          break;
        case 'gstin':
          draft.gstin = val.toUpperCase();
          break;
        case 'creditTerms':
          draft.creditTerms = val;
          break;
        case 'preferredPaymentMethod':
          draft.preferredPaymentMethod = normalizePreferredPaymentMethod(val);
          break;
        case 'openingBalance':
          draft.openingBalance = parseNumericBalance(val);
          break;
        case 'notes':
          draft.notes = val;
          break;
        default:
          break;
      }
    });

    if (!draft.name) {
      skipped++;
      continue;
    }
    rows.push(draft);
  }

  return {
    rows,
    skipped,
    errors: rows.length === 0 ? ['No valid supplier rows found in CSV file.'] : [],
  };
}

