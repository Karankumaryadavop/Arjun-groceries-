/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeMobileDigits } from './loginValidation';

/**
 * Exact StoreWorkspace property limits synchronized verbatim with `firebase-blueprint.json`
 * and `firestore.rules` (`isValidStoreWorkspace`).
 */
export const STORE_WORKSPACE_LIMITS = {
  storeNameMin: 2,
  storeNameMax: 160,
  ownerNameMin: 2,
  ownerNameMax: 120,
  phoneMax: 32,
  addressMax: 300,
  upiIdMax: 120,
  gstinMax: 32,
  passwordMin: 6,
  passwordMax: 128,
} as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailAddress(raw: string): boolean {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned || cleaned.length > 254) return false;
  return EMAIL_REGEX.test(cleaned);
}

export function maskEmailForNotice(email: string): string {
  const cleaned = String(email || '').trim().toLowerCase();
  const atIndex = cleaned.indexOf('@');
  if (atIndex <= 0) return cleaned;
  const local = cleaned.slice(0, atIndex);
  const domain = cleaned.slice(atIndex + 1);
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

export type PasswordStrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordComplexityChecks {
  minLength: boolean;
  recommendedLength: boolean;
  hasDigit: boolean;
  hasSymbol: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
}

export interface PasswordStrengthEvaluation {
  score: 0 | 1 | 2 | 3 | 4;
  level: PasswordStrengthLevel;
  label: string;
  hint: string;
  checks: PasswordComplexityChecks;
}

/**
 * Evaluates password complexity in real time for the registration form.
 * Checks minimum/recommended length, digits, symbols, and letter case.
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthEvaluation {
  const pwd = String(password || '');
  const checks: PasswordComplexityChecks = {
    minLength: pwd.length >= STORE_WORKSPACE_LIMITS.passwordMin,
    recommendedLength: pwd.length >= 8,
    hasDigit: /\d/.test(pwd),
    hasSymbol: /[^A-Za-z0-9\s]/.test(pwd),
    hasUppercase: /[A-Z]/.test(pwd),
    hasLowercase: /[a-z]/.test(pwd),
  };

  if (!pwd) {
    return {
      score: 0,
      level: 'empty',
      label: 'Enter a password',
      hint: 'Use 8+ characters with a number, symbol, and uppercase letter.',
      checks,
    };
  }

  // Below Firebase's 6-character minimum is always Weak (score 1)
  if (!checks.minLength) {
    return {
      score: 1,
      level: 'weak',
      label: 'Weak',
      hint: `Add at least ${STORE_WORKSPACE_LIMITS.passwordMin - pwd.length} more character${
        STORE_WORKSPACE_LIMITS.passwordMin - pwd.length === 1 ? '' : 's'
      } (8+ recommended).`,
      checks,
    };
  }

  let complexityPoints = 0;
  if (checks.recommendedLength) complexityPoints += 1;
  if (checks.hasDigit) complexityPoints += 1;
  if (checks.hasSymbol) complexityPoints += 1;
  if (checks.hasUppercase && checks.hasLowercase) complexityPoints += 1;

  // Penalize overly repetitive passwords like "11111111" or "aaaaaaaa"
  const uniqueChars = new Set(pwd).size;
  if (uniqueChars <= 2) {
    return {
      score: 1,
      level: 'weak',
      label: 'Weak',
      hint: 'Avoid repeating the same characters. Mix letters, numbers, and symbols.',
      checks,
    };
  }

  if (complexityPoints <= 1) {
    return {
      score: 1,
      level: 'weak',
      label: 'Weak',
      hint: !checks.recommendedLength
        ? 'Make it 8+ characters and add a number or symbol.'
        : 'Add numbers and symbols (like @, #, !) to strengthen your password.',
      checks,
    };
  }

  if (complexityPoints === 2) {
    const missing: string[] = [];
    if (!checks.recommendedLength) missing.push('8+ chars');
    if (!checks.hasDigit) missing.push('a number');
    if (!checks.hasSymbol) missing.push('a symbol');
    if (!(checks.hasUppercase && checks.hasLowercase)) missing.push('uppercase & lowercase');
    return {
      score: 2,
      level: 'fair',
      label: 'Fair',
      hint: `Add ${missing.slice(0, 2).join(' and ')} for stronger security.`,
      checks,
    };
  }

  if (complexityPoints === 3) {
    const missing = !checks.recommendedLength
      ? '8+ characters'
      : !checks.hasSymbol
        ? 'a symbol (e.g. @, #, !)'
        : !checks.hasDigit
          ? 'a number (0-9)'
          : 'an uppercase letter';
    return {
      score: 3,
      level: 'good',
      label: 'Good',
      hint: `Almost there — add ${missing} for a Strong password.`,
      checks,
    };
  }

  return {
    score: 4,
    level: 'strong',
    label: 'Strong',
    hint: 'Great password! Meets length, digit, symbol, and mixed-case checks.',
    checks,
  };
}

export type StoreRegistrationAuthMethod = 'EMAIL_PASSWORD' | 'GOOGLE';

export interface StoreRegistrationInput {
  authMethod: StoreRegistrationAuthMethod;
  storeName: string;
  ownerName: string;
  mobile: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  pin: string;
  confirmPin: string;
  address?: string;
  upiId?: string;
  gstin?: string;
}

export interface ValidatedStoreRegistration {
  valid: boolean;
  error?: string;
  data?: {
    authMethod: StoreRegistrationAuthMethod;
    storeName: string;
    ownerName: string;
    normalizedMobile: string;
    email?: string;
    password?: string;
    normalizedPin: string;
    address: string;
    upiId: string;
    gstin: string;
  };
}

export function validateStoreRegistrationInput(
  input: StoreRegistrationInput
): ValidatedStoreRegistration {
  const storeName = String(input.storeName || '').trim();
  const ownerName = String(input.ownerName || '').trim();
  const normalizedMobile = normalizeMobileDigits(input.mobile || '');
  const address = String(input.address || '').trim();
  const upiId = String(input.upiId || '').trim();
  const gstin = String(input.gstin || '').trim().toUpperCase();
  const normalizedPin = String(input.pin || '').trim();
  const normalizedConfirmPin = String(input.confirmPin || '').trim();

  if (storeName.length < STORE_WORKSPACE_LIMITS.storeNameMin) {
    return {
      valid: false,
      error: 'Please enter your store or shop name (at least 2 characters).',
    };
  }
  if (storeName.length > STORE_WORKSPACE_LIMITS.storeNameMax) {
    return {
      valid: false,
      error: `Store name must be ${STORE_WORKSPACE_LIMITS.storeNameMax} characters or fewer.`,
    };
  }

  if (ownerName.length < STORE_WORKSPACE_LIMITS.ownerNameMin) {
    return {
      valid: false,
      error: 'Please enter the owner full name (at least 2 characters).',
    };
  }
  if (ownerName.length > STORE_WORKSPACE_LIMITS.ownerNameMax) {
    return {
      valid: false,
      error: `Owner name must be ${STORE_WORKSPACE_LIMITS.ownerNameMax} characters or fewer.`,
    };
  }

  if (normalizedMobile.length < 10 || normalizedMobile.length > 15) {
    return {
      valid: false,
      error: 'Please enter a valid 10-digit mobile number.',
    };
  }

  if (address.length > STORE_WORKSPACE_LIMITS.addressMax) {
    return {
      valid: false,
      error: `Store address must be ${STORE_WORKSPACE_LIMITS.addressMax} characters or fewer.`,
    };
  }
  if (upiId.length > STORE_WORKSPACE_LIMITS.upiIdMax) {
    return {
      valid: false,
      error: `UPI ID must be ${STORE_WORKSPACE_LIMITS.upiIdMax} characters or fewer.`,
    };
  }
  if (gstin.length > STORE_WORKSPACE_LIMITS.gstinMax) {
    return {
      valid: false,
      error: `GSTIN must be ${STORE_WORKSPACE_LIMITS.gstinMax} characters or fewer.`,
    };
  }

  if (!/^\d{4}$/.test(normalizedPin)) {
    return {
      valid: false,
      error: 'Please choose a 4-digit numeric counter PIN.',
    };
  }
  if (normalizedPin !== normalizedConfirmPin) {
    return {
      valid: false,
      error: 'Counter PIN and Confirm PIN do not match.',
    };
  }

  let normalizedEmail: string | undefined;
  let validatedPassword: string | undefined;

  if (input.authMethod === 'EMAIL_PASSWORD') {
    const emailRaw = String(input.email || '').trim().toLowerCase();
    if (!isValidEmailAddress(emailRaw)) {
      return {
        valid: false,
        error: 'Please enter a valid email address for Firebase account sign-up and password reset.',
      };
    }
    const pwd = String(input.password || '');
    const confirmPwd = String(input.confirmPassword || '');
    if (pwd.length < STORE_WORKSPACE_LIMITS.passwordMin) {
      return {
        valid: false,
        error: `Account password must be at least ${STORE_WORKSPACE_LIMITS.passwordMin} characters.`,
      };
    }
    if (pwd.length > STORE_WORKSPACE_LIMITS.passwordMax) {
      return {
        valid: false,
        error: `Account password must be ${STORE_WORKSPACE_LIMITS.passwordMax} characters or fewer.`,
      };
    }
    if (confirmPwd && pwd !== confirmPwd) {
      return {
        valid: false,
        error: 'Password and Confirm Password do not match.',
      };
    }
    normalizedEmail = emailRaw;
    validatedPassword = pwd;
  }

  return {
    valid: true,
    data: {
      authMethod: input.authMethod,
      storeName,
      ownerName,
      normalizedMobile,
      email: normalizedEmail,
      password: validatedPassword,
      normalizedPin,
      address,
      upiId,
      gstin,
    },
  };
}

export interface PasswordResetIdentifierResult {
  valid: boolean;
  email?: string;
  resolvedFromMobile?: boolean;
  needsEmailInput?: boolean;
  error?: string;
}

/**
 * Resolves a user's Forgot Password input — accepts either a direct email address
 * or a registered 10-digit mobile number mapped to this device's bound owner email.
 */
export function resolvePasswordResetIdentifier(params: {
  input: string;
  registeredProfilePhone?: string;
  boundOwnerEmail?: string | null;
  signedInEmail?: string | null;
}): PasswordResetIdentifierResult {
  const raw = String(params.input || '').trim();
  if (!raw) {
    return {
      valid: false,
      error: 'Please enter your registered email address or 10-digit mobile number.',
    };
  }

  if (raw.includes('@')) {
    const normalizedEmail = raw.toLowerCase();
    if (!isValidEmailAddress(normalizedEmail)) {
      return {
        valid: false,
        error: 'Please enter a valid email address (for example, owner@example.com).',
      };
    }
    return {
      valid: true,
      email: normalizedEmail,
      resolvedFromMobile: false,
    };
  }

  const digits = normalizeMobileDigits(raw);
  if (digits.length < 10 || digits.length > 15) {
    return {
      valid: false,
      error: 'Enter a valid email address or 10-digit registered mobile number.',
    };
  }

  const storedPhone = normalizeMobileDigits(params.registeredProfilePhone || '');
  const candidateEmail = (params.boundOwnerEmail || params.signedInEmail || '').trim().toLowerCase();

  if (
    storedPhone.length >= 10 &&
    storedPhone.slice(-10) === digits.slice(-10) &&
    isValidEmailAddress(candidateEmail)
  ) {
    return {
      valid: true,
      email: candidateEmail,
      resolvedFromMobile: true,
    };
  }

  return {
    valid: false,
    needsEmailInput: true,
    error:
      'No email address is linked to this mobile number on this device yet. Please enter your registered email address to receive the reset link, or reset your 4-digit PIN offline below.',
  };
}

export interface EmailPasswordSignInInput {
  email: string;
  password: string;
}

export interface ValidatedEmailPasswordSignIn {
  valid: boolean;
  error?: string;
  data?: {
    email: string;
    password: string;
  };
}

export function validateEmailPasswordSignInInput(
  input: EmailPasswordSignInInput
): ValidatedEmailPasswordSignIn {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');

  if (!email) {
    return { valid: false, error: 'Please enter your email address.' };
  }
  if (!isValidEmailAddress(email)) {
    return { valid: false, error: 'Please enter a valid email address (for example, owner@example.com).' };
  }
  if (!password) {
    return { valid: false, error: 'Please enter your password.' };
  }
  if (password.length < STORE_WORKSPACE_LIMITS.passwordMin) {
    return {
      valid: false,
      error: `Password must be at least ${STORE_WORKSPACE_LIMITS.passwordMin} characters.`,
    };
  }
  return { valid: true, data: { email, password } };
}

export interface EmailPasswordSignUpInput {
  storeName: string;
  ownerName: string;
  email: string;
  password: string;
  confirmPassword: string;
  mobile?: string;
  address?: string;
  upiId?: string;
  gstin?: string;
}

export interface ValidatedEmailPasswordSignUp {
  valid: boolean;
  error?: string;
  data?: {
    storeName: string;
    ownerName: string;
    email: string;
    password: string;
    normalizedMobile?: string;
    address: string;
    upiId: string;
    gstin: string;
  };
}

export function validateEmailPasswordSignUpInput(
  input: EmailPasswordSignUpInput
): ValidatedEmailPasswordSignUp {
  const storeName = String(input.storeName || '').trim();
  const ownerName = String(input.ownerName || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const confirmPassword = String(input.confirmPassword || '');
  const rawMobile = String(input.mobile || '').trim();
  const normalizedMobile = rawMobile ? normalizeMobileDigits(rawMobile) : undefined;
  const address = String(input.address || '').trim();
  const upiId = String(input.upiId || '').trim();
  const gstin = String(input.gstin || '').trim().toUpperCase();

  if (storeName.length < STORE_WORKSPACE_LIMITS.storeNameMin) {
    return { valid: false, error: 'Please enter your store or shop name (at least 2 characters).' };
  }
  if (storeName.length > STORE_WORKSPACE_LIMITS.storeNameMax) {
    return {
      valid: false,
      error: `Store name must be ${STORE_WORKSPACE_LIMITS.storeNameMax} characters or fewer.`,
    };
  }
  if (ownerName.length < STORE_WORKSPACE_LIMITS.ownerNameMin) {
    return { valid: false, error: 'Please enter the owner full name (at least 2 characters).' };
  }
  if (ownerName.length > STORE_WORKSPACE_LIMITS.ownerNameMax) {
    return {
      valid: false,
      error: `Owner name must be ${STORE_WORKSPACE_LIMITS.ownerNameMax} characters or fewer.`,
    };
  }
  if (!isValidEmailAddress(email)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  if (password.length < STORE_WORKSPACE_LIMITS.passwordMin) {
    return {
      valid: false,
      error: `Password must be at least ${STORE_WORKSPACE_LIMITS.passwordMin} characters.`,
    };
  }
  if (password.length > STORE_WORKSPACE_LIMITS.passwordMax) {
    return {
      valid: false,
      error: `Password must be ${STORE_WORKSPACE_LIMITS.passwordMax} characters or fewer.`,
    };
  }
  if (password !== confirmPassword) {
    return { valid: false, error: 'Password and Confirm Password do not match.' };
  }
  if (normalizedMobile && (normalizedMobile.length < 10 || normalizedMobile.length > 15)) {
    return { valid: false, error: 'If provided, mobile number must be a valid 10-digit number.' };
  }
  if (address.length > STORE_WORKSPACE_LIMITS.addressMax) {
    return {
      valid: false,
      error: `Store address must be ${STORE_WORKSPACE_LIMITS.addressMax} characters or fewer.`,
    };
  }
  if (upiId.length > STORE_WORKSPACE_LIMITS.upiIdMax) {
    return {
      valid: false,
      error: `UPI ID must be ${STORE_WORKSPACE_LIMITS.upiIdMax} characters or fewer.`,
    };
  }
  if (gstin.length > STORE_WORKSPACE_LIMITS.gstinMax) {
    return {
      valid: false,
      error: `GSTIN must be ${STORE_WORKSPACE_LIMITS.gstinMax} characters or fewer.`,
    };
  }

  return {
    valid: true,
    data: {
      storeName,
      ownerName,
      email,
      password,
      normalizedMobile,
      address,
      upiId,
      gstin,
    },
  };
}

export interface MappedFirebaseAuthError {
  message: string;
  providerDisabled?: boolean;
}

export function mapFirebaseAuthErrorToMessage(error: unknown): MappedFirebaseAuthError {
  const code = String((error as { code?: string })?.code || '');
  const rawMessage = error instanceof Error ? error.message : String(error || '');

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return {
        message:
          'Invalid email or password. Please check your credentials or use Forgot password to reset.',
      };
    case 'auth/user-disabled':
      return {
        message: 'This account has been disabled. Please contact your store administrator.',
      };
    case 'auth/email-already-in-use':
      return {
        message:
          'An account already exists with this email address. Please sign in or use Forgot password to reset.',
      };
    case 'auth/invalid-email':
      return {
        message: 'That email address does not appear valid. Please double-check and try again.',
      };
    case 'auth/weak-password':
      return {
        message: 'Please choose a stronger password (at least 6 characters).',
      };
    case 'auth/operation-not-allowed':
      return {
        providerDisabled: true,
        message:
          'This sign-in method is not enabled in Firebase Console yet. Enable Email/Password and Google under Authentication → Sign-in method.',
      };
    case 'auth/popup-closed-by-user':
      return {
        message: 'Google sign-in window was closed before completing sign-in. Please try again.',
      };
    case 'auth/cancelled-popup-request':
      return {
        message: 'Another Google sign-in window is already open. Please complete or close it and try again.',
      };
    case 'auth/popup-blocked':
      return {
        message:
          'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.',
      };
    case 'auth/unauthorized-domain':
      return {
        message:
          'This domain is not authorized for Google Sign-In yet. Add this domain under Firebase Console → Authentication → Settings → Authorized domains.',
      };
    case 'auth/account-exists-with-different-credential':
      return {
        message:
          'An account already exists with this email using a different sign-in method. Please sign in with Email & Password.',
      };
    case 'auth/too-many-requests':
      return {
        message: 'Too many requests right now. Please wait a few minutes before trying again.',
      };
    case 'auth/network-request-failed':
      return {
        message:
          'Unable to reach Firebase right now. Please check your internet connection and try again.',
      };
    default:
      if (/operation-not-allowed/i.test(rawMessage)) {
        return {
          providerDisabled: true,
          message:
            'This sign-in method is not enabled in Firebase Console yet. Enable Email/Password and Google under Authentication → Sign-in method.',
        };
      }
      return {
        message: rawMessage || 'Authentication request could not be completed. Please try again.',
      };
  }
}
