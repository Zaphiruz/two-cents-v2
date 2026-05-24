import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'fb-admin', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

describe('GET /api/admin/feedback', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'fb-non', name: 'N', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('lists feedback submissions with user names', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const u = await prisma.user.create({
        data: { oidcSubject: 'fb-u', name: 'Reporter', isAdmin: false },
      });
      await prisma.feedbackSubmission.create({
        data: {
          userId: u.id,
          category: 'bug',
          githubIssueNumber: 42,
          githubIssueUrl: 'https://github.com/Zaphiruz/two-cents-v2/issues/42',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.submissions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'bug',
            githubIssueNumber: 42,
            githubIssueUrl: 'https://github.com/Zaphiruz/two-cents-v2/issues/42',
            userName: 'Reporter',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('filters by category', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const u = await prisma.user.create({
        data: { oidcSubject: 'fb-cat', name: 'C', isAdmin: false },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: 'bug' },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: 'enhancement' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback?category=bug',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.submissions).toHaveLength(1);
      expect(body.submissions[0].category).toBe('bug');
    } finally {
      await app.close();
    }
  });

  it('filters by hasGhIssue=true (only rows with githubIssueNumber set)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const u = await prisma.user.create({
        data: { oidcSubject: 'fb-gh', name: 'G', isAdmin: false },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: '', githubIssueNumber: 7 },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: '' /* githubIssueNumber null */ },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback?hasGhIssue=true',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.submissions).toHaveLength(1);
      expect(body.submissions[0].githubIssueNumber).toBe(7);
    } finally {
      await app.close();
    }
  });
});
