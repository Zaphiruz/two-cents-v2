/**
 * resolution.ts — port of v1 resolution.py
 *
 * Pure helper for households configured in "all" mode (every approver must act).
 * Inspects the latest review from each required approver and returns an aggregate
 * resolution, or null when not all required approvers have acted yet.
 *
 * Return values:
 *   "approved"          — all required approvers approved
 *   "denied"            — at least one approver denied (deny dominates)
 *   ["delayed", days]   — at least one delayed and none denied; longest delay wins
 *   null                — not all required approvers have acted yet (still pending)
 */

import type { ApproverAction } from '@two-cents/shared';

/** Minimal shape of a review needed for resolution logic. */
export interface ReviewInput {
  approverId: number;
  action: ApproverAction;
  /** Null unless action === "delay". */
  delayDays: number | null;
  /** Used to pick the latest review per approver when duplicates exist. */
  createdAt: Date;
}

export type ResolutionResult =
  | 'approved'
  | 'denied'
  | ['delayed', number]
  | null;

/**
 * Resolve the aggregate decision for an "all"-mode request.
 *
 * @param requiredApproverIds - Set of HouseholdMember IDs who must all act.
 * @param reviews             - All reviews for the request (may include multiple
 *                              reviews per approver; the latest by createdAt wins).
 * @returns The aggregate resolution, or null if more reviews are still needed.
 */
export function resolveAllMode(
  requiredApproverIds: ReadonlySet<number>,
  reviews: readonly ReviewInput[],
): ResolutionResult {
  // Build a map of approver → latest review (mirrors v1's order_by + overwrite loop)
  const latest = new Map<number, ReviewInput>();
  for (const rv of [...reviews].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )) {
    latest.set(rv.approverId, rv);
  }

  // If any required approver hasn't acted yet, still pending
  for (const id of requiredApproverIds) {
    if (!latest.has(id)) return null;
  }

  // Deny dominates
  for (const id of requiredApproverIds) {
    if (latest.get(id)!.action === 'deny') return 'denied';
  }

  // Delay dominates over approve (longest delay wins)
  const delayReviews = [...requiredApproverIds]
    .map((id) => latest.get(id)!)
    .filter((rv) => rv.action === 'delay');

  if (delayReviews.length > 0) {
    const longest = Math.max(...delayReviews.map((rv) => rv.delayDays ?? 0));
    return ['delayed', longest];
  }

  return 'approved';
}
