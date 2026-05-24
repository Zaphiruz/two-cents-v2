import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'srch-admin', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

async function seedHouseholdWithMember() {
  const household = await prisma.household.create({
    data: { name: 'SrchHouse', appealQuotaCount: 5, appealQuotaPeriod: 'monthly' },
  });
  const user = await prisma.user.create({
    data: { oidcSubject: 'srch-buyer', name: 'Buyer', isAdmin: false },
  });
  const member = await prisma.householdMember.create({
    data: { userId: user.id, householdId: household.id, approvalMode: 'any' },
  });
  return { household, user, member };
}

describe('GET /api/admin/search', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'srch-non', name: 'N', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=x',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when q is missing', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('finds a request by title substring (case-insensitive)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { household, member } = await seedHouseholdWithMember();
      const r = await prisma.request.create({
        data: {
          householdId: household.id,
          buyerId: member.id,
          title: 'New BLENDER for kitchen',
          buyerSeriousness: 'need',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=blender',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const hit = body.results.find((h: { type: string; id: number }) => h.type === 'request' && h.id === r.id);
      expect(hit).toMatchObject({
        type: 'request',
        primary: 'New BLENDER for kitchen',
        userName: 'Buyer',
        householdName: 'SrchHouse',
      });
    } finally {
      await app.close();
    }
  });

  it('finds a comment by body substring', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { household, member, user } = await seedHouseholdWithMember();
      const req = await prisma.request.create({
        data: {
          householdId: household.id,
          buyerId: member.id,
          title: 'X',
          buyerSeriousness: 'need',
        },
      });
      const c = await prisma.comment.create({
        data: { requestId: req.id, authorId: user.id, body: 'this is a SECRET comment' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=secret',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string; id: number }) => h.type === 'comment' && h.id === c.id);
      expect(hit).toMatchObject({ type: 'comment', userName: 'Buyer' });
      expect(hit.primary).toContain('SECRET');
    } finally {
      await app.close();
    }
  });

  it('finds a notification log by eventKey', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { user } = await seedHouseholdWithMember();
      await prisma.notificationLog.create({
        data: { userId: user.id, eventKey: 'request.accepted' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=accepted',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string }) => h.type === 'notificationLog');
      expect(hit).toMatchObject({ primary: 'request.accepted', userName: 'Buyer' });
    } finally {
      await app.close();
    }
  });

  it('finds a push subscription by endpoint', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { user } = await seedHouseholdWithMember();
      await prisma.pushSubscription.create({
        data: { userId: user.id, endpoint: 'https://fcm.googleapis.com/UNIQUE-x123', p256dh: 'p', auth: 'a' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=UNIQUE-x123',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string }) => h.type === 'pushSubscription');
      expect(hit).toMatchObject({ userName: 'Buyer' });
      expect(hit.primary).toContain('UNIQUE-x123');
    } finally {
      await app.close();
    }
  });

  it('finds a consumed jti by exact string (no user)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await prisma.consumedJWTJti.create({ data: { jti: 'jti-abc-12345' } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=abc-123',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string }) => h.type === 'consumedJwtJti');
      expect(hit).toMatchObject({
        type: 'consumedJwtJti',
        id: 'jti-abc-12345',
        primary: 'jti-abc-12345',
        userName: null,
        householdName: null,
      });
    } finally {
      await app.close();
    }
  });

  it('restricts results to one type when type is specified', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { household, member, user } = await seedHouseholdWithMember();
      await prisma.request.create({
        data: { householdId: household.id, buyerId: member.id, title: 'find-me', buyerSeriousness: 'need' },
      });
      await prisma.notificationLog.create({
        data: { userId: user.id, eventKey: 'find-me-too' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=find-me&type=request',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.results.every((h: { type: string }) => h.type === 'request')).toBe(true);
      expect(body.results.length).toBe(1);
    } finally {
      await app.close();
    }
  });
});
