import React from 'react';
import { AuthInitStage, AuthLifecycleStatus } from '../utils/authSession';
import { BrandLogo, BRAND_NAME, BRAND_TAGLINE } from './BrandLogo';

interface AuthSplashScreenProps {
  storeName?: string;
  authStatus: AuthLifecycleStatus;
  stage: AuthInitStage;
}

const STAGE_COPY: Record<
  AuthInitStage,
  { title: string; subtitle: string; progressScale: number }
> = {
  'opening-database': {
    title: 'Opening store records…',
    subtitle: 'Preparing your on-device ledger',
    progressScale: 0.35,
  },
  'verifying-session': {
    title: 'Verifying your session…',
    subtitle: 'Checking saved store credentials',
    progressScale: 0.68,
  },
  'syncing-auth-provider': {
    title: 'Restoring account state…',
    subtitle: 'Confirming authentication status',
    progressScale: 0.9,
  },
  ready: {
    title: 'Opening your store…',
    subtitle: 'Almost ready',
    progressScale: 1,
  },
};

export const AuthSplashScreen: React.FC<AuthSplashScreenProps> = ({
  storeName,
  authStatus,
  stage,
}) => {
  const displayName = storeName?.trim() || BRAND_NAME;
  const nameWords = displayName.split(/\s+/).filter(Boolean);
  const firstWord = nameWords[0] || 'Arjun';
  const restWords = nameWords.slice(1).join(' ') || 'Groceries';
  const copy = STAGE_COPY[stage] || STAGE_COPY['opening-database'];

  return (
    <div
      data-testid="auth-splash-screen"
      data-auth-status={authStatus}
      data-auth-stage={stage}
      className="min-h-[100dvh] w-full bg-gradient-to-b from-[#eff8dd] via-[#e4f3cb] to-[#d4ecc0] dark:from-slate-950 dark:via-emerald-950/90 dark:to-slate-950 flex items-center justify-center p-4 sm:p-6 antialiased"
    >
      <section
        aria-label={`Loading ${displayName}`}
        aria-busy="true"
        className="relative w-full max-w-[420px] min-h-[460px] rounded-[28px] bg-white dark:bg-slate-900 border border-emerald-900/15 dark:border-emerald-500/20 shadow-2xl overflow-hidden flex flex-col items-center justify-between px-8 py-12 text-center"
      >
        {/* Subtle Botanical Corner Motifs (matches LoginScreen visual language) */}
        <div className="pointer-events-none select-none" aria-hidden="true">
          <svg
            viewBox="0 0 180 140"
            className="absolute -bottom-4 -left-4 w-32 h-24 opacity-80 dark:opacity-25"
            fill="none"
          >
            <path
              d="M12 132C18 88 54 62 96 68C76 98 48 122 12 132Z"
              fill="#b7f07c"
            />
            <path
              d="M4 134C22 104 42 88 70 86C58 112 32 128 4 134Z"
              fill="#7ee242"
            />
          </svg>
          <svg
            viewBox="0 0 220 140"
            className="absolute -bottom-3 -right-3 w-44 h-28 opacity-85 dark:opacity-25"
            fill="none"
          >
            <path
              d="M20 140C65 92 140 50 220 18V140H20Z"
              fill="#9ced5e"
            />
            <path
              d="M72 140C115 104 170 72 220 48V140H72Z"
              fill="#4fd22b"
            />
          </svg>
        </div>

        {/* Brand Lockup */}
        <div className="relative z-10 flex flex-col items-center">
          <BrandLogo
            sizeClass="w-20 h-20"
            roundedClass="rounded-2xl"
            className="shadow-md shadow-emerald-950/15 mb-4"
          />
          <h1 className="flex flex-col items-center leading-none">
            <span className="text-[30px] font-extrabold tracking-tight text-[#0d4d18] dark:text-emerald-200">
              {firstWord}
            </span>
            <span className="text-[26px] font-extrabold tracking-tight text-[#1da21b] dark:text-emerald-400 -mt-1">
              {restWords}
            </span>
          </h1>
          <svg
            viewBox="0 0 180 14"
            className="w-36 h-3 mt-1.5"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 10C58 2 122 2 172 9"
              stroke="#1da21b"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </svg>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-3 tracking-wide">
            {BRAND_TAGLINE}
          </p>
        </div>

        {/* Progress Indicator & Accessible Status */}
        <div
          role="status"
          aria-live="polite"
          className="relative z-10 w-full max-w-[260px] flex flex-col items-center my-6"
        >
          <div
            aria-hidden="true"
            className="w-9 h-9 rounded-full border-[3px] border-emerald-100 dark:border-emerald-950 border-t-[#0d7f1f] dark:border-t-emerald-400 animate-spin motion-reduce:animate-none mb-4"
          />
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {copy.title}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {copy.subtitle}
          </p>

          {/* Compositor-only transform progress bar */}
          <div
            aria-hidden="true"
            className="w-full h-1.5 rounded-full bg-emerald-100 dark:bg-slate-800 overflow-hidden mt-4"
          >
            <div
              className="h-full w-full origin-left rounded-full bg-[#0d7f1f] dark:bg-emerald-500 transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${copy.progressScale})` }}
            />
          </div>
        </div>

        {/* Quiet Footer */}
        <p className="relative z-10 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Offline Store Ledger · Sales · Khata · Stock
        </p>
      </section>
    </div>
  );
};
