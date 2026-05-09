import Fastify, { FastifyInstance } from 'fastify';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import cookiePlugin from './plugins/cookie.js';
import errorPlugin from './plugins/error.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';

export async function buildApp(): Promise<FastifyInstance> {
  const isTest = process.env.NODE_ENV === 'test';
  const app = Fastify({
    logger: isTest ? false : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(cookiePlugin);
  await app.register(errorPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes);

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
