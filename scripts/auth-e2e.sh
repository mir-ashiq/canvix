#!/bin/bash
# scripts/auth-e2e.sh — end-to-end verification of the v0.9/v0.9.1 account,
# ownership and claim-safety behaviour against a REAL database
# (Supabase/Neon/local). Builds the standalone server, boots it, and
# exercises the full flow via plain curl:
#
#   register → me → owned create → owner save → anonymous 403
#   → logout → revoked-token replay → me(null) → wrong password 401 → login
#   → CSRF: cross-origin PUT/POST rejected
#   → anonymous attribution: two browsers create ownerless designs
#   → adopt-all claims ONLY the caller's own browser's designs
#   → per-design adopt: foreign browser's design refused, legacy allowed
#   → cross-account isolation: B cannot modify/delete C's design
#   → cleanup (all probe rows removed)
#
# Exits non-zero on the first failed expectation. Leaves no rows behind.
set -u
cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3100}"
BASE="http://127.0.0.1:$PORT"
JAR="$(mktemp)"          # browser/account TS_USER
JAR_A="$(mktemp)"        # anonymous browser A
JAR_B="$(mktemp)"        # anonymous browser B → later account B
JAR_C="$(mktemp)"        # account C (isolation probe)
TS_USER="e2e_tester_$$_$(date +%s)"
USER_B="e2e_b_$$_$(date +%s)"
USER_C="e2e_c_$$_$(date +%s)"
TS_PASS='e2e-Tr0ub4dor-pass'
SERVER_PID=""

say()  { printf '  \033[1;36m%s\033[0m\n' "$*"; }
pass() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$JAR" "$JAR_A" "$JAR_B" "$JAR_C"
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

# ── 5. anonymous gets 403 (the ownership guard) ──────────────
STATUS=$(curl -s -o /tmp/e2e-r5.json -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X PUT "$BASE/api/designs/$DESIGN_ID" \
  -d '{"name":"hijack attempt"}')
[ "$STATUS" = "403" ] || fail "anonymous PUT on an owned design expected 403, got $STATUS"
grep -q "READ_ONLY_DESIGN" /tmp/e2e-r5.json || fail "403 body should carry READ_ONLY_DESIGN"
pass "anonymous PUT → 403 READ_ONLY_DESIGN (ownership enforced)"

# ── 6. logout → me is null; REVOKED token replay is dead ────
OLD_TOKEN=$(awk '$6=="canvix_session" {print $7}' "$JAR" | tail -1)
[ -n "$OLD_TOKEN" ] || fail "could not capture the session token for the replay probe"
curl -sf -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/logout" >/dev/null || fail "logout failed"
curl -sf -b "$JAR" "$BASE/api/auth/me" | grep -q '"user":null' || fail "me should be null after logout"
pass "logout → me(null)"
curl -sf -H "Cookie: canvix_session=$OLD_TOKEN" "$BASE/api/auth/me" | grep -q '"user":null' \
  || fail "REPLAY of the logged-out token must be rejected server-side (revocation)"
pass "revoked session token replay → me(null) (server-side revocation works)"

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

# ── 9. CSRF: cross-site mutations are rejected ───────────────
STATUS=$(curl -s -o /tmp/e2e-r9.json -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://evil.example' \
  -X PUT "$BASE/api/designs/$DESIGN_ID" \
  -d '{"name":"csrf attempt"}')
[ "$STATUS" = "403" ] || fail "cross-origin PUT expected 403, got $STATUS"
grep -q "CSRF_REJECTED" /tmp/e2e-r9.json || fail "CSRF 403 body should carry CSRF_REJECTED"
pass "cross-origin PUT → 403 CSRF_REJECTED"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://evil.example' \
  -X POST "$BASE/api/designs" \
  -d '{"name":"csrf attempt"}')
[ "$STATUS" = "403" ] || fail "cross-origin POST /api/designs expected 403, got $STATUS"
pass "cross-origin POST → 403 CSRF_REJECTED"
# same-origin mutations still work (Origin matches the host)
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: $BASE" \
  -X PUT "$BASE/api/designs/$DESIGN_ID" \
  -d '{"name":"same-origin save"}')
[ "$STATUS" = "200" ] || fail "same-origin PUT expected 200, got $STATUS"
pass "same-origin PUT → 200 (guard does not over-block)"

# ── 10. anonymous attribution: two browsers, two designs ────
STATUS=$(curl -s -o /tmp/e2e-xa.json -w '%{http_code}' -c "$JAR_A" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/designs" \
  -d '{"name":"E2E browser A design","width":100,"height":100}')
[ "$STATUS" = "201" ] || fail "browser A create expected 201, got $STATUS"
DESIGN_A=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/e2e-xa.json','utf8')).id)")
awk '$6=="canvix_anon" {print $7}' "$JAR_A" | grep -q . || fail "anonymous create must set the canvix_anon attribution cookie"
pass "browser A created ownerless design $DESIGN_A (attribution cookie set)"

STATUS=$(curl -s -o /tmp/e2e-xb.json -w '%{http_code}' -c "$JAR_B" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/designs" \
  -d '{"name":"E2E browser B design","width":100,"height":100}')
[ "$STATUS" = "201" ] || fail "browser B create expected 201, got $STATUS"
DESIGN_B=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/e2e-xb.json','utf8')).id)")
pass "browser B created ownerless design $DESIGN_B"

# a LEGACY design (pre-attribution): inserted directly, anonKey NULL.
# Direct binary + retries: `npx tsx` proved flaky on CI runners and the
# bare catch hid the reason — errors are printed and the insert retried.
TSX="./node_modules/.bin/tsx"
LEGACY_ID=""
for attempt in 1 2 3; do
  if OUT=$(DATABASE_URL="$DATABASE_URL" "$TSX" -e "
// use the app's own script-side client factory (URL normalization +
// pg driver adapter — a raw client against the transaction pooler
// breaks on prepared statements)
const { createScriptClient } = require('./src/lib/db-script')
const db = createScriptClient()
;(async () => {
  const d = await db.design.create({ data: { name: 'E2E legacy (pre-accounts) design', width: 100, height: 100 } })
  console.log(d.id)
  await db.\$disconnect()
})().catch((e) => { console.error('legacy insert error:', e); process.exit(1) })
"); then
    # stdout may carry the [db] normalization banner — the id is the LAST line
    LEGACY_ID="$(printf '%s\n' "$OUT" | tail -n 1)"
    break
  fi
  echo "    legacy insert attempt $attempt failed: $OUT — retrying in 3s"
  sleep 3
done
[ -n "$LEGACY_ID" ] || fail "could not insert the legacy probe design"
pass "legacy design inserted directly: $LEGACY_ID (anonKey NULL, ownerId NULL)"

# ── 11. register account B from browser B's jar ─────────────
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" -c "$JAR_B" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/auth/register" \
  -d "{\"username\":\"$USER_B\",\"password\":\"$TS_PASS\"}")
[ "$STATUS" = "201" ] || fail "register B expected 201, got $STATUS"
pass "registered $USER_B (same browser/cookie context as design B)"

# ── 12. adopt-all claims ONLY browser B's own design ─────────
ADOPTED=$(curl -sf -b "$JAR_B" -X POST "$BASE/api/designs/adopt-all" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).adopted))")
[ "$ADOPTED" = "1" ] || fail "adopt-all must claim exactly browser B's 1 design, got $ADOPTED (eligibility scoping broken!)"
pass "adopt-all → adopted exactly 1 (browser B's own design; A's, the legacy row and all other users' work untouched)"
curl -sf "$BASE/api/designs/$DESIGN_A" | grep -q '"ownerId":null' || fail "browser A's design must still be ownerless after B's adopt-all"
pass "browser A's design remains ownerless (no cross-browser theft)"
curl -sf "$BASE/api/designs/$LEGACY_ID" | grep -q '"ownerId":null' || fail "the legacy design must NOT be bulk-claimed"
pass "legacy design untouched by adopt-all (needs explicit per-design adoption)"

# ── 13. per-design adopt: foreign refused, legacy allowed ────
STATUS=$(curl -s -o /tmp/e2e-adopt-a.json -w '%{http_code}' -b "$JAR_B" \
  -X POST "$BASE/api/designs/$DESIGN_A/adopt")
[ "$STATUS" = "403" ] || fail "B adopting browser A's design expected 403, got $STATUS"
grep -q "NOT_ELIGIBLE" /tmp/e2e-adopt-a.json || fail "per-design adopt refusal should carry NOT_ELIGIBLE"
pass "per-design adopt of a foreign browser's design → 403 NOT_ELIGIBLE"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" \
  -X POST "$BASE/api/designs/$LEGACY_ID/adopt")
[ "$STATUS" = "200" ] || fail "deliberate per-design adoption of a legacy design expected 200, got $STATUS"
pass "explicit per-design adoption of the legacy design → 200 (deliberate action)"

# ── 14. cross-account isolation (B vs C) ─────────────────────
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_C" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/auth/register" \
  -d "{\"username\":\"$USER_C\",\"password\":\"$TS_PASS\"}")
[ "$STATUS" = "201" ] || fail "register C expected 201, got $STATUS"
STATUS=$(curl -s -o /tmp/e2e-w.json -w '%{http_code}' -b "$JAR_C" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE/api/designs" \
  -d '{"name":"E2E account C design","width":100,"height":100}')
[ "$STATUS" = "201" ] || fail "C create expected 201, got $STATUS"
DESIGN_W=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/e2e-w.json','utf8')).id)")
pass "registered $USER_C and created owned design $DESIGN_W"

STATUS=$(curl -s -o /tmp/e2e-isol.json -w '%{http_code}' -b "$JAR_B" \
  -H 'Content-Type: application/json' \
  -X PUT "$BASE/api/designs/$DESIGN_W" \
  -d '{"name":"B hijacking C"}')
[ "$STATUS" = "403" ] || fail "B modifying C's design expected 403, got $STATUS"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" \
  -X DELETE "$BASE/api/designs/$DESIGN_W")
[ "$STATUS" = "403" ] || fail "B deleting C's design expected 403, got $STATUS"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" \
  -X POST "$BASE/api/designs/$DESIGN_W/adopt")
[ "$STATUS" = "403" ] || fail "B adopting C's design expected 403, got $STATUS"
pass "account B cannot modify, delete or adopt account C's design (403 ×3)"
curl -sf -b "$JAR_B" "$BASE/api/designs/$DESIGN_W" | grep -q '"readOnly":true' \
  || fail "B's GET of C's design should report readOnly:true (view-only mode)"
pass "B opens C's design in view-only mode (readOnly:true)"

# ── cleanup: remove every probe row (this run AND any leftovers) ──
CLEANUP_OK=0
for attempt in 1 2 3; do
  if DATABASE_URL="$DATABASE_URL" "$TSX" -e "
// use the app's own script-side client factory (URL normalization +
// pg driver adapter — a raw client against the transaction pooler
// breaks on prepared statements)
const { createScriptClient } = require('./src/lib/db-script')
const db = createScriptClient()
;(async () => {
  const ids = process.argv.slice(1, 6).filter(Boolean)   // 5 design ids (this run)
  const names = process.argv.slice(6).filter(Boolean)    // 3 usernames (this run)
  console.log('cleanup: designs', ids.length, 'users', names.length)
  // this run's rows…
  if (names.length) await db.session.deleteMany({ where: { user: { username: { in: names } } } })
  if (ids.length) await db.design.deleteMany({ where: { id: { in: ids } } })
  if (names.length) await db.user.deleteMany({ where: { username: { in: names } } })
  // …plus any rows a previously failed run may have left behind
  await db.session.deleteMany({ where: { user: { username: { startsWith: 'e2e_' } } } })
  await db.design.deleteMany({
    where: {
      OR: [
        { name: { startsWith: 'E2E ownership probe' } },
        { name: { startsWith: 'E2E browser ' } },
        { name: { startsWith: 'E2E legacy' } },
        { name: { startsWith: 'E2E account ' } },
      ],
    },
  })
  await db.user.deleteMany({ where: { username: { startsWith: 'e2e_' } } })
  await db.\$disconnect()
})().then(() => process.exit(0)).catch((e) => { console.error('cleanup error:', e); process.exit(1) })
" "$DESIGN_ID" "$DESIGN_A" "$DESIGN_B" "$LEGACY_ID" "$DESIGN_W" "$TS_USER" "$USER_B" "$USER_C"; then
    CLEANUP_OK=1; break
  fi
  echo "    cleanup attempt $attempt failed — retrying in 3s"
  sleep 3
done
[ "$CLEANUP_OK" = "1" ] || fail "cleanup failed"

say "all green — accounts, sessions, CSRF, claim eligibility and ownership verified end-to-end."
