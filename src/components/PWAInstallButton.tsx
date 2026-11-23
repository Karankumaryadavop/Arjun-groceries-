import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {
  CheckCircle2,
  Download,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import {
  applySafePWAUpdate,
  canApplySafeAppUpdate,
  checkForServiceWorkerUpdate,
  getPWASnapshot,
  initPWAListeners,
  PWAInstallSnapshot,
  setActiveTransactionFlag,
  subscribePWAState,
  triggerNativePWAInstall,
} from '../utils/pwaInstall';

export function usePWAState(): PWAInstallSnapshot {
  useEffect(() => {
    initPWAListeners();
  }, []);

  return useSyncExternalStore(subscribePWAState, getPWASnapshot, getPWASnapshot);
}

export function usePWAInstall() {
  const snapshot = usePWAState();

  const install = async () => {
    const res = await triggerNativePWAInstall();
    return res.outcome === 'accepted';
  };

  return {
    isInstallable: snapshot.isInstallable,
    isInstalled: snapshot.isInstalled,
    isIOS: snapshot.platform.isIOS,
    isAndroid: snapshot.platform.isAndroid,
    installMode: snapshot.installMode,
    swRegistered: snapshot.swRegistered,
    swOfflineReady: snapshot.swOfflineReady,
    swUpdateAvailable: snapshot.swUpdateAvailable,
    swUpdating: snapshot.swUpdating,
    activeTransactionCount: snapshot.activeTransactionCount,
    lastInstallOutcome: snapshot.lastInstallOutcome,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Registers an active transaction (Sale, Purchase, Expense, Cashbook, Khata entry, Backup restore)
 * so Safe Updates never interrupt or reload while work is in progress.
 */
export function useTrackActiveTransaction(key: string, active: boolean): void {
  useEffect(() => {
    setActiveTransactionFlag(key, active);
    return () => {
      setActiveTransactionFlag(key, false);
    };
  }, [key, active]);
}

interface PWAInstallButtonProps {
  compact?: boolean;
  variant?: 'dashboard' | 'header' | 'settings';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  variant = 'header',
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    swRegistered,
    swOfflineReady,
    install,
  } = usePWAInstall();
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);
  const [installNotice, setInstallNotice] = useState<string | null>(null);

  // Hide on dashboard/header when already running in standalone installed mode;
  // in Settings show subtle confirmation badge.
  if (isInstalled) {
    if (variant === 'settings') {
      return (
        <span
          data-testid="pwa-installed-badge"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 px-3 py-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-200 whitespace-nowrap"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
          <span>App Installed (Offline Ready)</span>
        </span>
      );
    }
    return null;
  }

  // On header compact slot, keep existing lightweight visibility (render on native prompt or iOS)
  // On dashboard and settings, ALWAYS show the green "Install App" button when not installed
  if (variant === 'header' && !isInstallable && !isIOS) {
    return null;
  }

  const handleInstallClick = async () => {
    setInstallNotice(null);
    if (isInstallable) {
      setIsPrompting(true);
      try {
        const accepted = await install();
        if (!accepted) {
          setInstallNotice('Installation dismissed. You can install Arjun Groceries anytime from the Dashboard.');
        }
      } finally {
        setIsPrompting(false);
      }
      return;
    }

    setShowManualGuide(true);
  };

  const buttonClasses =
    variant === 'dashboard'
      ? 'inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white border border-emerald-300/60 px-3.5 py-2 text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer min-h-[40px] whitespace-nowrap shrink-0'
      : `inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-xs sm:text-sm'
        }`;

  return (
    <>
      <button
        type="button"
        data-testid={variant === 'dashboard' ? 'dashboard-install-app-btn' : 'pwa-install-app-btn'}
        disabled={isPrompting}
        onClick={handleInstallClick}
        title="Install Arjun Groceries on your home screen for offline use"
        className={buttonClasses}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{isPrompting ? 'Opening Prompt…' : 'Install App'}</span>
      </button>

      {showManualGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 text-left"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
                </div>
                <div>
                  <h3
                    id="pwa-install-dialog-title"
                    className="text-base font-bold text-slate-900 dark:text-white leading-tight"
                  >
                    Install Arjun Groceries
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Offline-first home screen app
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManualGuide(false)}
                aria-label="Close install instructions"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isInstallable ? (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 p-3.5 space-y-2.5">
                <p className="text-xs text-emerald-900 dark:text-emerald-200 font-medium">
                  Your browser is ready to install Arjun Groceries directly onto your home screen.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const accepted = await install();
                    if (accepted) setShowManualGuide(false);
                  }}
                  className="w-full rounded-xl bg-emerald-700 hover:bg-emerald-800 py-2.5 text-xs font-bold text-white cursor-pointer flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Install Now</span>
                </button>
              </div>
            ) : isIOS ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                <div className="font-bold text-slate-900 dark:text-white">
                  Install on iPhone / iPad (Safari):
                </div>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </li>
                  <li>
                    Tap <strong>Add</strong> to launch Arjun Groceries fullscreen offline.
                  </li>
                </ol>
              </div>
            ) : isAndroid ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                <div className="font-bold text-slate-900 dark:text-white">
                  Install on Android Chrome:
                </div>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    Tap the <strong>⋮</strong> (three-dot menu) in the top-right corner of Chrome.
                  </li>
                  <li>
                    Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </li>
                  <li>
                    Tap <strong>Install</strong> to add <strong>Arjun Groceries</strong> to your phone.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                <div className="font-bold text-slate-900 dark:text-white">
                  Manual Browser Installation:
                </div>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    In Chrome or Edge, look for the <strong>Install Arjun Groceries</strong> icon in the address bar (or open the browser <strong>⋮</strong> menu → <strong>Save and share / Cast, save, and share → Install page as app</strong>).
                  </li>
                  <li>
                    On Android Chrome, tap <strong>⋮ → Install app</strong> or <strong>Add to Home screen</strong>.
                  </li>
                </ol>
              </div>
            )}

            {installNotice && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {installNotice}
              </p>
            )}

            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/80 p-3 text-[11px] text-emerald-950 dark:text-emerald-200 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span>
                  Offline App Shell:{' '}
                  {swOfflineReady
                    ? 'Cached & Ready for Airplane Mode'
                    : swRegistered
                    ? 'Service Worker Active'
                    : 'Preparing Offline Cache'}
                </span>
              </div>
              <p className="text-emerald-900/80 dark:text-emerald-200/80 leading-relaxed">
                Sales, purchases, khata, and stock stay saved locally in IndexedDB. Keep an external JSON or encrypted cloud backup before uninstalling the app or clearing browser storage.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowManualGuide(false)}
              className="w-full rounded-xl bg-emerald-700 hover:bg-emerald-800 py-2.5 text-xs font-bold text-white cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const SafeUpdateBanner: React.FC = () => {
  const snapshot = usePWAState();
  const [dismissed, setDismissed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!snapshot.swUpdateAvailable || dismissed) {
    return null;
  }

  const readiness = canApplySafeAppUpdate({
    swUpdateAvailable: snapshot.swUpdateAvailable,
    swUpdating: snapshot.swUpdating,
    activeTransactionKeys: new Array(snapshot.activeTransactionCount).fill('tx'),
  });

  const handleApproveUpdate = async () => {
    setErrorMsg(null);
    const res = await applySafePWAUpdate();
    if (!res.applied && res.reason) {
      setErrorMsg(res.reason);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-safe-update-banner"
      className="mx-3.5 sm:mx-6 lg:mx-8 mt-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
    >
      <div className="space-y-0.5">
        <div className="font-bold flex items-center gap-1.5">
          <RefreshCw className={`w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 ${snapshot.swUpdating ? 'animate-spin' : ''}`} />
          <span>New version of Arjun Groceries is ready to install</span>
        </div>
        <p className="text-[11px] text-emerald-900/85 dark:text-emerald-200/85">
          {!readiness.canApplyNow && readiness.blockedReason
            ? readiness.blockedReason
            : 'All local IndexedDB sales, khata, suppliers & inventory remain untouched during update.'}
        </p>
        {errorMsg && (
          <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
            {errorMsg}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          disabled={snapshot.swUpdating}
          className="px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-emerald-900 dark:text-emerald-200 font-semibold cursor-pointer disabled:opacity-50"
        >
          Later
        </button>
        <button
          type="button"
          data-testid="pwa-approve-update-btn"
          disabled={!readiness.canApplyNow || snapshot.swUpdating}
          onClick={handleApproveUpdate}
          className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold cursor-pointer"
        >
          {snapshot.swUpdating
            ? 'Updating…'
            : readiness.activeCount > 0
            ? 'Finish Entry First'
            : 'Update Safely'}
        </button>
      </div>
    </div>
  );
};

export const AppVersionControls: React.FC = () => {
  const snapshot = usePWAState();
  const [checking, setChecking] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setStatusNote(null);
    try {
      const hasUpdate = await checkForServiceWorkerUpdate();
      setStatusNote(
        hasUpdate
          ? 'An update is ready — approve it above when no transaction is open.'
          : 'You are on the latest offline-ready version.'
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={handleCheckUpdate}
        disabled={checking || !snapshot.swSupported}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
        <span>{checking ? 'Checking…' : 'Check App Update'}</span>
      </button>
      {statusNote && (
        <span className="text-[11px] text-slate-600 dark:text-slate-300">{statusNote}</span>
      )}
    </div>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-offline-indicator"
      className="fixed bottom-20 lg:bottom-4 right-4 z-40 flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode — All sales, khata &amp; stock saved on phone</span>
    </div>
  );
};
