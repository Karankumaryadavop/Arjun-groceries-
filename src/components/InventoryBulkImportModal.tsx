import React, { useRef, useState } from 'react';
import { Product } from '../types';
import { downloadCSVFile, getSampleProductCSV } from '../utils/csv';
import { extractTextFromPdfFile } from '../utils/supplierPdfImport';
import {
  generateSampleProductsPDF,
  matchExistingInventoryProduct,
  ParsedInventoryImportRow,
  parseProductsFromCsvText,
  parseProductsFromExtractedPdfText,
} from '../utils/inventoryBulkImport';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  X,
  Upload,
  FileSpreadsheet,
  FileText,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface InventoryBulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingProducts: Product[];
  onImportRows: (
    rows: ParsedInventoryImportRow[],
    options: { duplicateMode: 'UPDATE' | 'SKIP' }
  ) => { imported: number; updated: number; skipped: number };
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB safety limit

export const InventoryBulkImportModal: React.FC<InventoryBulkImportModalProps> = ({
  isOpen,
  onClose,
  existingProducts,
  onImportRows,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedInventoryImportRow[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<'UPDATE' | 'SKIP'>('UPDATE');
  const [importDone, setImportDone] = useState<{
    imported: number;
    updated: number;
    skipped: number;
  } | null>(null);

  useTrackActiveTransaction('inventory-bulk-import', isOpen);

  if (!isOpen) return null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMsg('File is too large. Please upload a CSV or PDF file smaller than 10 MB.');
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isCsv =
      file.type === 'text/csv' ||
      file.type === 'application/vnd.ms-excel' ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.txt');

    if (!isPdf && !isCsv) {
      setErrorMsg('Unsupported file type. Please choose a .csv or .pdf product list file.');
      return;
    }

    setIsParsing(true);
    setErrorMsg(null);
    setParseNote(null);
    setImportDone(null);
    setFileName(file.name);

    try {
      if (isCsv) {
        const text = await file.text();
        const res = parseProductsFromCsvText(text);
        if (res.errors.length > 0 && res.rows.length === 0) {
          setErrorMsg(res.errors.join(' '));
          setRows([]);
        } else {
          setRows(res.rows);
          setParseNote(
            `Parsed ${res.rows.length} product ${res.rows.length === 1 ? 'row' : 'rows'} from CSV${
              res.skipped > 0 ? ` (${res.skipped} blank rows skipped)` : ''
            }. Review or edit values below before importing.`
          );
        }
      } else {
        const { text, pageCount } = await extractTextFromPdfFile(file);
        const parsed = parseProductsFromExtractedPdfText(text);
        if (parsed.length > 0) {
          setRows(parsed);
          setParseNote(
            `Extracted ${parsed.length} product ${parsed.length === 1 ? 'row' : 'rows'} offline from ${pageCount} PDF ${
              pageCount === 1 ? 'page' : 'pages'
            }. Review pricing, units, and stock before importing.`
          );
        } else {
          setRows([]);
          setErrorMsg(
            'Could not detect tabular product rows in this PDF. Try a text-based PDF (see Sample PDF) or CSV file, or add rows manually.'
          );
        }
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to read this file. Please check the file format.'
      );
      setRows([]);
    } finally {
      setIsParsing(false);
    }
  };

  const handleUpdateRow = <K extends keyof ParsedInventoryImportRow>(
    tempId: string,
    field: K,
    value: ParsedInventoryImportRow[K]
  ) => {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r)));
  };

  const handleAddBlankRow = () => {
    setRows((prev) => [
      ...prev,
      {
        tempId: `manual-prod-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
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
        sourceFormat: 'MANUAL',
        sourceConfidence: 'HIGH',
      },
    ]);
  };

  const handleRemoveRow = (tempId: string) => {
    setRows((prev) => prev.filter((r) => r.tempId !== tempId));
  };

  const selectedValidRows = rows.filter((r) => r.selected && r.name.trim().length > 0);
  const matchedExistingCount = selectedValidRows.filter(
    (r) => matchExistingInventoryProduct(r, existingProducts).matchedProduct !== null
  ).length;

  const handleConfirmImport = () => {
    if (selectedValidRows.length === 0) {
      setErrorMsg('Select at least one row with a valid Product Name before importing.');
      return;
    }
    const result = onImportRows(selectedValidRows, { duplicateMode });
    setImportDone(result);
    setErrorMsg(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bulk Import Inventory Products from CSV or PDF"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              <span>Bulk Import Inventory (CSV / PDF)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload a product catalog spreadsheet (.csv) or text-based catalog (.pdf). Parsed 100% offline with inline review.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inventory bulk import"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Upload Bar */}
          <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {fileName ? `Selected File: ${fileName}` : 'Upload Product List (.csv or .pdf)'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Columns: Product Name, Category, Unit, Purchase Cost, Selling Rate, MRP, Stock Qty, Min Alert, Supplier.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadCSVFile('sample-kirana-products.csv', getSampleProductCSV())}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Sample CSV</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void generateSampleProductsPDF();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Sample PDF</span>
              </button>
              <button
                type="button"
                disabled={isParsing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                {isParsing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>{isParsing ? 'Reading File...' : 'Choose CSV / PDF'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.pdf,application/pdf"
                onChange={handleFileSelect}
                aria-label="Upload Inventory CSV or PDF file"
                className="hidden"
              />
            </div>
          </div>

          {parseNote && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>{parseNote}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-800 text-xs text-red-800 dark:text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {importDone && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-950 dark:text-emerald-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>Inventory Import Complete:</strong> Added {importDone.imported} new products,
                updated {importDone.updated} existing
                {importDone.skipped > 0 ? `, skipped ${importDone.skipped}` : ''}.
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          )}

          {/* Review & Edit Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                Extracted Products Preview ({rows.length} rows · {selectedValidRows.length} selected
                {matchedExistingCount > 0 ? ` · ${matchedExistingCount} existing matches` : ''})
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <span>If product exists:</span>
                  <select
                    value={duplicateMode}
                    onChange={(e) => setDuplicateMode(e.target.value as 'UPDATE' | 'SKIP')}
                    className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    <option value="UPDATE">Update Existing</option>
                    <option value="SKIP">Skip Duplicates</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleAddBlankRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Row</span>
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Upload a CSV spreadsheet or PDF product catalog above, or click &quot;Add Row&quot; to enter products in bulk.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 px-2.5">Use</th>
                      <th className="py-2 px-2.5 min-w-[175px]">Product Name *</th>
                      <th className="py-2 px-2.5 min-w-[130px]">Category</th>
                      <th className="py-2 px-2.5 min-w-[75px]">Unit</th>
                      <th className="py-2 px-2.5 min-w-[85px]">Cost ₹</th>
                      <th className="py-2 px-2.5 min-w-[85px]">Sell ₹</th>
                      <th className="py-2 px-2.5 min-w-[80px]">Stock</th>
                      <th className="py-2 px-2.5 min-w-[80px]">Min Alert</th>
                      <th className="py-2 px-2.5 min-w-[140px]">Supplier</th>
                      <th className="py-2 px-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((row) => {
                      const match = matchExistingInventoryProduct(row, existingProducts);
                      return (
                        <tr key={row.tempId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-2.5 align-middle">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              onChange={(e) => handleUpdateRow(row.tempId, 'selected', e.target.checked)}
                              aria-label={`Select ${row.name || 'product row'}`}
                              className="w-4 h-4 accent-emerald-700 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => handleUpdateRow(row.tempId, 'name', e.target.value)}
                              placeholder="Product name"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                            {match.matchedProduct && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold mt-0.5">
                                {duplicateMode === 'UPDATE'
                                  ? 'Matches existing (will update)'
                                  : 'Matches existing (will skip)'}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.category}
                              onChange={(e) => handleUpdateRow(row.tempId, 'category', e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.unit}
                              onChange={(e) => handleUpdateRow(row.tempId, 'unit', e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.purchasePrice}
                              onChange={(e) =>
                                handleUpdateRow(
                                  row.tempId,
                                  'purchasePrice',
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.sellingPrice}
                              onChange={(e) =>
                                handleUpdateRow(
                                  row.tempId,
                                  'sellingPrice',
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.stockQty}
                              onChange={(e) =>
                                handleUpdateRow(
                                  row.tempId,
                                  'stockQty',
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.minStockAlert}
                              onChange={(e) =>
                                handleUpdateRow(
                                  row.tempId,
                                  'minStockAlert',
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.preferredSupplierName}
                              onChange={(e) =>
                                handleUpdateRow(row.tempId, 'preferredSupplierName', e.target.value)
                              }
                              placeholder="Optional supplier"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.tempId)}
                              aria-label={`Remove ${row.name || 'row'}`}
                              className="p-1 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Historical sales, ledgers, and accounting entries are untouched during inventory catalog imports.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              disabled={selectedValidRows.length === 0}
              onClick={handleConfirmImport}
              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              Import {selectedValidRows.length} Selected{' '}
              {selectedValidRows.length === 1 ? 'Product' : 'Products'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
