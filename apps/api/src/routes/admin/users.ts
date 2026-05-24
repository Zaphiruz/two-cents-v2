import type { FastifyInstance } from 'fastify';
import { AdminListUsersQuerySchema } from '@two-cents/shared';

export default async function adminUsersRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', async (req) => {
    const query = AdminListUsersQuerySchema.parse(req.query ?? {});
    const limit = query.limit ?? 50;

    const where = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...(query.isAdmin !== undefined ? { isAdmin: query.isAdmin } : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };

    const users = await app.prisma.user.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        oidcSubject: true,
        name: true,
        isAdmin: true,
        createdAt: true,
        memberships: {
          select: {
            household: { select: { id: true, name: true } },
          },
          take: 1,
        },
      },
    });

    const hasMore = users.length > limit;
    const slice = hasMore ? users.slice(0, limit) : users;
    return {
      users: slice.map((u) => ({
        id: u.id,
        oidcSubject: u.oidcSubject,
        name: u.name,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt,
        householdId: u.memberships[0]?.household.id ?? null,
        householdName: u.memberships[0]?.household.name ?? null,
      })),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  });
}
