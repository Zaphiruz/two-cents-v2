import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { AdminListAppealsQuerySchema, AdminResolveAppealSchema } from '@two-cents/shared';
import { transitionOnTx } from '../../lib/state.js';
import { fireEvent } from '../../services/events.js';

export default async function adminAppealsRoutes(app: FastifyInstance) {
  app.get('/api/admin/appeals', async (req) => {
    const query = AdminListAppealsQuerySchema.parse(req.query ?? {});
    const limit = query.limit ?? 50;

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.periodKey ? { periodKey: query.periodKey } : {}),
      ...(query.householdId
        ? { request: { householdId: query.householdId } }
        : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };

    const appeals = await app.prisma.appeal.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        status: true,
        periodKey: true,
        createdAt: true,
        resolvedAt: true,
        request: {
          select: {
            id: true,
            title: true,
            household: { select: { id: true, name: true } },
          },
        },
        buyer: {
          select: { id: true, user: { select: { name: true } } },
        },
      },
    });

    const hasMore = appeals.length > limit;
    const slice = hasMore ? appeals.slice(0, limit) : appeals;
    return {
      appeals: slice.map((a) => ({
        id: a.id,
        status: a.status,
        periodKey: a.periodKey,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        requestId: a.request.id,
        requestTitle: a.request.title,
        householdId: a.request.household.id,
        householdName: a.request.household.name,
        buyerMemberId: a.buyer.id,
        buyerName: a.buyer.user.name,
      })),
      nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    };
  });

  // ── POST /api/admin/appeals/:id/resolve ─────────────────────────────────────
  //
  // Admin-scoped resolve. Mirrors the user-facing handler in apps/api/src/routes/appeals.ts
  // but skips the approver-membership check (admin can act on any household's appeal).
  // Reuses the same transitionOnTx('appeal_overturned') helper so the request status
  // transition is identical: denied → pending. Uphold leaves the request unchanged.
  app.post<{ Params: { id: string } }>(
    '/api/admin/appeals/:id/resolve',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: 'invalid_id' });
      }
      const body = AdminResolveAppealSchema.parse(req.body);

      const appeal = await app.prisma.appeal.findUnique({
        where: { id },
        select: { id: true, status: true, requestId: true, buyerId: true },
      });
      if (!appeal) return reply.code(404).send({ error: 'not_found' });
      if (appeal.status !== 'pending') {
        return reply.code(409).send({ error: 'already_resolved' });
      }

      const newStatus = body.decision === 'overturn' ? 'overturned' : 'upheld';
      const updated = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updatedAppeal = await tx.appeal.update({
          where: { id },
          data: { status: newStatus, resolvedAt: new Date() },
        });
        if (body.decision === 'overturn') {
          // Same state-machine transition as the user-facing endpoint: denied → pending.
          // actorId is the admin's user id; transitionOnTx does not write a Review for
          // 'appeal_overturned' so the value is unused but supplied for consistency.
          await transitionOnTx(tx, appeal.requestId, 'appeal_overturned', {
            actorId: req.adminUser!.id,
          });
        }
        return updatedAppeal;
      });

      // Fire appeal_resolved event — notify the buyer with the outcome.
      // Mirrors the user-facing handler in apps/api/src/routes/appeals.ts.
      // Wrapped in try/catch: notification failure must NOT 500 the admin's resolve action.
      const outcome = body.decision === 'overturn' ? 'overturned' : 'upheld';
      try {
        await fireEvent(app.prisma, 'appeal_resolved', {
          appealId: appeal.id,
          outcome,
        });
      } catch (err) {
        req.log.error(
          { err, appealId: appeal.id, outcome },
          'fireEvent appeal_resolved failed',
        );
      }

      return { appeal: updated };
    },
  );
}
