#!/usr/bin/env bash
# Writes /opt/two-cents-v2/.env with VAULT_ADDR + VAULT_TOKEN so docker compose
# can pick them up via env_file. The actual app secrets live in Vault and are
# fetched at container startup by apps/api/entrypoint.mjs.
#
# Usage: bash fetch-secrets.sh   (run as the `runner` user on S2)
#
# Prereqs:
#   - /opt/two-cents-v2/vault-token exists (chmod 400, owned by runner)
#   - Vault is unsealed and reachable at $VAULT_ADDR
set -euo pipefail

APP_DIR="/opt/two-cents-v2"
VAULT_ADDR="${VAULT_ADDR:-https://vault.wispy-nook.casa}"
TOKEN_FILE="${APP_DIR}/vault-token"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "missing $TOKEN_FILE" >&2
  exit 1
fi

VAULT_TOKEN="$(cat "$TOKEN_FILE")"

# Quick sanity check that the token can read our path before we write .env.
if ! curl -sf -H "X-Vault-Token: ${VAULT_TOKEN}" \
      "${VAULT_ADDR}/v1/secret/data/two-cents-v2" > /dev/null; then
  echo "vault read failed for secret/data/two-cents-v2" >&2
  exit 1
fi

umask 077
cat > "${APP_DIR}/.env" <<EOF
VAULT_ADDR=${VAULT_ADDR}
VAULT_TOKEN=${VAULT_TOKEN}
EOF
chmod 600 "${APP_DIR}/.env"
echo "wrote ${APP_DIR}/.env"
