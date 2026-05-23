/**
 * github.ts — GitHub Issues API integration for the feedback feature (Phase 7)
 *
 * Two exported functions:
 *   createGitHubIssue  — POST a new issue to the configured repo
 *   fetchIssueStatus   — GET an existing issue's open/closed state
 *
 * Environment variables:
 *   GITHUB_FEEDBACK_TOKEN — Personal Access Token or GitHub App token
 *   GITHUB_FEEDBACK_REPO  — "owner/repo" e.g. "acme/two-cents-feedback"
 *
 * Error hierarchy:
 *   GitHubNotConfigured — token or repo env var is missing
 *   GitHubAuthError     — 401 or 403 from GitHub API
 *   GitHubAPIError      — any other 4xx / 5xx from GitHub API
 *
 * v1 reference: apps/feedback/services.py
 */

export class GitHubNotConfigured extends Error {
  constructor() {
    super('GITHUB_FEEDBACK_TOKEN or GITHUB_FEEDBACK_REPO is not configured');
    this.name = 'GitHubNotConfigured';
  }
}

export class GitHubAuthError extends Error {
  constructor(status: number, body: string) {
    super(`GitHub authentication failed (${status}): ${body}`);
    this.name = 'GitHubAuthError';
  }
}

export class GitHubAPIError extends Error {
  constructor(status: number, body: string) {
    super(`GitHub API error (${status}): ${body}`);
    this.name = 'GitHubAPIError';
  }
}

function getConfig(): { token: string; repo: string } {
  const token = process.env.GITHUB_FEEDBACK_TOKEN;
  const repo = process.env.GITHUB_FEEDBACK_REPO;
  if (!token || !repo) throw new GitHubNotConfigured();
  return { token, repo };
}

function makeHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'two-cents-feedback/1.0',
  };
}

/**
 * Creates a new GitHub issue in the configured feedback repo.
 * Returns { number, url } on success.
 * Throws GitHubNotConfigured if env vars are missing.
 * Throws GitHubAuthError on 401/403.
 * Throws GitHubAPIError on other 4xx/5xx.
 */
export async function createGitHubIssue(opts: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<{ number: number; url: string }> {
  const { token, repo } = getConfig();

  const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      labels: opts.labels ?? [],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      throw new GitHubAuthError(resp.status, text);
    }
    throw new GitHubAPIError(resp.status, text);
  }

  const data = (await resp.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}

/**
 * Fetches the state of an existing GitHub issue.
 * Returns { state, state_reason } on success.
 * Returns null on any failure (best-effort — matching v1 fetch_issue_state semantics).
 * Will also return null if env vars are missing.
 */
export async function fetchIssueStatus(
  issueNumber: number,
): Promise<{ state: 'open' | 'closed'; state_reason?: string } | null> {
  let token: string;
  let repo: string;
  try {
    const cfg = getConfig();
    token = cfg.token;
    repo = cfg.repo;
  } catch {
    return null;
  }

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      { headers: makeHeaders(token) },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { state: string; state_reason?: string };
    const state = data.state === 'closed' ? 'closed' : 'open';
    return { state, state_reason: data.state_reason };
  } catch {
    return null;
  }
}
