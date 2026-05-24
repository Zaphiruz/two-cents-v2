import { describe, it, expect } from 'vitest';
import {
  RequestItemInputSchema,
  NewRequestInputSchema,
  EditRequestInputSchema,
  ApproverActionInputSchema,
  CommentInputSchema,
  FileAppealInputSchema,
  ResolveAppealInputSchema,
  PushSubscribeInputSchema,
  PushUnsubscribeInputSchema,
  NotificationPreferenceInputSchema,
  UpdateNotificationPreferencesInputSchema,
  HouseholdInviteInputSchema,
  FeedbackInputSchema,
  AdminListUsersQuerySchema,
  AdminUpdateHouseholdSchema,
  AdminAddHouseholdMemberSchema,
  AdminUpdateHouseholdMemberSchema,
  AdminUpsertBuyerApproverSchema,
  AdminListAppealsQuerySchema,
  AdminResolveAppealSchema,
  AdminListFeedbackQuerySchema,
  AdminSearchQuerySchema,
} from './schemas.js';

// ── RequestItemInput ──────────────────────────────────────────────────────────

describe('RequestItemInputSchema', () => {
  const validItem = {
    title: 'Widget',
    url: 'https://example.com/widget',
    priceCents: 1999,
  };

  it('parses a valid item with all required fields', () => {
    const result = RequestItemInputSchema.parse(validItem);
    expect(result.title).toBe('Widget');
    expect(result.url).toBe('https://example.com/widget');
    expect(result.priceCents).toBe(1999);
  });

  it('applies defaults: notes and imageKey default to empty string', () => {
    const result = RequestItemInputSchema.parse(validItem);
    expect(result.notes).toBe('');
    expect(result.imageKey).toBe('');
  });

  it('accepts optional id for existing items', () => {
    const result = RequestItemInputSchema.parse({ ...validItem, id: 42 });
    expect(result.id).toBe(42);
  });

  it('rejects missing title', () => {
    expect(() =>
      RequestItemInputSchema.parse({ url: 'https://example.com', priceCents: 100 }),
    ).toThrow();
  });

  it('rejects empty title', () => {
    expect(() =>
      RequestItemInputSchema.parse({ ...validItem, title: '' }),
    ).toThrow();
  });

  it('rejects an invalid URL', () => {
    expect(() =>
      RequestItemInputSchema.parse({ ...validItem, url: 'not-a-url' }),
    ).toThrow();
  });

  it('rejects a negative priceCents', () => {
    expect(() =>
      RequestItemInputSchema.parse({ ...validItem, priceCents: -1 }),
    ).toThrow();
  });

  it('accepts priceCents of 0 (free item; mirrors v1 DecimalField with no min)', () => {
    const result = RequestItemInputSchema.parse({ ...validItem, priceCents: 0 });
    expect(result.priceCents).toBe(0);
  });

  it('rejects a non-integer priceCents', () => {
    expect(() =>
      RequestItemInputSchema.parse({ ...validItem, priceCents: 19.99 }),
    ).toThrow();
  });
});

// ── NewRequestInput ───────────────────────────────────────────────────────────

describe('NewRequestInputSchema', () => {
  const validRequest = {
    title: 'New Laptop',
    buyerSeriousness: 'need' as const,
    items: [{ title: 'Laptop', url: 'https://example.com/laptop', priceCents: 99900 }],
  };

  it('parses a valid request body', () => {
    const result = NewRequestInputSchema.parse(validRequest);
    expect(result.title).toBe('New Laptop');
    expect(result.buyerSeriousness).toBe('need');
    expect(result.items).toHaveLength(1);
  });

  it('applies defaults: description empty string and currency USD', () => {
    const result = NewRequestInputSchema.parse(validRequest);
    expect(result.description).toBe('');
    expect(result.currency).toBe('USD');
  });

  it('accepts an explicit currency code', () => {
    const result = NewRequestInputSchema.parse({ ...validRequest, currency: 'EUR' });
    expect(result.currency).toBe('EUR');
  });

  it('rejects items array with zero items (min:1)', () => {
    expect(() =>
      NewRequestInputSchema.parse({ ...validRequest, items: [] }),
    ).toThrow();
  });

  it('rejects an invalid currency: too long (USDX)', () => {
    expect(() =>
      NewRequestInputSchema.parse({ ...validRequest, currency: 'USDX' }),
    ).toThrow();
  });

  it('rejects a lowercase currency code (usd)', () => {
    expect(() =>
      NewRequestInputSchema.parse({ ...validRequest, currency: 'usd' }),
    ).toThrow();
  });

  it('rejects a missing title', () => {
    expect(() =>
      NewRequestInputSchema.parse({ buyerSeriousness: 'need', items: [validRequest.items[0]] }),
    ).toThrow();
  });

  it('rejects an invalid buyerSeriousness', () => {
    expect(() =>
      NewRequestInputSchema.parse({ ...validRequest, buyerSeriousness: 'meh' }),
    ).toThrow();
  });
});

// ── EditRequestInput ──────────────────────────────────────────────────────────

describe('EditRequestInputSchema', () => {
  const validItem = { title: 'Widget', url: 'https://example.com/widget', priceCents: 500 };

  it('parses with empty bundleChanges and one item', () => {
    const result = EditRequestInputSchema.parse({ itemsPayload: [validItem] });
    expect(result.bundleChanges).toEqual({});
    expect(result.itemsPayload).toHaveLength(1);
  });

  it('parses a mix of items with and without id', () => {
    const result = EditRequestInputSchema.parse({
      bundleChanges: { title: 'Updated' },
      itemsPayload: [
        { id: 1, title: 'Existing', url: 'https://example.com/existing', priceCents: 100 },
        { title: 'New item', url: 'https://example.com/new', priceCents: 200 },
      ],
    });
    expect(result.itemsPayload[0]?.id).toBe(1);
    expect(result.itemsPayload[1]?.id).toBeUndefined();
  });

  it('rejects itemsPayload with zero items', () => {
    expect(() =>
      EditRequestInputSchema.parse({ itemsPayload: [] }),
    ).toThrow();
  });

});

// ── ApproverActionInput ───────────────────────────────────────────────────────

describe('ApproverActionInputSchema', () => {
  it('parses a valid approve action', () => {
    const result = ApproverActionInputSchema.parse({
      action: 'approve',
      approverSeriousness: 'really_want',
    });
    expect(result.action).toBe('approve');
    expect(result.notes).toBe('');
  });

  it('parses a valid deny action', () => {
    const result = ApproverActionInputSchema.parse({
      action: 'deny',
      approverSeriousness: 'nice_to_have',
    });
    expect(result.action).toBe('deny');
  });

  it('parses a delay action with delayOverrideDays', () => {
    const result = ApproverActionInputSchema.parse({
      action: 'delay',
      approverSeriousness: 'need',
      delayOverrideDays: 30,
    });
    expect(result.delayOverrideDays).toBe(30);
  });

  it('rejects non-delay action with delayOverrideDays (refine guard)', () => {
    expect(() =>
      ApproverActionInputSchema.parse({
        action: 'approve',
        approverSeriousness: 'need',
        delayOverrideDays: 14,
      }),
    ).toThrow();
  });

  it('rejects an invalid action', () => {
    expect(() =>
      ApproverActionInputSchema.parse({
        action: 'skip',
        approverSeriousness: 'need',
      }),
    ).toThrow();
  });

  it('rejects a missing approverSeriousness', () => {
    expect(() =>
      ApproverActionInputSchema.parse({ action: 'approve' }),
    ).toThrow();
  });

  it('rejects a non-positive delayOverrideDays', () => {
    expect(() =>
      ApproverActionInputSchema.parse({
        action: 'delay',
        approverSeriousness: 'need',
        delayOverrideDays: 0,
      }),
    ).toThrow();
  });
});

// ── CommentInput ──────────────────────────────────────────────────────────────

describe('CommentInputSchema', () => {
  it('parses a valid comment body', () => {
    const result = CommentInputSchema.parse({ body: 'Great idea!' });
    expect(result.body).toBe('Great idea!');
  });

  it('rejects an empty body (min:1)', () => {
    expect(() => CommentInputSchema.parse({ body: '' })).toThrow();
  });

  it('rejects a body exceeding 10,000 characters', () => {
    expect(() => CommentInputSchema.parse({ body: 'x'.repeat(10_001) })).toThrow();
  });
});

// ── FileAppealInput ───────────────────────────────────────────────────────────

describe('FileAppealInputSchema', () => {
  it('parses a valid file appeal input', () => {
    const result = FileAppealInputSchema.parse({
      requestId: 42,
      justification: 'I really need this.',
    });
    expect(result.requestId).toBe(42);
    expect(result.justification).toBe('I really need this.');
  });

  it('rejects a missing justification', () => {
    expect(() =>
      FileAppealInputSchema.parse({ requestId: 1 }),
    ).toThrow();
  });

  it('rejects an empty justification (min:1)', () => {
    expect(() =>
      FileAppealInputSchema.parse({ requestId: 1, justification: '' }),
    ).toThrow();
  });

  it('rejects a non-positive requestId (0)', () => {
    expect(() =>
      FileAppealInputSchema.parse({ requestId: 0, justification: 'valid' }),
    ).toThrow();
  });

  it('rejects a non-integer requestId (1.5)', () => {
    expect(() =>
      FileAppealInputSchema.parse({ requestId: 1.5, justification: 'valid' }),
    ).toThrow();
  });
});

// ── ResolveAppealInput ────────────────────────────────────────────────────────

describe('ResolveAppealInputSchema', () => {
  it('parses a valid overturn decision', () => {
    const result = ResolveAppealInputSchema.parse({ decision: 'overturn' });
    expect(result.decision).toBe('overturn');
  });

  it('parses a valid uphold decision', () => {
    const result = ResolveAppealInputSchema.parse({ decision: 'uphold' });
    expect(result.decision).toBe('uphold');
  });

  it('rejects an unknown decision', () => {
    expect(() =>
      ResolveAppealInputSchema.parse({ decision: 'dismiss' }),
    ).toThrow();
  });

  it('rejects a missing decision', () => {
    expect(() =>
      ResolveAppealInputSchema.parse({}),
    ).toThrow();
  });
});

// ── PushSubscribeInput ────────────────────────────────────────────────────────

describe('PushSubscribeInputSchema', () => {
  const validSub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'somePublicKey', auth: 'someAuth' },
  };

  it('parses a valid push subscription', () => {
    const result = PushSubscribeInputSchema.parse(validSub);
    expect(result.endpoint).toBe(validSub.endpoint);
    expect(result.keys.p256dh).toBe('somePublicKey');
    expect(result.keys.auth).toBe('someAuth');
  });

  it('rejects a non-URL endpoint', () => {
    expect(() =>
      PushSubscribeInputSchema.parse({ ...validSub, endpoint: 'not-a-url' }),
    ).toThrow();
  });

  it('rejects missing keys', () => {
    expect(() =>
      PushSubscribeInputSchema.parse({ endpoint: validSub.endpoint }),
    ).toThrow();
  });

  it('rejects empty p256dh (min:1)', () => {
    expect(() =>
      PushSubscribeInputSchema.parse({ ...validSub, keys: { p256dh: '', auth: 'auth' } }),
    ).toThrow();
  });

  it('rejects empty auth (min:1)', () => {
    expect(() =>
      PushSubscribeInputSchema.parse({ ...validSub, keys: { p256dh: 'key', auth: '' } }),
    ).toThrow();
  });
});

// ── PushUnsubscribeInput ──────────────────────────────────────────────────────

describe('PushUnsubscribeInputSchema', () => {
  it('parses a valid endpoint URL', () => {
    const result = PushUnsubscribeInputSchema.parse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    });
    expect(result.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc123');
  });

  it('rejects a non-URL endpoint', () => {
    expect(() =>
      PushUnsubscribeInputSchema.parse({ endpoint: 'not-a-url' }),
    ).toThrow();
  });

  it('rejects a missing endpoint', () => {
    expect(() =>
      PushUnsubscribeInputSchema.parse({}),
    ).toThrow();
  });
});

// ── NotificationPreferenceInput ───────────────────────────────────────────────

describe('NotificationPreferenceInputSchema', () => {
  it('parses a valid preference with enabled=true', () => {
    const result = NotificationPreferenceInputSchema.parse({
      eventType: 'request_pending',
      enabled: true,
    });
    expect(result.eventType).toBe('request_pending');
    expect(result.enabled).toBe(true);
  });

  it('parses a preference with quiet hours', () => {
    const result = NotificationPreferenceInputSchema.parse({
      eventType: 'comment',
      enabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
    expect(result.quietHoursStart).toBe('22:00');
    expect(result.quietHoursEnd).toBe('07:00');
  });

  it('rejects an invalid quiet hours format (no colon)', () => {
    expect(() =>
      NotificationPreferenceInputSchema.parse({
        eventType: 'comment',
        enabled: true,
        quietHoursStart: '2200',
      }),
    ).toThrow();
  });

  it('rejects an empty eventType (min:1)', () => {
    expect(() =>
      NotificationPreferenceInputSchema.parse({ eventType: '', enabled: true }),
    ).toThrow();
  });
});

// ── UpdateNotificationPreferencesInput ────────────────────────────────────────

describe('UpdateNotificationPreferencesInputSchema', () => {
  it('parses a valid preferences array', () => {
    const result = UpdateNotificationPreferencesInputSchema.parse({
      preferences: [
        { eventType: 'request_pending', enabled: true },
        { eventType: 'comment', enabled: false, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
      ],
    });
    expect(result.preferences).toHaveLength(2);
  });

  it('rejects an empty preferences array (min:1)', () => {
    expect(() =>
      UpdateNotificationPreferencesInputSchema.parse({ preferences: [] }),
    ).toThrow();
  });

  it('rejects missing preferences field', () => {
    expect(() =>
      UpdateNotificationPreferencesInputSchema.parse({}),
    ).toThrow();
  });
});

// ── HouseholdInviteInput ──────────────────────────────────────────────────────

describe('HouseholdInviteInputSchema', () => {
  it('parses a valid authentikUsername', () => {
    const result = HouseholdInviteInputSchema.parse({ authentikUsername: 'jsmith' });
    expect(result.authentikUsername).toBe('jsmith');
  });

  it('rejects an empty authentikUsername (min:1)', () => {
    expect(() => HouseholdInviteInputSchema.parse({ authentikUsername: '' })).toThrow();
  });

  it('rejects a username exceeding 100 characters (max:100)', () => {
    expect(() =>
      HouseholdInviteInputSchema.parse({ authentikUsername: 'a'.repeat(101) }),
    ).toThrow();
  });

  it('rejects missing authentikUsername', () => {
    expect(() => HouseholdInviteInputSchema.parse({})).toThrow();
  });
});

// ── FeedbackInput ─────────────────────────────────────────────────────────────

describe('FeedbackInputSchema', () => {
  it('parses a valid feedback with all fields', () => {
    const result = FeedbackInputSchema.parse({
      title: 'Something broke',
      body: 'It crashed when I clicked save.',
      category: 'bug',
    });
    expect(result.title).toBe('Something broke');
    expect(result.body).toBe('It crashed when I clicked save.');
    expect(result.category).toBe('bug');
  });

  it('parses valid feedback without category (optional)', () => {
    const result = FeedbackInputSchema.parse({
      title: 'General feedback',
      body: 'Love the app!',
    });
    expect(result.category).toBeUndefined();
  });

  it('rejects an empty title (min:1)', () => {
    expect(() =>
      FeedbackInputSchema.parse({ title: '', body: 'some body' }),
    ).toThrow();
  });

  it('rejects an empty body (min:1)', () => {
    expect(() =>
      FeedbackInputSchema.parse({ title: 'Title', body: '' }),
    ).toThrow();
  });

  it('rejects a category exceeding 50 characters (max:50)', () => {
    expect(() =>
      FeedbackInputSchema.parse({
        title: 'Title',
        body: 'Body',
        category: 'x'.repeat(51),
      }),
    ).toThrow();
  });

  it('rejects a title exceeding 200 characters (max:200)', () => {
    expect(() =>
      FeedbackInputSchema.parse({ title: 't'.repeat(201), body: 'Body' }),
    ).toThrow();
  });
});

// ── Admin schemas ─────────────────────────────────────────────────────────────

describe('admin schemas', () => {
  it('AdminListUsersQuerySchema accepts empty query', () => {
    expect(AdminListUsersQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('AdminListUsersQuerySchema coerces isAdmin string to boolean', () => {
    expect(AdminListUsersQuerySchema.parse({ isAdmin: 'true' })).toEqual({ isAdmin: true, limit: 50 });
    expect(AdminListUsersQuerySchema.parse({ isAdmin: 'false' })).toEqual({ isAdmin: false, limit: 50 });
  });

  it('AdminUpdateHouseholdSchema accepts partial payload', () => {
    expect(AdminUpdateHouseholdSchema.parse({ name: 'Smith' })).toEqual({ name: 'Smith' });
    expect(AdminUpdateHouseholdSchema.parse({ appealQuotaCount: 5 })).toEqual({ appealQuotaCount: 5 });
  });

  it('AdminUpdateHouseholdSchema rejects empty object', () => {
    expect(() => AdminUpdateHouseholdSchema.parse({})).toThrow();
  });

  it('AdminAddHouseholdMemberSchema requires userId and approvalMode', () => {
    expect(AdminAddHouseholdMemberSchema.parse({ userId: 1, approvalMode: 'any' }))
      .toEqual({ userId: 1, approvalMode: 'any' });
    expect(() => AdminAddHouseholdMemberSchema.parse({ userId: 1 })).toThrow();
  });

  it('AdminUpdateHouseholdMemberSchema requires approvalMode', () => {
    expect(AdminUpdateHouseholdMemberSchema.parse({ approvalMode: 'all' }))
      .toEqual({ approvalMode: 'all' });
    expect(() => AdminUpdateHouseholdMemberSchema.parse({})).toThrow();
  });

  it('AdminUpsertBuyerApproverSchema requires both ids', () => {
    expect(AdminUpsertBuyerApproverSchema.parse({ buyerId: 1, approverId: 2 }))
      .toEqual({ buyerId: 1, approverId: 2 });
  });

  it('AdminUpsertBuyerApproverSchema rejects buyer === approver', () => {
    expect(() => AdminUpsertBuyerApproverSchema.parse({ buyerId: 1, approverId: 1 })).toThrow();
  });

  it('AdminListAppealsQuerySchema accepts status and householdId', () => {
    expect(AdminListAppealsQuerySchema.parse({ status: 'pending', householdId: 3 }))
      .toEqual({ status: 'pending', householdId: 3, limit: 50 });
  });

  it('AdminResolveAppealSchema accepts overturn or uphold', () => {
    expect(AdminResolveAppealSchema.parse({ decision: 'overturn' })).toEqual({ decision: 'overturn' });
    expect(() => AdminResolveAppealSchema.parse({ decision: 'unsure' })).toThrow();
  });

  it('AdminListFeedbackQuerySchema accepts empty and applies default limit', () => {
    expect(AdminListFeedbackQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('AdminListFeedbackQuerySchema accepts category and hasGhIssue coerced from string', () => {
    expect(AdminListFeedbackQuerySchema.parse({ category: 'bug', hasGhIssue: 'true' }))
      .toEqual({ category: 'bug', hasGhIssue: true, limit: 50 });
  });

  it('AdminSearchQuerySchema requires q', () => {
    expect(() => AdminSearchQuerySchema.parse({})).toThrow();
    expect(() => AdminSearchQuerySchema.parse({ q: '' })).toThrow();
  });

  it('AdminSearchQuerySchema accepts q + optional type', () => {
    expect(AdminSearchQuerySchema.parse({ q: 'gladis' }))
      .toEqual({ q: 'gladis' });
    expect(AdminSearchQuerySchema.parse({ q: 'gladis', type: 'request' }))
      .toEqual({ q: 'gladis', type: 'request' });
  });

  it('AdminSearchQuerySchema rejects unknown type', () => {
    expect(() => AdminSearchQuerySchema.parse({ q: 'x', type: 'user' })).toThrow();
  });
});
