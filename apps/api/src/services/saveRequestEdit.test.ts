/**
 * saveRequestEdit.test.ts — mirrors v1 test_services.py 1:1
 *
 * Each test sets up a Household + Member + Request + RequestItem(s), calls
 * saveRequestEdit(), then asserts the resulting DB state.
 *
 * The global beforeEach in test-helpers/setup.ts clears the DB before each test.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '../test-helpers/db.js';
import { createMembers } from '../test-helpers/fixtures.js';
import { saveRequestEdit } from './saveRequestEdit.js';
import { IllegalTransition } from '../lib/state.js';

// ── Helper: create a request with one item (mirrors v1's _make_request_with_item) ──

async function makeRequestWithItem(
  buyerId: number,
  householdId: number,
  opts: {
    title?: string;
    url?: string;
    priceCents?: number;
    status?: 'pending' | 'delayed' | 'awaiting_reconfirm';
  } = {},
): Promise<{ requestId: number; itemId: number }> {
  const title = opts.title ?? 'X';
  const url = opts.url ?? 'https://x.example';
  const priceCents = opts.priceCents ?? 100;
  const status = opts.status ?? 'delayed';

  const request = await prisma.request.create({
    data: {
      householdId,
      buyerId,
      title,
      buyerSeriousness: 'need',
      status,
      items: {
        create: {
          title,
          url,
          priceCents,
          position: 0,
        },
      },
    },
    include: { items: true },
  });

  return { requestId: request.id, itemId: request.items[0]!.id };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('saveRequestEdit', () => {
  // ── 1. Trivial edit: title/description change, same items ─────────────────

  it('trivial edit does not create a ListingVersion row or reset status', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { title: 'Old', url: 'https://x.example', priceCents: 100, status: 'delayed' },
    );

    // Fetch the item to build the payload
    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    await saveRequestEdit(prisma, {
      requestId,
      bundleChanges: {
        title: 'New title (typo fix)',
        description: 'updated desc',
        buyerSeriousness: 'need',
      },
      itemsPayload: [
        {
          id: item.id,
          title: item.title,
          url: item.url,
          priceCents: item.priceCents,
          notes: item.notes,
        },
      ],
    });

    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.title).toBe('New title (typo fix)');
    expect(req.status).toBe('delayed'); // unchanged
    const versionCount = await prisma.listingVersion.count({ where: { requestId } });
    expect(versionCount).toBe(0); // no snapshot
  });

  // ── 2. Meaningful edit: price change ─────────────────────────────────────

  it('price change creates a ListingVersion and resets status to pending', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { priceCents: 100, status: 'delayed' },
    );

    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    await saveRequestEdit(prisma, {
      requestId,
      bundleChanges: { title: item.title, description: '', buyerSeriousness: 'need' },
      itemsPayload: [
        {
          id: item.id,
          title: item.title,
          url: item.url,
          priceCents: 200, // changed
          notes: item.notes,
        },
      ],
    });

    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('pending');

    const versions = await prisma.listingVersion.findMany({ where: { requestId } });
    expect(versions).toHaveLength(1);

    // Snapshot captured the OLD price (100) before the edit
    const snapshot = versions[0]!.itemsSnapshot as Array<Record<string, unknown>>;
    expect(snapshot[0]!['priceCents']).toBe(100);

    // Item was actually updated
    const updatedItem = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(updatedItem.priceCents).toBe(200);
  });

  // ── 3. Meaningful edit: URL change ───────────────────────────────────────

  it('url change creates a ListingVersion and resets status to pending', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { url: 'https://old.example', status: 'delayed' },
    );

    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    await saveRequestEdit(prisma, {
      requestId,
      bundleChanges: { title: item.title, description: '', buyerSeriousness: 'need' },
      itemsPayload: [
        {
          id: item.id,
          title: item.title,
          url: 'https://new.example', // changed
          priceCents: item.priceCents,
          notes: item.notes,
        },
      ],
    });

    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('pending');

    const versionCount = await prisma.listingVersion.count({ where: { requestId } });
    expect(versionCount).toBe(1);

    // Item was updated
    const updatedItem = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(updatedItem.url).toBe('https://new.example');
  });

  // ── 4. Meaningful edit: item added ───────────────────────────────────────

  it('adding a new item creates a ListingVersion and resets status to pending', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { priceCents: 100, status: 'delayed' },
    );

    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    await saveRequestEdit(prisma, {
      requestId,
      bundleChanges: { title: item.title, description: '', buyerSeriousness: 'need' },
      itemsPayload: [
        {
          id: item.id,
          title: item.title,
          url: item.url,
          priceCents: item.priceCents,
          notes: '',
        },
        {
          // no id → new item
          title: 'New gadget',
          url: 'https://example.com/new',
          priceCents: 500,
          notes: '',
        },
      ],
    });

    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('pending');

    const versions = await prisma.listingVersion.findMany({ where: { requestId } });
    expect(versions).toHaveLength(1);

    // Snapshot captured old items (price 100)
    const snapshot = versions[0]!.itemsSnapshot as Array<Record<string, unknown>>;
    expect(snapshot[0]!['priceCents']).toBe(100);

    // Two items now exist
    const items = await prisma.requestItem.findMany({ where: { requestId } });
    expect(items).toHaveLength(2);
  });

  // ── 5. Meaningful edit: item removed ─────────────────────────────────────

  it('removing an item creates a ListingVersion and resets status to pending', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { priceCents: 100, status: 'delayed' },
    );

    // Add a second item
    await prisma.requestItem.create({
      data: {
        requestId,
        title: 'B',
        url: 'https://example.com/b',
        priceCents: 200,
        position: 1,
      },
    });

    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    // Payload only includes the first item (second is removed)
    await saveRequestEdit(prisma, {
      requestId,
      bundleChanges: { title: item.title, description: '', buyerSeriousness: 'need' },
      itemsPayload: [
        {
          id: item.id,
          title: item.title,
          url: item.url,
          priceCents: item.priceCents,
          notes: '',
        },
      ],
    });

    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('pending');

    const versionCount = await prisma.listingVersion.count({ where: { requestId } });
    expect(versionCount).toBe(1);

    // Only one item remains
    const remaining = await prisma.requestItem.findMany({ where: { requestId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(item.id);
  });

  // ── 6. Trivial edit: cosmetic item changes (title/notes) ─────────────────

  it('changing only item title or notes does not create a version or reset status', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { status: 'delayed' },
    );

    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    await saveRequestEdit(prisma, {
      requestId,
      bundleChanges: { title: item.title, description: '', buyerSeriousness: 'need' },
      itemsPayload: [
        {
          id: item.id,
          title: 'Different display name', // cosmetic
          url: item.url,
          priceCents: item.priceCents,
          notes: 'some note', // cosmetic
        },
      ],
    });

    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('delayed'); // unchanged

    const versionCount = await prisma.listingVersion.count({ where: { requestId } });
    expect(versionCount).toBe(0);

    // Item title was still updated
    const updatedItem = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(updatedItem.title).toBe('Different display name');
    expect(updatedItem.notes).toBe('some note');
  });

  // ── 7. Meaningful edit from pending state also works ─────────────────────

  it('meaningful edit from pending state resets to pending (stays pending)', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { priceCents: 100, status: 'pending' },
    );

    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    await saveRequestEdit(prisma, {
      requestId,
      bundleChanges: { title: item.title, description: '', buyerSeriousness: 'need' },
      itemsPayload: [
        {
          id: item.id,
          title: item.title,
          url: item.url,
          priceCents: 999, // changed
          notes: '',
        },
      ],
    });

    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('pending');

    const versionCount = await prisma.listingVersion.count({ where: { requestId } });
    expect(versionCount).toBe(1);
  });

  // ── 8. Whole edit is atomic: transition failure rolls back everything ─────

  it('throws IllegalTransition and rolls back when status does not allow edit_meaningful', async () => {
    const { buyer } = await createMembers();
    const { requestId, itemId } = await makeRequestWithItem(
      buyer.id,
      buyer.householdId,
      { priceCents: 100, status: 'pending' },
    );

    // Force the request into 'approved' (not editable via edit_meaningful)
    await prisma.request.update({ where: { id: requestId }, data: { status: 'approved' } });

    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });

    await expect(
      saveRequestEdit(prisma, {
        requestId,
        bundleChanges: { title: 'new title', description: '', buyerSeriousness: 'need' },
        itemsPayload: [
          {
            id: item.id,
            title: item.title,
            url: item.url,
            priceCents: 999, // meaningful change
            notes: '',
          },
        ],
      }),
    ).rejects.toThrow(IllegalTransition);

    // Status should be rolled back (still 'approved', no version created)
    const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('approved');
    // Bundle title change was also rolled back
    expect(req.title).not.toBe('new title');

    const versionCount = await prisma.listingVersion.count({ where: { requestId } });
    expect(versionCount).toBe(0);

    // Item-level rollback: price change was also rolled back, still 1 item
    expect(await prisma.requestItem.count({ where: { requestId } })).toBe(1);
    const rolledBackItem = await prisma.requestItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(rolledBackItem.priceCents).toBe(100);
  });
});
