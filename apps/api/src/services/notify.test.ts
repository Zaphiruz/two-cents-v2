/**
 * notify.test.ts — Tests for services/notify.ts (Phase 6b)
 *
 * Mocks sendPushNotification from lib/push.ts to avoid real network calls.
 *
 * Tests:
 *   1. Sends push when user has a subscription (success path)
 *   2. Returns skipped='disabled' when preference is disabled
 *   3. Returns skipped='quiet_hours' when currently in quiet hours
 *   4. Returns skipped='deduped' when NotificationLog already exists for this eventKey
 *   5. Cleans up expired subscription (PushSubscriptionExpiredError → deleteMany)
 *   6. Returns sent=0 when user has no subscriptions (still inserts NotificationLog)
 *   7. Does not skip when event_type is in ALWAYS_FIRE (need_rated_reminder), even in quiet hours
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sendPushNotification before importing notify (hoisting)
vi.mock('../lib/push.js', () => ({
  sendPushNotification: vi.fn(),
  PushSubscriptionExpiredError: class PushSubscriptionExpiredError extends Error {
    constructor(endpoint: string) {
      super(`push subscription expired or gone: ${endpoint}`);
      this.name = 'PushSubscriptionExpiredError';
    }
  },
}));

import { sendPushNotification, PushSubscriptionExpiredError } from '../lib/push.js';
import { notify } from './notify.js';
import { prisma } from '../test-helpers/db.js';

const mockSendPush = sendPushNotification as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// Helpers

async function createUserWithSub(oidcSubject: string) {
  const user = await prisma.user.create({ data: { oidcSubject, name: 'Test User' } });
  const sub = await prisma.pushSubscription.create({
    data: {
      userId: user.id,
      endpoint: `https://fcm.example.com/${oidcSubject}`,
      p256dh: 'BPublicKey',
      auth: 'authToken',
    },
  });
  return { user, sub };
}

const dummyPayload = { title: 'Test', body: 'Hello' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('notify', () => {
  // 1. Success path
  it('sends push notification and returns sent=1 on success', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { user } = await createUserWithSub('notify-success');

    const result = await notify(prisma, user.id, `request_pending:1`, 'request_pending', dummyPayload);

    expect(result.sent).toBe(1);
    expect(result.skipped).toBeNull();
    expect(mockSendPush).toHaveBeenCalledOnce();

    // NotificationLog row should be created
    const log = await prisma.notificationLog.findUnique({
      where: { userId_eventKey: { userId: user.id, eventKey: 'request_pending:1' } },
    });
    expect(log).not.toBeNull();
  });

  // 2. Disabled preference
  it('returns skipped=disabled when preference is disabled', async () => {
    const { user } = await createUserWithSub('notify-disabled');
    await prisma.notificationPreference.create({
      data: { userId: user.id, eventType: 'request_pending', enabled: false },
    });

    const result = await notify(prisma, user.id, 'request_pending:2', 'request_pending', dummyPayload);

    expect(result.skipped).toBe('disabled');
    expect(result.sent).toBe(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  // 3. Quiet hours — same-day window (08:00 - 22:00), now is 10:00
  it('returns skipped=quiet_hours when currently in quiet hours', async () => {
    const { user } = await createUserWithSub('notify-quiet');
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        eventType: 'comment',
        enabled: true,
        quietHoursStart: '08:00',
        quietHoursEnd: '22:00',
      },
    });

    // Inject a "now" that is 10:00
    const noon = new Date();
    noon.setHours(10, 0, 0, 0);

    const result = await notify(prisma, user.id, 'comment:3', 'comment', dummyPayload, noon);

    expect(result.skipped).toBe('quiet_hours');
    expect(result.sent).toBe(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  // 4. Deduped — same eventKey already in NotificationLog
  it('returns skipped=deduped when NotificationLog already has this eventKey', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { user } = await createUserWithSub('notify-deduped');
    // Pre-insert a log row
    await prisma.notificationLog.create({
      data: { userId: user.id, eventKey: 'approval:10', sentAt: new Date() },
    });

    const result = await notify(prisma, user.id, 'approval:10', 'approval', dummyPayload);

    expect(result.skipped).toBe('deduped');
    expect(result.sent).toBe(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  // 5. Expired subscription cleanup
  it('deletes expired subscription on PushSubscriptionExpiredError', async () => {
    const { user, sub } = await createUserWithSub('notify-expired');
    // Make sendPushNotification throw PushSubscriptionExpiredError
    mockSendPush.mockRejectedValue(new PushSubscriptionExpiredError(sub.endpoint));

    const result = await notify(prisma, user.id, 'approval:20', 'approval', dummyPayload);

    expect(result.sent).toBe(0);
    expect(result.skipped).toBeNull();

    // The expired subscription should be deleted
    const remaining = await prisma.pushSubscription.count({ where: { userId: user.id } });
    expect(remaining).toBe(0);

    // NotificationLog should still be inserted
    const log = await prisma.notificationLog.findUnique({
      where: { userId_eventKey: { userId: user.id, eventKey: 'approval:20' } },
    });
    expect(log).not.toBeNull();
  });

  // 6. No subscriptions — sent=0 but still inserts NotificationLog
  it('returns sent=0 when user has no push subscriptions, still inserts log', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'notify-no-sub', name: 'No Sub User' },
    });

    const result = await notify(prisma, user.id, 'denial:30', 'denial', dummyPayload);

    expect(result.sent).toBe(0);
    expect(result.skipped).toBeNull();
    expect(mockSendPush).not.toHaveBeenCalled();

    const log = await prisma.notificationLog.findUnique({
      where: { userId_eventKey: { userId: user.id, eventKey: 'denial:30' } },
    });
    expect(log).not.toBeNull();
  });

  // 7. ALWAYS_FIRE bypasses quiet hours
  it('bypasses quiet hours for ALWAYS_FIRE event types (need_rated_reminder)', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { user } = await createUserWithSub('notify-always-fire');
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        eventType: 'need_rated_reminder',
        enabled: true,
        quietHoursStart: '00:00',
        quietHoursEnd: '23:59', // all-day quiet hours
      },
    });

    const result = await notify(
      prisma,
      user.id,
      'need_rated_reminder:50',
      'need_rated_reminder',
      dummyPayload,
      new Date(), // any time
    );

    // Should NOT be skipped for quiet hours
    expect(result.skipped).toBeNull();
    expect(result.sent).toBe(1);
  });
});
