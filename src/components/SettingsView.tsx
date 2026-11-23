import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../context/StoreContext';
import {
  Store,
  QrCode,
  Lock,
  Upload,
  FileText,
  RotateCcw,
  CheckCircle2,
  Database,
  Sun,
  Moon,
  AlertTriangle,
  Tag,
  MessageSquare,
  Palette,
  Check,
  Printer,
} from 'lucide-react';
import { BackupReconciliationReport } from '../types';
import { inspectAndValidateBackupContent } from '../utils/localBackupManager';
import { BackupReconciliationCard } from './BackupReconciliationCard';
import { SyncBackupDashboard } from './SyncBackupDashboard';
import { WhatsAppTemplateBuilder } from './WhatsAppTemplateBuilder';
import { CategoryManagerView } from './CategoryManagerView';
import { ThermalPrintSettingsSection } from './ThermalPrintSettingsSection';
import { BrandLogo, BRAND_NAME, BRAND_TAGLINE } from './BrandLogo';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_COLOR,
  getWcagContrastRatio,
  normalizeHexColor,
} from '../utils/accentTheme';

export const SettingsView: React.FC = () => {
  const {
    profile,
    updateProfile,
    updatePinSecurity,
    needsPinSetup,
    hasPinConfigured,
    restoreBackupFromJSONSafe,
    getBackupSummary,
    setIsBackupModalOpen,
    resetToDemoData,
    demoDataAnalysis,
    clearDemoRecordsOnly,
    auditLogs,
    theme,
    setTheme,
    accentColor,
    accentRamp,
    setAccentColor,
    resetAccentColor,
    settingsActiveSection,
    setSettingsActiveSection,
    productCategories,
  } = useStore();

  const [storeName, setStoreName] = useState(profile.storeName);
  const [ownerName, setOwnerName] = useState(profile.ownerName);
  const [phone, setPhone] = useState(profile.phone);
  const [upiId, setUpiId] = useState(profile.upiId);
  const [address, setAddress] = useState(profile.address);
  const [gstin, setGstin] = useState(profile.gstin || '');
  const [newPin, setNewPin] = useState('');
  const [isPinEnabled, setIsPinEnabled] = useState(profile.isPinEnabled);
  const [allowNegativeStock, setAllowNegativeStock] = useState(Boolean(profile.allowNegativeStock));
  const [pinError, setPinError] = useState<string | null>(null);
  const [customHexInput, setCustomHexInput] = useState(accentColor);
  const [hexError, setHexError] = useState<string | null>(null);

  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCleanDemoConfirm, setShowCleanDemoConfirm] = useState(false);
  const [encryptedPrompt, setEncryptedPrompt] = useState<{
    content: string;
    fileName: string;
    passphrase: string;
    error?: string;
  } | null>(null);
  const [pendingLegacyRestore, setPendingLegacyRestore] = useState<{
    content: string;
    passphrase?: string;
    storeName: string;
    count: number;
    billDocsCount: number;
    reconciliationReport?: BackupReconciliationReport;
    checksumValid?: boolean;
  } | null>(null);

  // Sync local form fields if profile is hydrated/restored externally
  useEffect(() => {
    setStoreName(profile.storeName);
    setOwnerName(profile.ownerName);
    setPhone(profile.phone);
    setUpiId(profile.upiId);
    setAddress(profile.address);
    setGstin(profile.gstin || '');
    setIsPinEnabled(profile.isPinEnabled);
    setAllowNegativeStock(Boolean(profile.allowNegativeStock));
  }, [profile]);

  useEffect(() => {
    setCustomHexInput(accentColor);
    setHexError(null);
  }, [accentColor]);

  const upiQrString = `upi://pay?pa=${encodeURIComponent(upiId || '')}&pn=${encodeURIComponent(storeName || 'Arjun Groceries')}&cu=INR`;

  useEffect(() => {
    let cancelled = false;
    if (!upiId?.trim()) {
      setQrCodeDataUrl('');
      return;
    }
    QRCode.toDataURL(upiQrString, {
      width: 180,
      margin: 1,
      color: { dark: '#064e3b', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrCodeDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [upiQrString, upiId]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    const trimmedPin = newPin.trim();
    if (trimmedPin.length > 0 && !/^\d{4}$/.test(trimmedPin)) {
      setPinError('Security PIN must be exactly 4 numeric digits (or leave blank to keep existing PIN).');
      return;
    }
    const pinResult = await updatePinSecurity(trimmedPin || undefined, isPinEnabled);
    if (!pinResult.success) {
      setPinError(pinResult.error || 'Please configure a 4-digit PIN before enabling Screen Lock.');
      return;
    }
    updateProfile({
      storeName: storeName.trim(),
      ownerName: ownerName.trim(),
      phone: phone.trim(),
      upiId: upiId.trim(),
      address: address.trim(),
      gstin: gstin.trim() || undefined,
      isPinEnabled,
      allowNegativeStock,
    });
    setNewPin('');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const inspectSelectedBackup = async (content: string, fileName: string, passphrase?: string) => {
    const inspected = await inspectAndValidateBackupContent(content, passphrase);
    if (inspected.requiresPassphrase && !passphrase) {
      setEncryptedPrompt({ content, fileName, passphrase: '' });
      setSettingsNotice(null);
      return;
    }
    if (!inspected.valid || !inspected.data) {
      if (encryptedPrompt) {
        setEncryptedPrompt((prev) => (prev ? { ...prev, error: inspected.error || 'Decryption failed' } : null));
      } else {
        setSettingsNotice({
          type: 'error',
          message: `Invalid backup file: ${inspected.error || 'Syntax or schema error'}`,
        });
      }
      return;
    }
    setEncryptedPrompt(null);
    setPendingLegacyRestore({
      content,
      passphrase,
      storeName: inspected.metadata?.storeName || 'Shop',
      count: inspected.summary?.totalTransactions || 0,
      billDocsCount: inspected.summary?.billDocumentsCount || 0,
      reconciliationReport: inspected.reconciliationReport,
      checksumValid: inspected.checksumValid,
    });
    setSettingsNotice(null);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content || !content.trim()) {
        setSettingsNotice({ type: 'error', message: 'The selected backup file is completely empty.' });
        return;
      }
      await inspectSelectedBackup(content, file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6 pb-12 max-w-4xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <div className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide">
            Store Profile &amp; Security Settings
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Store Configuration
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage your shop name, product categories &amp; default units, UPI billing QR code, security PIN, and local database backups.
          </p>
        </div>
      </div>

      {/* Settings Sub-Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800"
      >
        {(
          [
            { id: 'GENERAL', label: 'Store & Security', icon: Store },
            {
              id: 'CATEGORIES',
              label: `Product Categories (${productCategories.length})`,
              icon: Tag,
            },
            { id: 'THERMAL_PRINT', label: 'Receipt & Print', icon: Printer },
            { id: 'BACKUP', label: 'Backup & Local DB', icon: Database },
            { id: 'WHATSAPP', label: 'WhatsApp & Audit', icon: MessageSquare },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = settingsActiveSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSettingsActiveSection(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {settingsActiveSection === 'GENERAL' && (
        <>
      {/* About Arjun Groceries Identity Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <BrandLogo sizeClass="w-16 h-16" roundedClass="rounded-full" className="shadow-xs" />
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              About Application
            </div>
            <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-lg leading-tight">
              {BRAND_NAME}
            </h3>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-0.5">
              {BRAND_TAGLINE} · Offline-First Store Ledger, Inventory &amp; Billing System
            </p>
          </div>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 sm:text-right shrink-0">
          <div className="font-semibold text-slate-700 dark:text-slate-200">Version 2.2</div>
          <div>On-Device IndexedDB Storage</div>
        </div>
      </div>

      {/* Appearance / Dark Mode Toggle Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
            {theme === 'dark' ? (
              <Moon className="w-5 h-5 text-amber-400" />
            ) : (
              <Sun className="w-5 h-5 text-amber-500" />
            )}
            <span>Display Theme (Daylight / Night Counter Mode)</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Switch between bright white counter view and eye-friendly Dark Mode for late evening billing.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
              theme === 'light'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>Light</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
              theme === 'dark'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>Dark</span>
          </button>
        </div>
      </div>

      {/* Brand Accent Color Selector Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
              <Palette className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              <span>Brand Accent Color (Store Theme Branding)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize buttons, active navigation highlights, and charts to match your shop&apos;s brand identity. Stored locally on this device.
            </p>
          </div>
          {accentColor !== DEFAULT_ACCENT_COLOR && (
            <button
              type="button"
              onClick={resetAccentColor}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer shrink-0 self-start sm:self-auto press-scale"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Arjun Emerald</span>
            </button>
          )}
        </div>

        {/* Curated Brand Presets */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {ACCENT_PRESETS.map((preset) => {
            const isSelected = accentColor.toLowerCase() === preset.hex.toLowerCase();
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setAccentColor(preset.hex)}
                aria-pressed={isSelected}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer press-scale flex flex-col gap-1.5 ${
                  isSelected
                    ? 'border-emerald-700 bg-emerald-50/80 dark:bg-emerald-950/50 ring-2 ring-emerald-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="w-6 h-6 rounded-lg border border-black/10 shadow-2xs flex items-center justify-center shrink-0"
                    style={{ backgroundColor: preset.hex }}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 uppercase">{preset.hex}</span>
                </div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">
                  {preset.name}
                </div>
              </button>
            );
          })}
        </div>

        {/* Custom Color Picker + Hex Entry + Live Contrast Preview */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Custom Color Picker:
              </span>
              <input
                type="color"
                aria-label="Pick custom accent color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-10 h-9 p-0.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 cursor-pointer"
              />
            </label>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                aria-label="Custom accent hex color code"
                value={customHexInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomHexInput(val);
                  const normalized = normalizeHexColor(val);
                  if (normalized) {
                    setHexError(null);
                    setAccentColor(normalized);
                  } else {
                    setHexError('Enter valid hex like #1d4ed8');
                  }
                }}
                maxLength={7}
                placeholder="#047857"
                className="w-28 text-xs font-mono font-bold px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
              {hexError && (
                <span className="text-[11px] font-medium text-red-600 dark:text-rose-400">
                  {hexError}
                </span>
              )}
            </div>
          </div>

          {/* Live Theme Preview Strip */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Preview (Contrast {getWcagContrastRatio('#ffffff', accentRamp[700])}:1):
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold shadow-2xs">
              Primary Button
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold">
              Active Highlight
            </span>
          </div>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSaveProfile} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Store className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
          <span>Shop &amp; Business Details</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Store / Shop Name *</label>
            <input
              type="text"
              required
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Owner Full Name</label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Shop Mobile / Contact Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 focus:outline-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">GSTIN Number (Optional)</label>
            <input
              type="text"
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Shop Full Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5"
          />
        </div>

        {/* UPI Billing Section */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm mb-3 flex items-center gap-2">
            <QrCode className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>UPI ID for QR Code Payments</span>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Store UPI VPA (e.g. GooglePay/PhonePe/Paytm)</label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="storename@okaxis"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 font-mono"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                This UPI ID is embedded in WhatsApp reminders and printed customer bill slips.
              </p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                Offline Counter QR Preview
              </div>
              {qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt="Offline UPI QR Code"
                  className="w-24 h-24 mx-auto rounded-lg border border-slate-300 bg-white p-1"
                />
              ) : (
                <div className="w-24 h-24 mx-auto rounded-lg border border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-[10px] text-slate-400 px-2">
                  Enter UPI ID
                </div>
              )}
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">{upiId}</div>
            </div>
          </div>
        </div>

        {/* Security & PIN Lock */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>Counter Screen PIN Security</span>
          </h4>
          {(needsPinSetup || (isPinEnabled && !hasPinConfigured)) && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200 font-medium">
              Screen Lock is enabled without a local PIN hash on this device. Enter a new 4-digit PIN below and click Save All Settings.
            </div>
          )}
          {pinError && (
            <div role="alert" className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 font-semibold">
              {pinError}
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                Enable 4-Digit Counter Screen Lock
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                PIN is stored on-device as a salted PBKDF2-SHA256 hash and is never exported in backups.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                onChange={(e) => {
                  setNewPin(e.target.value.replace(/[^0-9]/g, ''));
                  setPinError(null);
                }}
                placeholder="New PIN"
                aria-label="New 4-digit security PIN (leave blank to keep existing)"
                className="w-24 text-center font-bold tracking-widest text-sm border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                role="switch"
                aria-checked={isPinEnabled}
                aria-label="Enable 4-Digit Counter Screen Lock"
                onClick={() => {
                  setIsPinEnabled((prev) => !prev);
                  setPinError(null);
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1 ${
                  isPinEnabled ? 'bg-emerald-700' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white border border-slate-300 shadow transition-transform ${
                    isPinEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                Allow Negative Inventory Stock (Overselling)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Disabled by default to block sales when stock is insufficient. Enable only if physical deliveries arrive before bills are entered.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={allowNegativeStock}
              aria-label="Allow Negative Inventory Stock (Overselling)"
              onClick={() => setAllowNegativeStock((prev) => !prev)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1 ${
                allowNegativeStock ? 'bg-amber-600' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white border border-slate-300 shadow transition-transform ${
                  allowNegativeStock ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
          {saveSuccess ? (
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Settings Saved Successfully!</span>
            </span>
          ) : (
            <span />
          )}

          <button
            type="submit"
            className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm cursor-pointer"
          >
            Save All Settings
          </button>
        </div>
      </form>
        </>
      )}

      {settingsActiveSection === 'CATEGORIES' && <CategoryManagerView />}

      {settingsActiveSection === 'BACKUP' && (
        <>
      {/* Local-First IndexedDB, Auto Backup & Sync Dashboard */}
      <SyncBackupDashboard />

      {demoDataAnalysis.hasDemoRecords && (
        <div className="bg-amber-50/90 dark:bg-amber-950/30 rounded-2xl p-5 border border-amber-300 dark:border-amber-800 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-amber-950 dark:text-amber-200 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                <span>Sample Demo Records Detected in Existing Database</span>
              </h3>
              <p className="text-xs text-amber-900/90 dark:text-amber-200/80 mt-0.5">
                Found {demoDataAnalysis.totalDemoRecords} sample demo records alongside {demoDataAnalysis.totalRealRecords} real shop records. Real records and any demo items linked to real transactions are strictly protected.
              </p>
            </div>
            {!showCleanDemoConfirm && (
              <button
                type="button"
                onClick={() => setShowCleanDemoConfirm(true)}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold shrink-0 self-start sm:self-auto cursor-pointer"
              >
                Review &amp; Remove Demo Data Only
              </button>
            )}
          </div>

          {showCleanDemoConfirm && (
            <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 space-y-2.5 text-xs">
              <div className="text-slate-700 dark:text-slate-200 leading-relaxed">
                This manual cleanup removes ONLY unreferenced sample fixtures (customers, products, sales, expenses, cashbook). Any real shop records ({demoDataAnalysis.totalRealRecords}) and any referenced demo entries ({demoDataAnalysis.referencedDemoCustomerIds.length + demoDataAnalysis.referencedDemoSupplierIds.length + demoDataAnalysis.referencedDemoProductIds.length}) will be kept untouched.
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCleanDemoConfirm(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await clearDemoRecordsOnly();
                    setShowCleanDemoConfirm(false);
                    setSettingsNotice({
                      type: 'success',
                      message: `Removed ${res.removedCount} unreferenced sample demo records cleanly. All real shop records${res.preservedReferencedCount > 0 ? ` and ${res.preservedReferencedCount} referenced records` : ''} were preserved.`,
                    });
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                >
                  Confirm Demo-Only Cleanup
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legacy Quick Backup & Reset Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <span>Quick Backup Center &amp; Sample Data (Testing)</span>
          </h3>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 self-start sm:self-auto">
            {getBackupSummary().totalTransactions} Transactions Stored Locally
          </span>
        </div>

        {settingsNotice && (
          <div
            className={`p-3 rounded-xl text-xs font-medium border ${
              settingsNotice.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 text-emerald-900 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 text-red-800 dark:text-red-200'
            }`}
          >
            {settingsNotice.message}
          </div>
        )}

        {encryptedPrompt && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 space-y-2.5 text-xs">
            <div className="font-bold text-emerald-950 dark:text-emerald-200">
              Encrypted Backup Detected ({encryptedPrompt.fileName}) — Enter Passphrase
            </div>
            {encryptedPrompt.error && (
              <div className="text-red-600 dark:text-red-400 font-semibold">{encryptedPrompt.error}</div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={encryptedPrompt.passphrase}
                onChange={(e) =>
                  setEncryptedPrompt((prev) =>
                    prev ? { ...prev, passphrase: e.target.value, error: undefined } : null
                  )
                }
                placeholder="Enter backup decryption passphrase..."
                className="flex-1 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEncryptedPrompt(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white dark:bg-slate-900 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    inspectSelectedBackup(
                      encryptedPrompt.content,
                      encryptedPrompt.fileName,
                      encryptedPrompt.passphrase
                    )
                  }
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  Decrypt &amp; Preview
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingLegacyRestore && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <strong>Confirm Restore for &quot;{pendingLegacyRestore.storeName}&quot;?</strong> (
                {pendingLegacyRestore.count} transactions &amp; {pendingLegacyRestore.billDocsCount} bill docs will replace current local dataset after saving a rollback snapshot ·{' '}
                {pendingLegacyRestore.checksumValid ? 'SHA-256 Verified' : 'Legacy Schema'})
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPendingLegacyRestore(null)}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white dark:bg-slate-900 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await restoreBackupFromJSONSafe(
                      pendingLegacyRestore.content,
                      pendingLegacyRestore.passphrase
                    );
                    setPendingLegacyRestore(null);
                    setSettingsNotice(
                      result.success
                        ? { type: 'success', message: `Backup restored safely! ${result.count || 0} transactions loaded.` }
                        : { type: 'error', message: `Restore failed: ${result.error || 'Unknown error'}` }
                    );
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  Confirm Restore
                </button>
              </div>
            </div>
            <BackupReconciliationCard report={pendingLegacyRestore.reconciliationReport} />
          </div>
        )}

        {showResetConfirm && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-red-900 dark:text-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>Load sample {BRAND_NAME} demo dataset for testing? Your real shop records will be replaced unless you export a backup first.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 rounded-lg border border-red-200 bg-white dark:bg-slate-900 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  resetToDemoData();
                  setShowResetConfirm(false);
                  setSettingsNotice({ type: 'success', message: `Loaded sample ${BRAND_NAME} demo dataset.` });
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold cursor-pointer"
              >
                Confirm Load Demo
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <button
            type="button"
            onClick={() => setIsBackupModalOpen(true)}
            className="flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            <Database className="w-4 h-4" />
            <span>Open Backup Center</span>
          </button>

          <label className="flex items-center justify-center gap-2 p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer">
            <Upload className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            <span>Quick Restore JSON</span>
            <input type="file" accept=".json,.skbackup.json,application/json" onChange={handleFileImport} className="hidden" />
          </label>

          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center justify-center gap-2 p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 font-bold text-xs hover:bg-red-100 dark:hover:bg-red-950/80 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span>Load Sample Demo Data</span>
          </button>
        </div>
      </div>
        </>
      )}

      {settingsActiveSection === 'THERMAL_PRINT' && (
        <ThermalPrintSettingsSection
          profile={profile}
          onSaveConfig={(thermalPrintConfig) => updateProfile({ thermalPrintConfig })}
        />
      )}

      {settingsActiveSection === 'WHATSAPP' && (
        <>
      {/* Custom WhatsApp Reminder Template Builder */}
      <WhatsAppTemplateBuilder />

      {/* Transaction Audit Trail (Never silent deletion) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-slate-700 dark:text-slate-300" />
          <span>Audit Log History (Audit Log)</span>
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Permanent log of all sales, payments, customer deletions, and stock adjustments for accounting transparency.
        </p>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto pr-1">
          {auditLogs.map((log) => (
            <div key={log.id} className="py-2.5 flex items-start justify-between text-xs gap-3">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{log.action}</div>
                <div className="text-slate-600 dark:text-slate-300 mt-0.5">{log.details}</div>
              </div>
              <div className="text-right shrink-0 text-[11px] text-slate-400">
                <div>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                <div>{new Date(log.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
        </>
      )}
    </div>
  );
};
