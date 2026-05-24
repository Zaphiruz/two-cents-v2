import { describe, it, expect, vi } from 'vitest';

// Mock sendPushNotification before importing the route module (hoisted).
vi.mock('../../lib/push.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/push.js')>();
  return {
    ...actual,
    sendPushNotification: vi.fn().mockResolvedValue(undefined),
  };
});

import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';
import { sendPushNotification } from '../../lib/push.js';

const sendPushMock = vi.mocked(sendPushNotification);

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'admin-x', name: 'Admin User', isAdmin: true },
  });
  const session = await buildTestApp(admin.id);
  return { admin, ...session };
}

describe('GET /api/admin/users', () => {
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 for non-admin caller', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'u', name: 'Plain', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('lists all users with household name and isAdmin flag', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const household = await prisma.household.create({
        data: { name: 'The Smiths', appealQuotaCount: 3, appealQuotaPeriod: 'monthly' },
      });
      const userA = await prisma.user.create({
        data: { oidcSubject: 'a', name: 'Alice', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: userA.id, householdId: household.id, approvalMode: 'any' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.users).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Alice', isAdmin: false, householdName: 'The Smiths' }),
          expect.objectContaining({ name: 'Admin User', isAdmin: true, householdName: null }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('filters by isAdmin=true', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await prisma.user.create({ data: { oidcSubject: 'x', name: 'X', isAdmin: false } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users?isAdmin=true',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.users.every((u: { isAdmin: boolean }) => u.isAdmin)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('searches by name (case-insensitive substring)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await prisma.user.create({ data: { oidcSubject: 'g', name: 'Gladis Nevarez', isAdmin: false } });
      await prisma.user.create({ data: { oidcSubject: 'l', name: 'Luke Jones-Thomas', isAdmin: false } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users?q=gladis',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.users).toHaveLength(1);
      expect(body.users[0].name).toBe('Gladis Nevarez');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/admin/users/unassigned', () => {
  it('returns only users with no household memberships', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const household = await prisma.household.create({
        data: { name: 'Casa Libre', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const inHousehold = await prisma.user.create({
        data: { oidcSubject: 'in-h', name: 'In Household', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: inHousehold.id, householdId: household.id, approvalMode: 'any' },
      });
      const freeUser = await prisma.user.create({
        data: { oidcSubject: 'free', name: 'Free Floater', isAdmin: false },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users/unassigned',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.users.map((u: { id: number }) => u.id);
      expect(ids).toContain(freeUser.id);
      expect(ids).not.toContain(inHousehold.id);
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/admin/users/:id/detail', () => {
  it('returns 404 for unknown user id', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users/99999/detail',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  it('returns user profile + household + recent requests/comments/push/log', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const household = await prisma.household.create({
        data: { name: 'Casa', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const user = await prisma.user.create({
        data: { oidcSubject: 'u-detail', name: 'Detail User', isAdmin: false },
      });
      const member = await prisma.householdMember.create({
        data: { userId: user.id, householdId: household.id, approvalMode: 'any' },
      });
      const req1 = await prisma.request.create({
        data: {
          householdId: household.id,
          buyerId: member.id,
          title: 'A request',
          buyerSeriousness: 'need',
          status: 'pending',
        },
      });
      await prisma.comment.create({
        data: { requestId: req1.id, authorId: user.id, body: 'a comment' },
      });
      await prisma.pushSubscription.create({
        data: { userId: user.id, endpoint: 'https://x/1', p256dh: 'p', auth: 'a' },
      });
      await prisma.notificationLog.create({
        data: { userId: user.id, eventKey: 'request.created' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${user.id}/detail`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user).toMatchObject({ id: user.id, name: 'Detail User', isAdmin: false });
      expect(body.household).toMatchObject({ id: household.id, name: 'Casa', approvalMode: 'any' });
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0]).toMatchObject({ title: 'A request' });
      expect(body.comments).toHaveLength(1);
      expect(body.pushSubscriptions).toHaveLength(1);
      expect(body.notificationLogs).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/admin/users/:id/test-push', () => {
  it('returns 404 if user does not exist', async () => {
    sendPushMock.mockReset();
    sendPushMock.mockResolvedValue(undefined);
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/99999/test-push',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
      expect(sendPushMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 200 with delivery counts when user has subscriptions', async () => {
    sendPushMock.mockReset();
    sendPushMock.mockResolvedValue(undefined);
    const { app, sessionCookie } = await seedAdmin();
    try {
      const user = await prisma.user.create({
        data: { oidcSubject: 'push-user', name: 'Push', isAdmin: false },
      });
      await prisma.pushSubscription.createMany({
        data: [
          { userId: user.id, endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' },
          { userId: user.id, endpoint: 'https://push.example/2', p256dh: 'p2', auth: 'a2' },
        ],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${user.id}/test-push`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ sent: 2, failed: 0 });
      expect(sendPushMock).toHaveBeenCalledTimes(2);
      expect(sendPushMock).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: expect.any(String), p256dh: expect.any(String), auth: expect.any(String) }),
        expect.objectContaining({
          title: 'Test push from admin',
          body: 'If you can see this, push delivery is working.',
        }),
      );
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/admin/users/:id/push-subscriptions', () => {
  it('returns 404 for unknown user', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/users/99999/push-subscriptions',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('deletes all push subscriptions for the user and returns count', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const user = await prisma.user.create({
        data: { oidcSubject: 'd', name: 'Del', isAdmin: false },
      });
      await prisma.pushSubscription.createMany({
        data: [
          { userId: user.id, endpoint: 'https://x/1', p256dh: 'p', auth: 'a' },
          { userId: user.id, endpoint: 'https://x/2', p256dh: 'p', auth: 'a' },
        ],
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${user.id}/push-subscriptions`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ deleted: 2 });
      const remaining = await prisma.pushSubscription.count({ where: { userId: user.id } });
      expect(remaining).toBe(0);
    } finally {
      await app.close();
    }
  });
});
