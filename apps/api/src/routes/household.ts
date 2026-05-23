/**
 * household.ts — Household routes (Phase 7)
 *
 * GET  /api/household         — current user's household + members + myApprovers + myBuyers
 * POST /api/household/invite  — invite someone to the household (creates PendingMembership)
 *
 * v1 reference: apps/households/views.py (household_overview + invite_member)
 * v1 reference: apps/households/models.py (Household / HouseholdMember / BuyerApprover / PendingMembership)
 *
 * Admin rules (from v1): Any household member may send an invite — there is no admin
 * gate in v1's invite_member view. The view only checks that the caller has a
 * HouseholdMember row; if not, it redirects to overview. We mirror that: 403 if
 * no membership, otherwise allow.
 *
 * PendingMembership has a unique constraint on (householdId, authentikUsername).
 * Prisma throws P2002 on duplicate — the error handler maps that to 409.
 */

import type { FastifyInstance } from 'fastify';
import { HouseholdInviteInputSchema } from '@two-cents/shared';
import { authGuard } from '../lib/auth-utils.js';
import { memberForUser } from '../lib/permissions.js';

export default async function householdRoutes(app: FastifyInstance) {
  // ── GET /api/household ────────────────────────────────────────────────────
  //
  // Returns the caller's household with full member list, plus:
  //   myApprovers — HouseholdMember rows that are configured as approvers of ME
  //                 (BuyerApprover rows where buyer_id = my member id)
  //   myBuyers    — HouseholdMember rows whose requests I approve
  //                 (BuyerApprover rows where approver_id = my member id)
  //
  // If the user is not in a household, returns { household: null }.
  // (v1 renders a 403 page; the API returns 200 with null to let the client decide.)

  app.get('/api/household', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      return { household: null };
    }

    // Full household with all members (each with their user info)
    const household = await app.prisma.household.findUnique({
      where: { id: member.householdId },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!household) {
      return { household: null };
    }

    // myApprovers: BuyerApprover rows where buyer_id = my member id,
    // i.e. "these members approve my requests"
    // v1: HouseholdMember.objects.filter(buyer_links__buyer=member).select_related("user")
    // In Prisma terms: find HouseholdMembers linked via BuyerApprover.approver where BuyerApprover.buyer = me
    const myApproversLinks = await app.prisma.buyerApprover.findMany({
      where: { buyerId: member.id },
      include: {
        approver: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    // myBuyers: BuyerApprover rows where approver_id = my member id,
    // i.e. "I approve the requests of these members"
    // v1: HouseholdMember.objects.filter(approver_links__approver=member).select_related("user")
    const myBuyersLinks = await app.prisma.buyerApprover.findMany({
      where: { approverId: member.id },
      include: {
        buyer: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    const myApprovers = myApproversLinks.map((link: (typeof myApproversLinks)[number]) => ({
      id: link.approver.id,
      approvalMode: link.approver.approvalMode,
      joinedAt: link.approver.joinedAt,
      user: link.approver.user,
    }));

    const myBuyers = myBuyersLinks.map((link: (typeof myBuyersLinks)[number]) => ({
      id: link.buyer.id,
      approvalMode: link.buyer.approvalMode,
      joinedAt: link.buyer.joinedAt,
      user: link.buyer.user,
    }));

    return { household, myApprovers, myBuyers };
  });

  // ── POST /api/household/invite ─────────────────────────────────────────────
  //
  // Body: { authentikUsername: string }
  // Creates a PendingMembership for the given username scoped to the caller's
  // household. Uses get_or_create semantics (P2002 → 409 via error handler).
  // Returns 201 + the pending membership row.
  //
  // v1: any member may invite (no admin check). We mirror that.

  app.post('/api/household/invite', async (req, reply) => {
    const userId = authGuard(req, reply);
    if (userId === null) return;

    const member = await memberForUser(app.prisma, userId);
    if (!member) {
      reply.code(403).send({ error: 'not_in_household' });
      return;
    }

    // Validate body — ZodError → 400 via error handler
    const body = HouseholdInviteInputSchema.parse(req.body);

    // upsert: match v1's get_or_create(household, authentik_username, defaults={approval_mode:'any'})
    // We use create here; if there's a duplicate Prisma throws P2002 → 409.
    const pending = await app.prisma.pendingMembership.create({
      data: {
        householdId: member.householdId,
        authentikUsername: body.authentikUsername,
        approvalMode: 'any',
      },
    });

    reply.code(201).send({ pending });
  });
}
