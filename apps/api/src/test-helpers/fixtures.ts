import { PrismaClient } from '@prisma/client';
import { RequestStatus, Seriousness } from '@two-cents/shared';
import { prisma } from './db.js';

let _oidcCounter = 0;
function nextOidc(): string {
  return `test-subject-${++_oidcCounter}`;
}

export interface MembersFixture {
  buyer: { id: number; householdId: number };
  approver: { id: number; householdId: number };
  householdId: number;
}

/**
 * Creates a Household with two members: buyer and approver.
 */
export async function createMembers(
  db: PrismaClient = prisma,
): Promise<MembersFixture> {
  const household = await db.household.create({ data: { name: 'TestHousehold' } });

  const buyerUser = await db.user.create({
    data: { name: 'Buyer', oidcSubject: nextOidc() },
  });
  const approverUser = await db.user.create({
    data: { name: 'Approver', oidcSubject: nextOidc() },
  });

  const buyer = await db.householdMember.create({
    data: { householdId: household.id, userId: buyerUser.id },
  });
  const approver = await db.householdMember.create({
    data: { householdId: household.id, userId: approverUser.id },
  });

  return {
    buyer: { id: buyer.id, householdId: household.id },
    approver: { id: approver.id, householdId: household.id },
    householdId: household.id,
  };
}

export interface CreateRequestOpts {
  householdId: number;
  buyerId: number;
  title?: string;
  buyerSeriousness?: Seriousness;
  status?: RequestStatus;
  /** Price in cents for the first RequestItem. Defaults to 1000 (= $10). */
  priceCents?: number;
  url?: string;
}

/**
 * Creates a Request with one RequestItem attached.
 */
export async function createRequest(
  opts: CreateRequestOpts,
  db: PrismaClient = prisma,
): Promise<{ id: number }> {
  const request = await db.request.create({
    data: {
      householdId: opts.householdId,
      buyerId: opts.buyerId,
      title: opts.title ?? 'Test Item',
      buyerSeriousness: opts.buyerSeriousness ?? 'need',
      status: opts.status ?? 'pending',
      items: {
        create: {
          title: opts.title ?? 'Test Item',
          url: opts.url ?? 'https://example.com',
          priceCents: opts.priceCents ?? 1000,
          position: 0,
        },
      },
    },
  });
  return { id: request.id };
}
