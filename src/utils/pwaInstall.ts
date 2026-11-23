/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PWAPlatformInfo {
  isIOS: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
}

export type PWAInstallMode =
  | 'installed'
  | 'native'
  | 'ios_manual'
  | 'android_manual'
  | 'desktop_manual';

export interface PWAInstallSnapshot {
  isInstalled: boolean;
  isInstallable: boolean;
  installMode: PWAInstallMode;
  platform: PWAPlatformInfo;
  swSupported: boolean;
  swRegistered: boolean;
  swOfflineReady: boolean;
  swUpdateAvailable: boolean;
  swUpdating: boolean;
  swRegistrationError: string | null;
  activeTransactionCount: number;
  lastInstallOutcome: 'accepted' | 'dismissed' | null;
}

export interface SafeUpdateCheckResult {
  canApplyNow: boolean;
  blockedReason: string | null;
  activeCount: number;
}

export const SENSITIVE_BYPASS_PATTERNS: readonly RegExp[] = [
  /^\/api\//i,
  /^https:\/\/(.*\.)?googleapis\.com\//i,
  /^https:\/\/(.*\.)?firebaseio\.com\//i,
  /^https:\/\/(.*\.)?firebasestorage\.app\//i,
  /^https:\/\/(.*\.)?firebaseapp\.com\//i,
  /^https:\/\/identitytoolkit\.googleapis\.com\//i,
  /^https:\/\/securetoken\.googleapis\.com\//i,
  /^https:\/\/graph\.facebook\.com\//i,
];

/**
 * Pure helper validating which network URLs must NEVER be cached by the Service Worker.
 */
export function shouldBypassServiceWorkerCache(rawUrl: string): boolean {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return true;

  let pathAndHost = trimmed;
  try {
    if (trimmed.startsWith('/')) {
      return SENSITIVE_BYPASS_PATTERNS.some((pattern) => pattern.test(trimmed));
    }
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith('/api/')) {
      return true;
    }
    pathAndHost = parsed.href;
  } catch {
    return true;
  }

  return SENSITIVE_BYPASS_PATTERNS.some((pattern) => pattern.test(pathAndHost));
}

export function detectPWAPlatform(userAgent: string): PWAPlatformInfo {
  const ua = String(userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  return {
    isIOS,
    isAndroid,
    isDesktop: !isIOS && !isAndroid,
  };
}

export function computePWAInstallMode(params: {
  isInstalled: boolean;
  hasDeferredPrompt: boolean;
  platform: PWAPlatformInfo;
}): PWAInstallMode {
  if (params.isInstalled) return 'installed';
  if (params.hasDeferredPrompt) return 'native';
  if (params.platform.isIOS) return 'ios_manual';
  if (params.platform.isAndroid) return 'android_manual';
  return 'desktop_manual';
}

export function canApplySafeAppUpdate(params: {
  swUpdateAvailable: boolean;
  swUpdating: boolean;
  activeTransactionKeys: ReadonlySet<string> | readonly string[];
}): SafeUpdateCheckResult {
  const activeCount =
    params.activeTransactionKeys instanceof Set
      ? params.activeTransactionKeys.size
      : (params.activeTransactionKeys as readonly string[]).length;

  if (!params.swUpdateAvailable) {
    return {
      canApplyNow: false,
      blockedReason: 'No pending update is waiting to install.',
      activeCount,
    };
  }

  if (params.swUpdating) {
    return {
      canApplyNow: false,
      blockedReason: 'An update is already being applied.',
      activeCount,
    };
  }

  if (activeCount > 0) {
    return {
      canApplyNow: false,
      blockedReason:
        'Finish your active sale, purchase, or entry before updating so no work is interrupted.',
      activeCount,
    };
  }

  return {
    canApplyNow: true,
    blockedReason: null,
    activeCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Global Runtime Singleton Store (initialised before React entry screens mount)
// ---------------------------------------------------------------------------

type Listener = () => void;

let listenersInitialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let isStandaloneMode = false;
let appInstalledEventFired = false;
let swRegistered = false;
let swOfflineReady = false;
let swUpdateAvailable = false;
let swUpdating = false;
let swRegistrationError: string | null = null;
let lastInstallOutcome: 'accepted' | 'dismissed' | null = null;
let updateSWCallback: ((reloadPage?: boolean) => Promise<void>) | null = null;
let swRegistrationRef: ServiceWorkerRegistration | null = null;

const activeTransactions = new Set<string>();
const subscribers = new Set<Listener>();

function detectRuntimeStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const mediaStandalone =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return Boolean(mediaStandalone || iosStandalone);
  } catch {
    return false;
  }
}

let cachedSnapshot: PWAInstallSnapshot | null = null;

function buildSnapshot(): PWAInstallSnapshot {
  const platform = detectPWAPlatform(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );
  const isInstalled = isStandaloneMode || appInstalledEventFired;
  const isInstallable = Boolean(deferredPrompt) && !isInstalled;
  const swSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator;

  return {
    isInstalled,
    isInstallable,
    installMode: computePWAInstallMode({
      isInstalled,
      hasDeferredPrompt: Boolean(deferredPrompt),
      platform,
    }),
    platform,
    swSupported,
    swRegistered,
    swOfflineReady,
    swUpdateAvailable,
    swUpdating,
    swRegistrationError,
    activeTransactionCount: activeTransactions.size,
    lastInstallOutcome,
  };
}

function notifySubscribers(): void {
  cachedSnapshot = buildSnapshot();
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber render faults
    }
  });
}

export function getPWASnapshot(): PWAInstallSnapshot {
  if (!cachedSnapshot) {
    cachedSnapshot = buildSnapshot();
  }
  return cachedSnapshot;
}

export function subscribePWAState(listener: Listener): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

const PWA_INSTALLED_FLAG_KEY = 'arjun_groceries_pwa_installed_v1';

function readPersistedInstalledFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PWA_INSTALLED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function writePersistedInstalledFlag(installed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (installed) {
      window.localStorage.setItem(PWA_INSTALLED_FLAG_KEY, '1');
    } else {
      window.localStorage.removeItem(PWA_INSTALLED_FLAG_KEY);
    }
  } catch {
    // Ignore storage quota / private-mode restrictions
  }
}

export function initPWAListeners(): void {
  if (typeof window === 'undefined') return;
  if (listenersInitialized) return;
  listenersInitialized = true;

  isStandaloneMode = detectRuntimeStandalone();
  appInstalledEventFired = readPersistedInstalledFlag();
  if (isStandaloneMode) {
    writePersistedInstalledFlag(true);
  }

  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onDisplayModeChange = (ev: MediaQueryListEvent) => {
      isStandaloneMode = ev.matches || detectRuntimeStandalone();
      if (isStandaloneMode) {
        deferredPrompt = null;
        writePersistedInstalledFlag(true);
      }
      notifySubscribers();
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onDisplayModeChange);
    }
  }

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    // Browsers only emit beforeinstallprompt when the app is not currently installed
    // (including after a user uninstalls the PWA), so clear any stale installed marker.
    appInstalledEventFired = false;
    writePersistedInstalledFlag(false);
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener('appinstalled', () => {
    appInstalledEventFired = true;
    writePersistedInstalledFlag(true);
    deferredPrompt = null;
    lastInstallOutcome = 'accepted';
    notifySubscribers();
  });

  // Periodically check for waiting SW updates when returning online or focusing window
  window.addEventListener('online', () => {
    void checkForServiceWorkerUpdate();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void checkForServiceWorkerUpdate();
    }
  });

  notifySubscribers();
}

export function setPWAUpdateHandler(
  handler: (reloadPage?: boolean) => Promise<void>
): void {
  updateSWCallback = handler;
}

export function markSWRegistered(reg?: ServiceWorkerRegistration): void {
  swRegistered = true;
  swRegistrationError = null;
  if (reg) {
    swRegistrationRef = reg;
    if (reg.waiting) {
      swUpdateAvailable = true;
    }
  }
  notifySubscribers();
}

export function markSWOfflineReady(): void {
  swOfflineReady = true;
  notifySubscribers();
}

export function markSWUpdateAvailable(): void {
  swUpdateAvailable = true;
  notifySubscribers();
}

export function markSWRegisterError(err: unknown): void {
  swRegistrationError =
    err instanceof Error ? err.message : 'Service worker registration failed.';
  notifySubscribers();
}

export async function checkForServiceWorkerUpdate(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
    return false;
  }
  try {
    const reg =
      swRegistrationRef || (await navigator.serviceWorker.getRegistration());
    if (!reg) return false;
    swRegistrationRef = reg;
    await reg.update();
    if (reg.waiting) {
      swUpdateAvailable = true;
      notifySubscribers();
      return true;
    }
    return swUpdateAvailable;
  } catch {
    return false;
  }
}

export function setActiveTransactionFlag(key: string, active: boolean): void {
  const prevSize = activeTransactions.size;
  if (active) {
    activeTransactions.add(key);
  } else {
    activeTransactions.delete(key);
  }
  if (activeTransactions.size !== prevSize) {
    notifySubscribers();
  }
}

export async function triggerNativePWAInstall(): Promise<{
  outcome: 'accepted' | 'dismissed' | 'unavailable';
}> {
  if (!deferredPrompt) {
    return { outcome: 'unavailable' };
  }

  const promptEvent = deferredPrompt;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    lastInstallOutcome = choice.outcome;
    if (choice.outcome === 'accepted') {
      appInstalledEventFired = true;
      deferredPrompt = null;
      notifySubscribers();
      return { outcome: 'accepted' };
    }
    notifySubscribers();
    return { outcome: 'dismissed' };
  } catch {
    deferredPrompt = null;
    notifySubscribers();
    return { outcome: 'unavailable' };
  }
}

export async function applySafePWAUpdate(): Promise<{
  applied: boolean;
  reason?: string;
}> {
  const check = canApplySafeAppUpdate({
    swUpdateAvailable,
    swUpdating,
    activeTransactionKeys: activeTransactions,
  });

  if (!check.canApplyNow) {
    return { applied: false, reason: check.blockedReason || undefined };
  }

  swUpdating = true;
  notifySubscribers();

  try {
    if (updateSWCallback) {
      await updateSWCallback(true);
    } else if (swRegistrationRef?.waiting) {
      swRegistrationRef.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    } else {
      window.location.reload();
    }
    return { applied: true };
  } catch (err) {
    swUpdating = false;
    notifySubscribers();
    return {
      applied: false,
      reason:
        err instanceof Error
          ? err.message
          : 'Could not apply app update right now.',
    };
  }
}

export function _resetPWATestState(): void {
  listenersInitialized = false;
  deferredPrompt = null;
  isStandaloneMode = false;
  appInstalledEventFired = false;
  swRegistered = false;
  swOfflineReady = false;
  swUpdateAvailable = false;
  swUpdating = false;
  swRegistrationError = null;
  lastInstallOutcome = null;
  updateSWCallback = null;
  swRegistrationRef = null;
  activeTransactions.clear();
  cachedSnapshot = null;
}
