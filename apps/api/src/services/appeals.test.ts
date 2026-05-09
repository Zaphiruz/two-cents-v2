/**
 * appeals.test.ts — mirrors v1 test_services.py 1:1
 *
 * 6 tests covering: period key quarterly/monthly format, quarter boundary
 * correctness, default quota remaining, filing an appeal decrements quota,
 * quota exhaustion raises QuotaExceeded.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '../test-helpers/db.js';
import { createMembers } from '../test-helpers/fixtures.js';
import {
  currentPeriodKey,
  appealsUsed,
  appealsRemaining,
  fileAppeal,
  QuotaExceeded,
} from './appeals.js';

// ── Helper: create a denied request ──────────────────────────────────────────

async function makeDeniedRequest(
  buyerId: number,
  householdId: number,
  opts: { title?: string; url?: string } = {},
): Promise<{ id: number }> {
  const title = opts.title ?? 'X';
  const url = opts.url ?? 'https://x.example';

  const request = await prisma.request.create({
    data: {
      householdId,
      buyerId,
      title,
      buyerSeriousness: 'need',
      status: 'denied',
      items: {
        create: {
          title,
          url,
          priceCents: 100,
          position: 0,
        },
      },
    },
  });
  return { id: request.id };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('appeals', () => {
  // ── 1. currentPeriodKey quarterly ─────────────────────────────────────────

  it('period key quarterly: 2026-04-15 → "2026-Q2"', () => {
    // April = month 4 → quarter 2
    const key = currentPeriodKey('quarterly', new Date('2026-04-15'));
    expect(key).toBe('2026-Q2');
  });

  // ── 2. currentPeriodKey monthly ───────────────────────────────────────────

  it('period key monthly: 2026-04-15 → "2026-04"', () => {
    const key = currentPeriodKey('monthly', new Date('2026-04-15'));
    expect(key).toBe('2026-04');
  });

  // ── 3. appealsRemaining default quota (no appeals filed yet) ─────────────

  it('appealsRemaining returns 2 (default quota) when no appeals filed', async () => {
    const { buyer, householdId } = await createMembers();
    const household = await prisma.household.findUniqueOrThrow({
      where: { id: householdId },
    });

    const remaining = await appealsRemaining(
      prisma,
      buyer.id,
      household,
      new Date('2026-04-15'),
    );
    expect(remaining).toBe(2);
  });

  // ── 4. fileAppeal decrements remaining and creates row ───────────────────

  it('filing an appeal decrements remaining and creates an Appeal row', async () => {
    const { buyer, householdId } = await createMembers();
    const household = await prisma.household.findUniqueOrThrow({
      where: { id: householdId },
    });
    const now = new Date('2026-04-15');

    const { id: requestId } = await makeDeniedRequest(buyer.id, householdId);

    const appeal = await fileAppeal(
      prisma,
      { requestId, buyerId: buyer.id, justification: 'please reconsider' },
      now,
    );

    expect(appeal.periodKey).toBe('2026-Q2');
    expect(appeal.status).toBe('pending');
    expect(appeal.justification).toBe('please reconsider');

    const remaining = await appealsRemaining(prisma, buyer.id, household, now);
    expect(remaining).toBe(1);

    const count = await prisma.appeal.count({ where: { requestId } });
    expect(count).toBe(1);
  });

  // ── 5. QuotaExceeded when quota exhausted ────────────────────────────────

  it('filing a third appeal raises QuotaExceeded (default quota is 2)', async () => {
    const { buyer, householdId } = await createMembers();
    const now = new Date('2026-04-15');

    const { id: r1 } = await makeDeniedRequest(buyer.id, householdId, {
      title: 'X',
      url: 'https://x.example',
    });
    const { id: r2 } = await makeDeniedRequest(buyer.id, householdId, {
      title: 'Y',
      url: 'https://y.example',
    });
    const { id: r3 } = await makeDeniedRequest(buyer.id, householdId, {
      title: 'Z',
      url: 'https://z.example',
    });

    await fileAppeal(prisma, { requestId: r1, buyerId: buyer.id, justification: 'a' }, now);
    await fileAppeal(prisma, { requestId: r2, buyerId: buyer.id, justification: 'b' }, now);

    await expect(
      fileAppeal(prisma, { requestId: r3, buyerId: buyer.id, justification: 'c' }, now),
    ).rejects.toThrow(QuotaExceeded);
  });

  // ── 6. Quarter boundary correctness ──────────────────────────────────────

  it('quarter boundaries are correct across all 4 quarters', () => {
    expect(currentPeriodKey('quarterly', new Date('2026-01-01'))).toBe('2026-Q1');
    expect(currentPeriodKey('quarterly', new Date('2026-03-31'))).toBe('2026-Q1');
    expect(currentPeriodKey('quarterly', new Date('2026-04-01'))).toBe('2026-Q2');
    expect(currentPeriodKey('quarterly', new Date('2026-12-31'))).toBe('2026-Q4');
  });
});
