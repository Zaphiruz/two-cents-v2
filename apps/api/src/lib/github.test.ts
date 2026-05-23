/**
 * github.test.ts — Unit tests for the GitHub Issues API wrapper (Phase 7)
 *
 * Uses vi.stubGlobal to mock the global `fetch` so no real network calls are made.
 * GITHUB_FEEDBACK_TOKEN and GITHUB_FEEDBACK_REPO are set in env before each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createGitHubIssue,
  fetchIssueStatus,
  GitHubAuthError,
  GitHubAPIError,
  GitHubNotConfigured,
} from './github.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFetchResponse(
  status: number,
  body: unknown,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

// ── setup / teardown ──────────────────────────────────────────────────────────

const ORIG_TOKEN = process.env.GITHUB_FEEDBACK_TOKEN;
const ORIG_REPO = process.env.GITHUB_FEEDBACK_REPO;

beforeEach(() => {
  process.env.GITHUB_FEEDBACK_TOKEN = 'test-token';
  process.env.GITHUB_FEEDBACK_REPO = 'owner/repo';
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIG_TOKEN === undefined) delete process.env.GITHUB_FEEDBACK_TOKEN;
  else process.env.GITHUB_FEEDBACK_TOKEN = ORIG_TOKEN;
  if (ORIG_REPO === undefined) delete process.env.GITHUB_FEEDBACK_REPO;
  else process.env.GITHUB_FEEDBACK_REPO = ORIG_REPO;
});

// ── createGitHubIssue ─────────────────────────────────────────────────────────

describe('createGitHubIssue', () => {
  it('returns number and url on 201 response', async () => {
    const mockResponse = makeFetchResponse(201, {
      number: 42,
      html_url: 'https://github.com/owner/repo/issues/42',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const result = await createGitHubIssue({ title: 'Bug report', body: 'It crashed.' });

    expect(result.number).toBe(42);
    expect(result.url).toBe('https://github.com/owner/repo/issues/42');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/owner/repo/issues');
    expect(init?.method).toBe('POST');
  });

  it('sends labels when provided', async () => {
    const mockResponse = makeFetchResponse(201, {
      number: 7,
      html_url: 'https://github.com/owner/repo/issues/7',
    });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    await createGitHubIssue({ title: 'Feature', body: 'Please add this.', labels: ['feature'] });

    const [, init] = fetchMock.mock.calls[0]!;
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody.labels).toEqual(['feature']);
  });

  it('throws GitHubAuthError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(401, 'Unauthorized')));

    await expect(createGitHubIssue({ title: 'X', body: 'Y' })).rejects.toThrow(GitHubAuthError);
  });

  it('throws GitHubAuthError on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(403, 'Forbidden')));

    await expect(createGitHubIssue({ title: 'X', body: 'Y' })).rejects.toThrow(GitHubAuthError);
  });

  it('throws GitHubAPIError on 422 (validation failed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(422, { message: 'Validation Failed' })),
    );

    await expect(createGitHubIssue({ title: 'X', body: 'Y' })).rejects.toThrow(GitHubAPIError);
  });

  it('throws GitHubNotConfigured when token is missing', async () => {
    delete process.env.GITHUB_FEEDBACK_TOKEN;

    await expect(createGitHubIssue({ title: 'X', body: 'Y' })).rejects.toThrow(
      GitHubNotConfigured,
    );
  });

  it('throws GitHubNotConfigured when repo is missing', async () => {
    delete process.env.GITHUB_FEEDBACK_REPO;

    await expect(createGitHubIssue({ title: 'X', body: 'Y' })).rejects.toThrow(
      GitHubNotConfigured,
    );
  });
});

// ── fetchIssueStatus ──────────────────────────────────────────────────────────

describe('fetchIssueStatus', () => {
  it('returns open state for an open issue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(200, { state: 'open', state_reason: null })),
    );

    const result = await fetchIssueStatus(42);
    expect(result?.state).toBe('open');
  });

  it('returns closed state for a closed issue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeFetchResponse(200, { state: 'closed', state_reason: 'completed' }),
      ),
    );

    const result = await fetchIssueStatus(99);
    expect(result?.state).toBe('closed');
    expect(result?.state_reason).toBe('completed');
  });

  it('returns null when GitHub API returns non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(404, 'Not Found')));

    const result = await fetchIssueStatus(999);
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await fetchIssueStatus(1);
    expect(result).toBeNull();
  });

  it('returns null when token is missing (best-effort)', async () => {
    delete process.env.GITHUB_FEEDBACK_TOKEN;

    const result = await fetchIssueStatus(1);
    expect(result).toBeNull();
  });
});
