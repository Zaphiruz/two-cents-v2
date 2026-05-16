/**
 * push.test.ts — route-level tests for Push routes (Phase 6a)
 *
 * Tests:
 *   GET /api/push/vapid
 *     1. 200 returns publicKey when VAPID_PUBLIC_KEY env var is set
 *     2. 503 when VAPID_PUBLIC_KEY is not set
 *   POST /api/push/subscribe
 *     3. 401 without session
 *     4. 400 (Zod) with invalid body (missing keys)
 *     5. 201 creates a DB row and returns id
 *     6. 201 idempotent upsert — same endpoint+user returns same id and updates keys
 *     7. 201 upsert with same endpoint but different user updates userId
 *   POST /api/push/unsubscribe
 *     8. 401 without session
 *     9. 400 (Zod) with invalid body (missing endpoint)
 *    10. 204 deletes the subscription row
 *    11. 204 is idempotent when no matching subscription exists
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { buildTestApp } from '../test-helpers/session.js';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-device-001';
const KEYS = { p256dh: 'BPublicKeyBase64', auth: 'authTokenBase64' };

// ── GET /api/push/vapid ────────────────────────────────────────────────────────

describe('GET /api/push/vapid', () => {
  // 1. returns key when env set
  it('returns publicKey when VAPID_PUBLIC_KEY is set', async () => {
    // setup.ts sets VAPID_PUBLIC_KEY
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/push/vapid' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ publicKey: string }>();
      expect(typeof body.publicKey).toBe('string');
      expect(body.publicKey.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  // 2. 503 when env var missing
  it('returns 503 when VAPID_PUBLIC_KEY is not configured', async () => {
    const saved = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/push/vapid' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'push_not_configured' });
    } finally {
      await app.close();
      process.env.VAPID_PUBLIC_KEY = saved;
    }
  });
});

// ── POST /api/push/subscribe ───────────────────────────────────────────────────

describe('POST /api/push/subscribe', () => {
  // 3. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        payload: { endpoint: ENDPOINT, keys: KEYS },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 4. 400 invalid body
  it('returns 400 with invalid body (missing keys)', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'push-sub-bad-body', name: 'Bad Body' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { cookie: sessionCookie },
        payload: { endpoint: ENDPOINT },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  // 5. 201 creates row
  it('returns 201 and creates a PushSubscription row', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'push-sub-create', name: 'Sub Create' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { cookie: sessionCookie },
        payload: { endpoint: ENDPOINT, keys: KEYS },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: number }>();
      expect(typeof body.id).toBe('number');

      const row = await prisma.pushSubscription.findUnique({ where: { endpoint: ENDPOINT } });
      expect(row).not.toBeNull();
      expect(row!.userId).toBe(user.id);
      expect(row!.p256dh).toBe(KEYS.p256dh);
      expect(row!.auth).toBe(KEYS.auth);
    } finally {
      await app.close();
    }
  });

  // 6. idempotent upsert — same endpoint+user
  it('returns 201 and upserts cleanly when same endpoint is re-subscribed', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'push-sub-upsert', name: 'Sub Upsert' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      // First subscribe
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { cookie: sessionCookie },
        payload: { endpoint: ENDPOINT, keys: KEYS },
      });
      expect(res1.statusCode).toBe(201);
      const id1 = res1.json<{ id: number }>().id;

      // Second subscribe with updated keys
      const newKeys = { p256dh: 'BNewPublicKey', auth: 'newAuthToken' };
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { cookie: sessionCookie },
        payload: { endpoint: ENDPOINT, keys: newKeys },
      });
      expect(res2.statusCode).toBe(201);
      const id2 = res2.json<{ id: number }>().id;

      // Same row (same id)
      expect(id2).toBe(id1);

      // Keys updated
      const row = await prisma.pushSubscription.findUnique({ where: { endpoint: ENDPOINT } });
      expect(row!.p256dh).toBe('BNewPublicKey');
      expect(row!.auth).toBe('newAuthToken');

      // Only one row
      const count = await prisma.pushSubscription.count({ where: { userId: user.id } });
      expect(count).toBe(1);
    } finally {
      await app.close();
    }
  });

  // 7. same endpoint, different user — upsert updates userId
  it('updates userId when same endpoint is subscribed by a different user', async () => {
    const user1 = await prisma.user.create({
      data: { oidcSubject: 'push-sub-user1', name: 'User 1' },
    });
    const user2 = await prisma.user.create({
      data: { oidcSubject: 'push-sub-user2', name: 'User 2' },
    });

    const { app: app1, sessionCookie: cookie1 } = await buildTestApp(user1.id);
    const res1 = await app1.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { cookie: cookie1 },
      payload: { endpoint: ENDPOINT, keys: KEYS },
    });
    expect(res1.statusCode).toBe(201);
    await app1.close();

    const { app: app2, sessionCookie: cookie2 } = await buildTestApp(user2.id);
    try {
      const res2 = await app2.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { cookie: cookie2 },
        payload: { endpoint: ENDPOINT, keys: KEYS },
      });
      expect(res2.statusCode).toBe(201);

      const row = await prisma.pushSubscription.findUnique({ where: { endpoint: ENDPOINT } });
      expect(row!.userId).toBe(user2.id);
    } finally {
      await app2.close();
    }
  });
});

// ── POST /api/push/unsubscribe ─────────────────────────────────────────────────

describe('POST /api/push/unsubscribe', () => {
  // 8. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        payload: { endpoint: ENDPOINT },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  // 9. 400 invalid body
  it('returns 400 with invalid body (missing endpoint)', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'push-unsub-bad-body', name: 'Bad Unsub Body' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        headers: { cookie: sessionCookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  // 10. 204 + row deleted
  it('returns 204 and deletes the subscription row', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'push-unsub-delete', name: 'Sub Delete' },
    });
    // Create subscription directly
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: ENDPOINT, p256dh: KEYS.p256dh, auth: KEYS.auth },
    });

    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        headers: { cookie: sessionCookie },
        payload: { endpoint: ENDPOINT },
      });
      expect(res.statusCode).toBe(204);

      const row = await prisma.pushSubscription.findUnique({ where: { endpoint: ENDPOINT } });
      expect(row).toBeNull();
    } finally {
      await app.close();
    }
  });

  // 11. 204 idempotent when not subscribed
  it('returns 204 even when subscription does not exist (idempotent)', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'push-unsub-noop', name: 'No Sub' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        headers: { cookie: sessionCookie },
        payload: { endpoint: 'https://fcm.googleapis.com/fcm/send/nonexistent' },
      });
      expect(res.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });
});
