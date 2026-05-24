import type { FastifyInstance } from 'fastify';
import { AdminUpdateHouseholdSchema } from '@two-cents/shared';

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
}
