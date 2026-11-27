/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps } from 'firebase/app';
import { Analytics, getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import {
  Auth,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  reload as reloadFirebaseUser,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile as updateFirebaseProfile,
  User,
} from 'firebase/auth';
import { doc, Firestore, getDocFromServer, getFirestore } from 'firebase/firestore';
import { CloudAuthUser } from './types';

// Arjun Groceries Firebase Web SDK configuration (Firebase Auth + Cloud Firestore + Analytics)
export const firebaseConfig = {
  apiKey: 'AIzaSyDF8b9ua3lTbQtg7dCGykGuo5Xvm1ptaK0',
  authDomain: 'arjun-groceries.firebaseapp.com',
  projectId: 'arjun-groceries',
  storageBucket: 'arjun-groceries.firebasestorage.app',
  messagingSenderId: '206303757333',
  appId: '1:206303757333:web:8006b924319e66fab9fa1c',
  measurementId: 'G-KF1VWTFE5C',
};

// Initialize Firebase
export const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

// Initialize Cloud Firestore against the project's default database
export const db: Firestore = getFirestore(app);

// Initialize Firebase Analytics safely in supported browser environments only
export let analytics: Analytics | null = null;
if (typeof window !== 'undefined') {
  void isAnalyticsSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {
      analytics = null;
    });
}

function initPersistentFirebaseAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: [browserLocalPersistence, indexedDBLocalPersistence],
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = initPersistentFirebaseAuth();

let persistenceReadyPromise: Promise<void> | null = null;

/**
 * Explicitly enforces Firebase Auth `browserLocalPersistence` via `setPersistence`
 * so authenticated Firebase sessions reliably survive page refreshes and browser restarts.
 */
export function ensureFirebaseAuthPersistence(): Promise<void> {
  if (!persistenceReadyPromise) {
    persistenceReadyPromise = setPersistence(auth, browserLocalPersistence).catch(() => {
      // Safe fallback when browser storage is restricted (e.g., private browsing iframe)
    });
  }
  return persistenceReadyPromise;
}

// Kick off persistence configuration immediately at module initialization
void ensureFirebaseAuthPersistence();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

/**
 * Structured Firestore error handler providing rich auth & path context for diagnosis.
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

/**
 * Startup connectivity check against Cloud Firestore (`getDocFromServer`).
 * Logs a clear diagnostic only if the Firestore client reports being offline/misconfigured.
 * Expected `permission-denied` or `not-found` responses confirm the backend is reachable.
 */
export async function testFirestoreConnection(): Promise<{ reachable: boolean; offline?: boolean }> {
  if (connectionTested) {
    return { reachable: true };
  }
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { reachable: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { reachable: false, offline: true };
    }
    // Permission denied / not found proves the Firestore server responded
    return { reachable: true };
  }
}

export function toCloudAuthUser(user: User | null): CloudAuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
}

export function subscribeToFirebaseAuth(
  callback: (user: CloudAuthUser | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onAuthStateChanged(
    auth,
    (user) => {
      callback(toCloudAuthUser(user));
    },
    (error) => {
      onError?.(error);
    }
  );
}

/**
 * Awaits Firebase persistence setup and `auth.authStateReady()` so the
 * persisted Firebase Auth user is restored before rendering routes.
 */
export async function waitForFirebaseAuthReady(): Promise<CloudAuthUser | null> {
  await ensureFirebaseAuthPersistence();
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }
  return toCloudAuthUser(auth.currentUser);
}

/**
 * Signs in an existing user with Firebase Authentication (Email & Password).
 */
export async function signInWithFirebaseEmailPassword(params: {
  email: string;
  password: string;
}): Promise<CloudAuthUser> {
  await ensureFirebaseAuthPersistence();
  const cred = await signInWithEmailAndPassword(
    auth,
    params.email.trim().toLowerCase(),
    params.password
  );
  const cloudUser = toCloudAuthUser(cred.user);
  if (!cloudUser) {
    throw new Error('Signed in with Firebase, but the user profile could not be read.');
  }
  return cloudUser;
}

/**
 * Signs in or signs up a user via Firebase Authentication with Google (`signInWithPopup`).
 */
export async function signInWithFirebaseGoogle(): Promise<CloudAuthUser> {
  await ensureFirebaseAuthPersistence();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  const cloudUser = toCloudAuthUser(cred.user);
  if (!cloudUser) {
    throw new Error('Signed in with Google, but the user profile could not be read.');
  }
  return cloudUser;
}

/**
 * Registers a new user with Firebase Authentication (Email & Password),
 * updates their display name, and optionally sends a verification email.
 */
export async function registerFirebaseEmailOwnerAccount(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ user: CloudAuthUser; verificationEmailSent: boolean }> {
  await ensureFirebaseAuthPersistence();
  const cred = await createUserWithEmailAndPassword(
    auth,
    params.email.trim().toLowerCase(),
    params.password
  );
  const trimmedName = (params.displayName || '').trim();
  if (trimmedName) {
    try {
      await updateFirebaseProfile(cred.user, { displayName: trimmedName });
    } catch {
      // Non-blocking profile display name update
    }
  }
  let verificationEmailSent = false;
  if (!cred.user.emailVerified) {
    try {
      await sendEmailVerification(cred.user);
      verificationEmailSent = true;
    } catch {
      // Allow sign-up flow to proceed even if verification email delivery is throttled
    }
  }
  const cloudUser = toCloudAuthUser(cred.user);
  if (!cloudUser) {
    throw new Error('Firebase account was created, but the user profile could not be read.');
  }
  return { user: cloudUser, verificationEmailSent };
}

/**
 * Resends the email verification link for the currently signed-in Firebase user.
 */
export async function resendFirebaseEmailVerification(): Promise<void> {
  await ensureFirebaseAuthPersistence();
  if (!auth.currentUser) {
    throw new Error('Please sign in first before requesting an email verification link.');
  }
  await sendEmailVerification(auth.currentUser);
}

/**
 * Reloads the current Firebase user token & profile (e.g. after clicking the email verification link).
 */
export async function refreshFirebaseAuthUser(): Promise<CloudAuthUser | null> {
  await ensureFirebaseAuthPersistence();
  if (!auth.currentUser) return null;
  await reloadFirebaseUser(auth.currentUser);
  await auth.currentUser.getIdToken(true);
  return toCloudAuthUser(auth.currentUser);
}

/**
 * Triggers Firebase Auth's `sendPasswordResetEmail` flow.
 * Treats `auth/user-not-found` as privacy-safe completion to prevent account enumeration.
 */
export async function sendFirebasePasswordResetEmail(email: string): Promise<{ sent: boolean }> {
  await ensureFirebaseAuthPersistence();
  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
    return { sent: true };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/user-not-found') {
      return { sent: true };
    }
    throw err;
  }
}

export async function signOutFirebaseAuth(): Promise<void> {
  return signOut(auth);
}

export const signOutFirebaseSync = signOutFirebaseAuth;

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
