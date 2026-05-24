# v2 Admin Page — Design

**Date:** 2026-05-24
**Status:** Design approved, ready for implementation plan
**Replaces:** v1 Django admin (8 admin.py files, 14 ModelAdmin registrations)

## Why this exists

v1's admin surface was Django's free CRUD UI over every registered model — 14 ModelAdmin entries across 6 apps. v2 was rebuilt from scratch and currently has the `/admin` route stubbed (`apps/web/src/App.tsx:43`) but no implementation. We need parity with the v1 admin's **jobs done**, not parity with its 14 screens, because:

1. Several v1 admin-editable models are already managed via the user-facing v2 app (`/api/household/invite`, `/api/appeals/queue`, `/api/notifications/preferences`, `/api/push/subscribe`). Duplicating those as admin screens would just write the same DB rows.
2. `User.isAdmin` and `User.name` are resynced from Authentik on every login (`apps/api/src/services/userSync.ts:38`). UI edits would get clobbered.
3. Audit-only models (Request, RequestItem, ListingVersion, Review, Comment, NotificationLog, ConsumedJWTJti) share one job — "look up X across all households" — and collapse cleanly into a unified search.

The redesign exposes **5 admin sections** organized around actual jobs admins do, fronted by **15 new API endpoints** behind a `requireAdmin` Fastify hook.

## Scope

### In scope
- Cross-household visibility (look people up, view their household + activity)
- Household configuration (name, appeal quota, members, buyer→approver matrix)
- Cross-household appeal resolution
- Feedback submission triage (links out to GitHub)
- Unified audit search across all transactional + log models
- Per-user admin actions: send test push, delete push subscriptions, reassign household

### Out of scope (explicit)
- Editing `User.isAdmin` or `User.name` — sourced from Authentik OIDC claims, resynced on every login, so UI edits would be overwritten. To change admin status, modify the user's Authentik group membership.
- Editing other users' `NotificationPreference` — per-user privacy concern.
- Direct edits to immutable audit data (Requests, Comments, Reviews, ListingVersions) — viewable via Audit Search but not mutable from the admin UI.
- Bulk actions (multi-select + apply) — defer until a real use case appears.
- End-to-end Playwright tests — out of scope for this PR; integration + component tests are sufficient.
- Fixing the 5 open user-feedback issues (#14-#18). Tracked separately, addressed after admin lands.

## Auth model

Single global flag `User.isAdmin: boolean`, sourced from the Authentik group `two-cents-admins` and synced on every login (`apps/api/src/services/userSync.ts:29`). No per-household admin role, no finer-grained RBAC.

**API gate:** new Fastify hook `requireAdmin` (alongside the existing session/user hooks) that returns `403` if the session user is missing or `isAdmin === false`. Applied via `preHandler` on every `/api/admin/*` route, defined once in the admin plugin.

**Web gate:** `apps/web/src/components/Nav.tsx:31` already conditionally renders the admin link on `user.isAdmin`. The `/admin/*` routes additionally check `user.isAdmin` at the router level and redirect to `/` if false (defense in depth — sidebar hiding is UX, not security).

## Architecture

```
apps/api/src/
  plugins/
    admin.ts                   # registers requireAdmin hook + mounts /api/admin/* routes
  routes/admin/
    users.ts                   # GET list, GET /:id/detail, POST /:id/test-push, DELETE /:id/push-subscriptions
    households.ts              # GET list, PATCH /:id
    household-members.ts       # POST (under household), PATCH /:id, DELETE /:id
    buyer-approvers.ts         # PUT, DELETE /:id
    appeals.ts                 # GET, POST /:id/resolve
    feedback.ts                # GET
    search.ts                  # GET ?q=&type=

packages/shared/src/schemas/
  admin.ts                     # Zod schemas for every admin write endpoint

apps/web/src/
  pages/admin/
    AdminLayout.tsx            # sidebar + outlet
    PeoplePage.tsx
    HouseholdsPage.tsx
    AppealsPage.tsx
    FeedbackPage.tsx
    SearchPage.tsx
    components/
      DataTable.tsx            # paginated, sortable, filterable
      DetailDrawer.tsx         # shadcn Sheet wrapper
      PeopleDetail.tsx
      HouseholdDetail.tsx
```

**Routing:** `/admin/*` nested routes in `App.tsx` replacing the existing stub on line 43. `<AdminLayout />` mounts the sidebar and renders the active section via `<Outlet />`.

**Data fetching:** existing react-query setup. Each list page has its own `useAdminXxx` hook in `apps/web/src/lib/admin/`. No new fetch library or state-management addition.

**Styling:** shadcn components only (Table, Sheet, Button, Input, Select, Badge). No new UI deps.

## Sections

### 1. People — `/admin/people`

**List:** name, household (or "—"), `isAdmin` badge, created-at. Search by name. Filter: isAdmin yes/no.

(No last-login column — `User` doesn't track it. If admins ask for it, add a `lastLoginAt` field + migration in a follow-up; it's not part of this spec.)

**Detail drawer** (row click):
- Profile header: name, oidc_subject (small/muted), `isAdmin` badge — all read-only with helper text "synced from Authentik on each login"
- Household card: link to household detail; shows the user's `approval_mode`; **Reassign household** button opens a user-picker dialog under the new household
- Recent requests: last 20 with status badges; click → opens request detail in main app (new tab)
- Recent comments: last 20
- Push subscriptions: table with endpoint (truncated) + created_at; per-row delete; bulk **Delete all** button
- Notification log: last 50 entries (event_key, sent_at)
- Actions row at bottom: **Send test push** · **Delete all push subs**

**Endpoints:**
- `GET /api/admin/users?q=&isAdmin=` → paginated list
- `GET /api/admin/users/:id/detail` → full drawer payload (single round-trip; avoids 5 separate calls)
- `POST /api/admin/users/:id/test-push` → fires a test web-push to all of the user's subscriptions; returns counts
- `DELETE /api/admin/users/:id/push-subscriptions` → removes all

### 2. Households — `/admin/households`

**List:** name, member count, appeal quota (`{count}/{period}`), created-at.

**Detail drawer:**
- Edit section: name input, appeal_quota_count number input, appeal_quota_period select (enum from Prisma `AppealPeriod`)
- Members table: user, approval_mode (inline select editor), joined; per-row remove; **Add member** button opens user-picker (excluding existing members) with approval_mode select
- Buyer→approver matrix: rows = household members, cols = household members, cells are clickable toggles that PUT/DELETE `BuyerApprover` rows. Self-cells disabled.

**Endpoints:**
- `GET /api/admin/households` → list with member counts
- `PATCH /api/admin/households/:id` → body: `{ name?, appealQuotaCount?, appealQuotaPeriod? }`
- `POST /api/admin/households/:id/members` → body: `{ userId, approvalMode }`
- `PATCH /api/admin/household-members/:id` → body: `{ approvalMode }`
- `DELETE /api/admin/household-members/:id` → cascade-removes BuyerApprover rows where this member is buyer or approver
- `PUT /api/admin/buyer-approvers` → body: `{ buyerId, approverId }`; upsert (no-op if exists)
- `DELETE /api/admin/buyer-approvers/:id` → remove

### 3. Appeals — `/admin/appeals`

**List:** cross-household table — request title, buyer, household, status, period_key, created, resolved_at. Filters: status (enum), household (select), period_key (text).

Inline **Resolve** action on each row → opens the existing appeal-resolve dialog (same UX as user-facing `/api/appeals/queue`), but unscoped from "my household". Reuses the existing resolve handler with an admin-scope flag, or wraps it in a new admin endpoint that bypasses the household-membership check.

**Endpoints:**
- `GET /api/admin/appeals?status=&householdId=&periodKey=`
- `POST /api/admin/appeals/:id/resolve` (or extend the existing user endpoint with an admin scope; decided in the implementation plan)

### 4. Feedback — `/admin/feedback`

**List:** user (name + truncated oidc_subject), category, github_issue_number (link → opens GH issue in new tab), created-at. Filters: category, has GH issue.

Read-only. GitHub is the source of truth post-submit — no edits in this UI.

**Endpoint:**
- `GET /api/admin/feedback?category=&hasGhIssue=`

### 5. Audit Search — `/admin/search`

Single search box + type filter (Request, Comment, NotificationLog, PushSubscription, ConsumedJWTJti). Empty type = search all.

Result row varies by type but always shows: type badge, primary identifier (title for requests, snippet for comments, event_key for logs, endpoint for subs, jti for jtis), associated user + household, created_at. Click → detail drawer with the full row JSON.

**Endpoint:**
- `GET /api/admin/search?q=&type=` → returns `{ results: AuditMatch[], totalByType: Record<type, count> }`

`q` matches: request title/notes, comment text, log event_key, sub endpoint, jti. Case-insensitive. Limit 50 results per call (no pagination yet — if needed, add cursor later).

## Data flow

Standard v2 pattern. List page mounts → react-query hook fires `GET /api/admin/:resource` → Fastify route validates query (Zod) → Prisma query → JSON back. Detail drawer mounts → second react-query hook fires the `:id/detail` endpoint. Edit submit → mutation hook → `PATCH/POST/PUT/DELETE` → on success, invalidate the relevant query keys → list refreshes.

No new infrastructure. No worker queues. No webhooks.

## Error handling

- Validation errors → Zod parses, Fastify returns 400 with `{ error: 'validation_error', issues: [...] }`. Web surfaces field errors inline in the form.
- Auth failures → `requireAdmin` returns 403 with `{ error: 'forbidden' }`. Web router redirects to `/` on 403 from any `/api/admin/*` call.
- Not found → 404 with `{ error: 'not_found' }`. Web shows a toast and closes the drawer.
- Conflicts (e.g. buyer-approver upsert race) → caught at DB layer; handler returns 200 (idempotent semantics for PUT).
- Test push delivery failures → counted and returned in response body (`{ sent: 3, failed: 1, errors: [...] }`); web surfaces in a toast.

## Testing

**API integration tests** — one `*.test.ts` per route file, matching the existing pattern (in-process Fastify app via `buildApp()`, real Prisma against the test DB, real iron-session cookies). Each route covers:
- happy path (admin caller, valid body)
- `requireAdmin` gate (non-admin caller → 403)
- validation (bad body → 400)
- not-found (bogus id → 404)

**Web component tests** — vitest + React Testing Library per page, matching `apps/web/src/pages/RequestDetailPage.test.tsx`:
- renders list with seeded data
- opens drawer on row click
- fires correct API call on edit submit
- handles 403 by redirecting

**Shared schema tests** — extend `packages/shared/src/schemas/admin.test.ts` with parse/parse-fail cases per schema.

**Out of scope:** Playwright E2E (defer); load testing (admin endpoints are low-volume by definition).

## Implementation phasing

Single PR if practical. Split into 2 PRs if the diff balloons past ~2k LOC:

- **PR 1:** plugin + requireAdmin hook + People + Households + Appeals (the daily-use sections)
- **PR 2:** Feedback + Audit Search (lower-frequency)

Both PRs deploy through the existing `push to main → GitHub Actions → S2` pipeline.

## Risks / open questions

- **Audit Search performance:** unbounded text search across 5 tables. For now, every text column should already be indexed for primary lookups; if `ILIKE '%q%'` is too slow at scale, add a `pg_trgm` index. Out of scope to add proactively; revisit if pages > 200ms.
- **Test push delivery:** uses the same `web-push` library + VAPID keys as production push. If the user's subscription is stale (browser uninstalled), the send will 410 — count + report in response, don't crash.
- **Buyer-approver matrix UX with large households:** if a household has 20 members, that's a 20×20 grid (400 cells). Acceptable for now (households in practice are small); revisit with a different UI (per-member list) if anyone hits 10+ members.
- **Existing `/api/appeals/queue` vs new `/api/admin/appeals`:** to be decided in implementation plan whether to add an admin scope to the existing endpoint or build a separate handler. Lean toward separate handler for clarity (the admin variant returns cross-household rows; the user variant filters to the caller's household).

## Acceptance criteria

- Admin sidebar link visible only to users with `isAdmin = true`
- All 5 sections render and load data without errors against a populated dev DB
- Every write action (household edit, member add/remove, approver toggle, appeal resolve, push delete, test push) persists correctly and the UI reflects the change without a full reload
- Non-admin user hitting any `/api/admin/*` endpoint receives 403
- All new API + web tests pass; existing test suites remain green
- Deployed via the standard push-on-main pipeline
