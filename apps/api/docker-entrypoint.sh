#!/bin/sh
set -e
# Apply pending migrations (non-destructive) before starting.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  npx prisma migrate deploy
fi
# Optionally create the first Super Admin from ADMIN_EMAIL / ADMIN_PASSWORD (idempotent).
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  node dist/seed.js
fi
exec "$@"
