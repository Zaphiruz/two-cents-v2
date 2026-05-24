# v2 Admin Page — PR 2 Implementation Plan (Feedback + Audit Search)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the v2 admin page by adding the two remaining sections from `docs/superpowers/specs/2026-05-24-admin-page-design.md` — Feedback (read-only list of submissions linking to GitHub) and Audit Search (unified text search across Request / Comment / NotificationLog / PushSubscription / ConsumedJWTJti).

**Architecture:** Adds 2 new endpoints under the existing `/api/admin/*` plugin (already gated by `requireAdmin` from PR 1) and 2 new pages mounted under the existing `/admin/*` route tree. Sidebar in `AdminLayout.tsx` gains 2 entries. No new infrastructure, no new shared primitives — reuses `DataTable`, `DetailDrawer`, and the Zod schema pattern established in PR 1.

**Tech Stack:** Fastify 5 + Prisma 5 + Zod (`@two-cents/shared`), React 18 + react-router 6 + @tanstack/react-query + shadcn/ui + Tailwind, vitest + RTL.

**Reference patterns:** PR 1 plan (`docs/superpowers/plans/2026-05-24-admin-page-pr1.md`) and PR 1 implementation on `main` (commit `dad7e8f`) — use as the template for everything (route file shape, test seed pattern, page+test pattern, sidebar wiring).

---

## File map

**API (`apps/api/src/`):**
- Create `routes/admin/feedback.ts` — GET /api/admin/feedback
- Create `routes/admin/feedback.test.ts`
- Create `routes/admin/search.ts` — GET /api/admin/search
- Create `routes/admin/search.test.ts`
- Modify `routes/admin/index.ts` — register the two new sub-routes

**Shared (`packages/shared/src/`):**
- Modify `schemas.ts` — append `AdminListFeedbackQuerySchema` and `AdminSearchQuerySchema`
- Modify `schemas.test.ts` — append parse cases

**Web (`apps/web/src/`):**
- Modify `pages/admin/AdminLayout.tsx` — add Feedback + Search entries to the `sections` array
- Modify `App.tsx` — add `/admin/feedback` and `/admin/search` child routes + imports
- Create `pages/admin/AdminFeedbackPage.tsx`
- Create `pages/admin/AdminFeedbackPage.test.tsx`
- Create `pages/admin/AdminSearchPage.tsx`
- Create `pages/admin/AdminSearchPage.test.tsx`

No new files in `components/ui/` (shadcn Sheet, Button, Input, Select, Badge, Dialog already present from PR 1).

---

## Task summary

- **Task A1:** Add Feedback + Search Zod schemas
- **Task A2:** GET /api/admin/feedback
- **Task A3:** GET /api/admin/search
- **Task B1:** Wire sidebar + routes + page stubs
- **Task B2:** AdminFeedbackPage (real implementation)
- **Task B3:** AdminSearchPage (real implementation)

6 tasks; each follows TDD (failing test → impl → green → commit).

---

## Phase A — Backend

### Task A1: Admin Zod schemas for Feedback + Search

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append at end of the existing Admin section)
- Modify: `packages/shared/src/schemas.test.ts` (append cases)

- [ ] **Step 1: Write failing tests**

Append to `packages/shared/src/schemas.test.ts` (add the two new names to the existing top-of-file admin import block):

```ts
// In the existing import block at top of file, add:
//   AdminListFeedbackQuerySchema,
//   AdminSearchQuerySchema,
```

Then append to the `describe('admin schemas', ...)` block:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/shared && pnpm test
```

Expected: FAIL — names not yet exported.

- [ ] **Step 3: Implement the schemas**

Append to `packages/shared/src/schemas.ts` (the `stringBool` and `intLike` helpers from PR 1 are already in scope at module top):

```ts
export const AdminListFeedbackQuerySchema = z.object({
  category: z.string().min(1).optional(),
  hasGhIssue: stringBool.optional(),
  cursor: intLike.optional(),
  limit: intLike.optional().default(50),
});
export type AdminListFeedbackQuery = z.infer<typeof AdminListFeedbackQuerySchema>;

export const AdminSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: z
    .enum(['request', 'comment', 'notificationLog', 'pushSubscription', 'consumedJwtJti'])
    .optional(),
});
export type AdminSearchQuery = z.infer<typeof AdminSearchQuerySchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/shared && pnpm test
```

Expected: PASS — 5 new cases green; all prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat(shared): zod schemas for admin feedback + search endpoints"
```

---

### Task A2: GET /api/admin/feedback

**Files:**
- Create: `apps/api/src/routes/admin/feedback.ts`
- Create: `apps/api/src/routes/admin/feedback.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts` (register `adminFeedbackRoutes`)

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/routes/admin/feedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'fb-admin', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

describe('GET /api/admin/feedback', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'fb-non', name: 'N', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('lists feedback submissions with user names', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const u = await prisma.user.create({
        data: { oidcSubject: 'fb-u', name: 'Reporter', isAdmin: false },
      });
      await prisma.feedbackSubmission.create({
        data: {
          userId: u.id,
          category: 'bug',
          githubIssueNumber: 42,
          githubIssueUrl: 'https://github.com/Zaphiruz/two-cents-v2/issues/42',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.submissions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'bug',
            githubIssueNumber: 42,
            githubIssueUrl: 'https://github.com/Zaphiruz/two-cents-v2/issues/42',
            userName: 'Reporter',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('filters by category', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const u = await prisma.user.create({
        data: { oidcSubject: 'fb-cat', name: 'C', isAdmin: false },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: 'bug' },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: 'enhancement' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback?category=bug',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.submissions).toHaveLength(1);
      expect(body.submissions[0].category).toBe('bug');
    } finally {
      await app.close();
    }
  });

  it('filters by hasGhIssue=true (only rows with githubIssueNumber set)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const u = await prisma.user.create({
        data: { oidcSubject: 'fb-gh', name: 'G', isAdmin: false },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: '', githubIssueNumber: 7 },
      });
      await prisma.feedbackSubmission.create({
        data: { userId: u.id, category: '' /* githubIssueNumber null */ },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/feedback?hasGhIssue=true',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.submissions).toHaveLength(1);
      expect(body.submissions[0].githubIssueNumber).toBe(7);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/feedback.test.ts
```

(env: `DATABASE_URL=postgresql://two_cents_v2:two_cents_v2@localhost:5435/two_cents_v2 REDIS_URL=redis://localhost:6390/0`)

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/admin/feedback.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { AdminListFeedbackQuerySchema } from '@two-cents/shared';

export default async function adminFeedbackRoutes(app: FastifyInstance) {
  app.get('/api/admin/feedback', async (req) => {
    const query = AdminListFeedbackQuerySchema.parse(req.query ?? {});
    const limit = query.limit ?? 50;

    const where = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.hasGhIssue === true ? { githubIssueNumber: { not: null } } : {}),
      ...(query.hasGhIssue === false ? { githubIssueNumber: null } : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };

    const rows = await app.prisma.feedbackSubmission.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        category: true,
        githubIssueNumber: true,
        githubIssueUrl: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return {
      submissions: slice.map((r) => ({
        id: r.id,
        category: r.category,
        githubIssueNumber: r.githubIssueNumber,
        githubIssueUrl: r.githubIssueUrl,
        createdAt: r.createdAt,
        userId: r.user.id,
        userName: r.user.name,
      })),
      nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    };
  });
}
```

- [ ] **Step 4: Register adminFeedbackRoutes in the admin plugin**

Modify `apps/api/src/routes/admin/index.ts`. Add the import and the register call alongside the existing ones (the file already registers users, households, appeals — register feedback after appeals):

```ts
import adminFeedbackRoutes from './feedback.js';
// ...
await app.register(adminFeedbackRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/feedback.test.ts
```

Expected: PASS — 4 tests green.

- [ ] **Step 6: Run full api suite for regressions**

```bash
cd apps/api && pnpm test
```

Expected: 311 green (PR 1 baseline was 307; +4 new tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/feedback.ts apps/api/src/routes/admin/feedback.test.ts apps/api/src/routes/admin/index.ts
git commit -m "feat(api): GET /api/admin/feedback"
```

---

### Task A3: GET /api/admin/search

The unified audit search across 5 models. Returns a flat `SearchHit[]` shape per the spec.

**Files:**
- Create: `apps/api/src/routes/admin/search.ts`
- Create: `apps/api/src/routes/admin/search.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts` (register `adminSearchRoutes`)

**Search semantics:**
- `q`: case-insensitive `contains` match against the primary text column of each type
- `type` unspecified → search all 5 types, return at most 10 results per type (≤ 50 total)
- `type` specified → search only that type, return at most 50 results
- Result row shape (unified):
  ```ts
  {
    type: 'request' | 'comment' | 'notificationLog' | 'pushSubscription' | 'consumedJwtJti';
    id: number | string;        // string for consumedJwtJti (jti is the PK)
    primary: string;            // title / body snippet / eventKey / endpoint / jti
    userName: string | null;    // null for consumedJwtJti
    householdName: string | null; // null for log/sub/jti
    timestamp: string;          // createdAt / sentAt / consumedAt
    raw: Record<string, unknown>; // full row for drawer
  }
  ```

**Per-type primary column to search:**
- `request` → `title` ILIKE q
- `comment` → `body` ILIKE q
- `notificationLog` → `eventKey` ILIKE q
- `pushSubscription` → `endpoint` ILIKE q
- `consumedJwtJti` → `jti` ILIKE q

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/routes/admin/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'srch-admin', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

async function seedHouseholdWithMember() {
  const household = await prisma.household.create({
    data: { name: 'SrchHouse', appealQuotaCount: 5, appealQuotaPeriod: 'monthly' },
  });
  const user = await prisma.user.create({
    data: { oidcSubject: 'srch-buyer', name: 'Buyer', isAdmin: false },
  });
  const member = await prisma.householdMember.create({
    data: { userId: user.id, householdId: household.id, approvalMode: 'any' },
  });
  return { household, user, member };
}

describe('GET /api/admin/search', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'srch-non', name: 'N', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=x',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when q is missing', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('finds a request by title substring (case-insensitive)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { household, member } = await seedHouseholdWithMember();
      const r = await prisma.request.create({
        data: {
          householdId: household.id,
          buyerId: member.id,
          title: 'New BLENDER for kitchen',
          buyerSeriousness: 'need',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=blender',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const hit = body.results.find((h: { type: string; id: number }) => h.type === 'request' && h.id === r.id);
      expect(hit).toMatchObject({
        type: 'request',
        primary: 'New BLENDER for kitchen',
        userName: 'Buyer',
        householdName: 'SrchHouse',
      });
    } finally {
      await app.close();
    }
  });

  it('finds a comment by body substring', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { household, member, user } = await seedHouseholdWithMember();
      const req = await prisma.request.create({
        data: {
          householdId: household.id,
          buyerId: member.id,
          title: 'X',
          buyerSeriousness: 'need',
        },
      });
      const c = await prisma.comment.create({
        data: { requestId: req.id, authorId: user.id, body: 'this is a SECRET comment' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=secret',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string; id: number }) => h.type === 'comment' && h.id === c.id);
      expect(hit).toMatchObject({ type: 'comment', userName: 'Buyer' });
      expect(hit.primary).toContain('SECRET');
    } finally {
      await app.close();
    }
  });

  it('finds a notification log by eventKey', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { user } = await seedHouseholdWithMember();
      await prisma.notificationLog.create({
        data: { userId: user.id, eventKey: 'request.accepted' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=accepted',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string }) => h.type === 'notificationLog');
      expect(hit).toMatchObject({ primary: 'request.accepted', userName: 'Buyer' });
    } finally {
      await app.close();
    }
  });

  it('finds a push subscription by endpoint', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { user } = await seedHouseholdWithMember();
      await prisma.pushSubscription.create({
        data: { userId: user.id, endpoint: 'https://fcm.googleapis.com/UNIQUE-x123', p256dh: 'p', auth: 'a' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=UNIQUE-x123',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string }) => h.type === 'pushSubscription');
      expect(hit).toMatchObject({ userName: 'Buyer' });
      expect(hit.primary).toContain('UNIQUE-x123');
    } finally {
      await app.close();
    }
  });

  it('finds a consumed jti by exact string (no user)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await prisma.consumedJWTJti.create({ data: { jti: 'jti-abc-12345' } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=abc-123',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      const hit = body.results.find((h: { type: string }) => h.type === 'consumedJwtJti');
      expect(hit).toMatchObject({
        type: 'consumedJwtJti',
        id: 'jti-abc-12345',
        primary: 'jti-abc-12345',
        userName: null,
        householdName: null,
      });
    } finally {
      await app.close();
    }
  });

  it('restricts results to one type when type is specified', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { household, member, user } = await seedHouseholdWithMember();
      await prisma.request.create({
        data: { householdId: household.id, buyerId: member.id, title: 'find-me', buyerSeriousness: 'need' },
      });
      await prisma.notificationLog.create({
        data: { userId: user.id, eventKey: 'find-me-too' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/search?q=find-me&type=request',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.results.every((h: { type: string }) => h.type === 'request')).toBe(true);
      expect(body.results.length).toBe(1);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/search.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/admin/search.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { AdminSearchQuerySchema, type AdminSearchQuery } from '@two-cents/shared';

type SearchHit = {
  type: 'request' | 'comment' | 'notificationLog' | 'pushSubscription' | 'consumedJwtJti';
  id: number | string;
  primary: string;
  userName: string | null;
  householdName: string | null;
  timestamp: string;
  raw: Record<string, unknown>;
};

const COMMENT_SNIPPET_LEN = 200;

export default async function adminSearchRoutes(app: FastifyInstance) {
  app.get('/api/admin/search', async (req) => {
    const query = AdminSearchQuerySchema.parse(req.query ?? {});
    const limit = query.type ? 50 : 10;

    const tasks: Array<Promise<SearchHit[]>> = [];

    const want = (t: AdminSearchQuery['type']) => !query.type || query.type === t;

    if (want('request')) tasks.push(searchRequests(app, query.q, limit));
    if (want('comment')) tasks.push(searchComments(app, query.q, limit));
    if (want('notificationLog')) tasks.push(searchNotificationLogs(app, query.q, limit));
    if (want('pushSubscription')) tasks.push(searchPushSubscriptions(app, query.q, limit));
    if (want('consumedJwtJti')) tasks.push(searchConsumedJtis(app, query.q, limit));

    const groups = await Promise.all(tasks);
    return { results: groups.flat() };
  });
}

async function searchRequests(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.request.findMany({
    where: { title: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      household: { select: { name: true } },
      buyer: { select: { user: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    type: 'request' as const,
    id: r.id,
    primary: r.title,
    userName: r.buyer.user.name,
    householdName: r.household.name,
    timestamp: r.createdAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchComments(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.comment.findMany({
    where: { body: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { name: true } },
      request: { select: { household: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    type: 'comment' as const,
    id: r.id,
    primary: r.body.length > COMMENT_SNIPPET_LEN ? r.body.slice(0, COMMENT_SNIPPET_LEN) + '…' : r.body,
    userName: r.author.name,
    householdName: r.request.household.name,
    timestamp: r.createdAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchNotificationLogs(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.notificationLog.findMany({
    where: { eventKey: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      eventKey: true,
      sentAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    type: 'notificationLog' as const,
    id: r.id,
    primary: r.eventKey,
    userName: r.user.name,
    householdName: null,
    timestamp: r.sentAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchPushSubscriptions(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.pushSubscription.findMany({
    where: { endpoint: { contains: q, mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      endpoint: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    type: 'pushSubscription' as const,
    id: r.id,
    primary: r.endpoint,
    userName: r.user.name,
    householdName: null,
    timestamp: r.createdAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}

async function searchConsumedJtis(app: FastifyInstance, q: string, limit: number): Promise<SearchHit[]> {
  const rows = await app.prisma.consumedJWTJti.findMany({
    where: { jti: { contains: q, mode: 'insensitive' } },
    orderBy: { consumedAt: 'desc' },
    take: limit,
    select: { jti: true, consumedAt: true },
  });
  return rows.map((r) => ({
    type: 'consumedJwtJti' as const,
    id: r.jti,
    primary: r.jti,
    userName: null,
    householdName: null,
    timestamp: r.consumedAt.toISOString(),
    raw: r as unknown as Record<string, unknown>,
  }));
}
```

If `app.prisma.consumedJWTJti` doesn't exist on the generated client, check the casing — Prisma's convention pluralizes/camelCases the model name. The schema has `model ConsumedJWTJti`, which Prisma typically exposes as `consumedJWTJti` (preserving the all-caps acronym). If the typecheck fails, run `grep -E "consumedJ\w+Jti" apps/api/src/services/ apps/api/src/routes/ --include='*.ts' -rn` to find existing usage; whatever name the existing code uses, match it.

- [ ] **Step 4: Register adminSearchRoutes in the admin plugin**

Modify `apps/api/src/routes/admin/index.ts` — add the import and registration after `adminFeedbackRoutes`:

```ts
import adminSearchRoutes from './search.js';
// ...
await app.register(adminSearchRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/search.test.ts
```

Expected: PASS — 8 tests green.

- [ ] **Step 6: Run full api suite**

```bash
cd apps/api && pnpm test
```

Expected: 319 green (311 + 8 new).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/search.ts apps/api/src/routes/admin/search.test.ts apps/api/src/routes/admin/index.ts
git commit -m "feat(api): GET /api/admin/search (unified audit search)"
```

---

## Phase B — Frontend

### Task B1: Sidebar + routes + page stubs

**Files:**
- Modify: `apps/web/src/pages/admin/AdminLayout.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/admin/AdminFeedbackPage.tsx` (stub)
- Create: `apps/web/src/pages/admin/AdminSearchPage.tsx` (stub)

- [ ] **Step 1: Update AdminLayout sections**

Edit `apps/web/src/pages/admin/AdminLayout.tsx`. Replace:

```tsx
const sections = [
  { to: 'people', label: 'People' },
  { to: 'households', label: 'Households' },
  { to: 'appeals', label: 'Appeals' },
  // Feedback + Search added in PR 2
];
```

with:

```tsx
const sections = [
  { to: 'people', label: 'People' },
  { to: 'households', label: 'Households' },
  { to: 'appeals', label: 'Appeals' },
  { to: 'feedback', label: 'Feedback' },
  { to: 'search', label: 'Audit Search' },
];
```

- [ ] **Step 2: Create page stubs**

Create `apps/web/src/pages/admin/AdminFeedbackPage.tsx`:

```tsx
export default function AdminFeedbackPage() {
  return <div>Feedback (stub)</div>;
}
```

Create `apps/web/src/pages/admin/AdminSearchPage.tsx`:

```tsx
export default function AdminSearchPage() {
  return <div>Search (stub)</div>;
}
```

- [ ] **Step 3: Wire routes in App.tsx**

Edit `apps/web/src/App.tsx`. Inside the existing `<Route path="admin" ...>` block, add two new child routes after the `appeals` route:

```tsx
<Route path="feedback" element={<AdminFeedbackPage />} />
<Route path="search" element={<AdminSearchPage />} />
```

Add the corresponding imports at the top of App.tsx, alongside the existing admin page imports:

```tsx
import AdminFeedbackPage from './pages/admin/AdminFeedbackPage';
import AdminSearchPage from './pages/admin/AdminSearchPage';
```

- [ ] **Step 4: Run web build + full web suite**

```bash
cd apps/web && pnpm run build && pnpm test
```

Expected: build succeeds; 88 tests still green (AdminLayout test from PR 1 doesn't enumerate Feedback/Search links, so no test updates needed yet — those will come in B2/B3).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/AdminLayout.tsx \
        apps/web/src/pages/admin/AdminFeedbackPage.tsx \
        apps/web/src/pages/admin/AdminSearchPage.tsx \
        apps/web/src/App.tsx
git commit -m "feat(web): wire admin Feedback + Audit Search routes and sidebar"
```

---

### Task B2: AdminFeedbackPage (real implementation)

**Files:**
- Overwrite stub: `apps/web/src/pages/admin/AdminFeedbackPage.tsx`
- Create: `apps/web/src/pages/admin/AdminFeedbackPage.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/pages/admin/AdminFeedbackPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminFeedbackPage from './AdminFeedbackPage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminFeedbackPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('AdminFeedbackPage', () => {
  it('renders feedback rows with linked GH issue numbers', async () => {
    requestMock.mockResolvedValueOnce({
      submissions: [
        {
          id: 1,
          category: 'bug',
          githubIssueNumber: 42,
          githubIssueUrl: 'https://github.com/Zaphiruz/two-cents-v2/issues/42',
          createdAt: '2026-05-01T00:00:00.000Z',
          userId: 100,
          userName: 'Gladis',
        },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Gladis')).toBeInTheDocument());
    expect(screen.getByText('bug')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /#42/i }) as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/Zaphiruz/two-cents-v2/issues/42');
    expect(link.target).toBe('_blank');
  });

  it('shows "—" instead of a link when githubIssueNumber is null', async () => {
    requestMock.mockResolvedValueOnce({
      submissions: [
        {
          id: 2,
          category: '',
          githubIssueNumber: null,
          githubIssueUrl: '',
          createdAt: '2026-05-01T00:00:00.000Z',
          userId: 101,
          userName: 'Anon',
        },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Anon')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /#/ })).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('updates the request URL when category filter changes', async () => {
    requestMock.mockResolvedValue({ submissions: [], nextCursor: null });
    renderPage();
    // wait for initial fetch
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const select = screen.getByLabelText(/category/i);
    fireEvent.change(select, { target: { value: 'bug' } });
    await waitFor(() => {
      const last = requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0];
      expect(last).toEqual(expect.stringContaining('category=bug'));
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/AdminFeedbackPage.test.tsx
```

Expected: FAIL — the page is still a stub.

- [ ] **Step 3: Implement AdminFeedbackPage**

Overwrite `apps/web/src/pages/admin/AdminFeedbackPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import DataTable, { type Column } from './components/DataTable';

interface SubmissionRow {
  id: number;
  category: string;
  githubIssueNumber: number | null;
  githubIssueUrl: string;
  createdAt: string;
  userId: number;
  userName: string;
}

interface ListResponse {
  submissions: SubmissionRow[];
  nextCursor: number | null;
}

export default function AdminFeedbackPage() {
  const [category, setCategory] = useState('');

  const params = new URLSearchParams();
  if (category) params.set('category', category);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'feedback', category],
    queryFn: () => request<ListResponse>(`/api/admin/feedback?${params.toString()}`),
  });

  const columns: Column<SubmissionRow>[] = [
    { key: 'user', header: 'User', render: (r) => r.userName },
    { key: 'category', header: 'Category', render: (r) => r.category || '—' },
    {
      key: 'ghIssue',
      header: 'GitHub issue',
      render: (r) =>
        r.githubIssueNumber !== null && r.githubIssueUrl
          ? (
            <a
              href={r.githubIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
              onClick={(e) => e.stopPropagation()}
            >
              #{r.githubIssueNumber}
            </a>
          )
          : '—',
    },
    {
      key: 'createdAt',
      header: 'Filed',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Feedback</h1>
      <div className="flex items-center gap-2">
        <label htmlFor="feedback-category" className="text-sm text-muted-foreground">
          Category
        </label>
        <select
          id="feedback-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">all</option>
          <option value="bug">bug</option>
          <option value="enhancement">enhancement</option>
          <option value="question">question</option>
        </select>
      </div>
      <DataTable<SubmissionRow>
        rows={data?.submissions ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
      />
    </div>
  );
}
```

(Native `<select>` rather than shadcn `Select`: the existing shadcn Select needs `onValueChange` not `onChange`, which complicates the simple form-style test pattern. Plain `<select>` is fine for this use case — one filter, low styling needs.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/AdminFeedbackPage.test.tsx
```

Expected: PASS — 3 tests green.

- [ ] **Step 5: Run full web suite + build**

```bash
cd apps/web && pnpm test && pnpm run build
```

Expected: 91 tests green (88 + 3 new); build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/AdminFeedbackPage.tsx apps/web/src/pages/admin/AdminFeedbackPage.test.tsx
git commit -m "feat(web): admin Feedback list page"
```

---

### Task B3: AdminSearchPage (real implementation)

**Files:**
- Overwrite stub: `apps/web/src/pages/admin/AdminSearchPage.tsx`
- Create: `apps/web/src/pages/admin/AdminSearchPage.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/pages/admin/AdminSearchPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminSearchPage from './AdminSearchPage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminSearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('AdminSearchPage', () => {
  it('does not fetch until the user submits a query', () => {
    renderPage();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('renders search hits across multiple types after submit', async () => {
    requestMock.mockResolvedValueOnce({
      results: [
        {
          type: 'request',
          id: 1,
          primary: 'New blender',
          userName: 'Gladis',
          householdName: 'Casa',
          timestamp: '2026-05-01T00:00:00.000Z',
          raw: { id: 1, title: 'New blender' },
        },
        {
          type: 'consumedJwtJti',
          id: 'jti-abc',
          primary: 'jti-abc',
          userName: null,
          householdName: null,
          timestamp: '2026-05-01T00:00:00.000Z',
          raw: { jti: 'jti-abc' },
        },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'blender' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByText('New blender')).toBeInTheDocument());
    expect(screen.getByText('jti-abc')).toBeInTheDocument();
    expect(screen.getByText('request')).toBeInTheDocument();
    expect(screen.getByText('consumedJwtJti')).toBeInTheDocument();
  });

  it('sends type filter when one is selected', async () => {
    requestMock.mockResolvedValue({ results: [] });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'comment' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => {
      const last = requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0];
      expect(last).toEqual(expect.stringContaining('q=x'));
      expect(last).toEqual(expect.stringContaining('type=comment'));
    });
  });

  it('opens a detail drawer with raw JSON when a hit is clicked', async () => {
    requestMock.mockResolvedValueOnce({
      results: [
        {
          type: 'comment',
          id: 99,
          primary: 'a comment',
          userName: 'Alice',
          householdName: 'Casa',
          timestamp: '2026-05-01T00:00:00.000Z',
          raw: { id: 99, body: 'a comment', authorId: 7 },
        },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'comment' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByText('a comment')).toBeInTheDocument());
    fireEvent.click(screen.getByText('a comment'));
    await waitFor(() => {
      // Drawer renders the raw JSON pretty-printed; look for a distinctive substring
      expect(screen.getByText(/"authorId": 7/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/AdminSearchPage.test.tsx
```

Expected: FAIL — the page is still a stub.

- [ ] **Step 3: Implement AdminSearchPage**

Overwrite `apps/web/src/pages/admin/AdminSearchPage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DataTable, { type Column } from './components/DataTable';
import DetailDrawer from './components/DetailDrawer';

type HitType = 'request' | 'comment' | 'notificationLog' | 'pushSubscription' | 'consumedJwtJti';

interface SearchHit {
  type: HitType;
  id: number | string;
  primary: string;
  userName: string | null;
  householdName: string | null;
  timestamp: string;
  raw: Record<string, unknown>;
}

interface SearchResponse {
  results: SearchHit[];
}

export default function AdminSearchPage() {
  // Pending input (what the user is typing) vs submitted (what we actually query)
  const [pendingQ, setPendingQ] = useState('');
  const [pendingType, setPendingType] = useState<'' | HitType>('');
  const [submitted, setSubmitted] = useState<{ q: string; type: '' | HitType } | null>(null);
  const [selected, setSelected] = useState<SearchHit | null>(null);

  const params = new URLSearchParams();
  if (submitted) {
    params.set('q', submitted.q);
    if (submitted.type) params.set('type', submitted.type);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'search', submitted?.q ?? '', submitted?.type ?? ''],
    queryFn: () => request<SearchResponse>(`/api/admin/search?${params.toString()}`),
    enabled: submitted !== null && submitted.q.trim().length > 0,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = pendingQ.trim();
    if (!q) return;
    setSubmitted({ q, type: pendingType });
  }

  const columns: Column<SearchHit>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (r) => <Badge variant="outline">{r.type}</Badge>,
      width: '160px',
    },
    {
      key: 'primary',
      header: 'Primary',
      render: (r) => <span className="truncate">{r.primary}</span>,
    },
    { key: 'user', header: 'User', render: (r) => r.userName ?? '—' },
    {
      key: 'household',
      header: 'Household',
      render: (r) => r.householdName ?? '—',
    },
    {
      key: 'timestamp',
      header: 'When',
      render: (r) => new Date(r.timestamp).toLocaleString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit Search</h1>
      <form role="search" onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <Input
            type="search"
            placeholder="Search title / body / event / endpoint / jti…"
            value={pendingQ}
            onChange={(e) => setPendingQ(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="search-type" className="mb-1 block text-xs uppercase text-muted-foreground">
            Type
          </label>
          <select
            id="search-type"
            value={pendingType}
            onChange={(e) => setPendingType(e.target.value as '' | HitType)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">all</option>
            <option value="request">request</option>
            <option value="comment">comment</option>
            <option value="notificationLog">notificationLog</option>
            <option value="pushSubscription">pushSubscription</option>
            <option value="consumedJwtJti">consumedJwtJti</option>
          </select>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {submitted && (
        <DataTable<SearchHit>
          rows={data?.results ?? []}
          columns={columns}
          rowKey={(r) => `${r.type}:${r.id}`}
          isLoading={isLoading}
          emptyMessage="No results."
          onRowClick={(r) => setSelected(r)}
        />
      )}
      <DetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.type} #${selected.id}` : ''}
      >
        {selected && (
          <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(selected.raw, null, 2)}
          </pre>
        )}
      </DetailDrawer>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/AdminSearchPage.test.tsx
```

Expected: PASS — 4 tests green.

- [ ] **Step 5: Run full web suite + build + full api suite**

```bash
cd apps/web && pnpm test && pnpm run build
cd ../api && pnpm test
```

Expected: web 95 green (91 + 4 new); api still 319 green (no API change in B3); build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/AdminSearchPage.tsx apps/web/src/pages/admin/AdminSearchPage.test.tsx
git commit -m "feat(web): admin Audit Search page (unified search across 5 models)"
```

---

## Manual smoke (post-merge)

After PR 2 merges to main and the auto-deploy completes:

- [ ] Log into `https://two-cents.wispy-nook.casa/admin` as a `two-cents-admins` user
- [ ] Sidebar shows Feedback + Audit Search entries
- [ ] **Feedback:** lists the 19 GitHub-issue-linked submissions (or however many you've accumulated); category filter narrows results; clicking the `#N` link opens the GH issue in a new tab
- [ ] **Audit Search:** typing "blender" (or another known token) returns hits across the populated types; type filter restricts to one type; clicking a row opens a drawer with the raw JSON
- [ ] No regressions in PR 1 sections (People / Households / Appeals)

---

## Plan self-review

**Spec coverage:**
- Feedback section (spec §4) → Tasks A2 + B1 + B2 ✓
- Audit Search section (spec §5) → Tasks A3 + B1 + B3 ✓
- AdminLayout sidebar entries (spec §1 architecture) → Task B1 ✓
- Auth gate (requireAdmin already global) — no new wiring needed ✓
- Spec endpoints `GET /api/admin/feedback` and `GET /api/admin/search?q=&type=` → A2 + A3 ✓
- Spec out-of-scope items unchanged (no User.isAdmin/name edits, no other-user prefs, no Playwright) ✓

**Placeholder scan:** Every code step has a complete code block. The one conditional ("if `consumedJWTJti` casing differs in the generated client") in A3 step 3 documents the verification command and the rationale — explicit, not a placeholder.

**Type consistency:**
- `SubmissionRow` (web) ↔ `submissions[].{...}` (api A2): same field names (id, category, githubIssueNumber, githubIssueUrl, createdAt, userId, userName).
- `SearchHit` (web) ↔ API `SearchHit` (A3): identical shape (type, id, primary, userName, householdName, timestamp, raw).
- Query param names match: `category`, `hasGhIssue`, `q`, `type` consistent between schema, API handler, and web URL construction.
- React-query keys consistent: `['admin', 'feedback', category]` and `['admin', 'search', q, type]`.

**Risks (from spec):**
- Audit Search performance: 5 concurrent ILIKE queries with `take: 10` each. Acceptable at current scale; spec already flagged `pg_trgm` as a future option if pages run > 200ms.
- `consumedJwtJti` has no user context — UI shows `—`. Acceptable per spec ("each result clickable → drawer with full row").
- `pushSubscription.endpoint` is unique but searched as a substring — admin might leak a partial endpoint URL when sharing a screenshot. Same risk as the existing People → push subs list; not a new concern.

No gaps found.
