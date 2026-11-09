#!/bin/bash
# scripts/verify-wave3.sh — one-shot Wave 3 verification (sandbox):
# embedded Postgres + migrate deploy (through 0011) + seed (366) +
# dev server + targeted playwright e2e (wave3 + smoke). Everything in
# ONE shell because background processes don't outlive the session.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

export DATABASE_URL="postgresql://canvix:canvix@localhost:5433/canvix"
PGDIR=/tmp/pgembed
LOG=$PGDIR/verify-w3.log
: > "$LOG"

echo "── 1. embedded postgres ─────────────────────────────"
pkill -f 'pgembed/data3' 2>/dev/null || true
pkill -f 'start3.mjs' 2>/dev/null || true
for i in $(seq 1 15); do
  if node -e "const n=require('net');const s=n.connect(5433,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then sleep 1; else break; fi
done
rm -rf "$PGDIR/data3" "$PGDIR/ready3.marker"
mkdir -p "$PGDIR"
cat > "$PGDIR/start3.mjs" << 'EOF'
// ESM resolution is file-location based — /tmp has no node_modules, so
// import the repo's copy by absolute path (ROOT comes from the env).
const { default: EmbeddedPostgres } = await import(
  process.env.ROOT + '/node_modules/embedded-postgres/dist/index.js'
)
import { writeFileSync } from 'node:fs'
const pg = new EmbeddedPostgres({
  databaseDir: '/tmp/pgembed/data3',
  user: 'canvix',
  password: 'canvix',
  port: 5433,
  persistent: true,
})
await pg.initialise()
await pg.start()
await pg.createDatabase('canvix').catch(() => {})
const { Client } = (await import(process.env.ROOT + '/node_modules/pg/lib/index.js')).default
for (let i = 0; i < 60; i++) {
  try {
    const c = new Client({ connectionString: 'postgresql://canvix:canvix@127.0.0.1:5433/canvix' })
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    writeFileSync('/tmp/pgembed/ready3.marker', 'ok')
    console.log('PG READY (query verified)')
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}
setInterval(() => {}, 1 << 30)
EOF
setsid nohup env ROOT="$ROOT" node "$PGDIR/start3.mjs" >> "$LOG" 2>&1 < /dev/null &
for i in $(seq 1 150); do
  [ -f "$PGDIR/ready3.marker" ] && break
  sleep 1
done
[ -f "$PGDIR/ready3.marker" ] || { echo "PG FAILED"; tail -25 "$LOG"; exit 1; }
echo "PG up on 5433"

echo "── 2. migrate deploy (Wave 3 = no new migrations; must be a no-op) ──"
npx prisma migrate deploy 2>&1 | tail -3 | tee -a "$LOG"

echo "── 3. seed (366 templates) ──────────────────────────"
npx tsx prisma/seed.ts 2>&1 | grep -E "Seeding|Done" | tee -a "$LOG"

echo "── 4. dev server ────────────────────────────────────"
pkill -f 'next dev -p 3000' 2>/dev/null || true
sleep 1
# CANVIX_RATE_LIMITS=off — the wave3 suite registers/logs in several
# accounts; the sandbox IP budget (5/h) is reserved for production.
setsid nohup env CANVIX_RATE_LIMITS=off npx next dev -p 3000 > /tmp/pgembed/dev-w3.log 2>&1 < /dev/null &
for i in $(seq 1 150); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf http://localhost:3000/api/health >/dev/null || { echo "DEV FAILED"; tail -30 /tmp/pgembed/dev-w3.log; exit 1; }
echo "dev up"

echo "── 5. API spot-checks ───────────────────────────────"
HEALTH=$(curl -sf http://localhost:3000/api/health)
echo "health: $HEALTH"
echo "GET /api/templates → $(curl -sf http://localhost:3000/api/templates | node -e "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>console.log(JSON.parse(d).length+' templates'))")"

echo "── 6. playwright e2e (wave3 + smoke) ────────────────"
BASE_URL=http://localhost:3000 npx playwright test tests/e2e/wave3-editor-depth.spec.ts tests/e2e/smoke.spec.ts 2>&1 | tail -25

echo "── done ─────────────────────────────────────────────"
