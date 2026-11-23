import React from 'react';
import { ArrowRight } from 'lucide-react';
import { BRAND_NAME } from './BrandLogo';

interface WelcomeScreenProps {
  isReady: boolean;
  storeName?: string;
  needsSetup?: boolean;
  onContinue: () => void;
}

export const WELCOME_SCREEN_IMAGE_PATH = '/assets/aistudio/Screenshot_2026_1117_164535_14aaca88.jpg';

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  isReady,
  storeName,
  needsSetup = false,
  onContinue,
}) => {
  const displayStore = storeName?.trim() || BRAND_NAME;
  const ctaLabel = !isReady
    ? 'Opening Store...'
    : needsSetup
    ? 'Get Started'
    : `Enter ${displayStore}`;

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#eff8dd] via-[#e4f3cb] to-[#d4ecc0] dark:from-slate-950 dark:via-emerald-950/90 dark:to-slate-950 flex items-center justify-center sm:p-4 lg:p-6">
      <section
        aria-label={`Welcome to ${displayStore}`}
        className="relative w-full h-[100dvh] sm:h-[min(830px,calc(100dvh-2.5rem))] sm:max-w-[420px] sm:rounded-[28px] sm:shadow-2xl sm:border sm:border-emerald-900/15 dark:sm:border-emerald-500/20 bg-[#f6fbe9] overflow-hidden flex flex-col justify-end select-none"
      >
        {/* Full-bleed Welcome Illustration (cropped cleanly to exclude phone frame edges) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={WELCOME_SCREEN_IMAGE_PATH}
            alt={`${BRAND_NAME} — Shop, Manage, Grow`}
            className="w-full h-full object-cover object-center scale-[1.12] -translate-y-[1.2%]"
          />
        </div>

        {/* Bottom Grass-Blended CTA Overlay */}
        <div className="relative z-10 bg-gradient-to-t from-[#067a11] via-[#098f16]/85 to-transparent pt-14 pb-6 px-5 sm:px-6 flex flex-col items-center gap-2.5">
          <button
            type="button"
            disabled={!isReady}
            onClick={onContinue}
            className="w-full min-h-[48px] px-6 py-3 rounded-xl bg-white hover:bg-emerald-50 active:bg-emerald-100 disabled:opacity-80 disabled:cursor-wait text-[#075e12] font-bold text-sm sm:text-base shadow-lg shadow-black/15 transition-colors cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#067a11]"
          >
            <span>{ctaLabel}</span>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </button>
          <p className="text-[11px] font-medium text-white/90 tracking-wide text-center">
            Offline Kirana Ledger · Sales · Khata · Stock
          </p>
        </div>
      </section>
    </div>
  );
};
