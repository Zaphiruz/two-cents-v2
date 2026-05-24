import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';
import { fireEvent } from '../../services/events.js';

vi.mock('../../services/events.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));

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

describe('POST /api/admin/appeals/:id/resolve', () => {
  it('returns 404 for unknown appeal id', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/appeals/99999/resolve',
        headers: { cookie: sessionCookie },
        payload: { decision: 'overturn' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  it('returns 409 if appeal is already resolved', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal } = await seedHouseholdWithAppeal();
      await prisma.appeal.update({
        where: { id: appeal.id },
        data: { status: 'upheld', resolvedAt: new Date() },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'overturn' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'already_resolved' });
    } finally {
      await app.close();
    }
  });

  it('overturns the appeal and transitions request from denied to pending', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal, request } = await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'overturn' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appeal).toMatchObject({ id: appeal.id, status: 'overturned' });
      expect(body.appeal.resolvedAt).not.toBeNull();
      const updatedReq = await prisma.request.findUnique({ where: { id: request.id } });
      // appeal_overturned state-machine transition: denied -> pending
      expect(updatedReq?.status).toBe('pending');
    } finally {
      await app.close();
    }
  });

  describe('fires appeal_resolved event', () => {
    beforeEach(() => {
      vi.mocked(fireEvent).mockClear();
    });

    it('fires appeal_resolved with outcome=overturned on overturn', async () => {
      const { app, sessionCookie } = await seedAdmin();
      try {
        const { appeal } = await seedHouseholdWithAppeal();
        const res = await app.inject({
          method: 'POST',
          url: `/api/admin/appeals/${appeal.id}/resolve`,
          headers: { cookie: sessionCookie },
          payload: { decision: 'overturn' },
        });
        expect(res.statusCode).toBe(200);
        expect(fireEvent).toHaveBeenCalledWith(
          expect.anything(),
          'appeal_resolved',
          { appealId: appeal.id, outcome: 'overturned' },
        );
      } finally {
        await app.close();
      }
    });

    it('fires appeal_resolved with outcome=upheld on uphold', async () => {
      const { app, sessionCookie } = await seedAdmin();
      try {
        const { appeal } = await seedHouseholdWithAppeal();
        const res = await app.inject({
          method: 'POST',
          url: `/api/admin/appeals/${appeal.id}/resolve`,
          headers: { cookie: sessionCookie },
          payload: { decision: 'uphold' },
        });
        expect(res.statusCode).toBe(200);
        expect(fireEvent).toHaveBeenCalledWith(
          expect.anything(),
          'appeal_resolved',
          { appealId: appeal.id, outcome: 'upheld' },
        );
      } finally {
        await app.close();
      }
    });
  });

  it('upholds the appeal and leaves request status unchanged (denied)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal, request } = await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'uphold' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().appeal.status).toBe('upheld');
      const updatedReq = await prisma.request.findUnique({ where: { id: request.id } });
      expect(updatedReq?.status).toBe('denied');
    } finally {
      await app.close();
    }
  });
});
