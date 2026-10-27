#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════
# Canvix MCP end-to-end suite — 38 assertions over the live
# Streamable-HTTP transport at /api/mcp.
#
# Covers: auth, protocol negotiation, id echo (v0.6.1 fix), the
# full tool catalogue, a real create→edit→export workflow against
# the database, SSRF-guard rejections, and transport hardening
# (invalid JSON, unknown methods, batches, 1 MB body cap).
#
# Usage:
#   CANVIX_MCP_TOKEN=<token> ./scripts/mcp-e2e.sh
#   BASE_URL=http://localhost:3000 CANVIX_MCP_TOKEN=<token> ./scripts/mcp-e2e.sh
#
# Requires: curl, node. The server must run with the same
# CANVIX_MCP_TOKEN and a reachable database.
# ═════════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${CANVIX_MCP_TOKEN:-}"
ENDPOINT="$BASE_URL/api/mcp"

PASS=0
FAIL=0
TOTAL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -z "$TOKEN" ]]; then
  echo "error: CANVIX_MCP_TOKEN is not set (see README → AI agents / MCP)."
  exit 2
fi
command -v curl >/dev/null || { echo "error: curl is required."; exit 2; }
command -v node >/dev/null || { echo "error: node is required."; exit 2; }

# ── helpers ───────────────────────────────────────────────────

# post <json-body> [extra curl args...] → sets HTTP + BODY
post() {
  local body="$1"; shift || true
  HTTP=$(curl -sS -o "$TMP/body" -w '%{http_code}' -X POST "$ENDPOINT" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data-binary "$body" "$@" || echo 000)
  BODY="$(cat "$TMP/body" 2>/dev/null)"
}

post_noauth() {
  HTTP=$(curl -sS -o "$TMP/body" -w '%{http_code}' -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' --data-binary "$1" || echo 000)
  BODY="$(cat "$TMP/body" 2>/dev/null)"
}

# jget <node-expr over j> — extract from $BODY, e.g. jget 'j.id'
jget() {
  printf '%s' "$BODY" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(d);
        const v = eval(process.argv[1]);
        process.stdout.write(v === undefined ? "undefined" : typeof v === "object" ? JSON.stringify(v) : String(v));
      } catch { process.stdout.write("__PARSE_ERROR__"); }
    });' "$1"
}

check() { # check <desc> <actual> <expected>
  TOTAL=$((TOTAL + 1))
  if [[ "$2" == "$3" ]]; then
    PASS=$((PASS + 1)); echo "  ok  [$TOTAL/38] $1"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL [$TOTAL/38] $1"
    echo "         expected: $3"
    echo "         got:      ${2:0:200}"
  fi
}

check_re() { # check_re <desc> <actual> <posix-regex>
  TOTAL=$((TOTAL + 1))
  if [[ "$2" =~ $3 ]]; then
    PASS=$((PASS + 1)); echo "  ok  [$TOTAL/38] $1"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL [$TOTAL/38] $1"
    echo "         pattern:  $3"
    echo "         got:      ${2:0:200}"
  fi
}

call() { # call <tool> <args-json> → HTTP/BODY of tools/call
  post "{\"jsonrpc\":\"2.0\",\"id\":900,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}

echo "Canvix MCP e2e — $ENDPOINT"
echo "────────────────────────────────────────────────────────────"

# ── 1-3. capability probe ─────────────────────────────────────
HTTP=$(curl -sS -o "$TMP/body" -w '%{http_code}' -X OPTIONS "$ENDPOINT" || echo 000)
BODY="$(cat "$TMP/body")"
check "OPTIONS probe answers 200"                "$HTTP" "200"
check "OPTIONS reports MCP enabled"              "$(jget 'j.mcp')" "enabled"
check "OPTIONS advertises streamable-http"       "$(jget 'j.transport')" "streamable-http"

# ── 4-6. auth ─────────────────────────────────────────────────
post_noauth '{"jsonrpc":"2.0","id":1,"method":"ping"}'
check "no token → 401"                           "$HTTP" "401"
check "no token → JSON-RPC error -32001"         "$(jget 'j.error.code')" "-32001"
HTTP=$(curl -sS -o "$TMP/body" -w '%{http_code}' -X POST "$ENDPOINT" \
  -H "Authorization: Bearer wrong-token" -H 'Content-Type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"ping"}' || echo 000)
BODY="$(cat "$TMP/body")"
check "wrong token → 401"                        "$HTTP" "401"

# ── 7-12. initialize ──────────────────────────────────────────
post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}'
check "initialize → 200"                         "$HTTP" "200"
check "initialize echoes id (1)"                 "$(jget 'j.id')" "1"
check "initialize negotiates protocol version"   "$(jget 'j.result.protocolVersion')" "2025-03-26"
check "initialize → serverInfo.name"             "$(jget 'j.result.serverInfo.name')" "canvix"
check "initialize → serverInfo.version"          "$(jget 'j.result.serverInfo.version')" "0.6.1"
check "initialize → tools capability"            "$(jget 'typeof j.result.capabilities.tools')" "object"

# ── 13. notification ──────────────────────────────────────────
post '{"jsonrpc":"2.0","method":"notifications/initialized"}'
check "notification → 202 Accepted"              "$HTTP" "202"

# ── 14-16. ping ───────────────────────────────────────────────
post '{"jsonrpc":"2.0","id":99,"method":"ping"}'
check "ping → 200"                               "$HTTP" "200"
check "ping echoes id (99)"                      "$(jget 'j.id')" "99"
check "ping → empty result"                      "$(jget 'JSON.stringify(j.result)')" "{}"

# ── 17-20. tools/list (incl. the v0.6.1 id-echo regression) ───
post '{"jsonrpc":"2.0","id":7,"method":"tools/list"}'
check "tools/list → 200"                         "$HTTP" "200"
check "tools/list echoes id (7) [v0.6.1 fix]"    "$(jget 'j.id')" "7"
check "tools/list exposes ≥ 20 tools"            "$(jget 'j.result.tools.length >= 20')" "true"
check "tools/list has core tools"                "$(jget "['create_design','add_text','add_image','export_design'].every(n => j.result.tools.some(t => t.name === n))")" "true"

# ── 21-22. templates ──────────────────────────────────────────
call list_templates '{}'
check "list_templates → no error"                "$(jget 'j.result.isError')" "false"
TEMPLATES=$(jget 'JSON.parse(j.result.content[0].text).templates.length')
check_re "list_templates returns templates"      "${TEMPLATES:-0}" '^[1-9][0-9]*$'

# ── 23-28. create → add_text → get_design workflow ────────────
DESIGN_NAME="MCP E2E Smoke $(date +%s)"
call create_design "{\"name\":\"$DESIGN_NAME\",\"width\":1080,\"height\":1080}"
check "create_design → no error"                 "$(jget 'j.result.isError')" "false"
DESIGN_ID=$(jget 'JSON.parse(j.result.content[0].text).design_id')
check_re "create_design → design_id (cuid)"      "${DESIGN_ID:-}" '^[a-z][a-z0-9]{20,}$'

call add_text "{\"design_id\":\"$DESIGN_ID\",\"text\":\"Hello from e2e\",\"x\":100,\"y\":100,\"fontSize\":72}"
check "add_text → no error"                      "$(jget 'j.result.isError')" "false"
ELEMENT_ID=$(jget 'JSON.parse(j.result.content[0].text).element_id')
check_re "add_text → element_id"                 "${ELEMENT_ID:-}" '^text_'

call get_design "{\"design_id\":\"$DESIGN_ID\"}"
check "get_design → no error"                    "$(jget 'j.result.isError')" "false"
check "get_design contains the added text"       "$(jget "j.result.content[0].text.includes('Hello from e2e')")" "true"

# ── 29. search ────────────────────────────────────────────────
call search_designs '{"query":"mcp e2e smoke"}'
check "search_designs finds the created design"  "$(jget "j.result.content[0].text.includes('$DESIGN_ID')")" "true"

# ── 30-31. export ─────────────────────────────────────────────
call export_design "{\"design_id\":\"$DESIGN_ID\",\"format\":\"svg\"}"
check "export_design svg → no error"             "$(jget 'j.result.isError')" "false"
check "export_design svg → real SVG payload"   "$(jget "j.result.content[0].text.includes('<svg')")" "true"

# ── 32-33. SSRF guard (live) ──────────────────────────────────
call add_image "{\"design_id\":\"$DESIGN_ID\",\"url\":\"http://169.254.169.254/latest/meta-data/\"}"
check "add_image to metadata IP → refused"       "$(jget 'j.result.isError')" "true"
check "SSRF refusal explains why"                "$(jget "j.result.content[0].text.toLowerCase().includes('private') || j.result.content[0].text.toLowerCase().includes('blocked')")" "true"
call add_image "{\"design_id\":\"$DESIGN_ID\",\"url\":\"file:///etc/passwd\"}"
check "add_image with file:// → refused"         "$(jget "j.result.isError === true && /only http/i.test(j.result.content[0].text)")" "true"

# ── 34-35. transport errors ───────────────────────────────────
post '{ this is not json'
check "invalid JSON → 400 + -32700"              "$HTTP|$(jget 'j.error.code')" "400|-32700"
post '{"jsonrpc":"2.0","id":55,"method":"no/such/method"}'
check "unknown method → -32601 + id echo"        "$HTTP|$(jget 'j.error.code')|$(jget 'j.id')" "200|-32601|55"

# ── 36. batch ─────────────────────────────────────────────────
post '[{"jsonrpc":"2.0","id":"a","method":"ping"},{"jsonrpc":"2.0","id":"b","method":"ping"}]'
check "batch → array with both ids"              "$(jget 'Array.isArray(j) && j.length === 2 && j.map(r => r.id).join(",")')" "a,b"

# ── 37. body cap ──────────────────────────────────────────────
node -e '
  const pad = "a".repeat(2 * 1024 * 1024);
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad }));' > "$TMP/big.json"
HTTP=$(curl -sS -o "$TMP/body" -w '%{http_code}' -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary @"$TMP/big.json" || echo 000)
BODY="$(cat "$TMP/body")"
check "2 MB body → 413 + -32002"                 "$HTTP|$(jget 'j.error.code')" "413|-32002"

# ── summary ───────────────────────────────────────────────────
echo "────────────────────────────────────────────────────────────"
echo "MCP e2e: $PASS passed, $FAIL failed (of $TOTAL assertions)"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
