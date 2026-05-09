import fp from 'fastify-plugin';
import IORedis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: IORedis;
  }
}

export default fp(async (app) => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');
  // maxRetriesPerRequest: null is required by BullMQ (Phase 8 will use this client for queues)
  const redis = new IORedis(url, { maxRetriesPerRequest: null });
  // ioredis emits 'error' on connection issues; let it bubble to logs
  redis.on('error', (err) => app.log.error({ err }, 'redis error'));
  // Eagerly verify connectivity at boot
  await redis.ping();
  app.decorate('redis', redis);
  app.addHook('onClose', async () => {
    await redis.quit();
  });
}, { name: 'redis' });
