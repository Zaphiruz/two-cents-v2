// Container entrypoint: fetches secrets from Vault, then execs the target
// Node script (passed as the first CLI arg, relative to /app).
//
// Used for both the api and worker services — same image, different CMD:
//   node apps/api/entrypoint.mjs dist/server.js          # api
//   node apps/api/entrypoint.mjs dist/workers/index.js   # worker
//
// .env is expected to contain only VAULT_ADDR and VAULT_TOKEN (written by
// fetch-secrets.sh on the host or piped from `docker compose --env-file`).
// Everything else lives in Vault at secret/data/two-cents-v2.

import { spawn } from 'node:child_process';

const target = process.argv[2];
if (!target) {
  console.error('[entrypoint] missing target script (argv[2])');
  process.exit(1);
}

const { VAULT_ADDR, VAULT_TOKEN } = process.env;
if (!VAULT_ADDR || !VAULT_TOKEN) {
  console.error('[entrypoint] VAULT_ADDR and VAULT_TOKEN must be set');
  process.exit(1);
}

console.log('[entrypoint] fetching secrets from Vault...');
const res = await fetch(`${VAULT_ADDR}/v1/secret/data/two-cents-v2`, {
  headers: { 'X-Vault-Token': VAULT_TOKEN },
});
if (!res.ok) {
  console.error(`[entrypoint] vault responded ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { data: { data: secrets } } = await res.json();
Object.assign(process.env, secrets);
console.log(`[entrypoint] loaded ${Object.keys(secrets).length} secrets, exec'ing ${target}`);

const child = spawn(process.execPath, [target], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
