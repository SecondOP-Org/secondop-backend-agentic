#!/bin/bash
# Apply seed-data.sql using .env DB_* settings (host/port/password).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_NAME=${DB_NAME:-secondop_db}
DB_USER=${DB_USER:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
export PGPASSWORD="${DB_PASSWORD:-postgres}"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f scripts/seed-data.sql
echo "✅ Seed applied to $DB_NAME"
