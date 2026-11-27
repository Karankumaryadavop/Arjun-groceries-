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
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  HardDrive,
  History,
  Info,
  Lock,
  Mail,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppVersionControls,
  PWAInstallButton,
  useTrackActiveTransaction,
} from './PWAInstallButton';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function describeExportAction(
  label: string,
  savedVia?: BackupExportMethod,
  byteSize?: number,
  checksum?: string
): string {
  const sizePart = byteSize && byteSize > 0 ? ` · ${formatByteSize(byteSize)}` : '';
  const sumPart = checksum ? ` · SHA-256 ${checksum.slice(0, 12)}` : '';
  if (savedVia === 'file_picker') {
    return `${label} saved directly to your chosen folder${sizePart}${sumPart}.`;
  }
  if (savedVia === 'share_sheet') {
    return `${label} opened in your Android Share Sheet (save to Drive / Files)${sizePart}${sumPart}.`;
  }
  return `${label} download queued${sizePart}${sumPart} — check Chrome Downloads bar or Android notification to confirm file save.`;
}

export const SyncBackupDashboard: React.FC = () => {
  const {
    storageStatus,
    migrationReport,
    localBackups,
    autoBackupSettings,
    createManualLocalBackup,
    restoreFromLocalBackupSnapshot,
    deleteLocalBackupSnapshot,
    getCurrentBusinessDataset,
    exportBackupPdfReport,
    exportBackupExcelFile,
    exportVerifiedBackupFile,
    exportEncryptedBackupFile,
    restoreBackupFromJSONSafe,
    updateAutoBackupSettings,
    getBackupSummary,
    purgeLegacyLocalStorageArchive,
    cloudAuthUser,
    firestoreSyncStatus,
    syncNowToFirestore,
    pullFromFirestore,
    resendEmailVerification,
    refreshEmailVerificationStatus,
  } = useStore();

  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    verifiedCounts?: VerifiedRestoreCounts;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [firestoreActionBusy, setFirestoreActionBusy] = useState(false);
  const [confirmPullFromCloud, setConfirmPullFromCloud] = useState(false);
  const [verificationMsg, setVerificationMsg] = useState<string | null>(null);
  useTrackActiveTransaction('local-backup-busy', isBusy || firestoreActionBusy);
  const [encryptionPassphrase, setEncryptionPassphrase] = useState('');
  const [confirmLegacyPurge, setConfirmLegacyPurge] = useState(false);

  const [pdfPreview, setPdfPreview] = useState<{
    blobUrl: string;
    summary: PdfExportPreviewSummary;
  } | null>(null);
  const [excelPreview, setExcelPreview] = useState<{
    data: ExcelSummaryPreview;
    activeSheetIdx: number;
  } | null>(null);

  // Encrypted import passphrase prompt
  const [encryptedImportPrompt, setEncryptedImportPrompt] = useState<{
    rawContent: string;
    fileName: string;
    passphrase: string;
    error?: string;
  } | null>(null);

  // Staged file restore preview & explicit confirmation
  const [stagedFileRestore, setStagedFileRestore] = useState<{
    rawJson: string;
    passphrase?: string;
    fileName: string;
    parsed: InspectedBackupResult;
  } | null>(null);

  // Staged snapshot restore explicit confirmation
  const [stagedSnapshotId, setStagedSnapshotId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pdfPreview?.blobUrl) {
        URL.revokeObjectURL(pdfPreview.blobUrl);
      }
    };
  }, [pdfPreview?.blobUrl]);

  const summary = getBackupSummary();
  const dailyCount = localBackups.filter((b) => b.bucket === 'DAILY').length;
  const weeklyCount = localBackups.filter((b) => b.bucket === 'WEEKLY').length;
  const recoveryCount = localBackups.filter((b) => b.bucket === 'RECOVERY').length;
  const usagePct = Math.min(100, Math.round((storageStatus.usagePct || 0) * 10) / 10);

  const handleManualBackup = async () => {
    setIsBusy(true);
    try {
      const snap = await createManualLocalBackup('Manual snapshot from Local Storage & Backup Dashboard');
      if (snap) {
        setStatusBanner({
          type: 'success',
          message: `Local IndexedDB snapshot saved (${snap.summary.totalTransactions} transactions, ${snap.summary.billDocumentsCount || 0} bill docs, checksum ${snap.checksum.slice(0, 10)}).`,
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadPdf = async (preferShareSheet = false) => {
    setIsBusy(true);
    try {
      const res = await exportBackupPdfReport(undefined, preferShareSheet);
      if (!res?.cancelled) {
        setStatusBanner({
          type: 'success',
          message: describeExportAction('PDF Business Report', res?.savedVia, res?.byteSize),
        });
      }
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate PDF report.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadExcel = async (preferShareSheet = false) => {
    setIsBusy(true);
    try {
      const res = await exportBackupExcelFile(undefined, preferShareSheet);
      if (!res?.cancelled) {
        setStatusBanner({
          type: 'success',
          message: describeExportAction('Excel Backup (.xlsx · 11 sheets)', res?.savedVia, res?.byteSize),
        });
      }
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate Excel workbook.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handlePreviewPdf = async () => {
    setIsBusy(true);
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
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to generate PDF preview.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handlePreviewExcel = () => {
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

  const handleExportEncrypted = async (preferShareSheet = false) => {
    if (encryptionPassphrase.trim().length < 4) {
      setStatusBanner({
        type: 'error',
        message: 'Enter a passphrase of at least 4 characters to create an encrypted recovery backup.',
      });
      return;
    }
    setIsBusy(true);
    try {
      const res = await exportEncryptedBackupFile(
        encryptionPassphrase,
        undefined,
        preferShareSheet
      );
      if (!res?.cancelled) {
        setStatusBanner({
          type: 'success',
          message: describeExportAction(
            'AES-256-GCM encrypted recovery archive (.skbackup.json)',
            res?.savedVia,
            res?.byteSize,
            res?.checksum
          ),
        });
      }
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not export encrypted backup.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportVerified = async (preferShareSheet = false) => {
    setIsBusy(true);
    try {
      const res = await exportVerifiedBackupFile(undefined, preferShareSheet);
      if (!res?.cancelled) {
        setStatusBanner({
          type: 'success',
          message: describeExportAction(
            'Full Recovery Backup (.json)',
            res?.savedVia,
            res?.byteSize,
            res?.checksum
          ),
        });
      }
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not export JSON backup.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const inspectBackupContent = async (
    text: string,
    fileName: string,
    passphrase?: string
  ) => {
    const parsed = await inspectAndValidateBackupContent(text, passphrase);
    if (parsed.requiresPassphrase && !passphrase) {
      setEncryptedImportPrompt({
        rawContent: text,
        fileName,
        passphrase: '',
      });
      setStatusBanner(null);
      return;
    }

    if (!parsed.valid || !parsed.data) {
      if (encryptedImportPrompt) {
        setEncryptedImportPrompt((prev) =>
          prev ? { ...prev, error: parsed.error || 'Incorrect passphrase or corrupted file.' } : null
        );
      } else {
        setStatusBanner({
          type: 'error',
          message: parsed.error || 'Invalid or corrupted backup file. Choose a valid Full Backup (.json or .skbackup.json).',
        });
      }
      return;
    }

    setEncryptedImportPrompt(null);
    setStagedFileRestore({
      rawJson: text,
      passphrase,
      fileName,
      parsed,
    });
    setStatusBanner(null);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = String(ev.target?.result || '');
      if (!text.trim()) {
        setStatusBanner({ type: 'error', message: 'Selected backup file is empty.' });
        return;
      }
      await inspectBackupContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const confirmFileRestore = async () => {
    if (!stagedFileRestore) return;
    setIsBusy(true);
    try {
      const res = await restoreBackupFromJSONSafe(
        stagedFileRestore.rawJson,
        stagedFileRestore.passphrase
      );
      if (res.success) {
        setStatusBanner({
          type: 'success',
          message: `Restored ${res.count || 0} transactions & ${
            res.verifiedCounts?.billDocuments ?? stagedFileRestore.parsed.summary?.billDocumentsCount ?? 0
          } bill documents safely and verified record counts in IndexedDB. A pre-restore rollback checkpoint was saved automatically.`,
          verifiedCounts: res.verifiedCounts,
        });
        setStagedFileRestore(null);
      } else {
        setStatusBanner({
          type: 'error',
          message: res.error || 'Restore failed; existing data was kept untouched.',
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const confirmSnapshotRestore = async () => {
    if (!stagedSnapshotId) return;
    setIsBusy(true);
    try {
      const res = await restoreFromLocalBackupSnapshot(stagedSnapshotId);
      if (res.success) {
        setStatusBanner({
          type: 'success',
          message: `Restored local snapshot (${res.count || 0} transactions) and verified record counts in IndexedDB.`,
          verifiedCounts: res.verifiedCounts,
        });
        setStagedSnapshotId(null);
      } else {
        setStatusBanner({
          type: 'error',
          message: res.error || 'Snapshot restore failed.',
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const stagedSnapshot = stagedSnapshotId
    ? localBackups.find((b) => b.id === stagedSnapshotId) || null
    : null;

  const activeExcelSheet = excelPreview
    ? excelPreview.data.sheets[excelPreview.activeSheetIdx] || excelPreview.data.sheets[0]
    : null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 sm:p-6 border border-emerald-200 dark:border-emerald-900/60 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Database className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              Arjun Groceries · Backup, PDF/Excel Reports &amp; Local Database
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              {storageStatus.cloudSyncConfigured
                ? 'Local-First + Cloud Firestore'
                : 'Single-Phone Local Only'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            IndexedDB ({storageStatus.dbName} v{storageStatus.dbVersion}) keeps all records fast offline, synced with Cloud Firestore ({firestoreSyncStatus.projectId}).
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <PWAInstallButton variant="settings" />
          <AppVersionControls />
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
              storageStatus.isOnline
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
            }`}
          >
            {storageStatus.isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{storageStatus.isOnline ? 'Online' : 'Offline Ready'}</span>
          </span>
        </div>
      </div>

      {/* Quota Warning Banner (>=80%) */}
      {storageStatus.quotaWarning && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>Storage Nearing Limit ({usagePct}% used):</strong> Device browser quota is filling up. Export a Full Recovery Backup and clean up old snapshots soon to avoid QuotaExceededError.
          </div>
        </div>
      )}

      {/* Feedback Banner */}
      {statusBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs space-y-2 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : statusBanner.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              : 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 font-medium">
              {statusBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" />
              ) : statusBanner.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              ) : (
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              )}
              <span>{statusBanner.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="p-0.5 hover:opacity-70 cursor-pointer"
              aria-label="Dismiss storage notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {statusBanner.verifiedCounts && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-emerald-200/70 dark:border-emerald-800/70 text-[11px]">
              <div className="bg-white/80 dark:bg-slate-900/70 px-2 py-1 rounded-lg">
                <span className="text-slate-500 block">Customers</span>
                <strong>{statusBanner.verifiedCounts.customers}</strong>
              </div>
              <div className="bg-white/80 dark:bg-slate-900/70 px-2 py-1 rounded-lg">
                <span className="text-slate-500 block">Suppliers</span>
                <strong>{statusBanner.verifiedCounts.suppliers}</strong>
              </div>
              <div className="bg-white/80 dark:bg-slate-900/70 px-2 py-1 rounded-lg">
                <span className="text-slate-500 block">Sales Bills</span>
                <strong>{statusBanner.verifiedCounts.sales}</strong>
              </div>
              <div className="bg-white/80 dark:bg-slate-900/70 px-2 py-1 rounded-lg">
                <span className="text-slate-500 block">Inventory</span>
                <strong>{statusBanner.verifiedCounts.products}</strong>
              </div>
              <div className="bg-white/80 dark:bg-slate-900/70 px-2 py-1 rounded-lg">
                <span className="text-slate-500 block">Attachments</span>
                <strong>{statusBanner.verifiedCounts.billDocuments}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Storage Telemetry Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Last Local Snapshot
          </div>
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-1">
            {storageStatus.lastBackupAt
              ? new Date(storageStatus.lastBackupAt).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Pending'}
          </div>
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
            {dailyCount} Daily · {weeklyCount} Weekly{recoveryCount > 0 ? ` · ${recoveryCount} Recovery` : ''}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Persistent Storage
          </div>
          <div
            className={`text-xs font-bold mt-1 flex items-center gap-1 ${
              storageStatus.isPersistedStorage
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {storageStatus.isPersistedStorage ? (
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{storageStatus.isPersistedStorage ? 'Protected' : 'Best-Effort'}</span>
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            {storageStatus.isPersistedStorage
              ? 'OS eviction shielded'
              : 'Install PWA or export regularly'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Local DB Usage
          </div>
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-1">
            {formatBytes(storageStatus.usageBytes)}
          </div>
          <div className="mt-1 w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                storageStatus.quotaWarning ? 'bg-amber-500' : 'bg-emerald-600'
              }`}
              style={{ width: `${Math.max(2, usagePct)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            {storageStatus.quotaBytes > 0
              ? `${usagePct}% of ${formatBytes(storageStatus.quotaBytes)}`
              : 'Quota Auto-Managed'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Bill Documents
          </div>
          <div className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1 flex items-center gap-1">
            <FileCheck2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            <span>{storageStatus.billDocumentsCount ?? summary.billDocumentsCount ?? 0} Files</span>
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            Native Blob IDB Store
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Records Protected
          </div>
          <div className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1">
            {summary.totalTransactions} Tx
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            {summary.customersCount} Cust · {summary.productsCount} Items
          </div>
        </div>
      </div>

      {/* Cloud Firestore Database Sync Section */}
      <div
        data-testid="firestore-sync-card"
        className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Cloud Firestore Database
                </h4>
                <span
                  data-testid="firestore-sync-badge"
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                    firestoreSyncStatus.state === 'SYNCED'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      : firestoreSyncStatus.state === 'SYNCING'
                      ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                      : firestoreSyncStatus.state === 'NEEDS_VERIFICATION'
                      ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                      : firestoreSyncStatus.state === 'ERROR'
                      ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {firestoreSyncStatus.state === 'SYNCED'
                    ? 'Synced'
                    : firestoreSyncStatus.state === 'SYNCING'
                    ? 'Syncing...'
                    : firestoreSyncStatus.state === 'NEEDS_VERIFICATION'
                    ? 'Verify Email'
                    : firestoreSyncStatus.state === 'ERROR'
                    ? 'Sync Error'
                    : cloudAuthUser
                    ? 'Connected'
                    : 'Sign In Needed'}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                Project: <strong className="font-semibold">{firestoreSyncStatus.projectId}</strong>
                {cloudAuthUser?.email ? ` · Account: ${cloudAuthUser.email}` : ' · Sign in with Email or Google to sync'}
                {firestoreSyncStatus.lastSyncedAt
                  ? ` · Last synced ${new Date(firestoreSyncStatus.lastSyncedAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              data-testid="firestore-sync-now-btn"
              disabled={
                firestoreActionBusy ||
                firestoreSyncStatus.state === 'SYNCING' ||
                !cloudAuthUser?.uid ||
                !storageStatus.isOnline
              }
              onClick={async () => {
                setFirestoreActionBusy(true);
                setVerificationMsg(null);
                try {
                  const res = await syncNowToFirestore();
                  if (res.success) {
                    setStatusBanner({
                      type: 'success',
                      message: `Synced store records to Cloud Firestore (${firestoreSyncStatus.projectId}).`,
                    });
                  } else if (res.error) {
                    setStatusBanner({ type: 'error', message: res.error });
                  }
                } finally {
                  setFirestoreActionBusy(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#0d7f1f] hover:bg-[#086917] disabled:opacity-50 text-white shadow-xs transition-colors cursor-pointer"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>
                {firestoreSyncStatus.state === 'SYNCING' ? 'Syncing...' : 'Sync to Firestore'}
              </span>
            </button>

            <button
              type="button"
              data-testid="firestore-pull-btn"
              disabled={
                firestoreActionBusy ||
                firestoreSyncStatus.state === 'SYNCING' ||
                !cloudAuthUser?.uid ||
                !storageStatus.isOnline
              }
              onClick={() => setConfirmPullFromCloud((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 disabled:opacity-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 transition-colors cursor-pointer"
            >
              <CloudDownload className="w-3.5 h-3.5" />
              <span>Pull from Cloud</span>
            </button>
          </div>
        </div>

        {/* Email verification prompt for newly created Email/Password accounts */}
        {cloudAuthUser && !cloudAuthUser.emailVerified && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-2">
            <div className="flex items-start gap-2">
              <Mail className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>
                Verify your email address (<strong>{cloudAuthUser.email}</strong>) to unlock Cloud Firestore sync. Google Sign-In accounts are verified automatically.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={firestoreActionBusy}
                onClick={async () => {
                  setFirestoreActionBusy(true);
                  try {
                    const res = await resendEmailVerification();
                    setVerificationMsg(
                      res.success
                        ? 'Verification email sent! Open the link in your inbox, then click Refresh Status.'
                        : res.error || 'Could not send verification email.'
                    );
                  } finally {
                    setFirestoreActionBusy(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
              >
                Resend Verification Email
              </button>
              <button
                type="button"
                disabled={firestoreActionBusy}
                onClick={async () => {
                  setFirestoreActionBusy(true);
                  try {
                    const res = await refreshEmailVerificationStatus();
                    setVerificationMsg(
                      res.verified
                        ? 'Email verified! Cloud Firestore sync is now unlocked.'
                        : res.error || 'Not verified yet — click the verification link in your inbox first.'
                    );
                  } finally {
                    setFirestoreActionBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>I&apos;ve Verified — Refresh</span>
              </button>
            </div>
            {verificationMsg && <p className="text-[11px] font-semibold">{verificationMsg}</p>}
          </div>
        )}

        {/* Explicit confirmation before pulling cloud records into local store */}
        {confirmPullFromCloud && (
          <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-xs text-sky-950 dark:text-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              Pulling from Cloud Firestore replaces your local store records with your cloud data (a local safety snapshot is created first). Continue?
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={firestoreActionBusy}
                onClick={async () => {
                  setFirestoreActionBusy(true);
                  try {
                    const res = await pullFromFirestore();
                    setConfirmPullFromCloud(false);
                    if (res.success && res.emptyRemote) {
                      setStatusBanner({
                        type: 'info',
                        message:
                          'No cloud records found in Firestore yet for this account. Click "Sync to Firestore" to upload your current store data.',
                      });
                    } else if (res.success) {
                      setStatusBanner({
                        type: 'success',
                        message: `Pulled store data from Cloud Firestore (${res.counts?.sales ?? 0} sales, ${res.counts?.customers ?? 0} customers, ${res.counts?.products ?? 0} products).`,
                      });
                    } else if (res.error) {
                      setStatusBanner({ type: 'error', message: res.error });
                    }
                  } finally {
                    setFirestoreActionBusy(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-800 text-white cursor-pointer"
              >
                Confirm Pull
              </button>
              <button
                type="button"
                onClick={() => setConfirmPullFromCloud(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Firestore error notice */}
        {firestoreSyncStatus.lastError && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200 space-y-1">
            <div className="flex items-start gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{firestoreSyncStatus.lastError}</span>
            </div>
            {firestoreSyncStatus.permissionDenied && (
              <p className="text-[11px] text-red-700 dark:text-red-300 pl-6">
                Open Firebase Console → <strong>arjun-groceries</strong> → Firestore Database → Rules and publish the rules from <code>firestore.rules</code>.
              </p>
            )}
          </div>
        )}

        {/* Synced counts summary */}
        {firestoreSyncStatus.syncedCounts && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-500 dark:text-slate-400 block">Customers</span>
              <strong className="text-slate-900 dark:text-slate-100">
                {firestoreSyncStatus.syncedCounts.customers}
              </strong>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-500 dark:text-slate-400 block">Suppliers</span>
              <strong className="text-slate-900 dark:text-slate-100">
                {firestoreSyncStatus.syncedCounts.suppliers}
              </strong>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-500 dark:text-slate-400 block">Sales Bills</span>
              <strong className="text-slate-900 dark:text-slate-100">
                {firestoreSyncStatus.syncedCounts.sales}
              </strong>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-500 dark:text-slate-400 block">Products</span>
              <strong className="text-slate-900 dark:text-slate-100">
                {firestoreSyncStatus.syncedCounts.products}
              </strong>
            </div>
          </div>
        )}
      </div>

      {/* Prominent PDF & Excel Business Exports */}
      <div className="p-4 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-emerald-950 dark:text-emerald-100 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Export Business Backup Reports (PDF &amp; Excel .xlsx)</span>
            </h4>
            <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
              Exports live business data into a formatted PDF report and an 11-sheet Excel workbook. Note: PDF &amp; Excel files are human-readable reports, not full database restore archives.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => handleDownloadPdf(false)}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Download PDF Backup</span>
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() => handleDownloadExcel(false)}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-emerald-900 hover:bg-emerald-950 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
            <span>Download Excel Backup (.xlsx)</span>
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handlePreviewPdf}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-white dark:bg-slate-900 hover:bg-emerald-50 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            <span>Preview PDF</span>
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handlePreviewExcel}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-white dark:bg-slate-900 hover:bg-emerald-50 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Preview Excel Summary</span>
          </button>
        </div>
      </div>

      {/* Inline PDF Preview Panel */}
      {pdfPreview && (
        <div className="border-2 border-emerald-400 dark:border-emerald-700 rounded-2xl bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 dark:border-slate-800 pb-2">
            <div>
              <div className="text-xs font-bold text-emerald-950 dark:text-emerald-100">
                PDF Report Preview (~{pdfPreview.summary.estimatedPages} pages)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Total Sales: {formatINR(pdfPreview.summary.metrics.totalSales)} · Customer Udhar: {formatINR(pdfPreview.summary.metrics.totalCustomerOutstanding)} · Available Cash: {formatINR(pdfPreview.summary.metrics.availableCash)}
              </div>
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
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <iframe
            src={pdfPreview.blobUrl}
            title="Arjun Groceries PDF Report Preview"
            className="w-full h-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100"
          />
        </div>
      )}

      {/* Inline 11-Sheet Excel Summary Preview Panel */}
      {excelPreview && activeExcelSheet && (
        <div className="border-2 border-emerald-500 dark:border-emerald-700 rounded-2xl bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 dark:border-slate-800 pb-2">
            <div>
              <div className="text-xs font-bold text-emerald-950 dark:text-emerald-100">
                Excel Workbook Summary Preview (11 Worksheets)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Inspect worksheet columns, INR formatting, and sample live rows before downloading `.xlsx`.
              </div>
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
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

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
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap border cursor-pointer ${
                  idx === excelPreview.activeSheetIdx
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {sheet.name} ({sheet.rowCount})
              </button>
            ))}
          </div>

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
                      No rows yet in {activeExcelSheet.name}. Header row with AutoFilter is preserved cleanly.
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
        </div>
      )}

      {/* Restore Complete Backup & Full Recovery Archive */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Upload className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Restore Complete Backup (Full Data &amp; Attachments Recovery)</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
              Restores all records, opening balances, settings, and IndexedDB bill photos/PDFs from a Full Backup (.json or encrypted .skbackup.json).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <label className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Choose Full Backup (.json)</span>
              <input
                type="file"
                accept=".json,.skbackup.json,application/json"
                onChange={handleFileSelected}
                className="hidden"
              />
            </label>
            <button
              type="button"
              disabled={isBusy}
              onClick={handleManualBackup}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5 text-emerald-700" />
              <span>Manual Snapshot Now</span>
            </button>
          </div>
        </div>

        {/* Encrypted Full Recovery Export Bar */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              <span>Save Full Recovery Archive (.skbackup.json · AES-256-GCM or Unencrypted .json)</span>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleExportVerified(false)}
              className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              Save Full Recovery (.json)
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={encryptionPassphrase}
              onChange={(e) => setEncryptionPassphrase(e.target.value)}
              placeholder="Enter passphrase (min 4 chars) to encrypt full recovery backup..."
              aria-label="Encrypted backup passphrase"
              className="flex-1 text-xs px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleExportEncrypted(false)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white rounded-xl text-xs font-bold cursor-pointer shrink-0"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Save Encrypted Recovery</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleExportEncrypted(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold cursor-pointer shrink-0"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-700" />
              <span>Share / Save to Phone</span>
            </button>
          </div>
        </div>
      </div>

      {/* Legacy localStorage Cleanup Banner (only shown if legacy keys exist) */}
      {storageStatus.legacyArchivePresent && (
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div>
            <div className="font-bold text-slate-800 dark:text-slate-100">
              Legacy localStorage Archive Present ({migrationReport?.source === 'localStorage' ? 'Migrated to IndexedDB' : 'Old Copy Detected'})
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Your records are now stored in IndexedDB. You can optionally clear the old localStorage copy to free 5MB browser cache space.
            </div>
          </div>
          {!confirmLegacyPurge ? (
            <button
              type="button"
              onClick={() => setConfirmLegacyPurge(true)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              Remove Legacy Copy
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmLegacyPurge(false)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white dark:bg-slate-900 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await purgeLegacyLocalStorageArchive();
                  setConfirmLegacyPurge(false);
                  setStatusBanner({
                    type: 'success',
                    message: 'Legacy localStorage business keys cleared. IndexedDB remains intact.',
                  });
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
              >
                Confirm Remove
              </button>
            </div>
          )}
        </div>
      )}

      {/* Automatic Backup Settings */}
      <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
              Automatic Local Snapshot Policy (Retains 7 Daily + 4 Weekly Snapshots)
            </div>
            <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
              Snapshots run automatically while Arjun Groceries is open and after important transaction batches. Export a Full Recovery backup anytime for external storage.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoBackupSettings.enabled}
                onChange={(e) => updateAutoBackupSettings({ enabled: e.target.checked })}
                className="w-4 h-4 text-emerald-700 rounded border-slate-300"
              />
              <span>Auto Backup</span>
            </label>

            <select
              aria-label="Auto backup interval"
              value={autoBackupSettings.intervalMinutes}
              onChange={(e) => updateAutoBackupSettings({ intervalMinutes: Number(e.target.value) })}
              className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            >
              <option value={15}>Every 15 min</option>
              <option value={30}>Every 30 min</option>
              <option value={60}>Every 60 min</option>
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoBackupSettings.backupAfterImportantBatch}
                onChange={(e) =>
                  updateAutoBackupSettings({ backupAfterImportantBatch: e.target.checked })
                }
                className="w-4 h-4 text-emerald-700 rounded border-slate-300"
              />
              <span>After Sales/Payment Batch</span>
            </label>
          </div>
        </div>
      </div>

      {/* Encrypted Backup Passphrase Prompt */}
      {encryptedImportPrompt && (
        <div className="p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <div className="font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-emerald-700" />
              <span>Encrypted Backup File: {encryptedImportPrompt.fileName}</span>
            </div>
            <button
              type="button"
              onClick={() => setEncryptedImportPrompt(null)}
              className="p-1 rounded-lg hover:bg-emerald-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {encryptedImportPrompt.error && (
            <div className="text-red-600 dark:text-red-400 font-semibold">{encryptedImportPrompt.error}</div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={encryptedImportPrompt.passphrase}
              onChange={(e) =>
                setEncryptedImportPrompt((prev) =>
                  prev ? { ...prev, passphrase: e.target.value, error: undefined } : null
                )
              }
              placeholder="Enter passphrase to decrypt & preview..."
              className="flex-1 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() =>
                inspectBackupContent(
                  encryptedImportPrompt.rawContent,
                  encryptedImportPrompt.fileName,
                  encryptedImportPrompt.passphrase
                )
              }
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
            >
              Decrypt &amp; Preview
            </button>
          </div>
        </div>
      )}

      {/* Staged File Restore Confirmation Preview */}
      {stagedFileRestore && stagedFileRestore.parsed.summary && (
        <div className="p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Confirm Complete Restore: {stagedFileRestore.fileName}</span>
              </div>
              <div className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
                Store: <strong>{stagedFileRestore.parsed.metadata?.storeName}</strong> · Backup Date:{' '}
                {new Date(stagedFileRestore.parsed.exportedAt || '').toLocaleString('en-IN')} ·{' '}
                {stagedFileRestore.parsed.checksumValid === true
                  ? 'SHA-256 Checksum Verified'
                  : 'Legacy Schema Verified'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStagedFileRestore(null)}
              className="p-1 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <BackupReconciliationCard report={stagedFileRestore.parsed.reconciliationReport} />

          {stagedFileRestore.parsed.warnings && stagedFileRestore.parsed.warnings.length > 0 && (
            <div className="p-2.5 rounded-lg bg-amber-100/80 dark:bg-amber-950/50 border border-amber-300 text-[11px] text-amber-900 dark:text-amber-200">
              <strong>Schema Notice:</strong> {stagedFileRestore.parsed.warnings.join(' ')}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <div className="text-[10px] text-slate-500">Total Transactions</div>
              <div className="font-bold">{stagedFileRestore.parsed.summary.totalTransactions}</div>
            </div>
            <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <div className="text-[10px] text-slate-500">Sales Volume</div>
              <div className="font-bold">{formatINR(stagedFileRestore.parsed.summary.salesTotalVolume)}</div>
            </div>
            <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <div className="text-[10px] text-slate-500">Customers &amp; Suppliers</div>
              <div className="font-bold">
                {stagedFileRestore.parsed.summary.customersCount} / {stagedFileRestore.parsed.summary.suppliersCount}
              </div>
            </div>
            <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <div className="text-[10px] text-slate-500">Inventory Items</div>
              <div className="font-bold">{stagedFileRestore.parsed.summary.productsCount}</div>
            </div>
            <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <div className="text-[10px] text-slate-500">Bill Photos / PDFs</div>
              <div className="font-bold">{stagedFileRestore.parsed.summary.billDocumentsCount || 0}</div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setStagedFileRestore(null)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={confirmFileRestore}
              className="px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
            >
              Create Rollback Checkpoint &amp; Restore
            </button>
          </div>
        </div>
      )}

      {/* Staged Snapshot Restore Confirmation */}
      {stagedSnapshot && (
        <div className="p-4 rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-amber-950 dark:text-amber-200">
            <div className="font-bold">
              Restore Local Snapshot from {new Date(stagedSnapshot.createdAt).toLocaleString('en-IN')}?
            </div>
            <div className="mt-0.5">
              Contains {stagedSnapshot.summary.totalTransactions} transactions ({stagedSnapshot.summary.salesCount} sales, {stagedSnapshot.summary.productsCount} products, {stagedSnapshot.summary.billDocumentsCount || 0} bill docs). A rollback checkpoint will be saved before restoring.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setStagedSnapshotId(null)}
              className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white dark:bg-slate-900 text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={confirmSnapshotRestore}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
            >
              Confirm Restore
            </button>
          </div>
        </div>
      )}

      {/* Local Backup History Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <History className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>Local Backup History ({localBackups.length} Snapshots in IndexedDB)</span>
          </h4>
        </div>

        {localBackups.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            No local snapshots yet. Click &quot;Manual Snapshot Now&quot; to create your first snapshot.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl max-h-64 overflow-y-auto">
            {localBackups.map((snap) => (
              <div
                key={snap.id}
                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {new Date(snap.createdAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        snap.bucket === 'RECOVERY'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200'
                          : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {snap.bucket}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold">
                      {snap.trigger}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      #{snap.checksum.slice(0, 8)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {snap.summary.totalTransactions} tx · {snap.summary.customersCount} customers ·{' '}
                    {snap.summary.productsCount} products · {snap.summary.billDocumentsCount || 0} docs · {formatBytes(snap.sizeBytes)}
                    {snap.reason ? ` · ${snap.reason}` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setStagedSnapshotId(snap.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Restore</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteLocalBackupSnapshot(snap.id)}
                    aria-label={`Delete backup snapshot ${snap.id}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CloudBackupSection
        onRestoreSuccess={(verifiedCounts) => {
          setStatusBanner({
            type: 'success',
            message: `Restored encrypted cloud backup (${verifiedCounts?.sales ?? 0} sales, ${verifiedCounts?.customers ?? 0} customers, ${verifiedCounts?.billDocuments ?? 0} bill documents) and verified IndexedDB records.`,
            verifiedCounts,
          });
        }}
      />

      <ExternalRecoveryGuide />
    </div>
  );
};
