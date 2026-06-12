#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Starting local infrastructure (Postgres, Redis, Minio)..."
docker compose -f infra/docker-compose.yml up -d

echo "Applying API database migrations..."
pnpm --filter @automator/api db:migrate

echo "Starting Automator API on 0.0.0.0:8082..."
export PORT=8082
export NODE_ENV=development
pnpm --filter @automator/api dev
