/**
 * scheduled.ts — Six scheduled job functions (Phase 8)
 *
 * Ports v1's apps/requests_app/tasks.py.
 *
 * Each function is a plain async fn taking (prisma, now?) so tests can call
 * them directly with a controlled clock without needing BullMQ at all.
 *
 * Notification dedup is handled inside notify() via NotificationLog, so
 * re-running these jobs is safe (idempotent).
 *
 * Jobs:
 *   expireCooldowns         — every 10 min  → delayed → awaiting_reconfirm
 *   expireReconfirms        — every 1 hour  → awaiting_reconfirm → archived
 *   expireApprovals         — every 1 hour  → approved → archived
 *   approvalExpiringWarnings — daily 09:00  → notify buyer 3d before expiry
 *   stalePendingReminders   — every 1 hour  → notify approvers at d3/7/14
 *   needRatedReminders      — every 30 min  → notify approvers at 6h/24h
 */

import type { PrismaClient } from '@prisma/client';
import { IllegalTransition, transition } from '../lib/state.js';
import { notify } from '../services/notify.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Load a request with buyer + approver relations needed for notifications.
 */
async function loadRequestWithApprovers(prisma: PrismaClient, requestId: number) {
  return prisma.request.findUnique({
    where: { id: requestId },
    include: {
      buyer: {
        include: {
          user: { select: { id: true } },
          approverLinks: {
            include: {
              approver: {
                include: {
                  user: { select: { id: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

// ── Expiration jobs ───────────────────────────────────────────────────────────

/**
 * Find delayed requests whose cooldown has elapsed; transition to awaiting_reconfirm.
 * Cadence: every 10 minutes.
 */
export async function expireCooldowns(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  const expired = await prisma.request.findMany({
    where: {
      status: 'delayed',
      statusExpiresAt: { lt: now },
    },
    select: { id: true },
  });

  for (const { id } of expired) {
    try {
      await transition(prisma, id, 'expire', {});
    } catch (err) {
      if (err instanceof IllegalTransition) continue;
      throw err;
    }
  }
}

/**
 * Find awaiting_reconfirm requests past their deadline; transition to archived.
 * Cadence: every 1 hour.
 */
export async function expireReconfirms(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  const expired = await prisma.request.findMany({
    where: {
      status: 'awaiting_reconfirm',
      statusExpiresAt: { lt: now },
    },
    select: { id: true },
  });

  for (const { id } of expired) {
    try {
      await transition(prisma, id, 'timeout', {});
    } catch (err) {
      if (err instanceof IllegalTransition) continue;
      throw err;
    }
  }
}

/**
 * Find approved-but-not-purchased requests past 30 days; transition to archived.
 * Cadence: every 1 hour.
 */
export async function expireApprovals(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  const expired = await prisma.request.findMany({
    where: {
      status: 'approved',
      statusExpiresAt: { lt: now },
    },
    select: { id: true },
  });

  for (const { id } of expired) {
    try {
      await transition(prisma, id, 'expire', {});
    } catch (err) {
      if (err instanceof IllegalTransition) continue;
      throw err;
    }
  }
}

// ── Reminder jobs ─────────────────────────────────────────────────────────────

/**
 * Daily 09:00. Notify buyers 3 days before their approval expires (idempotent).
 * Window: statusExpiresAt between (now + 2d23h) and (now + 3d1h) — matches v1.
 */
export async function approvalExpiringWarnings(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  const windowStart = new Date(now.getTime() + (2 * 24 + 23) * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + (3 * 24 + 1) * 60 * 60 * 1000);

  const requests = await prisma.request.findMany({
    where: {
      status: 'approved',
      statusExpiresAt: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    include: {
      buyer: {
        include: {
          user: { select: { id: true } },
        },
      },
    },
  });

  for (const req of requests) {
    const expiresAt = req.statusExpiresAt!;
    const dateStr = expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    await notify(
      prisma,
      req.buyer.user.id,
      `approval_expiring:req_${req.id}`,
      'approval_expiring',
      {
        title: `Approval expiring soon: ${req.title}`,
        body: `Until ${dateStr}`,
        url: `/requests/${req.id}`,
      },
      now,
    );
  }
}

/**
 * Hourly. Day-3, day-7, day-14 reminders to approvers for stale pending requests.
 * Idempotent per (request, threshold, approver) via NotificationLog.
 */
export async function stalePendingReminders(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  const thresholds: Array<{ days: number; keySuffix: string }> = [
    { days: 3, keySuffix: 'day_3' },
    { days: 7, keySuffix: 'day_7' },
    { days: 14, keySuffix: 'day_14' },
  ];

  for (const { days, keySuffix } of thresholds) {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const requests = await prisma.request.findMany({
      where: {
        status: 'pending',
        createdAt: { lte: cutoff },
      },
      select: { id: true, title: true, buyerId: true },
    });

    for (const req of requests) {
      const full = await loadRequestWithApprovers(prisma, req.id);
      if (!full) continue;

      for (const link of full.buyer.approverLinks) {
        const approver = link.approver;
        await notify(
          prisma,
          approver.user.id,
          `stale_${keySuffix}:req_${req.id}:user_${approver.user.id}`,
          'stale_pending',
          {
            title: `Stale pending: ${req.title}`,
            body: `${days} days waiting`,
            url: `/requests/${req.id}`,
          },
          now,
        );
      }
    }
  }
}

/**
 * Every 30 minutes. Notify approvers for need-rated pending requests at 6h and 24h marks.
 * Uses a ±35-minute window around each threshold, matching v1's margin.
 * Idempotent per (request, threshold, approver) via NotificationLog.
 */
export async function needRatedReminders(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  const thresholds: Array<{ hours: number; keySuffix: string }> = [
    { hours: 6, keySuffix: '6h' },
    { hours: 24, keySuffix: '24h' },
  ];

  const marginMs = 35 * 60 * 1000; // 35 minutes

  for (const { hours, keySuffix } of thresholds) {
    const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const windowStart = new Date(cutoff.getTime() - marginMs);

    const requests = await prisma.request.findMany({
      where: {
        status: 'pending',
        buyerSeriousness: 'need',
        createdAt: {
          lte: cutoff,
          gte: windowStart,
        },
      },
      select: { id: true, title: true, buyerId: true },
    });

    for (const req of requests) {
      const full = await loadRequestWithApprovers(prisma, req.id);
      if (!full) continue;

      for (const link of full.buyer.approverLinks) {
        const approver = link.approver;
        await notify(
          prisma,
          approver.user.id,
          `need_${keySuffix}:req_${req.id}:user_${approver.user.id}`,
          'need_rated_reminder',
          {
            title: `NEED-rated request: ${req.title}`,
            body: `${hours}h waiting`,
            url: `/requests/${req.id}`,
          },
          now,
        );
      }
    }
  }
}
