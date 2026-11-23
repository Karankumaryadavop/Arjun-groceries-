/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile as updateFirebaseProfile,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import { CloudAuthUser } from './types';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

function initPersistentFirebaseAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: [browserLocalPersistence, indexedDBLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(app);
  }
}

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = initPersistentFirebaseAuth();
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

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

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    // Permission denied or missing test doc still confirms server reachability
    return true;
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
 * Awaits Firebase persistence setup and official `auth.authStateReady()` so the
 * persisted `browserLocalPersistence` Firebase user is restored before rendering routes.
 * Redirect results are checked opportunistically without stalling offline startup.
 */
export async function waitForFirebaseAuthReady(): Promise<CloudAuthUser | null> {
  await ensureFirebaseAuthPersistence();
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }
  const redirectedUser = await Promise.race<CloudAuthUser | null>([
    consumeFirebaseRedirectAuthResult().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 350)),
  ]);
  return redirectedUser ?? toCloudAuthUser(auth.currentUser);
}

export async function consumeFirebaseRedirectAuthResult(): Promise<CloudAuthUser | null> {
  try {
    const res = await getRedirectResult(auth);
    if (!res?.user) return null;
    if (!res.user.emailVerified) {
      await signOut(auth);
      throw new Error('Your Google account email must be verified before enabling Cloud Backup.');
    }
    return toCloudAuthUser(res.user);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/no-auth-event') return null;
    throw err;
  }
}

export async function signInWithGoogleForSync() {
  await ensureFirebaseAuthPersistence();
  return signInWithPopup(auth, googleProvider);
}

export async function signInWithGoogleForCloudBackup(): Promise<{
  user: CloudAuthUser | null;
  redirectStarted?: boolean;
}> {
  try {
    await ensureFirebaseAuthPersistence();
    const cred = await signInWithPopup(auth, googleProvider);
    if (!cred.user.emailVerified) {
      await signOut(auth);
      throw new Error('Google account email is not verified. Please use a verified Google account.');
    }
    return { user: toCloudAuthUser(cred.user) };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await ensureFirebaseAuthPersistence();
      await signInWithRedirect(auth, googleProvider);
      return { user: null, redirectStarted: true };
    }
    throw err;
  }
}

export async function signOutFirebaseSync() {
  return signOut(auth);
}

/**
 * Registers a new store owner with Firebase Auth Email/Password, sets their display name,
 * and triggers an email verification link so Firestore rules (`email_verified == true`) can activate cleanly.
 */
export async function registerFirebaseEmailOwnerAccount(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ user: CloudAuthUser; verificationEmailSent: boolean }> {
  await ensureFirebaseAuthPersistence();
  const cred = await createUserWithEmailAndPassword(auth, params.email, params.password);
  if (params.displayName.trim()) {
    try {
      await updateFirebaseProfile(cred.user, { displayName: params.displayName.trim() });
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
      // Allow registration flow to proceed even if verification email delivery is throttled
    }
  }
  const cloudUser = toCloudAuthUser(cred.user);
  if (!cloudUser) {
    throw new Error('Firebase account was created, but the user profile could not be read.');
  }
  return { user: cloudUser, verificationEmailSent };
}

/**
 * Triggers Firebase Auth's official `sendPasswordResetEmail` flow.
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

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;
export const FIREBASE_STORAGE_BUCKET = firebaseConfig.storageBucket;
