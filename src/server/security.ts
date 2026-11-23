/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type ServerRole = 'owner' | 'operator';

export type ServerScope =
  | 'ai:ocr'
  | 'ai:forecast'
  | 'whatsapp:read'
  | 'whatsapp:snapshot'
  | 'whatsapp:batch:prepare'
  | 'whatsapp:batch:approve'
  | 'whatsapp:batch:cancel'
  | 'whatsapp:dispatch'
  | 'whatsapp:config';

export const OPERATOR_SCOPES: readonly ServerScope[] = [
  'ai:ocr',
  'ai:forecast',
  'whatsapp:read',
  'whatsapp:snapshot',
  'whatsapp:batch:prepare',
  'whatsapp:batch:cancel',
];

export const OWNER_SCOPES: readonly ServerScope[] = [
  ...OPERATOR_SCOPES,
  'whatsapp:batch:approve',
  'whatsapp:dispatch',
  'whatsapp:config',
];

export interface AuthContext {
  sub: string;
  role: ServerRole;
  scopes: ServerScope[];
  authMethod: 'session_token' | 'api_token';
  isDirectLoopback: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  rawBody?: Buffer;
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_GEMINI_KEY]'],
  [/EAA[0-9A-Za-z]{12,}/g, '[REDACTED_META_TOKEN]'],
  [/((?:api[_-]?key|access[_-]?token|verify[_-]?token|secret|password|token)\s*[:=]\s*["']?)([^"'\s,&;]{4,})(["']?)/gi, '$1[REDACTED]$3'],
];

/**
 * Redacts known secret strings and credential patterns from log output or error text.
 */
export function redactSensitiveText(
  input: unknown,
  knownSecrets: Array<string | undefined | null> = []
): string {
  let text =
    input instanceof Error
      ? input.message || 'Unknown error'
      : typeof input === 'string'
        ? input
        : String(input ?? '');

  for (const secret of knownSecrets) {
    const trimmed = typeof secret === 'string' ? secret.trim() : '';
    if (trimmed.length >= 4 && text.includes(trimmed)) {
      text = text.split(trimmed).join('[REDACTED]');
    }
  }

  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }

  return text;
}

/**
 * Logs errors safely without printing raw stack traces containing secrets or credential objects.
 */
export function safeLogError(
  label: string,
  err: unknown,
  knownSecrets: Array<string | undefined | null> = []
): void {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: unknown }).status
      : undefined;
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;
  const msg = redactSensitiveText(err, knownSecrets);
  const metaParts: string[] = [];
  if (typeof status === 'number') metaParts.push(`status=${status}`);
  if (typeof code === 'string' || typeof code === 'number') metaParts.push(`code=${code}`);
  const meta = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : '';
  console.error(`[${label}]${meta}: ${msg}`);
}

/**
 * Constant-time string comparison using SHA-256 digests so lengths never leak via timing.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Verifies Meta X-Hub-Signature-256 (`sha256=<hex>`) against raw request payload.
 */
export function verifyMetaWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  const secret = (appSecret || '').trim();
  if (!secret || !rawBody || !signatureHeader) return false;
  const trimmedHeader = signatureHeader.trim();
  if (!trimmedHeader.startsWith('sha256=')) return false;

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const providedHex = trimmedHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expectedHex, 'hex'),
    Buffer.from(providedHex.toLowerCase(), 'hex')
  );
}

/**
 * Checks whether a TCP connection came directly from loopback without reverse-proxy forwarding headers.
 */
export function isDirectLoopbackRequest(req: Request): boolean {
  const hasProxyHeaders = Boolean(
    req.headers['x-forwarded-for'] ||
      req.headers['forwarded'] ||
      req.headers['x-real-ip']
  );
  if (hasProxyHeaders) return false;

  const remoteAddr = (req.socket?.remoteAddress || req.ip || '').trim();
  return (
    remoteAddr === '127.0.0.1' ||
    remoteAddr === '::1' ||
    remoteAddr === '::ffff:127.0.0.1'
  );
}

/**
 * Builds an explicit origin allowlist from ALLOWED_ORIGINS, APP_URL, and local development origins.
 * Never returns '*' wildcard.
 */
export function buildAllowedOrigins(options: {
  allowedOriginsEnv?: string;
  appUrl?: string;
  port: number;
  nodeEnv?: string;
}): Set<string> {
  const origins = new Set<string>();

  const addOrigin = (candidate: string | undefined) => {
    const raw = (candidate || '').trim();
    if (!raw || raw === '*') return;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore invalid origin entries
    }
  };

  if (options.allowedOriginsEnv) {
    for (const part of options.allowedOriginsEnv.split(',')) {
      addOrigin(part);
    }
  }

  addOrigin(options.appUrl);

  if (options.nodeEnv !== 'production') {
    origins.add(`http://localhost:${options.port}`);
    origins.add(`http://127.0.0.1:${options.port}`);
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return origins;
}

/**
 * Strict CORS middleware using an explicit origin allowlist.
 * Note: CORS is browser protection only and is NEVER treated as authentication.
 */
export function createCorsMiddleware(allowedOrigins: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originHeader = req.headers.origin;
    if (!originHeader) {
      if (req.method === 'OPTIONS' && req.path.startsWith('/api/')) {
        return res.status(204).end();
      }
      return next();
    }

    let normalizedOrigin = '';
    let originHost = '';
    try {
      const parsedOrigin = new URL(originHeader);
      normalizedOrigin = parsedOrigin.origin;
      originHost = parsedOrigin.host.toLowerCase();
    } catch {
      normalizedOrigin = '';
      originHost = '';
    }

    const requestHost = String(
      req.headers['x-forwarded-host'] || req.headers.host || ''
    )
      .split(',')[0]
      .trim()
      .toLowerCase();
    const isSameOrigin = Boolean(originHost && requestHost && originHost === requestHost);

    if (!normalizedOrigin || (!isSameOrigin && !allowedOrigins.has(normalizedOrigin))) {
      if (req.path.startsWith('/api/') || req.method === 'OPTIONS') {
        return res.status(403).json({
          success: false,
          code: 'CORS_ORIGIN_FORBIDDEN',
          error: 'Origin is not permitted by CORS policy.',
        });
      }
      return res.status(403).send('Forbidden');
    }

    res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    return next();
  };
}

/**
 * Global HTTP security headers preserving AI Studio preview iframe compatibility
 * and local camera/microphone functionality on same-origin.
 */
export function createSecurityHeadersMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()'
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    const isHttps =
      req.secure ||
      String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
    if (isHttps) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      );
    }

    next();
  };
}

/**
 * Extra strict hardening headers for JSON API endpoints (/api/*).
 */
export function createApiSecurityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'"
    );
    next();
  };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  name?: string;
  keyGenerator?: (req: Request) => string;
}

/**
 * In-memory fixed-window rate limiter with standard RateLimit-* & Retry-After headers.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, RateBucket>();
  const windowMs = Math.max(1000, options.windowMs);
  const max = Math.max(1, options.max);
  let lastCleanup = Date.now();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastCleanup > windowMs && buckets.size > 0) {
      for (const [k, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) {
          buckets.delete(k);
        }
      }
      lastCleanup = now;
    }

    const authReq = req as AuthenticatedRequest;
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const baseKey = options.keyGenerator
      ? options.keyGenerator(req)
      : authReq.auth?.sub
        ? `${clientIp}:${authReq.auth.sub}`
        : clientIp;
    const key = `${options.name || 'default'}:${baseKey}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: 'Too many requests. Please wait before trying again.',
      });
    }

    return next();
  };
}

interface SignedTokenPayload {
  sub: string;
  role: ServerRole;
  scopes: ServerScope[];
  iat: number;
  exp: number;
  jti: string;
}

export interface TokenServiceOptions {
  apiAuthToken?: string;
  signingSecret?: string;
  nodeEnv?: string;
  allowLocalDevSession?: boolean;
  sessionTtlSeconds?: number;
}

export function createTokenService(options: TokenServiceOptions = {}) {
  const apiAuthToken = (options.apiAuthToken || '').trim();
  const nodeEnv = (options.nodeEnv || 'development').trim();
  const isProduction = nodeEnv === 'production';
  const allowLocalDevSession =
    options.allowLocalDevSession !== undefined
      ? options.allowLocalDevSession
      : !isProduction && !apiAuthToken;
  const sessionTtlSeconds = Math.max(60, options.sessionTtlSeconds ?? 900); // 15 minutes default

  // Derive signing key from explicit secret, API token, or ephemeral per-boot CSPRNG bytes.
  const explicitSigning = (options.signingSecret || '').trim();
  const signingKey: Buffer = explicitSigning
    ? crypto.createHash('sha256').update(`sign:${explicitSigning}`, 'utf8').digest()
    : apiAuthToken
      ? crypto.createHash('sha256').update(`derive:${apiAuthToken}`, 'utf8').digest()
      : crypto.randomBytes(32);

  function signSessionToken(params: {
    sub: string;
    role: ServerRole;
    scopes: ServerScope[];
    ttlSeconds?: number;
  }): { token: string; expiresAt: number; role: ServerRole; scopes: ServerScope[] } {
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = Math.max(30, params.ttlSeconds ?? sessionTtlSeconds);
    const payload: SignedTokenPayload = {
      sub: params.sub,
      role: params.role,
      scopes: [...params.scopes],
      iat: nowSec,
      exp: nowSec + ttl,
      jti: crypto.randomBytes(12).toString('hex'),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', signingKey)
      .update(`v1.${encodedPayload}`, 'utf8')
      .digest('base64url');
    return {
      token: `v1.${encodedPayload}.${sig}`,
      expiresAt: payload.exp * 1000,
      role: payload.role,
      scopes: payload.scopes,
    };
  }

  function verifySignedToken(token: string): AuthContext | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;

    const [, encodedPayload, providedSig] = parts;
    if (!encodedPayload || !providedSig) return null;

    const expectedSig = crypto
      .createHmac('sha256', signingKey)
      .update(`v1.${encodedPayload}`, 'utf8')
      .digest('base64url');

    if (!timingSafeEqualStrings(providedSig, expectedSig)) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8')
      ) as Partial<SignedTokenPayload>;
      const nowSec = Math.floor(Date.now() / 1000);
      if (
        typeof parsed.sub !== 'string' ||
        (parsed.role !== 'owner' && parsed.role !== 'operator') ||
        !Array.isArray(parsed.scopes) ||
        typeof parsed.exp !== 'number' ||
        parsed.exp <= nowSec
      ) {
        return null;
      }

      return {
        sub: parsed.sub,
        role: parsed.role,
        scopes: parsed.scopes as ServerScope[],
        authMethod: 'session_token',
        isDirectLoopback: false,
      };
    } catch {
      return null;
    }
  }

  function verifyBearerToken(rawHeader: string | undefined, req: Request): AuthContext | null {
    if (!rawHeader || typeof rawHeader !== 'string') return null;
    const match = rawHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const token = match[1].trim();
    if (!token) return null;

    const isLoopback = isDirectLoopbackRequest(req);

    // 1. Direct static API_AUTH_TOKEN (only if configured in environment)
    if (apiAuthToken && timingSafeEqualStrings(token, apiAuthToken)) {
      return {
        sub: 'api-owner',
        role: 'owner',
        scopes: [...OWNER_SCOPES],
        authMethod: 'api_token',
        isDirectLoopback: isLoopback,
      };
    }

    // 2. Signed short-lived session token
    const sessionCtx = verifySignedToken(token);
    if (sessionCtx) {
      sessionCtx.isDirectLoopback = isLoopback;
      return sessionCtx;
    }

    return null;
  }

  function requireAuth(
    requiredScopes: ServerScope[] = [],
    options?: { allowLoopbackSandboxOperator?: () => boolean }
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      const ctx = verifyBearerToken(req.headers.authorization, req);
      if (!ctx) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="ArjunGroceries"');
        return res.status(401).json({
          success: false,
          code: 'UNAUTHORIZED',
          error: 'Authentication required.',
        });
      }

      const hasAllScopes = requiredScopes.every((scope) => ctx.scopes.includes(scope));
      if (!hasAllScopes) {
        const loopbackSandboxAllowed =
          !isProduction &&
          !apiAuthToken &&
          ctx.isDirectLoopback &&
          ctx.role === 'operator' &&
          Boolean(options?.allowLoopbackSandboxOperator?.());

        if (!loopbackSandboxAllowed) {
          return res.status(403).json({
            success: false,
            code: 'FORBIDDEN',
            error: 'Insufficient permissions for this action.',
          });
        }
      }

      (req as AuthenticatedRequest).auth = ctx;
      return next();
    };
  }

  function handleSessionIssue(req: Request, res: Response) {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      token?: unknown;
      requestedRole?: unknown;
    };

    const headerMatch =
      typeof req.headers.authorization === 'string'
        ? req.headers.authorization.match(/^Bearer\s+(.+)$/i)
        : null;
    const suppliedCredential =
      typeof body.token === 'string' && body.token.trim()
        ? body.token.trim()
        : headerMatch
          ? headerMatch[1].trim()
          : '';

    const requestedRole: ServerRole =
      body.requestedRole === 'operator' ? 'operator' : 'owner';

    // When API_AUTH_TOKEN is configured or running in production, always require credential verification.
    if (apiAuthToken || isProduction) {
      if (!apiAuthToken) {
        return res.status(503).json({
          success: false,
          code: 'AUTH_NOT_CONFIGURED',
          error: 'Server authentication token is not configured for production use.',
        });
      }
      if (!suppliedCredential || !timingSafeEqualStrings(suppliedCredential, apiAuthToken)) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_CREDENTIALS',
          error: 'Invalid authentication credential.',
        });
      }

      const issued = signSessionToken({
        sub: requestedRole === 'owner' ? 'store-owner' : 'store-operator',
        role: requestedRole,
        scopes: requestedRole === 'owner' ? [...OWNER_SCOPES] : [...OPERATOR_SCOPES],
      });
      return res.json({
        success: true,
        token: issued.token,
        role: issued.role,
        scopes: issued.scopes,
        expiresAt: issued.expiresAt,
      });
    }

    // Local development fallback ONLY when API_AUTH_TOKEN is unset, non-production, AND direct loopback socket (no proxies).
    if (!allowLocalDevSession || !isDirectLoopbackRequest(req)) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'Authentication credential is required.',
      });
    }

    // Auto-issued local dev session is strictly downgraded to 'operator' (never 'owner').
    const issued = signSessionToken({
      sub: 'local-loopback-operator',
      role: 'operator',
      scopes: [...OPERATOR_SCOPES],
    });
    return res.json({
      success: true,
      token: issued.token,
      role: issued.role,
      scopes: issued.scopes,
      expiresAt: issued.expiresAt,
    });
  }

  return {
    isConfigured: Boolean(apiAuthToken),
    isProduction,
    signSessionToken,
    verifyBearerToken,
    requireAuth,
    handleSessionIssue,
  };
}
