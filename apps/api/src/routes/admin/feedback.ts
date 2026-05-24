import type { FastifyInstance } from 'fastify';
import { AdminListFeedbackQuerySchema } from '@two-cents/shared';

export default async function adminFeedbackRoutes(app: FastifyInstance) {
  app.get('/api/admin/feedback', async (req) => {
    const query = AdminListFeedbackQuerySchema.parse(req.query ?? {});
    const limit = query.limit ?? 50;

    const where = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.hasGhIssue === true ? { githubIssueNumber: { not: null } } : {}),
      ...(query.hasGhIssue === false ? { githubIssueNumber: null } : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };

    const rows = await app.prisma.feedbackSubmission.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        category: true,
        githubIssueNumber: true,
        githubIssueUrl: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return {
      submissions: slice.map((r) => ({
        id: r.id,
        category: r.category,
        githubIssueNumber: r.githubIssueNumber,
        githubIssueUrl: r.githubIssueUrl,
        createdAt: r.createdAt,
        userId: r.user.id,
        userName: r.user.name,
      })),
      nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    };
  });
}
