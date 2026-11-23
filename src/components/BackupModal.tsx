/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { formatINR } from '../utils/accounting';
import {
  BackupExportMethod,
  inspectAndValidateBackupContent,
  InspectedBackupResult,
  VerifiedRestoreCounts,
} from '../utils/localBackupManager';
import {
  buildExcelSummaryPreview,
  ExcelSummaryPreview,
} from '../utils/backupExcel';
import {
  buildPdfExportPreviewSummary,
  exportBackupReportPdfBytes,
  PdfExportPreviewSummary,
} from '../utils/backupReportPdf';
import { formatByteSize } from '../utils/androidDownload';
import { BackupReconciliationCard } from './BackupReconciliationCard';
import { CloudBackupSection } from './CloudBackupSection';
import { ExternalRecoveryGuide } from './ExternalRecoveryGuide';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Info,
  Layers,
  Lock,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';

function describeExportSuccess(
  kindLabel: string,
  savedVia?: BackupExportMethod,
  byteSize?: number,
  checksum?: string
): string {
  const sizeNote = byteSize && byteSize > 0 ? ` · Verified size: ${formatByteSize(byteSize)}` : '';
  const sumNote = checksum ? ` · SHA-256: ${checksum.slice(0, 12)}` : '';
  if (savedVia === 'file_picker') {
    return `${kindLabel} saved directly to your selected device folder${sizeNote}${sumNote}.`;
  }
  if (savedVia === 'share_sheet') {
    return `${kindLabel} shared via Android Share Sheet (Files / Drive / WhatsApp)${sizeNote}${sumNote}.`;
  }
  return `${kindLabel} download started${sizeNote}${sumNote} — check your browser or Android Downloads bar to confirm completion.`;
}

export const BackupModal: React.FC = () => {
  const {
    isBackupModalOpen,
    setIsBackupModalOpen,
    getCurrentBusinessDataset,
    exportBackupPdfReport,
    exportBackupExcelFile,
    exportVerifiedBackupFile,
    exportEncryptedBackupFile,
    getBackupSummary,
    restoreBackupFromJSONSafe,
    profile,
  } = useStore();

  const [isGenerating, setIsGenerating] = useState<'PDF' | 'EXCEL' | 'PDF_PREVIEW' | 'JSON' | 'ENC' | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    message?: string;
    verifiedCounts?: VerifiedRestoreCounts;
  }>({ type: 'idle' });

  // Preview states (PDF vs Excel Summary)
  const [pdfPreview, setPdfPreview] = useState<{
    blobUrl: string;
    summary: PdfExportPreviewSummary;
  } | null>(null);
  const [excelPreview, setExcelPreview] = useState<{
    data: ExcelSummaryPreview;
    activeSheetIdx: number;
  } | null>(null);

  const [encryptedPrompt, setEncryptedPrompt] = useState<{
    rawContent: string;
    fileName: string;
    fileSizeKB: number;
    decryptPassphrase: string;
    error?: string;
  } | null>(null);

  // Staged restore candidate for user inspection & safety verification
  const [pendingRestore, setPendingRestore] = useState<{
    rawContent: string;
    passphrase?: string;
    parsed: InspectedBackupResult;
    fileName: string;
    fileSizeKB: number;
  } | null>(null);

  // Clean up Blob URL when preview changes or modal closes
  useEffect(() => {
    return () => {
      if (pdfPreview?.blobUrl) {
        URL.revokeObjectURL(pdfPreview.blobUrl);
      }
    };
  }, [pdfPreview?.blobUrl]);

  useEffect(() => {
    if (!isBackupModalOpen) {
      if (pdfPreview?.blobUrl) {
        URL.revokeObjectURL(pdfPreview.blobUrl);
      }
      setPdfPreview(null);
      setExcelPreview(null);
    }
  }, [isBackupModalOpen]);

  if (!isBackupModalOpen) return null;

  const summary = getBackupSummary();

  const handleCloseModal = () => {
    if (pdfPreview?.blobUrl) {
      URL.revokeObjectURL(pdfPreview.blobUrl);
    }
    setPdfPreview(null);
    setExcelPreview(null);
    setPendingRestore(null);
    setIsBackupModalOpen(false);
  };

  const handleDownloadPdf = async (preferShareSheet = false) => {
    setIsGenerating('PDF');
    try {
      const res = await exportBackupPdfReport(undefined, preferShareSheet);
      if (!res?.cancelled) {
        setRestoreStatus({ type: 'idle' });
        setExportNotice(describeExportSuccess('PDF Business Report', res?.savedVia, res?.byteSize));
        setTimeout(() => setExportNotice(null), 6000);
      }
    } catch (err: unknown) {
      setRestoreStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate PDF report.',
      });
    } finally {
      setIsGenerating(null);
    }
  };

  const handleDownloadExcel = async (preferShareSheet = false) => {
    setIsGenerating('EXCEL');
    try {
      const res = await exportBackupExcelFile(undefined, preferShareSheet);
      if (!res?.cancelled) {
        setRestoreStatus({ type: 'idle' });
        setExportNotice(
          describeExportSuccess('Excel Backup (.xlsx · 11 worksheets)', res?.savedVia, res?.byteSize)
        );
        setTimeout(() => setExportNotice(null), 6000);
      }
    } catch (err: unknown) {
      setRestoreStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate Excel workbook.',
      });
    } finally {
      setIsGenerating(null);
    }
  };

  const handleOpenPdfPreview = async () => {
    setIsGenerating('PDF_PREVIEW');
    try {
      const dataset = getCurrentBusinessDataset();
      const summaryData = buildPdfExportPreviewSummary(dataset);
      const pdfBytes = await exportBackupReportPdfBytes(dataset);
      const bufferCopy = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([bufferCopy], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      setExcelPreview(null);
      setPdfPreview((prev) => {
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        return { blobUrl, summary: summaryData };
      });
    } catch (err: unknown) {
      setRestoreStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to render PDF preview.',
      });
    } finally {
      setIsGenerating(null);
    }
  };

  const handleOpenExcelPreview = () => {
    const dataset = getCurrentBusinessDataset();
    const preview = buildExcelSummaryPreview(dataset, 8);
    if (pdfPreview?.blobUrl) {
      URL.revokeObjectURL(pdfPreview.blobUrl);
      setPdfPreview(null);
    }
    setExcelPreview({
      data: preview,
      activeSheetIdx: 0,
    });
  };

  const handleDownloadFullRecoveryJson = async (preferShareSheet = false) => {
    setIsGenerating('JSON');
    try {
      const res = await exportVerifiedBackupFile(undefined, preferShareSheet);
      if (!res?.cancelled) {
        setExportNotice(
          describeExportSuccess(
            'Full Recovery Backup (.json)',
            res?.savedVia,
            res?.byteSize,
            res?.checksum
          )
        );
        setTimeout(() => setExportNotice(null), 6000);
      }
    } catch (err: unknown) {
      setRestoreStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to export JSON backup.',
      });
    } finally {
      setIsGenerating(null);
    }
  };

  const handleDownloadEncrypted = async (preferShareSheet = false) => {
    if (passphrase.trim().length < 4) {
      setRestoreStatus({
        type: 'error',
        message: 'Enter a backup passphrase (minimum 4 characters) to encrypt the full recovery file.',
      });
      return;
    }
    setIsGenerating('ENC');
    try {
      const res = await exportEncryptedBackupFile(passphrase, undefined, preferShareSheet);
      if (!res?.cancelled) {
        setRestoreStatus({ type: 'idle' });
        setExportNotice(
          describeExportSuccess(
            'Encrypted Full Recovery Backup (.skbackup.json)',
            res?.savedVia,
            res?.byteSize,
            res?.checksum
          )
        );
        setTimeout(() => setExportNotice(null), 6000);
      }
    } catch (err: unknown) {
      setRestoreStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to encrypt backup file.',
      });
    } finally {
      setIsGenerating(null);
    }
  };

  const inspectFileContent = async (
    content: string,
    fileName: string,
    fileSizeKB: number,
    decryptPass?: string
  ) => {
    const parsed = await inspectAndValidateBackupContent(content, decryptPass);
    if (parsed.requiresPassphrase && !decryptPass) {
      setEncryptedPrompt({
        rawContent: content,
        fileName,
        fileSizeKB,
        decryptPassphrase: '',
      });
      setRestoreStatus({ type: 'idle' });
      return;
    }

    if (!parsed.valid || !parsed.data) {
      if (encryptedPrompt) {
        setEncryptedPrompt((prev) =>
          prev ? { ...prev, error: parsed.error || 'Incorrect passphrase or corrupted file.' } : null
        );
      } else {
        setRestoreStatus({
          type: 'error',
          message: parsed.error || 'Failed to parse backup file. Please choose a valid Full Recovery Backup (.json or .skbackup.json).',
        });
      }
      return;
    }

    setEncryptedPrompt(null);
    setPendingRestore({
      rawContent: content,
      passphrase: decryptPass,
      parsed,
      fileName,
      fileSizeKB,
    });
    setRestoreStatus({ type: 'idle' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileSizeKB = Math.round((file.size / 1024) * 10) / 10;
    const reader = new FileReader();

    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content || !content.trim()) {
        setRestoreStatus({
          type: 'error',
          message: 'The selected backup file is completely empty.',
        });
        return;
      }
      await inspectFileContent(content, file.name, fileSizeKB);
    };

    reader.readAsText(file);
    e.target.value = '';
  };

  const confirmPendingRestore = async () => {
    if (!pendingRestore) return;

    const result = await restoreBackupFromJSONSafe(
      pendingRestore.rawContent,
      pendingRestore.passphrase
    );
    if (result.success) {
      setRestoreStatus({
        type: 'success',
        message: `Successfully restored ${result.count || 0} transactions & ${
          result.verifiedCounts?.billDocuments ?? pendingRestore.parsed.summary?.billDocumentsCount ?? 0
        } bill documents for "${pendingRestore.parsed.data?.profile?.storeName || 'Arjun Groceries'}"! A pre-restore rollback checkpoint was saved in IndexedDB.`,
        verifiedCounts: result.verifiedCounts,
      });
      setPendingRestore(null);
    } else {
      setRestoreStatus({
        type: 'error',
        message: result.error || 'Failed to restore backup.',
      });
    }
  };

  const activeExcelSheet = excelPreview
    ? excelPreview.data.sheets[excelPreview.activeSheetIdx] || excelPreview.data.sheets[0]
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-950 text-white p-5 sm:p-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shadow-inner">
              <Database className="w-6 h-6 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg sm:text-xl font-bold tracking-tight">
                  Arjun Groceries · Backup &amp; Restore Center
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/30 text-emerald-200 uppercase tracking-wider">
                  PDF &amp; Excel Ready
                </span>
              </div>
              <p className="text-xs text-emerald-200/90 mt-1">
                Download live PDF &amp; 11-sheet Excel (.xlsx) reports, preview exports, or restore complete IndexedDB backups safely.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            aria-label="Close backup modal"
            className="p-1.5 rounded-lg text-emerald-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {/* Status Banners */}
          {exportNotice && (
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-200 animate-in fade-in">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <strong className="font-bold">Export Ready</strong>
                <p className="text-emerald-700 dark:text-emerald-300 mt-0.5">{exportNotice}</p>
              </div>
            </div>
          )}

          {restoreStatus.type === 'success' && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 rounded-xl space-y-2 text-xs text-emerald-900 dark:text-emerald-200 animate-in fade-in shadow-xs">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold text-sm text-emerald-950 dark:text-emerald-100">
                    Complete Backup Restored &amp; Verified in IndexedDB
                  </strong>
                  <p className="text-emerald-800 dark:text-emerald-300 mt-1 leading-relaxed">
                    {restoreStatus.message}
                  </p>
                </div>
              </div>
              {restoreStatus.verifiedCounts && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-emerald-200/70 dark:border-emerald-800/70 text-[11px]">
                  <div className="bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg">
                    <span className="text-slate-500 block">Customers</span>
                    <strong>{restoreStatus.verifiedCounts.customers}</strong>
                  </div>
                  <div className="bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg">
                    <span className="text-slate-500 block">Suppliers</span>
                    <strong>{restoreStatus.verifiedCounts.suppliers}</strong>
                  </div>
                  <div className="bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg">
                    <span className="text-slate-500 block">Sales Bills</span>
                    <strong>{restoreStatus.verifiedCounts.sales}</strong>
                  </div>
                  <div className="bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg">
                    <span className="text-slate-500 block">Inventory</span>
                    <strong>{restoreStatus.verifiedCounts.products}</strong>
                  </div>
                  <div className="bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg">
                    <span className="text-slate-500 block">Attachments</span>
                    <strong>{restoreStatus.verifiedCounts.billDocuments}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {restoreStatus.type === 'error' && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 rounded-xl flex items-start gap-3 text-xs text-rose-900 dark:text-rose-200 animate-in fade-in">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold text-rose-950 dark:text-rose-100">
                  Validation or Restore Notice
                </strong>
                <p className="text-rose-700 dark:text-rose-300 mt-1 leading-relaxed">
                  {restoreStatus.message}
                </p>
              </div>
            </div>
          )}

          {encryptedPrompt && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-400 dark:border-emerald-700 rounded-2xl space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-emerald-700" />
                  <span>Encrypted Recovery Backup: {encryptedPrompt.fileName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEncryptedPrompt(null)}
                  className="p-1 rounded-lg hover:bg-emerald-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {encryptedPrompt.error && (
                <div className="text-rose-600 dark:text-rose-400 font-semibold">{encryptedPrompt.error}</div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={encryptedPrompt.decryptPassphrase}
                  onChange={(e) =>
                    setEncryptedPrompt((prev) =>
                      prev ? { ...prev, decryptPassphrase: e.target.value, error: undefined } : null
                    )
                  }
                  placeholder="Enter backup decryption passphrase..."
                  className="flex-1 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() =>
                    inspectFileContent(
                      encryptedPrompt.rawContent,
                      encryptedPrompt.fileName,
                      encryptedPrompt.fileSizeKB,
                      encryptedPrompt.decryptPassphrase
                    )
                  }
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                >
                  Decrypt &amp; Preview
                </button>
              </div>
            </div>
          )}

          {/* Staged Restore Review Screen */}
          {pendingRestore && (
            <div className="p-4 sm:p-5 bg-amber-50/70 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-800 rounded-2xl space-y-4 animate-in fade-in">
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/60 rounded-xl text-amber-800 dark:text-amber-300">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                      Review &amp; Confirm Complete Data Restore
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Backup validated cleanly. Inspect all record counts below before replacing active shop data.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingRestore(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer"
                  title="Cancel restore"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-amber-200 dark:border-amber-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Backup Date
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 block truncate">
                    {pendingRestore.parsed.metadata?.backupDate
                      ? new Date(pendingRestore.parsed.metadata.backupDate).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Unknown'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Target Store
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 block truncate">
                    {pendingRestore.parsed.metadata?.storeName || 'Arjun Groceries'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Schema Version
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 block">
                    v{pendingRestore.parsed.metadata?.version || '2.2'} · {pendingRestore.parsed.metadata?.schemaVersion || '2.2.0'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    File &amp; Size
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 block truncate">
                    {pendingRestore.fileName} ({pendingRestore.fileSizeKB} KB)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Sales Bills</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                    {pendingRestore.parsed.summary?.salesCount || 0} bills
                  </strong>
                  <span className="text-emerald-700 dark:text-emerald-400 block text-[10px] font-semibold">
                    {formatINR(pendingRestore.parsed.summary?.salesTotalVolume || 0)}
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Customers &amp; Udhar</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                    {pendingRestore.parsed.summary?.customersCount || 0} customers
                  </strong>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                    {pendingRestore.parsed.summary?.customerTransactionsCount || 0} ledger entries
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Suppliers &amp; Purchases</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                    {pendingRestore.parsed.summary?.suppliersCount || 0} suppliers
                  </strong>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                    {pendingRestore.parsed.summary?.supplierTransactionsCount || 0} entries
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Expenses</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                    {pendingRestore.parsed.summary?.expenseCount || 0} entries
                  </strong>
                  <span className="text-amber-700 dark:text-amber-400 block text-[10px] font-semibold">
                    {formatINR(pendingRestore.parsed.summary?.expenseTotalVolume || 0)}
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Cashbook (Rokad)</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                    {pendingRestore.parsed.summary?.cashbookCount || 0} entries
                  </strong>
                  <span className="text-teal-700 dark:text-teal-400 block text-[10px]">
                    Opening: {formatINR(pendingRestore.parsed.summary?.openingBalances?.cashOpeningBalance || 0)}
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Inventory &amp; Attachments</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                    {pendingRestore.parsed.summary?.productsCount || 0} items
                  </strong>
                  <span className="text-indigo-700 dark:text-indigo-400 block text-[10px]">
                    {pendingRestore.parsed.summary?.billDocumentsCount || 0} bill photos/PDFs
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold ${
                    pendingRestore.parsed.checksumValid
                      ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
                      : 'bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-200'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>
                    {pendingRestore.parsed.checksumValid
                      ? `SHA-256 Checksum Verified (${pendingRestore.parsed.expectedChecksum?.slice(0, 10) || 'OK'})`
                      : 'Unsigned Legacy Backup'}
                  </span>
                </span>
              </div>

              <BackupReconciliationCard report={pendingRestore.parsed.reconciliationReport} />

              {pendingRestore.parsed.warnings && pendingRestore.parsed.warnings.length > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-100/80 dark:bg-amber-950/50 border border-amber-300 text-[11px] text-amber-900 dark:text-amber-200">
                  <strong>Compatibility Notice:</strong> {pendingRestore.parsed.warnings.join(' ')}
                </div>
              )}

              <div className="p-3 bg-amber-100/70 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-xl text-xs text-amber-950 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                  <span>
                    <strong>Safety Checkpoint:</strong> An automatic rollback snapshot will be saved in IndexedDB before replacing current records.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadFullRecoveryJson(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-800 dark:text-slate-100 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 shadow-xs cursor-pointer shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                  <span>Save Current Copy First</span>
                </button>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingRestore(null)}
                  className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmPendingRestore}
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Confirm &amp; Restore Complete Backup</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Store Snapshot Banner */}
          <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-4 border border-slate-200/80 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Live IndexedDB Business Dataset
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {profile.storeName || 'Arjun Groceries'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
                <span>·</span>
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>11 Excel Sheets · Multi-Section PDF</span>
              </div>
            </div>
            <div className="text-left sm:text-right bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Live Records Included</div>
              <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-400">
                {summary.totalTransactions} Records
              </div>
            </div>
          </div>

          {/* Live Breakdown Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <ShoppingCart className="w-3.5 h-3.5 text-emerald-600" />
                <span>Sales Bills</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
                {summary.salesCount} bills
              </div>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                {formatINR(summary.salesTotalVolume)}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>Customers &amp; Udhar</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
                {summary.customerTransactionsCount} entries
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {summary.customersCount} customers · Open {formatINR(summary.openingBalances?.totalCustomerOpening || 0)}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <Truck className="w-3.5 h-3.5 text-purple-600" />
                <span>Suppliers &amp; Purchases</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
                {summary.supplierTransactionsCount} entries
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {summary.suppliersCount} suppliers · Open {formatINR(summary.openingBalances?.totalSupplierOpening || 0)}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <Wallet className="w-3.5 h-3.5 text-amber-600" />
                <span>Expenses</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
                {summary.expenseCount} entries
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                {formatINR(summary.expenseTotalVolume)}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <FileText className="w-3.5 h-3.5 text-teal-600" />
                <span>Cashbook (Rokad)</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
                {summary.cashbookCount} entries
              </div>
              <div className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">
                Opening: {formatINR(summary.openingBalances?.cashOpeningBalance || 0)}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <HardDrive className="w-3.5 h-3.5 text-indigo-600" />
                <span>Stock &amp; Bill Docs</span>
              </div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
                {summary.productsCount} items
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {summary.billDocumentsCount || 0} photos &amp; PDFs
              </div>
            </div>
          </div>

          {/* Primary PDF & Excel Report Export Buttons */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800 space-y-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h4 className="text-sm font-bold text-emerald-950 dark:text-emerald-100">
                  Professional PDF &amp; Excel Business Exports
                </h4>
                <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Human-readable accounting reports exported from live records (not a replacement for Full Recovery JSON restore).
                  </span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isGenerating !== null}
                onClick={() => handleDownloadPdf(false)}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>{isGenerating === 'PDF' ? 'Generating PDF...' : 'Download PDF Backup'}</span>
              </button>

              <button
                type="button"
                disabled={isGenerating !== null}
                onClick={() => handleDownloadExcel(false)}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-emerald-900 hover:bg-emerald-950 disabled:opacity-60 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                <span>
                  {isGenerating === 'EXCEL'
                    ? 'Building .xlsx Workbook...'
                    : 'Download Excel Backup (.xlsx)'}
                </span>
              </button>

              <button
                type="button"
                disabled={isGenerating !== null}
                onClick={handleOpenPdfPreview}
                className="flex items-center justify-center gap-2 py-2.5 px-4 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-slate-800 text-emerald-800 dark:text-emerald-200 rounded-xl font-bold text-xs border border-emerald-300 dark:border-emerald-700 transition-colors cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>{isGenerating === 'PDF_PREVIEW' ? 'Rendering PDF...' : 'Preview PDF'}</span>
              </button>

              <button
                type="button"
                disabled={isGenerating !== null}
                onClick={handleOpenExcelPreview}
                className="flex items-center justify-center gap-2 py-2.5 px-4 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-slate-800 text-emerald-800 dark:text-emerald-200 rounded-xl font-bold text-xs border border-emerald-300 dark:border-emerald-700 transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Preview Excel Summary</span>
              </button>
            </div>
          </div>

          {/* Interactive PDF Preview Panel */}
          {pdfPreview && (
            <div className="border-2 border-emerald-400 dark:border-emerald-700 rounded-2xl bg-white dark:bg-slate-900 overflow-hidden shadow-md space-y-3 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <div>
                  <h5 className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-100 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-emerald-700" />
                    <span>PDF Report Preview (~{pdfPreview.summary.estimatedPages} pages)</span>
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Sales: {formatINR(pdfPreview.summary.metrics.totalSales)} · Customer Udhar: {formatINR(pdfPreview.summary.metrics.totalCustomerOutstanding)} · Available Cash: {formatINR(pdfPreview.summary.metrics.availableCash)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={pdfPreview.blobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Tab</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(false)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(pdfPreview.blobUrl);
                      setPdfPreview(null);
                    }}
                    aria-label="Close PDF preview"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[11px]">
                {pdfPreview.summary.sections.map((sec) => (
                  <div
                    key={sec.id}
                    className="p-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900"
                  >
                    <div className="font-bold text-emerald-950 dark:text-emerald-200 truncate" title={sec.title}>
                      {sec.title}
                    </div>
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                      {sec.recordCount} rows
                    </div>
                  </div>
                ))}
              </div>

              <iframe
                src={pdfPreview.blobUrl}
                title="Arjun Groceries PDF Backup Preview"
                className="w-full h-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100"
              />
            </div>
          )}

          {/* Interactive 11-Sheet Excel Summary Preview Panel */}
          {excelPreview && activeExcelSheet && (
            <div className="border-2 border-emerald-500 dark:border-emerald-700 rounded-2xl bg-white dark:bg-slate-900 p-4 space-y-3 shadow-md">
              <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <div>
                  <h5 className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-100 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    <span>Excel Workbook Summary Preview (11 Worksheets)</span>
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Inspect sheets, column headers, INR formatting &amp; live rows before downloading `.xlsx`.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadExcel(false)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-[11px] font-bold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .xlsx</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExcelPreview(null)}
                    aria-label="Close Excel preview"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Worksheet Selector Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {excelPreview.data.sheets.map((sheet, idx) => (
                  <button
                    key={sheet.name}
                    type="button"
                    onClick={() =>
                      setExcelPreview((prev) =>
                        prev ? { ...prev, activeSheetIdx: idx } : null
                      )
                    }
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap border cursor-pointer transition-colors ${
                      idx === excelPreview.activeSheetIdx
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-emerald-50'
                    }`}
                  >
                    {sheet.name} ({sheet.rowCount})
                  </button>
                ))}
              </div>

              {/* Active Sheet Table Preview */}
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-emerald-800 text-white">
                      {activeExcelSheet.columns.map((col) => (
                        <th key={col} className="px-2.5 py-2 font-bold whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeExcelSheet.sampleRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={activeExcelSheet.columns.length}
                          className="px-3 py-4 text-center text-slate-500 italic"
                        >
                          No rows recorded yet in {activeExcelSheet.name}. Header row with filter will still be created cleanly.
                        </td>
                      </tr>
                    ) : (
                      activeExcelSheet.sampleRows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-emerald-50/40 dark:hover:bg-slate-800/40">
                          {row.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className="px-2.5 py-1.5 text-slate-700 dark:text-slate-200 whitespace-nowrap max-w-[180px] truncate"
                            >
                              {String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {activeExcelSheet.rowCount > activeExcelSheet.sampleRows.length && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Showing first {activeExcelSheet.sampleRows.length} of {activeExcelSheet.rowCount} total rows in &ldquo;{activeExcelSheet.name}&rdquo;. Full `.xlsx` export includes all {activeExcelSheet.rowCount} rows.
                </div>
              )}
            </div>
          )}

          {/* Restore Complete Backup Section (Preserves Full Recovery including Bill Photos/PDFs) */}
          <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Upload className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>Restore Complete Backup</span>
                </h5>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Restore all records, settings, opening balances, and bill photos/PDFs from a Full Backup (.json or encrypted .skbackup.json).
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-colors shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <span>Choose Full Backup (.json)</span>
                <input
                  type="file"
                  accept=".json,.skbackup.json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Secondary Full Recovery Export Subsection (Encrypted / Internal JSON) */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Full Recovery Archive (Includes Bill Photos, PDFs &amp; Settings)</span>
                </div>
                <button
                  type="button"
                  disabled={isGenerating !== null}
                  onClick={() => handleDownloadFullRecoveryJson(false)}
                  className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  Save Unencrypted Recovery (.json)
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Set passphrase (min 4 chars) for encrypted recovery archive..."
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={isGenerating !== null}
                  onClick={() => handleDownloadEncrypted(false)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold cursor-pointer shrink-0"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Encrypted Recovery (.skbackup.json)</span>
                </button>
                <button
                  type="button"
                  disabled={isGenerating !== null}
                  onClick={() => handleDownloadEncrypted(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-bold cursor-pointer shrink-0"
                >
                  <Share2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Share (Android)</span>
                </button>
              </div>
            </div>
          </div>

          <CloudBackupSection
            onRestoreSuccess={(verifiedCounts) => {
              setRestoreStatus({
                type: 'success',
                message: `Successfully restored encrypted cloud backup (${verifiedCounts?.sales ?? 0} sales, ${verifiedCounts?.customers ?? 0} customers, ${verifiedCounts?.billDocuments ?? 0} bill documents) into IndexedDB!`,
                verifiedCounts,
              });
            }}
          />

          <ExternalRecoveryGuide />
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>100% Local-First Offline Storage on this device.</span>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="px-4 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
