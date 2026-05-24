import type { FastifyInstance } from 'fastify';

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
}
