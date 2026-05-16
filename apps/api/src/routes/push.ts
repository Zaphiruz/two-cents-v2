/**
 * push.ts — Push notification subscription routes (Phase 6a)
 *
 * GET  /api/push/vapid        — returns public VAPID key (or 503 if not configured)
 * POST /api/push/subscribe    — upsert a PushSubscription for the authenticated user
 * POST /api/push/unsubscribe  — remove a PushSubscription for the authenticated user
 *
 * v1 reference: apps/notifications/views.py (subscribe, unsubscribe, vapid_public_key)
 */

import type { FastifyInstance } from 'fastify';
import { authGuard } from '../lib/auth-utils.js';
import { PushSubscribeInputSchema, PushUnsubscribeInputSchema } from '@two-cents/shared';

export default async function pushRoutes(app: FastifyInstance) {
  // ── GET /api/push/vapid ───────────────────────────────────────────────────
  //
  // Returns the VAPID public key so the browser can subscribe.
  // No authentication required — public endpoint.
  // Returns 503 if VAPID is not configured (env var missing).
  //
  // v1 reference: vapid_public_key view → {"key": settings.VAPID_PUBLIC_KEY}

  app.get('/api/push/vapid', async (req, reply) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      reply.code(503).send({ error: 'push_not_configured' });
      return;
    }
    return { publicKey };
  });

  // ── POST /api/push/subscribe ──────────────────────────────────────────────
  //
  // Upsert a push subscription for the authenticated user.
  // Uniqueness key: endpoint (matches v1's update_or_create(endpoint=...)).
  // The "same device, different account" case is handled by the upsert updating userId.
  //
  // v1 reference: subscribe view — PushSubscription.objects.update_or_create(endpoint=..., defaults={user, p256dh, auth})

  app.post('/api/push/subscribe', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const body = PushSubscribeInputSchema.parse(req.body);

    const sub = await app.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    reply.code(201).send({ id: sub.id });
  });

  // ── POST /api/push/unsubscribe ────────────────────────────────────────────
  //
  // Remove the authenticated user's push subscription by endpoint.
  // Idempotent: returns 204 even if no matching row exists.
  // Scoped to the caller's userId — prevents one user removing another's subscription.
  //
  // v1 reference: unsubscribe view — PushSubscription.objects.filter(user=request.user, endpoint=...).delete()

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const body = PushUnsubscribeInputSchema.parse(req.body);

    await app.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint: body.endpoint },
    });

    reply.code(204).send();
  });
}
