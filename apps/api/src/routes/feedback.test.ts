/**
 * feedback.test.ts — Route-level tests for POST/GET /api/feedback (Phase 7)
 *
 * Tests:
 *   POST /api/feedback
 *     1. 401 without session
 *     2. 400 (Zod) with invalid body (missing title)
 *     3. 429 when rate-limited (second request within 60s window)
 *     4. 201 success without GitHub configured (GitHubNotConfigured — stored with null issue number)
 *     5. 201 success with GitHub mocked — stores issue number and url
 *     6. 201 success when GitHub API call fails — submission still stored (graceful degradation)
 *   GET /api/feedback
 *     7. 401 without session
 *     8. 200 returns empty list for new user
 *     9. 200 returns submissions with live GitHub state (mocked fetch)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildApp } from '../buildApp.js';
import { prisma } from '../test-helpers/db.js';
import { buildTestApp } from '../test-helpers/session.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

// Save original env vars and restore after each test
const ORIG_TOKEN = process.env.GITHUB_FEEDBACK_TOKEN;
const ORIG_REPO = process.env.GITHUB_FEEDBACK_REPO;

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIG_TOKEN === undefined) delete process.env.GITHUB_FEEDBACK_TOKEN;
  else process.env.GITHUB_FEEDBACK_TOKEN = ORIG_TOKEN;
  if (ORIG_REPO === undefined) delete process.env.GITHUB_FEEDBACK_REPO;
  else process.env.GITHUB_FEEDBACK_REPO = ORIG_REPO;
});

// ── POST /api/feedback ────────────────────────────────────────────────────────

describe('POST /api/feedback', () => {
  // 1. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        payload: { title: 'Bug', body: 'It crashed.' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 2. 400 (Zod) with invalid body (missing title)
  it('returns 400 with invalid body (missing title)', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'feedback-post-zod', name: 'Zod Test User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
        payload: { body: 'Missing title!' }, // no title
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'validation_error' });
    } finally {
      await app.close();
    }
  });

  // 3. 429 when rate-limited (second request within 60s window)
  it('returns 429 on the second request within the rate-limit window', async () => {
    // Remove GitHub env to avoid real network calls
    delete process.env.GITHUB_FEEDBACK_TOKEN;

    const user = await prisma.user.create({
      data: { oidcSubject: 'feedback-rate-limit', name: 'Rate Limit User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      // First request should succeed (201)
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
        payload: { title: 'First feedback', body: 'This is the first one.' },
      });
      expect(res1.statusCode).toBe(201);

      // Second request within the same window should be rate-limited (429)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
        payload: { title: 'Second feedback', body: 'Too fast!' },
      });
      expect(res2.statusCode).toBe(429);
      const body = res2.json<{ error: string; resetInSeconds: number }>();
      expect(body.error).toBe('rate_limited');
      expect(body.resetInSeconds).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  // 4. 201 success without GitHub configured (stores with null issue number)
  it('returns 201 and stores submission without GitHub link when token is missing', async () => {
    delete process.env.GITHUB_FEEDBACK_TOKEN;

    const user = await prisma.user.create({
      data: { oidcSubject: 'feedback-no-github', name: 'No GitHub User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
        payload: { title: 'Feedback without GitHub', body: 'This should still be saved.' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        submission: { id: number; githubIssueNumber: null; githubIssueUrl: string };
      }>();
      expect(body.submission.id).toBeTypeOf('number');
      expect(body.submission.githubIssueNumber).toBeNull();
      expect(body.submission.githubIssueUrl).toBe('');

      // Verify in DB
      const dbRow = await prisma.feedbackSubmission.findUnique({
        where: { id: body.submission.id },
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow!.githubIssueNumber).toBeNull();
    } finally {
      await app.close();
    }
  });

  // 5. 201 success with GitHub mocked — stores issue number and url
  it('returns 201 and stores GitHub issue number when GitHub API succeeds', async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = 'test-token';
    process.env.GITHUB_FEEDBACK_REPO = 'owner/test-repo';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeFetchResponse(201, {
          number: 99,
          html_url: 'https://github.com/owner/test-repo/issues/99',
        }),
      ),
    );

    const user = await prisma.user.create({
      data: { oidcSubject: 'feedback-with-github', name: 'GitHub User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
        payload: { title: 'Real feedback', body: 'With GitHub.', category: 'bug' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        submission: { id: number; githubIssueNumber: number; githubIssueUrl: string; category: string };
      }>();
      expect(body.submission.githubIssueNumber).toBe(99);
      expect(body.submission.githubIssueUrl).toBe(
        'https://github.com/owner/test-repo/issues/99',
      );
      expect(body.submission.category).toBe('bug');

      // Verify in DB
      const dbRow = await prisma.feedbackSubmission.findUnique({
        where: { id: body.submission.id },
      });
      expect(dbRow!.githubIssueNumber).toBe(99);
    } finally {
      await app.close();
    }
  });

  // 6. 201 success when GitHub API call fails — submission still stored (graceful degradation)
  it('returns 201 and stores submission even when GitHub API returns an error', async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = 'test-token';
    process.env.GITHUB_FEEDBACK_REPO = 'owner/test-repo';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(500, 'Internal Server Error')),
    );

    const user = await prisma.user.create({
      data: { oidcSubject: 'feedback-github-fail', name: 'GitHub Fail User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
        payload: { title: 'Feedback with GitHub failure', body: 'Graceful degradation test.' },
      });
      // Should still be 201 — graceful degradation
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        submission: { id: number; githubIssueNumber: null };
      }>();
      expect(body.submission.id).toBeTypeOf('number');
      expect(body.submission.githubIssueNumber).toBeNull();
    } finally {
      await app.close();
    }
  });
});

// ── GET /api/feedback ─────────────────────────────────────────────────────────

describe('GET /api/feedback', () => {
  // 7. 401 without session
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/feedback' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  // 8. 200 returns empty list for new user
  it('returns empty submissions list for a user with no feedback', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'feedback-get-empty', name: 'Empty Feedback User' },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ submissions: unknown[] }>();
      expect(body.submissions).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // 9. 200 returns submissions with live GitHub state (mocked fetch)
  it('returns submissions with githubState from live GitHub API', async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = 'test-token';
    process.env.GITHUB_FEEDBACK_REPO = 'owner/test-repo';

    // Mock GitHub status fetch
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeFetchResponse(200, { state: 'closed', state_reason: 'completed' }),
      ),
    );

    const user = await prisma.user.create({
      data: { oidcSubject: 'feedback-get-with-state', name: 'State User' },
    });

    // Pre-create a feedback submission with a GitHub issue number
    await prisma.feedbackSubmission.create({
      data: {
        userId: user.id,
        githubIssueNumber: 42,
        githubIssueUrl: 'https://github.com/owner/test-repo/issues/42',
        category: 'bug',
      },
    });

    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/feedback',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        submissions: Array<{
          id: number;
          githubIssueNumber: number;
          githubState: string;
          githubStateReason: string | null;
        }>;
      }>();
      expect(body.submissions).toHaveLength(1);
      expect(body.submissions[0]!.githubIssueNumber).toBe(42);
      expect(body.submissions[0]!.githubState).toBe('closed');
      expect(body.submissions[0]!.githubStateReason).toBe('completed');
    } finally {
      await app.close();
    }
  });
});
