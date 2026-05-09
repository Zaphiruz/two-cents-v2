import type { FastifyInstance } from 'fastify';
import { buildApp } from './buildApp.js';

let app!: FastifyInstance;
try {
  app = await buildApp();
} catch (err) {
  console.error('Failed to build application', err);
  process.exit(1);
}

const port = Number(process.env.PORT || 4000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`api listening on :${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close(); // triggers plugin teardown hooks
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
