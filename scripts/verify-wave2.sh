#!/bin/bash
# scripts/verify-wave2.sh — one-shot Wave 2 verification (sandbox):
# embedded Postgres + migrate deploy (incl. 0011) + seed (366) +
# API spot-checks + targeted playwright e2e. Everything in ONE shell
# because background processes don't outlive the invoking session.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="postgresql://canvix:canvix@localhost:5433/canvix"
PGDIR=/tmp/pgembed
LOG=$PGDIR/verify.log
: > "$LOG"

echo "── 1. embedded postgres ─────────────────────────────"
# kill anything left over from a previous run (port + data dir races)
pkill -f 'pgembed/data2' 2>/dev/null || true
pkill -f 'start2.mjs' 2>/dev/null || true
for i in $(seq 1 15); do
  if node -e "const n=require('net');const s=n.connect(5433,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then sleep 1; else break; fi
done
rm -rf "$PGDIR/data2" "$PGDIR/ready.marker"
cd "$PGDIR"
cat > start2.mjs << 'EOF'
import EmbeddedPostgres from 'embedded-postgres'
import { writeFileSync } from 'node:fs'
const pg = new EmbeddedPostgres({
  databaseDir: '/tmp/pgembed/data2',
  user: 'canvix',
  password: 'canvix',
  port: 5433,
  persistent: true,
})
await pg.initialise()
await pg.start()
await pg.createDatabase('canvix').catch(() => {})
// only declare readiness after a real query round-trips
const { Client } = await import('pg')
for (let i = 0; i < 60; i++) {
  try {
    const c = new Client({ connectionString: 'postgresql://canvix:canvix@127.0.0.1:5433/canvix' })
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    writeFileSync('/tmp/pgembed/ready.marker', 'ok')
    console.log('PG READY (query verified)')
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}
setInterval(() => {}, 1 << 30)
EOF
setsid nohup node start2.mjs >> "$LOG" 2>&1 < /dev/null &
for i in $(seq 1 60); do
  [ -f "$PGDIR/ready.marker" ] && break
  sleep 1
done
[ -f "$PGDIR/ready.marker" ] || { echo "PG FAILED"; tail -25 "$LOG"; exit 1; }
echo "PG up on 5433"
cd - >/dev/null

echo "── 2. migrate deploy (incl. 0011_wave2) ─────────────"
npx prisma migrate deploy 2>&1 | tail -4 | tee -a "$LOG"

echo "── 3. seed (366 templates) ──────────────────────────"
npx tsx prisma/seed.ts 2>&1 | grep -E "Seeding|Done" | tee -a "$LOG"

echo "── 4. DB spot-checks ────────────────────────────────"
cat > /tmp/wave2-dbcheck.mts << 'EOC'
import { createScriptClient } from '/home/z/my-project/repos/canvix/src/lib/db-script'
const db = createScriptClient()
const total = await db.template.count()
const smartRows = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "Template" WHERE "fields" IS NOT NULL')
const smart = smartRows[0].n
const ut = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "UserTemplate"')
const bk = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "BrandKitRecord"')
console.log('templates:', total, '| smart:', smart, '| UserTemplate table:', ut[0].n, '| BrandKitRecord table:', bk[0].n)
const cert = await db.template.findUnique({ where: { slug: 'certificate-excellence' } })
console.log('certificate fields:', cert?.fields ? (cert.fields as unknown[]).length : 'MISSING')
const aurora = await db.template.findUnique({ where: { slug: 'roastery-badge-logo-aurora' } })
console.log('aurora variant seeded:', aurora ? 'yes' : 'MISSING')
await db.$disconnect()
EOC
npx tsx /tmp/wave2-dbcheck.mts 2>&1 | tee -a "$LOG"

echo "── 5. dev server ────────────────────────────────────"
pkill -f 'next dev -p 3000' 2>/dev/null || true
sleep 1
setsid nohup npx next dev -p 3000 > /tmp/pgembed/dev.log 2>&1 < /dev/null &
for i in $(seq 1 120); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf http://localhost:3000/api/health >/dev/null || { echo "DEV FAILED"; tail -30 /tmp/pgembed/dev.log; exit 1; }
echo "dev up"

echo "── 6. API spot-checks ───────────────────────────────"
COUNT=$(curl -sf http://localhost:3000/api/templates | node -e "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
FIELDS=$(curl -sf http://localhost:3000/api/templates | node -e "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>{const t=JSON.parse(d);const c=t.find((x)=>x.slug==='certificate-excellence');console.log(c?.fields?.length ?? 'MISSING')})")
CACHE=$(curl -sI http://localhost:3000/api/templates | grep -i cache-control | head -1)
echo "GET /api/templates → $COUNT templates; certificate fields: $FIELDS"
echo "cache-control: $CACHE"
echo "GET /api/fonts/custom → $(curl -s http://localhost:3000/api/fonts/custom)"
echo "GET /api/icons (no params) → $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/icons) (expect 400)"
echo "GET /api/icons?q=<bad> → $(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/api/icons?q=%24%7Bjndi%7D') (expect 400)"
echo "GET /api/brand-kits → $(curl -s http://localhost:3000/api/brand-kits)"

echo "── 7. playwright e2e (wave2 + smoke) ────────────────"
BASE_URL=http://localhost:3000 npx playwright test tests/e2e/wave2-assets-templates.spec.ts tests/e2e/smoke.spec.ts 2>&1 | tail -20

echo "── done ─────────────────────────────────────────────"
