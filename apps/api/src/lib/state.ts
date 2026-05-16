/**
 * state.ts — port of v1 state.py
 *
 * Single source of truth for request state changes.
 * All transitions happen inside a Prisma interactive transaction.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { RequestStatus } from '@two-cents/shared';
import { autoDelay, clampOverride, msToDelayDays, type Seriousness } from './delays.js';

// ── Constants ────────────────────────────────────────────────────────────────

const APPROVAL_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RECONFIRM_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Error class ──────────────────────────────────────────────────────────────

export class IllegalTransition extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalTransition';
  }
}

// ── Allowed transition table ─────────────────────────────────────────────────

type StateKey = `${string}:${string}`;

const ALLOWED: Map<StateKey, RequestStatus> = new Map([
  ['pending:approve', 'approved'],
  ['pending:delay', 'delayed'],
  ['pending:deny', 'denied'],
  ['pending:cancel', 'cancelled'],
  ['pending:edit_meaningful', 'pending'],
  ['delayed:cancel', 'cancelled'],
  ['delayed:expire', 'awaiting_reconfirm'],
  ['delayed:edit_meaningful', 'pending'],
  ['awaiting_reconfirm:reconfirm', 'pending'],
  ['awaiting_reconfirm:timeout', 'archived'],
  ['awaiting_reconfirm:cancel', 'cancelled'],
  ['awaiting_reconfirm:edit_meaningful', 'pending'],
  ['approved:purchase', 'purchased'],
  ['approved:expire', 'archived'],
  ['approved:cancel', 'cancelled'],
  ['denied:appeal_overturned', 'pending'],
  ['denied:archive', 'archived'],
]);

// ── Options type ─────────────────────────────────────────────────────────────

export interface TransitionOpts {
  /** HouseholdMember ID of the actor (approver for review actions; buyer for buyer actions) */
  actorId?: number;
  /** Approver's seriousness judgment — required for approve/delay/deny */
  approverSeriousness?: Seriousness;
  /** Optional override for delay duration, in milliseconds */
  delayOverrideMs?: number;
  /** Optional free-text notes from the approver, written to the Review row */
  notes?: string;
}

// ── Return type ───────────────────────────────────────────────────────────────

export interface UpdatedRequest {
  id: number;
  status: RequestStatus;
  statusExpiresAt: Date | null;
}

// ── transitionOnTx ────────────────────────────────────────────────────────────

/**
 * Core transition logic executed on an already-open TransactionClient.
 * Callers that need atomicity with other writes should open their own
 * $transaction and pass the resulting `tx` here.
 *
 * @throws {IllegalTransition} if the (current_status, action) pair is not in ALLOWED
 */
export async function transitionOnTx(
  tx: Prisma.TransactionClient,
  requestId: number,
  action: string,
  opts: TransitionOpts,
): Promise<UpdatedRequest> {
  // Fetch current request with its first item (for price_cents lookup)
  const req = await tx.request.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      items: {
        orderBy: { position: 'asc' },
        take: 1,
      },
    },
  });

  const key: StateKey = `${req.status}:${action}`;
  const newStatus = ALLOWED.get(key);
  if (newStatus === undefined) {
    throw new IllegalTransition(`${req.status} -> ${action}`);
  }

  const now = new Date();
  let newStatusExpiresAt: Date | null = req.statusExpiresAt;
  let reviewData: ReviewCreateInput | null = null;

  if (action === 'approve') {
    const seriousness = requireSeriousness(opts, action);
    newStatusExpiresAt = new Date(now.getTime() + APPROVAL_VALIDITY_MS);
    reviewData = { action: 'approve', approverSeriousness: seriousness };
  } else if (action === 'delay') {
    const seriousness = requireSeriousness(opts, action);
    // Use price of the first item for auto-delay calculation
    const priceCents = req.items[0]?.priceCents ?? 0;
    const autoMs = autoDelay(priceCents, seriousness);
    const durationMs =
      opts.delayOverrideMs !== undefined
        ? clampOverride(autoMs, opts.delayOverrideMs)
        : autoMs;
    const delayExpiresAt = new Date(now.getTime() + durationMs);
    newStatusExpiresAt = delayExpiresAt;
    reviewData = {
      action: 'delay',
      approverSeriousness: seriousness,
      delayDays: msToDelayDays(durationMs),
      delayExpiresAt,
    };
  } else if (action === 'deny') {
    const seriousness = requireSeriousness(opts, action);
    reviewData = { action: 'deny', approverSeriousness: seriousness };
    // status_expires_at unchanged (stays null/whatever it was — v1 doesn't set it for deny)
  } else if (action === 'expire' && req.status === 'delayed') {
    newStatusExpiresAt = new Date(now.getTime() + RECONFIRM_DEADLINE_MS);
  } else if (action === 'expire' && req.status === 'approved') {
    newStatusExpiresAt = null;
  } else if (
    action === 'purchase' ||
    action === 'reconfirm' ||
    action === 'cancel' ||
    action === 'timeout' ||
    action === 'archive' ||
    action === 'appeal_overturned' ||
    action === 'edit_meaningful'
  ) {
    newStatusExpiresAt = null;
  }

  // Update the request
  const updated = await tx.request.update({
    where: { id: requestId },
    data: {
      status: newStatus,
      statusExpiresAt: newStatusExpiresAt,
    },
  });

  // Write Review row when warranted (only for approve/delay/deny with an actor)
  if (reviewData !== null && opts.actorId !== undefined) {
    await tx.review.create({
      data: {
        requestId,
        approverId: opts.actorId,
        action: reviewData.action,
        approverSeriousness: reviewData.approverSeriousness,
        delayDays: reviewData.delayDays ?? null,
        delayExpiresAt: reviewData.delayExpiresAt ?? null,
        notes: opts.notes ?? '',
      },
    });
  }

  return {
    id: updated.id,
    status: updated.status,
    statusExpiresAt: updated.statusExpiresAt,
  };
}

// ── transition ────────────────────────────────────────────────────────────────

/**
 * Transitions a request to a new status, applying all side-effects
 * (status_expires_at, Review row) inside a Prisma transaction.
 *
 * @throws {IllegalTransition} if the (current_status, action) pair is not in ALLOWED
 */
export async function transition(
  prisma: PrismaClient,
  requestId: number,
  action: string,
  opts: TransitionOpts,
): Promise<UpdatedRequest> {
  return prisma.$transaction((tx: Prisma.TransactionClient) => transitionOnTx(tx, requestId, action, opts));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ReviewCreateInput {
  action: 'approve' | 'delay' | 'deny';
  approverSeriousness: Seriousness;
  delayDays?: number;
  delayExpiresAt?: Date;
}

function requireSeriousness(opts: TransitionOpts, action: string): Seriousness {
  if (!opts.approverSeriousness) {
    throw new Error(`approverSeriousness is required for action: ${action}`);
  }
  return opts.approverSeriousness;
}
