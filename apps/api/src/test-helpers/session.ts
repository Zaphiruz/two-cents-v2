/**
 * session.ts — shared test helper for session injection
 *
 * Builds a Fastify app with a test-only `/__set_session` route that lets tests
 * inject session cookies without going through the OIDC flow.
 *
 * The /__set_session route is ONLY available on apps created via buildTestApp.
 * Production apps (built via buildApp directly) never have this route.
 */

import { buildApp } from '../buildApp.js';
import type { FastifyInstance } from 'fastify';

export async function buildTestApp(userId: number): Promise<{
  app: FastifyInstance;
  sessionCookie: string;
}> {
  const app = await buildApp();

  app.get<{ Querystring: { userId: string } }>('/__set_session', async (req, reply) => {
    req.session.userId = userId;
    await req.session.save();
    reply.send({ ok: true });
  });

  const res = await app.inject({ method: 'GET', url: '/__set_session' });
  const setCookie = res.headers['set-cookie'];
  const sessionCookie = Array.isArray(setCookie)
    ? setCookie[0]!
    : (setCookie as string);

  return { app, sessionCookie };
}
