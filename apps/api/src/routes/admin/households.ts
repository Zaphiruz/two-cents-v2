import type { FastifyInstance } from 'fastify';
import {
  AdminAddHouseholdMemberSchema,
  AdminUpdateHouseholdMemberSchema,
  AdminUpdateHouseholdSchema,
  AdminUpsertBuyerApproverSchema,
} from '@two-cents/shared';

export default async function adminHouseholdsRoutes(app: FastifyInstance) {
  app.get('/api/admin/households', async () => {
    const households = await app.prisma.household.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        appealQuotaCount: true,
        appealQuotaPeriod: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    });
    return {
      households: households.map((h) => ({
        id: h.id,
        name: h.name,
        appealQuotaCount: h.appealQuotaCount,
        appealQuotaPeriod: h.appealQuotaPeriod,
        createdAt: h.createdAt,
        memberCount: h._count.members,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/households/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const body = AdminUpdateHouseholdSchema.parse(req.body);
    const existing = await app.prisma.household.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const household = await app.prisma.household.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.appealQuotaCount !== undefined ? { appealQuotaCount: body.appealQuotaCount } : {}),
        ...(body.appealQuotaPeriod !== undefined ? { appealQuotaPeriod: body.appealQuotaPeriod } : {}),
      },
      select: {
        id: true,
        name: true,
        appealQuotaCount: true,
        appealQuotaPeriod: true,
        createdAt: true,
      },
    });
    return { household };
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/households/:id/members',
    async (req, reply) => {
      const householdId = Number(req.params.id);
      if (!Number.isFinite(householdId)) return reply.code(400).send({ error: 'invalid_id' });
      const body = AdminAddHouseholdMemberSchema.parse(req.body);

      const household = await app.prisma.household.findUnique({
        where: { id: householdId },
        select: { id: true },
      });
      if (!household) return reply.code(404).send({ error: 'not_found' });

      const existing = await app.prisma.householdMember.findFirst({
        where: { userId: body.userId },
        select: { id: true },
      });
      if (existing) return reply.code(409).send({ error: 'already_member' });

      const member = await app.prisma.householdMember.create({
        data: {
          householdId,
          userId: body.userId,
          approvalMode: body.approvalMode,
        },
        select: {
          id: true,
          userId: true,
          householdId: true,
          approvalMode: true,
          joinedAt: true,
        },
      });
      return reply.code(201).send({ member });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/admin/household-members/:id',
    async (req, reply) => {
      const memberId = Number(req.params.id);
      if (!Number.isFinite(memberId)) return reply.code(400).send({ error: 'invalid_id' });
      const body = AdminUpdateHouseholdMemberSchema.parse(req.body);
      const existing = await app.prisma.householdMember.findUnique({
        where: { id: memberId },
        select: { id: true },
      });
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      const member = await app.prisma.householdMember.update({
        where: { id: memberId },
        data: { approvalMode: body.approvalMode },
        select: { id: true, userId: true, householdId: true, approvalMode: true, joinedAt: true },
      });
      return { member };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/household-members/:id',
    async (req, reply) => {
      const memberId = Number(req.params.id);
      if (!Number.isFinite(memberId)) return reply.code(400).send({ error: 'invalid_id' });
      const existing = await app.prisma.householdMember.findUnique({
        where: { id: memberId },
        select: { id: true },
      });
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      await app.prisma.$transaction([
        app.prisma.buyerApprover.deleteMany({
          where: { OR: [{ buyerId: memberId }, { approverId: memberId }] },
        }),
        app.prisma.householdMember.delete({ where: { id: memberId } }),
      ]);
      return { deleted: 1 };
    },
  );

  app.put('/api/admin/buyer-approvers', async (req) => {
    const body = AdminUpsertBuyerApproverSchema.parse(req.body);
    const existing = await app.prisma.buyerApprover.findFirst({
      where: { buyerId: body.buyerId, approverId: body.approverId },
      select: { id: true, buyerId: true, approverId: true },
    });
    if (existing) return { buyerApprover: existing };
    const created = await app.prisma.buyerApprover.create({
      data: { buyerId: body.buyerId, approverId: body.approverId },
      select: { id: true, buyerId: true, approverId: true },
    });
    return { buyerApprover: created };
  });

  app.get<{ Params: { id: string } }>(
    '/api/admin/households/:id/detail',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });

      const household = await app.prisma.household.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          appealQuotaCount: true,
          appealQuotaPeriod: true,
          createdAt: true,
        },
      });
      if (!household) return reply.code(404).send({ error: 'not_found' });

      const members = await app.prisma.householdMember.findMany({
        where: { householdId: id },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          userId: true,
          approvalMode: true,
          joinedAt: true,
          user: { select: { name: true } },
        },
      });

      const memberIds = members.map((m) => m.id);
      const buyerApprovers = memberIds.length
        ? await app.prisma.buyerApprover.findMany({
            where: { buyerId: { in: memberIds } },
            select: { id: true, buyerId: true, approverId: true },
          })
        : [];

      return {
        household,
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          userName: m.user.name,
          approvalMode: m.approvalMode,
          joinedAt: m.joinedAt,
        })),
        buyerApprovers,
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/buyer-approvers/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
      const existing = await app.prisma.buyerApprover.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      await app.prisma.buyerApprover.delete({ where: { id } });
      return { deleted: 1 };
    },
  );
}
