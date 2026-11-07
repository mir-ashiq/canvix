-- v0.16 (A1): admin console
-- Three tables + one column:
--   User.role        — "user" | "admin"; effective admin ALSO honours the
--                      CANVIX_ADMIN_USERS env bootstrap (fail-closed both ways).
--   AppConfig        — instance-wide operator config (AI provider, models,
--                      feature flags, app settings) written from /admin.
--   TrafficStat      — per-day aggregate API counters (counts only, never
--                      ids/IPs/query strings) fed by the withLogging wrapper.
--   DailyActive      — one row per (UTC day, actor) for the DAU chart.
-- Everything is additive: an instance that never opens /admin behaves
-- exactly as before (role defaults to "user", no config rows, counters
-- simply accumulate and can be switched off with CANVIX_TRAFFIC=0).

-- AddColumn: User.role (default keeps every existing account a plain user)
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- CreateTable: instance configuration store
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable: aggregate traffic counters
CREATE TABLE "TrafficStat" (
    "id" BIGSERIAL NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrafficStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one upsert target + the day-range scans the console runs
CREATE UNIQUE INDEX "TrafficStat_day_route_method_status_key" ON "TrafficStat"("day", "route", "method", "status");
CREATE INDEX "TrafficStat_day_idx" ON "TrafficStat"("day");

-- CreateTable: daily active actors
CREATE TABLE "DailyActive" (
    "id" BIGSERIAL NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,

    CONSTRAINT "DailyActive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the (day, actor) upsert target
CREATE UNIQUE INDEX "DailyActive_day_actor_key" ON "DailyActive"("day", "actor");
