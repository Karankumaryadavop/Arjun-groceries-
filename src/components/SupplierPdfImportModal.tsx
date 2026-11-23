import React, { useRef, useState } from 'react';
import { Supplier, SupplierPreferredPaymentMethod } from '../types';
import { apiFetch } from '../utils/apiClient';
import { downloadCSVFile, getSampleSupplierCSV } from '../utils/csv';
import {
  extractTextFromPdfFile,
  generateSampleSuppliersPDF,
  normalizePreferredPaymentMethod,
  ParsedPdfSupplierRow,
  parseSuppliersFromCsvText,
  parseSuppliersFromExtractedText,
  SUPPLIER_PAYMENT_METHOD_LABELS,
} from '../utils/supplierPdfImport';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  X,
  Upload,
  FileText,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface SupplierPdfImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingSuppliers: Supplier[];
  onImportRows: (
    rows: ParsedPdfSupplierRow[],
    options?: { duplicateMode?: 'UPDATE' | 'SKIP' }
  ) => { imported: number; updated: number; skipped?: number };
}

export const SupplierPdfImportModal: React.FC<SupplierPdfImportModalProps> = ({
  isOpen,
  onClose,
  existingSuppliers,
  onImportRows,
}) => {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedPdfSupplierRow[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<'UPDATE' | 'SKIP'>('UPDATE');
  const [importDone, setImportDone] = useState<{
    imported: number;
    updated: number;
    skipped?: number;
  } | null>(null);

  useTrackActiveTransaction('supplier-bulk-import', isOpen);

  if (!isOpen) return null;

  const existingPhoneSet = new Set(
    existingSuppliers
      .map((s) => (s.phone || '').replace(/\D/g, '').slice(-10))
      .filter((p) => p.length === 10)
  );
  const existingNameSet = new Set(
    existingSuppliers.map((s) => s.name.trim().toLowerCase())
  );

  const isExistingMatch = (row: ParsedPdfSupplierRow): boolean => {
    const cleanPhone = (row.phone || '').replace(/\D/g, '').slice(-10);
    if (cleanPhone.length === 10 && existingPhoneSet.has(cleanPhone)) return true;
    return Boolean(row.name.trim() && existingNameSet.has(row.name.trim().toLowerCase()));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > 10 * 1024 * 1024) {
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
      setErrorMsg('Unsupported file format. Please choose a .csv or .pdf supplier contact file.');
      return;
    }

    setIsParsing(true);
    setErrorMsg(null);
    setParseNote(null);
    setImportDone(null);
    setFileName(file.name);

    try {
      if (isCsv) {
        const csvText = await file.text();
        const csvResult = parseSuppliersFromCsvText(csvText);
        if (csvResult.errors.length > 0 && csvResult.rows.length === 0) {
          setErrorMsg(csvResult.errors.join(' '));
          setRows([]);
        } else {
          setRows(csvResult.rows);
          setParseNote(
            `Parsed ${csvResult.rows.length} supplier ${
              csvResult.rows.length === 1 ? 'contact' : 'contacts'
            } from CSV${csvResult.skipped > 0 ? ` (${csvResult.skipped} skipped)` : ''}. Review or edit before importing.`
          );
        }
        return;
      }

      const { text, pageCount } = await extractTextFromPdfFile(file);
      let parsed = parseSuppliersFromExtractedText(text);

      if (parsed.length > 0) {
        setRows(parsed);
        setParseNote(
          `Extracted ${parsed.length} supplier ${parsed.length === 1 ? 'record' : 'records'} locally offline from ${pageCount} PDF ${pageCount === 1 ? 'page' : 'pages'}. Review or edit Credit Terms and Preferred Payment Method below.`
        );
        return;
      }

      // If no selectable text rows were found (e.g. scanned image PDF), try optional backend fallback
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read PDF file.'));
        reader.readAsDataURL(file);
      });

      const res = await apiFetch('/api/ocr/extract-suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: dataUrl }),
      }).catch(() => null);

      if (res && res.ok) {
        const body = await res.json();
        if (body.success && Array.isArray(body.suppliers) && body.suppliers.length > 0) {
          parsed = body.suppliers.map((item: Record<string, unknown>, idx: number) => ({
            tempId: `ocr-sup-${Date.now()}-${idx}`,
            selected: true,
            name: String(item.name || '').trim(),
            contactPerson: String(item.contactPerson || '').trim(),
            phone: String(item.phone || '').replace(/\D/g, '').slice(-10),
            address: String(item.address || '').trim(),
            gstin: String(item.gstin || '').trim().toUpperCase(),
            creditTerms: String(item.creditTerms || 'Net 15 Days').trim(),
            preferredPaymentMethod: normalizePreferredPaymentMethod(
              String(item.preferredPaymentMethod || 'BANK_TRANSFER')
            ),
            openingBalance: Math.max(0, Number(item.openingBalance) || 0),
            notes: String(item.notes || '').trim(),
            sourceConfidence: 'MEDIUM' as const,
          }));
          setRows(parsed);
          setParseNote(
            `Extracted ${parsed.length} suppliers from scanned PDF (${pageCount} pages). Verify details before importing.`
          );
          return;
        }
        setErrorMsg(
          body.error ||
            'Could not detect structured supplier contacts in this PDF. You can download our Sample PDF/CSV format or add rows manually below.'
        );
      } else {
        setErrorMsg(
          'No selectable supplier rows detected in this PDF. Try a text-based PDF, a CSV file, or add rows manually.'
        );
      }
      setRows([]);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to read this file.'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleUpdateRow = <K extends keyof ParsedPdfSupplierRow>(
    tempId: string,
    field: K,
    value: ParsedPdfSupplierRow[K]
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r))
    );
  };

  const handleAddBlankRow = () => {
    setRows((prev) => [
      ...prev,
      {
        tempId: `manual-sup-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
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
      },
    ]);
  };

  const handleRemoveRow = (tempId: string) => {
    setRows((prev) => prev.filter((r) => r.tempId !== tempId));
  };

  const selectedValidRows = rows.filter((r) => r.selected && r.name.trim().length > 0);

  const handleConfirmImport = () => {
    if (selectedValidRows.length === 0) {
      setErrorMsg('Select at least one supplier row with a valid firm name.');
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
      aria-label="Bulk Import Suppliers from CSV or PDF"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              <span>Bulk Import Suppliers (CSV / PDF)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload a wholesaler contact database (.csv or .pdf) offline with Credit Terms, GSTIN &amp; Preferred Payment Method.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close supplier bulk import"
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
                {fileName ? `Selected File: ${fileName}` : 'Upload Supplier Contacts (.csv or .pdf)'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Supports CSV spreadsheets, PDF tables, and contact sheets (Firm Name, Phone, GSTIN, Credit Terms, Payment Mode).
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadCSVFile('sample-kirana-suppliers.csv', getSampleSupplierCSV())}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Sample CSV</span>
              </button>
              <button
                type="button"
                onClick={() => generateSampleSuppliersPDF()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Sample PDF</span>
              </button>
              <button
                type="button"
                disabled={isParsing}
                onClick={() => pdfInputRef.current?.click()}
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
                ref={pdfInputRef}
                type="file"
                accept=".csv,text/csv,.pdf,application/pdf"
                onChange={handleFileSelect}
                aria-label="Upload Supplier CSV or PDF file"
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
                <strong>Import Complete:</strong> Added {importDone.imported} new suppliers, updated{' '}
                {importDone.updated} existing
                {importDone.skipped ? `, skipped ${importDone.skipped}` : ''} in local database.
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
                Extracted Suppliers Preview ({rows.length} rows · {selectedValidRows.length} selected)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <span>If supplier exists:</span>
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
                  <span>Add Row Manually</span>
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Upload a CSV spreadsheet or PDF supplier directory above, or click &quot;Add Row Manually&quot; to enter suppliers.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 px-2.5">Use</th>
                      <th className="py-2 px-2.5 min-w-[160px]">Supplier / Firm Name *</th>
                      <th className="py-2 px-2.5 min-w-[130px]">Contact Person</th>
                      <th className="py-2 px-2.5 min-w-[115px]">Phone</th>
                      <th className="py-2 px-2.5 min-w-[130px]">Credit Terms</th>
                      <th className="py-2 px-2.5 min-w-[155px]">Preferred Payment</th>
                      <th className="py-2 px-2.5 min-w-[130px]">GSTIN</th>
                      <th className="py-2 px-2.5 min-w-[100px]">Opening ₹</th>
                      <th className="py-2 px-2.5 min-w-[160px]">Address</th>
                      <th className="py-2 px-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((row) => {
                      const matched = isExistingMatch(row);
                      return (
                        <tr key={row.tempId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-2.5 align-middle">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              onChange={(e) => handleUpdateRow(row.tempId, 'selected', e.target.checked)}
                              aria-label={`Select ${row.name || 'supplier row'}`}
                              className="w-4 h-4 accent-emerald-700 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => handleUpdateRow(row.tempId, 'name', e.target.value)}
                              placeholder="Firm Name"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                            {matched && (
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
                              value={row.contactPerson}
                              onChange={(e) => handleUpdateRow(row.tempId, 'contactPerson', e.target.value)}
                              placeholder="Contact name"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="tel"
                              value={row.phone}
                              onChange={(e) => handleUpdateRow(row.tempId, 'phone', e.target.value)}
                              placeholder="10-digit phone"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.creditTerms}
                              onChange={(e) => handleUpdateRow(row.tempId, 'creditTerms', e.target.value)}
                              placeholder="e.g. Net 15 Days"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <select
                              value={row.preferredPaymentMethod}
                              onChange={(e) =>
                                handleUpdateRow(
                                  row.tempId,
                                  'preferredPaymentMethod',
                                  e.target.value as SupplierPreferredPaymentMethod
                                )
                              }
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            >
                              {(
                                Object.keys(SUPPLIER_PAYMENT_METHOD_LABELS) as SupplierPreferredPaymentMethod[]
                              ).map((method) => (
                                <option key={method} value={method}>
                                  {SUPPLIER_PAYMENT_METHOD_LABELS[method]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.gstin}
                              onChange={(e) =>
                                handleUpdateRow(row.tempId, 'gstin', e.target.value.toUpperCase())
                              }
                              placeholder="GSTIN"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="number"
                              min="0"
                              value={row.openingBalance}
                              onChange={(e) =>
                                handleUpdateRow(
                                  row.tempId,
                                  'openingBalance',
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={row.address}
                              onChange={(e) => handleUpdateRow(row.tempId, 'address', e.target.value)}
                              placeholder="Market / Address"
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.tempId)}
                              aria-label="Remove row"
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
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Existing suppliers matched by phone or firm name will be updated safely without duplicating ledgers.
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
              {selectedValidRows.length === 1 ? 'Supplier' : 'Suppliers'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
