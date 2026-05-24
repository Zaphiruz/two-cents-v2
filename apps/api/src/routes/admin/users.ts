import type { FastifyInstance } from 'fastify';
import { AdminListUsersQuerySchema } from '@two-cents/shared';
import { sendPushNotification, PushSubscriptionExpiredError } from '../../lib/push.js';

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

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/test-push',
    async (req, reply) => {
      const userId = Number(req.params.id);
      if (!Number.isFinite(userId)) {
        return reply.code(400).send({ error: 'invalid_id' });
      }
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const subs = await app.prisma.pushSubscription.findMany({
        where: { userId },
      });

      const payload = {
        title: 'Test push from admin',
        body: 'If you can see this, push delivery is working.',
      };

      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      const results = await Promise.allSettled(
        subs.map((sub) =>
          sendPushNotification(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload,
          ).then(() => ({ subId: sub.id })),
        ),
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        const sub = subs[i]!;
        if (r.status === 'fulfilled') {
          sent++;
        } else {
          failed++;
          const err = r.reason;
          if (err instanceof PushSubscriptionExpiredError) {
            errors.push(`expired: ${sub.endpoint}`);
            await app.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => {
                // ignore race: already deleted
              });
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(msg);
          }
        }
      }

      const result: { sent: number; failed: number; errors?: string[] } = {
        sent,
        failed,
      };
      if (errors.length > 0) result.errors = errors;
      return result;
    },
  );
}
