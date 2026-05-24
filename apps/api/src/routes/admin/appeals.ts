import type { FastifyInstance } from 'fastify';
import { AdminListAppealsQuerySchema } from '@two-cents/shared';

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
}
