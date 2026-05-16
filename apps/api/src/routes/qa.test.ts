/**
 * qa.test.ts — Route-level tests for POST /api/qa/:token (Phase 6b)
 *
 * Mocks sendPushNotification to avoid side effects from fireEvent calls in /api/requests/.
 *
 * Tests:
 *   1. Valid token → 200 + transition applied
 *   2. Replayed token → 409 token_already_used
 *   3. Expired token → 400 invalid_token
 *   4. Malformed/garbage token → 400 invalid_token
 *   5. Token with non-existent requestId → 404
 *   6. Token with non-existent approverId → 404
 *   7. Valid token but illegal transition (e.g. approve an already-approved request) → 409 illegal_transition
 */

import { describe, it, expect, vi } from 'vitest';

// Mock web-push to prevent any actual push calls
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  },
}));

// Also mock sendPushNotification directly
vi.mock('../lib/push.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/push.js')>();
  return {
    ...actual,
    sendPushNotification: vi.fn().mockResolvedValue(undefined),
  };
});

import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { signQuickAction, markConsumed } from '../lib/jwt.js';

// Fixture: create a household with buyer + approver and a pending request
async function setupQAFixture() {
  const household = await prisma.household.create({ data: { name: 'QA Household' } });

  const buyerUser = await prisma.user.create({ data: { oidcSubject: 'qa-buyer', name: 'Buyer' } });
  const approverUser = await prisma.user.create({ data: { oidcSubject: 'qa-approver', name: 'Approver' } });

  const buyerMember = await prisma.householdMember.create({
    data: { householdId: household.id, userId: buyerUser.id },
  });
  const approverMember = await prisma.householdMember.create({
    data: { householdId: household.id, userId: approverUser.id },
  });

  await prisma.buyerApprover.create({
    data: { buyerId: buyerMember.id, approverId: approverMember.id },
  });

  const request = await prisma.request.create({
    data: {
      householdId: household.id,
      buyerId: buyerMember.id,
      title: 'Test QA Request',
      buyerSeriousness: 'need',
      status: 'pending',
      items: {
        create: {
          title: 'Item 1',
          url: 'https://example.com',
          priceCents: 2000,
          position: 0,
        },
      },
    },
  });

  return { buyerMember, approverMember, request };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/qa/:token', () => {
  // 1. Valid token → 200 + transition applied
  it('returns 200 and applies transition on a valid approve token', async () => {
    const { approverMember, request } = await setupQAFixture();
    const token = signQuickAction({
      requestId: request.id,
      action: 'approve',
      approverId: approverMember.id,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: `/api/qa/${token}` });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ ok: boolean; status: string }>();
      expect(body.ok).toBe(true);
      expect(body.status).toBe('approved');

      // The request status should be updated in the DB
      const updated = await prisma.request.findUnique({ where: { id: request.id } });
      expect(updated!.status).toBe('approved');
    } finally {
      await app.close();
    }
  });

  // 2. Replayed token → 409 token_already_used
  it('returns 409 token_already_used when the token is replayed', async () => {
    const { approverMember, request } = await setupQAFixture();
    const token = signQuickAction({
      requestId: request.id,
      action: 'approve',
      approverId: approverMember.id,
    });

    const app = await buildApp();
    try {
      // First use
      const res1 = await app.inject({ method: 'POST', url: `/api/qa/${token}` });
      expect(res1.statusCode).toBe(200);

      // Replay — reset the request status to pending first to avoid transition conflict
      // Actually, the token_already_used error should fire BEFORE the transition
      const res2 = await app.inject({ method: 'POST', url: `/api/qa/${token}` });
      expect(res2.statusCode).toBe(409);
      expect(res2.json()).toMatchObject({ error: 'token_already_used' });
    } finally {
      await app.close();
    }
  });

  // 3. Expired token → 400 invalid_token
  it('returns 400 invalid_token for an expired token', async () => {
    const { approverMember, request } = await setupQAFixture();
    const token = signQuickAction(
      { requestId: request.id, action: 'approve', approverId: approverMember.id },
      { expiresInSeconds: -1 },
    );

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: `/api/qa/${token}` });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_token' });
    } finally {
      await app.close();
    }
  });

  // 4. Malformed/garbage token → 400 invalid_token
  it('returns 400 invalid_token for a garbage token', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/qa/this.is.garbage' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_token' });
    } finally {
      await app.close();
    }
  });

  // 5. Token with non-existent requestId → 404
  it('returns 404 when the requestId in the token does not exist', async () => {
    const { approverMember } = await setupQAFixture();
    const token = signQuickAction({
      requestId: 999999,
      action: 'approve',
      approverId: approverMember.id,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: `/api/qa/${token}` });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  // 6. Token with non-existent approverId → 404
  it('returns 404 when the approverId in the token does not exist', async () => {
    const { request } = await setupQAFixture();
    const token = signQuickAction({
      requestId: request.id,
      action: 'approve',
      approverId: 999999,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: `/api/qa/${token}` });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  // 7. Illegal transition → 409 illegal_transition
  it('returns 409 illegal_transition when action is invalid for current request status', async () => {
    const { approverMember, request } = await setupQAFixture();
    // Move the request to approved status first
    await prisma.request.update({ where: { id: request.id }, data: { status: 'approved' } });

    // Create a fresh token (can't reuse a previously consumed one)
    const token = signQuickAction({
      requestId: request.id,
      action: 'approve',
      approverId: approverMember.id,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: `/api/qa/${token}` });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'illegal_transition' });
    } finally {
      await app.close();
    }
  });
});
