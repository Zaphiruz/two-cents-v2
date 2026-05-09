/**
 * userSync.ts — port of v1's AuthentikOIDCBackend.create_user + update_user
 *
 * Mirrors the logic in apps/accounts/auth.py:
 * - find-or-create User keyed by oidc_subject
 * - name = claims.name || claims.preferred_username || claims.sub (create)
 *   name = claims.name || claims.preferred_username (update, only if truthy)
 * - is_admin = "two-cents-admins" in claims.groups (always synced on both create and update)
 * - if claims.preferred_username: resolve PendingMembership → HouseholdMember (create only)
 *
 * The pending resolution uses upsertMany semantics: skip if HouseholdMember already exists
 * (P2002 unique violation on [householdId, userId]) so it's safe on duplicate logins.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import type { User } from '.prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export interface OidcClaims {
  sub: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
  email?: string; // Authentik sends this; not stored
}

const ADMIN_GROUP = 'two-cents-admins';

function isAdminFromClaims(claims: OidcClaims): boolean {
  return (claims.groups ?? []).includes(ADMIN_GROUP);
}

export async function syncUserFromClaims(
  prisma: PrismaClient,
  claims: OidcClaims,
): Promise<User> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const isAdmin = isAdminFromClaims(claims);
    const username = claims.preferred_username ?? '';

    // Determine name for create vs update paths (matches v1 behavior):
    //   create: name || preferred_username || sub
    //   update: name || preferred_username  (only override if truthy)
    const nameForCreate =
      claims.name || claims.preferred_username || claims.sub;
    const nameForUpdate = claims.name || claims.preferred_username;

    // Check if the user already exists to decide create vs update path
    const existing = await tx.user.findUnique({
      where: { oidcSubject: claims.sub },
    });

    let user: User;

    if (!existing) {
      // --- create_user path ---
      user = await tx.user.create({
        data: {
          oidcSubject: claims.sub,
          name: nameForCreate,
          isAdmin,
        },
      });

      // Resolve any pending memberships keyed by Authentik username (create path only)
      if (username) {
        const pendings = await tx.pendingMembership.findMany({
          where: { authentikUsername: username },
        });
        for (const pending of pendings) {
          try {
            await tx.householdMember.create({
              data: {
                householdId: pending.householdId,
                userId: user.id,
                approvalMode: pending.approvalMode,
              },
            });
          } catch (err) {
            // P2002 = unique constraint: HouseholdMember already exists — skip
            if (
              err instanceof PrismaClientKnownRequestError &&
              err.code === 'P2002'
            ) {
              // Already a member; ignore
            } else {
              throw err;
            }
          }
          await tx.pendingMembership.delete({ where: { id: pending.id } });
        }
      }
    } else {
      // --- update_user path ---
      // Only update fields that have changed (mirrors v1's changed[] approach)
      const updates: { name?: string; isAdmin?: boolean } = {};

      if (nameForUpdate && existing.name !== nameForUpdate) {
        updates.name = nameForUpdate;
      }
      if (existing.isAdmin !== isAdmin) {
        updates.isAdmin = isAdmin;
      }

      if (Object.keys(updates).length > 0) {
        user = await tx.user.update({
          where: { id: existing.id },
          data: updates,
        });
      } else {
        user = existing;
      }
    }

    return user;
  });
}
