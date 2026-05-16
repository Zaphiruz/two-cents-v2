/**
 * qa.ts — Quick-action JWT consumer route (Phase 6b)
 *
 * POST /api/qa/:token
 *
 * No authentication required — the JWT token itself is the auth.
 * The token contains: requestId, action, approverId (HouseholdMember.id).
 *
 * Steps:
 *   1. Verify the JWT (signature + expiry) — throws JWTInvalidError → error handler → 400
 *   2. Mark the JWT's jti as consumed — throws JWTReplayError on replay → error handler → 409
 *   3. Look up the request and approver HouseholdMember
 *   4. Dispatch the transition() action using the buyer's seriousness (mirrors v1)
 *   5. Return { ok: true, status: '...' }
 *
 * v1 reference: apps/notifications/views.py quick_action()
 * Error handler: JWTInvalidError → 400, JWTReplayError → 409 (registered in plugins/error.ts)
 */

import type { FastifyInstance } from 'fastify';
import { verifyQuickAction, markConsumed } from '../lib/jwt.js';
import { transition } from '../lib/state.js';

export default async function qaRoutes(app: FastifyInstance) {
  // ── POST /api/qa/:token ───────────────────────────────────────────────────
  //
  // Quick-action JWT consumer.
  // On success: returns { ok: true, requestId, status, statusExpiresAt }
  // On JWT invalid: error handler maps JWTInvalidError → 400 { error: 'invalid_token' }
  // On JWT replay: error handler maps JWTReplayError → 409 { error: 'token_already_used' }
  // On illegal transition: error handler maps IllegalTransition → 409 { error: 'illegal_transition' }
  // On not found: 404 { error: 'not_found' }

  app.post<{ Params: { token: string } }>('/api/qa/:token', async (req, reply) => {
    const { token } = req.params;

    // 1. Verify the JWT — throws JWTInvalidError on bad/expired token (→ 400 via error handler)
    const claims = await verifyQuickAction(token);

    // 2. Mark as consumed — throws JWTReplayError if already used (→ 409 via error handler)
    await markConsumed(app.prisma, claims.jti);

    // 3. Look up the request to get buyer's seriousness (v1 uses req.buyer_seriousness for quick-approve)
    const request = await app.prisma.request.findUnique({
      where: { id: claims.requestId },
      select: { id: true, buyerSeriousness: true, status: true },
    });
    if (!request) {
      reply.code(404).send({ error: 'not_found', reason: 'request' });
      return;
    }

    // 4. Verify the approver HouseholdMember exists
    const approver = await app.prisma.householdMember.findUnique({
      where: { id: claims.approverId },
      select: { id: true },
    });
    if (!approver) {
      reply.code(404).send({ error: 'not_found', reason: 'approver' });
      return;
    }

    // 5. Dispatch the transition using the buyer's seriousness as the approverSeriousness
    //    (mirrors v1: seriousness = req.buyer_seriousness; quick-approve uses buyer's rating)
    const updated = await transition(app.prisma, claims.requestId, claims.action, {
      actorId: approver.id,
      approverSeriousness: request.buyerSeriousness,
    });

    return {
      ok: true,
      requestId: updated.id,
      status: updated.status,
      statusExpiresAt: updated.statusExpiresAt,
    };
  });
}
