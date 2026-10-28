#!/bin/bash
# scripts/db-setup.sh — one command to point Canvix at ANY Postgres host
# (Supabase, Neon, RDS, local…) and end up with a working database.
#
#   npm run db:setup
#
# What it does, in order:
#   1. prisma migrate deploy
#        - fresh database            → creates all tables/indexes
#        - already-migrated database → no-op ("No pending migrations")
#        - db-push-prepared database (pre-v0.8 setups, e.g. a Neon DB you
#          kept after moving to Supabase) → Prisma exits P3005; we then
#          baseline the initial migration (mark it applied) and re-run,
#          which is Prisma's documented path for adopting migrations on
#          an existing schema.
#   2. seed the built-in template library (idempotent upserts — safe to
#      re-run any time, it also refreshes templates after upgrades).
set -u
cd "$(dirname "$0")/.."

MIGRATION="${1:-0001_init}"

echo "── Canvix database setup ──────────────────────────────"

# Fail fast with an actionable message instead of Prisma's cryptic
# "Environment variable not found: DATABASE_URL" (or, on GitHub Actions,
# a confusing P1001 against localhost).
if [ -z "${DATABASE_URL:-}" ]; then
  echo "  ERROR: DATABASE_URL is not set."
  echo "  - locally:            export DATABASE_URL='postgresql://…'"
  echo "  - GitHub Actions:     add the DATABASE_URL repository secret"
  echo "    (Settings → Secrets and variables → Actions), then re-run"
  echo "    the Canvix Database Setup workflow."
  echo "  Supabase note: either URL works — the pooler (port 6543) or the"
  echo "  direct connection (port 5432); sslmode/pgbouncer flags are"
  echo "  applied automatically by src/lib/db-url.ts."
  exit 1
fi

echo "  DATABASE_URL host: $(node -e "try{const u=new URL(process.env.DATABASE_URL||'');console.log(u.hostname)}catch{console.log('(unset)')}")"

echo "  [1/2] applying migrations…"
if npx prisma migrate deploy; then
  echo "  migrations: ok"
else
  RC=$?
  if [ "$RC" -eq 5 ] || [ "$RC" -eq 1 ]; then
    # P3005 (schema not empty, no migration history) comes back as exit 5
    # from migrate deploy; older CLIs used 1. Try the baseline recovery.
    echo "  existing schema without migration history detected — baselining…"
    if npx prisma migrate resolve --applied "$MIGRATION"; then
      npx prisma migrate deploy && echo "  migrations: ok (baselined)" || exit 1
    else
      echo "  migrate deploy failed and baselining did not apply."
      echo "  If this is a fresh database, check DATABASE_URL / credentials."
      echo "  Full diagnosis: start the app and open /api/health"
      exit "$RC"
    fi
  else
    echo "  migrate deploy failed (exit $RC). Check DATABASE_URL / network / password."
    echo "  Full diagnosis: start the app and open /api/health"
    exit "$RC"
  fi
fi

echo "  [2/2] seeding the template library…"
npx tsx prisma/seed.ts || exit 1

echo "── done. Your database is ready: 110 templates, all free. ──"
