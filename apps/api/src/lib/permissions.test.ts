/**
 * permissions.test.ts — unit tests for isBuyer / canAct / canView helpers
 *
 * 9 tests covering all three helpers' true and false paths.
 * Uses real Prisma fixtures (createMembers + createRequest).
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '../test-helpers/db.js';
import { createMembers, createRequest } from '../test-helpers/fixtures.js';
import { isBuyer, canAct, canView, isBuyerByMember, canActByMember, canViewByMember } from './permissions.js';

describe('permissions', () => {
  // ── isBuyer ────────────────────────────────────────────────────────────────

  it('isBuyer returns true for the buyer of a request', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    expect(await isBuyer(prisma, buyerUser.userId, requestId)).toBe(true);
  });

  it('isBuyer returns false for the approver of a request', async () => {
    const { buyer, approver, householdId } = await createMembers();
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    expect(await isBuyer(prisma, approverUser.userId, requestId)).toBe(false);
  });

  it('isBuyer returns false for an unknown request id', async () => {
    const { buyer } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });

    expect(await isBuyer(prisma, buyerUser.userId, 999999)).toBe(false);
  });

  // ── canAct ─────────────────────────────────────────────────────────────────

  it('canAct returns true when caller is an approver of the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    // Wire buyer → approver link
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    expect(await canAct(prisma, approverUser.userId, requestId)).toBe(true);
  });

  it('canAct returns false when no BuyerApprover link exists', async () => {
    const { buyer, approver, householdId } = await createMembers();
    // No buyerApprover link created
    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    expect(await canAct(prisma, approverUser.userId, requestId)).toBe(false);
  });

  it('canAct returns false for the buyer themselves', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    expect(await canAct(prisma, buyerUser.userId, requestId)).toBe(false);
  });

  // ── canView ────────────────────────────────────────────────────────────────

  it('canView returns true for the buyer', async () => {
    const { buyer, householdId } = await createMembers();
    const buyerUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    expect(await canView(prisma, buyerUser.userId, requestId)).toBe(true);
  });

  it('canView returns true for an approver of the buyer', async () => {
    const { buyer, approver, householdId } = await createMembers();
    await prisma.buyerApprover.create({ data: { buyerId: buyer.id, approverId: approver.id } });

    const approverUser = await prisma.householdMember.findUniqueOrThrow({
      where: { id: approver.id },
      select: { userId: true },
    });
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    expect(await canView(prisma, approverUser.userId, requestId)).toBe(true);
  });

  it('canView returns false for an unrelated user (different household)', async () => {
    const { buyer, householdId } = await createMembers();
    const { id: requestId } = await createRequest({ householdId, buyerId: buyer.id });

    // Create a separate household and user with no relation to this request
    const otherHousehold = await prisma.household.create({ data: { name: 'OtherHousehold' } });
    const otherUser = await prisma.user.create({
      data: { oidcSubject: 'unrelated-user-oidc', name: 'Stranger' },
    });
    await prisma.householdMember.create({
      data: { householdId: otherHousehold.id, userId: otherUser.id },
    });

    expect(await canView(prisma, otherUser.id, requestId)).toBe(false);
  });

  // ── *ByMember null-on-missing-request ─────────────────────────────────────

  it('isBuyerByMember returns null when the request does not exist', async () => {
    const { buyer } = await createMembers();
    expect(await isBuyerByMember(prisma, buyer.id, 999999)).toBeNull();
  });

  it('canActByMember returns null when the request does not exist', async () => {
    const { approver } = await createMembers();
    expect(await canActByMember(prisma, approver.id, 999999)).toBeNull();
  });

  it('canViewByMember returns null when the request does not exist', async () => {
    const { buyer } = await createMembers();
    expect(await canViewByMember(prisma, buyer.id, 999999)).toBeNull();
  });
});
