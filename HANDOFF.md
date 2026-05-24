# Two Cents — Session Handoff

**Date:** 2026-05-24 (refreshed)
**Audience:** a fresh Claude Code session picking up the v2 codebase post-launch

---

## Where we are

| Repo | Path | GitHub | State |
|---|---|---|---|
| v1 (retired) | `d:/code/two-cents/` | [Zaphiruz/two-cents](https://github.com/Zaphiruz/two-cents) | **Archived.** Containers stopped + removed; DB dropped; Vault wiped; runner deregistered. The GitHub repo is kept as historical reference only. All 18 issues were transferred to v2. |
| v2 (this repo) | `d:/code/two-cents-v2/` | [Zaphiruz/two-cents-v2](https://github.com/Zaphiruz/two-cents-v2) | **Live in production** at `https://two-cents.wispy-nook.casa` since 2026-05-24. Auto-deploys on push to `main`. |

Work happens directly on `main` (or short feature branches that fast-forward back) — the project shifted out of mid-rewrite mode after cutover.

## Resume prompt for the next session

> Two Cents v2 is in production. Read `d:/code/two-cents-v2/HANDOFF.md` for the current state. The 16-phase rewrite + v1 cutover + admin page (PR 1 & 2) are all shipped. For new feature work, brainstorm → spec → plan → subagent-driven-development. For bug fixes, just dispatch a small TDD subagent. `gh` CLI is authenticated as `Zaphiruz`.

---

## Phase progress

All phases of the rewrite + cutover are complete. Two follow-on PRs added the admin page.

| Phase | Status |
|---|---|
| 0-8. Backend (bootstrap, domain, Fastify, auth, requests, appeals, notifications, households+feedback, workers) | ✅ shipped |
| 9-13. Web (bootstrap, request flows, appeals/settings/household/feedback UIs, PWA, polish) | ✅ shipped |
| 14. Deploy (Dockerfiles, compose.prod, fetch-secrets, GH Actions, S2 runner) | ✅ shipped |
| 15. Cutover (v1 → v2 data migration, port flip, v1 wipe) | ✅ shipped 2026-05-24 |
| Admin page PR 1 (Foundation + People + Households + Appeals) | ✅ shipped 2026-05-24 |
| Admin page PR 2 (Feedback + Audit Search) | ✅ shipped 2026-05-24 |

**Tests at HEAD:** 319 api + 95 web + 79 shared = **493 total**. All green. `tsc --noEmit` clean across all packages.

---

## Backend API surface

All routes under `/api`. The web app consumes these.

| Route | Auth | Notes |
|---|---|---|
| `GET /auth/login` | none | OIDC redirect to Authentik |
| `GET /auth/callback` | none | OIDC roundtrip → session set |
| `POST /auth/logout` | session | destroys session |
| `GET /auth/me` | session | `{id, name, isAdmin}` or 401 |
| `GET /requests` | session | `{incoming, myActive}` queue |
| `POST /requests` | session | create with items |
| `GET /requests/:id` | view perm | full request + items + reviews + comments + appealsRemaining |
| `PATCH /requests/:id` | buyer | `saveRequestEdit` (bundle + items diff) |
| `POST /requests/:id/act` | approver | `{action, approverSeriousness, delayOverrideDays?, notes?}` |
| `POST /requests/:id/cancel` | buyer | |
| `POST /requests/:id/reconfirm` | buyer | |
| `POST /requests/:id/purchase` | buyer | |
| `POST /requests/:id/comments` | view perm | `{body}` |
| `POST /appeals` | buyer | `{requestId, justification}` (request must be `denied`) |
| `GET /appeals/queue` | session | pending appeals where caller is approver of buyer |
| `POST /appeals/:id/resolve` | approver | `{decision: 'overturn'|'uphold'}` |
| `GET /push/vapid` | none | `{publicKey}` |
| `POST /push/subscribe` | session | `{endpoint, keys: {p256dh, auth}}` (flat — no `subscription` wrapper) |
| `POST /push/unsubscribe` | session | `{endpoint}` |
| `POST /qa/:token` | token | JWT quick-action consumer |
| `GET /notifications/preferences` | session | list |
| `PUT /notifications/preferences` | session | upsert each |
| `GET /household` | session | current user's household + members + my approvers + my buyers + pending |
| `POST /household/invite` | session | `{authentikUsername, approvalMode}` |
| `POST /feedback` | session, 1/min/user | `{title, body, category?}`; best-effort GitHub Issue |
| `GET /feedback` | session | caller's submissions with live GitHub state |
| `GET /admin/users` | admin | list (q/isAdmin filters, cursor pagination) |
| `GET /admin/users/:id/detail` | admin | drawer payload: user + household + recent requests/comments/push subs/log |
| `POST /admin/users/:id/test-push` | admin | fire a test web-push to all of the user's subs |
| `DELETE /admin/users/:id/push-subscriptions` | admin | bulk-delete |
| `GET /admin/users/unassigned` | admin | users not in any household (for member picker) |
| `GET /admin/households` | admin | list with member counts |
| `PATCH /admin/households/:id` | admin | name + quota |
| `GET /admin/households/:id/detail` | admin | household + members + buyer-approver pairs |
| `POST /admin/households/:id/members` | admin | add user (`{userId, approvalMode}`) |
| `PATCH /admin/household-members/:id` | admin | change approval mode |
| `DELETE /admin/household-members/:id` | admin | removes member + cascades buyer-approver rows |
| `PUT /admin/buyer-approvers` | admin | idempotent upsert of (buyerId, approverId) |
| `DELETE /admin/buyer-approvers/:id` | admin | |
| `GET /admin/appeals` | admin | cross-household list with filters |
| `POST /admin/appeals/:id/resolve` | admin | overturn/uphold; fires `appeal_resolved` event same as user flow |
| `GET /admin/feedback` | admin | list with category + hasGhIssue filters |
| `GET /admin/search?q=&type=` | admin | unified text search across Request/Comment/NotificationLog/PushSubscription/ConsumedJWTJti |

`/api/admin/*` routes are all gated by the `requireAdmin` Fastify preHandler registered at the admin plugin level (`apps/api/src/routes/admin/index.ts`). 401 if unauthenticated, 403 if not in the `two-cents-admins` Authentik group.

**Error handler maps:** `ZodError` → 400, `IllegalTransition` → 409, `QuotaExceeded` → 422, `JWTInvalidError` → 400, `JWTReplayError` → 409, `GitHubAuthError`/`GitHubAPIError` → 502, `GitHubNotConfigured` → 503, Prisma `P2025` → 404, `P2002` → 409.

---

## Stack decisions (locked, don't re-litigate)

- **TypeScript pnpm monorepo** — `apps/api` (Fastify) + `apps/web` (Vite + React) + `packages/shared`
- **API:** Fastify 5, Prisma 5, BullMQ, openid-client + iron-session (cookie sessions), web-push, jose (JWT), @aws-sdk/client-s3, Zod, Pino
- **Web (declared, not yet wired):** Vite 5, React 18, react-hook-form + Zod, TanStack Query, Tailwind + shadcn/ui, react-router-dom 6
- **DB:** new `two_cents_v2` Postgres database (separate from v1's `two_cents`)
- **Cutover:** cold cutover with brief downtime; truncate-and-restart (3 users, 2 requests; trivial to recreate)
- **nginx routing:** `/api/*` → API:4000, everything else → web container (Caddy):3005, both on same hostname so cookies are same-origin
- **Vault path:** `secret/data/two-cents-v2`
- **MinIO bucket:** `two-cents-v2-images` (new bucket on existing S2 MinIO)
- **OIDC application:** new Authentik app slug `two-cents-v2`, redirect URI `https://two-cents.wispy-nook.casa/api/auth/callback`

**Reference implementation pattern:** Dinner Club (`/opt/dinner-club/` on S2) is the same stack. Mirror its conventions.

---

## Architectural patterns established (use these in Phase 9+)

**API route pattern (any handler that mutates):**
```ts
app.post('/api/...', async (req, reply) => {
  const userId = authGuard(req, reply);
  if (userId === null) return;
  const body = SomeSchema.parse(req.body); // Zod throws → 400 via error handler
  const member = await memberForUser(app.prisma, userId);
  if (!member) { reply.code(403).send({ error: 'not_in_household' }); return; }
  const allowed = await isBuyerByMember(app.prisma, member.id, requestId); // boolean | null (null = 404)
  if (allowed === null) { reply.code(404).send({ error: 'not_found' }); return; }
  if (!allowed) { reply.code(403).send({ error: 'forbidden' }); return; }
  // ... business logic; throw IllegalTransition / QuotaExceeded freely
});
```

**Helpers in `apps/api/src/lib/permissions.ts`:**
- `memberIdForUser(db, userId)` / `memberForUser(db, userId)` — returns `{id, householdId}` or null
- `isBuyer(db, userId, requestId)` / `isBuyerByMember(db, memberId, requestId)` — convenience vs prefetched
- `canAct(db, ...)` / `canActByMember(db, ...)` — approver of the buyer
- `canView(db, ...)` / `canViewByMember(db, ...)` — buyer OR approver
- `*ByMember` returns `boolean | null` (null = request doesn't exist; route returns 404)

**State machine composition (atomic transition + your writes):**
```ts
await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
  // your reads + writes via tx
  await transitionOnTx(tx, requestId, 'edit_meaningful', { actorId, notes });
});
```
Never call `transition(prisma, ...)` from inside an outer `$transaction` (would deadlock).

**fireEvent pattern (best-effort; must not break the request):**
```ts
try {
  await fireEvent(app.prisma, 'request_pending', { requestId: created.id });
} catch (err) {
  req.log.error({ err }, 'fireEvent failed');
}
```

**Test pattern:**
- `apps/api/src/test-helpers/session.ts` exports `buildTestApp()` (registers a `/__set_session?userId=N` route for session injection)
- `tests/helpers/fixtures.ts` → `createMembers()`, `createRequest()` factories
- Each test file boots its own app via `buildTestApp()`; `beforeEach(clearDatabase)` runs from the global setup
- Push delivery: `vi.mock('../lib/push.js', ...)` per-file in route tests that trigger `fireEvent`

---

## Operational details

### Local dev environment

- Windows + bash (Git Bash / mingw64); use forward slashes in paths
- **Node 22** LTS preferred; this machine runs Node 23 via nvm (works, but has corepack key-verification quirk — prefix pnpm with `COREPACK_INTEGRITY_KEYS=0`)
- **pnpm** via `corepack enable`
- **Docker Desktop** running (intermittent — restart if `docker version` shows empty Server section)
- **gh CLI** authenticated as `Zaphiruz` (no `workflow` scope; needs refresh if any `.github/workflows/*` push happens)
- Python (uv) only for v1 work; not used in v2

### Ephemeral DB/Redis for tests

```bash
docker run --rm -d --name pg-tc -p 5435:5432 -e POSTGRES_USER=two_cents_v2 -e POSTGRES_PASSWORD=two_cents_v2 -e POSTGRES_DB=two_cents_v2 postgres:16
docker run --rm -d --name redis-tc -p 6390:6379 redis:7-alpine
# wait for ready
DATABASE_URL=postgresql://two_cents_v2:two_cents_v2@localhost:5435/two_cents_v2 \
  pnpm --filter @two-cents/api exec prisma migrate deploy
DATABASE_URL=postgresql://two_cents_v2:two_cents_v2@localhost:5435/two_cents_v2 \
  REDIS_URL=redis://localhost:6390/0 \
  pnpm --filter @two-cents/api test
docker stop pg-tc redis-tc
```

**Don't reuse** `dinner-club-redis-1` or other project leftovers — they have networking quirks and refuse external Node TCP connections from Windows host.

### Git push pattern (SSH agent often unreachable)

```bash
GHTOK=$(gh auth token)
git push "https://x-access-token:$GHTOK@github.com/Zaphiruz/two-cents-v2.git" claude/priceless-moser-c21b65:main
git fetch "https://x-access-token:$GHTOK@github.com/Zaphiruz/two-cents-v2.git" main:refs/remotes/origin/main
```

### Commit signing

Global config has `commit.gpgsign=true` (SSH format) but the SSH signing key isn't always reachable. **Always commit with** `git -c commit.gpgsign=false commit -m '...'`. Don't change the config — fixing the agent is on the user's end.

### Existing infrastructure (S2)

- **S2:** `192.168.40.20`, SSH alias `S2`. Ubuntu 24.04, x86_64, 6.7GB RAM
- **App location pattern:** `/opt/<appname>/`
- **Shared infra:** `/opt/shared-infra/` runs Postgres 17 + Redis. Networks `shared-db` (alias `postgresql`) and `shared-redis` (alias `redis`)
- **MinIO container:** `dinner-club-minio-1`, exposes API on port 9002 (host)
- **LC2** (`192.168.40.11`) runs nginx + cloudflared. Terminates TLS via Cloudflare Origin CA cert
- **Vault:** `https://vault.wispy-nook.casa`. `vault` CLI is on LC3
- **GitHub Actions:** self-hosted runners registered per app at `/opt/actions-runner-<appname>/`
- **Authentik:** `https://authentik.wispy-nook.casa`. Existing groups `two-cents-users`, `two-cents-admins`. v1 OIDC app slug is `two-cents`; v2 will use new slug `two-cents-v2`

---

## Active follow-ups

Open items from the admin page reviews and the broader project punch list. None block — these are the next things worth picking up if you're looking for work.

**From admin page PR 2 final review:**
- **`raw` field whitelisting in `/api/admin/search`** — currently dumps the full Prisma row as JSON to the drawer. Fine for an admin tool but susceptible to silent leakage if schema fields are added later. Consider a per-type zod whitelist before returning.
- **`oidcSubject` column on Feedback page** — spec wanted "name + truncated oidc_subject"; we shipped name only. Add if needed for disambiguation.
- **Per-page 403 redirect tests** for AdminFeedbackPage and AdminSearchPage — `RequireAdmin` already gates the route subtree, so only matters for mid-session admin flag flips.
- **Unused `buildApp` imports** in `apps/api/src/routes/admin/{feedback,search}.test.ts` — trivial cleanup.

**Open user feedback (deferred from before admin work):**
- **#14** (UX: forms need clearer post-submit feedback) — cross-cutting pattern across multiple forms; baked into v2 partially but worth a sweep
- **#15** (remove-item checkbox doesn't disable form validation) — bug
- **#16** (line-item format shows `####` not `##.##`) — money formatting regression sibling of resolved #2
- **#17** (Gladis: "Can't submit request :(") — low detail; needs repro
- **#18** (View past resolved items) — feature request

**General:**
- **Deploy workflow paths-ignore** — currently every push to `main` (including docs-only) triggers a rebuild + redeploy. Adding `paths-ignore: [docs/**, '*.md']` to `.github/workflows/deploy.yml` would save ~2 min per docs commit.
- **Coverage gate** — never wired up. If you want a CI threshold, vitest can emit lcov; pick a floor (70%+ seems sane for this codebase).
- **GPG/SSH commit signing** — config issue on user's side; commits land unsigned. Workaround `-c commit.gpgsign=false`.
- **Test flakiness watch** — early phases reported occasional FK constraint failures during full-suite runs under concurrent TRUNCATE. Hasn't reappeared during admin work; flag if it does.

---

## Don't do

- Don't touch `commit.gpgsign` config — work around with `-c commit.gpgsign=false`
- Don't paste secrets into the chat
- Don't run destructive commands on S2 without confirming. The new at-risk paths are `/opt/two-cents-v2/`, the `two_cents_v2` Postgres DB, and `secret/data/two-cents-v2` in Vault — those are production now.
- Don't push via SSH (`git@github.com:...`) — agent is often unreachable; use the gh-token HTTPS pattern above
- Don't dispatch parallel subagents that touch the same files. Disjoint scopes are fine; same file → conflicts.
- Don't auto-revert the `defaultMode: "bypassPermissions"` setting in `.claude/settings.local.json` if it reappears — user's call.

---

## Files to read first when picking up

1. **`docs/purchase-request-app-spec.md`** — product spec (what the app does)
2. **`docs/superpowers/specs/2026-05-24-admin-page-design.md`** — admin page architecture
3. **`docs/superpowers/specs/2026-04-28-two-cents-design.md`** — v1 design (state machine, models, business rules — still authoritative for those)
4. **Phase status memory files** at `~/.claude/projects/D--code-two-cents-v2/memory/` (one per shipped phase; the index is `MEMORY.md`)

For visual reference on existing UI patterns, browse the current SPA at `https://two-cents.wispy-nook.casa` or read `apps/web/src/pages/`.
