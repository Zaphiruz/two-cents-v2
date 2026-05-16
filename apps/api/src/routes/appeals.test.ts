/**
 * appeals.test.ts — route-level tests for Appeals API (Phase 5)
 *
 * Tests:
 *   POST /api/appeals
 *     1. 401 without session
 *     2. 400 (Zod) with invalid body (missing justification)
 *     3. 403 not_in_household
 *     4. 404 when request doesn't exist
 *     5. 403 not_buyer (filing on someone else's request)
 *     6. 409 when request is not denied (try pending)
 *     7. 422 quota exceeded (3rd appeal exceeds default quota of 2)
 *     8. 201 success — Appeal row created with correct fields
 *   GET /api/appeals/queue
 *     9.  401 without session
 *    10.  200 empty array when user not in any household
 *    11.  200 returns pending appeals for buyer where caller is approver
 *   12a.  200 does not return resolved appeals (upheld)
 *   12b.  200 non-approver sees empty queue
 *   POST /api/appeals/:id/resolve
 *    13. 401 without session
 *    14. 400 (Zod) with bad decision value
 *    15. 404 when appeal doesn't exist
 *    16. 403 not_approver
 *    17. 409 appeal already resolved (upheld)
 *    18. 200 uphold — appeal.status='upheld', resolvedAt set, request.status unchanged
 *    19. 200 overturn — appeal.status='overturned', resolvedAt set, request.status='pending'
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { createMembers, createRequest } from '../test-helpers/fixtures.js';
import { buildTestApp } from '../test-helpers/session.js';

// ── POST /api/appeals ─────────────────────────────────────────────────────────

describe('POST /api/appeals', () => {
  // 1. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        payload: { requestId: 1, justification: 'I need it!' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 2. 400 (Zod) with invalid body
  it('returns 400 with invalid body (missing justification)', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId: 1 },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  // 3. 403 not_in_household
  it('returns 403 when user is not in any household', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'appeal-no-household', name: 'Homeless' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId: 1, justification: 'I need it!' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'not_in_household' });
    } finally {
      await app.close();
    }
  });

  // 4. 404 when request doesn't exist
  it('returns 404 when request does not exist', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId: 999999, justification: 'I need it!' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  // 5. 403 not_buyer (filing on someone else's request)
  it('returns 403 when user is not the buyer of the request', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });

    // Create a different user in a different household
    const otherHousehold = await prisma.household.create({ data: { name: 'OtherHH-Appeal' } });
    const otherUser = await prisma.user.create({
      data: { oidcSubject: 'appeal-other-user', name: 'Other User' },
    });
    await prisma.householdMember.create({
      data: { householdId: otherHousehold.id, userId: otherUser.id },
    });

    const { app, sessionCookie } = await buildTestApp(otherUser.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId, justification: 'I want to appeal this.' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'not_buyer' });
    } finally {
      await app.close();
    }
  });

  // 6. 409 when request is not in 'denied' status (pending)
  it('returns 409 when request is not in denied status', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'pending' });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId, justification: 'Please reconsider!' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'not_appealable' });
    } finally {
      await app.close();
    }
  });

  // 7. 422 quota exceeded — file 2 appeals (default quota=2/quarterly), then 3rd fails
  it('returns 422 when quota is exceeded', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });

    // Set appealQuotaCount to 1 so the 2nd appeal triggers quota exceeded
    await prisma.household.update({
      where: { id: householdId },
      data: { appealQuotaCount: 1 },
    });

    const { id: req1 } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });
    const { id: req2 } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });

    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      // File first appeal — should succeed (201)
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId: req1, justification: 'First appeal' },
      });
      expect(res1.statusCode).toBe(201);

      // File second appeal on same quota period — should hit quota exceeded (422)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId: req2, justification: 'Second appeal' },
      });
      expect(res2.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });

  // 8. 201 success — Appeal row created with correct fields
  it('returns 201 and creates an Appeal row with correct fields', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });

    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals',
        headers: { cookie: sessionCookie },
        payload: { requestId, justification: 'I genuinely need this for work.' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeTypeOf('number');
      expect(body.requestId).toBe(requestId);
      expect(body.buyerId).toBe(buyer.id);
      expect(body.justification).toBe('I genuinely need this for work.');
      expect(body.status).toBe('pending');
      expect(body.resolvedAt).toBeNull();

      // Verify Appeal row in DB
      const dbAppeal = await prisma.appeal.findUniqueOrThrow({ where: { id: body.id } });
      expect(dbAppeal.requestId).toBe(requestId);
      expect(dbAppeal.buyerId).toBe(buyer.id);
      expect(dbAppeal.justification).toBe('I genuinely need this for work.');
      expect(dbAppeal.status).toBe('pending');
    } finally {
      await app.close();
    }
  });
});

// ── GET /api/appeals/queue ────────────────────────────────────────────────────

describe('GET /api/appeals/queue', () => {
  // 9. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/appeals/queue' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 10. 200 empty array when user not in any household
  it('returns empty appeals array when user is not in any household', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'queue-no-household', name: 'No Household Queue' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/appeals/queue',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appeals).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // 11. 200 returns pending appeals for buyer where caller is approver
  it('returns pending appeals where caller is an approver of the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });

    // Directly create the appeal in the DB (bypassing the route quota)
    const appeal = await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Queue test appeal',
        periodKey: '2026-Q2',
        status: 'pending',
      },
    });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/appeals/queue',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appeals).toHaveLength(1);
      expect(body.appeals[0].id).toBe(appeal.id);
      expect(body.appeals[0].status).toBe('pending');
      // Includes embedded request + buyer.user
      expect(body.appeals[0].request).toBeDefined();
      expect(body.appeals[0].buyer.user.name).toBe('Buyer');
    } finally {
      await app.close();
    }
  });

  // 12a. GET /api/appeals/queue does not return resolved appeals
  it('does not return resolved appeals', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });

    // Create an upheld (resolved) appeal — should not show in queue
    await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Already resolved',
        periodKey: '2026-Q2',
        status: 'upheld',
        resolvedAt: new Date(),
      },
    });

    // Approver should see empty queue (no pending appeals)
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/appeals/queue',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().appeals).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  // 12b. GET /api/appeals/queue returns empty array for non-approver
  it('returns empty array for non-approver', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });

    // Create a pending appeal — but we'll check as the buyer (not an approver of themselves)
    await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Non-approver test',
        periodKey: '2026-Q2',
        status: 'pending',
      },
    });

    // The buyer themselves is not an approver of their own appeals — should see empty
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/appeals/queue',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().appeals).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

// ── POST /api/appeals/:id/resolve ─────────────────────────────────────────────

describe('POST /api/appeals/:id/resolve', () => {
  // 13. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals/1/resolve',
        payload: { decision: 'uphold' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 14. 400 (Zod) with bad decision value
  it('returns 400 with an invalid decision value', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });
    const appeal = await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Test',
        periodKey: '2026-Q2',
        status: 'pending',
      },
    });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'dismiss' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  // 15. 404 when appeal doesn't exist
  it('returns 404 when appeal does not exist', async () => {
    const { approver } = await createMembers();
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/appeals/999999/resolve',
        headers: { cookie: sessionCookie },
        payload: { decision: 'uphold' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  // 16. 403 not_approver
  it('returns 403 when caller is not an approver of the appeal buyer', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });
    const appeal = await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Test',
        periodKey: '2026-Q2',
        status: 'pending',
      },
    });

    // Create an unrelated user who is NOT an approver of buyer
    const otherHousehold = await prisma.household.create({ data: { name: 'OtherHH-Resolve' } });
    const otherUser = await prisma.user.create({
      data: { oidcSubject: 'resolve-non-approver', name: 'Not Approver' },
    });
    await prisma.householdMember.create({
      data: { householdId: otherHousehold.id, userId: otherUser.id },
    });

    const { app, sessionCookie } = await buildTestApp(otherUser.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'uphold' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'not_approver' });
    } finally {
      await app.close();
    }
  });

  // 17. 409 appeal already resolved (status='upheld')
  it('returns 409 when appeal has already been resolved', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });
    const appeal = await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Already resolved',
        periodKey: '2026-Q2',
        status: 'upheld',
        resolvedAt: new Date(),
      },
    });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'uphold' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'appeal_not_pending' });
    } finally {
      await app.close();
    }
  });

  // 18. 200 uphold — appeal.status='upheld', resolvedAt set, request.status unchanged
  it('upholds an appeal: sets status to upheld, resolvedAt set, request status unchanged', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });
    const appeal = await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Please reconsider',
        periodKey: '2026-Q2',
        status: 'pending',
      },
    });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'uphold' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(appeal.id);
      expect(body.status).toBe('upheld');
      expect(body.resolvedAt).not.toBeNull();

      // Verify DB: appeal upheld
      const dbAppeal = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
      expect(dbAppeal.status).toBe('upheld');
      expect(dbAppeal.resolvedAt).not.toBeNull();

      // Request status must remain 'denied' (uphold = denial stands)
      const dbRequest = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
      expect(dbRequest.status).toBe('denied');
    } finally {
      await app.close();
    }
  });

  // 19. 200 overturn — appeal.status='overturned', resolvedAt set, request.status='pending'
  it('overturns an appeal: sets status to overturned, resolvedAt set, request moves to pending', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, status: 'denied' });
    const appeal = await prisma.appeal.create({
      data: {
        requestId,
        buyerId: buyer.id,
        justification: 'Overturning this one',
        periodKey: '2026-Q2',
        status: 'pending',
      },
    });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'overturn' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(appeal.id);
      expect(body.status).toBe('overturned');
      expect(body.resolvedAt).not.toBeNull();

      // Verify DB: appeal overturned
      const dbAppeal = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
      expect(dbAppeal.status).toBe('overturned');
      expect(dbAppeal.resolvedAt).not.toBeNull();

      // Request status must move from 'denied' → 'pending' via appeal_overturned transition
      const dbRequest = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
      expect(dbRequest.status).toBe('pending');
    } finally {
      await app.close();
    }
  });
});
