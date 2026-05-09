/**
 * auth.ts — iron-session setup + lazy openid-client discovery
 *
 * Registers:
 *   - A preHandler hook that attaches `req.session` to every request via iron-session 8
 *   - Exports `getOidcClient()` (lazy — does NOT call Issuer.discover() at boot because
 *     Authentik is not reachable from the dev/test environment)
 *   - Exports `generators` from openid-client for use in route handlers
 *
 * IMPORTANT: OIDC discovery is intentionally lazy. Do not eagerly call Issuer.discover()
 * at plugin registration time. Only the login/callback routes trigger discovery, and only
 * when a real OIDC flow is initiated.
 */

import fp from 'fastify-plugin';
import { getIronSession, type IronSession } from 'iron-session';
import { Issuer, generators, type Client } from 'openid-client';

// ── Session shape ─────────────────────────────────────────────────────────────

export interface SessionData {
  userId?: number;
  /** Hash of name+groups to detect claim changes (reserved for Phase 4+ cache busting) */
  claimHash?: string;
  /** Scratch fields used during the OIDC login flow; cleared after callback */
  oidcState?: string;
  oidcNonce?: string;
}

// ── Module augmentation ───────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    session: IronSession<SessionData>;
  }
}

// ── Session options ───────────────────────────────────────────────────────────

export const SESSION_COOKIE_NAME = 'tc_session';

function getSessionOptions() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required');
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: secret,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  };
}

// ── Lazy OIDC client ──────────────────────────────────────────────────────────

let oidcClient: Client | null = null;

/**
 * Returns the openid-client Client, discovering the issuer on first call.
 * Lazy so that tests and dev sessions that don't exercise the OIDC flow
 * never attempt to reach Authentik.
 *
 * Validates all four required OIDC env vars on first call so failures are
 * fast and descriptive rather than cryptic openid-client errors.
 */
export async function getOidcClient(): Promise<Client> {
  if (oidcClient) return oidcClient;

  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (!issuer || !clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'OIDC env vars missing: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI all required',
    );
  }

  const discovered = await Issuer.discover(issuer);
  oidcClient = new discovered.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  });
  return oidcClient;
}

/**
 * Resets the cached OIDC client singleton. Used in tests to allow re-discovery
 * with a fresh nock mock after changing OIDC env vars.
 */
export function resetOidcClient(): void {
  oidcClient = null;
}

export { generators };

// ── Plugin ────────────────────────────────────────────────────────────────────

export default fp(
  async (app) => {
    const sessionOptions = getSessionOptions();

    /**
     * Attach iron-session to every request before route handlers run.
     * iron-session 8 is request/response–based; Fastify's req.raw and reply.raw
     * are the underlying Node IncomingMessage / ServerResponse objects.
     */
    app.addHook('preHandler', async (req, reply) => {
      req.session = await getIronSession<SessionData>(
        req.raw,
        reply.raw,
        sessionOptions,
      );
    });
  },
  { name: 'auth' },
);
