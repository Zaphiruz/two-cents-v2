/**
 * Local dev seed. Idempotent: safe to re-run.
 *
 * Creates one household, three users (admin/Bob/Carol) with mutual approver
 * links, and a handful of requests in various states so the web UI has
 * something to render. The "admin" user is also the one wired into the
 * dev-login route — log in with username `admin` / password `admin`.
 *
 * Usage (from repo root):
 *   DATABASE_URL=postgresql://two_cents_v2:two_cents_v2@localhost:5435/two_cents_v2 \
 *     pnpm --filter @two-cents/api exec tsx prisma/seed.ts
 *
 * Skippable on deploy: only invoked manually; never wired into migrate deploy.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertUser(oidcSubject: string, name: string, isAdmin = false) {
  return prisma.user.upsert({
    where: { oidcSubject },
    update: { name, isAdmin },
    create: { oidcSubject, name, isAdmin },
  });
}

async function ensureMember(householdId: number, userId: number) {
  return prisma.householdMember.upsert({
    where: { householdId_userId: { householdId, userId } },
    update: {},
    create: { householdId, userId, approvalMode: 'any' },
  });
}

async function ensureLink(buyerId: number, approverId: number) {
  return prisma.buyerApprover.upsert({
    where: { buyerId_approverId: { buyerId, approverId } },
    update: {},
    create: { buyerId, approverId },
  });
}

async function main() {
  // ── household ───────────────────────────────────────────────────────────────
  const existingHousehold = await prisma.household.findFirst({
    where: { name: 'Dev Household' },
  });
  const household =
    existingHousehold ??
    (await prisma.household.create({
      data: {
        name: 'Dev Household',
        appealQuotaCount: 2,
        appealQuotaPeriod: 'quarterly',
      },
    }));

  // ── users + members ────────────────────────────────────────────────────────
  // The "admin" user is the one wired into dev-login (password also "admin").
  const admin = await upsertUser('dev:admin', 'admin', true);
  const bob = await upsertUser('dev:bob', 'Bob');
  const carol = await upsertUser('dev:carol', 'Carol');

  const adminM = await ensureMember(household.id, admin.id);
  const bobM = await ensureMember(household.id, bob.id);
  const carolM = await ensureMember(household.id, carol.id);

  // ── approver links (everyone approves everyone) ────────────────────────────
  await ensureLink(adminM.id, bobM.id);
  await ensureLink(adminM.id, carolM.id);
  await ensureLink(bobM.id, adminM.id);
  await ensureLink(bobM.id, carolM.id);
  await ensureLink(carolM.id, adminM.id);
  await ensureLink(carolM.id, bobM.id);

  // ── sample requests (skip if any already exist for this household) ─────────
  const existingRequests = await prisma.request.count({
    where: { householdId: household.id },
  });
  if (existingRequests > 0) {
    console.log(
      `[seed] household ${household.id} already has ${existingRequests} request(s); skipping request seed`,
    );
  } else {
    const now = new Date();

    await prisma.request.create({
      data: {
        householdId: household.id,
        buyerId: adminM.id,
        title: 'Replacement coffee grinder',
        description: 'The old one finally died. Burr grinder this time.',
        buyerSeriousness: 'really_want',
        status: 'pending',
        currency: 'USD',
        items: {
          create: [
            {
              title: 'Baratza Encore',
              url: 'https://baratza.com/grinder/encore/',
              priceCents: 17_999,
              position: 0,
            },
          ],
        },
      },
    });

    await prisma.request.create({
      data: {
        householdId: household.id,
        buyerId: bobM.id,
        title: 'Camping cookware set',
        description: 'For the trip in August.',
        buyerSeriousness: 'nice_to_have',
        status: 'pending',
        currency: 'USD',
        items: {
          create: [
            {
              title: 'GSI Pinnacle Camper',
              url: 'https://www.gsioutdoors.com/pinnacle-camper.html',
              priceCents: 11_995,
              position: 0,
            },
            {
              title: 'MSR PocketRocket 2',
              url: 'https://www.msrgear.com/pocketrocket-2-stove',
              priceCents: 4_995,
              position: 1,
            },
          ],
        },
      },
    });

    // approved bundle by Carol
    const approved = await prisma.request.create({
      data: {
        householdId: household.id,
        buyerId: carolM.id,
        title: 'Standing desk converter',
        description: '',
        buyerSeriousness: 'need',
        status: 'approved',
        currency: 'USD',
        items: {
          create: [
            {
              title: 'Vivo Standing Desk Converter',
              url: 'https://www.vivo-us.com/products/desk-v000k',
              priceCents: 16_499,
              position: 0,
            },
          ],
        },
      },
    });
    await prisma.review.create({
      data: {
        requestId: approved.id,
        approverId: adminM.id,
        action: 'approve',
        approverSeriousness: 'need',
        notes: 'Yes, your back will thank you.',
      },
    });

    // denied bundle (so we can exercise the appeal flow)
    const denied = await prisma.request.create({
      data: {
        householdId: household.id,
        buyerId: adminM.id,
        title: 'New monitor (32" 4K)',
        description: 'For the home office.',
        buyerSeriousness: 'really_want',
        status: 'denied',
        currency: 'USD',
        items: {
          create: [
            {
              title: 'LG 32UN880-B',
              url: 'https://www.lg.com/us/monitors/lg-32un880-b',
              priceCents: 69_999,
              position: 0,
            },
          ],
        },
      },
    });
    await prisma.review.create({
      data: {
        requestId: denied.id,
        approverId: bobM.id,
        action: 'deny',
        approverSeriousness: 'nice_to_have',
        notes: 'Maybe next quarter.',
      },
    });

    // delayed bundle
    const delayed = await prisma.request.create({
      data: {
        householdId: household.id,
        buyerId: bobM.id,
        title: 'Espresso machine',
        description: '',
        buyerSeriousness: 'nice_to_have',
        status: 'delayed',
        statusExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        currency: 'USD',
        items: {
          create: [
            {
              title: 'Breville Bambino Plus',
              url: 'https://www.breville.com/us/en/products/espresso/bes500.html',
              priceCents: 49_999,
              position: 0,
            },
          ],
        },
      },
    });
    await prisma.review.create({
      data: {
        requestId: delayed.id,
        approverId: carolM.id,
        action: 'delay',
        approverSeriousness: 'really_want',
        delayDays: 7,
        delayExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        reconfirmDeadline: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        notes: 'Sleep on it for a week.',
      },
    });
  }

  console.log('[seed] done:', {
    household: household.id,
    users: { admin: admin.id, bob: bob.id, carol: carol.id },
    members: { admin: adminM.id, bob: bobM.id, carol: carolM.id },
  });
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
