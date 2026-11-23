import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMobileDigits,
  validateLoginCredentialsInput,
} from '../utils/loginValidation';

test('normalizeMobileDigits normalizes +91 and leading zero Indian numbers', () => {
  assert.equal(normalizeMobileDigits('+91 98765 43210'), '9876543210');
  assert.equal(normalizeMobileDigits('09876543210'), '9876543210');
  assert.equal(normalizeMobileDigits('98765-43210'), '9876543210');
});

test('validateLoginCredentialsInput rejects empty or short mobile numbers and non-4-digit PINs', () => {
  const shortPhone = validateLoginCredentialsInput({ mobile: '12345', pin: '4589' });
  assert.equal(shortPhone.valid, false);
  assert.match(shortPhone.error || '', /valid 10-digit mobile number/i);

  const badPin = validateLoginCredentialsInput({ mobile: '9876543210', pin: '12' });
  assert.equal(badPin.valid, false);
  assert.match(badPin.error || '', /4-digit numeric PIN/i);
});

test('validateLoginCredentialsInput enforces registered store owner phone when present', () => {
  const mismatch = validateLoginCredentialsInput({
    mobile: '9999999999',
    pin: '4589',
    registeredPhone: '+91 98765 43210',
  });
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.error || '', /does not match/i);

  const matched = validateLoginCredentialsInput({
    mobile: '9876543210',
    pin: '4589',
    registeredPhone: '+91 98765 43210',
  });
  assert.equal(matched.valid, true);
  assert.equal(matched.normalizedMobile, '9876543210');
  assert.equal(matched.normalizedPin, '4589');
});
