/**
 * state.test.ts — mirrors v1 test_state.py 1:1
 *
 * Each test creates its own fixtures, transitions the request, and asserts
 * the resulting state in the database. The global beforeEach in tests/setup.ts
 * clears the DB before each test.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '../test-helpers/db.js';
import { createMembers, createRequest } from '../test-helpers/fixtures.js';
import { transition, IllegalTransition } from './state.js';

describe('state machine transitions', () => {
  // ── legal transitions ─────────────────────────────────────────────────────

  it('pending → approve → approved (sets status_expires_at, writes Review)', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    const updated = await transition(prisma, req.id, 'approve', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });

    expect(updated.status).toBe('approved');
    expect(updated.statusExpiresAt).not.toBeNull();

    const reviews = await prisma.review.findMany({ where: { requestId: req.id } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.action).toBe('approve');
  });

  it('pending → delay → delayed (auto_delay from price+seriousness, writes Review)', async () => {
    const { buyer, approver } = await createMembers();
    // $150 = 15000 cents → band 2; really_want → 14 days
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      priceCents: 15000,
      buyerSeriousness: 'really_want',
    });

    const updated = await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'really_want',
    });

    expect(updated.status).toBe('delayed');
    expect(updated.statusExpiresAt).not.toBeNull();

    const review = await prisma.review.findFirst({ where: { requestId: req.id } });
    expect(review).not.toBeNull();
    expect(review!.delayDays).toBe(14); // band 2 + really_want = 14d
    expect(review!.delayExpiresAt).not.toBeNull();
  });

  it('pending → deny → denied (writes Review)', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    const updated = await transition(prisma, req.id, 'deny', {
      actorId: approver.id,
      approverSeriousness: 'nice_to_have',
    });

    expect(updated.status).toBe('denied');

    const reviews = await prisma.review.findMany({ where: { requestId: req.id } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.action).toBe('deny');
  });

  it('pending → cancel → cancelled', async () => {
    const { buyer } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    const updated = await transition(prisma, req.id, 'cancel', { actorId: buyer.id });

    expect(updated.status).toBe('cancelled');
    expect(updated.statusExpiresAt).toBeNull();
  });

  it('delayed → expire → awaiting_reconfirm (sets 7d reconfirm deadline)', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    const updated = await transition(prisma, req.id, 'expire', {});

    expect(updated.status).toBe('awaiting_reconfirm');
    expect(updated.statusExpiresAt).not.toBeNull();

    // Should be approximately 7 days from now
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const diffMs = updated.statusExpiresAt!.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(sevenDaysMs - 5000);
    expect(diffMs).toBeLessThan(sevenDaysMs + 5000);
  });

  it('awaiting_reconfirm → reconfirm → pending (clears status_expires_at)', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    await transition(prisma, req.id, 'expire', {});
    const updated = await transition(prisma, req.id, 'reconfirm', { actorId: buyer.id });

    expect(updated.status).toBe('pending');
    expect(updated.statusExpiresAt).toBeNull();
  });

  it('awaiting_reconfirm → timeout → archived', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    await transition(prisma, req.id, 'expire', {});
    const updated = await transition(prisma, req.id, 'timeout', {});

    expect(updated.status).toBe('archived');
  });

  it('approved → purchase → purchased (clears status_expires_at)', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'approve', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    const updated = await transition(prisma, req.id, 'purchase', { actorId: buyer.id });

    expect(updated.status).toBe('purchased');
    expect(updated.statusExpiresAt).toBeNull();
  });

  it('approved → expire → archived', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'approve', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    const updated = await transition(prisma, req.id, 'expire', {});

    expect(updated.status).toBe('archived');
  });

  it('approved → cancel → cancelled', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'approve', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    const updated = await transition(prisma, req.id, 'cancel', { actorId: buyer.id });

    expect(updated.status).toBe('cancelled');
  });

  it('delayed → edit_meaningful → pending (clears status_expires_at)', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    const updated = await transition(prisma, req.id, 'edit_meaningful', { actorId: buyer.id });

    expect(updated.status).toBe('pending');
    expect(updated.statusExpiresAt).toBeNull();
  });

  it('denied → appeal_overturned → pending', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'deny', {
      actorId: approver.id,
      approverSeriousness: 'nice_to_have',
    });
    const updated = await transition(prisma, req.id, 'appeal_overturned', {});

    expect(updated.status).toBe('pending');
  });

  it('denied → archive → archived', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'deny', {
      actorId: approver.id,
      approverSeriousness: 'nice_to_have',
    });
    const updated = await transition(prisma, req.id, 'archive', {});

    expect(updated.status).toBe('archived');
  });

  it('awaiting_reconfirm → cancel → cancelled', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    await transition(prisma, req.id, 'expire', {});
    const updated = await transition(prisma, req.id, 'cancel', { actorId: buyer.id });

    expect(updated.status).toBe('cancelled');
  });

  it('pending → edit_meaningful → pending (self-loop, clears status_expires_at)', async () => {
    const { buyer } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    const updated = await transition(prisma, req.id, 'edit_meaningful', { actorId: buyer.id });

    expect(updated.status).toBe('pending');
    expect(updated.statusExpiresAt).toBeNull();
  });

  it('awaiting_reconfirm → edit_meaningful → pending', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'need',
    });
    await transition(prisma, req.id, 'expire', {});
    const updated = await transition(prisma, req.id, 'edit_meaningful', { actorId: buyer.id });

    expect(updated.status).toBe('pending');
    expect(updated.statusExpiresAt).toBeNull();
  });

  // ── illegal transitions ────────────────────────────────────────────────────

  it('purchased → approve throws IllegalTransition', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      status: 'purchased',
    });

    await expect(
      transition(prisma, req.id, 'approve', {
        actorId: approver.id,
        approverSeriousness: 'need',
      }),
    ).rejects.toThrow(IllegalTransition);
  });

  it('illegal transitions table — approved → delay throws', async () => {
    const { buyer } = await createMembers();
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      status: 'approved',
    });
    await expect(
      transition(prisma, req.id, 'delay', { actorId: buyer.id, approverSeriousness: 'need' }),
    ).rejects.toThrow(IllegalTransition);
  });

  it('illegal transitions table — denied → approve throws', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      status: 'denied',
    });
    await expect(
      transition(prisma, req.id, 'approve', {
        actorId: approver.id,
        approverSeriousness: 'need',
      }),
    ).rejects.toThrow(IllegalTransition);
  });

  it('illegal transitions table — cancelled → approve throws', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      status: 'cancelled',
    });
    await expect(
      transition(prisma, req.id, 'approve', {
        actorId: approver.id,
        approverSeriousness: 'need',
      }),
    ).rejects.toThrow(IllegalTransition);
  });

  it('illegal transitions table — archived → approve throws', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      status: 'archived',
    });
    await expect(
      transition(prisma, req.id, 'approve', {
        actorId: approver.id,
        approverSeriousness: 'need',
      }),
    ).rejects.toThrow(IllegalTransition);
  });

  it('illegal transitions table — purchased → cancel throws', async () => {
    const { buyer } = await createMembers();
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      status: 'purchased',
    });
    await expect(
      transition(prisma, req.id, 'cancel', { actorId: buyer.id }),
    ).rejects.toThrow(IllegalTransition);
  });

  // ── delay with delay_override ──────────────────────────────────────────────

  it('writes notes to the Review row when provided', async () => {
    const { buyer, approver } = await createMembers();
    const req = await createRequest({ householdId: buyer.householdId, buyerId: buyer.id });

    await transition(prisma, req.id, 'approve', {
      actorId: approver.id,
      approverSeriousness: 'need',
      notes: 'detailed feedback',
    });

    const review = await prisma.review.findFirstOrThrow({ where: { requestId: req.id } });
    expect(review.notes).toBe('detailed feedback');
  });

  it('delay with delay_override is clamped to 2× auto (band 2, really_want = 14d → max 28d)', async () => {
    const { buyer, approver } = await createMembers();
    // $150 = 15000 cents → band 2; really_want → auto 14d
    const req = await createRequest({
      householdId: buyer.householdId,
      buyerId: buyer.id,
      priceCents: 15000,
    });

    // Override 60 days → clamped to 28 (2 × 14)
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const updated = await transition(prisma, req.id, 'delay', {
      actorId: approver.id,
      approverSeriousness: 'really_want',
      delayOverrideMs: sixtyDaysMs,
    });

    expect(updated.status).toBe('delayed');
    const review = await prisma.review.findFirst({ where: { requestId: req.id } });
    expect(review!.delayDays).toBe(28); // clamped to 2× auto (14d)
  });
});
