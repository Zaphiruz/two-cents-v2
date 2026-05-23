/**
 * scheduled.test.ts — Unit tests for the 6 scheduled job functions (Phase 8)
 *
 * Strategy:
 *   - Use the real test DB (via prisma from test-helpers/db) with beforeEach reset.
 *   - Control "now" by passing an explicit Date arg to each job fn.
 *   - Mock notify() so reminder/warning jobs don't attempt actual push.
 *   - Test one "hits threshold" case and one "not yet" case per expiration job.
 *   - Test notify call args for the reminder/warning jobs.
 *
 * Tests (12 total):
 *   expireCooldowns:         [1] delayed + past → archived to awaiting_reconfirm
 *                            [2] delayed + future → no change
 *   expireReconfirms:        [3] awaiting_reconfirm + past → archived
 *                            [4] awaiting_reconfirm + future → no change
 *   expireApprovals:         [5] approved + past → archived
 *                            [6] approved + future → no change
 *   approvalExpiringWarnings:[7] approved, expires in ~3d → notify called
 *                            [8] approved, expires in 10d → notify NOT called
 *   stalePendingReminders:   [9] pending 7+ days → notify called (day_7 threshold)
 *                            [10] pending 1 day → notify NOT called
 *   needRatedReminders:      [11] need-rated pending exactly 6h ago → notify called
 *                            [12] need-rated pending 48h ago (outside window) → NOT called
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock notify so reminder jobs don't attempt real push delivery
vi.mock('../services/notify.js', () => ({
  notify: vi.fn().mockResolvedValue({ sent: 0, skipped: null }),
}));

// Also mock push to be safe (some transitive imports)
vi.mock('../lib/push.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/push.js')>();
  return {
    ...actual,
    sendPushNotification: vi.fn().mockResolvedValue(undefined),
  };
});

import { prisma } from '../test-helpers/db.js';
import { createMembers, createRequest } from '../test-helpers/fixtures.js';
import { notify } from '../services/notify.js';
import {
  expireCooldowns,
  expireReconfirms,
  expireApprovals,
  approvalExpiringWarnings,
  stalePendingReminders,
  needRatedReminders,
} from './scheduled.js';

const mockNotify = vi.mocked(notify);

// Reset mock call counts between tests (clearMocks is not set globally here)
beforeEach(() => {
  mockNotify.mockClear();
});

// ── Helper: set statusExpiresAt directly ──────────────────────────────────────

async function setStatusExpiresAt(requestId: number, expiresAt: Date | null): Promise<void> {
  await prisma.request.update({ where: { id: requestId }, data: { statusExpiresAt: expiresAt } });
}

async function setStatus(requestId: number, status: string): Promise<void> {
  await prisma.request.update({
    where: { id: requestId },
    data: { status: status as never },
  });
}

async function setCreatedAt(requestId: number, createdAt: Date): Promise<void> {
  await prisma.request.update({ where: { id: requestId }, data: { createdAt } });
}

// ── expireCooldowns ───────────────────────────────────────────────────────────

describe('expireCooldowns', () => {
  it('transitions a delayed request whose statusExpiresAt is in the past', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    // Put request in delayed state with a past expiry
    const pastExpiry = new Date('2025-01-01T00:00:00Z');
    await setStatus(id, 'delayed');
    await setStatusExpiresAt(id, pastExpiry);

    const now = new Date('2025-06-01T00:00:00Z');
    await expireCooldowns(prisma, now);

    const updated = await prisma.request.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe('awaiting_reconfirm');
  });

  it('does NOT transition a delayed request whose statusExpiresAt is in the future', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    const futureExpiry = new Date('2030-01-01T00:00:00Z');
    await setStatus(id, 'delayed');
    await setStatusExpiresAt(id, futureExpiry);

    const now = new Date('2025-06-01T00:00:00Z');
    await expireCooldowns(prisma, now);

    const updated = await prisma.request.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe('delayed');
  });
});

// ── expireReconfirms ──────────────────────────────────────────────────────────

describe('expireReconfirms', () => {
  it('transitions awaiting_reconfirm past deadline to archived', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    const pastExpiry = new Date('2025-01-01T00:00:00Z');
    await setStatus(id, 'awaiting_reconfirm');
    await setStatusExpiresAt(id, pastExpiry);

    const now = new Date('2025-06-01T00:00:00Z');
    await expireReconfirms(prisma, now);

    const updated = await prisma.request.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe('archived');
  });

  it('does NOT transition awaiting_reconfirm with a future deadline', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    const futureExpiry = new Date('2030-01-01T00:00:00Z');
    await setStatus(id, 'awaiting_reconfirm');
    await setStatusExpiresAt(id, futureExpiry);

    const now = new Date('2025-06-01T00:00:00Z');
    await expireReconfirms(prisma, now);

    const updated = await prisma.request.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe('awaiting_reconfirm');
  });
});

// ── expireApprovals ───────────────────────────────────────────────────────────

describe('expireApprovals', () => {
  it('transitions approved request past 30d to archived', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    const pastExpiry = new Date('2025-01-01T00:00:00Z');
    await setStatus(id, 'approved');
    await setStatusExpiresAt(id, pastExpiry);

    const now = new Date('2025-06-01T00:00:00Z');
    await expireApprovals(prisma, now);

    const updated = await prisma.request.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe('archived');
  });

  it('does NOT transition approved request with a future expiry', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    const futureExpiry = new Date('2030-01-01T00:00:00Z');
    await setStatus(id, 'approved');
    await setStatusExpiresAt(id, futureExpiry);

    const now = new Date('2025-06-01T00:00:00Z');
    await expireApprovals(prisma, now);

    const updated = await prisma.request.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe('approved');
  });
});

// ── approvalExpiringWarnings ──────────────────────────────────────────────────

describe('approvalExpiringWarnings', () => {
  it('calls notify for an approved request expiring in ~3 days', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id, title: 'Expiring Item' });

    // Set status to approved
    await setStatus(id, 'approved');
    // Set expiry to exactly 3 days from now
    const now = new Date('2025-06-01T09:00:00Z');
    const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // exactly 3d
    await setStatusExpiresAt(id, expiresAt);

    await approvalExpiringWarnings(prisma, now);

    expect(mockNotify).toHaveBeenCalledOnce();
    const [, , eventKey, eventType, payload] = mockNotify.mock.calls[0]!;
    expect(eventKey).toBe(`approval_expiring:req_${id}`);
    expect(eventType).toBe('approval_expiring');
    expect(payload.title).toContain('Expiring Item');
    expect(payload.url).toBe(`/requests/${id}`);
  });

  it('does NOT call notify for an approved request expiring in 10 days', async () => {
    const { buyer, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    await setStatus(id, 'approved');
    const now = new Date('2025-06-01T09:00:00Z');
    const expiresAt = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days — outside window
    await setStatusExpiresAt(id, expiresAt);

    await approvalExpiringWarnings(prisma, now);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// ── stalePendingReminders ─────────────────────────────────────────────────────

describe('stalePendingReminders', () => {
  it('calls notify for approvers when a pending request is 7+ days old', async () => {
    const { buyer, approver, householdId } = await createMembers();
    const { id } = await createRequest({
      householdId,
      buyerId: buyer.id,
      title: 'Stale Item',
    });

    // Wire the buyer→approver link
    await prisma.buyerApprover.create({
      data: { buyerId: buyer.id, approverId: approver.id },
    });

    const now = new Date('2025-06-10T10:00:00Z');
    // Make createdAt 8 days ago — hits day_3, day_7 thresholds
    const createdAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    await setCreatedAt(id, createdAt);

    await stalePendingReminders(prisma, now);

    // At least the day_7 notify should have been called for the approver
    expect(mockNotify.mock.calls.length).toBeGreaterThan(0);
    const eventKeys = mockNotify.mock.calls.map((c) => c[2]);
    expect(eventKeys.some((k) => k.startsWith('stale_day_7:') && k.includes(`req_${id}`))).toBe(true);
    const eventTypes = mockNotify.mock.calls.map((c) => c[3]);
    expect(eventTypes.every((t) => t === 'stale_pending')).toBe(true);
  });

  it('does NOT call notify when a pending request is only 1 day old', async () => {
    const { buyer, approver, householdId } = await createMembers();
    const { id } = await createRequest({ householdId, buyerId: buyer.id });

    await prisma.buyerApprover.create({
      data: { buyerId: buyer.id, approverId: approver.id },
    });

    const now = new Date('2025-06-10T10:00:00Z');
    // createdAt just 1 day ago — below all thresholds
    const createdAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    await setCreatedAt(id, createdAt);

    await stalePendingReminders(prisma, now);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// ── needRatedReminders ────────────────────────────────────────────────────────

describe('needRatedReminders', () => {
  it('calls notify for approvers when a need-rated request is ~6h old', async () => {
    const { buyer, approver, householdId } = await createMembers();
    const { id } = await createRequest({
      householdId,
      buyerId: buyer.id,
      buyerSeriousness: 'need',
      title: 'Urgent Item',
    });

    await prisma.buyerApprover.create({
      data: { buyerId: buyer.id, approverId: approver.id },
    });

    const now = new Date('2025-06-01T16:00:00Z');
    // createdAt exactly 6h ago — within the ±35min window
    const createdAt = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    await setCreatedAt(id, createdAt);

    await needRatedReminders(prisma, now);

    expect(mockNotify).toHaveBeenCalled();
    const eventKeys = mockNotify.mock.calls.map((c) => c[2]);
    expect(eventKeys.some((k) => k.startsWith('need_6h:') && k.includes(`req_${id}`))).toBe(true);
    const eventTypes = mockNotify.mock.calls.map((c) => c[3]);
    expect(eventTypes.every((t) => t === 'need_rated_reminder')).toBe(true);
  });

  it('does NOT call notify for a need-rated request 48h old (outside all windows)', async () => {
    const { buyer, approver, householdId } = await createMembers();
    const { id } = await createRequest({
      householdId,
      buyerId: buyer.id,
      buyerSeriousness: 'need',
    });

    await prisma.buyerApprover.create({
      data: { buyerId: buyer.id, approverId: approver.id },
    });

    const now = new Date('2025-06-01T16:00:00Z');
    // 48h ago — outside both the 6h and 24h ±35min windows
    const createdAt = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    await setCreatedAt(id, createdAt);

    await needRatedReminders(prisma, now);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
