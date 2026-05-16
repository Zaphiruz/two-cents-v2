/**
 * comments.ts — comment routes (Task 4.2b)
 *
 * POST /api/requests/:id/comments — append a comment to a request
 *
 * Access control: canView (buyer OR approver of buyer may comment, matching v1's
 * post_comment view which allows both is_buyer and is_approver).
 *
 * v1 reference: apps/requests_app/views.py post_comment()
 */

import type { FastifyInstance } from 'fastify';
import { CommentInputSchema } from '@two-cents/shared';
import { memberForUser, canViewByMember } from '../lib/permissions.js';
import { authGuard } from '../lib/auth-utils.js';

export default async function commentsRoutes(app: FastifyInstance) {
  // ── POST /api/requests/:id/comments ──────────────────────────────────────
  //
  // Appends a comment to a request.
  // Returns 201 with { id, body, createdAt, author: { id, name } }.
  //
  // TODO(Phase 6): fireEvent('comment', { requestId, authorUserId, body })

  app.post<{ Params: { id: string } }>('/api/requests/:id/comments', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || !Number.isInteger(requestId) || requestId <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }

    // Validate body — ZodError → 400
    const body = CommentInputSchema.parse(req.body);

    // Single member lookup — used for both permission check and comment authorship
    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    // canViewByMember: returns null if request missing (404), false if no view permission (403)
    const allowed = await canViewByMember(app.prisma, member.id, requestId);
    if (allowed === null) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (!allowed) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }

    // Look up the User so we can record authorId on the Comment
    // (v1 stores author=request.user which is the Django User, not the member)
    const comment = await app.prisma.comment.create({
      data: {
        requestId,
        authorId: userId,
        body: body.body,
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });

    reply.code(201).send(comment);
  });
}
