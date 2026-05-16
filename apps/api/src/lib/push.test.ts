/**
 * push.test.ts — Tests for lib/push.ts (Phase 6a)
 *
 * Tests:
 *   1. configurePush is a no-op (logs warning) when env vars are missing
 *   2. configurePush calls webpush.setVapidDetails when env vars are present
 *   3. sendPushNotification resolves on success (mocked webpush)
 *   4. sendPushNotification throws PushSubscriptionExpiredError on 404/410
 *   5. sendPushNotification re-throws generic errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock web-push before importing push.ts
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

import webpush from 'web-push';
import { configurePush, sendPushNotification, PushSubscriptionExpiredError } from './push.js';

const mockSetVapidDetails = webpush.setVapidDetails as ReturnType<typeof vi.fn>;
const mockSendNotification = webpush.sendNotification as ReturnType<typeof vi.fn>;

const validSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  p256dh: 'BPSomePublicKey',
  auth: 'someAuthToken',
};

// ── configurePush ─────────────────────────────────────────────────────────────

describe('configurePush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_CLAIM_EMAIL;
  });

  // 1. no-op when env vars are missing
  it('is a no-op (does not throw) when env vars are missing', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_CLAIM_EMAIL;
    expect(() => configurePush()).not.toThrow();
    expect(mockSetVapidDetails).not.toHaveBeenCalled();
  });

  // 2. calls setVapidDetails when env vars present
  it('calls webpush.setVapidDetails when all VAPID env vars are set', () => {
    process.env.VAPID_PUBLIC_KEY = 'BPublicKey';
    process.env.VAPID_PRIVATE_KEY = 'privateKey';
    process.env.VAPID_CLAIM_EMAIL = 'push@example.com';
    configurePush();
    expect(mockSetVapidDetails).toHaveBeenCalledOnce();
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      'mailto:push@example.com',
      'BPublicKey',
      'privateKey',
    );
  });
});

// ── sendPushNotification ──────────────────────────────────────────────────────

describe('sendPushNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 3. resolves on success
  it('resolves when webpush.sendNotification succeeds', async () => {
    mockSendNotification.mockResolvedValue({ statusCode: 201 });
    await expect(
      sendPushNotification(validSubscription, { title: 'Test', body: 'Hello' }),
    ).resolves.toBeUndefined();
    expect(mockSendNotification).toHaveBeenCalledOnce();
  });

  // 4. throws PushSubscriptionExpiredError on 404
  it('throws PushSubscriptionExpiredError on 404 error', async () => {
    const err = Object.assign(new Error('Gone'), { statusCode: 404 });
    mockSendNotification.mockRejectedValue(err);
    await expect(
      sendPushNotification(validSubscription, { title: 'Test', body: 'Hello' }),
    ).rejects.toBeInstanceOf(PushSubscriptionExpiredError);
  });

  // 4b. throws PushSubscriptionExpiredError on 410
  it('throws PushSubscriptionExpiredError on 410 error', async () => {
    const err = Object.assign(new Error('Subscription expired'), { statusCode: 410 });
    mockSendNotification.mockRejectedValue(err);
    await expect(
      sendPushNotification(validSubscription, { title: 'Test', body: 'Hello' }),
    ).rejects.toBeInstanceOf(PushSubscriptionExpiredError);
  });

  // 5. re-throws generic errors
  it('re-throws generic errors as-is', async () => {
    const err = Object.assign(new Error('Network failure'), { statusCode: 500 });
    mockSendNotification.mockRejectedValue(err);
    await expect(
      sendPushNotification(validSubscription, { title: 'Test', body: 'Hello' }),
    ).rejects.toThrow('Network failure');
    await expect(
      sendPushNotification(validSubscription, { title: 'Test', body: 'Hello' }),
    ).rejects.not.toBeInstanceOf(PushSubscriptionExpiredError);
  });
});
