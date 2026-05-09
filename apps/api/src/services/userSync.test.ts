/**
 * userSync.test.ts — mirrors v1's test_auth.py 1:1
 *
 * Tests for syncUserFromClaims covering:
 *   - new user creation (name fallback, admin group, pending resolution)
 *   - existing user update (name update, admin promote/demote, no-groups demotes)
 *   - pending resolution idempotency (P2002 skip)
 *   - username absent → no pending resolution
 *
 * The global beforeEach in test-helpers/setup.ts clears the DB before each test.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '../test-helpers/db.js';
import { syncUserFromClaims } from './userSync.js';

// ── Test 1: create_user resolves pending memberships ─────────────────────────

describe('syncUserFromClaims — new user', () => {
  it('resolves pending memberships on first login', async () => {
    const household = await prisma.household.create({ data: { name: 'H' } });
    await prisma.pendingMembership.create({
      data: {
        householdId: household.id,
        authentikUsername: 'newcomer',
        approvalMode: 'all',
      },
    });

    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-newcomer',
      name: 'Newcomer',
      preferred_username: 'newcomer',
    });

    const member = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId: user.id },
    });
    expect(member).not.toBeNull();
    expect(member!.approvalMode).toBe('all');

    const remaining = await prisma.pendingMembership.findFirst({
      where: { authentikUsername: 'newcomer' },
    });
    expect(remaining).toBeNull();
  });

  it('does not resolve pending memberships when no preferred_username', async () => {
    const household = await prisma.household.create({ data: { name: 'H' } });
    await prisma.pendingMembership.create({
      data: {
        householdId: household.id,
        authentikUsername: 'someone',
        approvalMode: 'any',
      },
    });

    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-other',
      name: 'Other',
    });

    expect(user.oidcSubject).toBe('sub-other');
    // PendingMembership for "someone" remains unresolved
    const remaining = await prisma.pendingMembership.findFirst({
      where: { authentikUsername: 'someone' },
    });
    expect(remaining).not.toBeNull();
  });

  it('creates user in admin group with is_admin=true', async () => {
    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-admin',
      name: 'Admin',
      groups: ['two-cents-admins', 'other'],
    });
    expect(user.isAdmin).toBe(true);
  });

  it('creates user NOT in admin group with is_admin=false', async () => {
    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-plain',
      name: 'Plain',
      groups: ['two-cents-users'],
    });
    expect(user.isAdmin).toBe(false);
  });

  it('falls back to preferred_username when no name', async () => {
    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-noname',
      preferred_username: 'myusername',
    });
    expect(user.name).toBe('myusername');
  });

  it('falls back to sub when neither name nor preferred_username', async () => {
    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-anon',
    });
    expect(user.name).toBe('sub-anon');
  });

  it('does not resolve pendings for a different username', async () => {
    const household = await prisma.household.create({ data: { name: 'H2' } });
    await prisma.pendingMembership.create({
      data: {
        householdId: household.id,
        authentikUsername: 'alice',
        approvalMode: 'any',
      },
    });

    // Bob logs in, not alice
    await syncUserFromClaims(prisma, {
      sub: 'sub-bob',
      preferred_username: 'bob',
    });

    const remaining = await prisma.pendingMembership.findFirst({
      where: { authentikUsername: 'alice' },
    });
    expect(remaining).not.toBeNull(); // alice's pending still there
  });
});

// ── Test 2: update_user — admin promote/demote ────────────────────────────────

describe('syncUserFromClaims — existing user', () => {
  it('promotes user to admin when added to group', async () => {
    // Create user first (not admin)
    await prisma.user.create({
      data: { oidcSubject: 'sub-x', name: 'X', isAdmin: false },
    });

    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-x',
      name: 'X',
      groups: ['two-cents-admins'],
    });

    expect(user.isAdmin).toBe(true);
  });

  it('demotes admin when removed from group', async () => {
    await prisma.user.create({
      data: { oidcSubject: 'sub-y', name: 'Y', isAdmin: true },
    });

    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-y',
      name: 'Y',
      groups: ['two-cents-users'],
    });

    expect(user.isAdmin).toBe(false);
  });

  it('demotes admin when groups claim is absent (treated as not admin)', async () => {
    await prisma.user.create({
      data: { oidcSubject: 'sub-z', name: 'Z', isAdmin: true },
    });

    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-z',
      name: 'Z',
      // no groups claim
    });

    expect(user.isAdmin).toBe(false);
  });

  it('updates name on re-login when name changes', async () => {
    await prisma.user.create({
      data: { oidcSubject: 'sub-rename', name: 'OldName', isAdmin: false },
    });

    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-rename',
      name: 'NewName',
    });

    expect(user.name).toBe('NewName');
  });

  it('does not update name when name claim is absent', async () => {
    await prisma.user.create({
      data: { oidcSubject: 'sub-nochange', name: 'Existing', isAdmin: false },
    });

    const user = await syncUserFromClaims(prisma, {
      sub: 'sub-nochange',
      // no name, no preferred_username
    });

    expect(user.name).toBe('Existing');
  });
});

// ── Test 3: pending resolution — create path only ────────────────────────────
//
// Note: the P2002 catch in syncUserFromClaims guards a race condition during
// concurrent first-login: two parallel callbacks for the same fresh user could
// both pass the `user.create` and both attempt `householdMember.create` for the
// same (householdId, userId) pair. We don't have a clean way to reproduce this
// without intercepting Prisma's transaction layer, so there is no unit test for
// the P2002 path. The catch is intentionally defensive.
//
// Pending resolution is create-only (matching v1 AuthentikOIDCBackend.create_user).
// Re-logins (existing sub) go through the update path which does NOT call
// pending resolution — there is nothing to idempotency-guard on update.

describe('syncUserFromClaims — pending resolution is create-only', () => {
  it('does not resolve pending memberships on re-login of existing user', async () => {
    const household = await prisma.household.create({ data: { name: 'H-relogin' } });
    const existing = await prisma.user.create({
      data: { oidcSubject: 'sub-relogin', name: 'ReLogin', isAdmin: false },
    });
    await prisma.pendingMembership.create({
      data: {
        householdId: household.id,
        authentikUsername: 'relogin-user',
        approvalMode: 'any',
      },
    });

    // Second login of the same sub — takes the UPDATE path, leaves pending untouched
    const userAgain = await syncUserFromClaims(prisma, {
      sub: 'sub-relogin',
      name: 'ReLogin',
      preferred_username: 'relogin-user',
    });

    expect(userAgain.id).toBe(existing.id);

    // Pending should NOT have been consumed (update path skips pending resolution)
    const remaining = await prisma.pendingMembership.findFirst({
      where: { authentikUsername: 'relogin-user' },
    });
    expect(remaining).not.toBeNull();

    // No HouseholdMember was created
    const member = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId: existing.id },
    });
    expect(member).toBeNull();
  });
});
