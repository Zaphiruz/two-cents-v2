/**
 * feedback.ts — Feedback routes (Phase 7)
 *
 * POST /api/feedback  — submit feedback; best-effort GitHub issue creation; rate-limited 1/min/user
 * GET  /api/feedback  — list current user's feedback with live GitHub status
 *
 * v1 reference: apps/feedback/views.py + apps/feedback/services.py
 *
 * v1 behavior:
 *   - Rate limit 1/minute/user (Django cache with timeout=60)
 *   - If no GITHUB_FEEDBACK_TOKEN/REPO: record submission without GitHub issue
 *   - If GitHub call fails: v1 re-renders the form with an inline error (doesn't return 5xx)
 *   - We mirror this: store the submission even when GitHub fails (githubIssueNumber: null)
 *   - fetchIssueStatus: best-effort; null/failure → "unknown" state in list
 *   - v1 feedback model has no `title` field; we add it (stored as part of the issue title)
 *     and store the category + github metadata. We do NOT store the body text in DB.
 */

import type { FastifyInstance } from 'fastify';
import { FeedbackInputSchema } from '@two-cents/shared';
import { authGuard } from '../lib/auth-utils.js';
import { createGitHubIssue, fetchIssueStatus, GitHubNotConfigured } from '../lib/github.js';
import { checkRateLimit } from '../lib/rateLimit.js';

export default async function feedbackRoutes(app: FastifyInstance) {
  // ── POST /api/feedback ────────────────────────────────────────────────────
  //
  // Rate-limited: 1 request per minute per user (via Redis).
  // GitHub issue creation is best-effort: if it fails, the submission is still
  // stored with githubIssueNumber: null (matching v1 behavior for unconfigured
  // repos and for GitHubNotConfigured).
  //
  // Returns 201 + the created FeedbackSubmission row.

  app.post('/api/feedback', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    // Rate limit check — 1 per 60 seconds per user
    const rateKey = `feedback_rate:${userId}`;
    const rateResult = await checkRateLimit(app.redis, rateKey, 1, 60);
    if (!rateResult.allowed) {
      reply.code(429).send({
        error: 'rate_limited',
        resetInSeconds: rateResult.resetInSeconds,
      });
      return;
    }

    // Validate body — ZodError → 400 via error handler
    const body = FeedbackInputSchema.parse(req.body);

    // Best-effort GitHub issue creation
    let githubIssueNumber: number | null = null;
    let githubIssueUrl = '';

    try {
      const labels = body.category ? [body.category] : [];
      const issue = await createGitHubIssue({
        title: body.title,
        body: body.body,
        labels,
      });
      githubIssueNumber = issue.number;
      githubIssueUrl = issue.url;
    } catch (err) {
      if (err instanceof GitHubNotConfigured) {
        // Not configured — record without GitHub link (v1 behavior)
        req.log.debug('GitHub not configured, storing feedback without issue link');
      } else {
        // API error — log but don't fail the request (mirrors v1's inline-error approach)
        req.log.warn({ err }, 'GitHub issue creation failed; storing feedback without issue link');
      }
    }

    const submission = await app.prisma.feedbackSubmission.create({
      data: {
        userId,
        githubIssueNumber,
        githubIssueUrl,
        category: body.category ?? '',
      },
    });

    reply.code(201).send({ submission });
  });

  // ── GET /api/feedback ─────────────────────────────────────────────────────
  //
  // Lists the authenticated user's FeedbackSubmission rows, ordered newest first.
  // For each row that has a githubIssueNumber, fetches live status from GitHub
  // in parallel (Promise.all). On failure, state is 'unknown'.
  //
  // v1 reference: feedback_list view — same pattern (sequential in v1, parallel here).

  app.get('/api/feedback', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const submissions = await app.prisma.feedbackSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch live GitHub state in parallel for all submissions that have an issue number
    const statusResults = await Promise.all(
      submissions.map(async (s: (typeof submissions)[number]) => {
        if (!s.githubIssueNumber) return null;
        try {
          return await fetchIssueStatus(s.githubIssueNumber);
        } catch {
          return null;
        }
      }),
    );

    const rows = submissions.map((s: (typeof submissions)[number], i: number) => ({
      ...s,
      githubState: statusResults[i]?.state ?? (s.githubIssueNumber ? 'unknown' : null),
      githubStateReason: statusResults[i]?.state_reason ?? null,
    }));

    return { submissions: rows };
  });
}
