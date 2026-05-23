import Fastify, { FastifyInstance } from 'fastify';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import cookiePlugin from './plugins/cookie.js';
import errorPlugin from './plugins/error.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import requestsRoutes from './routes/requests.js';
import commentsRoutes from './routes/comments.js';
import appealsRoutes from './routes/appeals.js';
import pushRoutes from './routes/push.js';
import qaRoutes from './routes/qa.js';
import notificationsRoutes from './routes/notifications.js';
import householdRoutes from './routes/household.js';
import feedbackRoutes from './routes/feedback.js';
import { configurePush } from './lib/push.js';

export async function buildApp(): Promise<FastifyInstance> {
  const isTest = process.env.NODE_ENV === 'test';
  const app = Fastify({
    logger: isTest ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    // Increase maxParamLength to support JWT tokens in URL params (default is 100;
    // HS256 JWTs with our payload are ~250 chars).
    routerOptions: { maxParamLength: 1000 },
  });

  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(cookiePlugin);
  await app.register(errorPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(requestsRoutes);
  await app.register(commentsRoutes);
  await app.register(appealsRoutes);
  await app.register(pushRoutes);
  await app.register(qaRoutes);
  await app.register(notificationsRoutes);
  await app.register(householdRoutes);
  await app.register(feedbackRoutes);

  // Configure VAPID credentials for web-push (no-op if env vars missing)
  configurePush();

  app.get('/healthz', async (req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      req.log.error({ err }, 'healthz: db ping failed');
      reply.code(503);
      return { ok: false, db: 'unreachable' };
    }

    try {
      const pong = await app.redis.ping();
      if (pong !== 'PONG') {
        reply.code(503);
        return { ok: false, redis: 'unreachable' };
      }
    } catch (err) {
      req.log.error({ err }, 'healthz: redis ping failed');
      reply.code(503);
      return { ok: false, redis: 'unreachable' };
    }

    return { ok: true };
  });

  return app;
}
