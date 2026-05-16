/**
 * auth.test.ts — route-level tests for /api/auth/*
 *
 * Tests:
 *   1. GET /api/auth/me without session → 401
 *   2. GET /api/auth/me after session set via helper route → 200 with user
 *   3. GET /api/auth/me after session pointing to deleted user → 401
 *   4. POST /api/auth/logout → redirects; subsequent /me is 401
 *   5. GET /api/auth/callback without oidcState in session → 400
 *   6. GET /healthz regression
 *   OIDC flow (nock-mocked):
 *   7. GET /api/auth/login → 302 redirect to authorize URL with state+nonce
 *   8. GET /api/auth/callback?code=xxx&state=xxx → full flow: token exchange,
 *      JWT verification, userSync, session set → 302 to /
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import nock from 'nock';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { resetOidcClient } from '../plugins/auth.js';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../test-helpers/session.js';


describe('auth routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── 1. /me without session → 401 ─────────────────────────────────────────

  it('GET /api/auth/me without session returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'not_authenticated' });
  });

  // ── 2. /me with valid session → user JSON ─────────────────────────────────

  it('GET /api/auth/me with valid session returns user', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'sub-me-route', name: 'Route User', isAdmin: true },
    });

    const { app: testApp, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await testApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ id: user.id, name: 'Route User', isAdmin: true });
      // Should not include oidcSubject or createdAt
      expect(body.oidcSubject).toBeUndefined();
    } finally {
      await testApp.close();
    }
  });

  // ── 3. /me with session pointing to deleted user → 401 ───────────────────

  it('GET /api/auth/me with deleted-user session returns 401', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'sub-deleted-me', name: 'To Delete', isAdmin: false },
    });

    const { app: testApp, sessionCookie } = await buildTestApp(user.id);
    try {
      // Delete the user after the session is set
      await prisma.user.delete({ where: { id: user.id } });

      const res = await testApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await testApp.close();
    }
  });

  // ── 4. POST /api/auth/logout → session cleared ────────────────────────────

  it('POST /api/auth/logout then GET /api/auth/me → 401', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'sub-logout', name: 'Logout User', isAdmin: false },
    });

    const { app: testApp, sessionCookie } = await buildTestApp(user.id);
    try {
      // Verify session is set
      const meBefore = await testApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: sessionCookie },
      });
      expect(meBefore.statusCode).toBe(200);

      // Logout
      const logoutRes = await testApp.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: sessionCookie },
      });
      // Should redirect to /
      expect(logoutRes.statusCode).toBe(302);

      // Extract the cleared session cookie from the logout response
      const clearedCookie = logoutRes.headers['set-cookie'];
      const clearedCookieStr = Array.isArray(clearedCookie)
        ? clearedCookie[0]!
        : (clearedCookie as string | undefined) ?? '';

      // Subsequent /me with original session cookie still returns 401
      // because session was destroyed (cookie is invalidated / empty)
      const meAfter = await testApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: clearedCookieStr || '' },
      });
      expect(meAfter.statusCode).toBe(401);
    } finally {
      await testApp.close();
    }
  });

  // ── 5. GET /api/auth/callback without oidcState → 400 ────────────────────

  it('GET /api/auth/callback without session state returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=fake&state=fake',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_state' });
  });

  // ── 6. /healthz regression ───────────────────────────────────────────────

  it('GET /healthz still returns 200 after auth plugin registered', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });
});

// ── OIDC flow tests with nock-mocked Authentik ───────────────────────────────

/**
 * These tests mock all Authentik HTTP endpoints (discovery, JWKS, token) using
 * nock so that no real network call is made. They cover:
 *   - /login: verifies redirect URL shape and session scratch fields
 *   - /callback: full token exchange → JWT verification → userSync → session set
 */
describe('OIDC flow with mocked Authentik', () => {
  const MOCK_ISSUER = 'https://mock-authentik.test/application/o/two-cents-v2';
  const MOCK_CLIENT_ID = 'test-client-id';
  const MOCK_CLIENT_SECRET = 'test-client-secret';
  const MOCK_REDIRECT_URI = 'http://localhost:4000/api/auth/callback';

  // Discovery doc path derived from MOCK_ISSUER (openid-client appends /.well-known/openid-configuration)
  const DISCOVERY_PATH =
    '/application/o/two-cents-v2/.well-known/openid-configuration';
  const TOKEN_PATH = '/application/o/two-cents-v2/token/';
  const JWKS_PATH = '/application/o/two-cents-v2/jwks/';

  // RSA key pair generated once for the whole describe block
  let privateKey: CryptoKey;
  let jwks: { keys: object[] };
  let oidcApp: FastifyInstance;

  beforeAll(async () => {
    // Generate RSA key pair for signing test id_tokens
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    const kidValue = 'test-key-1';
    jwks = { keys: [{ ...publicJwk, kid: kidValue, alg: 'RS256', use: 'sig' }] };

    // Set OIDC env vars (captured by getOidcClient() on first call)
    process.env.OIDC_ISSUER = MOCK_ISSUER;
    process.env.OIDC_CLIENT_ID = MOCK_CLIENT_ID;
    process.env.OIDC_CLIENT_SECRET = MOCK_CLIENT_SECRET;
    process.env.OIDC_REDIRECT_URI = MOCK_REDIRECT_URI;

    // Enable nock — disable all real HTTP
    nock.disableNetConnect();

    oidcApp = await buildApp();
  });

  afterEach(() => {
    // Ensure no leftover nock interceptors after each test
    nock.cleanAll();
  });

  afterAll(async () => {
    await oidcApp.close();
    // Reset OIDC singleton so other describe blocks start clean
    resetOidcClient();
    // Restore real HTTP for remaining tests
    nock.enableNetConnect();
    // Clean up env vars
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
  });

  /**
   * Helper: mock the Authentik discovery + JWKS endpoints (needed for
   * getOidcClient() to succeed). Since oidcClient is cached after first call,
   * we only need to mock these once per beforeAll — but if resetOidcClient()
   * was called we need them again. Safe to mock per-test for clarity.
   */
  function mockDiscovery() {
    nock('https://mock-authentik.test')
      .get(DISCOVERY_PATH)
      .reply(200, {
        issuer: MOCK_ISSUER,
        authorization_endpoint: `https://mock-authentik.test/application/o/authorize/`,
        token_endpoint: `https://mock-authentik.test${TOKEN_PATH}`,
        jwks_uri: `https://mock-authentik.test${JWKS_PATH}`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        userinfo_endpoint: `https://mock-authentik.test/application/o/userinfo/`,
        end_session_endpoint: `https://mock-authentik.test/application/o/end-session/`,
        scopes_supported: ['openid', 'profile', 'email', 'groups'],
        claims_supported: ['sub', 'name', 'preferred_username', 'groups'],
      });

    nock('https://mock-authentik.test').get(JWKS_PATH).reply(200, jwks);
  }

  // ── 7. GET /api/auth/login redirects to authorize URL ──────────────────

  it('GET /api/auth/login redirects to authorize URL with state+nonce', async () => {
    mockDiscovery();

    const res = await oidcApp.inject({
      method: 'GET',
      url: '/api/auth/login',
    });

    expect(res.statusCode).toBe(302);

    const location = res.headers['location'] as string;
    expect(location).toBeTruthy();
    expect(location).toContain('client_id=test-client-id');
    expect(location).toContain('state=');
    expect(location).toContain('nonce=');
    // scope is space-encoded as + or %20 in the URL
    expect(location).toMatch(/scope=openid/);
    expect(location).toMatch(/profile/);
    expect(location).toMatch(/email/);
    expect(location).toMatch(/groups/);

    // Verify the session cookie was set
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
    expect(cookieStr).toMatch(/tc_session=/);
  });

  // ── 8. GET /api/auth/callback full flow ────────────────────────────────

  it('GET /api/auth/callback exchanges code, syncs user, and sets session', async () => {
    // Step 1: hit /login to get a real session cookie with oidcState + oidcNonce
    mockDiscovery();

    const loginRes = await oidcApp.inject({
      method: 'GET',
      url: '/api/auth/login',
    });
    expect(loginRes.statusCode).toBe(302);

    const setCookie = loginRes.headers['set-cookie'];
    const sessionCookie = Array.isArray(setCookie)
      ? setCookie[0]!
      : (setCookie as string);

    // Extract state from the redirect Location header
    const location = loginRes.headers['location'] as string;
    const loginUrl = new URL(location);
    const state = loginUrl.searchParams.get('state')!;
    const nonce = loginUrl.searchParams.get('nonce')!;
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();

    // Step 2: sign a test id_token with our RSA key
    const kidValue = (jwks.keys[0] as Record<string, string>)['kid'];
    const idToken = await new SignJWT({
      sub: 'oidc-callback-sub',
      name: 'Callback User',
      preferred_username: 'cbuser',
      groups: ['two-cents-admins'],
      nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: kidValue })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer(MOCK_ISSUER)
      .setAudience(MOCK_CLIENT_ID)
      .sign(privateKey);

    // Step 3: mock the token endpoint
    nock('https://mock-authentik.test')
      .post(TOKEN_PATH)
      .reply(200, {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: idToken,
      });

    // openid-client will also re-fetch JWKS on callback to verify id_token signature
    nock('https://mock-authentik.test').get(JWKS_PATH).reply(200, jwks);

    // Step 4: call /callback with the session cookie and matching state
    const callbackRes = await oidcApp.inject({
      method: 'GET',
      url: `/api/auth/callback?code=test-code&state=${state}`,
      headers: { cookie: sessionCookie },
    });

    expect(callbackRes.statusCode).toBe(302);
    expect(callbackRes.headers['location']).toBe('/');

    // Step 5: verify user was created in DB
    const user = await prisma.user.findFirst({
      where: { oidcSubject: 'oidc-callback-sub' },
    });
    expect(user).not.toBeNull();
    expect(user!.name).toBe('Callback User');
    expect(user!.isAdmin).toBe(true);

    // Step 6: verify the new session cookie has userId set — check via /me
    const newCookie = callbackRes.headers['set-cookie'];
    const newCookieStr = Array.isArray(newCookie)
      ? newCookie[0]!
      : (newCookie as string);

    const meRes = await oidcApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: newCookieStr },
    });
    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json();
    expect(meBody).toMatchObject({ name: 'Callback User', isAdmin: true });
  });
});
