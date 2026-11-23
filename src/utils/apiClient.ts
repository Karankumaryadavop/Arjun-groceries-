/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface SessionCache {
  token: string;
  expiresAt: number;
}

let inMemorySession: SessionCache | null = null;
let pendingSessionPromise: Promise<string | null> | null = null;
let authCooldownUntil = 0;

export function clearInMemoryApiSession(): void {
  inMemorySession = null;
}

export function isApiAuthUnavailable(): boolean {
  return Date.now() < authCooldownUntil;
}

async function requestLocalSessionToken(): Promise<string | null> {
  if (Date.now() < authCooldownUntil) {
    return null;
  }

  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 503) {
        authCooldownUntil = Date.now() + 60_000;
      }
      return null;
    }

    const data = await res.json();
    if (data?.success && typeof data.token === 'string' && data.token.trim()) {
      const expiresAt =
        typeof data.expiresAt === 'number'
          ? data.expiresAt
          : Date.now() + 14 * 60 * 1000;
      inMemorySession = {
        token: data.token,
        expiresAt,
      };
      authCooldownUntil = 0;
      return data.token;
    }

    return null;
  } catch {
    return null;
  }
}

export async function getApiSessionToken(): Promise<string | null> {
  if (inMemorySession && inMemorySession.expiresAt - 10_000 > Date.now()) {
    return inMemorySession.token;
  }

  if (!pendingSessionPromise) {
    pendingSessionPromise = requestLocalSessionToken().finally(() => {
      pendingSessionPromise = null;
    });
  }

  return pendingSessionPromise;
}

/**
 * Authenticated fetch wrapper for Arjun Groceries /api/* routes.
 * Keeps session tokens strictly in memory and attaches Authorization: Bearer <token>.
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getApiSessionToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401 && token) {
    inMemorySession = null;
    const refreshedToken = await getApiSessionToken();
    if (refreshedToken && refreshedToken !== token) {
      const retryHeaders = new Headers(init.headers || {});
      retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
      return fetch(input, {
        ...init,
        headers: retryHeaders,
      });
    }
  }

  return response;
}
