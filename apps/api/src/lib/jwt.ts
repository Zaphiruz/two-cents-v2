/**
 * jwt.ts — Quick-action JWT signing and verification (Phase 6a)
 *
 * Ports v1's apps/notifications/jwt.py to TypeScript.
 *
 * Algorithm: HS256 via jose's SignJWT / jwtVerify.
 * Secret: SESSION_SECRET (same as iron-session; mirrors v1 which uses one Django SECRET_KEY
 *         for everything). If you need key isolation in future, derive via HKDF or add JWT_SECRET.
 *
 * API:
 *   signQuickAction(payload, opts?) → string  — sign with jti, iat, exp
 *   verifyQuickAction(token)        → Promise<VerifiedClaims>  — verify sig + exp (not consumed)
 *   markConsumed(prisma, jti)       → Promise<void>  — idempotence guard; throws JWTReplayError
 *
 * Error classes:
 *   JWTInvalidError — bad signature, expired, malformed
 *   JWTReplayError  — jti already consumed
 *
 * NOTE: verifyQuickAction does NOT check the consumed table — mirrors v1 where verify() and
 * mark_consumed() are separate steps. Route handlers call verifyQuickAction, then markConsumed,
 * and handle JWTReplayError as a 409.
 */

import { jwtVerify, errors as joseErrors } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { randomUUID, createHmac } from 'crypto';

// ── Error classes ─────────────────────────────────────────────────────────────

export class JWTInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JWTInvalidError';
  }
}

export class JWTReplayError extends Error {
  constructor(message = 'token already used') {
    super(message);
    this.name = 'JWTReplayError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuickActionPayload {
  requestId: number;
  action: string;
  approverId: number;
}

export interface VerifiedClaims extends QuickActionPayload {
  jti: string;
  iat: number;
  exp: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 60 * 60 * 12; // 12 hours (matches v1)

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not set — cannot sign/verify JWTs');
  }
  return new TextEncoder().encode(secret);
}

// ── signQuickAction ───────────────────────────────────────────────────────────

/**
 * Sign a quick-action JWT.
 *
 * Produces an HS256 JWT with:
 *   jti  — random UUID (replay protection handle)
 *   iat  — issued-at (seconds since epoch)
 *   exp  — expiry (iat + expiresInSeconds)
 *   ...payload claims (requestId, action, approverId)
 *
 * @param payload  Business claims to embed
 * @param opts     Optional; expiresInSeconds defaults to 12h (matches v1 DEFAULT_TTL)
 */
export function signQuickAction(
  payload: QuickActionPayload,
  opts: { expiresInSeconds?: number } = {},
): string {
  const { expiresInSeconds = DEFAULT_TTL_SECONDS } = opts;
  const secret = getSecret();
  const jti = randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + expiresInSeconds;

  // Hand-rolled HS256 (sync) — trivial: base64url(header) + "." + base64url(payload) + "." + HMAC(...)
  // Using Node's built-in crypto so this stays synchronous (jose's SignJWT is async).
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = {
    ...payload,
    jti,
    iat: nowSec,
    exp,
  };
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${header}.${claimsB64}`;
  const hmac = createHmac('sha256', Buffer.from(secret));
  hmac.update(signingInput);
  const sig = hmac.digest('base64url');

  return `${signingInput}.${sig}`;
}

// ── verifyQuickAction ─────────────────────────────────────────────────────────

/**
 * Verify a quick-action JWT.
 *
 * Checks:
 *   - HS256 signature validity
 *   - exp claim (not expired)
 *   - Presence of required custom claims (requestId, action, approverId, jti)
 *
 * Does NOT check the consumed table — call markConsumed after this.
 *
 * @throws JWTInvalidError on bad signature, expired token, or malformed token
 */
export async function verifyQuickAction(token: string): Promise<VerifiedClaims> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

    // Validate required custom claims
    if (
      typeof payload['requestId'] !== 'number' ||
      typeof payload['action'] !== 'string' ||
      typeof payload['approverId'] !== 'number' ||
      typeof payload.jti !== 'string'
    ) {
      throw new JWTInvalidError('token is missing required claims');
    }

    return {
      requestId: payload['requestId'] as number,
      action: payload['action'] as string,
      approverId: payload['approverId'] as number,
      jti: payload.jti,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (err) {
    if (err instanceof JWTInvalidError) throw err;
    if (
      err instanceof joseErrors.JWTExpired ||
      err instanceof joseErrors.JWSInvalid ||
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWTClaimValidationFailed ||
      err instanceof joseErrors.JOSEAlgNotAllowed ||
      err instanceof joseErrors.JWTInvalid
    ) {
      throw new JWTInvalidError((err as Error).message);
    }
    // Any other jose error (e.g. generic JOSEError for malformed tokens)
    if (err instanceof joseErrors.JOSEError) {
      throw new JWTInvalidError((err as Error).message);
    }
    throw err;
  }
}

// ── markConsumed ──────────────────────────────────────────────────────────────

/**
 * Mark a JWT jti as consumed to prevent replay attacks.
 *
 * Inserts a row into ConsumedJWTJti. If the jti is already there (Prisma P2002 unique
 * violation), throws JWTReplayError.
 *
 * Mirrors v1's mark_consumed: get_or_create → raises JWTConsumed if not created.
 *
 * @throws JWTReplayError if jti is already consumed
 */
export async function markConsumed(prisma: PrismaClient, jti: string): Promise<void> {
  try {
    await prisma.consumedJWTJti.create({ data: { jti } });
  } catch (err: unknown) {
    // Prisma unique constraint violation → already consumed
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      throw new JWTReplayError();
    }
    throw err;
  }
}
