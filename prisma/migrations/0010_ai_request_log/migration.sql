-- v0.16.3 (A3): AI request log — the durable record behind /admin/logs.
-- AIUsage gains the columns the Logs view reads: the model id the slot
-- requested, the outcome status (HTTP code from the provider on
-- failures, or the guard-exit code: 403 rejected / 429 rate-limited /
-- 503 disabled-or-unconfigured), the provider round-trip duration and
-- a short scrubbed error reason. All nullable — existing rows stay
-- valid, and instances that never open /admin simply accumulate the
-- same telemetry they already did (swept after 90 days like TrafficStat).

ALTER TABLE "AIUsage" ADD COLUMN "model" TEXT;
ALTER TABLE "AIUsage" ADD COLUMN "status" INTEGER;
ALTER TABLE "AIUsage" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "AIUsage" ADD COLUMN "error" TEXT;
