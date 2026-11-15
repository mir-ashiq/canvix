# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run db:generate
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN groupadd --system --gid 10001 canvix \
    && useradd --system --uid 10001 --gid canvix --home-dir /app --shell /usr/sbin/nologin canvix

WORKDIR /app
COPY --from=build --chown=canvix:canvix /app/.next/standalone ./
COPY --from=build --chown=canvix:canvix /app/.next/static ./.next/static
COPY --from=build --chown=canvix:canvix /app/public ./public
COPY --from=build --chown=canvix:canvix /app/node_modules ./node_modules
COPY --from=build --chown=canvix:canvix /app/package.json ./package.json
COPY --from=build --chown=canvix:canvix /app/prisma ./prisma
COPY --from=build --chown=canvix:canvix /app/scripts ./scripts
COPY --from=build --chown=canvix:canvix /app/src ./src
COPY --from=build --chown=canvix:canvix /app/tsconfig.json ./tsconfig.json
COPY --chown=canvix:canvix docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER canvix
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
