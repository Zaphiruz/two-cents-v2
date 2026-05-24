import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'a', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

async function seedHouseholdWithAppeal() {
  const h = await prisma.household.create({
    data: { name: 'H', appealQuotaCount: 5, appealQuotaPeriod: 'monthly' },
  });
  const u = await prisma.user.create({
    data: { oidcSubject: 'b', name: 'Buyer', isAdmin: false },
  });
  const m = await prisma.householdMember.create({
    data: { userId: u.id, householdId: h.id, approvalMode: 'any' },
  });
  const r = await prisma.request.create({
    data: {
      householdId: h.id,
      buyerId: m.id,
      title: 'Disputed buy',
      buyerSeriousness: 'need',
      status: 'denied',
      items: {
        create: {
          title: 'Disputed buy',
          url: 'https://example.com',
          priceCents: 1000,
        },
      },
    },
  });
  const a = await prisma.appeal.create({
    data: {
      requestId: r.id,
      buyerId: m.id,
      status: 'pending',
      periodKey: '2026-05',
      justification: 'because',
    },
  });
  return { household: h, request: r, appeal: a };
}

describe('GET /api/admin/appeals', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'u', name: 'U', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/appeals',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('lists cross-household appeals with request title and buyer name', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal } = await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/appeals',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appeals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: appeal.id,
            status: 'pending',
            requestTitle: 'Disputed buy',
            buyerName: 'Buyer',
            householdName: 'H',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('filters by status', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/appeals?status=upheld',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.appeals).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
