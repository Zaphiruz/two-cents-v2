/**
 * events.ts — Event payload builders + notification dispatcher (Phase 6b)
 *
 * Ports v1's apps/notifications/events.py fire_event() and per-event payload builders.
 *
 * Usage:
 *   import { fireEvent } from './services/events.js';
 *   await fireEvent(prisma, 'request_pending', { requestId: req.id });
 *
 * Each event type:
 *   request_pending — notifies all approvers (with quick-action tokens: approve/delay)
 *   approval        — notifies the buyer ("Approved")
 *   delay           — notifies the buyer ("Delayed")
 *   denial          — notifies the buyer ("Denied")
 *   reconfirm_due   — notifies the buyer ("Cooldown ended — still interested?")
 *   comment         — notifies buyer + all approvers MINUS the author
 *   appeal_filed    — notifies all approvers (with quick-action tokens)
 *   appeal_resolved — notifies the buyer (outcome: 'overturned' | 'upheld')
 *
 * v1 reference: apps/notifications/events.py
 */

import type { PrismaClient } from '@prisma/client';
import { signQuickAction } from '../lib/jwt.js';
import { notify, type NotificationPayload } from './notify.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventName =
  | 'request_pending'
  | 'approval'
  | 'delay'
  | 'denial'
  | 'reconfirm_due'
  | 'comment'
  | 'appeal_filed'
  | 'appeal_resolved';

export interface FireEventContext {
  requestId?: number;
  appealId?: number;
  /** For 'comment': the User.id of the author (not HouseholdMember.id) */
  authorUserId?: number;
  /** For 'comment': body excerpt */
  body?: string;
  /** For 'appeal_resolved': 'overturned' | 'upheld' */
  outcome?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the quick-action tokens for approve + delay actions.
 * Mirrors v1's _quick_action_tokens(req, approver).
 *
 * @param requestId  The request ID (embedded in the JWT claims)
 * @param approverId The HouseholdMember.id of the approver
 */
function quickActionTokens(
  requestId: number,
  approverId: number,
): { approve: string; delay: string } {
  return {
    approve: signQuickAction({ requestId, action: 'approve', approverId }),
    delay: signQuickAction({ requestId, action: 'delay', approverId }),
  };
}

/**
 * Build a simple buyer-status notification payload (no quick-action tokens).
 * Mirrors v1's _payload_status_for_buyer(req, title).
 */
function payloadStatusForBuyer(title: string, requestTitle: string, requestId: number): NotificationPayload {
  return {
    title,
    body: requestTitle,
    url: `/requests/${requestId}`,
  };
}

// ── Request data fetchers ─────────────────────────────────────────────────────

/**
 * Load a request with all relations needed for event payload building.
 * Returns null if the request doesn't exist.
 */
async function loadRequest(prisma: PrismaClient, requestId: number) {
  return prisma.request.findUnique({
    where: { id: requestId },
    include: {
      buyer: {
        include: {
          user: { select: { id: true, name: true } },
          approverLinks: {
            include: {
              approver: {
                include: {
                  user: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
      items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
    },
  });
}

/**
 * Load an appeal with its request and buyer relations.
 * Returns null if the appeal doesn't exist.
 */
async function loadAppeal(prisma: PrismaClient, appealId: number) {
  return prisma.appeal.findUnique({
    where: { id: appealId },
    include: {
      request: {
        include: {
          buyer: {
            include: {
              user: { select: { id: true, name: true } },
              approverLinks: {
                include: {
                  approver: {
                    include: {
                      user: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
          items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
        },
      },
    },
  });
}

// ── fireEvent ─────────────────────────────────────────────────────────────────

/**
 * Dispatch push notifications for a given event.
 *
 * NOTE: fireEvent is designed to be called from route handlers inside a try/catch.
 * If notification delivery fails, the route should log and continue — the request
 * lifecycle is more important than push delivery. This function itself does NOT
 * swallow errors from the DB lookups (those indicate a programming error), but
 * individual push delivery failures are handled inside notify().
 *
 * @param prisma    PrismaClient
 * @param eventName The event that occurred
 * @param ctx       Context (requestId, appealId, authorUserId, body, outcome)
 */
export async function fireEvent(
  prisma: PrismaClient,
  eventName: EventName,
  ctx: FireEventContext,
): Promise<void> {
  switch (eventName) {
    case 'request_pending': {
      const req = await loadRequest(prisma, ctx.requestId!);
      if (!req) return;

      // Build payload title from items (mirrors v1's _payload_request_pending logic)
      const itemCount = req.items.length;
      let titleText: string;
      if (itemCount > 1) {
        const total = req.items.reduce((sum: number, i: { priceCents: number }) => sum + i.priceCents, 0);
        titleText = `New request: $${(total / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${itemCount} items) ${req.title}`;
      } else if (req.items[0]) {
        const first = req.items[0];
        titleText = `New request: $${(first.priceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${first.title}`;
      } else {
        titleText = `New request: ${req.title}`;
      }

      const buyerName = req.buyer.user.name;
      const seriousness = req.buyerSeriousness;
      const seriousnessDisplay: Record<string, string> = {
        need: 'Need',
        really_want: 'Really Want',
        nice_to_have: 'Nice to Have',
      };

      // Notify each approver with their own quick-action tokens
      for (const link of req.buyer.approverLinks) {
        const approver = link.approver;
        const tokens = quickActionTokens(req.id, approver.id);
        const payload: NotificationPayload = {
          title: titleText,
          body: `${buyerName} rated: ${seriousnessDisplay[seriousness] ?? seriousness}`,
          url: `/requests/${req.id}`,
          tokens,
        };
        await notify(
          prisma,
          approver.user.id,
          `request_pending:${req.id}`,
          'request_pending',
          payload,
        );
      }
      break;
    }

    case 'approval': {
      const req = await loadRequest(prisma, ctx.requestId!);
      if (!req) return;
      await notify(
        prisma,
        req.buyer.user.id,
        `approval:${req.id}`,
        'approval',
        payloadStatusForBuyer('Approved', req.title, req.id),
      );
      break;
    }

    case 'delay': {
      const req = await loadRequest(prisma, ctx.requestId!);
      if (!req) return;
      await notify(
        prisma,
        req.buyer.user.id,
        `delay:${req.id}`,
        'delay',
        payloadStatusForBuyer('Delayed', req.title, req.id),
      );
      break;
    }

    case 'denial': {
      const req = await loadRequest(prisma, ctx.requestId!);
      if (!req) return;
      await notify(
        prisma,
        req.buyer.user.id,
        `denial:${req.id}`,
        'denial',
        payloadStatusForBuyer('Denied', req.title, req.id),
      );
      break;
    }

    case 'reconfirm_due': {
      const req = await loadRequest(prisma, ctx.requestId!);
      if (!req) return;
      await notify(
        prisma,
        req.buyer.user.id,
        `reconfirm_due:${req.id}`,
        'reconfirm_due',
        payloadStatusForBuyer('Cooldown ended — still interested?', req.title, req.id),
      );
      break;
    }

    case 'comment': {
      // author is excluded; everyone else (buyer + all approvers) is notified
      const req = await loadRequest(prisma, ctx.requestId!);
      if (!req) return;

      const authorUserId = ctx.authorUserId!;
      const bodyExcerpt = (ctx.body ?? '').slice(0, 120);

      const recipientUserIds = new Set<number>();
      recipientUserIds.add(req.buyer.user.id);
      for (const link of req.buyer.approverLinks) {
        recipientUserIds.add(link.approver.user.id);
      }
      // Exclude the author
      recipientUserIds.delete(authorUserId);

      const payload: NotificationPayload = {
        title: `Comment on ${req.title}`,
        body: bodyExcerpt,
        url: `/requests/${req.id}`,
      };

      for (const recipientUserId of recipientUserIds) {
        await notify(
          prisma,
          recipientUserId,
          `comment:${req.id}:${ctx.body?.slice(0, 50) ?? ''}`,
          'comment',
          payload,
        );
      }
      break;
    }

    case 'appeal_filed': {
      const appeal = await loadAppeal(prisma, ctx.appealId!);
      if (!appeal) return;

      const req = appeal.request;
      const buyerName = req.buyer.user.name;

      // Notify each approver with quick-action tokens
      for (const link of req.buyer.approverLinks) {
        const approver = link.approver;
        const tokens = quickActionTokens(req.id, approver.id);
        const payload: NotificationPayload = {
          title: `Appeal: ${req.title}`,
          body: `${buyerName} appealed your denial`,
          url: `/appeals/queue`,
          tokens,
        };
        await notify(
          prisma,
          approver.user.id,
          `appeal_filed:${appeal.id}`,
          'appeal_filed',
          payload,
        );
      }
      break;
    }

    case 'appeal_resolved': {
      const appeal = await loadAppeal(prisma, ctx.appealId!);
      if (!appeal) return;

      const req = appeal.request;
      const outcome = ctx.outcome ?? 'resolved';
      await notify(
        prisma,
        req.buyer.user.id,
        `appeal_resolved:${appeal.id}`,
        'appeal_resolved',
        payloadStatusForBuyer(`Appeal ${outcome}`, req.title, req.id),
      );
      break;
    }

    default:
      // Unknown event — log but don't throw
      break;
  }
}
