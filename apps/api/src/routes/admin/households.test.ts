import { describe, it, expect } from 'vitest';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'a', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

describe('GET /api/admin/households', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'u', name: 'U', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/households',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns households with member counts', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'A House', appealQuotaCount: 2, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'x', name: 'X', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: u.id, householdId: h.id, approvalMode: 'any' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/households',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.households).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: h.id,
            name: 'A House',
            appealQuotaCount: 2,
            appealQuotaPeriod: 'monthly',
            memberCount: 1,
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /api/admin/households/:id', () => {
  it('updates name, quota count, and period', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'Old', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/households/${h.id}`,
        headers: { cookie: sessionCookie },
        payload: { name: 'New', appealQuotaCount: 5, appealQuotaPeriod: 'quarterly' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().household).toMatchObject({
        name: 'New',
        appealQuotaCount: 5,
        appealQuotaPeriod: 'quarterly',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 400 when no fields supplied', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'X', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/households/${h.id}`,
        headers: { cookie: sessionCookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 404 for unknown id', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/households/99999',
        headers: { cookie: sessionCookie },
        payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
