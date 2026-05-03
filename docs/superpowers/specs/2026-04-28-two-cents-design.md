# Two Cents — Implementation Design

> **Companion to:** [`docs/purchase-request-app-spec.md`](../../purchase-request-app-spec.md)
> The product spec defines *what* Two Cents is. This document defines *how* it gets built and deployed on the user's homelab (S2). Open questions and product decisions belong in the spec; technical choices, architecture, and deployment specifics belong here.

## Goal

Ship Two Cents as a Django-based PWA on S2, integrated with the existing shared-infra (PostgreSQL, Redis), MinIO, Authentik, Vault, and the LC2 nginx + Cloudflare Tunnel pattern used by Mealie / Dinner Club / Rift Trader.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | Django 5 (LTS), Python 3.13 | Admin gives household/member/approver-config screens for free |
| API style | Server-rendered + HTMX; thin JSON endpoints only where service workers / push quick-actions need them | Avoids a separate SPA build pipeline |
| Frontend interactivity | HTMX + Alpine.js for tiny client state | |
| CSS | Tailwind, built into `static/css/dist/` at image-build time | |
| ORM / migrations | Django built-in | |
| Auth | `mozilla-django-oidc` against Authentik | New Confidential client, groups `two-cents-users` (and optionally `two-cents-admins`) |
| Image storage | `django-storages` + boto3 → existing S2 MinIO (port 9002), new bucket `two-cents-images` | Server-side image fetch on submission; do not hotlink retailer URLs |
| Web Push | `pywebpush` + VAPID keys | |
| Task queue | `django-rq` (Redis broker, using existing `shared-redis` on S2) | Choice driven by Redis already being available; switching from initial django-q2 plan |
| Tests | `pytest-django` + `factory_boy` + `freezegun` (time-based logic) + Playwright (e2e) | |
| Lint / format | `ruff` (lint + format) | |
| Type-check | `mypy`, focused on `apps/requests_app/state.py` and `apps/notifications/jwt.py` | These are where types catch real bugs |
| Secrets | Vault at `https://vault.wispy-nook.casa`, path `secret/data/two-cents`, fetched at deploy time into ephemeral `.env` | Matches Mealie/Dinner Club pattern |
| Reverse proxy | LC2 nginx → S2:3005 | No Caddy on host; Cloudflare Tunnel handles public TLS |
| CI | GitHub Actions: lint, test, build image. Self-hosted runner on S2 deploys on push to `main` | Matches Dinner Club / Rift Trader pattern |

## Architecture

```
Cloudflare Tunnel  →  LC2 nginx (two-cents.wispy-nook.casa)
                       │
                       ▼
S2 ┌────────────────────────────────────────────────────────────┐
   │ /opt/two-cents/  (docker compose)                          │
   │  ┌────────────┐  ┌──────────┐  ┌────────────┐              │
   │  │ web        │  │ worker   │  │ scheduler  │              │
   │  │ gunicorn   │  │ rq       │  │ rqscheduler│              │
   │  └─────┬──────┘  └────┬─────┘  └─────┬──────┘              │
   │        │              │              │                     │
   │  shared-db ───────────┴──────────────┘                     │
   │  shared-redis ────────────────────────                     │
   │                                                            │
   └─ external networks ──────► S2:9002 (MinIO, existing)       │
                                authentik.wispy-nook.casa       │
                                vault.wispy-nook.casa           │
```

- **One image, three containers**: same Docker image runs `gunicorn` (web), `rqworker` (worker), and `rqscheduler` (scheduler). One image to build, three `command:` overrides.
- **Service worker** lives at `/sw.js`, served by Django, same-origin so it can register at root scope.
- **Web Share Target** registered in `manifest.json` as `share_target` → `/share-target/` (Django view that pre-fills the new-request form). Android only — iOS Safari does not support Web Share Target.
- **Quick-action URLs** at `/qa/<jwt>/` are JWT-signed, single-use, replay-protected via a `consumed_jwt_jtis` table.
- **Push send is async**: `transition()` and views call `notifications.services.notify(...)` which enqueues per-subscription `send_push_task` jobs. Failures don't block user requests.

## Repo Structure

```
two-cents/
├── docs/
│   ├── purchase-request-app-spec.md          # product spec (moved from root)
│   └── superpowers/
│       ├── specs/2026-04-28-two-cents-design.md   # this file
│       └── plans/2026-04-28-two-cents.md          # impl plan (next)
├── compose.yaml
├── compose.prod.yaml                          # S2 production overlay
├── Dockerfile                                 # multi-stage: tailwind build → python:3.13-slim
├── nginx-two-cents.example.conf               # snippet for LC2
├── fetch-secrets.sh                           # Vault → .env, mirrors Mealie pattern
├── .env.example
├── pyproject.toml                             # uv
├── manage.py
├── conftest.py
├── pytest.ini
├── config/
│   ├── settings/{base,dev,prod}.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── apps/
│   ├── accounts/                              # users, OIDC, is_admin
│   ├── households/                            # household, members, buyer_approvers, pending_memberships
│   ├── requests_app/                          # state machine, requests, listing_versions, reviews, comments
│   ├── appeals/                               # appeals + quota accounting
│   ├── notifications/                         # push subscriptions, prefs, send tasks, sw.js, JWTs, /qa/
│   ├── feedback/                              # GitHub issue creation
│   ├── pwa/                                   # manifest.json, share-target view, iOS install hints
│   └── core/                                  # shared base models, JWT helper, OG-tag scraper, image fetcher
├── templates/                                 # base, _components, requests, appeals, pwa
├── static/                                    # tailwind input, alpine sprinkles, sw bootstrap, icons
├── tasks/
│   └── schedule.py                            # rq-scheduler registrations
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/                                   # playwright critical paths
```

**Decomposition rationale:**

- `requests_app` owns the state machine — the trickiest, most-tested code in the project. Isolated so lifecycle logic doesn't bleed into views.
- `households` is its own app because the buyer→approver mapping + pending memberships are a coherent unit, distinct from "what's a user."
- `notifications` holds *both* push delivery and the signed-JWT quick-action endpoints because they're tightly coupled.
- `pwa` is a thin app — manifest, service worker, share-target, install hints — kept separate so PWA-specific concerns don't pollute other apps.
- `core` is for genuinely shared utilities only — base models, JWT helper, URL/OG-tag scraper, image fetcher. Keep it small.

**Conventions:**

- Each app: `models.py`, `views.py`, `urls.py`, `services.py` (business logic), `tasks.py` (rq callables), `tests/`.
- The state machine lives in `apps/requests_app/state.py` as a single function `transition(req, action, actor=None, **kwargs) -> Request`. Views call it; tasks call it; tests cover it directly.
- Domain logic in `services.py` — views stay thin, mostly orchestrating form → service → response.

## Request State Machine

States (from spec `requests.status` enum):

```
pending → approved | delayed | denied | cancelled
delayed → awaiting_reconfirm | cancelled
awaiting_reconfirm → pending | cancelled | archived
approved → purchased | archived | cancelled
denied → pending (via appeal) | archived
cancelled, archived, purchased = terminal
```

**`apps/requests_app/state.py`:**

```python
ALLOWED = {
    ('pending',  'approve'):  'approved',
    ('pending',  'delay'):    'delayed',
    ('pending',  'deny'):     'denied',
    ('pending',  'cancel'):   'cancelled',
    ('delayed',  'cancel'):   'cancelled',
    ('delayed',  'expire'):   'awaiting_reconfirm',
    ('delayed',  'edit_meaningful'): 'pending',
    ('awaiting_reconfirm', 'reconfirm'): 'pending',
    ('awaiting_reconfirm', 'timeout'):   'archived',
    ('awaiting_reconfirm', 'cancel'):    'cancelled',
    ('approved', 'purchase'): 'purchased',
    ('approved', 'expire'):   'archived',
    ('approved', 'cancel'):   'cancelled',
    ('denied',   'appeal_overturned'): 'pending',
    ('denied',   'archive'):  'archived',
}

def transition(req, action, actor=None, **kwargs) -> Request:
    """Single source of truth for state changes. Raises IllegalTransition if not allowed.
    Writes a Review row, schedules timers, fires notifications."""
```

**`all`-mode resolution** is a separate function that runs after each Review row is written:

- All required approvers reviewed → resolve. Any deny → `denied`. Any delay (no denies) → `delayed` with longest delay duration. All approve → `approved`.
- Otherwise → stay `pending`.

**Edits and cooldown reset:**

- `listing_versions` row created on every save where `price_cents` or `url` changes.
- If request is in `pending` / `delayed` / `awaiting_reconfirm`, a meaningful edit triggers `transition('edit_meaningful')` → back to `pending`, all open delay rows superseded.
- Trivial edits (title/description) do not create a new `listing_version` and do not transition.

## Notifications, PWA, and Quick Actions

```
Browser (PWA)
  manifest.json + sw.js
  ↳ user grants Notification permission
  ↳ browser issues PushSubscription
  ↳ POST /push/subscribe/  {endpoint, p256dh, auth}

Django (apps/notifications/)
  models.py     PushSubscription, NotificationPref
  services.py   notify(user, event, payload)
                  ↳ check prefs + quiet hours
                  ↳ render title/body/url/actions
                  ↳ enqueue send_push_task per subscription
  tasks.py      send_push_task → pywebpush; on 410 Gone → delete subscription
  jwt.py        sign / verify quick-action tokens
  views.py      /push/subscribe/, /qa/<jwt>/

Push services (FCM / Mozilla / APNs)
```

**Push payload (server side):**

```python
{
  "title": "New request: $89 Keychron K2",
  "body": "Sarah rated: really want",
  "url": "/requests/abc123/",
  "actions": [
    {"action": "approve", "title": "Approve"},
    {"action": "delay",   "title": "Delay"}
  ],
  "tokens": {"approve": "<JWT>", "delay": "<JWT>"}
}
```

**Service worker (`static/js/sw.js`):**

- `push` event → `showNotification(title, {body, data: {url, tokens}, actions})`
- `notificationclick`:
  - `event.action === 'approve' | 'delay'` → `fetch('/qa/' + tokens[action] + '/', {method: 'POST'})`, optionally focus/open the PWA
  - No action (plain tap) → `clients.openWindow(data.url)`

**Quick-action JWT (`apps/notifications/jwt.py`):**

- Claims: `{request_id, action, approver_id, jti, exp}`
- HS256, signed with `DJANGO_SECRET_KEY`-derived key
- `exp = now + 12h` (matches the tightest delay window)
- `jti` stored in `consumed_jwt_jtis` table on first use; replays return 409
- `/qa/<jwt>/` POST → validate → check not consumed → mark consumed → call `transition()` with auto-defaults (approver_seriousness = buyer_seriousness for approve; auto-calculated cooldown for delay) → 204

**Notification triggers (called from inside `transition()` and views):**

| Event | Recipients | Default |
|---|---|---|
| New pending request | All approvers for that buyer | on |
| Approval / Delay / Denial | Buyer | on |
| Comment | Other request participants | on |
| Cooldown expired (`awaiting_reconfirm`) | Buyer | on |
| Approval expiring in 3 days | Buyer | on |
| Stale pending (day 3, day 7) | Approver(s) | on |
| Need-rated pending (6h, 24h) | Approver(s) | on |
| Appeal filed | Approver(s) | on |
| Appeal resolved | Buyer | on |
| Echo of own action | Self | off |

Quiet hours respected for everything except need-rated reminders (time-pressure).

**iOS path** (per project memory: future iPhone user):

- Same Web Push code path; iOS Safari ignores `actions` — single-tap-opens-app is the flow.
- First-run on iOS: detect `navigator.standalone === false && /iPad|iPhone/.test(ua)` → show install instructions modal (`pwa/install_ios.html`).
- Web Share Target unsupported on iOS — onboarding documents an iOS Shortcut path; manual paste remains first-class.

## Background Jobs

**Event-triggered tasks** (enqueued from views / `transition()`):

- `send_push_task(subscription_id, payload)` — pywebpush call; tolerant of 410/404 (deletes sub).
- `fetch_url_metadata_task(request_id)` — OG-tag scrape; best-effort.
- `fetch_and_store_image_task(request_id, image_url)` — server-side download into MinIO.

**Scheduled tasks (`tasks/schedule.py`, registered with rq-scheduler):**

| Task | Cadence | Behavior |
|---|---|---|
| `expire_cooldowns` | every 10 min | `delayed` where `delay_expires_at < now` → `transition('expire')` → notify buyer |
| `expire_reconfirms` | every 1 hour | `awaiting_reconfirm` where `reconfirm_deadline < now` → `transition('timeout')` (silent archive) |
| `expire_approvals` | every 1 hour | `approved` where `status_expires_at < now` → `transition('expire')` (silent archive) |
| `approval_expiring_warnings` | daily 09:00 local | `approved` items expiring in 3 days → notify buyer (idempotent via `warned_at`) |
| `stale_pending_reminders` | every 1 hour | Day-3 + day-7 + day-14 pending reminders; "stale" badge auto-flips at day 14 (computed) |
| `need_rated_reminders` | every 30 min | `pending`, buyer rating = `need`, age 6h or 24h → approver reminder once per threshold |

**Idempotency:** small `notification_log` table `(user_id, event_key, request_id, sent_at)`, `event_key` like `"stale_day_3:req_abc"`, `INSERT … ON CONFLICT DO NOTHING`. Cooldown / approval / reconfirm expirations are idempotent because `transition('expire')` from a non-`delayed` state raises and is caught.

**Failure handling:** rq's built-in retry, default 3 retries for push delivery; scheduled tasks are idempotent so re-running on next tick is fine. Failed tasks remain in rq's failed queue. Weekly cleanup job trims rows older than 30 days. No alerting in v1; eyeballing rq dashboards is sufficient at 2-5 users.

## Testing Strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | pytest-django | `services.py`, `state.py`. Parametrized table-driven tests for every legal and illegal `(state, action)` pair. ~80% of test ROI lives here. |
| Integration | pytest-django + factory_boy + freezegun | Full request lifecycles end-to-end through ORM and services |
| View | pytest-django Client | HTMX views render right partials, redirects, permission checks. Don't snapshot HTML. |
| JWT / quick actions | dedicated module | Sign, verify, expire, replay-detection |
| Push | mock pywebpush | `notify()` respects prefs, quiet hours, dedup; 410 deletes the sub |
| E2E | Playwright | 4-5 critical flows: submit→approve→purchase, submit→delay→reconfirm→approve, submit→deny→appeal→overturn, iOS install instructions, share-target pre-fill |
| Coverage | pytest-cov | 80% on `apps/requests_app/`, 70% overall — hard floor in CI |

**Not tested:** Django admin, Tailwind output, browser's Web Push delivery path (mocked at pywebpush boundary), pywebpush itself.

**TDD posture:** state machine and JWT written test-first (rigid). Views and templates written test-after when helpful, skipped when they don't add value (flexible).

## Deployment

**Target:** S2 (`192.168.40.20`), `/opt/two-cents/`. Public URL: `https://two-cents.wispy-nook.casa`.

**Shared infrastructure reused:**

| Service | Connection | Config |
|---|---|---|
| PostgreSQL | `shared-db` external network, host `postgresql` | DB `two_cents`, user `two_cents` (separate from `postgres` superuser) |
| Redis | `shared-redis` external network, host `redis` | django-rq broker |
| MinIO | S2 port 9002 (existing) | New bucket `two-cents-images`, scoped IAM user. Public hostname `https://media.two-cents.wispy-nook.casa` if presigned URLs end up needed; v1 serves through app. |
| Authentik | `https://authentik.wispy-nook.casa` | New Confidential OIDC client, group `two-cents-users` (optionally `two-cents-admins`) |
| Vault | `https://vault.wispy-nook.casa` | Secrets at `secret/data/two-cents`. 30-day periodic token in `/opt/two-cents/vault-token` (chmod 400). |

**Compose file (`/opt/two-cents/docker-compose.yml`):**

```yaml
x-app-base: &app-base
  image: two-cents:latest
  env_file: .env
  environment: &app-env
    VAULT_ADDR: https://vault.wispy-nook.casa
    SSL_CERT_FILE: /etc/ssl/certs/cloudflare-origin.pem
  volumes: &app-volumes
    - ./vault-token:/run/secrets/vault-token:ro
    - /opt/shared-infra/cloudflare-origin.pem:/etc/ssl/certs/cloudflare-origin.pem:ro
  restart: unless-stopped

services:
  web:
    <<: *app-base
    command: gunicorn config.wsgi --bind 0.0.0.0:8000
    networks: [shared-db, shared-redis, default]
    ports: ["3005:8000"]

  worker:
    <<: *app-base
    command: python manage.py rqworker default scheduled
    networks: [shared-db, shared-redis]

  scheduler:
    <<: *app-base
    command: python manage.py rqscheduler
    networks: [shared-db, shared-redis]

networks:
  shared-db:    { external: true }
  shared-redis: { external: true }
```

**Vault secrets (`secret/data/two-cents`):** `DATABASE_URL`, `REDIS_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_SERVER_URL`, `AUTHENTIK_ISSUER`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `DJANGO_SECRET_KEY`, `GITHUB_FEEDBACK_TOKEN`, `GITHUB_FEEDBACK_REPO`.

**Reverse proxy (LC2 nginx):** add `two-cents.wispy-nook.casa → 192.168.40.20:3005`. Cloudflare Tunnel hostname added at the same time. Wildcard `*.wispy-nook.casa` Origin CA cert already covers it.

**Deploy via GitHub Actions self-hosted runner on S2** (mirrors Dinner Club / Rift Trader):

1. Push to `main`
2. Runner pulls
3. `bash fetch-secrets.sh` (Vault → ephemeral `.env`)
4. `docker compose build`
5. `docker compose up -d`
6. `docker compose exec web python manage.py migrate --noinput`
7. `docker compose exec web python manage.py collectstatic --noinput`

**Bootstrapping (one-time, manual):**

1. `docker network ls` — confirm `shared-db` and `shared-redis` exist.
2. Create DB and user in shared PostgreSQL: `docker exec -it <pg-container> psql -U postgres` → `CREATE DATABASE two_cents; CREATE USER two_cents WITH PASSWORD '...'; GRANT ALL ON DATABASE two_cents TO two_cents;`
3. Vault: store secrets at `secret/data/two-cents`, generate periodic token, save to `/opt/two-cents/vault-token`.
4. Authentik admin UI: create OIDC application + provider; create `two-cents-users` group; capture `client_id`/`client_secret` into Vault.
5. MinIO admin: create `two-cents-images` bucket + scoped service account; capture keys into Vault.
6. Add nginx site on LC2 + add Cloudflare Tunnel hostname.
7. `git clone` to `/opt/two-cents/`, register GitHub Actions runner.
8. Push to `main` → first deploy.
9. Post-deploy: `docker compose exec web python manage.py createsuperuser`, log in via OIDC once to populate `users.oidc_subject`, set `is_admin=True`, create the household, add members.

**Operational notes:**

- **Backups:** Postgres backups handled by existing shared-infra backup pattern. MinIO bucket lives wherever existing MinIO replication/backup goes. App carries no other state.
- **Logs:** stdout/stderr → Docker; `docker compose logs -f` is the operational interface for v1.
- **Health check:** `GET /healthz/` (DB ping + MinIO HEAD on bucket); compose `healthcheck:` keys hit it.

## iOS Considerations

(Carried from spec, repeated here so implementation has them inline.)

- iOS Safari ignores Web Push `actions` array — lock-screen quick actions are Android-only. iOS user taps notification → PWA opens → acts inside app.
- iOS only delivers Web Push to PWAs added to the home screen. First-run UX must include install instructions for iOS.
- Web Share Target unsupported on iOS Safari — document an iOS Shortcut path; manual paste must remain first-class.
- ntfy reserved as a possible secondary channel if iOS action-button parity becomes important later.

## Phase 2 (Deferred — already in spec)

- Audit log timeline UI (existing `reviews` table).
- Spending dashboards (per-household, per-buyer).
- Both are UI-only over data captured from day one.
