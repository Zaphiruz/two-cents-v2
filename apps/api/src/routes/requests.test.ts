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
 *   PATCH /api/requests/:id
 *    18. 401 without session
 *    19. 404 for missing request
 *    20. 403 if caller is not the buyer
 *    21. 200 trivial edit (no meaningful change, status stays pending)
 *    22. 200 meaningful edit (price change → wasMeaningful=true, status resets to pending)
 *    23. 409 if request is in non-editable status (approved)
 *   POST /api/requests/:id/act
 *    24. 401 without session
 *    25. 403 if caller is not an approver
 *    26. 200 approve — creates Review, status → approved
 *    27. 200 deny — creates Review, status → denied
 *    28. 200 delay — creates Review, status → delayed
 *    29. 409 if request is not in actable status (already approved)
 *   POST /api/requests/:id/cancel
 *    30. 403 if caller is not the buyer
 *    31. 200 happy path — status → cancelled
 *    32. 409 if status doesn't allow cancel (purchased)
 *   POST /api/requests/:id/reconfirm
 *    33. 403 if caller is not the buyer
 *    34. 200 happy path (awaiting_reconfirm → pending)
 *    35. 409 if status doesn't allow reconfirm (pending)
 *   POST /api/requests/:id/purchase
 *    36. 403 if caller is not the buyer
 *    37. 200 happy path — status → purchased
 *    38. 409 if status doesn't allow purchase (pending)
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { createMembers, createRequest } from '../test-helpers/fixtures.js';
import { buildTestApp } from '../test-helpers/session.js';

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

// ── PATCH /api/requests/:id ───────────────────────────────────────────────────

describe('PATCH /api/requests/:id', () => {
  // 18. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/requests/1',
        payload: { itemsPayload: [{ title: 'x', url: 'https://x.com', priceCents: 100 }] },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  // 19. 404 for missing request
  it('returns 404 for nonexistent request id', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/requests/999999',
        headers: { cookie: sessionCookie },
        payload: { itemsPayload: [{ title: 'x', url: 'https://x.com', priceCents: 100 }] },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  // 20. 403 if caller is not the buyer
  it('returns 403 if caller is not the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
        payload: { itemsPayload: [{ title: 'x', url: 'https://x.com', priceCents: 100 }] },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  // 21. 200 trivial edit (title change only — no meaningful change, status stays)
  it('returns 200 with wasMeaningful=false for a trivial edit', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      title: 'Original',
      url: 'https://example.com',
      priceCents: 1000,
    });

    // Fetch existing item id
    const items = await prisma.requestItem.findMany({ where: { requestId } });
    const itemId = items[0]!.id;

    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
        payload: {
          bundleChanges: { title: 'Updated Title' },
          itemsPayload: [{ id: itemId, title: 'Updated', url: 'https://example.com', priceCents: 1000 }],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.wasMeaningful).toBe(false);
      expect(body.requestId).toBe(requestId);
    } finally {
      await app.close();
    }
  });

  // 22. 200 meaningful edit (price change → wasMeaningful=true, status reset to pending)
  it('returns 200 with wasMeaningful=true and resets status on price change', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    // Use delayed status (meaningful edit from delayed → pending is allowed)
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'delayed',
      priceCents: 1000,
    });

    const items = await prisma.requestItem.findMany({ where: { requestId } });
    const itemId = items[0]!.id;

    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
        payload: {
          bundleChanges: {},
          itemsPayload: [{ id: itemId, title: 'Item', url: 'https://example.com', priceCents: 9999 }],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.wasMeaningful).toBe(true);

      // Verify status reset to pending in DB
      const dbReq = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
      expect(dbReq.status).toBe('pending');
    } finally {
      await app.close();
    }
  });

  // 23. 409 if request is in non-editable status (approved — edit_meaningful not in ALLOWED)
  it('returns 409 if trying meaningful edit on approved request', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'approved',
      priceCents: 1000,
    });

    const items = await prisma.requestItem.findMany({ where: { requestId } });
    const itemId = items[0]!.id;

    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/requests/${requestId}`,
        headers: { cookie: sessionCookie },
        payload: {
          bundleChanges: {},
          itemsPayload: [{ id: itemId, title: 'Item', url: 'https://example.com', priceCents: 5000 }],
        },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});

// ── POST /api/requests/:id/act ────────────────────────────────────────────────

describe('POST /api/requests/:id/act', () => {
  // 24. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests/1/act',
        payload: { action: 'approve', approverSeriousness: 'need' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  // 25. 403 if caller is not an approver
  it('returns 403 if caller is the buyer (not an approver)', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/act`,
        headers: { cookie: sessionCookie },
        payload: { action: 'approve', approverSeriousness: 'need' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  // 26. 200 approve — creates Review, status → approved
  it('returns 200 and transitions to approved on approve action', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/act`,
        headers: { cookie: sessionCookie },
        payload: { action: 'approve', approverSeriousness: 'need' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('approved');

      // Verify Review created
      const review = await prisma.review.findFirst({ where: { requestId } });
      expect(review).not.toBeNull();
      expect(review!.action).toBe('approve');
      expect(review!.approverId).toBe(approver.id);
    } finally {
      await app.close();
    }
  });

  // 27. 200 deny — creates Review, status → denied
  it('returns 200 and transitions to denied on deny action', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/act`,
        headers: { cookie: sessionCookie },
        payload: { action: 'deny', approverSeriousness: 'really_want' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('denied');

      const review = await prisma.review.findFirst({ where: { requestId } });
      expect(review).not.toBeNull();
      expect(review!.action).toBe('deny');
    } finally {
      await app.close();
    }
  });

  // 28. 200 delay — creates Review with delayDays, status → delayed
  it('returns 200 and transitions to delayed on delay action', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/act`,
        headers: { cookie: sessionCookie },
        payload: { action: 'delay', approverSeriousness: 'nice_to_have', delayOverrideDays: 14 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('delayed');

      const review = await prisma.review.findFirst({ where: { requestId } });
      expect(review).not.toBeNull();
      expect(review!.action).toBe('delay');
      expect(review!.delayDays).toBe(14);
    } finally {
      await app.close();
    }
  });

  // 29. 409 if request is not in actable status (already approved)
  it('returns 409 if trying to act on an already-approved request', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'approved',
    });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/act`,
        headers: { cookie: sessionCookie },
        payload: { action: 'approve', approverSeriousness: 'need' },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  // 30. notes field is persisted to the Review row
  it('persists approver notes to the Review row', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/act`,
        headers: { cookie: sessionCookie },
        payload: {
          action: 'approve',
          approverSeriousness: 'need',
          notes: 'looks great, go ahead',
        },
      });
      expect(res.statusCode).toBe(200);

      const review = await prisma.review.findFirstOrThrow({ where: { requestId } });
      expect(review.notes).toBe('looks great, go ahead');
    } finally {
      await app.close();
    }
  });
});

// ── POST /api/requests/:id/cancel ─────────────────────────────────────────────

describe('POST /api/requests/:id/cancel', () => {
  // 30. 403 if caller is not the buyer
  it('returns 403 if caller is not the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/cancel`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  // 31. 200 happy path — status → cancelled
  it('returns 200 and transitions to cancelled', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/cancel`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
    } finally {
      await app.close();
    }
  });

  // 32. 409 if status doesn't allow cancel (purchased)
  it('returns 409 if status does not allow cancel (purchased)', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'purchased',
    });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/cancel`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});

// ── POST /api/requests/:id/reconfirm ──────────────────────────────────────────

describe('POST /api/requests/:id/reconfirm', () => {
  // 33. 403 if caller is not the buyer
  it('returns 403 if caller is not the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'awaiting_reconfirm',
    });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/reconfirm`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  // 34. 200 happy path (awaiting_reconfirm → pending)
  it('returns 200 and transitions from awaiting_reconfirm to pending', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'awaiting_reconfirm',
    });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/reconfirm`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('pending');
    } finally {
      await app.close();
    }
  });

  // 35. 409 if status doesn't allow reconfirm (pending)
  it('returns 409 if status does not allow reconfirm (pending)', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'pending',
    });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/reconfirm`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});

// ── POST /api/requests/:id/purchase ───────────────────────────────────────────

describe('POST /api/requests/:id/purchase', () => {
  // 36. 403 if caller is not the buyer
  it('returns 403 if caller is not the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'approved',
    });
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(approverUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/purchase`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  // 37. 200 happy path — status → purchased
  it('returns 200 and transitions from approved to purchased', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'approved',
    });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/purchase`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('purchased');
    } finally {
      await app.close();
    }
  });

  // 38. 409 if status doesn't allow purchase (pending)
  it('returns 409 if status does not allow purchase (pending)', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({
      householdId,
      buyerId: buyer.id,
      status: 'pending',
    });
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/purchase`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});
