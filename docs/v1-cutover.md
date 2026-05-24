# Two Cents v2 — drop-in cutover from v1

Adjusts the original Phase 14/15 plan to fully replace v1 in place: same hostname,
same Authentik OIDC app, same data. Tailored to the existing wispy-nook.casa
infrastructure (see `D:\docs\MikroTik\CLAUDE.md`).

## What's reused vs. created new

| Thing | Decision | Why |
|---|---|---|
| **Hostname** `two-cents.wispy-nook.casa` | reuse | already configured in Cloudflare Tunnel + nginx + Origin CA cert |
| **Authentik OIDC app** (`two-cents` slug) | **reuse**, just add v2's redirect URI | users keep logging in with the same accounts; no group changes |
| **Groups** `two-cents-users` / `two-cents-admins` | reuse | already bound to the application |
| **VAPID keys** | reuse v1's | same domain — existing push subscriptions keep working until users re-register |
| **GitHub feedback token** | reuse v1's PAT (re-scope to v2 repo if needed) | one token covers both repos |
| **Postgres DB user** | **new** `two_cents_v2` on shared-infra | scoped per-app per project policy |
| **Postgres DB name** | **new** `two_cents_v2` | keeps `two_cents` DB intact as rollback target |
| **MinIO bucket** | reuse v1's `two-cents-images` | `image_key` values migrate verbatim; no byte copy needed |
| **Redis logical DB** | new index `/2` | avoid BullMQ key collisions with v1's RQ keys |
| **Vault path** | `secret/data/two-cents-v2` (new) | v1's `secret/data/two-cents` keeps working until cutover; clean rollback |
| **Self-hosted runner** | **new** `/opt/actions-runner-two-cents-v2/` for `Zaphiruz/two-cents-v2` | v1's runner stays put for emergency v1 redeploy |
| **App directory on S2** | **new** `/opt/two-cents-v2/` | v1's `/opt/two-cents/` untouched |
| **Ports during parallel-run** | v2 picks unused ports (e.g. web 3007, api 4001) | v1 keeps 3005 until cutover |
| **Ports after cutover** | v2 web → 3005, v2 api → 4000 (or keep Caddy-only pattern) | nginx flip is a one-line edit |

## Recommended container layout

Two options:

### A. Caddy-frontends-everything (matches Dinner Club / Velvet Scoop)
Single host port. Caddy (in the web container) serves static SPA and reverse-proxies
`/api/*` to the backend internally. Cleaner because nginx on LC2 only proxies one
host port; no need for the api container to be exposed at all.

```
nginx (LC2) → :3005 → web Caddy → /api/* → backend Fastify (internal)
                                  /*      → static SPA
```

### B. Two-port split (what the original plan said)
Web on :3005, api on :4000, nginx routes `/api/*` to :4000. Matches the
plan literally but requires two nginx upstream blocks.

Recommendation: **A**, to match existing patterns.

## Step-by-step cutover

Numbered for execution order. Assumes everything in `D:\docs\MikroTik\CLAUDE.md`
section "Adding a new app (full checklist)" applies.

### 1. Pre-flight on S2
```bash
# Verify shared networks
docker network inspect shared-db shared-redis >/dev/null && echo ok

# Cloudflare Origin CA cert already at /usr/local/share/ca-certificates/cloudflare-origin-ca.crt
ls /usr/local/share/ca-certificates/cloudflare-origin-ca.crt
```

### 2. Create the v2 Postgres user + DB
```bash
docker exec shared-infra-postgresql-1 psql -U postgres -c "
  CREATE USER two_cents_v2 WITH PASSWORD 'STRONGPW';
  CREATE DATABASE two_cents_v2 OWNER two_cents_v2 TEMPLATE template0;
  GRANT CONNECT ON DATABASE two_cents_v2 TO two_cents_v2;"
docker exec shared-infra-postgresql-1 psql -U postgres -d two_cents_v2 -c "
  GRANT ALL PRIVILEGES ON SCHEMA public TO two_cents_v2;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO two_cents_v2;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO two_cents_v2;"
# Also grant the migration script the read permission on v1
docker exec shared-infra-postgresql-1 psql -U postgres -d two_cents -c "
  GRANT CONNECT ON DATABASE two_cents TO two_cents_v2;
  GRANT USAGE ON SCHEMA public TO two_cents_v2;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO two_cents_v2;"
```

### 3. Vault: write v2 secrets + create periodic token
```bash
# On LC3, as root (Vault must be unsealed)
vault policy write two-cents-v2 - <<'EOF'
path "secret/data/two-cents-v2" { capabilities = ["read"] }
EOF

vault kv put secret/two-cents-v2 \
  NODE_ENV=production \
  DATABASE_URL="postgresql://two_cents_v2:STRONGPW@postgresql:5432/two_cents_v2" \
  REDIS_URL="redis://redis:6379/2" \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  OIDC_ISSUER="https://authentik.wispy-nook.casa/application/o/two-cents/" \
  OIDC_CLIENT_ID="<copy v1's client id from Authentik>" \
  OIDC_CLIENT_SECRET="<copy v1's client secret from Vault secret/two-cents>" \
  OIDC_REDIRECT_URI="https://two-cents.wispy-nook.casa/api/auth/callback" \
  MINIO_ENDPOINT="http://192.168.40.20:9002" \
  MINIO_ACCESS_KEY="<reuse or new>" \
  MINIO_SECRET_KEY="<reuse or new>" \
  MINIO_BUCKET="two-cents-images" \
  VAPID_PUBLIC_KEY="<copy from secret/two-cents>" \
  VAPID_PRIVATE_KEY="<copy from secret/two-cents>" \
  VAPID_CLAIM_EMAIL="jacobthomas428@gmail.com" \
  GITHUB_FEEDBACK_TOKEN="<copy or rotate>" \
  GITHUB_FEEDBACK_REPO="Zaphiruz/two-cents-v2" \
  COOKIE_DOMAIN="two-cents.wispy-nook.casa" \
  ALLOWED_HOSTS="two-cents.wispy-nook.casa"

bash /opt/vault/add-app-token.sh two-cents-v2 two-cents-v2
# Copy printed token:
ssh S2 'mkdir -p /opt/two-cents-v2 && echo TOKEN > /opt/two-cents-v2/vault-token && chmod 400 /opt/two-cents-v2/vault-token'
```

**Note**: `OIDC_ISSUER` stays as the v1 slug `/two-cents/` (NOT `/two-cents-v2/`)
because we're reusing the v1 Authentik app. Add v2's callback to that app:

### 4. Authentik: add v2's redirect URI to the existing app
In the Authentik admin UI for the `two-cents` provider:
- **Redirect URIs**: add `https://two-cents.wispy-nook.casa/api/auth/callback` as a
  new line (keep the v1 callback for now in case of rollback)
- No other changes. Same client ID/secret. Groups untouched.

### 5. Register the GitHub Actions runner for the v2 repo
```bash
ssh S2
sudo -u runner mkdir -p /opt/actions-runner-two-cents-v2
cd /opt/actions-runner-two-cents-v2
# Download runner v2.333.1, extract
# Get a fresh registration token from https://github.com/Zaphiruz/two-cents-v2/settings/actions/runners/new
sudo -u runner ./config.sh --url https://github.com/Zaphiruz/two-cents-v2 \
  --token <TOKEN> --labels s2 --name s2-two-cents-v2 --unattended
sudo ./svc.sh install runner
sudo ./svc.sh start
```

### 6. Deploy v2 on parallel ports (no traffic yet)
```bash
ssh S2
sudo -u runner mkdir -p /opt/two-cents-v2
sudo -u runner git clone git@github.com:Zaphiruz/two-cents-v2.git /opt/two-cents-v2
cd /opt/two-cents-v2
# Edit compose.yaml to expose web on :3007 (parallel to v1's :3005)
bash fetch-secrets.sh   # writes /opt/two-cents-v2/.env from Vault
docker compose build
docker compose up -d --remove-orphans
docker compose run --rm migrate   # prisma migrate deploy on the new DB
```

### 7. Run the v1 → v2 data migration
```bash
# Read v1's DB password (it's stored in Vault under secret/two-cents)
V1_PW=$(vault kv get -field=DATABASE_URL secret/two-cents | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')

docker exec -i shared-infra-postgresql-1 psql -U two_cents_v2 -d two_cents_v2 \
  -v v1_conn="dbname=two_cents host=postgresql port=5432 user=two_cents_v2 password=" \
  < /opt/two-cents-v2/apps/api/scripts/migrate-from-v1.sql
```
(Note: the `two_cents_v2` user inherits read on v1 from step 2. No password needed
because Postgres recognizes local socket connections as trusted by default within
the container — adjust if your `pg_hba.conf` is stricter.)

If anything fails, the script is wrapped in a single transaction; nothing
commits. Re-run after fixing.

### 8. Smoke test v2 on :3007 from inside S2
```bash
curl -fsS http://localhost:3007/health   # web container health
curl -fsS http://localhost:3007/api/auth/me   # should 401 (no session)
docker compose logs --tail=50 api worker
```

### 9. Cutover (the only step with downtime — ~30 sec)
```bash
# Stop v1
cd /opt/two-cents && docker compose down

# Reconfigure v2 to claim :3005
cd /opt/two-cents-v2
sed -i 's|"3007:8080"|"3005:8080"|' compose.yaml
# (also update api port to :4000 if you took option B)
docker compose up -d

# (No nginx change needed — LC2 already points at :3005.)
```

If you took **option B** (two-port split), also update LC2's nginx server block
to add an `/api/*` upstream for `:4000`, then `nginx -t && systemctl reload nginx`.

### 10. Verify in browser
- `https://two-cents.wispy-nook.casa` loads as your normal Authentik user
- Queue shows pre-existing requests
- Comments thread on an old request renders
- File a new comment → succeeds
- Submit feedback → creates GitHub issue in `Zaphiruz/two-cents-v2`

### 11. Keep v1 dormant for a few days
v1 container stopped, DB still present. If anything breaks, revert by:
1. `cd /opt/two-cents-v2 && sed -i 's|"3005:8080"|"3007:8080"|' compose.yaml && docker compose up -d`
2. `cd /opt/two-cents && docker compose up -d`

After ~1 week without issues, retire v1 per Phase 15.5.

## Rollback safety net

Because v1 stays running (read-only — no new writes) right up to step 9, you can
abort at any point before that and v1 keeps serving production. The data migration
copies *from* v1 to v2 without modifying v1.

## Things the original Phase 14 plan said that change with this strategy

- **New Authentik app `two-cents-v2`** → not needed; reuse `two-cents`
- **`OIDC_ISSUER` slug** `/two-cents-v2/` → use `/two-cents/`
- **MinIO bucket `two-cents-v2-images`** → use existing `two-cents-images`
- **"Truncate-and-restart" cutover** → replaced by `migrate-from-v1.sql`
- **`GITHUB_FEEDBACK_REPO`** = `Zaphiruz/two-cents-v2` (new) — old issues stay on v1's repo, that's fine
