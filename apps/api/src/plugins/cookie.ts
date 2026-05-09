import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';

export default fp(async (app) => {
  await app.register(fastifyCookie);
  // iron-session integration is added in Phase 3; this plugin just wires the cookie parser.
}, { name: 'cookie' });
