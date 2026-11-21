#!/bin/sh
# docker-entrypoint.sh — the container's boot sequence (WP1).
#
#   1. wait for the database to accept connections
#   2. prisma migrate deploy   (migrations from the image; the P3005
#      baseline recovery from scripts/db-setup.sh is ported: a
#      database with tables but no migration history gets baselined
#      against 0001_init, then migrated the rest of the way)
#   3. exec the standalone Next server as PID 1 (dumb-init's child)
#      — its instrumentation hook (src/instrumentation.ts) syncs the
#      template library from code on boot, so there is NO seed step
#      here: templates appear on first request, idempotent forever.
#
# Design notes:
#   - POSIX sh (dash): the runner is slim; no bash assumption.
#   - The app itself never needs the prisma CLI — only this script
#     does, which is why the CLI lives in /opt/migrate, not /app.
#   - HOSTNAME is re-asserted because docker injects HOSTNAME=<cid>
#     into every container, and .next/standalone/server.js binds
#     process.env.HOSTNAME || '0.0.0.0' — un-overridden, the server
#     would try to bind the container id as a hostname and die.
#   - CANVIX_RUN_MIGRATIONS=0 skips step 1–2 entirely (operators who
#     run migrations as a separate job, e.g. multi-replica deploys
#     where replicas must not race `migrate deploy`).

set -u

HOSTNAME=0.0.0.0
export HOSTNAME

MIGRATE_DIR=/opt/migrate
PRISMA="$MIGRATE_DIR/node_modules/.bin/prisma"
SCHEMA=/app/prisma/schema.prisma
# first migration ever — what a pre-migration database is baselined
# against (same value scripts/db-setup.sh defaults to)
BASELINE_MIGRATION="${CANVIX_BASELINE_MIGRATION:-0001_init}"

log() { echo "[entrypoint] $*"; }

# ── migrations ────────────────────────────────────────────────────
if [ "${CANVIX_RUN_MIGRATIONS:-1}" = "0" ]; then
  log "CANVIX_RUN_MIGRATIONS=0 — skipping migrate-on-boot (operator-managed schema)"
else
  # 1. wait for the database: migrate deploy against a not-yet-ready
  #    Postgres produces P1001 noise. Up to ~60 s (30 × 2 s), then
  #    let migrate deploy fail with its real error instead.
  if [ -n "${DATABASE_URL:-}" ]; then
    i=0
    while [ "$i" -lt 30 ]; do
      if "$PRISMA" db execute --schema "$SCHEMA" \
            --stdin <<'SQL' >/dev/null 2>&1
SELECT 1;
SQL
      then
        break
      fi
      i=$((i + 1))
      sleep 2
    done
    [ "$i" -lt 30 ] || log "WARNING: database still not accepting connections after 60 s — handing off to migrate deploy for the real error"
  fi

  # 2. apply migrations (idempotent: "No pending migrations" on
  #    up-to-date databases). P3005 (schema not empty, no history —
  #    a pre-migration database) is recovered by baselining, the
  #    documented Prisma path scripts/db-setup.sh has used since
  #    v0.8.
  log "applying database migrations…"
  if "$PRISMA" migrate deploy --schema "$SCHEMA"; then
    log "migrations: ok"
  else
    rc=$?
    # prisma migrate deploy exits 5 on P3005-shaped failures (and 1
    # on older CLIs) — same recovery envelope as scripts/db-setup.sh
    if [ "$rc" -eq 5 ] || [ "$rc" -eq 1 ]; then
      log "existing schema without migration history detected — baselining $BASELINE_MIGRATION"
      if "$PRISMA" migrate resolve --applied "$BASELINE_MIGRATION" --schema "$SCHEMA" \
         && "$PRISMA" migrate deploy --schema "$SCHEMA"; then
        log "migrations: ok (baselined)"
      else
        log "ERROR: migrate deploy failed and baselining did not apply. If this is a fresh database, check DATABASE_URL. Full diagnosis: start the app anyway (below) and open /api/health"
        # do NOT exit: the server may still serve against a partially
        # migrated database, and /api/health tells the operator what
        # is missing — same philosophy as db-setup.sh's messaging.
      fi
    else
      log "ERROR: migrate deploy failed (exit $rc). Starting anyway — /api/health reports the exact state."
    fi
  fi
fi

# ── the server ────────────────────────────────────────────────────
log "starting canvix on ${HOSTNAME}:${PORT:-3000}"
exec node server.js
