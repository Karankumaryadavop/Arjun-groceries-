import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPinWithSalt } from './securityCrypto';
import {
  createSignedAuthSession,
  verifyPersistedAuthSession,
  isAuthSessionExpired,
  resolveAuthLifecycleStatus,
  resolveAuthInitStage,
} from './authSession';

test('PIN-authenticated session persists and verifies cleanly across reloads', async () => {
  const pinRecord = await hashPinWithSalt('2580');
  const now = 1_760_000_000_000;

  const { record, key } = await createSignedAuthSession({
    authMode: 'PIN',
    mobile: '9876543210',
    pinRecord,
    ttlMs: 24 * 60 * 60 * 1000,
    nowMs: now,
  });

  // Verify immediately and after simulated browser refresh 2 hours later
  const verified = await verifyPersistedAuthSession({
    record,
    key,
    pinRecord,
    isPinEnabled: true,
    registeredPhone: '9876543210',
    nowMs: now + 2 * 60 * 60 * 1000,
  });

  assert.equal(verified.status, 'VALID');
  assert.equal(verified.session?.authMode, 'PIN');
  assert.equal(verified.session?.mobile, '9876543210');
  assert.equal(isAuthSessionExpired(verified.session, now + 2 * 60 * 60 * 1000), false);
});

test('Expired session is strictly rejected after expiresAt', async () => {
  const pinRecord = await hashPinWithSalt('4321');
  const now = 1_760_000_000_000;
  const ttlMs = 60 * 60 * 1000; // 1 hour

  const { record, key } = await createSignedAuthSession({
    authMode: 'PIN',
    mobile: '9123456789',
    pinRecord,
    ttlMs,
    nowMs: now,
  });

  const expiredCheck = await verifyPersistedAuthSession({
    record,
    key,
    pinRecord,
    isPinEnabled: true,
    registeredPhone: '9123456789',
    nowMs: now + ttlMs + 1000,
  });

  assert.equal(expiredCheck.status, 'EXPIRED');
  assert.match(expiredCheck.reason || '', /expired/i);
  assert.equal(isAuthSessionExpired(record.payload, now + ttlMs + 1000), true);
});

test('Tampered session payload fails HMAC signature verification', async () => {
  const pinRecord = await hashPinWithSalt('9999');
  const now = 1_760_000_000_000;

  const { record, key } = await createSignedAuthSession({
    authMode: 'PIN',
    mobile: '9876500001',
    pinRecord,
    ttlMs: 60 * 60 * 1000,
    nowMs: now,
  });

  // Attempt to forge an extended expiresAt without possessing the non-extractable HMAC key
  const tamperedRecord = {
    ...record,
    payload: {
      ...record.payload,
      expiresAt: now + 365 * 24 * 60 * 60 * 1000,
    },
  };

  const result = await verifyPersistedAuthSession({
    record: tamperedRecord,
    key,
    pinRecord,
    isPinEnabled: true,
    registeredPhone: '9876500001',
    nowMs: now + 1000,
  });

  assert.equal(result.status, 'INVALID');
});

test('Changing the store security PIN immediately invalidates older PIN sessions', async () => {
  const oldPin = await hashPinWithSalt('1111');
  const newPin = await hashPinWithSalt('2222');
  const now = 1_760_000_000_000;

  const { record, key } = await createSignedAuthSession({
    authMode: 'PIN',
    mobile: '9876500002',
    pinRecord: oldPin,
    ttlMs: 24 * 60 * 60 * 1000,
    nowMs: now,
  });

  const result = await verifyPersistedAuthSession({
    record,
    key,
    pinRecord: newPin,
    isPinEnabled: true,
    registeredPhone: '9876500002',
    nowMs: now + 5000,
  });

  assert.equal(result.status, 'PIN_CHANGED');
});

test('Guest session persists when PIN lock is disabled, but is rejected when PIN lock is active', async () => {
  const now = 1_760_000_000_000;
  const { record, key } = await createSignedAuthSession({
    authMode: 'GUEST',
    ttlMs: 24 * 60 * 60 * 1000,
    nowMs: now,
  });

  const unlockedCheck = await verifyPersistedAuthSession({
    record,
    key,
    pinRecord: null,
    isPinEnabled: false,
    nowMs: now + 5000,
  });
  assert.equal(unlockedCheck.status, 'VALID');
  assert.equal(unlockedCheck.session?.authMode, 'GUEST');

  const lockedCheck = await verifyPersistedAuthSession({
    record,
    key,
    pinRecord: await hashPinWithSalt('5678'),
    isPinEnabled: true,
    nowMs: now + 5000,
  });
  assert.equal(lockedCheck.status, 'LOCKED_GUEST_REJECTED');
});

test('Missing session returns MISSING status (never auto-authenticates)', async () => {
  const res = await verifyPersistedAuthSession({
    record: null,
    key: null,
    pinRecord: null,
    isPinEnabled: false,
  });
  assert.equal(res.status, 'MISSING');
});

test('resolveAuthLifecycleStatus remains in auth-initializing until DB, session check, and Firebase Auth all settle', () => {
  // Initial cold boot: nothing ready
  assert.equal(
    resolveAuthLifecycleStatus({
      isDbOpened: false,
      isDbHydrated: false,
      isStoreSessionChecked: false,
      isFirebaseAuthReady: false,
      hasVerifiedSession: false,
    }),
    'auth-initializing'
  );

  // Even if session verified early, stays in auth-initializing while DB or Firebase Auth is pending
  assert.equal(
    resolveAuthLifecycleStatus({
      isDbOpened: true,
      isDbHydrated: true,
      isStoreSessionChecked: true,
      isFirebaseAuthReady: false,
      hasVerifiedSession: true,
    }),
    'auth-initializing'
  );

  assert.equal(
    resolveAuthLifecycleStatus({
      isDbOpened: true,
      isDbHydrated: false,
      isStoreSessionChecked: true,
      isFirebaseAuthReady: true,
      hasVerifiedSession: true,
    }),
    'auth-initializing'
  );

  // Transitions strictly to authenticated once all readiness signals settle with verified session
  assert.equal(
    resolveAuthLifecycleStatus({
      isDbOpened: true,
      isDbHydrated: true,
      isStoreSessionChecked: true,
      isFirebaseAuthReady: true,
      hasVerifiedSession: true,
    }),
    'authenticated'
  );

  // Transitions strictly to unauthenticated once all readiness signals settle without a valid session
  assert.equal(
    resolveAuthLifecycleStatus({
      isDbOpened: true,
      isDbHydrated: true,
      isStoreSessionChecked: true,
      isFirebaseAuthReady: true,
      hasVerifiedSession: false,
    }),
    'unauthenticated'
  );
});

test('resolveAuthInitStage progresses accurately across startup boot phases', () => {
  assert.equal(
    resolveAuthInitStage({
      isDbOpened: false,
      isDbHydrated: false,
      isStoreSessionChecked: false,
      isFirebaseAuthReady: false,
      hasVerifiedSession: false,
    }),
    'opening-database'
  );

  assert.equal(
    resolveAuthInitStage({
      isDbOpened: true,
      isDbHydrated: false,
      isStoreSessionChecked: false,
      isFirebaseAuthReady: false,
      hasVerifiedSession: false,
    }),
    'verifying-session'
  );

  assert.equal(
    resolveAuthInitStage({
      isDbOpened: true,
      isDbHydrated: true,
      isStoreSessionChecked: true,
      isFirebaseAuthReady: false,
      hasVerifiedSession: true,
    }),
    'syncing-auth-provider'
  );

  assert.equal(
    resolveAuthInitStage({
      isDbOpened: true,
      isDbHydrated: true,
      isStoreSessionChecked: true,
      isFirebaseAuthReady: true,
      hasVerifiedSession: true,
    }),
    'ready'
  );
});

test('Role-scoped CUSTOMER and SUPPLIER sessions persist cleanly even when store PIN lock is active and reject tampering', async () => {
  const now = 1_760_000_000_000;
  const storePin = await hashPinWithSalt('2580');

  const custSession = await createSignedAuthSession({
    authMode: 'CUSTOMER',
    mobile: '9811223344',
    portalEntityId: 'cust-1',
    portalEntityName: 'Ramesh Patel',
    ttlMs: 24 * 60 * 60 * 1000,
    nowMs: now,
  });

  const verifiedCust = await verifyPersistedAuthSession({
    record: custSession.record,
    key: custSession.key,
    pinRecord: storePin,
    isPinEnabled: true,
    registeredPhone: '9876543210',
    nowMs: now + 30_000,
  });
  assert.equal(verifiedCust.status, 'VALID');
  assert.equal(verifiedCust.session?.authMode, 'CUSTOMER');
  assert.equal(verifiedCust.session?.portalEntityId, 'cust-1');

  // Tampering CUSTOMER session into PIN owner mode MUST fail HMAC verification
  const escalated = {
    ...custSession.record,
    payload: {
      ...custSession.record.payload,
      authMode: 'PIN' as const,
    },
  };
  const tamperedRes = await verifyPersistedAuthSession({
    record: escalated,
    key: custSession.key,
    pinRecord: storePin,
    isPinEnabled: true,
    registeredPhone: '9876543210',
    nowMs: now + 30_000,
  });
  assert.equal(tamperedRes.status, 'INVALID');

  const supSession = await createSignedAuthSession({
    authMode: 'SUPPLIER',
    mobile: '9822334455',
    portalEntityId: 'sup-1',
    portalEntityName: 'Sharma Wholesale Traders',
    ttlMs: 24 * 60 * 60 * 1000,
    nowMs: now,
  });
  const verifiedSup = await verifyPersistedAuthSession({
    record: supSession.record,
    key: supSession.key,
    pinRecord: storePin,
    isPinEnabled: true,
    registeredPhone: '9876543210',
    nowMs: now + 30_000,
  });
  assert.equal(verifiedSup.status, 'VALID');
  assert.equal(verifiedSup.session?.authMode, 'SUPPLIER');
  assert.equal(verifiedSup.session?.portalEntityId, 'sup-1');
});

