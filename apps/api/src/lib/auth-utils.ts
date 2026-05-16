/**
 * auth-utils.ts — shared authentication helpers for route handlers
 *
 * Provides `authGuard` to reduce boilerplate session-check code across routes.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Validate that the request has an authenticated session.
 * Returns the userId on success.
 * On failure, sends 401 and returns null — the caller MUST early-return when null.
 */
export function authGuard(req: FastifyRequest, reply: FastifyReply): number | null {
  const userId = req.session.userId;
  if (!userId) {
    reply.code(401).send({ error: 'not_authenticated' });
    return null;
  }
  return userId;
}
