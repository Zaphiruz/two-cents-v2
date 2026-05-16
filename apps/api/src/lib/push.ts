/**
 * push.ts — Web Push wrapper (Phase 6a)
 *
 * Wraps the web-push library with:
 *   configurePush()           — call once at boot; no-ops gracefully if VAPID vars missing
 *   sendPushNotification()    — send a push message; maps gone/expired errors to typed error
 *
 * Error classes:
 *   PushSubscriptionExpiredError — endpoint returned 404 or 410 (subscription gone)
 *
 * v1 reference: apps/notifications/views.py subscribe/unsubscribe + VAPID setup in settings.py
 */

import webpush from 'web-push';

// ── Error classes ─────────────────────────────────────────────────────────────

export class PushSubscriptionExpiredError extends Error {
  constructor(endpoint: string) {
    super(`push subscription expired or gone: ${endpoint}`);
    this.name = 'PushSubscriptionExpiredError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  [key: string]: unknown;
}

// ── configurePush ─────────────────────────────────────────────────────────────

/**
 * Configure VAPID credentials for web-push.
 *
 * Should be called once at app startup (wired in buildApp.ts).
 * If any VAPID env var is missing, logs a warning and returns without configuring —
 * the API remains usable; push notifications simply won't be sent.
 *
 * VAPID env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIM_EMAIL
 */
export function configurePush(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const claimEmail = process.env.VAPID_CLAIM_EMAIL;

  if (!publicKey || !privateKey || !claimEmail) {
    // Don't crash — push is optional; API stays usable without it.
    console.warn(
      '[push] VAPID env vars not set (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIM_EMAIL) — push notifications disabled',
    );
    return;
  }

  webpush.setVapidDetails(`mailto:${claimEmail}`, publicKey, privateKey);
}

// ── sendPushNotification ──────────────────────────────────────────────────────

/**
 * Send a push notification to a subscription.
 *
 * @param subscription  The stored PushSubscription record (endpoint + keys)
 * @param payload       The notification payload (title, body, url, ...)
 * @throws PushSubscriptionExpiredError  when the endpoint is gone (404 or 410)
 * @throws Error (re-thrown) for any other failure
 */
export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
): Promise<void> {
  const pushSub = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await webpush.sendNotification(pushSub, JSON.stringify(payload));
  } catch (err: unknown) {
    const statusCode =
      err !== null && typeof err === 'object' && 'statusCode' in err
        ? (err as { statusCode: number }).statusCode
        : undefined;

    if (statusCode === 404 || statusCode === 410) {
      throw new PushSubscriptionExpiredError(subscription.endpoint);
    }

    throw err;
  }
}
