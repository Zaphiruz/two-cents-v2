# Two Cents v2

TypeScript rewrite of [Two Cents](https://github.com/Zaphiruz/two-cents). Fastify API + Vite/React SPA + Prisma + BullMQ.

**Status:** live in production at `https://two-cents.wispy-nook.casa` since 2026-05-24. v1 fully wiped post-cutover; only the old GitHub repo remains as an archive. Auto-deploys on push to `main` via GitHub Actions → self-hosted runner on S2.

**Admin page:** `/admin/*` is available to users in the Authentik group `two-cents-admins`. Five sections: People, Households, Appeals, Feedback (links to GitHub issues), Audit Search (cross-model text search). See [docs/superpowers/specs/2026-05-24-admin-page-design.md](docs/superpowers/specs/2026-05-24-admin-page-design.md).

- Product spec: [docs/purchase-request-app-spec.md](docs/purchase-request-app-spec.md)
- v1 design (reference): [docs/superpowers/specs/2026-04-28-two-cents-design.md](docs/superpowers/specs/2026-04-28-two-cents-design.md)
- Rewrite plan (Phases 0-13): [docs/superpowers/plans/2026-05-03-two-cents-v2.md](docs/superpowers/plans/2026-05-03-two-cents-v2.md)
- Admin page plans: [PR 1](docs/superpowers/plans/2026-05-24-admin-page-pr1.md) · [PR 2](docs/superpowers/plans/2026-05-24-admin-page-pr2.md)
- Drop-in cutover from v1 (historical): [docs/v1-cutover.md](docs/v1-cutover.md)

## Local development

```bash
# 1. Bring up Postgres + Redis test containers
docker start two-cents-v2-test-pg two-cents-v2-test-redis  # or run them fresh

# 2. Migrate + seed
export DATABASE_URL=postgresql://two_cents_v2:two_cents_v2@localhost:5435/two_cents_v2
pnpm --filter @two-cents/api exec prisma migrate deploy
pnpm --filter @two-cents/api seed

# 3. Run api (terminal 1)
export REDIS_URL=redis://localhost:6390/0
export SESSION_SECRET=dev_session_secret_at_least_32_bytes_long_for_iron_session
pnpm --filter @two-cents/api dev

# 4. Run web (terminal 2)
pnpm --filter @two-cents/web dev

# 5. Log in via http://localhost:5173/api/auth/dev-login (admin / admin)
```

The seed creates a "Dev Household" with three members: **admin** (admin), **Bob**, **Carol**. The dev-login route is gated on `NODE_ENV !== 'production'`.

## Production deploy (S2)

Deploys are automatic on push to `main`. The bootstrap below ran on 2026-05-24 and is kept here for disaster recovery / re-provisioning. See [docs/v1-cutover.md](docs/v1-cutover.md) for the full historical drop-in replacement steps.

Bootstrap checklist (one-time, already done):

1. **Postgres** (S2): create user + DB on shared-infra
   ```bash
   docker exec shared-infra-postgresql-1 psql -U postgres -c "
     CREATE USER two_cents_v2 WITH PASSWORD 'STRONGPW';
     CREATE DATABASE two_cents_v2 OWNER two_cents_v2 TEMPLATE template0;"
   ```
2. **Vault** (LC3): write policy + secrets + periodic token
   ```bash
   vault policy write two-cents-v2 - <<'EOF'
   path "secret/data/two-cents-v2" { capabilities = ["read"] }
   EOF
   vault kv put secret/two-cents-v2  ...   # see docs/v1-cutover.md step 3
   bash /opt/vault/add-app-token.sh two-cents-v2 two-cents-v2
   ```
3. **Authentik**: add `https://two-cents.wispy-nook.casa/api/auth/callback` to the existing `two-cents` OIDC application's Redirect URIs (we reuse v1's app — same client id/secret).
4. **GitHub Actions runner** (S2): register at `/opt/actions-runner-two-cents-v2/` for `Zaphiruz/two-cents-v2` with label `s2`.
5. **App directory** (S2): `git clone … /opt/two-cents-v2`, drop the Vault token at `/opt/two-cents-v2/vault-token` (chmod 400, owned by `runner`).
6. **First deploy**: push to main → `.github/workflows/deploy.yml` runs.
7. **Data migration**: run `apps/api/scripts/migrate-from-v1.sql` once after migrate-deploy to copy v1's data in.
8. **nginx cutover** (LC2): once v2 is healthy on its parallel port, edit v2's `compose.prod.yml` to expose on the same port v1 used (3005), then stop v1.

## Tests

```bash
# API (requires Postgres + Redis test containers)
DATABASE_URL=postgresql://two_cents_v2:two_cents_v2@localhost:5435/two_cents_v2 \
  REDIS_URL=redis://localhost:6390/0 \
  pnpm --filter @two-cents/api test

# Web
pnpm --filter @two-cents/web test

# Shared
pnpm --filter @two-cents/shared test
```

Total at HEAD: 319 api + 95 web + 79 shared.
