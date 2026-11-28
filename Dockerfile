# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────
# Canvix — Docker image (WP1: deployment & API trust)
#
# WHAT YOU GET
#   A single-image, two-container self-host: this app image plus any
#   Postgres 17 (docker-compose.yml wires both). One command, no
#   Node toolchain on the host, no build step for the operator.
#
#   docker compose up -d     → app on http://localhost:3000,
#                              migrations applied automatically on
#                              boot, template library syncing itself
#                              from code (no seed step)
#
# SHAPE (multi-stage, three stages)
#
#   deps     — npm ci (the lockfile is the contract). postinstall
#              runs `prisma generate` + scripts/patch-prisma-wasm.mjs
#              exactly like a contributor machine, so the generated
#              client and the patched runtime land here.
#
#   builder  — `npm run build` (next build + the standalone copy
#              steps in scripts/build.mjs, which already place
#              .next/static and public/ inside .next/standalone).
#              Docker is just another consumer of the artifact
#              every self-hosted Node deploy already uses.
#
#   runner   — node:22-slim (bookworm) + only what the server needs:
#              the standalone tree (server.js, traced node_modules —
#              sharp, pg, @prisma/client + wasm), the prisma/ dir
#              (schema + migrations) and a small /opt/migrate
#              toolchain for `prisma migrate deploy` at boot. No
#              build toolchain, no devDependencies, no bundler.
#
# WHY THE PRISMA SPLIT WORKS
#   The app is rust-free (engineType="client": the generated client
#   compiles queries to WASM at runtime — prisma/schema.prisma).
#   Only `prisma migrate deploy` runs a native binary (the
#   schema-engine, ~40 MB, prebuilt per arch for x64
#   (debian-openssl-3.0.x) and aarch64
#   (linux-arm64-openssl-3.0.x)), and only at boot. So the runner
#   carries exactly one native piece: the migration engine.
#
# BASE IMAGE
#   node:22-slim bookworm: Prisma ships the schema-engine for both
#   arches' bookworm targets; slim keeps the glibc + openssl 3 the
#   binary needs (the openssl CLI package is installed in the
#   runner so Prisma's own detection picks the right one per arch —
#   issue #99). The CI wall (lint-unit, e2e) runs Node 22 — the
#   runner matches the tested version.
# ─────────────────────────────────────────────────────────────────

# ── 1. deps ───────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

# postinstall needs these: `prisma generate` reads prisma/schema.
# prisma, patch-prisma-wasm.mjs patches what it generates. Anything
# else in the context would just bust the layer cache.
COPY package.json package-lock.json ./
COPY prisma/schema.prisma prisma/schema.prisma
COPY scripts/patch-prisma-wasm.mjs scripts/patch-prisma-wasm.mjs
RUN npm ci --no-audit --no-fund \
 # fail LOUDLY if the generated client / wasm patch did not land —
 # a silently skipped postinstall must be a build error here, not a
 # runtime 500 on every DB route
 && test -f src/generated/prisma/internal/class.ts \
 && grep -q "WebAssembly.compile" src/generated/prisma/internal/class.ts \
 || (echo "✗ prisma generate / wasm patch did not run — is postinstall intact?" && exit 1)

# ── 2. builder ────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

# scripts/build.mjs branches on WORKERS_CI (Cloudflare Workers
# Builds) — Docker is the plain standalone path, so pin it off.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .
ENV WORKERS_CI=
RUN npm run build \
 && test -f .next/standalone/server.js \
 || (echo "✗ next build did not emit .next/standalone" && exit 1)

# ── 3. runner ─────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

# dumb-init: PID 1 signal handling (SIGTERM reaches node, so
# `docker stop` drains in-flight requests instead of the 10 s kill).
# curl: the container healthcheck. openssl: NOT for the runtime —
# the app's prisma client is WASM — but for Prisma's own libssl
# DETECTION at image build and boot (the CLI shells out to
# `openssl version` to pick the engine binaryTarget). Without the
# CLI package, detection fails on a bare slim image and Prisma
# defaults to the openssl-1.1.x target, which bookworm (libssl3
# only) cannot run — observed on aarch64 (issue #99), where the
# correct target is linux-arm64-openssl-3.0.x. From the slim
# image's own bookworm apt — no extra repos.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# Non-root. The app persists everything to Postgres (media included:
# bytea columns, not files), so /app needs no writable subvolume.
RUN groupadd --system --gid 1001 canvix \
 && useradd --system --uid 1001 --gid canvix canvix

# The standalone server Next's tracer assembled — server.js, the
# traced node_modules (sharp, pg, @prisma/client + wasm) AND (from
# scripts/build.mjs) .next/static + public/ inside it. One copy.
COPY --from=builder --chown=canvix:canvix /app/.next/standalone ./

# /opt/migrate: the prisma CLI toolchain for migrate-on-boot
# (docker-entrypoint.sh). Installed from its own minimal
# package.json so it CANNOT pull the app's dependency tree, pinned
# to the exact CLI version package-lock.json carries, and carrying
# the same effect override as the app — the @prisma/config→effect
# pin is why Dependabot #9 needed an override in the first place;
# without it the image would boot a known-vulnerable effect on
# every start. The trailing node check makes a regression loud.
RUN mkdir -p /opt/migrate \
 && cd /opt/migrate \
 && printf '%s\n' \
      '{' \
      '  "name": "canvix-migrate",' \
      '  "private": true,' \
      '  "description": "isolated prisma migrate-deploy toolchain (see Dockerfile)",' \
      '  "overrides": { "@prisma/config": { "effect": "^3.22.1" } }' \
      '}' > package.json \
 && npm install --no-audit --no-fund prisma@6.19.3 \
 # the app never uses the library engine (engineType="client"), so
 # the CLI's downloaded query-engine .so is dead weight in the image
 && rm -f node_modules/@prisma/engines/libquery_engine-*.so.node \
 && node -e "const v=require('effect/package.json').version;const p=v.split('.').map(Number);if(p[0]!==3||p[1]<22){console.error('effect '+v+' — override did not apply (Dependabot #9 regression)');process.exit(1)}console.log('effect override ok: '+v)" \
 # v0.34.3 (issue #99): the guard is ARCH-AGNOSTIC. The binary name
 # is the per-arch binaryTarget — schema-engine-debian-openssl-3.0.x
 # on x64, schema-engine-linux-arm64-openssl-3.0.x on aarch64 — so
 # the old exact-name test could never pass on arm. The glob accepts
 # whichever one this arch resolved to (with the openssl CLI
 # installed above, detection is correct on both) and still fails
 # loudly when none exists.
 && ls node_modules/@prisma/engines/schema-engine-* >/dev/null 2>&1 \
 || (echo "✗ migrate toolchain install failed" && exit 1)

# schema + migrations for migrate deploy; the entrypoint runs the
# CLI from /opt/migrate/node_modules/.bin/prisma
COPY --chown=canvix:canvix prisma ./prisma
COPY --chown=canvix:canvix docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# The standalone server binds process.env.HOSTNAME || 0.0.0.0 — but
# Docker sets HOSTNAME to the container id, which server.js would try
# (and fail) to bind. The entrypoint re-asserts it; the ENV is the
# default for anyone exec-ing a shell in the image.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

USER canvix
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["/app/docker-entrypoint.sh"]
