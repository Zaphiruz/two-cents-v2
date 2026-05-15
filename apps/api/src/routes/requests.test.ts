/**
 * requests.test.ts — route-level tests for /api/requests/*
 *
 * Tests:
 *   GET /api/requests
 *     1. 401 without session
 *     2. 200 + empty queues when user not in a household
 *     3. 200 with myActive populated (buyer has open requests)
 *     4. 200 with incoming populated (caller is approver)
 *   POST /api/requests
 *     5. 401 without session
 *     6. 400 with invalid body (missing items)
 *     7. 403 when user not in any household
 *     8. 400 when buyer has no approvers configured
 *     9. 201 with valid body — request + items created, status=pending
 *    10. 201 with multiple items — all items persisted in order
 *   GET /api/requests/:id
 *    11. 401 without session
 *    12. 400 with non-numeric :id
 *    13. 404 when request id doesn't exist
 *    14. 403 when caller is from a different household (no canView)
 *    15. 200 with full payload when caller is buyer
 *    16. 200 when caller is an approver of the buyer
 *    17. appealsRemaining included in detail response
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { createMembers, createRequest } from '../test-helpers/fixtures.js';

// ── Session injection helper ───────────────────────────────────────────────────
//
// Mirrors the pattern from auth.test.ts: build an app with a test-only route
// that writes req.session.userId, then capture the Set-Cookie header.

async function buildTestApp(userId: number): Promise<{
  app: FastifyInstance;
  sessionCookie: string;
}> {
  const app = await buildApp();

  app.get('/__set_session', async (req, reply) => {
    req.session.userId = userId;
    await req.session.save();
    reply.send({ ok: true });
  });

  const res = await app.inject({ method: 'GET', url: '/__set_session' });
  const setCookie = res.headers['set-cookie'];
  const sessionCookie = Array.isArray(setCookie)
    ? setCookie[0]!
    : (setCookie as string);

  return { app, sessionCookie };
}

// ── GET /api/requests ─────────────────────────────────────────────────────────

describe('GET /api/requests', () => {
  // 1. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/requests' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 2. 200 + empty queues when user has no household membership
  it('returns empty queues when user is not in any household', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'no-household-user', name: 'No Household' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.incoming).toEqual([]);
      expect(body.myActive).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // 3. 200 with myActive populated (buyer has open requests)
  it('returns myActive with open requests when caller is buyer', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });

    // Create a pending request for the buyer
    await createRequest({ householdId, buyerId: buyer.id, title: 'Headphones' });

    // Create a cancelled request — should NOT appear in myActive
    await createRequest({
      householdId,
      buyerId: buyer.id,
      title: 'Cancelled headphones',
      status: 'cancelled',
    });

    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.myActive).toHaveLength(1);
      expect(body.myActive[0].title).toBe('Headphones');
      expect(body.incoming).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // 4. 200 with incoming populated (caller is approver of another buyer)
  it('returns incoming when caller is an approver with pending requests', async () => {
    const { buyer, approver, householdId } = await createMembers();
    // Wire the approver link
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });

    // Create a pending request from the buyer
    await createRequest({ householdId, buyerId: buyer.id, title: 'Sneakers' });

    // Create an approved request — should NOT appear in incoming (only pending)
    await createRequest({
      householdId,
      buyerId: buyer.id,
      title: 'Old sneakers',
      status: 'approved',
    });

    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.incoming).toHaveLength(1);
      expect(body.incoming[0].title).toBe('Sneakers');
      // incoming items include buyer info (the web app needs to show whose request it is)
      expect(body.incoming[0].buyer).toBeDefined();
      expect(body.incoming[0].buyer.user.name).toBeDefined();
      // Approver's own myActive is empty (they haven't filed any requests)
      expect(body.myActive).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

// ── POST /api/requests ────────────────────────────────────────────────────────

describe('POST /api/requests', () => {
  const validBody = {
    title: 'New Keyboard',
    description: 'For coding',
    buyerSeriousness: 'need',
    currency: 'USD',
    items: [
      {
        title: 'Keychron Q1',
        url: 'https://keychron.com/q1',
        priceCents: 17900,
        notes: 'TKL layout',
        imageKey: '',
      },
    ],
  };

  // 5. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests',
        payload: validBody,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 6. 400 with invalid body (missing items array)
  it('returns 400 with invalid body (empty items array)', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
        payload: { ...validBody, items: [] }, // violates min(1)
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  // 7. 403 when user not in any household
  it('returns 403 when user has no household membership', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'no-hh-post-user', name: 'No HH' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
        payload: validBody,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'not_in_household' });
    } finally {
      await app.close();
    }
  });

  // 8. 400 when buyer has no approvers configured
  it('returns 400 when buyer has no approvers configured', async () => {
    const { buyer } = await createMembers();
    // createMembers does NOT create a buyerApprover link — buyer has zero approvers
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
        payload: validBody,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'no_approvers' });
    } finally {
      await app.close();
    }
  });

  // 9. 201 with valid body — request + items created, status=pending, buyer correct
  it('creates a request with items and returns 201 with new id', async () => {
    const { buyer, approver, householdId } = await createMembers();
    // Wire an approver so the guard passes
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
        payload: validBody,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeTypeOf('number');

      // Verify request in DB
      const dbRequest = await prisma.request.findUniqueOrThrow({
        where: { id: body.id },
        include: { items: true },
      });
      expect(dbRequest.status).toBe('pending');
      expect(dbRequest.buyerId).toBe(buyer.id);
      expect(dbRequest.householdId).toBe(householdId);
      expect(dbRequest.title).toBe('New Keyboard');
      expect(dbRequest.buyerSeriousness).toBe('need');
      expect(dbRequest.items).toHaveLength(1);
      expect(dbRequest.items[0]!.title).toBe('Keychron Q1');
      expect(dbRequest.items[0]!.priceCents).toBe(17900);
    } finally {
      await app.close();
    }
  });

  // 10. 201 with multiple items — all items persisted in order
  it('creates multiple items with correct positions', async () => {
    const { buyer, approver } = await createMembers();
    // Wire an approver so the guard passes
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const multiItemBody = {
        ...validBody,
        items: [
          { title: 'Item A', url: 'https://a.example', priceCents: 1000, notes: '', imageKey: '' },
          { title: 'Item B', url: 'https://b.example', priceCents: 2000, notes: '', imageKey: '' },
          { title: 'Item C', url: 'https://c.example', priceCents: 3000, notes: '', imageKey: '' },
        ],
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { cookie: sessionCookie },
        payload: multiItemBody,
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json();

      const items = await prisma.requestItem.findMany({
        where: { requestId: id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      expect(items).toHaveLength(3);
      expect(items[0]!.title).toBe('Item A');
      expect(items[0]!.position).toBe(0);
      expect(items[1]!.title).toBe('Item B');
      expect(items[1]!.position).toBe(1);
      expect(items[2]!.title).toBe('Item C');
      expect(items[2]!.position).toBe(2);
    } finally {
      await app.close();
    }
  });
});

// ── GET /api/requests/:id ─────────────────────────────────────────────────────

describe('GET /api/requests/:id', () => {
  // 10. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/requests/1' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  // 11. 400 with non-numeric :id
  it('returns 400 for non-numeric id', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/requests/abc',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_id' });
    } finally {
      await app.close();
    }
  });

  // 12. 404 when request id doesn't exist
  it('returns 404 for nonexistent request id', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/requests/999999',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  // 13. 403 for user in a different household (no canView)
  it('returns 403 when caller cannot view the request', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    // A completely unrelated user (different household)
    const otherHousehold = await prisma.household.create({ data: { name: 'OtherHH' } });
    const otherUser = await prisma.user.create({
      data: { oidcSubject: 'other-hh-user', name: 'Stranger' },
    });
    await prisma.householdMember.create({
      data: { householdId: otherHousehold.id, userId: otherUser.id },
    });

    const { app, sessionCookie } = await buildTestApp(otherUser.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  // 14. 200 with full payload when caller is buyer
  it('returns full request payload for the buyer', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id, title: 'Laptop' });

    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Top-level shape
      expect(body.request).toBeDefined();
      expect(body.appealsRemaining).toBeTypeOf('number');

      // Request fields
      expect(body.request.id).toBe(requestId);
      expect(body.request.title).toBe('Laptop');
      expect(body.request.items).toHaveLength(1);
      expect(body.request.reviews).toEqual([]);
      expect(body.request.comments).toEqual([]);
      expect(body.request.buyer).toBeDefined();
      expect(body.request.buyer.user.name).toBeDefined();
      expect(body.request.buyer.household).toBeDefined();

      // No sensitive fields leaked
      expect(body.request.buyer.user.oidcSubject).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  // 15. 200 when caller is an approver of the buyer
  it('returns 200 for an approver of the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().request.id).toBe(requestId);
    } finally {
      await app.close();
    }
  });

  // 16. appealsRemaining is included and reflects quota
  it('appealsRemaining is present and equals household quota when no appeals filed', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    // Set up a denied request (classic scenario for appealing)
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'denied',
    });

    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Default household quota is 2 appeals per quarter
      expect(body.appealsRemaining).toBe(2);
    } finally {
      await app.close();
    }
  });
});
