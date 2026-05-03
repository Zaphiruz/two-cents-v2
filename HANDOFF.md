# Two Cents — Session Handoff

**Date:** 2026-05-03
**Audience:** a fresh Claude Code session picking up the v2 rewrite

---

## Where we are

| Repo | Path | GitHub | State |
|---|---|---|---|
| v1 (production) | `d:/code/two-cents/` | [Zaphiruz/two-cents](https://github.com/Zaphiruz/two-cents) | Live at `https://two-cents.wispy-nook.casa`. Used daily by 3 people. Don't modify unless asked. |
| v2 (this rewrite) | `d:/code/two-cents-v2/` | [Zaphiruz/two-cents-v2](https://github.com/Zaphiruz/two-cents-v2) | Empty except for plan + ported docs. Phase 0 not yet started. |

## Resume prompt for the next session

> Continue the Two Cents v2 rewrite. Read this file first (`d:/code/two-cents-v2/HANDOFF.md`), then the plan at `docs/superpowers/plans/2026-05-03-two-cents-v2.md`. Start at Phase 0 Task 0.1. Use `superpowers:subagent-driven-development`. v1 (production) at `d:/code/two-cents/` is reference only — don't modify it. The `gh` CLI is authenticated as `Zaphiruz`.

---

## Stack decisions (locked, don't re-litigate)

- **TypeScript pnpm monorepo** — `apps/api` (Fastify) + `apps/web` (Vite + React) + `packages/shared`
- **API:** Fastify 5, Prisma 5, BullMQ, openid-client + iron-session (cookie sessions), web-push, @aws-sdk/client-s3, Zod, Pino
- **Web:** Vite 6, React 18, react-hook-form + Zod, TanStack Query, Tailwind + shadcn/ui, react-router-dom
- **DB:** new `two_cents_v2` Postgres database (separate from v1's `two_cents`)
- **Cutover:** cold cutover with brief downtime; truncate-and-restart (3 users, 2 requests; trivial to recreate)
- **nginx routing:** `/api/*` → API:4000, everything else → web container (Caddy):3005, both on same hostname so cookies are same-origin
- **Vault path:** `secret/data/two-cents-v2`
- **MinIO bucket:** `two-cents-v2-images` (new bucket on existing S2 MinIO)
- **OIDC application:** new Authentik app slug `two-cents-v2`, redirect URI `https://two-cents.wispy-nook.casa/api/auth/callback`

**Reference implementation pattern:** Dinner Club (`/opt/dinner-club/` on S2) is the same stack. Mirror its conventions.

---

## Production state (v1) — context for parity

- **3 users:** Jacob Thomas (admin), Gladis Nevarez, Luke Jones-Thomas
- **1 household:** "Thomas-Nevarez", default mode `any`
- **2 requests:**
  - #1 KitchenAid grader (Jacob's, pending)
  - #2 Bloom Fitness Trio Bundle (Glad's, approved)
- Multi-item refactor recently landed; existing requests migrated to single-item bundles
- All fixes from real-use feedback shipped (CSRF, REDIS_URL, money formatting, status badges, login redirect, etc.)

---

## Files to read first

Before touching code:

1. **`docs/superpowers/plans/2026-05-03-two-cents-v2.md`** — the implementation plan, 16 phases
2. **`docs/superpowers/specs/2026-04-28-two-cents-design.md`** — v1 design (still authoritative for state machine, models, business rules)
3. **`docs/purchase-request-app-spec.md`** — product spec
4. **`d:/docs/mikrotik/CLAUDE.md`** — homelab infrastructure context (S2 layout, networks, Authentik patterns, Vault, etc.)

For porting v1 logic, the canonical sources:

- `d:/code/two-cents/apps/requests_app/state.py` — state machine, ALLOWED dict, transition()
- `d:/code/two-cents/apps/requests_app/delays.py` — delay table + clamp_override
- `d:/code/two-cents/apps/requests_app/resolution.py` — all-mode resolution
- `d:/code/two-cents/apps/requests_app/services.py` — save_request_edit (multi-item version)
- `d:/code/two-cents/apps/notifications/jwt.py` — JWT sign/verify/markConsumed
- `d:/code/two-cents/apps/notifications/services.py` — notify(), is_enabled, in_quiet_hours
- `d:/code/two-cents/apps/notifications/events.py` — fire_event() payload builders
- `d:/code/two-cents/apps/notifications/tasks.py` — wait, this lives in `apps/requests_app/tasks.py` — scheduled tasks
- `d:/code/two-cents/apps/appeals/services.py` — quota accounting

---

## Operational details

### Local dev environment

- Windows + bash (Git Bash / mingw64); use forward slashes in paths
- **Node 22** LTS available
- **pnpm** via `corepack enable`
- **Docker Desktop** running
- **gh CLI** authenticated as `Zaphiruz`
- Python (uv) only for v1 work; not used in v2

### Ephemeral DB/Redis for tests

```bash
docker run --rm -d --name pg-tc -p 5433:5432 -e POSTGRES_USER=two_cents_v2 -e POSTGRES_PASSWORD=two_cents_v2 -e POSTGRES_DB=two_cents_v2 postgres:16
docker run --rm -d --name redis-tc -p 6379:6379 redis:7
sleep 5
DATABASE_URL=postgresql://two_cents_v2:two_cents_v2@localhost:5433/two_cents_v2 \
  REDIS_URL=redis://localhost:6379/0 \
  pnpm test
docker stop pg-tc redis-tc
```

### Git push pattern (SSH agent often unreachable)

```bash
GHTOK=$(gh auth token)
git push "https://x-access-token:$GHTOK@github.com/Zaphiruz/two-cents-v2.git" main

# After such a push, refresh local tracking ref so 'origin/main' isn't stale:
git fetch "https://x-access-token:$GHTOK@github.com/Zaphiruz/two-cents-v2.git" main:refs/remotes/origin/main
```

### Commit signing

Global config has `commit.gpgsign=true` with SSH format, but the SSH signing key isn't always reachable. **Always commit with** `git -c commit.gpgsign=false commit -m '...'` to avoid hangs. Don't change this config — fixing the agent is on the user's end, not ours.

### Existing infrastructure (S2)

- **S2:** `192.168.40.20`, SSH alias `S2`. Ubuntu 24.04, x86_64, 6.7GB RAM
- **App location pattern:** `/opt/<appname>/`
- **Shared infra:** `/opt/shared-infra/` runs Postgres 17 + Redis. Networks `shared-db` (alias `postgresql`) and `shared-redis` (alias `redis`)
- **MinIO container:** `dinner-club-minio-1`, exposes API on port 9002 (host), console NOT exposed (use `mc` via `docker exec`)
- **LC2** (`192.168.40.11`) runs nginx + cloudflared. Terminates TLS via Cloudflare Origin CA cert
- **Vault:** `https://vault.wispy-nook.casa`. `vault` CLI is on LC3 (Pi-hole host). Periodic 30-day tokens stored at `/opt/<app>/vault-token`
- **GitHub Actions:** self-hosted runners registered per app at `/opt/actions-runner-<appname>/`
- **Authentik:** `https://authentik.wispy-nook.casa`. Existing groups `two-cents-users`, `two-cents-admins`. v1 OIDC app slug is `two-cents`; v2 will use new slug `two-cents-v2`

---

## Plan execution approach

**Recommended:** `superpowers:subagent-driven-development`. Dispatch a fresh subagent per task or small batch. Review results before next dispatch.

**Phase priority if scope-cut needed:**

1. **Phases 0–3** (bootstrap, domain, fastify skeleton, auth) — required foundation
2. **Phase 4** (requests API) — largest single phase, contains most behavior
3. **Phases 5–8** (appeals, notifications, household/feedback, workers) — backend complete
4. **Phase 9** (web bootstrap)
5. **Phases 10–13** (web flows, polish parity)
6. **Phases 14–15** (deploy + cutover)

**Estimated total:** 5–7 days of dispatched work + review time.

### Per-task discipline

- TDD-rigid for `state.ts`, `delays.ts`, `resolution.ts`, `jwt.ts` (these are the load-bearing pure-logic modules)
- Test-after for views/UI work, only when it adds value
- Commit per logical task with descriptive messages (use `feat(api):` / `feat(web):` / `fix(...)` / `chore(...)` / `docs(...)` prefixes)
- Don't push during phase-internal work; push at phase boundaries
- After each phase, run full test suite + ruff/lint checks before pushing

---

## Carried punch list

These were left from v1 development; consider whether to address in v2 or carry forward:

- **Form-submit UX feedback** ([v1 issue #14](https://github.com/Zaphiruz/two-cents/issues/14)) — broader pattern; bake into v2 from start (loading states, success toasts, optimistic updates)
- **Coverage gate** — v1 CI uses `--cov-fail-under=0`. v2 should set a real floor (70%+) once Phase 1 lands
- **GPG/SSH commit signing** — config issue on user's side; commits in this session land unsigned. Not a code problem
- **iOS install hint detection** — was based on `navigator.standalone`; verify it still triggers correctly on iOS 18+

---

## What was just done in this session (summary)

A condensed timeline so the new session has context:

1. v1 was running well. Real users (Jacob + Glad + Luke) had filed real bugs/requests via the in-app feedback form
2. Closed v1 issues #1–#9 (login redirect, money format, share-target, delay UI, feedback flow, comment ordering)
3. Implemented multi-item refactor in v1 (RequestItem model + data migration, multi-item form, item-aware events)
4. Added admin nav link
5. Discussed React/Node rewrite — user wanted Fastify (not Next.js), cold cutover, fresh repo, parity scope
6. Created `two-cents-v2` repo on GitHub, scaffolded directory at `d:/code/two-cents-v2/`, copied v1's spec + design doc
7. Wrote the 16-phase implementation plan and pushed
8. Wrote this handoff doc

Phase 0 work hasn't started yet. The next session picks up there.

---

## Don't do

- Don't modify v1 (`d:/code/two-cents/`) unless explicitly asked
- Don't touch `commit.gpgsign` config — work around it with `-c commit.gpgsign=false`
- Don't paste secrets into the chat — even fresh keys end up in transcripts
- Don't run destructive commands on S2 without confirming with the user (especially anything touching `/opt/two-cents/` or its database — that's the live production app until cutover)
- Don't push via SSH (`git@github.com:...`) without testing — the agent is often unreachable. Use the gh-token HTTPS pattern documented above
- Don't burn context reading every v1 file. Read what the current task requires.
