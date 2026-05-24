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

describe('POST /api/admin/households/:id/members', () => {
  it('adds a user to a household with the given approval mode', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'new', name: 'New', isAdmin: false },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/households/${h.id}/members`,
        headers: { cookie: sessionCookie },
        payload: { userId: u.id, approvalMode: 'all' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().member).toMatchObject({
        userId: u.id,
        householdId: h.id,
        approvalMode: 'all',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 409 if the user is already a member of any household', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h1 = await prisma.household.create({
        data: { name: 'H1', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const h2 = await prisma.household.create({
        data: { name: 'H2', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'dup', name: 'Dup', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: u.id, householdId: h1.id, approvalMode: 'any' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/households/${h2.id}/members`,
        headers: { cookie: sessionCookie },
        payload: { userId: u.id, approvalMode: 'any' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'already_member' });
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /api/admin/household-members/:id', () => {
  it('updates approvalMode', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'u', name: 'U', isAdmin: false },
      });
      const m = await prisma.householdMember.create({
        data: { userId: u.id, householdId: h.id, approvalMode: 'any' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/household-members/${m.id}`,
        headers: { cookie: sessionCookie },
        payload: { approvalMode: 'all' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().member.approvalMode).toBe('all');
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/admin/household-members/:id', () => {
  it('removes the member and cascades buyer-approver rows', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u1 = await prisma.user.create({ data: { oidcSubject: 'd-m1', name: 'A', isAdmin: false } });
      const u2 = await prisma.user.create({ data: { oidcSubject: 'd-m2', name: 'B', isAdmin: false } });
      const m1 = await prisma.householdMember.create({
        data: { userId: u1.id, householdId: h.id, approvalMode: 'any' },
      });
      const m2 = await prisma.householdMember.create({
        data: { userId: u2.id, householdId: h.id, approvalMode: 'any' },
      });
      await prisma.buyerApprover.create({ data: { buyerId: m1.id, approverId: m2.id } });
      await prisma.buyerApprover.create({ data: { buyerId: m2.id, approverId: m1.id } });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/household-members/${m1.id}`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ deleted: 1 });
      const remainingMembers = await prisma.householdMember.count({ where: { id: m1.id } });
      expect(remainingMembers).toBe(0);
      const remainingPairs = await prisma.buyerApprover.count({
        where: { OR: [{ buyerId: m1.id }, { approverId: m1.id }] },
      });
      expect(remainingPairs).toBe(0);
    } finally {
      await app.close();
    }
  });
});
