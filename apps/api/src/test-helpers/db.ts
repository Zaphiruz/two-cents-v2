import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Truncate all tables in dependency-safe order (children before parents).
 * Uses CASCADE to avoid FK constraint issues.
 */
export async function clearDatabase(): Promise<void> {
  // Use CASCADE to handle all FK dependencies in one shot
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      feedback_submissions,
      notification_logs,
      notification_preferences,
      push_subscriptions,
      consumed_jwt_jtis,
      appeals,
      reviews,
      comments,
      listing_versions,
      request_items,
      requests,
      buyer_approvers,
      pending_memberships,
      household_members,
      households,
      users
    RESTART IDENTITY CASCADE
  `);
}
