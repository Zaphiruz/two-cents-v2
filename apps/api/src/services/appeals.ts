/**
 * appeals.ts — port of v1's appeals/services.py
 *
 * Provides appeal quota accounting:
 *   - currentPeriodKey   pure function — returns "YYYY-Qn" or "YYYY-MM"
 *   - appealsUsed        counts Appeal rows for a buyer in the current period
 *   - appealsRemaining   quota count minus appealsUsed, clamped to 0
 *   - fileAppeal         validates quota, creates an Appeal row atomically
 *
 * Error class: QuotaExceeded (mirrors v1's QuotaExceeded).
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { AppealPeriod } from '@two-cents/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal slice of the Household model that appeal logic depends on. */
export interface HouseholdQuota {
  appealQuotaCount: number;
  appealQuotaPeriod: AppealPeriod;
}

// ── Error class ───────────────────────────────────────────────────────────────

export class QuotaExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceeded';
  }
}

// ── currentPeriodKey ──────────────────────────────────────────────────────────

/**
 * Returns the period key for the given period and date.
 *
 * Quarterly: "YYYY-Qn"  (e.g. "2026-Q2" for April–June)
 * Monthly:   "YYYY-MM"  (e.g. "2026-04" for April)
 *
 * Quarter calculation mirrors v1: quarter = Math.floor((month - 1) / 3) + 1
 *   Jan–Mar = Q1, Apr–Jun = Q2, Jul–Sep = Q3, Oct–Dec = Q4
 *
 * @param period  'quarterly' | 'monthly'
 * @param now     Date to evaluate (defaults to new Date()); injectable for tests.
 */
export function currentPeriodKey(period: AppealPeriod, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-based

  if (period === 'monthly') {
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`;
  }

  // quarterly
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year.toString().padStart(4, '0')}-Q${quarter}`;
}

// ── appealsUsed ───────────────────────────────────────────────────────────────

/**
 * Count Appeal rows filed by this buyer in the current period.
 */
export async function appealsUsed(
  prisma: PrismaClient | Prisma.TransactionClient,
  buyerId: number,
  period: AppealPeriod,
  now: Date = new Date(),
): Promise<number> {
  const periodKey = currentPeriodKey(period, now);
  return prisma.appeal.count({
    where: { buyerId, periodKey },
  });
}

// ── appealsRemaining ──────────────────────────────────────────────────────────

/**
 * How many appeals the buyer has left this period. Always >= 0.
 *
 * @param household  Household quota settings (appealQuotaCount, appealQuotaPeriod).
 */
export async function appealsRemaining(
  prisma: PrismaClient | Prisma.TransactionClient,
  buyerId: number,
  household: HouseholdQuota,
  now: Date = new Date(),
): Promise<number> {
  const used = await appealsUsed(prisma, buyerId, household.appealQuotaPeriod, now);
  return Math.max(0, household.appealQuotaCount - used);
}

// ── fileAppeal ────────────────────────────────────────────────────────────────

export interface FileAppealArgs {
  requestId: number;
  buyerId: number;
  justification: string;
}

/**
 * Validate appeal quota and create an Appeal row atomically.
 *
 * Validation (mirrors v1):
 *   - Quota: appealsRemaining > 0, else throws QuotaExceeded
 *
 * The quota check and row creation are wrapped in a Prisma transaction to
 * prevent race conditions where two concurrent appeals could both pass the
 * quota check.
 *
 * @throws {QuotaExceeded} if the buyer has no appeals remaining this period
 */
export async function fileAppeal(
  prisma: PrismaClient,
  args: FileAppealArgs,
  now: Date = new Date(),
) {
  const { requestId, buyerId, justification } = args;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Fetch buyer's household for quota settings
    const member = await tx.householdMember.findUniqueOrThrow({
      where: { id: buyerId },
      include: { household: true },
    });
    const household: HouseholdQuota = {
      appealQuotaCount: member.household.appealQuotaCount,
      appealQuotaPeriod: member.household.appealQuotaPeriod,
    };

    const remaining = await appealsRemaining(tx, buyerId, household, now);
    if (remaining <= 0) {
      throw new QuotaExceeded(
        `no appeals remaining this ${household.appealQuotaPeriod} period`,
      );
    }

    const periodKey = currentPeriodKey(household.appealQuotaPeriod, now);

    return tx.appeal.create({
      data: {
        requestId,
        buyerId,
        justification,
        periodKey,
        status: 'pending',
      },
    });
  });
}
