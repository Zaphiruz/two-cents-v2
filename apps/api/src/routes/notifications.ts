/**
 * notifications.ts — Notification preference routes (Phase 6b)
 *
 * GET /api/notifications/preferences  — list all NotificationPreference rows for the caller
 * PUT /api/notifications/preferences  — upsert preferences for the caller
 *
 * v1 reference: apps/notifications/views.py (preferences-related views)
 * Schema: UpdateNotificationPreferencesInputSchema from @two-cents/shared
 */

import type { FastifyInstance } from 'fastify';
import { UpdateNotificationPreferencesInputSchema } from '@two-cents/shared';
import { authGuard } from '../lib/auth-utils.js';

export default async function notificationsRoutes(app: FastifyInstance) {
  // ── GET /api/notifications/preferences ───────────────────────────────────
  //
  // Returns all NotificationPreference rows for the authenticated user.
  // If no rows exist (new user), returns an empty array — the client should
  // fall back to the DEFAULT_ENABLED values documented in services/notify.ts.

  app.get('/api/notifications/preferences', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const preferences = await app.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: { eventType: 'asc' },
      select: {
        id: true,
        eventType: true,
        enabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
      },
    });

    return { preferences };
  });

  // ── PUT /api/notifications/preferences ───────────────────────────────────
  //
  // Upsert notification preferences for the authenticated user.
  // Uses prisma.notificationPreference.upsert per preference entry.
  // Returns the full updated list after applying changes.

  app.put('/api/notifications/preferences', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    // Validate body — ZodError → 400 via error handler
    const body = UpdateNotificationPreferencesInputSchema.parse(req.body);

    // Upsert each preference entry
    for (const pref of body.preferences) {
      await app.prisma.notificationPreference.upsert({
        where: { userId_eventType: { userId, eventType: pref.eventType } },
        create: {
          userId,
          eventType: pref.eventType,
          enabled: pref.enabled,
          quietHoursStart: pref.quietHoursStart ?? null,
          quietHoursEnd: pref.quietHoursEnd ?? null,
        },
        update: {
          enabled: pref.enabled,
          quietHoursStart: pref.quietHoursStart ?? null,
          quietHoursEnd: pref.quietHoursEnd ?? null,
        },
      });
    }

    // Return the full updated list
    const preferences = await app.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: { eventType: 'asc' },
      select: {
        id: true,
        eventType: true,
        enabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
      },
    });

    return { preferences };
  });
}
