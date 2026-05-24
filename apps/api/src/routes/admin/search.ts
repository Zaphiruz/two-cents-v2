import type { FastifyInstance } from 'fastify';
import { AdminSearchQuerySchema, type AdminSearchQuery } from '@two-cents/shared';

type SearchHit = {
  type: 'request' | 'comment' | 'notificationLog' | 'pushSubscription' | 'consumedJwtJti';
  id: number | string;
  primary: string;
  userName: string | null;
  householdName: string | null;
  timestamp: string;
  raw: Record<string, unknown>;
};

const COMMENT_SNIPPET_LEN = 200;

export default async function adminSearchRoutes(app: FastifyInstance) {
  app.get('/api/admin/search', async (req) => {
    const query = AdminSearchQuerySchema.parse(req.query ?? {});
    const limit = query.type ? 50 : 10;

    const tasks: Array<Promise<SearchHit[]>> = [];

    const want = (t: AdminSearchQuery['type']) => !query.type || query.type === t;

    if (want('request')) tasks.push(searchRequests(app, query.q, limit));
    if (want('comment')) tasks.push(searchComments(app, query.q, limit));
    if (want('notificationLog')) tasks.push(searchNotificationLogs(app, query.q, limit));
    if (want('pushSubscription')) tasks.push(searchPushSubscriptions(app, query.q, limit));
    if (want('consumedJwtJti')) tasks.push(searchConsumedJtis(app, query.q, limit));

    const groups = await Promise.all(tasks);
    return { results: groups.flat() };
  });
}

async function searchRequests(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.request.findMany({
    where: { title: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      household: { select: { name: true } },
      buyer: { select: { user: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    type: 'request' as const,
    id: r.id,
    primary: r.title,
    userName: r.buyer.user.name,
    householdName: r.household.name,
    timestamp: r.createdAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchComments(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.comment.findMany({
    where: { body: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { name: true } },
      request: { select: { household: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    type: 'comment' as const,
    id: r.id,
    primary: r.body.length > COMMENT_SNIPPET_LEN ? r.body.slice(0, COMMENT_SNIPPET_LEN) + '…' : r.body,
    userName: r.author.name,
    householdName: r.request.household.name,
    timestamp: r.createdAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchNotificationLogs(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.notificationLog.findMany({
    where: { eventKey: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      eventKey: true,
      sentAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    type: 'notificationLog' as const,
    id: r.id,
    primary: r.eventKey,
    userName: r.user.name,
    householdName: null,
    timestamp: r.sentAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchPushSubscriptions(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.pushSubscription.findMany({
    where: { endpoint: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      endpoint: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    type: 'pushSubscription' as const,
    id: r.id,
    primary: r.endpoint,
    userName: r.user.name,
    householdName: null,
    timestamp: r.createdAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchConsumedJtis(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.consumedJWTJti.findMany({
    where: { jti: { contains: q, mode: 'insensitive' } },
    orderBy: { consumedAt: 'desc' },
    take: limit,
    select: { jti: true, consumedAt: true },
  });
  return rows.map((r) => ({
    type: 'consumedJwtJti' as const,
    id: r.jti,
    primary: r.jti,
    userName: null,
    householdName: null,
    timestamp: r.consumedAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}
