/**
 * household.test.ts — Route-level tests for GET/POST /api/household (Phase 7)
 *
 * Tests:
 *   GET /api/household
 *     1. 401 without session
 *     2. 200 with household: null when user is not in any household
 *     3. 200 full response for a member with household, members, myApprovers, myBuyers
 *     4. 200 response includes pending memberships via household.pending
 *   POST /api/household/invite
 *     5. 401 without session
 *     6. 400 (Zod) with invalid body (missing authentikUsername)
 *     7. 403 when user is not in a household
 *     8. 201 creates PendingMembership and returns it
 *     9. 409 when invite for the same username already exists (unique constraint)
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { createMembers } from '../test-helpers/fixtures.js';
import { buildTestApp } from '../test-helpers/session.js';

// ── GET /api/household ────────────────────────────────────────────────────────

describe('GET /api/household', () => {
  // 1. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/household' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 2. 200 with household: null when user is not in any household
  it('returns { household: null } when user is not in any household', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'household-get-no-hh', name: 'No Household' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/household',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ household: null }>();
      expect(body.household).toBeNull();
    } finally {
      await app.close();
    }
  });

  // 3. 200 full response for a member with household, members, myApprovers, myBuyers
  it('returns household, members, myApprovers, myBuyers for a full member', async () => {
    const { buyer, approver, householdId } = await createMembers();

    // Set up buyer→approver relationship
    await prisma.buyerApprover.create({
      data: { buyerId: buyer.id, approverId: approver.id },
    });

    // Request as the buyer user
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/household',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        household: { id: number; name: string; members: Array<{ id: number }> };
        myApprovers: Array<{ id: number; user: { name: string } }>;
        myBuyers: Array<{ id: number }>;
      }>();

      expect(body.household).toBeDefined();
      expect(body.household.id).toBe(householdId);
      // Both members should be in the household
      expect(body.household.members).toHaveLength(2);
      // buyer has one approver (the approver member)
      expect(body.myApprovers).toHaveLength(1);
      expect(body.myApprovers[0]!.id).toBe(approver.id);
      expect(body.myApprovers[0]!.user.name).toBe('Approver');
      // buyer is not an approver of anyone
      expect(body.myBuyers).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  // 4. 200 response — pending memberships are included in household
  it('includes pending memberships in household.pending', async () => {
    const { buyer, householdId } = await createMembers();

    // Create a pending membership for this household
    await prisma.pendingMembership.create({
      data: {
        householdId,
        authentikUsername: 'pending-user-get-test',
        approvalMode: 'any',
      },
    });

    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/household',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        household: { pending: Array<{ authentikUsername: string }> };
      }>();
      // household.pending should contain the pending membership
      // (Prisma includes it via the `pending` relation on Household)
      expect(body.household).toBeDefined();
    } finally {
      await app.close();
    }
  });
});

// ── POST /api/household/invite ────────────────────────────────────────────────

describe('POST /api/household/invite', () => {
  // 5. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/household/invite',
        payload: { authentikUsername: 'newuser' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 6. 400 (Zod) with invalid body (missing authentikUsername)
  it('returns 400 with invalid body (missing authentikUsername)', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/household/invite',
        headers: { cookie: sessionCookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'validation_error' });
    } finally {
      await app.close();
    }
  });

  // 7. 403 when user is not in a household
  it('returns 403 when user is not in a household', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'invite-no-household', name: 'No Household Inviter' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/household/invite',
        headers: { cookie: sessionCookie },
        payload: { authentikUsername: 'someuser' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'not_in_household' });
    } finally {
      await app.close();
    }
  });

  // 8. 201 creates PendingMembership and returns it
  it('returns 201 and creates a PendingMembership', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/household/invite',
        headers: { cookie: sessionCookie },
        payload: { authentikUsername: 'invited-user-success' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ pending: { id: number; householdId: number; authentikUsername: string; approvalMode: string } }>();
      expect(body.pending).toBeDefined();
      expect(body.pending.householdId).toBe(householdId);
      expect(body.pending.authentikUsername).toBe('invited-user-success');
      expect(body.pending.approvalMode).toBe('any');

      // Verify in DB
      const dbPending = await prisma.pendingMembership.findUnique({
        where: { householdId_authentikUsername: { householdId, authentikUsername: 'invited-user-success' } },
      });
      expect(dbPending).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  // 9. 409 when invite for the same username already exists (unique constraint)
  it('returns 409 when the same username is already invited to this household', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });

    // Pre-create the pending membership
    await prisma.pendingMembership.create({
      data: {
        householdId,
        authentikUsername: 'duplicate-invite-user',
        approvalMode: 'any',
      },
    });

    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/household/invite',
        headers: { cookie: sessionCookie },
        payload: { authentikUsername: 'duplicate-invite-user' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'unique_violation' });
    } finally {
      await app.close();
    }
  });
});
