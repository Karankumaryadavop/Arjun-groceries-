import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StoreProfile, ThermalPaperWidth, ThermalPrintConfig } from '../types';
import {
  ALLOWED_LOGO_MIME_TYPES,
  buildSampleThermalReceipt,
  cleanMultilineEntries,
  DEFAULT_THERMAL_PRINT_CONFIG,
  normalizeThermalPrintConfig,
  resolveThermalPrintConfig,
  validateThermalLogoDataUrl,
} from '../utils/thermalPrint';
import { ThermalReceiptPreview, triggerCustomThermalPrint } from './ThermalReceiptPreview';
import {
  Printer,
  Upload,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Image as ImageIcon,
  AlignCenter,
  AlignLeft,
  AlertTriangle,
} from 'lucide-react';

interface ThermalPrintSettingsSectionProps {
  profile: StoreProfile;
  onSaveConfig: (config: ThermalPrintConfig) => void;
}

async function compressLogoImageFile(file: File): Promise<string> {
  if (!ALLOWED_LOGO_MIME_TYPES.has(file.type)) {
    throw new Error('Please upload a PNG, JPG, WebP, or SVG logo image.');
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('Logo image must be smaller than 4 MB.');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected logo file.'));
    reader.readAsDataURL(file);
  });

  if (file.type === 'image/svg+xml') {
    if (!validateThermalLogoDataUrl(rawDataUrl)) {
      throw new Error('SVG logo is too large or invalid.');
    }
    return rawDataUrl;
  }

  // Downscale raster images onto an offscreen canvas for crisp thermal printing & lean IndexedDB storage
  return await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = 320;
      const maxHeight = 160;
      const scale = Math.min(1, maxWidth / (img.width || 1), maxHeight / (img.height || 1));
      const targetW = Math.max(24, Math.round((img.width || 120) * scale));
      const targetH = Math.max(24, Math.round((img.height || 60) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const compressed = canvas.toDataURL('image/png');
      if (validateThermalLogoDataUrl(compressed)) {
        resolve(compressed);
      } else {
        const jpeg = canvas.toDataURL('image/jpeg', 0.82);
        if (!validateThermalLogoDataUrl(jpeg)) {
          reject(new Error('Unable to compress logo image to a valid size.'));
        } else {
          resolve(jpeg);
        }
      }
    };
    img.onerror = () => reject(new Error('Could not decode the selected image file.'));
    img.src = rawDataUrl;
  });
}

export const ThermalPrintSettingsSection: React.FC<ThermalPrintSettingsSectionProps> = ({
  profile,
  onSaveConfig,
}) => {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const initialConfig = useMemo(() => resolveThermalPrintConfig(profile), [profile]);

  const [paperWidth, setPaperWidth] = useState<ThermalPaperWidth>(initialConfig.paperWidth);
  const [showLogo, setShowLogo] = useState<boolean>(initialConfig.showLogo);
  const [logoMode, setLogoMode] = useState<'DEFAULT' | 'CUSTOM'>(initialConfig.logoMode);
  const [customLogoDataUrl, setCustomLogoDataUrl] = useState<string | undefined>(
    initialConfig.customLogoDataUrl
  );
  const [logoHeightPx, setLogoHeightPx] = useState<number>(initialConfig.logoHeightPx);
  const [headerAlignment, setHeaderAlignment] = useState<'CENTER' | 'LEFT'>(
    initialConfig.headerAlignment
  );
  const [headerTitle, setHeaderTitle] = useState<string>(initialConfig.headerTitle || '');
  const [headerLinesText, setHeaderLinesText] = useState<string>(
    initialConfig.headerLines.join('\n')
  );
  const [footerLinesText, setFooterLinesText] = useState<string>(
    initialConfig.footerLines.join('\n')
  );
  const [showAddress, setShowAddress] = useState<boolean>(initialConfig.showAddress);
  const [showPhone, setShowPhone] = useState<boolean>(initialConfig.showPhone);
  const [showGstin, setShowGstin] = useState<boolean>(initialConfig.showGstin);
  const [showUpiId, setShowUpiId] = useState<boolean>(initialConfig.showUpiId);
  const [showUpiQr, setShowUpiQr] = useState<boolean>(initialConfig.showUpiQr);
  const [showCustomerBalance, setShowCustomerBalance] = useState<boolean>(
    initialConfig.showCustomerBalance
  );
  const [showItemDiscount, setShowItemDiscount] = useState<boolean>(initialConfig.showItemDiscount);

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const resolved = resolveThermalPrintConfig(profile);
    setPaperWidth(resolved.paperWidth);
    setShowLogo(resolved.showLogo);
    setLogoMode(resolved.logoMode);
    setCustomLogoDataUrl(resolved.customLogoDataUrl);
    setLogoHeightPx(resolved.logoHeightPx);
    setHeaderAlignment(resolved.headerAlignment);
    setHeaderTitle(resolved.headerTitle || '');
    setHeaderLinesText(resolved.headerLines.join('\n'));
    setFooterLinesText(resolved.footerLines.join('\n'));
    setShowAddress(resolved.showAddress);
    setShowPhone(resolved.showPhone);
    setShowGstin(resolved.showGstin);
    setShowUpiId(resolved.showUpiId);
    setShowUpiQr(resolved.showUpiQr);
    setShowCustomerBalance(resolved.showCustomerBalance);
    setShowItemDiscount(resolved.showItemDiscount);
  }, [profile]);

  const draftConfig: ThermalPrintConfig = useMemo(
    () =>
      normalizeThermalPrintConfig({
        paperWidth,
        showLogo,
        logoMode,
        customLogoDataUrl,
        logoHeightPx,
        headerAlignment,
        headerTitle,
        headerLines: cleanMultilineEntries(headerLinesText),
        footerLines: cleanMultilineEntries(footerLinesText),
        showAddress,
        showPhone,
        showGstin,
        showUpiId,
        showUpiQr,
        showCustomerBalance,
        showItemDiscount,
      }),
    [
      paperWidth,
      showLogo,
      logoMode,
      customLogoDataUrl,
      logoHeightPx,
      headerAlignment,
      headerTitle,
      headerLinesText,
      footerLinesText,
      showAddress,
      showPhone,
      showGstin,
      showUpiId,
      showUpiQr,
      showCustomerBalance,
      showItemDiscount,
    ]
  );

  const sampleReceipt = useMemo(() => buildSampleThermalReceipt(profile), [profile]);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setNotice(null);

    try {
      const dataUrl = await compressLogoImageFile(file);
      setCustomLogoDataUrl(dataUrl);
      setLogoMode('CUSTOM');
      setShowLogo(true);
      setNotice({ type: 'success', text: 'Custom store logo uploaded. Click "Save Print Layout" to persist.' });
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to process selected logo image.',
      });
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const saved: ThermalPrintConfig = {
      ...draftConfig,
      updatedAt: new Date().toISOString(),
    };
    onSaveConfig(saved);
    setNotice({
      type: 'success',
      text: 'Thermal receipt layout saved! Applied automatically to Quick Sale bills and Sales reprints.',
    });
  };

  const handleResetDefaults = () => {
    const def = DEFAULT_THERMAL_PRINT_CONFIG;
    setPaperWidth(def.paperWidth);
    setShowLogo(def.showLogo);
    setLogoMode(def.logoMode);
    setCustomLogoDataUrl(undefined);
    setLogoHeightPx(def.logoHeightPx);
    setHeaderAlignment(def.headerAlignment);
    setHeaderTitle('');
    setHeaderLinesText(def.headerLines.join('\n'));
    setFooterLinesText(def.footerLines.join('\n'));
    setShowAddress(def.showAddress);
    setShowPhone(def.showPhone);
    setShowGstin(def.showGstin);
    setShowUpiId(def.showUpiId);
    setShowUpiQr(def.showUpiQr);
    setShowCustomerBalance(def.showCustomerBalance);
    setShowItemDiscount(def.showItemDiscount);
    setNotice({ type: 'success', text: 'Reset to default thermal print layout. Click "Save Print Layout" to confirm.' });
  };

  const handleTestPrint = async () => {
    const ok = await triggerCustomThermalPrint({
      profile,
      receipt: sampleReceipt,
      configOverride: draftConfig,
    });
    if (!ok) {
      setNotice({
        type: 'error',
        text: 'Could not open browser print dialog in this view. Try saving and printing from a receipt.',
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Configuration Form */}
      <form
        onSubmit={handleSave}
        className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
              <Printer className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              <span>Thermal Bill Print Layout</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize store logo, paper width, custom headers, and footer messages for counter receipts.
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
        </div>

        {notice && (
          <div
            className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
              notice.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-rose-950/40 border-red-200 dark:border-rose-800 text-red-800 dark:text-rose-200'
            }`}
          >
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        )}

        {/* Paper Width & Header Alignment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Thermal Paper Roll Width
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(['58mm', '80mm'] as ThermalPaperWidth[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setPaperWidth(w)}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                    paperWidth === w
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {w} {w === '58mm' ? '(2-inch)' : '(3-inch)'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Header Alignment
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setHeaderAlignment('CENTER')}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                  headerAlignment === 'CENTER'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                }`}
              >
                <AlignCenter className="w-3.5 h-3.5" />
                <span>Centered</span>
              </button>
              <button
                type="button"
                onClick={() => setHeaderAlignment('LEFT')}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                  headerAlignment === 'LEFT'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                }`}
              >
                <AlignLeft className="w-3.5 h-3.5" />
                <span>Left Aligned</span>
              </button>
            </div>
          </div>
        </div>

        {/* Store Logo Controls */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer">
              <input
                type="checkbox"
                checked={showLogo}
                onChange={(e) => setShowLogo(e.target.checked)}
                className="w-4 h-4 accent-emerald-700 cursor-pointer"
              />
              <ImageIcon className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Print Store Logo on Top of Receipt</span>
            </label>
          </div>

          {showLogo && (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLogoMode('DEFAULT')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                    logoMode === 'DEFAULT'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-800 dark:text-emerald-200'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Use Default Store Logo
                </button>
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                    logoMode === 'CUSTOM'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-800 dark:text-emerald-200'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{customLogoDataUrl ? 'Change Custom Logo' : 'Upload Custom Logo'}</span>
                </button>
                {customLogoDataUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomLogoDataUrl(undefined);
                      setLogoMode('DEFAULT');
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogoFileChange}
                  aria-label="Upload custom receipt logo"
                  className="hidden"
                />
              </div>

              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  <span>Logo Size</span>
                  <span className="tabular-nums font-bold">{logoHeightPx}px</span>
                </label>
                <input
                  type="range"
                  min={28}
                  max={76}
                  step={2}
                  value={logoHeightPx}
                  onChange={(e) => setLogoHeightPx(Number(e.target.value))}
                  className="w-full accent-emerald-700 cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>

        {/* Custom Header & Footer Text */}
        <div className="space-y-3">
          <div>
            <label
              htmlFor="thermal-header-title"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Receipt Header Title (Optional override — defaults to Store Name)
            </label>
            <input
              id="thermal-header-title"
              type="text"
              value={headerTitle}
              onChange={(e) => setHeaderTitle(e.target.value)}
              placeholder={profile.storeName || 'Arjun Groceries'}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
            />
          </div>

          <div>
            <label
              htmlFor="thermal-header-lines"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Custom Header Lines (1 per line, up to 6 lines — e.g., tagline, FSSAI, receipt type)
            </label>
            <textarea
              id="thermal-header-lines"
              rows={3}
              value={headerLinesText}
              onChange={(e) => setHeaderLinesText(e.target.value)}
              placeholder={'Fresh Daily Kirana & Groceries\nFSSAI Lic. No: 12345678901234\nESTIMATE BILL / KACHA PARCHI'}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
            />
          </div>

          <div>
            <label
              htmlFor="thermal-footer-lines"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Custom Footer Message (1 per line, up to 6 lines — e.g., thank you note, return policy)
            </label>
            <textarea
              id="thermal-footer-lines"
              rows={3}
              value={footerLinesText}
              onChange={(e) => setFooterLinesText(e.target.value)}
              placeholder={'Thank you for shopping with us!\nGoods once sold can be exchanged within 24 hours.'}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
            />
          </div>
        </div>

        {/* Field Visibility Toggles */}
        <div>
          <span className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            Receipt Details to Include
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {[
              { label: 'Store Address', checked: showAddress, onChange: setShowAddress },
              { label: 'Phone Number', checked: showPhone, onChange: setShowPhone },
              { label: 'GSTIN Number', checked: showGstin, onChange: setShowGstin },
              { label: 'UPI Payment ID', checked: showUpiId, onChange: setShowUpiId },
              { label: 'UPI Scan QR Code', checked: showUpiQr, onChange: setShowUpiQr },
              {
                label: 'Customer Balance',
                checked: showCustomerBalance,
                onChange: setShowCustomerBalance,
              },
              { label: 'Item Discounts', checked: showItemDiscount, onChange: setShowItemDiscount },
            ].map((item) => (
              <label
                key={item.label}
                className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => item.onChange(e.target.checked)}
                  className="w-4 h-4 accent-emerald-700 cursor-pointer shrink-0"
                />
                <span className="leading-snug">{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Submit / Test Print Bar */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              void handleTestPrint();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Test Print Receipt</span>
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-bold shadow-xs cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Save Print Layout</span>
          </button>
        </div>
      </form>

      {/* Live Thermal Receipt Preview */}
      <div className="lg:col-span-5 lg:sticky lg:top-4 bg-slate-100 dark:bg-slate-900/70 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Live Thermal Receipt Preview
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {paperWidth} thermal roll · Updates live as you edit
            </p>
          </div>
          <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 tabular-nums">
            {paperWidth}
          </span>
        </div>

        <ThermalReceiptPreview
          profile={profile}
          receipt={sampleReceipt}
          configOverride={draftConfig}
        />
      </div>
    </div>
  );
};
