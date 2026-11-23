import React, { useEffect, useState } from 'react';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Clock,
  CheckCircle2,
  ArrowLeft,
  Store,
  Phone,
  Users,
  Truck,
  KeyRound,
  ShieldCheck,
  UserPlus,
  Mail,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getPinCooldownRemainingSeconds } from '../utils/securityCrypto';
import { validateLoginCredentialsInput } from '../utils/loginValidation';
import { BRAND_NAME } from './BrandLogo';
import { RegisterStoreView } from './RegisterStoreView';

interface LoginScreenProps {
  onSuccess?: () => void;
}

type AuthScreenMode =
  | 'OWNER_LOGIN'
  | 'FORGOT_PASSWORD'
  | 'CREATE_ACCOUNT'
  | 'CUSTOMER_LOGIN'
  | 'SUPPLIER_LOGIN';

type RecoveryMethod = 'STORE_DETAILS' | 'GOOGLE';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const {
    profile,
    updateProfile,
    hasPinConfigured,
    unlockWithPin,
    updatePinSecurity,
    completeStoreLogin,
    requestPasswordResetEmail,
    recoverOwnerWithStoreDetails,
    recoverOwnerWithGoogle,
    loginAsCustomer,
    loginAsSupplier,
    authNotice,
    clearAuthNotice,
  } = useStore();

  const [mode, setMode] = useState<AuthScreenMode>('OWNER_LOGIN');

  // Owner Login state
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showForgotOption, setShowForgotOption] = useState(false);
  const [lastValidMobile, setLastValidMobile] = useState('');

  // Forgot Password Email Overlay state (Firebase sendPasswordResetEmail)
  const [isForgotOverlayOpen, setIsForgotOverlayOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetProviderDisabled, setResetProviderDisabled] = useState(false);
  const [resetSentBanner, setResetSentBanner] = useState<string | null>(null);

  // Offline Forgot Password / Alternate PIN Recovery state
  const [recoveryMethod, setRecoveryMethod] = useState<RecoveryMethod>('STORE_DETAILS');
  const [recoveryMobile, setRecoveryMobile] = useState('');
  const [recoveryOwnerName, setRecoveryOwnerName] = useState('');
  const [recoveryStoreName, setRecoveryStoreName] = useState('');
  const [recoveryNewPin, setRecoveryNewPin] = useState('');
  const [recoveryConfirmPin, setRecoveryConfirmPin] = useState('');
  const [showRecoveryPin, setShowRecoveryPin] = useState(false);

  // Customer / Supplier Portal Login state
  const [portalName, setPortalName] = useState('');
  const [portalPhone, setPortalPhone] = useState('');

  // Shared feedback state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldownSec, setCooldownSec] = useState<number>(() => getPinCooldownRemainingSeconds());

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = setInterval(() => {
      const rem = getPinCooldownRemainingSeconds();
      setCooldownSec(rem);
      if (rem <= 0) {
        setErrorMsg(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSec]);

  useEffect(() => {
    if (!isForgotOverlayOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsForgotOverlayOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isForgotOverlayOpen]);

  const openForgotOverlay = () => {
    setResetIdentifier(lastValidMobile || mobile || '');
    setResetError(null);
    setResetSuccessMsg(null);
    setResetProviderDisabled(false);
    setIsForgotOverlayOpen(true);
  };

  const switchMode = (nextMode: AuthScreenMode) => {
    setMode(nextMode);
    setErrorMsg(null);
    clearAuthNotice();
    if (nextMode === 'FORGOT_PASSWORD') {
      setRecoveryMobile(lastValidMobile || mobile);
      setRecoveryNewPin('');
      setRecoveryConfirmPin('');
    }
    if (nextMode === 'CUSTOMER_LOGIN' || nextMode === 'SUPPLIER_LOGIN') {
      setPortalName('');
      setPortalPhone('');
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetSubmitting(true);
    setResetError(null);
    setResetSuccessMsg(null);
    setResetProviderDisabled(false);

    try {
      const res = await requestPasswordResetEmail(resetIdentifier);
      if (!res.success) {
        setResetError(res.error || 'Could not send password reset email. Please try again.');
        setResetProviderDisabled(Boolean(res.providerDisabled));
        return;
      }
      const successText =
        res.message ||
        'A password reset email has been sent. Please check your inbox and spam folder.';
      setResetSuccessMsg(successText);
      setResetSentBanner(successText);
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownSec > 0) {
      setErrorMsg(`Too many incorrect attempts. Try again in ${cooldownSec}s.`);
      setShowForgotOption(true);
      return;
    }

    const check = validateLoginCredentialsInput({
      mobile,
      pin,
      registeredPhone: profile.phone,
    });
    if (!check.valid || !check.normalizedMobile || !check.normalizedPin) {
      setErrorMsg(check.error || 'Please check your mobile number and 4-digit PIN.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    clearAuthNotice();
    try {
      if (hasPinConfigured) {
        const unlocked = await unlockWithPin(check.normalizedPin);
        if (!unlocked) {
          const remaining = getPinCooldownRemainingSeconds();
          setCooldownSec(remaining);
          setLastValidMobile(check.normalizedMobile);
          setShowForgotOption(true);
          setErrorMsg(
            remaining > 0
              ? `Too many incorrect attempts. Try again in ${remaining}s, or use Forgot password below.`
              : 'Incorrect PIN for this mobile number. Please try again or reset your password.'
          );
          return;
        }
        setShowForgotOption(false);
        if (!profile.phone || profile.phone.replace(/\D/g, '').length < 10) {
          updateProfile({ phone: check.normalizedMobile });
        }
        const sessionRes = await completeStoreLogin({
          authMode: 'PIN',
          mobile: check.normalizedMobile,
        });
        if (!sessionRes.success) {
          setErrorMsg(sessionRes.error || 'Could not start your store session. Please try again.');
          return;
        }
        onSuccess?.();
        return;
      }

      const setupRes = await updatePinSecurity(check.normalizedPin);
      if (!setupRes.success) {
        setErrorMsg(setupRes.error || 'Could not configure your store PIN.');
        return;
      }
      if (!profile.phone || profile.phone.replace(/\D/g, '').length < 10) {
        updateProfile({ phone: check.normalizedMobile });
      }
      const sessionRes = await completeStoreLogin({
        authMode: 'PIN',
        mobile: check.normalizedMobile,
      });
      if (!sessionRes.success) {
        setErrorMsg(sessionRes.error || 'Could not start your store session. Please try again.');
        return;
      }
      onSuccess?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    clearAuthNotice();
    try {
      if (recoveryMethod === 'STORE_DETAILS') {
        const res = await recoverOwnerWithStoreDetails({
          mobile: recoveryMobile,
          ownerName: recoveryOwnerName,
          storeName: recoveryStoreName,
          newPin: recoveryNewPin,
          confirmNewPin: recoveryConfirmPin,
        });
        if (!res.success) {
          setErrorMsg(res.error || 'Verification failed. Please check your registered details.');
          return;
        }
        setCooldownSec(0);
        setShowForgotOption(false);
        onSuccess?.();
      } else {
        const res = await recoverOwnerWithGoogle({
          newPin: recoveryNewPin,
          confirmNewPin: recoveryConfirmPin,
        });
        if (!res.success) {
          setErrorMsg(res.error || 'Google verification failed. Please try again.');
          return;
        }
        setCooldownSec(0);
        setShowForgotOption(false);
        onSuccess?.();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePortalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    clearAuthNotice();
    try {
      const res =
        mode === 'CUSTOMER_LOGIN'
          ? await loginAsCustomer({ name: portalName, phone: portalPhone })
          : await loginAsSupplier({ name: portalName, phone: portalPhone });

      if (!res.success) {
        setErrorMsg(res.error || 'Account verification failed. Please check your details.');
        return;
      }
      onSuccess?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Dedicated Register / Create Account View (connects to Firebase Auth & initializes Firestore store doc)
  if (mode === 'CREATE_ACCOUNT') {
    return (
      <RegisterStoreView
        onBack={() => switchMode('OWNER_LOGIN')}
        onSuccess={onSuccess}
      />
    );
  }

  const displayName = profile.storeName?.trim() || BRAND_NAME;
  const nameWords = displayName.split(/\s+/).filter(Boolean);
  const firstWord = nameWords[0] || 'Arjun';
  const restWords = nameWords.slice(1).join(' ') || 'Groceries';

  const headingCopy: Record<Exclude<AuthScreenMode, 'CREATE_ACCOUNT'>, { title: string; subtitle: string }> = {
    OWNER_LOGIN: {
      title: 'Welcome Back!',
      subtitle: 'Login to continue',
    },
    FORGOT_PASSWORD: {
      title: 'Login Another Way',
      subtitle: 'Verify your identity to reset your 4-digit PIN',
    },
    CUSTOMER_LOGIN: {
      title: 'Customer Login',
      subtitle: 'Check your purchases, udhar balance & payments',
    },
    SUPPLIER_LOGIN: {
      title: 'Supplier Login',
      subtitle: 'Check your supply invoices, payments & credit notes',
    },
  };

  const isCompactBrand = mode !== 'OWNER_LOGIN';

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#eff8dd] via-[#e4f3cb] to-[#d4ecc0] dark:from-slate-950 dark:via-emerald-950/90 dark:to-slate-950 flex items-center justify-center sm:p-4 lg:p-6">
      <section
        aria-label={`${displayName} ${headingCopy[mode].title}`}
        data-login-mode={mode}
        className="relative w-full min-h-[100dvh] sm:min-h-[760px] sm:max-w-[432px] sm:rounded-[28px] sm:shadow-2xl sm:border sm:border-emerald-900/15 dark:sm:border-emerald-500/20 bg-white dark:bg-slate-900 overflow-hidden flex flex-col justify-between px-6 pt-8 pb-7"
      >
        {/* Botanical Leaf & Wave Background Accents */}
        <div className="pointer-events-none select-none" aria-hidden="true">
          <svg
            viewBox="0 0 180 140"
            className="absolute -bottom-3 -left-4 w-36 h-28 opacity-85"
            fill="none"
          >
            <path d="M12 132C18 88 54 62 96 68C76 98 48 122 12 132Z" fill="#b7f07c" />
            <path d="M4 134C22 104 42 88 70 86C58 112 32 128 4 134Z" fill="#7ee242" />
            <path d="M52 138C64 114 88 104 118 108C100 128 76 138 52 138Z" fill="#d5f9aa" />
          </svg>
          <svg
            viewBox="0 0 220 140"
            className="absolute -bottom-2 -right-3 w-48 h-32 opacity-90"
            fill="none"
          >
            <path d="M20 140C65 92 140 50 220 18V140H20Z" fill="#9ced5e" />
            <path d="M72 140C115 104 170 72 220 48V140H72Z" fill="#4fd22b" />
          </svg>
        </div>

        {/* Top Bar for Sub-Views */}
        {mode !== 'OWNER_LOGIN' && (
          <div className="relative z-10 flex items-center justify-between mb-1">
            <button
              type="button"
              onClick={() => switchMode('OWNER_LOGIN')}
              data-testid="back-to-login-btn"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#11641c] dark:text-emerald-300 hover:text-[#0d4d18] dark:hover:text-emerald-200 min-h-[44px] pr-3 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Login</span>
            </button>
          </div>
        )}

        {/* Top Brand Lockup */}
        <div className="relative z-10 flex flex-col items-center text-center pt-1">
          <div className={isCompactBrand ? 'mb-1' : 'mb-2'} aria-hidden="true">
            <svg
              viewBox="0 0 96 76"
              className={isCompactBrand ? 'w-14 h-11' : 'w-20 h-16'}
              fill="none"
            >
              <path d="M52 24C52 13 62 5 73 4C72 15 64 23 52 24Z" fill="#0b7a1c" />
              <path d="M50 24C48 15 39 9 29 10C32 19 40 24 50 24Z" fill="#1fb422" />
              <path
                d="M14 18H25L32 50H72L79 25H29"
                stroke="#0b7a1c"
                strokeWidth="5.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M36 33H74M38 42H71M45 25V50M59 25V50"
                stroke="#1fb422"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              <circle cx="37" cy="61" r="5" fill="#0b7a1c" />
              <circle cx="67" cy="61" r="5" fill="#0b7a1c" />
            </svg>
          </div>

          <div className="flex flex-col items-center leading-none">
            <span
              className={`${
                isCompactBrand ? 'text-2xl' : 'text-[32px]'
              } font-extrabold tracking-tight text-[#0d4d18] dark:text-emerald-200`}
            >
              {firstWord}
            </span>
            <span
              className={`${
                isCompactBrand ? 'text-xl' : 'text-[28px]'
              } font-extrabold tracking-tight text-[#1da21b] dark:text-emerald-400 -mt-0.5`}
            >
              {restWords}
            </span>
            {!isCompactBrand && (
              <svg viewBox="0 0 180 14" className="w-40 h-3 mt-1" fill="none" aria-hidden="true">
                <path
                  d="M8 10C58 2 122 2 172 9"
                  stroke="#1da21b"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>

          <h1
            className={`${
              isCompactBrand ? 'text-xl mt-3' : 'text-2xl mt-5'
            } font-extrabold text-[#0d4d18] dark:text-white tracking-tight`}
          >
            {headingCopy[mode].title}
          </h1>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mt-1 max-w-[300px]">
            {headingCopy[mode].subtitle}
          </p>
        </div>

        {/* Center Interactive Area */}
        <div className="relative z-10 w-full my-5">
          {/* Shared Auth Notice (Owner Login only) */}
          {mode === 'OWNER_LOGIN' && authNotice && !errorMsg && cooldownSec <= 0 && (
            <div
              role={authNotice.type === 'logged_out' ? 'status' : 'alert'}
              data-testid="auth-notice-banner"
              className={`mb-3.5 flex items-start gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold ${
                authNotice.type === 'expired'
                  ? 'bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                  : authNotice.type === 'logged_out'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
              }`}
            >
              {authNotice.type === 'expired' ? (
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
              ) : authNotice.type === 'logged_out' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{authNotice.message}</span>
            </div>
          )}

          {/* Post-Reset Confirmation Banner (persists cleanly after dismissing Forgot Password modal) */}
          {mode === 'OWNER_LOGIN' && resetSentBanner && !errorMsg && (
            <div
              role="status"
              aria-live="polite"
              data-testid="login-reset-confirmation-banner"
              className="mb-3.5 flex items-start justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{resetSentBanner}</span>
              </div>
              <button
                type="button"
                aria-label="Dismiss password reset notice"
                onClick={() => setResetSentBanner(null)}
                className="text-emerald-700 dark:text-emerald-300 hover:opacity-80 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Shared Error / Cooldown Banner */}
          {(errorMsg || (mode === 'OWNER_LOGIN' && cooldownSec > 0)) && (
            <div
              role="alert"
              data-testid="login-error-banner"
              className={`mb-3.5 flex items-start gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold ${
                mode === 'OWNER_LOGIN' && cooldownSec > 0
                  ? 'bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                  : 'bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
              }`}
            >
              {mode === 'OWNER_LOGIN' && cooldownSec > 0 ? (
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>
                {mode === 'OWNER_LOGIN' && cooldownSec > 0
                  ? `Too many incorrect attempts. Please wait ${cooldownSec}s, or use Forgot password below.`
                  : errorMsg}
              </span>
            </div>
          )}

          {/* ===================== 1. OWNER LOGIN ===================== */}
          {mode === 'OWNER_LOGIN' && (
            <form onSubmit={handleLoginSubmit} className="space-y-3">
              {/* Mobile Number Field */}
              <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-4 min-h-[52px] transition-all">
                <User
                  className="w-5 h-5 text-[#115e22] dark:text-emerald-400 shrink-0"
                  aria-hidden="true"
                />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="Enter Mobile Number"
                  placeholder="Enter Mobile Number"
                  value={mobile}
                  onChange={(e) => {
                    setMobile(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-3"
                />
              </div>

              {/* PIN Field with Visibility Toggle */}
              <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl pl-4 pr-2 min-h-[52px] transition-all">
                <Lock
                  className="w-5 h-5 text-[#115e22] dark:text-emerald-400 shrink-0"
                  aria-hidden="true"
                />
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={4}
                  aria-label="Enter PIN"
                  placeholder="Enter PIN"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                    if (errorMsg) setErrorMsg(null);
                  }}
                  className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-3 tracking-wider"
                />
                <button
                  type="button"
                  data-testid="login-password-visibility-toggle"
                  onClick={() => setShowPin((v) => !v)}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  aria-pressed={showPin}
                  className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
                >
                  {showPin ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>

              {/* Forgot Password Link (always accessible; elevated banner after wrong PIN) */}
              {showForgotOption ? (
                <div className="rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-emerald-950 dark:text-emerald-100">
                      <KeyRound className="w-4 h-4 text-[#0d7f1f] dark:text-emerald-400 shrink-0" />
                      <span className="font-semibold">Forgot your password?</span>
                    </div>
                    <button
                      type="button"
                      data-testid="forgot-password-btn"
                      onClick={openForgotOverlay}
                      className="text-xs font-bold text-[#0d7f1f] dark:text-emerald-300 underline underline-offset-2 hover:text-[#085c15] dark:hover:text-emerald-200 min-h-[36px] px-2 cursor-pointer shrink-0"
                    >
                      Send Reset Email
                    </button>
                  </div>
                  <button
                    type="button"
                    data-testid="offline-pin-recovery-btn"
                    onClick={() => switchMode('FORGOT_PASSWORD')}
                    className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0d4d18] dark:hover:text-emerald-300 underline underline-offset-2 cursor-pointer"
                  >
                    Or login another way (offline store details / Google)
                  </button>
                </div>
              ) : (
                <div className="flex justify-end px-1 -mt-1">
                  <button
                    type="button"
                    data-testid="forgot-password-btn"
                    onClick={openForgotOverlay}
                    className="text-xs font-semibold text-[#11641c] dark:text-emerald-400 hover:text-[#0b4914] dark:hover:text-emerald-300 hover:underline min-h-[44px] px-1 cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {/* Primary Login Button */}
              <button
                type="submit"
                disabled={isSubmitting || cooldownSec > 0}
                className="w-full min-h-[48px] py-3 px-6 rounded-full bg-[#0d7f1f] hover:bg-[#086917] active:bg-[#065412] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-base shadow-md shadow-emerald-900/15 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
              >
                {isSubmitting ? 'Verifying...' : 'Login'}
              </button>

              {/* Register / Create an Account link */}
              <div className="flex items-center justify-center pt-0.5">
                <button
                  type="button"
                  data-testid="create-account-btn"
                  onClick={() => switchMode('CREATE_ACCOUNT')}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#11641c] dark:text-emerald-300 hover:text-[#0b4914] dark:hover:text-emerald-200 min-h-[40px] px-3 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Register / Create an Account</span>
                </button>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 py-0.5" aria-hidden="true">
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  or continue as
                </span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>

              {/* Continue as Customer / Continue as Supplier */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={isSubmitting}
                  data-testid="continue-customer-btn"
                  onClick={() => switchMode('CUSTOMER_LOGIN')}
                  className="w-full min-h-[48px] py-2.5 px-3 rounded-full bg-[#effaed] hover:bg-[#e1f5dd] active:bg-[#d2f0cc] disabled:opacity-60 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 border border-[#2f8b39] dark:border-emerald-700 text-[#11641c] dark:text-emerald-300 font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                >
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Customer</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  data-testid="continue-supplier-btn"
                  onClick={() => switchMode('SUPPLIER_LOGIN')}
                  className="w-full min-h-[48px] py-2.5 px-3 rounded-full bg-[#effaed] hover:bg-[#e1f5dd] active:bg-[#d2f0cc] disabled:opacity-60 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 border border-[#2f8b39] dark:border-emerald-700 text-[#11641c] dark:text-emerald-300 font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                >
                  <Truck className="w-4 h-4 shrink-0" />
                  <span>Supplier</span>
                </button>
              </div>
            </form>
          )}

          {/* ===================== 2. OFFLINE / GOOGLE PIN RECOVERY ===================== */}
          {mode === 'FORGOT_PASSWORD' && (
            <form onSubmit={handleRecoverySubmit} className="space-y-3">
              <div
                role="tablist"
                aria-label="Alternate login method"
                className="grid grid-cols-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={recoveryMethod === 'STORE_DETAILS'}
                  onClick={() => {
                    setRecoveryMethod('STORE_DETAILS');
                    setErrorMsg(null);
                  }}
                  className={`min-h-[40px] rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    recoveryMethod === 'STORE_DETAILS'
                      ? 'bg-white dark:bg-slate-900 text-[#0d4d18] dark:text-emerald-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Store Details
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={recoveryMethod === 'GOOGLE'}
                  onClick={() => {
                    setRecoveryMethod('GOOGLE');
                    setErrorMsg(null);
                  }}
                  className={`min-h-[40px] rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    recoveryMethod === 'GOOGLE'
                      ? 'bg-white dark:bg-slate-900 text-[#0d4d18] dark:text-emerald-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Google Account
                </button>
              </div>

              {recoveryMethod === 'STORE_DETAILS' ? (
                <>
                  <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-4 min-h-[48px]">
                    <Phone className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                    <input
                      type="tel"
                      inputMode="tel"
                      aria-label="Registered Mobile Number"
                      placeholder="Registered Mobile Number"
                      value={recoveryMobile}
                      onChange={(e) => {
                        setRecoveryMobile(e.target.value);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
                    />
                  </div>

                  <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-4 min-h-[48px]">
                    <User className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                    <input
                      type="text"
                      aria-label="Registered Owner Name"
                      placeholder="Registered Owner Name"
                      value={recoveryOwnerName}
                      onChange={(e) => {
                        setRecoveryOwnerName(e.target.value);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
                    />
                  </div>

                  <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-4 min-h-[48px]">
                    <Store className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                    <input
                      type="text"
                      aria-label="Registered Store Name"
                      placeholder="Registered Store Name"
                      value={recoveryStoreName}
                      onChange={(e) => {
                        setRecoveryStoreName(e.target.value);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-[#0d7f1f] dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Sign in with your Google account to verify ownership, set a fresh 4-digit store
                    PIN, and unlock your dashboard immediately.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex items-center gap-2 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-3.5 min-h-[48px]">
                  <Lock className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                  <input
                    type={showRecoveryPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={4}
                    aria-label="New 4-Digit PIN"
                    placeholder="New PIN"
                    value={recoveryNewPin}
                    onChange={(e) => {
                      setRecoveryNewPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                      if (errorMsg) setErrorMsg(null);
                    }}
                    className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5 tracking-wider"
                  />
                </div>
                <div className="flex items-center gap-2 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl pl-3.5 pr-1.5 min-h-[48px]">
                  <input
                    type={showRecoveryPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={4}
                    aria-label="Confirm New PIN"
                    placeholder="Confirm PIN"
                    value={recoveryConfirmPin}
                    onChange={(e) => {
                      setRecoveryConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                      if (errorMsg) setErrorMsg(null);
                    }}
                    className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5 tracking-wider"
                  />
                  <button
                    type="button"
                    data-testid="recovery-pin-visibility-toggle"
                    onClick={() => setShowRecoveryPin((v) => !v)}
                    aria-label={showRecoveryPin ? 'Hide new PIN' : 'Show new PIN'}
                    aria-pressed={showRecoveryPin}
                    className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 cursor-pointer shrink-0"
                  >
                    {showRecoveryPin ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                data-testid="recovery-submit-btn"
                className="w-full min-h-[48px] py-3 px-6 rounded-full bg-[#0d7f1f] hover:bg-[#086917] active:bg-[#065412] disabled:opacity-60 text-white font-bold text-sm sm:text-base shadow-md shadow-emerald-900/15 transition-colors cursor-pointer"
              >
                {isSubmitting
                  ? 'Verifying...'
                  : recoveryMethod === 'STORE_DETAILS'
                    ? 'Verify & Reset PIN'
                    : 'Verify with Google & Login'}
              </button>
            </form>
          )}

          {/* ===================== 3 & 4. CUSTOMER / SUPPLIER LOGIN ===================== */}
          {(mode === 'CUSTOMER_LOGIN' || mode === 'SUPPLIER_LOGIN') && (
            <form onSubmit={handlePortalSubmit} className="space-y-3.5">
              <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-4 min-h-[52px]">
                {mode === 'CUSTOMER_LOGIN' ? (
                  <User className="w-5 h-5 text-[#115e22] dark:text-emerald-400 shrink-0" />
                ) : (
                  <Truck className="w-5 h-5 text-[#115e22] dark:text-emerald-400 shrink-0" />
                )}
                <input
                  type="text"
                  autoComplete="name"
                  aria-label={
                    mode === 'CUSTOMER_LOGIN' ? 'Customer Full Name' : 'Supplier or Contact Name'
                  }
                  placeholder={
                    mode === 'CUSTOMER_LOGIN'
                      ? 'Enter Registered Full Name'
                      : 'Enter Supplier or Contact Name'
                  }
                  value={portalName}
                  onChange={(e) => {
                    setPortalName(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-3"
                />
              </div>

              <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-4 min-h-[52px]">
                <Phone className="w-5 h-5 text-[#115e22] dark:text-emerald-400 shrink-0" />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="Registered Mobile Number"
                  placeholder="Enter Registered Mobile Number"
                  value={portalPhone}
                  onChange={(e) => {
                    setPortalPhone(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-3"
                />
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 px-1 leading-relaxed">
                {mode === 'CUSTOMER_LOGIN'
                  ? 'We verify your name and phone number against our customer database to open your personal transaction history.'
                  : 'We verify your firm or contact name and phone number against our supplier database to open your supply ledger.'}
              </p>

              <button
                type="submit"
                disabled={isSubmitting}
                data-testid={
                  mode === 'CUSTOMER_LOGIN' ? 'customer-login-submit-btn' : 'supplier-login-submit-btn'
                }
                className="w-full min-h-[48px] py-3 px-6 rounded-full bg-[#0d7f1f] hover:bg-[#086917] active:bg-[#065412] disabled:opacity-60 text-white font-bold text-base shadow-md shadow-emerald-900/15 transition-colors cursor-pointer"
              >
                {isSubmitting ? 'Checking Database...' : 'View My Transactions'}
              </button>
            </form>
          )}
        </div>

        {/* Bottom Tagline */}
        <div className="relative z-10 flex flex-col items-center text-center pb-1">
          <p className="text-base font-semibold italic text-[#134e1c] dark:text-emerald-200 leading-tight">
            Your Business
          </p>
          <p className="text-lg font-extrabold italic text-[#0d4d18] dark:text-emerald-300 leading-tight">
            Our Priority
          </p>
          <svg viewBox="0 0 120 10" className="w-28 h-2.5 mt-1" fill="none" aria-hidden="true">
            <path
              d="M6 7C42 2 78 2 114 6"
              stroke="#1da21b"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </section>

      {/* ===================== FORGOT PASSWORD EMAIL OVERLAY (Firebase sendPasswordResetEmail) ===================== */}
      {isForgotOverlayOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-overlay-title"
          data-testid="forgot-password-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsForgotOverlayOpen(false);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-[#0d7f1f] dark:text-emerald-400 shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="forgot-overlay-title"
                    className="text-base font-extrabold text-slate-900 dark:text-white"
                  >
                    Forgot Password
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Send a password reset link to your email
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close forgot password dialog"
                onClick={() => setIsForgotOverlayOpen(false)}
                className="min-w-[44px] min-h-[44px] -mr-2 -mt-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Enter your registered email address or 10-digit mobile number to receive a password
              reset email.
            </p>

            {resetError && (
              <div
                role="alert"
                data-testid="forgot-overlay-error"
                className="flex items-start gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p>{resetError}</p>
                  {resetProviderDisabled && (
                    <p className="text-[11px] font-normal">
                      Enable Email/Password in Firebase Console → Authentication → Sign-in method.
                    </p>
                  )}
                </div>
              </div>
            )}

            {resetSuccessMsg && (
              <div
                role="status"
                data-testid="forgot-overlay-success"
                className="flex items-start gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{resetSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handlePasswordResetSubmit} className="space-y-3">
              <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-4 min-h-[48px]">
                <Mail className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  aria-label="Registered Mobile Number or Email"
                  placeholder="Registered Mobile Number or Email"
                  value={resetIdentifier}
                  onChange={(e) => {
                    setResetIdentifier(e.target.value);
                    if (resetError) setResetError(null);
                  }}
                  className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
                />
              </div>

              <button
                type="submit"
                disabled={resetSubmitting}
                data-testid="send-reset-email-btn"
                className="w-full min-h-[46px] py-2.5 px-5 rounded-full bg-[#0d7f1f] hover:bg-[#086917] active:bg-[#065412] disabled:opacity-60 text-white font-bold text-sm shadow-md shadow-emerald-900/15 transition-colors cursor-pointer"
              >
                {resetSubmitting ? 'Sending Reset Link...' : 'Send Password Reset Email'}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                data-testid="switch-offline-pin-reset-btn"
                onClick={() => {
                  setIsForgotOverlayOpen(false);
                  switchMode('FORGOT_PASSWORD');
                }}
                className="text-xs font-semibold text-[#11641c] dark:text-emerald-400 hover:underline min-h-[44px] cursor-pointer"
              >
                Reset 4-digit PIN offline instead
              </button>
              <button
                type="button"
                onClick={() => setIsForgotOverlayOpen(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 min-h-[44px] px-2 cursor-pointer"
              >
                {resetSuccessMsg ? 'Done' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
