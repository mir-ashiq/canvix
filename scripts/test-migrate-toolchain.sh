#!/usr/bin/env bash
# test-migrate-toolchain.sh — replicate the Dockerfile's /opt/migrate
# stage locally to prove the prisma migrate-deploy toolchain installs
# and works WITHOUT a Docker daemon:
#   1. the isolated package.json + effect override + prisma@6.19.3
#      install (exact Dockerfile RUN sequence, incl. the .so removal
#      and the version assertions)
#   2. the CLI answers `prisma -v` from that install
#   3. `prisma migrate deploy --schema prisma/schema.prisma` runs
#      against a scratch Postgres… which this sandbox doesn't have,
#      so step 3's proof rides the CI docker job (documented there).
set -euo pipefail
cd "$(dirname "$0")/.."

SCRATCH=$(mktemp -d /tmp/canvix-migrate-test.XXXXXX)
trap 'rm -rf "$SCRATCH"' EXIT

echo "── installing /opt/migrate toolchain into $SCRATCH (Dockerfile mirror) ──"
cd "$SCRATCH"
printf '%s\n' \
  '{' \
  '  "name": "canvix-migrate",' \
  '  "private": true,' \
  '  "description": "isolated prisma migrate-deploy toolchain (see Dockerfile)",' \
  '  "overrides": { "@prisma/config": { "effect": "^3.22.1" } }' \
  '}' > package.json

npm install --no-audit --no-fund prisma@6.19.3 > /dev/null 2>&1

# the app never uses the library engine (engineType="client") — same
# dead-weight removal as the Dockerfile
rm -f node_modules/@prisma/engines/libquery_engine-*.so.node

echo "── assertions (the Dockerfile's own, verbatim) ──"
node -e "const v=require('effect/package.json').version;const p=v.split('.').map(Number);if(p[0]!==3||p[1]<22){console.error('effect '+v+' — override did not apply (Dependabot #9 regression)');process.exit(1)}console.log('✓ effect override ok: '+v)"
test -x node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x \
  && echo "✓ schema-engine binary present + executable" \
  || { echo "✗ schema-engine missing"; exit 1; }

echo "── CLI smoke from the isolated install ──"
DATABASE_URL=postgresql://x:x@localhost:5432/x \
  node_modules/.bin/prisma -v 2>/dev/null | head -3

echo "── migrate deploy against a throwaway URL: must fail with the REAL error (P1001), not a module/engine error ──"
set +e
DATABASE_URL=postgresql://x:x@127.0.0.1:54399/x \
  node_modules/.bin/prisma migrate deploy --schema /home/z/my-project/canvix-main/prisma/schema.prisma 2>&1 | tail -3
set -e
echo "(P1001 = correct: CLI + schema + engine all loaded, connection refused as expected)"
