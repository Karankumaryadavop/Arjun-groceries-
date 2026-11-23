export const ACCENT_STORAGE_KEY = 'kirana_pro_accent_v1';
export const DEFAULT_ACCENT_COLOR = '#047857';

export type AccentShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type AccentRamp = Record<AccentShade, string>;

export interface AccentPreset {
  id: string;
  name: string;
  subtitle: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'emerald',
    name: 'Arjun Emerald',
    subtitle: 'Signature store green',
    hex: '#047857',
  },
  {
    id: 'teal',
    name: 'Ocean Teal',
    subtitle: 'Fresh cyan-green',
    hex: '#0f766e',
  },
  {
    id: 'blue',
    name: 'Royal Blue',
    subtitle: 'Classic retail blue',
    hex: '#1d4ed8',
  },
  {
    id: 'indigo',
    name: 'Midnight Indigo',
    subtitle: 'Deep modern navy',
    hex: '#4338ca',
  },
  {
    id: 'amber',
    name: 'Saffron Gold',
    subtitle: 'Warm marigold spice',
    hex: '#b45309',
  },
  {
    id: 'crimson',
    name: 'Kirana Crimson',
    subtitle: 'Bold ruby red',
    hex: '#be123c',
  },
  {
    id: 'violet',
    name: 'Plum Violet',
    subtitle: 'Rich royal purple',
    hex: '#6d28d9',
  },
];

const SHADE_KEYS: AccentShade[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/**
 * Normalizes a CSS hex color string into #rrggbb lowercase format, or returns null if invalid.
 */
export function normalizeHexColor(input: string | undefined | null): string | null {
  if (!input || typeof input !== 'string') return null;
  let trimmed = input.trim();
  if (!trimmed.startsWith('#')) {
    trimmed = `#${trimmed}`;
  }
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHexColor(hex) ?? DEFAULT_ACCENT_COLOR;
  const num = parseInt(clean.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const hn = ((h % 360) + 360) % 360;

  if (sn === 0) {
    const val = Math.round(ln * 255);
    return { r: val, g: val, b: val };
  }

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hueToChannel = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const hNorm = hn / 360;
  return {
    r: Math.round(hueToChannel(hNorm + 1 / 3) * 255),
    g: Math.round(hueToChannel(hNorm) * 255),
    b: Math.round(hueToChannel(hNorm - 1 / 3) * 255),
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function getWcagContrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const bright = Math.max(lumA, lumB);
  const dark = Math.min(lumA, lumB);
  return Math.round(((bright + 0.05) / (dark + 0.05)) * 100) / 100;
}

export function getContrastTextColor(bgHex: string): '#ffffff' | '#0f172a' {
  const whiteContrast = getWcagContrastRatio('#ffffff', bgHex);
  const darkContrast = getWcagContrastRatio('#0f172a', bgHex);
  return whiteContrast >= darkContrast ? '#ffffff' : '#0f172a';
}

/**
 * Generates an accessible 11-step tonal ramp (50..950) from any hex brand color.
 * Ensures shade 700/800 maintain strong >= 4.5:1 contrast with white text when feasible
 * for primary buttons, and 900/950 provide deep sidebar tones.
 */
export function generateAccentRamp(rawHex: string): AccentRamp {
  const normalized = normalizeHexColor(rawHex) ?? DEFAULT_ACCENT_COLOR;
  const { r, g, b } = hexToRgb(normalized);
  const { h, s } = rgbToHsl(r, g, b);

  // Target lightness levels matching Tailwind tonal ergonomics
  const lightnessMap: Record<AccentShade, { l: number; sFactor: number }> = {
    50: { l: 96, sFactor: 0.75 },
    100: { l: 91, sFactor: 0.8 },
    200: { l: 83, sFactor: 0.85 },
    300: { l: 72, sFactor: 0.9 },
    400: { l: 60, sFactor: 0.96 },
    500: { l: 48, sFactor: 1.0 },
    600: { l: 40, sFactor: 1.0 },
    700: { l: 33, sFactor: 0.98 },
    800: { l: 27, sFactor: 0.92 },
    900: { l: 21, sFactor: 0.85 },
    950: { l: 14, sFactor: 0.78 },
  };

  const ramp = {} as AccentRamp;
  for (const shade of SHADE_KEYS) {
    const spec = lightnessMap[shade];
    const effectiveSat = s < 5 ? s : Math.min(96, Math.max(12, s * spec.sFactor));
    let rgb = hslToRgb(h, effectiveSat, spec.l);
    let candidate = rgbToHex(rgb.r, rgb.g, rgb.b);

    // Ensure primary CTA shades (700, 800) hit >= 4.5:1 against white text
    if (shade === 700 || shade === 800) {
      let currentL = spec.l;
      while (getWcagContrastRatio('#ffffff', candidate) < 4.55 && currentL > 12) {
        currentL -= 2;
        rgb = hslToRgb(h, effectiveSat, currentL);
        candidate = rgbToHex(rgb.r, rgb.g, rgb.b);
      }
    }

    ramp[shade] = candidate;
  }

  return ramp;
}

/**
 * Applies or resets CSS custom properties on document.documentElement so the entire
 * Tailwind v4 theme (--color-emerald-*) updates dynamically without page reload.
 */
export function applyAccentColorToDocument(rawHex: string): AccentRamp {
  const normalized = normalizeHexColor(rawHex) ?? DEFAULT_ACCENT_COLOR;
  const ramp = generateAccentRamp(normalized);

  if (typeof document !== 'undefined' && document.documentElement) {
    const style = document.documentElement.style;
    if (normalized === DEFAULT_ACCENT_COLOR) {
      for (const shade of SHADE_KEYS) {
        style.removeProperty(`--color-emerald-${shade}`);
      }
    } else {
      for (const shade of SHADE_KEYS) {
        style.setProperty(`--color-emerald-${shade}`, ramp[shade]);
      }
    }
    style.setProperty('--brand-accent-hex', normalized);
    style.setProperty('--brand-accent-500', ramp[500]);
    style.setProperty('--brand-accent-700', ramp[700]);
    style.setProperty('--brand-accent-contrast', getContrastTextColor(ramp[700]));
  }

  return ramp;
}
