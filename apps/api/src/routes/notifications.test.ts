/**
 * notifications.test.ts — Route-level tests for GET/PUT /api/notifications/preferences (Phase 6b)
 *
 * Tests:
 *   1. GET returns 401 without session
 *   2. GET returns empty preferences for a new user
 *   3. GET returns saved preferences after PUT
 *   4. PUT returns 401 without session
 *   5. PUT returns 400 on invalid body (Zod validation)
 *   6. PUT upserts preferences and returns the full updated list
 *   7. PUT overwrites existing preferences on re-upsert
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { buildTestApp } from '../test-helpers/session.js';

// ── GET /api/notifications/preferences ────────────────────────────────────────

describe('GET /api/notifications/preferences', () => {
  // 1. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/notifications/preferences' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 2. Empty preferences for a new user
  it('returns empty preferences array for a new user', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'notif-get-empty', name: 'Empty User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications/preferences',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ preferences: unknown[] }>();
      expect(body.preferences).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // 3. GET returns saved preferences
  it('returns saved preferences after they have been stored', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'notif-get-saved', name: 'Saved Prefs User' },
    });
    // Pre-create preferences
    await prisma.notificationPreference.createMany({
      data: [
        { userId: user.id, eventType: 'comment', enabled: false },
        { userId: user.id, eventType: 'request_pending', enabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
      ],
    });

    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications/preferences',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ preferences: Array<{ eventType: string; enabled: boolean }> }>();
      expect(body.preferences).toHaveLength(2);
      // Ordered alphabetically by eventType
      expect(body.preferences[0]!.eventType).toBe('comment');
      expect(body.preferences[0]!.enabled).toBe(false);
      expect(body.preferences[1]!.eventType).toBe('request_pending');
      expect(body.preferences[1]!.enabled).toBe(true);
    } finally {
      await app.close();
    }
  });
});

// ── PUT /api/notifications/preferences ────────────────────────────────────────

describe('PUT /api/notifications/preferences', () => {
  // 4. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/notifications/preferences',
        payload: { preferences: [{ eventType: 'comment', enabled: false }] },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  // 5. 400 on invalid body
  it('returns 400 with invalid body (empty preferences array)', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'notif-put-bad-body', name: 'Bad Body User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/notifications/preferences',
        headers: { cookie: sessionCookie },
        payload: { preferences: [] }, // min:1 fails
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'validation_error' });
    } finally {
      await app.close();
    }
  });

  // 6. PUT upserts and returns full list
  it('upserts preferences and returns the full updated list', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'notif-put-upsert', name: 'Upsert User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/notifications/preferences',
        headers: { cookie: sessionCookie },
        payload: {
          preferences: [
            { eventType: 'request_pending', enabled: false },
            { eventType: 'comment', enabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ preferences: Array<{ eventType: string; enabled: boolean; quietHoursStart?: string }> }>();
      expect(body.preferences).toHaveLength(2);

      // Verify DB rows were created
      const rows = await prisma.notificationPreference.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(2);
      const commentPref = rows.find((r: { eventType: string }) => r.eventType === 'comment')!;
      expect(commentPref.quietHoursStart).toBe('22:00');
      expect(commentPref.quietHoursEnd).toBe('07:00');
    } finally {
      await app.close();
    }
  });

  // 7. PUT overwrites existing preferences on re-upsert
  it('overwrites existing preference values on re-upsert', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'notif-put-overwrite', name: 'Overwrite User' },
    });
    // Pre-create a preference
    await prisma.notificationPreference.create({
      data: { userId: user.id, eventType: 'comment', enabled: true, quietHoursStart: '08:00', quietHoursEnd: '18:00' },
    });

    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/notifications/preferences',
        headers: { cookie: sessionCookie },
        payload: {
          preferences: [
            { eventType: 'comment', enabled: false, quietHoursStart: null, quietHoursEnd: null },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      // Verify the DB row was updated
      const pref = await prisma.notificationPreference.findUnique({
        where: { userId_eventType: { userId: user.id, eventType: 'comment' } },
      });
      expect(pref!.enabled).toBe(false);
      expect(pref!.quietHoursStart).toBeNull();
      expect(pref!.quietHoursEnd).toBeNull();
    } finally {
      await app.close();
    }
  });
});
