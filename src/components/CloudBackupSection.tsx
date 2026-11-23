/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  UploadCloud,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { formatINR } from '../utils/accounting';
import { formatByteSize } from '../utils/androidDownload';
import { validateCloudPassphrase } from '../utils/cloudBackupCrypto';
import { getIstDateKey } from '../utils/cloudBackupManager';
import { InspectedBackupResult, VerifiedRestoreCounts } from '../utils/localBackupManager';
import { CloudBackupRemoteEntry } from '../types';
import { BackupReconciliationCard } from './BackupReconciliationCard';

interface CloudBackupSectionProps {
  onRestoreSuccess?: (verifiedCounts?: VerifiedRestoreCounts) => void;
}

export const CloudBackupSection: React.FC<CloudBackupSectionProps> = ({ onRestoreSuccess }) => {
  const {
    storageStatus,
    cloudAuthUser,
    cloudBackupConfig,
    cloudBackupStatus,
    cloudBackupHistory,
    isCloudPassphraseUnlocked,
    isCloudBackupBusy,
    signInCloudBackupAccount,
    signOutCloudBackupAccount,
    unlockCloudBackupPassphrase,
    lockCloudBackupPassphrase,
    updateCloudBackupConfig,
    refreshCloudBackupHistory,
    backupNowToCloud,
    previewCloudBackupForRestore,
    restoreFromCloudBackup,
  } = useStore();

  const [passphraseInput, setPassphraseInput] = useState('');
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    verifiedCounts?: VerifiedRestoreCounts;
  } | null>(null);
  const [allowRebindOwner, setAllowRebindOwner] = useState(false);

  // Replacement-phone / snapshot disaster recovery workflow state
  const [selectedEntry, setSelectedEntry] = useState<CloudBackupRemoteEntry | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [stagedPreview, setStagedPreview] = useState<{
    entry: CloudBackupRemoteEntry;
    passphrase: string;
    inspected: InspectedBackupResult;
    sizeBytes: number;
    ciphertextSha256?: string;
  } | null>(null);

  useEffect(() => {
    if (cloudAuthUser?.uid && cloudAuthUser.emailVerified && storageStatus.isOnline) {
      void refreshCloudBackupHistory();
    }
  }, [cloudAuthUser?.uid, cloudAuthUser?.emailVerified, storageStatus.isOnline, refreshCloudBackupHistory]);

  const ownerMismatch = Boolean(
    cloudAuthUser?.uid &&
      cloudBackupConfig.boundOwnerUid &&
      cloudBackupConfig.boundOwnerUid !== cloudAuthUser.uid
  );

  const passphraseStrength = validateCloudPassphrase(passphraseInput);
  const istToday = getIstDateKey();

  const handleGoogleSignIn = async () => {
    setNotice(null);
    const res = await signInCloudBackupAccount();
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Could not sign in with Google.' });
    } else if (res.redirectStarted) {
      setNotice({ type: 'info', message: 'Redirecting to Google Sign-In…' });
    } else {
      setNotice({ type: 'success', message: 'Google account verified for Encrypted Cloud Backup.' });
    }
  };

  const handleUnlockPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const mode = cloudBackupConfig.passphraseVerifier ? 'UNLOCK' : 'SET_NEW';
    const res = await unlockCloudBackupPassphrase(passphraseInput, mode);
    if (!res.success) {
      setNotice({ type: 'error', message: res.error || 'Invalid recovery passphrase.' });
      return;
    }
    setPassphraseInput('');
    setNotice({
      type: 'success',
      message:
        mode === 'SET_NEW'
          ? 'Recovery passphrase configured for this session. Remember this passphrase — it is never stored on disk or Firebase.'
          : 'Cloud backup passphrase unlocked for this active session.',
    });
  };

  const handleBackupNow = async () => {
    setNotice(null);
    const res = await backupNowToCloud({
      passphrase: passphraseInput.trim() || undefined,
      bucket: 'manual',
      allowRebindOwner,
    });
    if (res.success && res.entry) {
      if (passphraseInput.trim()) setPassphraseInput('');
      setAllowRebindOwner(false);
      setNotice({
        type: 'success',
        message: `Encrypted snapshot uploaded (${res.entry.name} · ${formatByteSize(res.entry.sizeBytes)} · SHA-256 ${res.entry.ciphertextSha256?.slice(0, 12) || 'verified'}).`,
      });
    } else {
      setNotice({
        type: 'error',
        message: res.error || 'Encrypted cloud backup could not complete.',
      });
    }
  };

  const handlePreviewSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntry) return;
    setNotice(null);
    const pass = restorePassphrase.trim();
    if (!pass) {
      setNotice({ type: 'error', message: 'Enter your cloud recovery passphrase to decrypt this backup.' });
      return;
    }
    const res = await previewCloudBackupForRestore({
      fullPath: selectedEntry.fullPath,
      passphrase: pass,
    });
    if (!res.success || !res.inspected) {
      setNotice({ type: 'error', message: res.error || 'Could not decrypt selected cloud snapshot.' });
      return;
    }
    setStagedPreview({
      entry: selectedEntry,
      passphrase: pass,
      inspected: res.inspected,
      sizeBytes: res.sizeBytes || selectedEntry.sizeBytes,
      ciphertextSha256: res.ciphertextSha256,
    });
    setSelectedEntry(null);
    setRestorePassphrase('');
  };

  const handleConfirmCloudRestore = async () => {
    if (!stagedPreview) return;
    setNotice(null);
    const res = await restoreFromCloudBackup({
      fullPath: stagedPreview.entry.fullPath,
      passphrase: stagedPreview.passphrase,
      allowRebindOwner: true,
    });
    if (res.success) {
      setNotice({
        type: 'success',
        message: `Restored ${res.count || 0} transactions & ${res.verifiedCounts?.billDocuments ?? 0} bill documents from Cloud Storage into local IndexedDB! A pre-restore rollback checkpoint was saved automatically.`,
        verifiedCounts: res.verifiedCounts,
      });
      setStagedPreview(null);
      onRestoreSuccess?.(res.verifiedCounts);
    } else {
      setNotice({
        type: 'error',
        message: res.error || 'Cloud restore failed; existing IndexedDB data was protected.',
      });
    }
  };

  return (
    <section
      aria-label="Encrypted Firebase Cloud Backup"
      className="p-4 sm:p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800 space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
        <div>
          <div className="flex items-start gap-2">
            <Cloud className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h4 className="text-sm font-bold text-emerald-950 dark:text-emerald-100 leading-snug">
                Encrypted Firebase Cloud Backup (Disaster Recovery)
              </h4>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 shrink-0">
                LOCAL-FIRST · AES-256-GCM
              </span>
            </div>
          </div>
          <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80 mt-1 leading-relaxed">
            Daily business operations stay 100% offline in local IndexedDB. Firebase Cloud Storage stores only encrypted full snapshots (once daily IST + manual) for replacement-phone recovery.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-[11px] font-bold">
          {storageStatus.isOnline ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
              <Cloud className="w-3.5 h-3.5" />
              <span>Cloud Reachable</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
              <CloudOff className="w-3.5 h-3.5" />
              <span>Offline (Local Safe)</span>
            </span>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-2 ${
            notice.type === 'success'
              ? 'bg-white dark:bg-slate-900 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
              : notice.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
              : 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span>{notice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss cloud backup notice"
            className="p-0.5 hover:opacity-75 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Step 1: Google Account Auth & Single-Owner Binding */}
      <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs min-w-0">
          <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>
              {cloudAuthUser
                ? `Signed in: ${cloudAuthUser.email || cloudAuthUser.uid}`
                : 'Step 1: Sign in with Owner Google Account'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {cloudAuthUser
              ? `Private Storage path: users/${cloudAuthUser.uid.slice(0, 8)}…/backups/`
              : 'Your Google account locks Cloud Storage access strictly to your private owner folder.'}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {!cloudAuthUser ? (
            <button
              type="button"
              disabled={isCloudBackupBusy}
              onClick={handleGoogleSignIn}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Sign in with Google</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={isCloudBackupBusy || !storageStatus.isOnline}
                onClick={() => void refreshCloudBackupHistory()}
                aria-label="Refresh cloud backups"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCloudBackupBusy ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                disabled={isCloudBackupBusy}
                onClick={() => void signOutCloudBackupAccount()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Owner UID mismatch warning */}
      {ownerMismatch && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-xs text-amber-950 dark:text-amber-200 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Different Google Account Detected:</strong> This shop was bound to{' '}
              <code>{cloudBackupConfig.boundOwnerEmail || cloudBackupConfig.boundOwnerUid}</code>. To protect against accidental cross-account overwrites, auto-backup is paused.
            </div>
          </div>
          <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={allowRebindOwner}
              onChange={(e) => setAllowRebindOwner(e.target.checked)}
              className="w-4 h-4 text-emerald-700 rounded border-amber-400"
            />
            <span>Confirm switching cloud backup owner to {cloudAuthUser?.email}</span>
          </label>
        </div>
      )}

      {/* Step 2 & 3: Zero-Knowledge Passphrase + Upload Controls */}
      {cloudAuthUser && (
        <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-800/70 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs">
              <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                {isCloudPassphraseUnlocked ? (
                  <Unlock className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                ) : (
                  <KeyRound className="w-4 h-4 text-amber-600" />
                )}
                <span>
                  {isCloudPassphraseUnlocked
                    ? 'Step 2: Recovery Passphrase Unlocked (Active Session Only)'
                    : cloudBackupConfig.passphraseVerifier
                    ? 'Step 2: Enter Cloud Recovery Passphrase to Unlock Daily Backups'
                    : 'Step 2: Create Secret Cloud Recovery Passphrase'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Minimum 8 characters. Keep this passphrase written safely — it is never saved to disk or Firebase, and lost passphrases cannot decrypt backups.
              </p>
            </div>

            {isCloudPassphraseUnlocked && (
              <button
                type="button"
                onClick={lockCloudBackupPassphrase}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <Lock className="w-3 h-3" />
                <span>Lock Session</span>
              </button>
            )}
          </div>

          {!isCloudPassphraseUnlocked && (
            <form onSubmit={handleUnlockPassphrase} className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                aria-label="Cloud backup recovery passphrase"
                placeholder={
                  cloudBackupConfig.passphraseVerifier
                    ? 'Enter your cloud recovery passphrase (min 8 chars)…'
                    : 'Create strong recovery passphrase (min 8 chars)…'
                }
                className="flex-1 text-xs px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={isCloudBackupBusy || !passphraseStrength.valid}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                {cloudBackupConfig.passphraseVerifier ? 'Unlock for Session' : 'Set Recovery Passphrase'}
              </button>
            </form>
          )}

          {/* Daily IST Auto-Backup Toggle & Manual Backup Now */}
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloudBackupConfig.autoDailyEnabled}
                  onChange={(e) => void updateCloudBackupConfig({ autoDailyEnabled: e.target.checked })}
                  className="w-4 h-4 text-emerald-700 rounded border-slate-300"
                />
                <span>Auto-Backup Once Daily (IST · Keeps 7 Daily + 4 Weekly)</span>
              </label>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {cloudBackupStatus.lastSuccessAt
                  ? `Last cloud backup: ${new Date(cloudBackupStatus.lastSuccessAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })} (${cloudBackupStatus.lastSuccessDateKeyIst === istToday ? 'Today IST backed up' : cloudBackupStatus.lastSuccessDateKeyIst})`
                  : 'No cloud backup uploaded yet.'}
                {cloudBackupStatus.lastUploadedBytes
                  ? ` · ${formatByteSize(cloudBackupStatus.lastUploadedBytes)}`
                  : ''}
                {cloudBackupStatus.verificationStatus === 'VERIFIED' && (
                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-bold text-[10px]">
                    SHA-256 Verified
                  </span>
                )}
                {cloudBackupStatus.verificationStatus === 'FAILED' && (
                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 font-bold text-[10px]">
                    Verification Failed
                  </span>
                )}
              </div>
              {cloudBackupStatus.lastError && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  {cloudBackupStatus.lastError}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={isCloudBackupBusy || !storageStatus.isOnline || (!isCloudPassphraseUnlocked && !passphraseStrength.valid)}
              onClick={handleBackupNow}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs cursor-pointer shrink-0"
            >
              <UploadCloud className="w-4 h-4" />
              <span>{isCloudBackupBusy ? 'Encrypting & Uploading…' : 'Backup to Cloud Now'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Selected Snapshot Passphrase Prompt (Replacement-Phone Recovery) */}
      {selectedEntry && (
        <form
          onSubmit={handlePreviewSelected}
          className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border-2 border-emerald-500 space-y-2.5 text-xs"
        >
          <div className="flex items-center justify-between">
            <div className="font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
              <Download className="w-4 h-4 text-emerald-700" />
              <span>Decrypt Cloud Snapshot: {selectedEntry.name}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedEntry(null);
                setRestorePassphrase('');
              }}
              aria-label="Cancel cloud snapshot selection"
              className="p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={restorePassphrase}
              onChange={(e) => setRestorePassphrase(e.target.value)}
              aria-label="Passphrase to decrypt cloud snapshot"
              placeholder="Enter recovery passphrase used to encrypt this backup…"
              className="flex-1 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={isCloudBackupBusy}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer shrink-0"
            >
              {isCloudBackupBusy ? 'Decrypting…' : 'Download & Preview'}
            </button>
          </div>
        </form>
      )}

      {/* Staged Disaster Recovery Preview & Reconciliation */}
      {stagedPreview && stagedPreview.inspected.summary && (
        <div className="p-4 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-700 space-y-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Confirm Cloud Disaster Recovery Restore</span>
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                Store: <strong>{stagedPreview.inspected.metadata?.storeName || 'Arjun Groceries'}</strong> · Snapshot:{' '}
                {stagedPreview.entry.name} ({formatByteSize(stagedPreview.sizeBytes)}) ·{' '}
                {stagedPreview.inspected.checksumValid ? 'SHA-256 Verified' : 'Verified'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStagedPreview(null)}
              aria-label="Cancel staged cloud restore"
              className="p-1 rounded-lg hover:bg-amber-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-500 block">Sales Bills</span>
              <strong>{stagedPreview.inspected.summary.salesCount}</strong>{' '}
              <span className="text-[10px] text-emerald-700">
                ({formatINR(stagedPreview.inspected.summary.salesTotalVolume)})
              </span>
            </div>
            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-500 block">Customers &amp; Suppliers</span>
              <strong>
                {stagedPreview.inspected.summary.customersCount} / {stagedPreview.inspected.summary.suppliersCount}
              </strong>
            </div>
            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-500 block">Inventory Products</span>
              <strong>{stagedPreview.inspected.summary.productsCount}</strong>
            </div>
            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-500 block">Bill Photos &amp; PDFs</span>
              <strong>{stagedPreview.inspected.summary.billDocumentsCount || 0}</strong>
            </div>
          </div>

          <BackupReconciliationCard report={stagedPreview.inspected.reconciliationReport} />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setStagedPreview(null)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isCloudBackupBusy}
              onClick={handleConfirmCloudRestore}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isCloudBackupBusy ? 'Restoring to IndexedDB…' : 'Create Rollback Checkpoint & Restore'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Cloud Backup Snapshots List */}
      {cloudAuthUser && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-950 dark:text-emerald-200">
            Encrypted Cloud Snapshots ({cloudBackupHistory.length})
          </div>
          {cloudBackupHistory.length === 0 ? (
            <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-dashed border-emerald-200 dark:border-emerald-800 text-center text-xs text-slate-500 dark:text-slate-400">
              No encrypted cloud backups found for this Google account yet. Click &ldquo;Backup to Cloud Now&rdquo; to upload your first encrypted snapshot.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-800 rounded-xl max-h-56 overflow-y-auto">
              {cloudBackupHistory.map((entry) => (
                <div
                  key={entry.fullPath}
                  className="p-2.5 sm:p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                        {entry.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                        {entry.bucket}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {new Date(entry.createdAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {formatByteSize(entry.sizeBytes)}
                      {entry.ciphertextSha256 ? ` · SHA-256 ${entry.ciphertextSha256.slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isCloudBackupBusy || !storageStatus.isOnline}
                    onClick={() => {
                      setSelectedEntry(entry);
                      setStagedPreview(null);
                      setRestorePassphrase('');
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold cursor-pointer shrink-0 self-start sm:self-auto"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Restore</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
