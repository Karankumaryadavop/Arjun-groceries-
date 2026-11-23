import React, { useEffect, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { KeyRound, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import { BrandLogo, BRAND_NAME, BRAND_TAGLINE } from './BrandLogo';
import { getPinCooldownRemainingSeconds } from '../utils/securityCrypto';

export const PinLockScreen: React.FC = () => {
  const { profile, unlockWithPin, needsPinSetup, completePinSetupRecovery } = useStore();
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [recoveryStep, setRecoveryStep] = useState<'ENTER' | 'CONFIRM'>('ENTER');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cooldownSec, setCooldownSec] = useState<number>(() => getPinCooldownRemainingSeconds());

  useEffect(() => {
    setCooldownSec(getPinCooldownRemainingSeconds());
  }, [needsPinSetup]);

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

  const handleKeyPress = async (num: string) => {
    if (!needsPinSetup && cooldownSec > 0) return;
    if (pin.length >= 4) return;

    const nextPin = pin + num;
    setPin(nextPin);
    setErrorMsg(null);

    if (nextPin.length === 4) {
      if (needsPinSetup) {
        if (recoveryStep === 'ENTER') {
          setFirstPin(nextPin);
          setPin('');
          setRecoveryStep('CONFIRM');
          return;
        }
        if (nextPin !== firstPin) {
          setErrorMsg('PINs did not match. Please enter your new 4-digit PIN again.');
          setRecoveryStep('ENTER');
          setFirstPin('');
          setTimeout(() => setPin(''), 400);
          return;
        }
        const res = await completePinSetupRecovery(nextPin);
        if (!res.success) {
          setErrorMsg(res.error || 'Could not save new security PIN.');
          setRecoveryStep('ENTER');
          setFirstPin('');
          setTimeout(() => setPin(''), 400);
        }
        return;
      }

      const success = await unlockWithPin(nextPin);
      if (!success) {
        const remaining = getPinCooldownRemainingSeconds();
        setCooldownSec(remaining);
        setErrorMsg(
          remaining > 0
            ? `Too many incorrect attempts. Try again in ${remaining}s.`
            : 'Incorrect PIN! Please enter your 4-digit store PIN.'
        );
        setTimeout(() => setPin(''), 450);
      }
    }
  };

  const handleDelete = () => {
    if (!needsPinSetup && cooldownSec > 0) return;
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleClear = () => {
    if (!needsPinSetup && cooldownSec > 0) return;
    setPin('');
    if (needsPinSetup && recoveryStep === 'CONFIRM') {
      setRecoveryStep('ENTER');
      setFirstPin('');
    }
    setErrorMsg(null);
  };

  const keypadDisabled = !needsPinSetup && cooldownSec > 0;

  return (
    <div className="fixed inset-0 z-50 bg-emerald-950 dark:bg-slate-950 flex flex-col items-center justify-center p-4 select-none">
      <div className="max-w-sm w-full bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl flex flex-col items-center border border-emerald-900/20 dark:border-slate-800 text-center">
        {/* Store Logo */}
        <BrandLogo
          sizeClass="w-24 h-24"
          roundedClass="rounded-full"
          className="shadow-lg mb-3 border-2 border-emerald-100"
        />

        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{profile.storeName || BRAND_NAME}</h2>
        <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">{BRAND_TAGLINE}</p>

        {needsPinSetup ? (
          <div className="mt-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200">
            <div className="font-bold flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Set New Store Security PIN</span>
            </div>
            <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 mt-0.5">
              {recoveryStep === 'ENTER'
                ? 'Backups do not transfer PIN hashes for security. Choose a new 4-digit PIN for this phone.'
                : 'Re-enter the same 4-digit PIN to confirm and unlock your shop.'}
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Counter Screen Protected · Enter 4-Digit Security PIN
          </p>
        )}

        {/* PIN Indicators */}
        <div className="flex items-center justify-center gap-3 my-6" aria-label="PIN entry progress">
          {[0, 1, 2, 3].map((idx) => {
            const filled = pin.length > idx;
            return (
              <div
                key={idx}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  errorMsg
                    ? 'border-red-500 bg-red-400 animate-shake'
                    : filled
                    ? 'border-emerald-600 dark:border-emerald-500 bg-emerald-600 dark:bg-emerald-500 scale-110'
                    : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800'
                }`}
              />
            );
          })}
        </div>

        {keypadDisabled && (
          <div
            role="alert"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 mb-3 font-semibold"
          >
            <Clock className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Screen temporarily locked. Wait {cooldownSec}s before next attempt.</span>
          </div>
        )}

        {errorMsg && !keypadDisabled && (
          <div role="alert" className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 mb-3 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={keypadDisabled}
              onClick={() => handleKeyPress(digit)}
              className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 active:bg-emerald-100 dark:active:bg-emerald-900 disabled:opacity-45 disabled:cursor-not-allowed text-slate-800 dark:text-slate-100 hover:text-emerald-900 dark:hover:text-emerald-300 font-bold text-xl flex items-center justify-center border border-slate-200/80 dark:border-slate-700 transition-all active:scale-95 cursor-pointer"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            disabled={keypadDisabled}
            onClick={handleClear}
            className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-45 text-slate-600 dark:text-slate-300 font-medium text-xs flex items-center justify-center border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {needsPinSetup && recoveryStep === 'CONFIRM' ? 'Restart' : 'Clear'}
          </button>
          <button
            type="button"
            disabled={keypadDisabled}
            onClick={() => handleKeyPress('0')}
            className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 active:bg-emerald-100 dark:active:bg-emerald-900 disabled:opacity-45 disabled:cursor-not-allowed text-slate-800 dark:text-slate-100 hover:text-emerald-900 dark:hover:text-emerald-300 font-bold text-xl flex items-center justify-center border border-slate-200/80 dark:border-slate-700 transition-all active:scale-95 cursor-pointer"
          >
            0
          </button>
          <button
            type="button"
            disabled={keypadDisabled}
            onClick={handleDelete}
            className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-45 text-slate-600 dark:text-slate-300 font-medium text-xs flex items-center justify-center border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            Delete
          </button>
        </div>

        <div className="mt-5 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <KeyRound className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>On-device PBKDF2 salted PIN verification</span>
        </div>
      </div>
    </div>
  );
};
