#!/bin/bash
# scripts/auth-e2e.sh — end-to-end smoke test of the v0.9 account system
# against a REAL database (Supabase/Neon/local). Builds the standalone
# server, boots it, and exercises the full account + ownership flow via
# plain curl:
#
#   register → me → create (owned) → save as owner → 403 as anonymous
#   → login → logout → me(null) → cleanup
#
# Exits non-zero on the first failed expectation. Leaves no rows behind
# (the test user + design are deleted at the end).
set -u
cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3100}"
BASE="http://127.0.0.1:$PORT"
JAR="$(mktemp)"
TS_USER="e2e_tester_$$_$(date +%s)"
TS_PASS='e2e-Tr0ub4dor-pass'
SERVER_PID=""

say()  { printf '  \033[1;36m%s\033[0m\n' "$*"; }
pass() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$JAR"
}
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set — the smoke test needs a real database."
  exit 1
fi

say "building the standalone server…"
npm run build >/dev/null 2>&1 || fail "next build failed"

say "booting the server on :$PORT…"
PORT="$PORT" HOSTNAME=127.0.0.1 DATABASE_URL="$DATABASE_URL" \
  node .next/standalone/server.js >/tmp/canvix-e2e-server.log 2>&1 &
SERVER_PID=$!

for i in $(seq 1 60); do
  curl -sf "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "$BASE/api/health" >/dev/null 2>&1 || fail "server did not become healthy (see /tmp/canvix-e2e-server.log)"

# ── 1. register ─────────────────────────────────────────────
STATUS=$(curl -s -o /tmp/e2e-r1.json -w '%{http_code}' -c "$JAR" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/auth/register" \
  -d "{\"username\":\"$TS_USER\",\"password\":\"$TS_PASS\"}")
[ "$STATUS" = "201" ] || fail "register expected 201, got $STATUS: $(cat /tmp/e2e-r1.json)"
pass "register → 201, session cookie set"

# ── 2. me (signed in) ───────────────────────────────────────
curl -sf -b "$JAR" "$BASE/api/auth/me" | grep -q "\"$TS_USER\"" || fail "me should report the signed-in user"
pass "me → signed in as $TS_USER"

# ── 3. create a design (should be owned) ────────────────────
STATUS=$(curl -s -o /tmp/e2e-r3.json -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/designs" \
  -d '{"name":"E2E ownership probe","width":100,"height":100}')
[ "$STATUS" = "201" ] || fail "create expected 201, got $STATUS"
DESIGN_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/e2e-r3.json','utf8')).id)")
[ -n "$DESIGN_ID" ] || fail "no design id in create response"
pass "create → owned design $DESIGN_ID"

# ── 4. owner can save it ─────────────────────────────────────
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' \
  -X PUT "$BASE/api/designs/$DESIGN_ID" \
  -d '{"name":"E2E ownership probe (saved)"}')
[ "$STATUS" = "200" ] || fail "owner save expected 200, got $STATUS"
pass "owner PUT → 200"

# ── 5. anonymous gets 403 (the ownership guard) ─────────────
STATUS=$(curl -s -o /tmp/e2e-r5.json -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X PUT "$BASE/api/designs/$DESIGN_ID" \
  -d '{"name":"hijack attempt"}')
[ "$STATUS" = "403" ] || fail "anonymous PUT on an owned design expected 403, got $STATUS"
grep -q "READ_ONLY_DESIGN" /tmp/e2e-r5.json || fail "403 body should carry READ_ONLY_DESIGN"
pass "anonymous PUT → 403 READ_ONLY_DESIGN (ownership enforced)"

# ── 6. logout → me is null ──────────────────────────────────
curl -sf -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/logout" >/dev/null || fail "logout failed"
curl -sf -b "$JAR" "$BASE/api/auth/me" | grep -q '"user":null' || fail "me should be null after logout"
pass "logout → me(null)"

# ── 7. wrong password is refused ────────────────────────────
STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/auth/login" \
  -d "{\"username\":\"$TS_USER\",\"password\":\"definitely-wrong\"}")
[ "$STATUS" = "401" ] || fail "wrong password expected 401, got $STATUS"
pass "wrong password → 401"

# ── 8. login works ──────────────────────────────────────────
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/auth/login" \
  -d "{\"username\":\"$TS_USER\",\"password\":\"$TS_PASS\"}")
[ "$STATUS" = "200" ] || fail "login expected 200, got $STATUS"
pass "login → 200, session restored"

# ── cleanup: remove the probe rows ───────────────────────────
DATABASE_URL="$DATABASE_URL" npx tsx -e "
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
;(async () => {
  await db.design.deleteMany({ where: { id: process.argv[1] } })
  await db.user.deleteMany({ where: { username: process.argv[2] } })
  await db.\$disconnect()
})().then(() => process.exit(0)).catch(() => process.exit(1))
" "$DESIGN_ID" "$TS_USER" || fail "cleanup failed"

say "all green — accounts, ownership and sessions verified end-to-end."
