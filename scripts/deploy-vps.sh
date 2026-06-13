#!/usr/bin/env bash
set -euo pipefail

ROOT="${AUTOMATOR_DEPLOY_DIR:-/opt/automator}"
API_HEALTH_URL="${AUTOMATOR_API_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
SERVICES="${AUTOMATOR_SYSTEMD_SERVICES:-automator-api automator-worker}"

cd "$ROOT"

if [[ ! -f package.json || ! -f pnpm-lock.yaml ]]; then
  echo "Deploy directory does not look like an Automator checkout: $ROOT" >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@10.13.1 --activate
CI=true HUSKY=0 pnpm install --frozen-lockfile --prod --prefer-offline

if [[ -n "${AUTOMATOR_RELEASE:-}" && -f .env.production ]]; then
  python3 - "$AUTOMATOR_RELEASE" <<'PY'
from pathlib import Path
import os
import sys

env_path = Path(".env.production")
release = sys.argv[1]
lines = []
updated = False

for raw in env_path.read_text().splitlines():
    key, sep, _ = raw.partition("=")
    if sep and key == "SENTRY_RELEASE":
        lines.append(f"SENTRY_RELEASE={release}")
        updated = True
    else:
        lines.append(raw)

if not updated:
    lines.append(f"SENTRY_RELEASE={release}")

env_path.write_text("\n".join(lines) + "\n")
os.chmod(env_path, 0o600)
PY
fi

for service in $SERVICES; do
  systemctl restart "$service"
done

systemctl reload caddy

for attempt in {1..20}; do
  if curl -fsS "$API_HEALTH_URL" >/dev/null; then
    echo "API health check passed."
    exit 0
  fi

  sleep 2
done

echo "API health check failed after deploy." >&2
for service in $SERVICES; do
  journalctl -u "$service" --since "5 minutes ago" --no-pager | tail -n 120 >&2 || true
done
exit 1
