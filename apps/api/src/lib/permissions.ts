/**
 * permissions.ts — port of v1's apps/core/permissions.py
 *
 * Three helpers that determine what a user (identified by userId) may do to a
 * request (identified by requestId). All helpers accept either PrismaClient or
 * Prisma.TransactionClient so they can be called from inside transactions.
 *
 * v1 semantics (permissions.py + views.py):
 *   isBuyer   — the caller's HouseholdMember is the request's buyer
 *   canAct    — the caller is an approver of the buyer (BuyerApprover link exists)
 *   canView   — buyer OR approver of buyer (no admin bypass in v1)
 *
 * Returning `false` (not throwing) on unknown userId / requestId keeps route logic
 * clean: the route checks canView → false → replies 403 (or 404 if not found at all).
 */

import { Prisma, PrismaClient } from '@prisma/client';

type DB = PrismaClient | Prisma.TransactionClient;

/**
 * Returns the HouseholdMember id for `userId`, or null if the user has no
 * membership. Used internally by all three helpers.
 */
async function memberIdForUser(db: DB, userId: number): Promise<number | null> {
  const member = await db.householdMember.findFirst({
    where: { userId },
    select: { id: true },
  });
  return member?.id ?? null;
}

// ── isBuyer ───────────────────────────────────────────────────────────────────

/**
 * Returns true if `userId`'s HouseholdMember is the buyer of `requestId`.
 * Returns false for unknown user, unknown request, or mismatched buyer.
 */
export async function isBuyer(db: DB, userId: number, requestId: number): Promise<boolean> {
  const memberId = await memberIdForUser(db, userId);
  if (memberId === null) return false;

  const request = await db.request.findUnique({
    where: { id: requestId },
    select: { buyerId: true },
  });
  if (!request) return false;

  return request.buyerId === memberId;
}

// ── canAct ────────────────────────────────────────────────────────────────────

/**
 * Returns true if `userId` is an approver of the request's buyer.
 * This is a pure relationship check — callers may additionally gate on request
 * status (e.g. only allow approve/deny when status === 'pending').
 * Returns false for unknown user, unknown request, or no approver link.
 */
export async function canAct(db: DB, userId: number, requestId: number): Promise<boolean> {
  const memberId = await memberIdForUser(db, userId);
  if (memberId === null) return false;

  const request = await db.request.findUnique({
    where: { id: requestId },
    select: { buyerId: true },
  });
  if (!request) return false;

  const link = await db.buyerApprover.findFirst({
    where: { buyerId: request.buyerId, approverId: memberId },
    select: { id: true },
  });

  return link !== null;
}

// ── canView ───────────────────────────────────────────────────────────────────

/**
 * Returns true if `userId` may view `requestId` — i.e. they are the buyer OR
 * an approver of the buyer. Mirrors v1's can_view() (no admin bypass in v1).
 * Returns false for unknown user or unknown request.
 */
export async function canView(db: DB, userId: number, requestId: number): Promise<boolean> {
  if (await isBuyer(db, userId, requestId)) return true;
  if (await canAct(db, userId, requestId)) return true;
  return false;
}
