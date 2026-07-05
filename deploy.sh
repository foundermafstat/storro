#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BRANCH="${BRANCH:-main}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
PM2_ECOSYSTEM="${PM2_ECOSYSTEM:-ecosystem.config.js}"

set +u
[ -s "$HOME/.bashrc" ] && source "$HOME/.bashrc"
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
set -u

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

require_file() {
  if [ ! -f "$1" ]; then
    echo "Missing file: $1"
    exit 1
  fi
}

echo "Starting Storro deployment..."

require_cmd git
require_cmd npm
require_cmd docker
require_cmd pm2
require_file "$ENV_FILE"
require_file "$COMPOSE_FILE"
require_file "$PM2_ECOSYSTEM"

set -a
source "$ENV_FILE"
set +a

if [ -z "${STORRO_POSTGRES_PASSWORD:-}" ]; then
  echo "STORRO_POSTGRES_PASSWORD is required in $ENV_FILE"
  exit 1
fi

echo "Syncing code with origin/$BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "Starting Storro data services..."
dc up -d postgres redis

echo "Waiting for PostgreSQL..."
for attempt in {1..30}; do
  if dc exec -T postgres pg_isready -U storro -d storro >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    dc logs --tail=100 postgres
    exit 1
  fi
  sleep 2
done

echo "Waiting for Redis..."
for attempt in {1..30}; do
  if [ "$(dc exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" = "PONG" ]; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    dc logs --tail=100 redis
    exit 1
  fi
  sleep 2
done

echo "Installing dependencies..."
npm ci

echo "Generating Prisma client..."
npm run db:generate

echo "Applying database migrations..."
npm run deploy:migrate

echo "Building Next.js app..."
npm run build

echo "Checking deployment configuration and dependencies..."
npm run deploy:health
npm run worker:health

echo "Starting PM2 apps..."
pm2 startOrReload "$PM2_ECOSYSTEM" --update-env
pm2 save

echo "Checking local web endpoint..."
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:7788/api/mcp >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    pm2 logs storro-web --lines 80 --nostream || true
    exit 1
  fi
  sleep 2
done

echo "Storro deployment completed."
