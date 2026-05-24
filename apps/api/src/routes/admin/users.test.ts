import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

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
