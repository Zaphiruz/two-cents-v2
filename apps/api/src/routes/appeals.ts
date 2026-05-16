/**
 * appeals.ts — Appeal routes (Phase 5)
 *
 * POST /api/appeals              — file an appeal on a denied request (buyer only)
 * GET  /api/appeals/queue        — pending appeals where caller is approver of buyer
 * POST /api/appeals/:id/resolve  — resolve an appeal (overturn or uphold)
 *
 * v1 reference: apps/appeals/views.py
 */

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { FileAppealInputSchema, ResolveAppealInputSchema } from '@two-cents/shared';
import { authGuard } from '../lib/auth-utils.js';
import { memberForUser } from '../lib/permissions.js';
import { fileAppeal } from '../services/appeals.js';
import { transitionOnTx } from '../lib/state.js';
import { fireEvent } from '../services/events.js';

export default async function appealsRoutes(app: FastifyInstance) {
  // ── POST /api/appeals ─────────────────────────────────────────────────────
  //
  // File an appeal on a denied request.
  // Permission: caller must be the buyer of the request.
  // Status guard: request must be in 'denied' status.
  // Quota guard: fileAppeal throws QuotaExceeded → error handler maps to 422.
  //
  // v1 reference: new_appeal view (GET/POST), get_object_or_404(Request, pk=pk, buyer=member, status="denied")
  // TODO(Phase 6): fireEvent('appeal_filed', appeal)

  app.post('/api/appeals', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const body = FileAppealInputSchema.parse(req.body);

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    // Single query: fetch buyerId + status to avoid two round-trips on the same row
    const request = await app.prisma.request.findUnique({
      where: { id: body.requestId },
      select: { buyerId: true, status: true },
    });
    if (!request) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (request.buyerId !== member.id) {
      reply.code(403).send({ error: 'not_buyer' });
      return;
    }
    if (request.status !== 'denied') {
      reply.code(409).send({ error: 'not_appealable', message: 'only denied requests can be appealed' });
      return;
    }

    // fileAppeal validates quota internally; throws QuotaExceeded → error handler → 422
    const appeal = await fileAppeal(app.prisma, {
      requestId: body.requestId,
      buyerId: member.id,
      justification: body.justification,
    });

    // Fire appeal_filed event — notify all approvers.
    // Wrapped in try/catch: notification failure must NOT break the request lifecycle.
    try {
      await fireEvent(app.prisma, 'appeal_filed', { appealId: appeal.id });
    } catch (err) {
      req.log.error({ err, appealId: appeal.id }, 'fireEvent appeal_filed failed');
    }

    reply.code(201).send(appeal);
  });

  // ── GET /api/appeals/queue ────────────────────────────────────────────────
  //
  // Returns pending appeals where the caller is an approver of the appeal's buyer.
  // Ordered oldest-first (FIFO) so approvers work through a fair queue.
  // Not-in-household returns empty array (REST-friendly; mirrors v1 returning empty queryset).
  //
  // v1 reference: queue view — Appeal.objects.filter(status="pending", request__buyer__approver_links__approver=member).order_by("created_at")

  app.get('/api/appeals/queue', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      // Not in any household — no approver links possible; return empty queue
      return { appeals: [] };
    }

    // Find all buyer ids for which this member is an approver
    const links = await app.prisma.buyerApprover.findMany({
      where: { approverId: member.id },
      select: { buyerId: true },
    });
    const buyerIds = links.map((l: { buyerId: number }) => l.buyerId);

    if (buyerIds.length === 0) {
      return { appeals: [] };
    }

    // Pending appeals by those buyers, oldest first
    const appeals = await app.prisma.appeal.findMany({
      where: { buyerId: { in: buyerIds }, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: {
        request: {
          include: {
            items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
          },
        },
        buyer: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    return { appeals };
  });

  // ── POST /api/appeals/:id/resolve ─────────────────────────────────────────
  //
  // Resolve an appeal as overturn or uphold.
  // Permission: caller must be an approver of the appeal's buyer.
  // State guard: appeal must be 'pending'.
  // On overturn: update appeal.status='overturned' AND transition request 'denied' → 'pending'
  //              via transitionOnTx inside a single outer transaction (no nested transactions).
  // On uphold:   update appeal.status='upheld'; request status unchanged.
  //
  // v1 reference: resolve view — get_object_or_404(Appeal, pk=pk, status="pending"), then approver check
  // TODO(Phase 6): fireEvent('appeal_resolved', updated)

  app.post<{ Params: { id: string } }>('/api/appeals/:id/resolve', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const appealId = Number(req.params.id);
    if (!Number.isFinite(appealId) || !Number.isInteger(appealId) || appealId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    const body = ResolveAppealInputSchema.parse(req.body);

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    // Load the appeal to verify existence and current status
    const appeal = await app.prisma.appeal.findUnique({
      where: { id: appealId },
      select: { id: true, requestId: true, buyerId: true, status: true },
    });
    if (!appeal) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }

    // Permission: caller must be an approver of the appeal's buyer
    const link = await app.prisma.buyerApprover.findFirst({
      where: { approverId: member.id, buyerId: appeal.buyerId },
    });
    if (!link) {
      reply.code(403).send({ error: 'not_approver' });
      return;
    }

    // State guard: appeal must still be pending
    if (appeal.status !== 'pending') {
      reply.code(409).send({ error: 'appeal_not_pending', message: 'appeal has already been resolved' });
      return;
    }

    // Perform the resolution atomically.
    // IMPORTANT: use transitionOnTx (not transition) to avoid nesting Prisma transactions.
    const updated = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newStatus = body.decision === 'overturn' ? 'overturned' : 'upheld';
      const updatedAppeal = await tx.appeal.update({
        where: { id: appealId },
        data: { status: newStatus, resolvedAt: new Date() },
      });
      if (body.decision === 'overturn') {
        // appeal_overturned: denied → pending (state machine transition)
        await transitionOnTx(tx, appeal.requestId, 'appeal_overturned', {
          actorId: member.id,
        });
      }
      return updatedAppeal;
    });

    // Fire appeal_resolved event — notify the buyer with the outcome.
    // Wrapped in try/catch: notification failure must NOT break the request lifecycle.
    const outcome = body.decision === 'overturn' ? 'overturned' : 'upheld';
    try {
      await fireEvent(app.prisma, 'appeal_resolved', {
        appealId: appeal.id,
        outcome,
      });
    } catch (err) {
      req.log.error({ err, appealId: appeal.id, outcome }, 'fireEvent appeal_resolved failed');
    }

    return updated;
  });
}
