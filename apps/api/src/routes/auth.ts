/**
 * auth.ts — OIDC auth routes
 *
 * GET  /api/auth/login     → generate state+nonce, redirect to Authentik authorize
 * GET  /api/auth/callback  → exchange code, sync user, set session, redirect to /
 * POST /api/auth/logout    → destroy session, redirect to /
 * GET  /api/auth/me        → current user JSON or 401
 *
 * Note on v1 logout: v1's AuthentikOIDCBackend does not redirect to the OIDC
 * end_session_endpoint — it calls Django's logout() which just clears the session.
 * We match that behavior here: destroy the session and redirect to /. The user
 * remains logged in to Authentik; they'd need to log out there separately.
 */

import type { FastifyInstance } from 'fastify';
import { getOidcClient, generators } from '../plugins/auth.js';
import { syncUserFromClaims, type OidcClaims } from '../services/userSync.js';

export default async function authRoutes(app: FastifyInstance) {
  // ── GET /api/auth/login ──────────────────────────────────────────────────

  app.get('/api/auth/login', async (req, reply) => {
    const oidc = await getOidcClient();
    const state = generators.state();
    const nonce = generators.nonce();

    // Stash state + nonce in session so callback can verify them
    req.session.oidcState = state;
    req.session.oidcNonce = nonce;
    await req.session.save();

    const url = oidc.authorizationUrl({
      scope: 'openid profile email groups',
      state,
      nonce,
    });

    reply.redirect(url);
  });

  // ── GET /api/auth/callback ───────────────────────────────────────────────

  app.get('/api/auth/callback', async (req, reply) => {
    const state = req.session.oidcState;
    const nonce = req.session.oidcNonce;

    if (!state || !nonce) {
      reply.code(400).send({ error: 'invalid_state' });
      return;
    }

    let user;
    try {
      const oidc = await getOidcClient();
      const params = oidc.callbackParams(req.raw);
      const tokenSet = await oidc.callback(
        process.env.OIDC_REDIRECT_URI!,
        params,
        { state, nonce },
      );
      const claims = tokenSet.claims();
      user = await syncUserFromClaims(app.prisma, claims as OidcClaims);
    } catch (err) {
      // OIDC errors (bad code, expired state, signature mismatch, etc.) →
      // return a clean 400 without leaking internal details
      app.log.warn({ err }, 'OIDC callback error');
      reply.code(400).send({ error: 'authentication_failed' });
      return;
    }

    // Reset session to authenticated state — clear scratch fields
    req.session.oidcState = undefined;
    req.session.oidcNonce = undefined;
    req.session.userId = user.id;
    await req.session.save();

    reply.redirect('/');
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────────

  app.post('/api/auth/logout', async (req, reply) => {
    req.session.destroy();
    // iron-session 8 destroy() clears in-memory data and sets the cookie to expire.
    // The cleared cookie is sent with the redirect response.
    reply.redirect('/');
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────────

  app.get('/api/auth/me', async (req, reply) => {
    const userId = req.session.userId;
    if (!userId) {
      reply.code(401).send({ error: 'not_authenticated' });
      return;
    }

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, isAdmin: true },
    });

    if (!user) {
      // Session references a deleted user — clean up and return 401
      req.session.destroy();
      reply.code(401).send({ error: 'not_authenticated' });
      return;
    }

    return user;
  });
}
