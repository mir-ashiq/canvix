#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# rate-limit-probe.sh (v0.12.3, roadmap H5) — proves the per-IP
# caps on a live instance. Creates throwaway designs, so point it
# at a scratch/dev server, not production.
#
#   BASE_URL=http://localhost:3000 bash scripts/rate-limit-probe.sh
#
# Proves:
#   1. POST /api/designs 429s after the designs:create budget
#      (default 30/min/IP) and the 429 carries Retry-After.
#   2. The 7th concurrent SSE stream from one IP is refused 429
#      while the first 6 (CANVIX_SSE_MAX_PER_IP) stream fine.
# Exit code 0 = every cap behaved.
# ─────────────────────────────────────────────────────────────
set -u
BASE_URL="${BASE_URL:-http://localhost:3000}"
CREATE_LIMIT="${CREATE_LIMIT:-30}"          # keep in sync with src/lib/rate-limit.ts
SSE_CAP="${SSE_CAP:-6}"

pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }

echo "── 1. designs:create cap ($CREATE_LIMIT/min per IP) ──"
code=""; retry_after=""
for i in $(seq 1 $((CREATE_LIMIT + 5))); do
  # no Origin header → same-origin check passes for curl (no ambient
  # cookie authority); the limiter keys on the shared unknown/local IP
  headers=$(curl -s -o /dev/null -D - -X POST "$BASE_URL/api/designs" \
    -H 'Content-Type: application/json' \
    --data '{"name":"rate-limit probe","width":100,"height":100,"pages":[]}')
  code=$(printf '%s' "$headers" | head -1 | awk '{print $2}')
  retry_after=$(printf '%s' "$headers" | tr -d '\r' | awk 'tolower($1)=="retry-after:" {print $2}')
  if [ "$code" = "429" ]; then
    echo "  hit the cap on request #$i (HTTP $code)"
    break
  fi
done
if [ "$code" = "429" ]; then
  ok "POST /api/designs eventually returns 429"
else
  bad "never got a 429 (last code: $code) — is CANVIX_RATE_LIMITS=off set, or the limit raised?"
fi
if [ -n "$retry_after" ] && [ "$retry_after" -ge 1 ] 2>/dev/null; then
  ok "429 carries Retry-After: $retry_after"
else
  bad "429 is missing a numeric Retry-After header"
fi

echo "── 2. SSE concurrent-stream cap ($SSE_CAP per IP) ──"
design_id=$(curl -s -X POST "$BASE_URL/api/designs" \
  -H 'Content-Type: application/json' \
  --data '{"name":"sse cap probe","width":100,"height":100,"pages":[]}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || echo "")
if [ -z "$design_id" ]; then
  # the create budget may already be spent — reuse any existing design
  design_id=$(curl -s "$BASE_URL/api/designs" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("designs") or []; print(d[0]["id"] if d else "")' 2>/dev/null || echo "")
fi
if [ -z "$design_id" ]; then
  bad "no design available to open streams against"
else
  pids=()
  for i in $(seq 1 "$SSE_CAP"); do
    # hold $SSE_CAP streams open for 6 s (long enough to fire the probe)
    curl -s -N --max-time 6 "$BASE_URL/api/collab/$design_id/stream?pid=probe$i&since=0" \
      > /dev/null 2>&1 &
    pids+=($!)
  done
  sleep 1 # let the six connect
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
    "$BASE_URL/api/collab/$design_id/stream?pid=probe-over&since=0")
  if [ "$code" = "429" ]; then
    ok "stream #$((SSE_CAP + 1)) is refused with 429"
  else
    bad "stream #$((SSE_CAP + 1)) got HTTP $code (expected 429)"
  fi
  wait "${pids[@]}" 2>/dev/null
  # after the six close, a new stream must be welcome again
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
    "$BASE_URL/api/collab/$design_id/stream?pid=probe-after&since=0")
  if [ "$code" = "200" ]; then
    ok "a fresh stream connects after the slots are released"
  else
    bad "post-release stream got HTTP $code (expected 200) — slot leak?"
  fi
fi

echo "── verdict ──"
echo "  passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] && echo "  RATE LIMITS VERIFIED" || { echo "  RATE LIMIT PROBE FAILED"; exit 1; }
