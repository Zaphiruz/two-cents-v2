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
 *
 * *ByMember variants (isBuyerByMember, canActByMember, canViewByMember) accept a
 * pre-fetched memberId instead of a userId. Mutation routes call memberForUser once
 * up-front, then use these variants to avoid a redundant member lookup.
 * These helpers return null when the request doesn't exist (allowing routes to
 * distinguish 404 from 403) and false when the member lacks permission.
 */

import { Prisma, PrismaClient } from '@prisma/client';

type DB = PrismaClient | Prisma.TransactionClient;

/**
 * Returns the HouseholdMember id for `userId`, or null if the user has no
 * membership. Used internally by all three helpers; routes typically use
 * memberForUser instead to get the full member row.
 */
export async function memberIdForUser(db: DB, userId: number): Promise<number | null> {
  const member = await db.householdMember.findFirst({
    where: { userId },
    select: { id: true },
  });
  return member?.id ?? null;
}

/**
 * Returns the full HouseholdMember row for `userId`, or null if the user has no
 * membership. Routes that need householdId or other fields use this instead of
 * memberIdForUser.
 */
export async function memberForUser(
  db: DB,
  userId: number,
): Promise<{ id: number; householdId: number } | null> {
  return db.householdMember.findFirst({
    where: { userId },
    select: { id: true, householdId: true },
  });
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
 *
 * Refactored to fetch member + request once (not via recursive isBuyer/canAct
 * calls) — max 3 queries: member lookup, request lookup, approver-link check.
 */
export async function canView(db: DB, userId: number, requestId: number): Promise<boolean> {
  const memberId = await memberIdForUser(db, userId);
  if (memberId === null) return false;

  const request = await db.request.findUnique({
    where: { id: requestId },
    select: { id: true, buyerId: true },
  });
  if (!request) return false;

  // Buyer can always view their own request
  if (request.buyerId === memberId) return true;

  // Otherwise check approver link
  const link = await db.buyerApprover.findFirst({
    where: { approverId: memberId, buyerId: request.buyerId },
    select: { id: true },
  });
  return link !== null;
}

// ── *ByMember variants ────────────────────────────────────────────────────────
//
// Mutation routes call memberForUser once up-front, then use these helpers to
// avoid a redundant member lookup. Returns null when the request doesn't exist
// (so the route can reply 404), false when the member lacks permission.

/**
 * Same as isBuyer but takes a prefetched memberId so the caller can avoid the
 * additional householdMember lookup. Returns true when the request's buyer is
 * this member.
 *
 * Returns null if the request doesn't exist.
 */
export async function isBuyerByMember(
  db: DB,
  memberId: number,
  requestId: number,
): Promise<boolean | null> {
  const req = await db.request.findUnique({
    where: { id: requestId },
    select: { id: true, buyerId: true },
  });
  if (!req) return null;
  return req.buyerId === memberId;
}

/**
 * Same as canAct but takes a prefetched memberId.
 * Returns null if the request doesn't exist.
 */
export async function canActByMember(
  db: DB,
  memberId: number,
  requestId: number,
): Promise<boolean | null> {
  const req = await db.request.findUnique({
    where: { id: requestId },
    select: { id: true, buyerId: true },
  });
  if (!req) return null;
  const link = await db.buyerApprover.findFirst({
    where: { approverId: memberId, buyerId: req.buyerId },
  });
  return link !== null;
}

/**
 * Same as canView but takes a prefetched memberId.
 * Returns null if the request doesn't exist.
 */
export async function canViewByMember(
  db: DB,
  memberId: number,
  requestId: number,
): Promise<boolean | null> {
  const req = await db.request.findUnique({
    where: { id: requestId },
    select: { id: true, buyerId: true },
  });
  if (!req) return null;
  if (req.buyerId === memberId) return true;
  const link = await db.buyerApprover.findFirst({
    where: { approverId: memberId, buyerId: req.buyerId },
  });
  return link !== null;
}
