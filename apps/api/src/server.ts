import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/healthz', async () => ({ ok: true }));

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
