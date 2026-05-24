import type { FastifyInstance } from 'fastify';
import { AdminAddHouseholdMemberSchema, AdminUpdateHouseholdSchema } from '@two-cents/shared';

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
}
