/**
 * notify.ts — Push notification delivery service (Phase 6b)
 *
 * Ports v1's apps/notifications/services.py notify() function.
 *
 * Semantics:
 *   1. Check NotificationPreference for the user + eventType.
 *      - If disabled (or default is disabled), no-op.
 *   2. Unless eventType is in ALWAYS_FIRE, check quiet hours.
 *      - If currently in quiet hours, no-op.
 *   3. Dedup via NotificationLog (userId + eventKey unique).
 *      - If log row already exists, no-op (idempotence key reuse).
 *   4. Fetch user's PushSubscription rows.
 *      - For each subscription, call sendPushNotification().
 *      - On PushSubscriptionExpiredError, delete the subscription row.
 *   5. Insert a NotificationLog row after attempting delivery (even if all subs expired).
 *      - On unique constraint violation (race), silently ignore.
 *
 * v1 reference: apps/notifications/services.py
 */

import type { PrismaClient } from '@prisma/client';
import { sendPushNotification, PushSubscriptionExpiredError } from '../lib/push.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  /** Quick-action tokens for lock-screen actions (approve / delay). */
  tokens?: {
    approve?: string;
    delay?: string;
  };
  [key: string]: unknown;
}

export type NotifySkipReason = 'disabled' | 'quiet_hours' | 'deduped';

export interface NotifyResult {
  sent: number;
  skipped: NotifySkipReason | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Default enabled state per event_type (mirrors v1's DEFAULT_ENABLED dict).
 * If no NotificationPreference row exists for a user+event_type, fall back to this.
 */
const DEFAULT_ENABLED: Record<string, boolean> = {
  request_pending: true,
  approval: true,
  delay: true,
  denial: true,
  comment: true,
  reconfirm_due: true,
  approval_expiring: true,
  stale_pending: true,
  need_rated_reminder: true,
  appeal_filed: true,
  appeal_resolved: true,
};

/**
 * Event types that bypass quiet hours (mirrors v1's ALWAYS_FIRE set).
 */
const ALWAYS_FIRE = new Set(['need_rated_reminder']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" string to { hours, minutes }.
 * Returns null if the string is not in the expected format.
 */
function parseHHMM(hhMm: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhMm);
  if (!match) return null;
  return { hours: parseInt(match[1]!, 10), minutes: parseInt(match[2]!, 10) };
}

/**
 * Check if `now` falls within the quiet hours window [start, end].
 * Handles overnight windows (e.g. 22:00 to 07:00).
 * Mirrors v1's in_quiet_hours() logic.
 */
function isInQuietHours(
  quietHoursStart: string,
  quietHoursEnd: string,
  now: Date,
): boolean {
  const start = parseHHMM(quietHoursStart);
  const end = parseHHMM(quietHoursEnd);
  if (!start || !end) return false;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = start.hours * 60 + start.minutes;
  const endMins = end.hours * 60 + end.minutes;

  if (startMins <= endMins) {
    // e.g. 08:00 - 18:00 (same-day window)
    return nowMins >= startMins && nowMins <= endMins;
  } else {
    // e.g. 22:00 - 07:00 (overnight window)
    return nowMins >= startMins || nowMins <= endMins;
  }
}

// ── notify ─────────────────────────────────────────────────────────────────────

/**
 * Deliver a push notification to the user if conditions are met.
 *
 * @param prisma    PrismaClient
 * @param userId    The recipient user's id
 * @param eventKey  Dedup key — e.g. `request_pending:${requestId}`. Unique per (userId, eventKey).
 * @param eventType Category for preference lookup — e.g. 'request_pending', 'comment', etc.
 * @param payload   The notification payload to send
 * @param now       Timestamp used for quiet hours check (injectable for tests)
 */
export async function notify(
  prisma: PrismaClient,
  userId: number,
  eventKey: string,
  eventType: string,
  payload: NotificationPayload,
  now: Date = new Date(),
): Promise<NotifyResult> {
  // 1. Check notification preference (enabled/disabled)
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_eventType: { userId, eventType } },
  });

  const enabled = pref ? pref.enabled : (DEFAULT_ENABLED[eventType] ?? true);
  if (!enabled) {
    return { sent: 0, skipped: 'disabled' };
  }

  // 2. Quiet hours check (unless event type always fires)
  if (!ALWAYS_FIRE.has(eventType)) {
    if (
      pref &&
      pref.quietHoursStart &&
      pref.quietHoursEnd &&
      isInQuietHours(pref.quietHoursStart, pref.quietHoursEnd, now)
    ) {
      return { sent: 0, skipped: 'quiet_hours' };
    }
  }

  // 3. Dedup check via NotificationLog
  const existingLog = await prisma.notificationLog.findUnique({
    where: { userId_eventKey: { userId, eventKey } },
  });
  if (existingLog) {
    return { sent: 0, skipped: 'deduped' };
  }

  // 4. Fetch all push subscriptions for this user
  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
      );
      sent++;
    } catch (err) {
      if (err instanceof PushSubscriptionExpiredError) {
        // Remove the stale subscription
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {
          // Ignore if already deleted (race condition)
        });
      }
      // Other push errors are silently swallowed at this level.
      // The caller (fireEvent) wraps fireEvent in try/catch — individual sub
      // failures should not abort delivery to other subs.
    }
  }

  // 5. Insert a NotificationLog row to prevent future dedup
  // (even if no subs existed — prevents re-sending when user subscribes later)
  try {
    await prisma.notificationLog.create({
      data: { userId, eventKey, sentAt: now },
    });
  } catch {
    // Unique constraint violation (race) — silently ignore
  }

  return { sent, skipped: null };
}
