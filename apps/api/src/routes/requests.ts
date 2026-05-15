/**
 * requests.ts — request-bundle routes (Task 4.2a)
 *
 * GET  /api/requests       — queue: incoming (pending, as approver) + myActive
 * POST /api/requests       — create a new request with items
 * GET  /api/requests/:id   — detail: request + items + reviews + comments + appealsRemaining
 *
 * Mutation endpoints (PATCH, act, cancel, reconfirm, purchase, comments) come
 * in Task 4.2b.
 *
 * v1 reference: apps/requests_app/views.py (queue, new_request, detail views)
 * Permission reference: apps/core/permissions.py
 */

import type { FastifyInstance } from 'fastify';
import { NewRequestInputSchema, ACTIVE_STATUSES } from '@two-cents/shared';
import { canView } from '../lib/permissions.js';
import { appealsRemaining } from '../services/appeals.js';

export default async function requestsRoutes(app: FastifyInstance) {
  // ── GET /api/requests ─────────────────────────────────────────────────────
  //
  // Returns:
  //   incoming  — requests where I am an approver of the buyer, status=pending
  //               (v1 queue_view: status == 'pending' only for incoming)
  //   myActive  — requests where I am the buyer, in active statuses
  //               (v1: ["pending","delayed","awaiting_reconfirm","approved","denied"])

  app.get('/api/requests', async (req, reply) => {
    const userId = req.session.userId;
    if (!userId) {
      reply.code(401).send({ error: 'not_authenticated' });
      return;
    }

    // Find this user's HouseholdMember (users may not be in any household yet)
    const member = await app.prisma.householdMember.findFirst({
      where: { userId },
      select: { id: true, householdId: true },
    });
    if (!member) {
      // Not in any household — empty queues (mirrors v1 returning no_household page)
      return { incoming: [], myActive: [] };
    }

    // myActive: requests I filed that are still "active" (v1 active_statuses)
    const myActive = await app.prisma.request.findMany({
      where: {
        buyerId: member.id,
        status: { in: [...ACTIVE_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      },
    });

    // incoming: requests I can act on as approver, status=pending only
    // (v1 incoming: status=="pending", distinct, ordered by created_at asc)
    const approverLinks = await app.prisma.buyerApprover.findMany({
      where: { approverId: member.id },
      select: { buyerId: true },
    });
    const buyerIds = approverLinks.map((l: { buyerId: number }) => l.buyerId);

    const incoming = buyerIds.length === 0
      ? []
      : await app.prisma.request.findMany({
          where: {
            buyerId: { in: buyerIds },
            status: 'pending',
          },
          orderBy: { createdAt: 'asc' },
          include: {
            items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
            buyer: {
              select: {
                id: true,
                user: { select: { id: true, name: true } },
              },
            },
          },
        });

    return { incoming, myActive };
  });

  // ── POST /api/requests ────────────────────────────────────────────────────
  //
  // Creates a new request with one or more items in a single transaction.
  // Validates the request body against NewRequestInputSchema (Zod → 400 on failure).
  // Returns 201 with { id } of the newly created request.
  //
  // TODO(Phase 6): fireEvent('request_pending', created)

  app.post('/api/requests', async (req, reply) => {
    const userId = req.session.userId;
    if (!userId) {
      reply.code(401).send({ error: 'not_authenticated' });
      return;
    }

    // Validate body — ZodError propagates to the error handler which returns 400
    const body = NewRequestInputSchema.parse(req.body);

    const member = await app.prisma.householdMember.findFirst({
      where: { userId },
      select: { id: true, householdId: true },
    });
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    const approverCount = await app.prisma.buyerApprover.count({
      where: { buyerId: member.id },
    });
    if (approverCount === 0) {
      reply.code(400).send({ error: 'no_approvers' });
      return;
    }

    const created = await app.prisma.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      const newReq = await tx.request.create({
        data: {
          householdId: member.householdId,
          buyerId: member.id,
          title: body.title,
          description: body.description,
          buyerSeriousness: body.buyerSeriousness,
          currency: body.currency,
          status: 'pending',
        },
      });

      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i]!;
        await tx.requestItem.create({
          data: {
            requestId: newReq.id,
            title: item.title,
            url: item.url,
            priceCents: item.priceCents,
            notes: item.notes,
            imageKey: item.imageKey,
            position: i,
          },
        });
      }

      return newReq;
    });

    reply.code(201).send({ id: created.id });
  });

  // ── GET /api/requests/:id ─────────────────────────────────────────────────
  //
  // Returns:
  //   request          — full request row with items, reviews (with approver name),
  //                      comments (with author name), buyer (with user name)
  //   appealsRemaining — buyer's remaining appeal quota for this period
  //
  // Access control: canView (buyer OR approver of buyer).
  // Sensitive fields excluded: no oidcSubject on User selects.

  app.get<{ Params: { id: string } }>('/api/requests/:id', async (req, reply) => {
    const userId = req.session.userId;
    if (!userId) {
      reply.code(401).send({ error: 'not_authenticated' });
      return;
    }

    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || !Number.isInteger(requestId) || requestId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    if (!(await canView(app.prisma, userId, requestId))) {
      // canView returns false for unknown request IDs too, so the caller would
      // get 403. We need to distinguish "doesn't exist" from "exists but forbidden"
      // to return a proper 404. Check existence first.
      const exists = await app.prisma.request.findUnique({
        where: { id: requestId },
        select: { id: true },
      });
      if (!exists) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.code(403).send({ error: 'forbidden' });
      return;
    }

    const request = await app.prisma.request.findUnique({
      where: { id: requestId },
      include: {
        items: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
        },
        reviews: {
          include: {
            approver: {
              select: {
                id: true,
                user: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        comments: {
          include: {
            author: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        buyer: {
          select: {
            id: true,
            householdId: true,
            approvalMode: true,
            user: { select: { id: true, name: true } },
            household: {
              select: {
                id: true,
                name: true,
                appealQuotaCount: true,
                appealQuotaPeriod: true,
              },
            },
          },
        },
      },
    });

    // Shouldn't be null since canView passed, but guard for safety
    if (!request) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }

    const appealsRemainingCount = await appealsRemaining(
      app.prisma,
      request.buyer.id,
      {
        appealQuotaCount: request.buyer.household.appealQuotaCount,
        appealQuotaPeriod: request.buyer.household.appealQuotaPeriod,
      },
    );

    return { request, appealsRemaining: appealsRemainingCount };
  });
}
