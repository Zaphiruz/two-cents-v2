/**
 * saveRequestEdit.ts — port of v1's save_request_edit (multi-item version)
 *
 * Applies bundle-level changes and item-level changes to a request, determining
 * whether the edit is "meaningful" (item add/remove, url change, price change).
 * On meaningful edits: snapshots current items into ListingVersion, then calls
 * transitionOnTx(tx, ..., 'edit_meaningful') to atomically validate the status
 * edge and reset status to pending.
 *
 * Calls transitionOnTx inside the outer $transaction so the snapshot, item
 * writes, bundle update, and state transition are atomic together.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Seriousness } from '@two-cents/shared';
import { transitionOnTx } from '../lib/state.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ItemPayload {
  /** Omit (or undefined) for new items; provide for existing items. */
  id?: number;
  title: string;
  url: string;
  priceCents: number;
  notes?: string;
  imageKey?: string;
  position?: number;
}

export interface SaveRequestEditArgs {
  requestId: number;
  /**
   * Bundle-level fields to apply. All are cosmetic (title, description,
   * buyerSeriousness) — none trigger a meaningful-edit transition.
   */
  bundleChanges: {
    title?: string;
    description?: string;
    buyerSeriousness?: Seriousness;
  };
  /**
   * Full replacement list of items. Items with an `id` are updated; items
   * without an `id` are created; existing items whose ids are absent from
   * this list are deleted.
   */
  itemsPayload: ItemPayload[];
  /** HouseholdMember id of the actor, forwarded if needed. */
  actorId?: number;
}

export interface SaveRequestEditResult {
  /**
   * Note: the original spec included `snapshotId` here, but it was deliberately
   * omitted — callers have no use for it yet. The spec said `{ meaningful, snapshotId }`
   * but we return `{ wasMeaningful, requestId }` instead.
   */
  wasMeaningful: boolean;
  requestId: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

/** Shape returned by tx.requestItem.findMany (we only reference the fields we need). */
type CurrentItem = {
  id: number;
  title: string;
  url: string;
  priceCents: number;
  notes: string;
  imageKey: string;
  position: number;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build a JSON-serialisable snapshot of the current items, ordered by
 * position then id (mirrors v1's _items_snapshot).
 */
function buildSnapshot(items: CurrentItem[]): Array<Record<string, unknown>> {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    priceCents: item.priceCents,
    notes: item.notes,
    imageKey: item.imageKey,
    position: item.position,
  }));
}

/**
 * Determine whether the itemsPayload differs meaningfully from the current
 * items. Mirrors v1's _is_meaningful_change().
 *
 * Meaningful criteria:
 *   - An item is added (payload entry has no id, OR its id is unknown)
 *   - An item is removed (current item id absent from payload)
 *   - url changed on an existing item
 *   - priceCents changed on an existing item
 *
 * Not meaningful: title, notes, imageKey, position changes; all bundle fields.
 */
function isMeaningfulChange(
  currentItems: CurrentItem[],
  itemsPayload: ItemPayload[],
): boolean {
  const currentIds = new Set(currentItems.map((i) => i.id));
  const incomingIds = new Set(
    itemsPayload.filter((p) => p.id != null).map((p) => p.id as number),
  );

  // Item count differs, or a current id is not in incoming → item removed
  if (incomingIds.size !== currentIds.size) return true;
  for (const id of currentIds) {
    if (!incomingIds.has(id)) return true;
  }
  // Payload has more entries than current items → item added (without id)
  if (itemsPayload.length !== currentItems.length) return true;

  // Per-item url/price checks
  const currentById = new Map(currentItems.map((i) => [i.id, i]));
  for (const payload of itemsPayload) {
    if (payload.id == null || !currentById.has(payload.id)) return true; // new item
    const current = currentById.get(payload.id)!;
    if (payload.url !== current.url) return true;
    if (payload.priceCents !== current.priceCents) return true;
  }

  return false;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function saveRequestEdit(
  prisma: PrismaClient,
  args: SaveRequestEditArgs,
): Promise<SaveRequestEditResult> {
  const { requestId, bundleChanges, itemsPayload, actorId } = args;

  // Fetch current items before opening the transaction (lightweight read)
  const currentItems: CurrentItem[] = await prisma.requestItem.findMany({
    where: { requestId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      url: true,
      priceCents: true,
      notes: true,
      imageKey: true,
      position: true,
    },
  });

  const meaningful = isMeaningfulChange(currentItems, itemsPayload);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (meaningful) {
      // 1. Snapshot current items BEFORE any changes (currentItems read before tx)
      const snapshot = buildSnapshot(currentItems);
      await tx.listingVersion.create({
        data: { requestId, itemsSnapshot: snapshot },
      });
    }

    // 2. Apply bundle changes (both meaningful and trivial edits)
    if (Object.keys(bundleChanges).length > 0) {
      await tx.request.update({
        where: { id: requestId },
        data: {
          ...(bundleChanges.title !== undefined && { title: bundleChanges.title }),
          ...(bundleChanges.description !== undefined && { description: bundleChanges.description }),
          ...(bundleChanges.buyerSeriousness !== undefined && { buyerSeriousness: bundleChanges.buyerSeriousness }),
        },
      });
    }

    // 3. Apply item changes (both meaningful and trivial edits)
    const currentIds = new Set(currentItems.map((i) => i.id));
    const incomingIds = new Set(
      itemsPayload.filter((p) => p.id != null).map((p) => p.id as number),
    );

    // Delete removed items
    const removedIds = [...currentIds].filter((id) => !incomingIds.has(id));
    if (removedIds.length > 0) {
      await tx.requestItem.deleteMany({ where: { id: { in: removedIds } } });
    }

    // Update existing items or create new ones, using payload index as fallback position
    for (let i = 0; i < itemsPayload.length; i++) {
      const payload = itemsPayload[i]!;
      const position = payload.position ?? i;

      if (payload.id != null && currentIds.has(payload.id)) {
        // Update existing item
        await tx.requestItem.update({
          where: { id: payload.id },
          data: {
            title: payload.title,
            url: payload.url,
            priceCents: payload.priceCents,
            notes: payload.notes ?? '',
            imageKey: payload.imageKey ?? '',
            position,
          },
        });
      } else {
        // Create new item (no id, or id not in current set)
        await tx.requestItem.create({
          data: {
            requestId,
            title: payload.title,
            url: payload.url,
            priceCents: payload.priceCents,
            notes: payload.notes ?? '',
            imageKey: payload.imageKey ?? '',
            position,
          },
        });
      }
    }

    // 4. On meaningful edits, validate the status edge and update status atomically.
    //    transitionOnTx throws IllegalTransition if (status, edit_meaningful) is not
    //    in ALLOWED, rolling back the entire outer transaction (snapshot + item writes).
    if (meaningful) {
      await transitionOnTx(tx, requestId, 'edit_meaningful', { actorId });
    }
  });

  return { wasMeaningful: meaningful, requestId };
}
