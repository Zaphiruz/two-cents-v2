import { z } from 'zod';
import { SERIOUSNESS, ACTIONS } from './types.js';

// ── RequestItemInput ──────────────────────────────────────────────────────────

/**
 * A single item within a request bundle.
 * `id` is present when editing an existing item; absent for new items.
 * `saveRequestEdit` uses presence of `id` to distinguish add vs update.
 */
export const RequestItemInputSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1, 'title is required'),
  url: z.string().url('url must be a valid URL'),
  /** Non-negative integer cents; v1 allows price_dollars >= 0 (DecimalField, no min). */
  priceCents: z.number().int().nonnegative('priceCents must be a non-negative integer'),
  notes: z.string().default(''),
  imageKey: z.string().default(''),
});
export type RequestItemInput = z.infer<typeof RequestItemInputSchema>;

// ── NewRequestInput ───────────────────────────────────────────────────────────

/**
 * Body of POST /api/requests.
 * `householdId` and `buyerId` come from the session — not in the body.
 */
export const NewRequestInputSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().default(''),
  buyerSeriousness: z.enum(SERIOUSNESS),
  /** ISO 4217 currency code; defaults to 'USD'. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code')
    .default('USD'),
  /** At least one item required (mirrors v1's min_num=1 on the formset). */
  items: z.array(RequestItemInputSchema).min(1, 'at least one item is required'),
});
export type NewRequestInput = z.infer<typeof NewRequestInputSchema>;

// ── EditRequestInput ──────────────────────────────────────────────────────────

/**
 * Body of PATCH /api/requests/:id.
 * Maps directly onto SaveRequestEditArgs.bundleChanges + itemsPayload.
 * `bundleChanges` is a partial object (all fields optional); `itemsPayload`
 * is the full replacement list (items with id update, items without id create,
 * absent existing ids are deleted).
 */
export const EditRequestInputSchema = z.object({
  bundleChanges: z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      buyerSeriousness: z.enum(SERIOUSNESS).optional(),
    })
    .default({}),
  /** Full replacement list; must contain at least 1 item. */
  itemsPayload: z.array(RequestItemInputSchema).min(1, 'at least one item is required'),
});
export type EditRequestInput = z.infer<typeof EditRequestInputSchema>;

// ── ApproverActionInput ───────────────────────────────────────────────────────

/**
 * Body of POST /api/requests/:id/act.
 * `delayOverrideDays` is in days; the route handler converts to ms
 * via `delayOverrideMs = delayOverrideDays * 86_400_000` before calling
 * `transition(..., { delayOverrideMs })`.
 */
export const ApproverActionInputSchema = z
  .object({
    action: z.enum(ACTIONS),
    /** Approver's calibration seriousness rating — required for all three actions. */
    approverSeriousness: z.enum(SERIOUSNESS),
    /** Days to delay; only meaningful when action='delay'. */
    delayOverrideDays: z.number().int().positive().optional(),
    notes: z.string().default(''),
  })
  .refine(
    (data) => data.delayOverrideDays === undefined || data.action === 'delay',
    {
      message: 'delayOverrideDays is only meaningful when action is "delay"',
      path: ['delayOverrideDays'],
    },
  );
export type ApproverActionInput = z.infer<typeof ApproverActionInputSchema>;
