/**
 * requests.ts — request-bundle routes (Task 4.2a + 4.2b)
 *
 * GET   /api/requests           — queue: incoming (pending, as approver) + myActive
 * POST  /api/requests           — create a new request with items
 * GET   /api/requests/:id       — detail: request + items + reviews + comments + appealsRemaining
 * PATCH /api/requests/:id       — edit bundle (buyer only)
 * POST  /api/requests/:id/act   — approver action (approve/delay/deny)
 * POST  /api/requests/:id/cancel    — buyer cancel
 * POST  /api/requests/:id/reconfirm — buyer reconfirm (after delay expires)
 * POST  /api/requests/:id/purchase  — buyer mark as purchased
 *
 * Comment route lives in routes/comments.ts (registered separately in buildApp.ts).
 *
 * v1 reference: apps/requests_app/views.py
 * Permission reference: apps/core/permissions.py
 */

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  NewRequestInputSchema,
  EditRequestInputSchema,
  ApproverActionInputSchema,
  ACTIVE_STATUSES,
} from '@two-cents/shared';
import {
  canView,
  memberForUser,
  isBuyerByMember,
  canActByMember,
} from '../lib/permissions.js';
import { authGuard } from '../lib/auth-utils.js';
import { appealsRemaining } from '../services/appeals.js';
import { saveRequestEdit } from '../services/saveRequestEdit.js';
import { transition } from '../lib/state.js';
import { DAY_MS } from '../lib/delays.js';
import { fireEvent } from '../services/events.js';

export default async function requestsRoutes(app: FastifyInstance) {
  // ── GET /api/requests ─────────────────────────────────────────────────────
  //
  // Returns:
  //   incoming  — requests where I am an approver of the buyer, status=pending
  //               (v1 queue_view: status == 'pending' only for incoming)
  //   myActive  — requests where I am the buyer, in active statuses
  //               (v1: ["pending","delayed","awaiting_reconfirm","approved","denied"])

  app.get('/api/requests', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    // Find this user's HouseholdMember (users may not be in any household yet)
    const member = await memberForUser(app.prisma, userId);
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
    const userId = authGuard(req, reply);
    if (userId === null) return;

    // Validate body — ZodError propagates to the error handler which returns 400
    const body = NewRequestInputSchema.parse(req.body);

    const member = await memberForUser(app.prisma, userId);
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

    const created = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    // Fire request_pending event — notify all approvers.
    // Wrapped in try/catch: notification failure must NOT break the request lifecycle.
    try {
      await fireEvent(app.prisma, 'request_pending', { requestId: created.id });
    } catch (err) {
      req.log.error({ err, requestId: created.id }, 'fireEvent request_pending failed');
    }

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
    const userId = authGuard(req, reply);
    if (userId === null) return;

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

  // ── PATCH /api/requests/:id ───────────────────────────────────────────────
  //
  // Edit a request's bundle fields and/or items.
  // Only the buyer may edit. Meaningful edits (price/url/add/remove) reset
  // status to pending via transitionOnTx('edit_meaningful').
  // IllegalTransition → 409 (request is in a non-editable state).
  //
  // v1 reference: views.py edit()
  // TODO(Phase 6): fireEvent if meaningful edit

  app.patch<{ Params: { id: string } }>('/api/requests/:id', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || !Number.isInteger(requestId) || requestId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    // Validate body — ZodError → 400
    const body = EditRequestInputSchema.parse(req.body);

    // Single member lookup — used for both permission check and actorId
    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    // isBuyerByMember: returns null if request missing (404), false if not buyer (403)
    const allowed = await isBuyerByMember(app.prisma, member.id, requestId);
    if (allowed === null) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (!allowed) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }

    const actorId = member.id;

    // saveRequestEdit throws IllegalTransition (→ 409) if status is non-editable
    const result = await saveRequestEdit(app.prisma, {
      requestId,
      actorId,
      bundleChanges: body.bundleChanges,
      itemsPayload: body.itemsPayload,
    });

    return { requestId: result.requestId, wasMeaningful: result.wasMeaningful };
  });

  // ── POST /api/requests/:id/act ────────────────────────────────────────────
  //
  // Approver action: approve, delay, or deny.
  // Gate: canAct (user must be an approver of the buyer).
  // Status guard: handled by transition() — throws IllegalTransition → 409.
  //
  // v1 reference: views.py act()
  // TODO(Phase 6): fireEvent('request_acted', updated)

  app.post<{ Params: { id: string } }>('/api/requests/:id/act', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || !Number.isInteger(requestId) || requestId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    // Validate body — ZodError → 400
    const body = ApproverActionInputSchema.parse(req.body);

    // Single member lookup — used for both permission check and actorId
    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    // canActByMember: returns null if request missing (404), false if not approver (403)
    const allowed = await canActByMember(app.prisma, member.id, requestId);
    if (allowed === null) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (!allowed) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }

    const actorId = member.id;

    // Convert optional delayOverrideDays → ms for the state machine
    const delayOverrideMs =
      body.delayOverrideDays !== undefined
        ? body.delayOverrideDays * DAY_MS
        : undefined;

    // transition throws IllegalTransition → 409 if action is not valid for current status
    const updated = await transition(app.prisma, requestId, body.action, {
      actorId,
      approverSeriousness: body.approverSeriousness,
      delayOverrideMs,
      notes: body.notes,
    });

    // Fire the appropriate event based on action. Map action → event name (matches v1).
    // Wrapped in try/catch: notification failure must NOT break the request lifecycle.
    const actionEventMap: Record<string, 'approval' | 'delay' | 'denial'> = {
      approve: 'approval',
      delay: 'delay',
      deny: 'denial',
    };
    const actEventName = actionEventMap[body.action];
    if (actEventName) {
      try {
        await fireEvent(app.prisma, actEventName, { requestId });
      } catch (err) {
        req.log.error({ err, requestId, action: body.action }, `fireEvent ${actEventName} failed`);
      }
    }

    return { id: updated.id, status: updated.status, statusExpiresAt: updated.statusExpiresAt };
  });

  // ── POST /api/requests/:id/cancel ─────────────────────────────────────────
  //
  // Buyer cancels a request (valid from pending, delayed, awaiting_reconfirm, approved).
  // v1 reference: views.py cancel()
  // TODO(Phase 6): fireEvent

  app.post<{ Params: { id: string } }>('/api/requests/:id/cancel', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || !Number.isInteger(requestId) || requestId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    const allowed = await isBuyerByMember(app.prisma, member.id, requestId);
    if (allowed === null) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (!allowed) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }

    const actorId = member.id;

    const updated = await transition(app.prisma, requestId, 'cancel', { actorId });
    return { id: updated.id, status: updated.status, statusExpiresAt: updated.statusExpiresAt };
  });

  // ── POST /api/requests/:id/reconfirm ─────────────────────────────────────
  //
  // Buyer reconfirms after a delay expires (awaiting_reconfirm → pending).
  // v1 reference: views.py reconfirm()
  // TODO(Phase 6): fireEvent

  app.post<{ Params: { id: string } }>('/api/requests/:id/reconfirm', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || !Number.isInteger(requestId) || requestId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    const allowed = await isBuyerByMember(app.prisma, member.id, requestId);
    if (allowed === null) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (!allowed) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }

    const actorId = member.id;

    const updated = await transition(app.prisma, requestId, 'reconfirm', { actorId });
    return { id: updated.id, status: updated.status, statusExpiresAt: updated.statusExpiresAt };
  });

  // ── POST /api/requests/:id/purchase ──────────────────────────────────────
  //
  // Buyer marks an approved request as purchased (approved → purchased).
  // v1 reference: views.py purchase()
  // TODO(Phase 6): fireEvent

  app.post<{ Params: { id: string } }>('/api/requests/:id/purchase', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || !Number.isInteger(requestId) || requestId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    const allowed = await isBuyerByMember(app.prisma, member.id, requestId);
    if (allowed === null) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (!allowed) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }

    const actorId = member.id;

    const updated = await transition(app.prisma, requestId, 'purchase', { actorId });
    return { id: updated.id, status: updated.status, statusExpiresAt: updated.statusExpiresAt };
  });
}
