#!/usr/bin/env bash
# v0.11.8 live probe — collab-rail ownership enforcement.
# Boots nothing itself; expects the dev server on :3000 (or BASE_URL).
set -u
BASE="${BASE_URL:-http://localhost:3000}"
JAR_A="$(mktemp)"; JAR_B="$(mktemp)"; JAR_ANON="$(mktemp)"
PASS=0; FAIL=0
note() { printf '%s\n' "$1"; }
expect() { # expect <desc> <want> <got>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); note "  ok   $1 → $3"
  else FAIL=$((FAIL+1)); note "  FAIL $1 → want $2, got $3"; fi
}

UA='curl-probe/0.1'

# ── account A (owner) ──────────────────────────────────────────
A_USER="probe_a_$RANDOM$RANDOM"
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_A" -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "{\"username\":\"$A_USER\",\"password\":\"probe-pass-123\"}" \
  "$BASE/api/auth/register")
expect "register account A" 201 "$code"

# ── owned design ───────────────────────────────────────────────
resp=$(curl -s -b "$JAR_A" -c "$JAR_A" -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d '{"name":"probe-owned","width":800,"height":600}' \
  "$BASE/api/designs")
OWNED=$(printf '%s' "$resp" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
note "owned design: $OWNED"

# ── account B (second account) ─────────────────────────────────
B_USER="probe_b_$RANDOM$RANDOM"
curl -s -o /dev/null -c "$JAR_B" -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "{\"username\":\"$B_USER\",\"password\":\"probe-pass-123\"}" \
  "$BASE/api/auth/register" >/dev/null

events_body='{"pid":"probe-pid","name":"Probe","color":"#7630D7","events":[{"eventId":"probe-e1","op":{"kind":"design:rename","name":"hacked"}}]}'

# 1. anonymous flush to an OWNED design → 403 READ_ONLY_DESIGN
code=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "$events_body" "$BASE/api/collab/$OWNED/events")
expect "anonymous → owned design: 403" 403 "$code"

# 2. second account flush to an OWNED design → 403
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "$events_body" "$BASE/api/collab/$OWNED/events")
expect "account B → owned design: 403" 403 "$code"

# 3. owner flush to their OWNED design → 200
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "$events_body" "$BASE/api/collab/$OWNED/events")
expect "owner → owned design: 200" 200 "$code"

# 4. cross-site flush (evil origin, owner cookies) → 403 CSRF
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" -A "$UA" \
  -H 'content-type: application/json' -H 'origin: https://evil.example' \
  -d "$events_body" "$BASE/api/collab/$OWNED/events")
expect "cross-site → 403 CSRF" 403 "$code"

# ── ownerless design (no cookies anywhere) ─────────────────────
resp=$(curl -s -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d '{"name":"probe-ownerless","width":800,"height":600}' \
  "$BASE/api/designs")
FREE=$(printf '%s' "$resp" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
note "ownerless design: $FREE"

# 5. anonymous flush to an OWNERLESS design → 200 (link = edit, by design)
code=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "$events_body" "$BASE/api/collab/$FREE/events")
expect "anonymous → ownerless design: 200" 200 "$code"

# 6. presence heartbeat on the owned design (anonymous viewer) → 200 (deliberate)
code=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d '{"pid":"probe-viewer","name":"Viewer","color":"#02C0CC"}' \
  "$BASE/api/collab/$OWNED/presence")
expect "anonymous viewer presence on owned design: 200" 200 "$code"

# 7. presence on a nonexistent design → 404 (no junk rows)
code=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d '{"pid":"probe-viewer","name":"Viewer","color":"#02C0CC"}' \
  "$BASE/api/collab/does-not-exist/presence")
expect "presence on missing design: 404" 404 "$code"

# ── cleanup: trash the probe designs ───────────────────────────
curl -s -o /dev/null -b "$JAR_A" -A "$UA" -X DELETE -H "origin: $BASE" "$BASE/api/designs/$OWNED" >/dev/null
curl -s -o /dev/null -A "$UA" -X DELETE -H "origin: $BASE" "$BASE/api/designs/$FREE" >/dev/null

note ""
note "probe result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
