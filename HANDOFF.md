# Two Cents — Session Handoff

**Date:** 2026-05-23
**Audience:** a fresh Claude Code session picking up the v2 rewrite mid-flight

---

## Where we are

| Repo | Path | GitHub | State |
|---|---|---|---|
| v1 (production) | `d:/code/two-cents/` | [Zaphiruz/two-cents](https://github.com/Zaphiruz/two-cents) | Live at `https://two-cents.wispy-nook.casa`. Used daily by 3 people. Don't modify unless asked. |
| v2 (this rewrite) | `d:/code/two-cents-v2/` | [Zaphiruz/two-cents-v2](https://github.com/Zaphiruz/two-cents-v2) | **Backend complete, on remote main at `e822214`.** Web app not started. |

**Active worktree:** `d:/code/two-cents-v2/.claude/worktrees/priceless-moser-c21b65/` on branch `claude/priceless-moser-c21b65`. Work in the worktree; the parent checkout's tree may be slightly out of sync.

## Resume prompt for the next session

> Continue the Two Cents v2 rewrite. Read this file first (`d:/code/two-cents-v2/HANDOFF.md`), then the plan at `docs/superpowers/plans/2026-05-03-two-cents-v2.md`. Phases 0–8 are complete and on main; **start at Phase 9 (Web bootstrap)**. Use `superpowers:subagent-driven-development`. v1 (production) at `d:/code/two-cents/` is reference only — don't modify it. The `gh` CLI is authenticated as `Zaphiruz`.

---

## Phase progress

| Phase | Status | Commit on main |
|---|---|---|
| 0. Bootstrap | ✅ done | `c9e6f6c` → `ef72968` |
| 1. Domain layer (state/delays/resolution/saveRequestEdit/appeals services) | ✅ done | `0439524` → `de3bc7d` |
| 2. Fastify skeleton (plugins + healthz + central error handler) | ✅ done | `81af0b3` |
| 3. Auth (Authentik OIDC + iron-session + userSync) | ✅ done | `77d7ce3` |
| 4. Requests API (9 endpoints + permissions) | ✅ done | `9934d22` |
| 5. Appeals API (3 endpoints) | ✅ done | `e58d67e` |
| 6. Notifications API (jwt + push + notify + events + qa/prefs + fireEvent wiring) | ✅ done | `87a40ad` |
| 7. Households + feedback API (4 endpoints + GitHub integration) | ✅ done | `e822214` |
| 8. Workers + scheduler (6 BullMQ scheduled jobs) | ✅ done | `d371438` |
| **9. Web bootstrap** | **next** | — |
| 10. Web request flows (6 sub-tasks) | ahead | — |
| 11. Web appeals + settings + household + feedback UIs | ahead | — |
| 12. Web PWA shell (manifest, sw, share-target, iOS hint, push registration) | ahead | — |
| 13. Polish parity (badges, timestamps, currency, delay preview, toasts, empty states) | ahead | — |
| 14. Deploy (Dockerfiles, compose, nginx, Vault, runner, deploy workflow) | **user-driven** | — |
| 15. Cutover (nginx flip, retire v1, brief downtime) | **user-driven** | — |
| 16. Restore Claude Code permissions (revert temp bypass; curate allow list) | **user-driven** | — |

**Tests:** 268 API + 64 shared = **332** total at HEAD. `tsc --noEmit` clean across both packages.

**Deferred:** GitHub Actions CI workflow (Task 0.6 of original plan). Needs `gh auth refresh --hostname github.com --scopes workflow` then a small commit. Not blocking; running tests locally has been the workflow.

---

## Backend API surface (complete)

All routes under `/api`. The web app (Phase 9+) consumes these.

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

## What's left (Phases 9–16)

### Phase 9 — Web bootstrap (next)

Fill in `apps/web/` (currently just a Phase 0 placeholder showing "Two Cents v2"):
- shadcn/ui init + 11 primitives (button/input/label/textarea/select/dialog/dropdown-menu/toast/badge/separator/card)
- `lib/api.ts` — thin fetch wrapper with `credentials: 'include'`
- `lib/queryClient.ts` — TanStack Query setup
- `lib/auth.tsx` — `useUser()` hook + `AuthProvider` + `loginRedirect()`/`logout()` helpers
- `App.tsx` — router with placeholder routes (10 routes)
- `components/Layout.tsx` + `components/Nav.tsx`
- Add `@testing-library/react` + `jsdom` + vitest config for web

Single dispatch. Don't push yet — phase boundary push is after.

### Phase 10 — Web request flows

6 sub-tasks. After Phase 9 lands, these can be parallelized:
- Queue page
- New request form (multi-item via `useFieldArray`)
- Detail page
- Edit page
- Approver action component
- Comments component

### Phases 11, 12, 13 — sequential

- 11: appeals queue/file + notification settings + household + feedback UIs
- 12: PWA (manifest, sw, share-target, iOS install hint, push registration)
- 13: polish parity (badges, timestamps, currency formatting, delay preview, 409 toast handler, loading states, empty states)

### Phases 14, 15, 16 — user-driven

These require Jacob's hands:
- 14: deploy infrastructure on S2 (Dockerfiles, compose, nginx, Vault provisioning, Authentik app creation, GitHub Actions self-hosted runner setup)
- 15: cutover (backup v1, flip nginx, retire v1 container)
- 16: revert temporary `bypassPermissions` Claude Code config + curate allow list (see plan)

---

## Carried punch list

- **Form-submit UX feedback** ([v1 issue #14](https://github.com/Zaphiruz/two-cents/issues/14)) — broader pattern; bake into v2 from start (loading states, success toasts, optimistic updates)
- **Coverage gate** — v1 CI uses `--cov-fail-under=0`. v2 CI not yet enabled (deferred Phase 0 task); when enabled, set a real floor (70%+)
- **GPG/SSH commit signing** — config issue on user's side; commits land unsigned
- **iOS install hint detection** — was based on `navigator.standalone`; verify it still triggers correctly on iOS 18+
- **Test flakiness flag** — both Phase 7 and 8 implementers reported intermittent FK constraint failures during full-suite runs (concurrent TRUNCATE in single-fork mode). Individual files pass cleanly; full suite occasionally fails on `state.test.ts` or `requests.test.ts`. Investigate before Phase 14 deploy if it persists.

---

## Don't do

- Don't modify v1 (`d:/code/two-cents/`) unless explicitly asked
- Don't touch `commit.gpgsign` config — work around with `-c commit.gpgsign=false`
- Don't paste secrets into the chat
- Don't run destructive commands on S2 without confirming (especially anything touching `/opt/two-cents/` or its database — that's live production until cutover)
- Don't push via SSH (`git@github.com:...`) — agent is often unreachable; use the gh-token HTTPS pattern above
- Don't burn context reading every v1 file. Read what the current task requires.
- Don't dispatch parallel subagents that touch the same files. Two backend phases (7+8) ran in parallel safely because their file scopes were disjoint; web phases (9-13) are NOT parallelizable for the most part.
- Don't auto-revert the `defaultMode: "bypassPermissions"` setting in `.claude/settings.local.json` if it reappears — it's intentional (was user's choice for this session, removed/re-added per user preference; Phase 16 cleans up at end of project).

---

## Files to read first when picking up

1. **`docs/superpowers/plans/2026-05-03-two-cents-v2.md`** — the 16-phase implementation plan (Phase 9 is what's next)
2. **`docs/superpowers/specs/2026-04-28-two-cents-design.md`** — v1 design (state machine, models, business rules)
3. **`docs/purchase-request-app-spec.md`** — product spec
4. **Phase status memory files** at `~/.claude/projects/D--code-two-cents-v2/memory/phase_{0..6}_status.md` (and Phase 7+8 may exist by next session)

For Phase 9 UX inspiration, v1's Django templates live at `d:/code/two-cents/apps/*/templates/` — but v2's UI is a fresh design; use the templates only to understand navigation structure, not for visual reference.
