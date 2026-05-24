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

// ── NotificationPreferenceInput ───────────────────────────────────────────────

/**
 * A single notification preference entry.
 * `eventType` maps to v1's event_type field on NotificationPreference.
 * `quietHoursStart` / `quietHoursEnd` are HH:MM strings (e.g. "22:00").
 */
export const NotificationPreferenceInputSchema = z.object({
  eventType: z.string().min(1).max(100),
  enabled: z.boolean(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});
export type NotificationPreferenceInput = z.infer<typeof NotificationPreferenceInputSchema>;

// ── UpdateNotificationPreferencesInput ────────────────────────────────────────

/**
 * Body of PUT /api/notifications/preferences.
 * Upserts one or more notification preferences for the authenticated user.
 */
export const UpdateNotificationPreferencesInputSchema = z.object({
  preferences: z.array(NotificationPreferenceInputSchema).min(1),
});
export type UpdateNotificationPreferencesInput = z.infer<typeof UpdateNotificationPreferencesInputSchema>;

// ── HouseholdInviteInput ──────────────────────────────────────────────────────

/**
 * Body of POST /api/household/invite.
 * `authentikUsername` is the Authentik username of the person to invite.
 * Creates a PendingMembership row scoped to the caller's household.
 */
export const HouseholdInviteInputSchema = z.object({
  authentikUsername: z.string().min(1).max(100),
});
export type HouseholdInviteInput = z.infer<typeof HouseholdInviteInputSchema>;

// ── FeedbackInput ─────────────────────────────────────────────────────────────

/**
 * Body of POST /api/feedback.
 * v1 has category, body (body text). We add title as a required field.
 * category is optional, max 50 chars, matches v1's CATEGORIES list validation
 * (but we allow any string ≤50 for flexibility — route can validate list membership).
 */
export const FeedbackInputSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  category: z.string().max(50).optional(),
});
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;

// ─── Admin schemas ─────────────────────────────────────────────────────────

const stringBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const intLike = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]);

export const AdminListUsersQuerySchema = z.object({
  q: z.string().min(1).optional(),
  isAdmin: stringBool.optional(),
  cursor: intLike.optional(),
  limit: intLike.default(50).optional(),
});
export type AdminListUsersQuery = z.infer<typeof AdminListUsersQuerySchema>;

export const AdminUpdateHouseholdSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    appealQuotaCount: z.number().int().min(0).max(1000).optional(),
    appealQuotaPeriod: z.enum(['monthly', 'quarterly']).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.appealQuotaCount !== undefined ||
      v.appealQuotaPeriod !== undefined,
    { message: 'at least one field required' },
  );
export type AdminUpdateHousehold = z.infer<typeof AdminUpdateHouseholdSchema>;

export const AdminAddHouseholdMemberSchema = z.object({
  userId: z.number().int().positive(),
  approvalMode: z.enum(['any', 'all']),
});
export type AdminAddHouseholdMember = z.infer<typeof AdminAddHouseholdMemberSchema>;

export const AdminUpdateHouseholdMemberSchema = z.object({
  approvalMode: z.enum(['any', 'all']),
});
export type AdminUpdateHouseholdMember = z.infer<typeof AdminUpdateHouseholdMemberSchema>;

export const AdminUpsertBuyerApproverSchema = z
  .object({
    buyerId: z.number().int().positive(),
    approverId: z.number().int().positive(),
  })
  .refine((v) => v.buyerId !== v.approverId, {
    message: 'buyer and approver must differ',
  });
export type AdminUpsertBuyerApprover = z.infer<typeof AdminUpsertBuyerApproverSchema>;

export const AdminListAppealsQuerySchema = z.object({
  status: z.enum(['pending', 'upheld', 'overturned']).optional(),
  householdId: intLike.optional(),
  periodKey: z.string().min(1).max(50).optional(),
  cursor: intLike.optional(),
  limit: intLike.default(50).optional(),
});
export type AdminListAppealsQuery = z.infer<typeof AdminListAppealsQuerySchema>;

export const AdminResolveAppealSchema = z.object({
  decision: z.enum(['overturn', 'uphold']),
});
export type AdminResolveAppeal = z.infer<typeof AdminResolveAppealSchema>;
