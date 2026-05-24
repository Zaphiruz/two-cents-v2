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

  app.get<{ Params: { id: string } }>('/api/admin/users/:id/detail', async (req, reply) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, oidcSubject: true, name: true, isAdmin: true, createdAt: true },
    });
    if (!user) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const membership = await app.prisma.householdMember.findFirst({
      where: { userId },
      select: {
        id: true,
        approvalMode: true,
        joinedAt: true,
        household: { select: { id: true, name: true } },
      },
    });

    const [requests, comments, pushSubs, logs] = await Promise.all([
      membership
        ? app.prisma.request.findMany({
            where: { buyerId: membership.id },
            orderBy: { id: 'desc' },
            take: 20,
            select: { id: true, title: true, status: true, createdAt: true },
          })
        : Promise.resolve([]),
      app.prisma.comment.findMany({
        where: { authorId: userId },
        orderBy: { id: 'desc' },
        take: 20,
        select: { id: true, requestId: true, body: true, createdAt: true },
      }),
      app.prisma.pushSubscription.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        select: { id: true, endpoint: true, createdAt: true },
      }),
      app.prisma.notificationLog.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        take: 50,
        select: { id: true, eventKey: true, sentAt: true },
      }),
    ]);

    return {
      user,
      household: membership
        ? {
            id: membership.household.id,
            name: membership.household.name,
            memberId: membership.id,
            approvalMode: membership.approvalMode,
            joinedAt: membership.joinedAt,
          }
        : null,
      requests,
      comments,
      pushSubscriptions: pushSubs,
      notificationLogs: logs,
    };
  });
}
