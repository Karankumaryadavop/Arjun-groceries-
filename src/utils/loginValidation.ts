export function normalizeMobileDigits(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) {
    return digits.slice(-10);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

export function validateLoginCredentialsInput(params: {
  mobile: string;
  pin: string;
  registeredPhone?: string;
}): {
  valid: boolean;
  normalizedMobile?: string;
  normalizedPin?: string;
  error?: string;
} {
  const normalizedMobile = normalizeMobileDigits(params.mobile);
  if (normalizedMobile.length < 10 || normalizedMobile.length > 15) {
    return {
      valid: false,
      error: 'Please enter a valid 10-digit mobile number.',
    };
  }

  const normalizedPin = String(params.pin || '').trim();
  if (!/^\d{4}$/.test(normalizedPin)) {
    return {
      valid: false,
      error: 'Please enter your 4-digit numeric PIN.',
    };
  }

  const normalizedRegistered = normalizeMobileDigits(params.registeredPhone || '');
  if (
    normalizedRegistered.length >= 10 &&
    normalizedMobile.slice(-10) !== normalizedRegistered.slice(-10)
  ) {
    return {
      valid: false,
      error: 'Mobile number does not match the registered store owner phone.',
    };
  }

  return {
    valid: true,
    normalizedMobile,
    normalizedPin,
  };
}
