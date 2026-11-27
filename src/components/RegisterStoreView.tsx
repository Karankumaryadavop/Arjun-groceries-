import React, { useState } from 'react';
import {
  ArrowLeft,
  Store,
  User,
  Phone,
  Mail,
  Lock,
  Eye,
  EyeOff,
  MapPin,
  Wallet,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { BRAND_NAME } from './BrandLogo';
import {
  STORE_WORKSPACE_LIMITS,
  evaluatePasswordStrength,
  type PasswordStrengthLevel,
} from '../utils/firebaseAuthFlows';

interface RegisterStoreViewProps {
  onBack: () => void;
  onSuccess?: () => void;
}

export const RegisterStoreView: React.FC<RegisterStoreViewProps> = ({
  onBack,
  onSuccess,
}) => {
  const { profile, signUpWithEmailPassword, signInWithGoogle, clearAuthNotice } = useStore();

  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Optional store profile details
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [upiId, setUpiId] = useState('');
  const [gstin, setGstin] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [providerDisabled, setProviderDisabled] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const passwordStrength = evaluatePasswordStrength(password);
  const showConfirmMatchHint = confirmPassword.length > 0;
  const passwordsMatch = showConfirmMatchHint && password === confirmPassword;

  const strengthBarColor: Record<PasswordStrengthLevel, string> = {
    empty: 'bg-slate-200 dark:bg-slate-700',
    weak: 'bg-red-500 dark:bg-red-400',
    fair: 'bg-amber-500 dark:bg-amber-400',
    good: 'bg-lime-500 dark:bg-lime-400',
    strong: 'bg-[#0d7f1f] dark:bg-emerald-400',
  };

  const strengthTextColor: Record<PasswordStrengthLevel, string> = {
    empty: 'text-slate-500 dark:text-slate-400',
    weak: 'text-red-600 dark:text-red-400',
    fair: 'text-amber-700 dark:text-amber-300',
    good: 'text-lime-700 dark:text-lime-300',
    strong: 'text-[#0d7f1f] dark:text-emerald-300',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    setProviderDisabled(false);
    setSuccessNotice(null);
    clearAuthNotice();

    try {
      const res = await signUpWithEmailPassword({
        storeName,
        ownerName,
        email,
        password,
        confirmPassword,
        mobile,
        address,
        upiId,
        gstin,
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Could not complete sign-up. Please check your details.');
        setProviderDisabled(Boolean(res.providerDisabled));
        return;
      }

      if (res.notice) {
        setSuccessNotice(res.notice);
      }
      onSuccess?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setIsGoogleSubmitting(true);
    setErrorMsg(null);
    setProviderDisabled(false);
    setSuccessNotice(null);
    clearAuthNotice();

    try {
      const res = await signInWithGoogle({
        storeName: storeName.trim() || undefined,
        ownerName: ownerName.trim() || undefined,
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Could not continue with Google. Please try again.');
        setProviderDisabled(Boolean(res.providerDisabled));
        return;
      }
      onSuccess?.();
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const displayName = profile.storeName?.trim() || BRAND_NAME;
  const nameWords = displayName.split(/\s+/).filter(Boolean);
  const firstWord = nameWords[0] || 'Arjun';
  const restWords = nameWords.slice(1).join(' ') || 'Groceries';

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#eff8dd] via-[#e4f3cb] to-[#d4ecc0] dark:from-slate-950 dark:via-emerald-950/90 dark:to-slate-950 flex items-center justify-center sm:p-4 lg:p-6">
      <section
        aria-label="Create Store Account"
        data-login-mode="CREATE_ACCOUNT"
        data-testid="register-store-view"
        className="relative w-full min-h-[100dvh] sm:min-h-[720px] sm:max-w-[460px] sm:rounded-[28px] sm:shadow-2xl sm:border sm:border-emerald-900/15 dark:sm:border-emerald-500/20 bg-white dark:bg-slate-900 overflow-hidden flex flex-col justify-between px-6 pt-6 pb-7"
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

        {/* Top Back Navigation */}
        <div className="relative z-10 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            data-testid="back-to-login-btn"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#11641c] dark:text-emerald-300 hover:text-[#0d4d18] dark:hover:text-emerald-200 min-h-[44px] pr-3 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Sign In</span>
          </button>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            Firebase Auth
          </span>
        </div>

        {/* Compact Brand Header */}
        <div className="relative z-10 flex flex-col items-center text-center pt-1">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 96 76" className="w-10 h-8" fill="none" aria-hidden="true">
              <path d="M52 24C52 13 62 5 73 4C72 15 64 23 52 24Z" fill="#0b7a1c" />
              <path d="M50 24C48 15 39 9 29 10C32 19 40 24 50 24Z" fill="#1fb422" />
              <path
                d="M14 18H25L32 50H72L79 25H29"
                stroke="#0b7a1c"
                strokeWidth="5.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="37" cy="61" r="5" fill="#0b7a1c" />
              <circle cx="67" cy="61" r="5" fill="#0b7a1c" />
            </svg>
            <span className="text-xl font-extrabold tracking-tight text-[#0d4d18] dark:text-emerald-200">
              {firstWord}{' '}
              <span className="text-[#1da21b] dark:text-emerald-400">{restWords}</span>
            </span>
          </div>

          <h1 className="text-xl font-extrabold text-[#0d4d18] dark:text-white tracking-tight mt-2">
            Create Account
          </h1>
          <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 mt-0.5 max-w-[330px]">
            Sign up with Google or email and password to set up your store
          </p>
        </div>

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="relative z-10 w-full space-y-2.5 my-4" noValidate>
          {errorMsg && (
            <div
              role="alert"
              data-testid="register-error-banner"
              className="flex items-start gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p>{errorMsg}</p>
                {providerDisabled && (
                  <p className="text-[11px] font-normal text-red-600 dark:text-red-300">
                    Firebase Console → Authentication → Sign-in method → Enable Email/Password &amp; Google.
                  </p>
                )}
              </div>
            </div>
          )}

          {successNotice && (
            <div
              role="status"
              className="flex items-start gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* Quick Google Sign-Up Option */}
          <button
            type="button"
            disabled={isSubmitting || isGoogleSubmitting}
            data-testid="register-google-btn"
            onClick={handleGoogleSignUp}
            className="w-full min-h-[46px] py-2.5 px-5 rounded-full bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 font-semibold text-sm shadow-xs flex items-center justify-center gap-2.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
              />
            </svg>
            <span>{isGoogleSubmitting ? 'Connecting Google...' : 'Continue with Google'}</span>
          </button>

          <div className="flex items-center gap-3 py-0.5" aria-hidden="true">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              or sign up with email
            </span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          {/* Store & Owner Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="flex items-center gap-2.5 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-3.5 min-h-[46px]">
              <Store className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
              <input
                type="text"
                maxLength={STORE_WORKSPACE_LIMITS.storeNameMax}
                aria-label="Store Name"
                placeholder="Store Name *"
                value={storeName}
                onChange={(e) => {
                  setStoreName(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
              />
            </div>

            <div className="flex items-center gap-2.5 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-3.5 min-h-[46px]">
              <User className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
              <input
                type="text"
                maxLength={STORE_WORKSPACE_LIMITS.ownerNameMax}
                aria-label="Owner Full Name"
                placeholder="Owner Name *"
                value={ownerName}
                onChange={(e) => {
                  setOwnerName(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
              />
            </div>
          </div>

          {/* Email Address */}
          <div className="flex items-center gap-3 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl px-3.5 min-h-[46px]">
            <Mail className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
            <input
              type="email"
              autoComplete="email"
              aria-label="Store Owner Email"
              placeholder="Email Address *"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
            />
          </div>

          {/* Account Password with Visibility Toggle & Real-Time Strength Meter */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl pl-3.5 pr-1.5 min-h-[46px]">
              <Lock className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                aria-label="Account Password"
                aria-describedby="register-password-strength"
                placeholder="Create Password (6+ chars, 8+ recommended) *"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
              />
              <button
                type="button"
                data-testid="register-password-visibility-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0"
              >
                {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            </div>

            {/* Real-Time Password Strength Indicator */}
            <div
              id="register-password-strength"
              data-testid="password-strength-indicator"
              data-strength-level={passwordStrength.level}
              aria-live="polite"
              className="rounded-2xl bg-slate-50/90 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 px-3 py-2.5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Password strength
                </span>
                <span
                  data-testid="password-strength-label"
                  className={`text-[11px] font-extrabold ${strengthTextColor[passwordStrength.level]}`}
                >
                  {passwordStrength.label}
                </span>
              </div>

              <div
                role="progressbar"
                aria-label="Password strength"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={passwordStrength.score}
                aria-valuetext={passwordStrength.label}
                className="grid grid-cols-4 gap-1.5"
              >
                {[1, 2, 3, 4].map((segment) => (
                  <div
                    key={segment}
                    className={`h-1.5 rounded-full transition-colors duration-200 ${
                      passwordStrength.score >= segment
                        ? strengthBarColor[passwordStrength.level]
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                  />
                ))}
              </div>

              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                {passwordStrength.hint}
              </p>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-0.5">
                {[
                  {
                    id: 'length',
                    label: '8+ characters',
                    met: passwordStrength.checks.recommendedLength,
                  },
                  {
                    id: 'digit',
                    label: 'Number (0-9)',
                    met: passwordStrength.checks.hasDigit,
                  },
                  {
                    id: 'symbol',
                    label: 'Symbol (!@#$)',
                    met: passwordStrength.checks.hasSymbol,
                  },
                  {
                    id: 'case',
                    label: 'Upper & lowercase',
                    met:
                      passwordStrength.checks.hasUppercase &&
                      passwordStrength.checks.hasLowercase,
                  },
                ].map((rule) => (
                  <div
                    key={rule.id}
                    data-testid={`pwd-rule-${rule.id}`}
                    data-met={rule.met ? 'true' : 'false'}
                    className={`flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
                      rule.met
                        ? 'text-[#0d7f1f] dark:text-emerald-300'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 border ${
                        rule.met
                          ? 'bg-[#0d7f1f] border-[#0d7f1f] text-white dark:bg-emerald-500 dark:border-emerald-500'
                          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                      }`}
                    >
                      {rule.met && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </span>
                    <span>{rule.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Confirm Password with Independent Visibility Toggle */}
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/20 rounded-2xl pl-3.5 pr-1.5 min-h-[46px]">
                <Lock className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-label="Confirm Account Password"
                  placeholder="Confirm Password *"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2.5"
                />
                <button
                  type="button"
                  data-testid="register-confirm-password-visibility-toggle"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  aria-pressed={showConfirmPassword}
                  className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0"
                >
                  {showConfirmPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              {showConfirmMatchHint && (
                <p
                  data-testid="confirm-password-match-hint"
                  className={`text-[11px] font-semibold px-1.5 ${
                    passwordsMatch
                      ? 'text-[#0d7f1f] dark:text-emerald-300'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {passwordsMatch ? 'Passwords match' : 'Passwords do not match yet'}
                </p>
              )}
            </div>
          </div>

          {/* Collapsible Optional Store Profile Details */}
          <div>
            <button
              type="button"
              onClick={() => setShowOptionalDetails((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#11641c] dark:text-emerald-400 hover:underline min-h-[40px] px-1 cursor-pointer"
            >
              <span>
                {showOptionalDetails
                  ? 'Hide optional store details'
                  : 'Add mobile, address, UPI ID & GSTIN (optional)'}
              </span>
              {showOptionalDetails ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {showOptionalDetails && (
              <div className="space-y-2 mt-1.5">
                <div className="flex items-center gap-2.5 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 rounded-2xl px-3.5 min-h-[44px]">
                  <Phone className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                  <input
                    type="tel"
                    inputMode="tel"
                    maxLength={STORE_WORKSPACE_LIMITS.phoneMax}
                    aria-label="Mobile Number"
                    placeholder="Mobile Number (optional)"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2"
                  />
                </div>
                <div className="flex items-center gap-2.5 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 rounded-2xl px-3.5 min-h-[44px]">
                  <MapPin className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                  <input
                    type="text"
                    maxLength={STORE_WORKSPACE_LIMITS.addressMax}
                    aria-label="Store Address"
                    placeholder="Store Address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 rounded-2xl px-3 min-h-[44px]">
                    <Wallet className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                    <input
                      type="text"
                      maxLength={STORE_WORKSPACE_LIMITS.upiIdMax}
                      aria-label="Store UPI ID"
                      placeholder="UPI ID"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      className="w-full bg-transparent text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2"
                    />
                  </div>
                  <div className="flex items-center gap-2 bg-[#f1f3f5] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 focus-within:border-emerald-600 rounded-2xl px-3 min-h-[44px]">
                    <FileText className="w-4 h-4 text-[#115e22] dark:text-emerald-400 shrink-0" />
                    <input
                      type="text"
                      maxLength={STORE_WORKSPACE_LIMITS.gstinMax}
                      aria-label="Store GSTIN"
                      placeholder="GSTIN"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      className="w-full bg-transparent text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none py-2"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Primary Email/Password Sign-Up CTA */}
          <button
            type="submit"
            disabled={isSubmitting || isGoogleSubmitting}
            data-testid="create-account-submit-btn"
            className="w-full min-h-[48px] py-3 px-6 rounded-full bg-[#0d7f1f] hover:bg-[#086917] active:bg-[#065412] disabled:opacity-60 text-white font-bold text-sm sm:text-base shadow-md shadow-emerald-900/15 transition-colors cursor-pointer"
          >
            {isSubmitting ? 'Creating Account...' : 'Sign Up & Create Account'}
          </button>

          <div className="flex items-center justify-center pt-1">
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-semibold text-[#11641c] dark:text-emerald-300 hover:underline min-h-[36px] px-2 cursor-pointer"
            >
              Already have an account? Sign In
            </button>
          </div>
        </form>

        {/* Bottom Tagline */}
        <div className="relative z-10 flex flex-col items-center text-center pt-1">
          <p className="text-xs font-semibold italic text-[#134e1c] dark:text-emerald-200">
            Your Business · <span className="font-extrabold">Our Priority</span>
          </p>
        </div>
      </section>
    </div>
  );
};
