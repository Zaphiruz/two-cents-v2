import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

describe('admin requireAdmin gate', () => {
  it('returns 401 without session on a placeholder admin route', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  it('returns 403 for non-admin session', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'non-admin', name: 'Joe', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('returns 200 for admin session and allows admin route access', async () => {
    const admin = await prisma.user.create({
      data: { oidcSubject: 'admin-1', name: 'Admin', isAdmin: true },
    });
    const { app, sessionCookie } = await buildTestApp(admin.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ users: expect.any(Array) });
    } finally {
      await app.close();
    }
  });
});
