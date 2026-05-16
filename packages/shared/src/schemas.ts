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

// ── CommentInput ──────────────────────────────────────────────────────────────

/**
 * Body of POST /api/requests/:id/comments.
 * A non-empty string bounded at 10,000 characters for API hygiene.
 * v1 strips whitespace and rejects empty — we match that via min(1).
 */
export const CommentInputSchema = z.object({
  body: z.string().min(1, 'comment body is required').max(10_000, 'comment body is too long'),
});
export type CommentInput = z.infer<typeof CommentInputSchema>;

// ── FileAppealInput ───────────────────────────────────────────────────────────

/**
 * Body of POST /api/appeals.
 * `buyerId` is derived from the session — not in the body.
 */
export const FileAppealInputSchema = z.object({
  requestId: z.number().int().positive(),
  justification: z.string().min(1).max(10_000),
});
export type FileAppealInput = z.infer<typeof FileAppealInputSchema>;

// ── ResolveAppealInput ────────────────────────────────────────────────────────

/**
 * Body of POST /api/appeals/:id/resolve.
 * 'overturn' moves the request from denied → pending via appeal_overturned transition.
 * 'uphold' marks the appeal upheld, leaving the request status unchanged.
 */
export const ResolveAppealInputSchema = z.object({
  decision: z.enum(['overturn', 'uphold']),
});
export type ResolveAppealInput = z.infer<typeof ResolveAppealInputSchema>;

// ── PushSubscribeInput ────────────────────────────────────────────────────────

/**
 * Body of POST /api/push/subscribe.
 * Matches the Web Push API's PushSubscriptionJSON shape (browser sends this directly).
 * `endpoint` is unique — upsert uses it as the key.
 */
export const PushSubscribeInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscribeInput = z.infer<typeof PushSubscribeInputSchema>;

// ── PushUnsubscribeInput ──────────────────────────────────────────────────────

/**
 * Body of POST /api/push/unsubscribe.
 * Identifies the subscription by its unique endpoint URL.
 */
export const PushUnsubscribeInputSchema = z.object({
  endpoint: z.string().url(),
});
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInputSchema>;
