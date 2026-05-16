/**
 * comments.test.ts — route-level tests for POST /api/requests/:id/comments
 *
 * Tests:
 *   1. 401 without session
 *   2. 400 if body is empty (Zod min:1)
 *   3. 404 for nonexistent request id
 *   4. 403 if user cannot view the request (unrelated household)
 *   5. 201 with valid comment as buyer — Comment row created with correct authorId
 *   6. 201 with valid comment as approver — approvers can also comment
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { createMembers, createRequest } from '../test-helpers/fixtures.js';
import { buildTestApp } from '../test-helpers/session.js';

// ── POST /api/requests/:id/comments ──────────────────────────────────────────

describe('POST /api/requests/:id/comments', () => {
  // 1. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests/1/comments',
        payload: { body: 'Hello!' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 2. 400 if body is empty (Zod min:1)
  it('returns 400 if comment body is empty', async () => {
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
        url: `/api/requests/${requestId}/comments`,
        headers: { cookie: sessionCookie },
        payload: { body: '' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  // 3. 404 for nonexistent request id
  it('returns 404 for a nonexistent request', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { app, sessionCookie } = await buildTestApp(buyerUser.userId);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requests/999999/comments',
        headers: { cookie: sessionCookie },
        payload: { body: 'Hello!' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  // 4. 403 if user cannot view the request (unrelated household)
  it('returns 403 if user is not the buyer or an approver', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    // Create a completely unrelated user in a different household
    const otherHousehold = await prisma.household.create({ data: { name: 'OtherHH2' } });
    const otherUser = await prisma.user.create({
      data: { oidcSubject: 'other-commenter', name: 'Stranger' },
    });
    await prisma.householdMember.create({
      data: { householdId: otherHousehold.id, userId: otherUser.id },
    });

    const { app, sessionCookie } = await buildTestApp(otherUser.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requests/${requestId}/comments`,
        headers: { cookie: sessionCookie },
        payload: { body: 'Sneaky comment' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  // 5. 201 with valid comment as buyer — Comment row created with correct authorId (userId)
  it('creates a comment as buyer and returns 201 with comment data', async () => {
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
        url: `/api/requests/${requestId}/comments`,
        headers: { cookie: sessionCookie },
        payload: { body: 'Looks great!' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeTypeOf('number');
      expect(body.body).toBe('Looks great!');
      expect(body.createdAt).toBeDefined();
      expect(body.author).toBeDefined();
      expect(body.author.name).toBe('Buyer');

      // Verify Comment in DB — authorId is the User id (not member id)
      const dbComment = await prisma.comment.findUniqueOrThrow({ where: { id: body.id } });
      expect(dbComment.requestId).toBe(requestId);
      expect(dbComment.authorId).toBe(buyerUser.userId);
      expect(dbComment.body).toBe('Looks great!');
    } finally {
      await app.close();
    }
  });

  // 6. 201 with valid comment as approver — approvers can also comment
  it('allows an approver to post a comment and returns 201', async () => {
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
        url: `/api/requests/${requestId}/comments`,
        headers: { cookie: sessionCookie },
        payload: { body: 'Have you considered the budget?' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.body).toBe('Have you considered the budget?');
      expect(body.author.name).toBe('Approver');

      // Confirm authorId stored as approver's user id
      const dbComment = await prisma.comment.findUniqueOrThrow({ where: { id: body.id } });
      expect(dbComment.authorId).toBe(approverUser.userId);
    } finally {
      await app.close();
    }
  });
});
