#!/bin/bash
# scripts/db-setup.sh — one command to point Canvix at ANY Postgres host
# (Supabase, Neon, RDS, local…) and end up with a working database.
#
#   npm run db:setup
#
# What it does, in order:
#   1. prisma generate — make sure the client exists no matter how
#      dependencies were installed (some package managers skip
#      postinstall scripts, which would otherwise break the seed).
#   2. prisma migrate deploy — via a migration-safe URL:
#        - fresh database            → creates all tables/indexes
#        - already-migrated database → no-op ("No pending migrations")
#        - db-push-prepared database (pre-v0.8 setups, e.g. a Neon DB you
#          kept after moving to Supabase) → Prisma exits P3005; we then
#          baseline the initial migration (mark it applied) and re-run,
#          which is Prisma's documented path for adopting migrations on
#          an existing schema.
#      Supabase note: Migrate needs session-level advisory locks, which
#      the TRANSACTION pooler (port 6543) does not support — through it
#      the command hangs until timeout. When DATABASE_URL points there,
#      migrations are transparently run through the SESSION pooler on
#      the same host (port 5432, same credentials, IPv4-friendly). The
#      app and the seed work fine through either port.
#   3. seed the built-in template library (idempotent upserts — safe to
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
  echo "  - locally:        export DATABASE_URL='postgresql://…'"
  echo "  - GitHub Actions: add the DATABASE_URL repository secret"
  echo "    (Settings → Secrets and variables → Actions), then re-run"
  echo "    the Canvix Database Setup workflow."
  exit 1
fi

urlhost() { node -e "try{const u=new URL(process.env.DATABASE_URL||'');console.log(u.hostname+(u.port?':'+u.port:''))}catch{console.log('(unset)')}"; }
echo "  DATABASE_URL: $(urlhost)"

# ── migration-safe URL ────────────────────────────────────
# Rewrite Supabase transaction pooler (port 6543 / pgbouncer=true) to the
# session pooler (port 5432) and pin sslmode for remote hosts. The seed
# and the app keep using the original URL (seed.ts normalises it itself).
MIGRATE_URL="$(node -e '
const url = process.env.DATABASE_URL || ""
try {
  const u = new URL(url)
  const pooler = u.hostname.endsWith(".pooler.supabase.com")
  const tx = u.port === "6543" || u.searchParams.get("pgbouncer") === "true"
  if (pooler && tx) {
    u.port = "5432"
    u.searchParams.delete("pgbouncer")
    u.searchParams.delete("connection_limit")
  }
  const local = ["localhost","127.0.0.1","::1","[::1]"].includes(u.hostname)
  if (!local && !u.searchParams.has("sslmode") && !u.searchParams.has("ssl")) {
    u.searchParams.set("sslmode", "require")
  }
  process.stdout.write(u.toString())
} catch { process.stdout.write(url) }
')"

if [ "$MIGRATE_URL" != "$DATABASE_URL" ]; then
  echo "  migrations: routed via the session pooler (port 5432) — Prisma"
  echo "  Migrate cannot run through the transaction pooler (6543); the"
  echo "  credentials are identical. App + seed keep your original URL."
fi

echo "  [1/3] generating the Prisma client…"
npx prisma generate || exit 1

echo "  [2/3] applying migrations…"
if DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy; then
  echo "  migrations: ok"
else
  RC=$?
  if [ "$RC" -eq 5 ] || [ "$RC" -eq 1 ]; then
    # P3005 (schema not empty, no migration history) comes back as exit 5
    # from migrate deploy; older CLIs used 1. Try the baseline recovery.
    echo "  existing schema without migration history detected — baselining…"
    if DATABASE_URL="$MIGRATE_URL" npx prisma migrate resolve --applied "$MIGRATION"; then
      DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy && echo "  migrations: ok (baselined)" || exit 1
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

echo "  [3/3] seeding the template library…"
npx tsx prisma/seed.ts || exit 1

echo "── done. Your database is ready: 110 templates, all free. ──"
