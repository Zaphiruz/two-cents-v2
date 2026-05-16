/**
 * events.test.ts — Tests for services/events.ts (Phase 6b)
 *
 * Mocks sendPushNotification to avoid real network calls.
 *
 * Tests:
 *   1. request_pending — fans out to all approvers + includes quick-action tokens
 *   2. request_pending — no-op when request doesn't exist
 *   3. comment        — notifies buyer + all approvers except the commenter
 *   4. appeal_filed   — fans out to all approvers + includes quick-action tokens
 *   5. approval       — notifies the buyer with "Approved"
 *   6. appeal_resolved — notifies the buyer with the outcome
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sendPushNotification before importing events (hoisting)
vi.mock('../lib/push.js', () => ({
  sendPushNotification: vi.fn(),
  PushSubscriptionExpiredError: class PushSubscriptionExpiredError extends Error {
    constructor(endpoint: string) {
      super(`push subscription expired or gone: ${endpoint}`);
      this.name = 'PushSubscriptionExpiredError';
    }
  },
}));

import { sendPushNotification } from '../lib/push.js';
import { fireEvent } from './events.js';
import { prisma } from '../test-helpers/db.js';

const mockSendPush = sendPushNotification as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

async function setupHousehold() {
  const household = await prisma.household.create({ data: { name: 'TestHousehold' } });

  const buyerUser = await prisma.user.create({ data: { oidcSubject: `buyer-${Date.now()}`, name: 'Buyer' } });
  const approver1User = await prisma.user.create({ data: { oidcSubject: `approver1-${Date.now()}`, name: 'Approver1' } });
  const approver2User = await prisma.user.create({ data: { oidcSubject: `approver2-${Date.now()}`, name: 'Approver2' } });

  const buyerMember = await prisma.householdMember.create({
    data: { householdId: household.id, userId: buyerUser.id },
  });
  const approver1Member = await prisma.householdMember.create({
    data: { householdId: household.id, userId: approver1User.id },
  });
  const approver2Member = await prisma.householdMember.create({
    data: { householdId: household.id, userId: approver2User.id },
  });

  // Link approver1 and approver2 as approvers of buyer
  await prisma.buyerApprover.create({
    data: { buyerId: buyerMember.id, approverId: approver1Member.id },
  });
  await prisma.buyerApprover.create({
    data: { buyerId: buyerMember.id, approverId: approver2Member.id },
  });

  // Add push subscriptions for all users
  for (const user of [buyerUser, approver1User, approver2User]) {
    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: `https://fcm.example.com/${user.oidcSubject}`,
        p256dh: 'BPublicKey',
        auth: 'authToken',
      },
    });
  }

  // Create a request
  const request = await prisma.request.create({
    data: {
      householdId: household.id,
      buyerId: buyerMember.id,
      title: 'Test Item',
      buyerSeriousness: 'need',
      status: 'pending',
      items: {
        create: {
          title: 'Test Item',
          url: 'https://example.com',
          priceCents: 5000,
          position: 0,
        },
      },
    },
  });

  return { household, buyerUser, buyerMember, approver1User, approver1Member, approver2User, approver2Member, request };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fireEvent', () => {
  // 1. request_pending fans out to all approvers with quick-action tokens
  it('request_pending notifies all approvers with quick-action tokens in payload', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { approver1User, approver2User, request } = await setupHousehold();

    await fireEvent(prisma, 'request_pending', { requestId: request.id });

    // Should send to both approvers
    expect(mockSendPush).toHaveBeenCalledTimes(2);

    // Extract the payloads
    const calls = mockSendPush.mock.calls as Array<[{ endpoint: string }, { tokens?: object; title: string }]>;
    const endpoints = calls.map((c) => c[0].endpoint);
    expect(endpoints).toContain(`https://fcm.example.com/${approver1User.oidcSubject}`);
    expect(endpoints).toContain(`https://fcm.example.com/${approver2User.oidcSubject}`);

    // Each payload should have approve + delay tokens
    for (const call of calls) {
      const payload = call[1];
      expect(payload.tokens).toBeDefined();
      expect((payload.tokens as { approve?: string }).approve).toBeDefined();
      expect((payload.tokens as { delay?: string }).delay).toBeDefined();
    }

    // Notification logs should be created for each approver
    const log1 = await prisma.notificationLog.findUnique({
      where: { userId_eventKey: { userId: approver1User.id, eventKey: `request_pending:${request.id}` } },
    });
    const log2 = await prisma.notificationLog.findUnique({
      where: { userId_eventKey: { userId: approver2User.id, eventKey: `request_pending:${request.id}` } },
    });
    expect(log1).not.toBeNull();
    expect(log2).not.toBeNull();
  });

  // 2. request_pending no-ops when request doesn't exist
  it('request_pending is a no-op when the request does not exist', async () => {
    await fireEvent(prisma, 'request_pending', { requestId: 999999 });
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  // 3. comment notifies buyer + all approvers except the commenter
  it('comment notifies buyer + all approvers, excluding the comment author', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { buyerUser, approver1User, approver2User, request } = await setupHousehold();

    // approver1User is the author — they should NOT be notified
    await fireEvent(prisma, 'comment', {
      requestId: request.id,
      authorUserId: approver1User.id,
      body: 'This is a test comment',
    });

    // Should notify buyerUser and approver2User (not approver1User)
    expect(mockSendPush).toHaveBeenCalledTimes(2);
    const endpoints = (mockSendPush.mock.calls as Array<[{ endpoint: string }]>).map((c) => c[0].endpoint);
    expect(endpoints).toContain(`https://fcm.example.com/${buyerUser.oidcSubject}`);
    expect(endpoints).toContain(`https://fcm.example.com/${approver2User.oidcSubject}`);
    expect(endpoints).not.toContain(`https://fcm.example.com/${approver1User.oidcSubject}`);
  });

  // 4. appeal_filed fans out to all approvers with quick-action tokens
  it('appeal_filed notifies all approvers with quick-action tokens', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { approver1User, approver2User, buyerMember, request } = await setupHousehold();

    // Create a denied request appeal
    await prisma.request.update({ where: { id: request.id }, data: { status: 'denied' } });
    const appeal = await prisma.appeal.create({
      data: {
        requestId: request.id,
        buyerId: buyerMember.id,
        justification: 'I really need this.',
        periodKey: '2026-Q1',
        status: 'pending',
      },
    });

    await fireEvent(prisma, 'appeal_filed', { appealId: appeal.id });

    expect(mockSendPush).toHaveBeenCalledTimes(2);
    const calls = mockSendPush.mock.calls as Array<[{ endpoint: string }, { tokens?: object }]>;
    const endpoints = calls.map((c) => c[0].endpoint);
    expect(endpoints).toContain(`https://fcm.example.com/${approver1User.oidcSubject}`);
    expect(endpoints).toContain(`https://fcm.example.com/${approver2User.oidcSubject}`);

    // Each payload should have approve + delay tokens
    for (const call of calls) {
      const payload = call[1];
      expect(payload.tokens).toBeDefined();
    }
  });

  // 5. approval notifies buyer
  it('approval notifies the buyer with "Approved" title', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { buyerUser, request } = await setupHousehold();

    await fireEvent(prisma, 'approval', { requestId: request.id });

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const call = mockSendPush.mock.calls[0] as [{ endpoint: string }, { title: string }];
    expect(call[0].endpoint).toBe(`https://fcm.example.com/${buyerUser.oidcSubject}`);
    expect(call[1].title).toBe('Approved');
  });

  // 6. appeal_resolved notifies the buyer
  it('appeal_resolved notifies the buyer with the outcome', async () => {
    mockSendPush.mockResolvedValue(undefined);
    const { buyerUser, buyerMember, request } = await setupHousehold();

    await prisma.request.update({ where: { id: request.id }, data: { status: 'denied' } });
    const appeal = await prisma.appeal.create({
      data: {
        requestId: request.id,
        buyerId: buyerMember.id,
        justification: 'Please reconsider.',
        periodKey: '2026-Q1',
        status: 'upheld',
        resolvedAt: new Date(),
      },
    });

    await fireEvent(prisma, 'appeal_resolved', { appealId: appeal.id, outcome: 'upheld' });

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const call = mockSendPush.mock.calls[0] as [{ endpoint: string }, { title: string }];
    expect(call[0].endpoint).toBe(`https://fcm.example.com/${buyerUser.oidcSubject}`);
    expect(call[1].title).toBe('Appeal upheld');
  });
});
