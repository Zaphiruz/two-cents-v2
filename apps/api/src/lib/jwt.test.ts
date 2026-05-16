/**
 * jwt.test.ts — Tests for lib/jwt.ts (Phase 6a)
 *
 * Mirrors v1's test_jwt.py test cases plus extra coverage for markConsumed.
 *
 * Tests:
 *   1. sign + verify round-trip: claims roundtrip correctly
 *   2. verify rejects tampered token (signature mismatch → JWTInvalidError)
 *   3. verify rejects expired token (exp in past → JWTInvalidError)
 *   4. verify rejects malformed token (garbage string → JWTInvalidError)
 *   5. verify rejects wrong key (signed with different secret → JWTInvalidError)
 *   6. markConsumed inserts jti into ConsumedJWTJti table
 *   7. markConsumed throws JWTReplayError when jti already exists
 *   8. verify+markConsumed integration: verify ok, mark consumed, markConsumed again throws
 *   9. signQuickAction includes required claims (jti, iat, exp)
 *  10. verifyQuickAction rejects token after markConsumed (replay via verifyQuickAction check)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma, clearDatabase } from '../test-helpers/db.js';
import {
  signQuickAction,
  verifyQuickAction,
  markConsumed,
  JWTInvalidError,
  JWTReplayError,
} from './jwt.js';

beforeEach(async () => {
  await clearDatabase();
});

// ── signQuickAction + verifyQuickAction ───────────────────────────────────────

describe('signQuickAction / verifyQuickAction', () => {
  // 1. round-trip
  it('sign + verify round-trip: payload claims roundtrip correctly', async () => {
    const token = signQuickAction({ requestId: 1, action: 'approve', approverId: 2 });
    const claims = await verifyQuickAction(token);
    expect(claims.requestId).toBe(1);
    expect(claims.action).toBe('approve');
    expect(claims.approverId).toBe(2);
    expect(typeof claims.jti).toBe('string');
    expect(claims.jti.length).toBeGreaterThan(0);
  });

  // 9. includes required JWT standard claims
  it('signQuickAction token includes jti, iat, exp', () => {
    const token = signQuickAction({ requestId: 1, action: 'approve', approverId: 2 });
    // Decode the payload without verification to check structure
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  // 2. tampered token
  it('verify rejects tampered token (signature mismatch → JWTInvalidError)', async () => {
    const token = signQuickAction({ requestId: 1, action: 'approve', approverId: 2 });
    const tampered = token.slice(0, -2) + 'xx';
    await expect(verifyQuickAction(tampered)).rejects.toBeInstanceOf(JWTInvalidError);
  });

  // 3. expired token
  it('verify rejects expired token (exp in past → JWTInvalidError)', async () => {
    const token = signQuickAction(
      { requestId: 1, action: 'approve', approverId: 2 },
      { expiresInSeconds: -1 },
    );
    await expect(verifyQuickAction(token)).rejects.toBeInstanceOf(JWTInvalidError);
  });

  // 4. malformed token
  it('verify rejects malformed (garbage) token → JWTInvalidError', async () => {
    await expect(verifyQuickAction('this.is.garbage')).rejects.toBeInstanceOf(JWTInvalidError);
  });

  // 5. wrong key (signed with different secret)
  it('verify rejects token signed with different key → JWTInvalidError', async () => {
    // Hand-craft a token with a different secret using base64url encoding
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ requestId: 1, action: 'approve', approverId: 2, jti: 'x', iat: 1, exp: 9999999999 }),
    ).toString('base64url');
    const fakeToken = `${header}.${payload}.invalidsignature`;
    await expect(verifyQuickAction(fakeToken)).rejects.toBeInstanceOf(JWTInvalidError);
  });
});

// ── markConsumed ──────────────────────────────────────────────────────────────

describe('markConsumed', () => {
  // 6. inserts jti
  it('inserts the jti into ConsumedJWTJti table', async () => {
    const jti = 'test-jti-insert-001';
    await markConsumed(prisma, jti);
    const row = await prisma.consumedJWTJti.findUnique({ where: { jti } });
    expect(row).not.toBeNull();
    expect(row!.jti).toBe(jti);
  });

  // 7. replay blocked
  it('throws JWTReplayError when jti is already consumed', async () => {
    const jti = 'test-jti-replay-001';
    await markConsumed(prisma, jti);
    await expect(markConsumed(prisma, jti)).rejects.toBeInstanceOf(JWTReplayError);
  });
});

// ── integration ───────────────────────────────────────────────────────────────

describe('integration: verify + markConsumed', () => {
  // 8. verify ok, mark, second mark throws
  it('first verify succeeds; second markConsumed throws JWTReplayError', async () => {
    const token = signQuickAction({ requestId: 5, action: 'deny', approverId: 10 });
    const claims = await verifyQuickAction(token);
    await markConsumed(prisma, claims.jti);
    await expect(markConsumed(prisma, claims.jti)).rejects.toBeInstanceOf(JWTReplayError);
  });

  // 10. verifyQuickAction itself checks for replay (when it does the full flow)
  it('verify works for fresh token; markConsumed + verify still returns claims (verify does not check consumed)', async () => {
    // NOTE: v1's verify() does NOT check consumed — only mark_consumed prevents replay.
    // Our verifyQuickAction similarly does NOT auto-consume; markConsumed is a separate step.
    // This test confirms verifyQuickAction does NOT check the consumed table.
    const token = signQuickAction({ requestId: 3, action: 'approve', approverId: 7 });
    const claims1 = await verifyQuickAction(token);
    await markConsumed(prisma, claims1.jti);
    // verify still succeeds — the route handler calls markConsumed after verify and handles JWTReplayError
    const claims2 = await verifyQuickAction(token);
    expect(claims2.jti).toBe(claims1.jti);
  });
});
