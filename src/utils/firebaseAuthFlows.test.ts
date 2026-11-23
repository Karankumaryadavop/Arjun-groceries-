import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEmailAddress,
  maskEmailForNotice,
  evaluatePasswordStrength,
  validateStoreRegistrationInput,
  resolvePasswordResetIdentifier,
  mapFirebaseAuthErrorToMessage,
  STORE_WORKSPACE_LIMITS,
} from './firebaseAuthFlows';

test('isValidEmailAddress and maskEmailForNotice validate and mask emails cleanly', () => {
  assert.equal(isValidEmailAddress('owner@arjungroceries.in'), true);
  assert.equal(isValidEmailAddress('not-an-email'), false);
  assert.equal(maskEmailForNotice('ky626541@gmail.com'), 'ky***@gmail.com');
  assert.equal(maskEmailForNotice('a@b.co'), 'a***@b.co');
});

test('evaluatePasswordStrength scores empty, weak, fair, good, strong, and repetitive passwords accurately', () => {
  const empty = evaluatePasswordStrength('');
  assert.equal(empty.score, 0);
  assert.equal(empty.level, 'empty');
  assert.equal(empty.checks.minLength, false);

  const tooShort = evaluatePasswordStrength('Ab1!');
  assert.equal(tooShort.score, 1);
  assert.equal(tooShort.level, 'weak');
  assert.equal(tooShort.checks.minLength, false);
  assert.equal(tooShort.checks.hasDigit, true);
  assert.equal(tooShort.checks.hasSymbol, true);

  const repetitive = evaluatePasswordStrength('11111111');
  assert.equal(repetitive.score, 1);
  assert.equal(repetitive.level, 'weak');

  const lengthOnly = evaluatePasswordStrength('arjunshop');
  assert.equal(lengthOnly.score, 1);
  assert.equal(lengthOnly.level, 'weak');
  assert.equal(lengthOnly.checks.recommendedLength, true);
  assert.equal(lengthOnly.checks.hasDigit, false);
  assert.equal(lengthOnly.checks.hasSymbol, false);

  const fair = evaluatePasswordStrength('arjun123');
  assert.equal(fair.score, 2);
  assert.equal(fair.level, 'fair');
  assert.equal(fair.checks.recommendedLength, true);
  assert.equal(fair.checks.hasDigit, true);
  assert.equal(fair.checks.hasSymbol, false);

  const good = evaluatePasswordStrength('arjun123!');
  assert.equal(good.score, 3);
  assert.equal(good.level, 'good');
  assert.equal(good.checks.hasSymbol, true);
  assert.equal(good.checks.hasUppercase, false);

  const strong = evaluatePasswordStrength('Arjun@2026!');
  assert.equal(strong.score, 4);
  assert.equal(strong.level, 'strong');
  assert.equal(strong.checks.recommendedLength, true);
  assert.equal(strong.checks.hasDigit, true);
  assert.equal(strong.checks.hasSymbol, true);
  assert.equal(strong.checks.hasUppercase, true);
  assert.equal(strong.checks.hasLowercase, true);
});

test('validateStoreRegistrationInput enforces blueprint limits and password/PIN validation', () => {
  const validEmailSignup = validateStoreRegistrationInput({
    authMethod: 'EMAIL_PASSWORD',
    storeName: 'Arjun Groceries',
    ownerName: 'Arjun Sharma',
    mobile: '+91 98765 43210',
    email: 'ARJUN@EXAMPLE.COM ',
    password: 'StrongPassword123',
    confirmPassword: 'StrongPassword123',
    pin: '2580',
    confirmPin: '2580',
    address: '14 Market Road, Sector 4',
    upiId: 'arjun@okicici',
    gstin: '27aabcs1429b1z5',
  });
  assert.equal(validEmailSignup.valid, true);
  assert.equal(validEmailSignup.data?.normalizedMobile, '9876543210');
  assert.equal(validEmailSignup.data?.email, 'arjun@example.com');
  assert.equal(validEmailSignup.data?.gstin, '27AABCS1429B1Z5');

  const tooLongStore = validateStoreRegistrationInput({
    authMethod: 'GOOGLE',
    storeName: 'S'.repeat(STORE_WORKSPACE_LIMITS.storeNameMax + 1),
    ownerName: 'Arjun Sharma',
    mobile: '9876543210',
    pin: '2580',
    confirmPin: '2580',
  });
  assert.equal(tooLongStore.valid, false);
  assert.match(tooLongStore.error || '', /160/);

  const shortPwd = validateStoreRegistrationInput({
    authMethod: 'EMAIL_PASSWORD',
    storeName: 'Arjun Groceries',
    ownerName: 'Arjun Sharma',
    mobile: '9876543210',
    email: 'owner@example.com',
    password: '123',
    confirmPassword: '123',
    pin: '2580',
    confirmPin: '2580',
  });
  assert.equal(shortPwd.valid, false);
  assert.match(shortPwd.error || '', /at least 6/i);

  const validGoogleSignup = validateStoreRegistrationInput({
    authMethod: 'GOOGLE',
    storeName: 'Arjun Groceries',
    ownerName: 'Arjun Sharma',
    mobile: '9876543210',
    pin: '2580',
    confirmPin: '2580',
  });
  assert.equal(validGoogleSignup.valid, true);
  assert.equal(validGoogleSignup.data?.email, undefined);
});

test('resolvePasswordResetIdentifier handles direct emails and registered mobile numbers safely', () => {
  const direct = resolvePasswordResetIdentifier({
    input: '  Owner@ArjunGroceries.in ',
  });
  assert.equal(direct.valid, true);
  assert.equal(direct.email, 'owner@arjungroceries.in');
  assert.equal(direct.resolvedFromMobile, false);

  const byMobile = resolvePasswordResetIdentifier({
    input: '+91 98765-43210',
    registeredProfilePhone: '9876543210',
    boundOwnerEmail: 'ky626541@gmail.com',
  });
  assert.equal(byMobile.valid, true);
  assert.equal(byMobile.email, 'ky626541@gmail.com');
  assert.equal(byMobile.resolvedFromMobile, true);

  const unlinkedMobile = resolvePasswordResetIdentifier({
    input: '9876543210',
    registeredProfilePhone: '9876543210',
    boundOwnerEmail: null,
  });
  assert.equal(unlinkedMobile.valid, false);
  assert.equal(unlinkedMobile.needsEmailInput, true);

  const differentMobile = resolvePasswordResetIdentifier({
    input: '9999900000',
    registeredProfilePhone: '9876543210',
    boundOwnerEmail: 'ky626541@gmail.com',
  });
  assert.equal(differentMobile.valid, false);
  assert.equal(differentMobile.needsEmailInput, true);
});

test('mapFirebaseAuthErrorToMessage maps Firebase Auth error codes cleanly', () => {
  const disabled = mapFirebaseAuthErrorToMessage({ code: 'auth/operation-not-allowed' });
  assert.equal(disabled.providerDisabled, true);
  assert.match(disabled.message, /Email\/Password/i);

  const inUse = mapFirebaseAuthErrorToMessage({ code: 'auth/email-already-in-use' });
  assert.match(inUse.message, /already exists/i);

  const rateLimited = mapFirebaseAuthErrorToMessage({ code: 'auth/too-many-requests' });
  assert.match(rateLimited.message, /Too many requests/i);
});
