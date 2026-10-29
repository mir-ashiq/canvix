-- v0.10.1 — production incident 2026-10-29 remediation.
--
-- 1) Presence: the primary key was (id) alone — the participant id — but
--    participant identity is per-BROWSER and shared across every design
--    that browser opens. Opening a second design made every heartbeat's
--    upsert INSERT collide with the first design's row: P2002 on (id),
--    every ~15 s per client. Presence is inherently per-(design,
--    participant): make that the primary key and drop the now-redundant
--    unique index from 0001.
ALTER TABLE "Presence" DROP CONSTRAINT "Presence_pkey";
ALTER TABLE "Presence" ADD PRIMARY KEY ("designId", "id");
DROP INDEX IF EXISTS "Presence_designId_id_key";

-- 2) DesignEvent: the v0.10 offline client RETRIES flushes that fail
--    mid-request (network drop, function killed at its duration limit).
--    Replays used to duplicate ops. Persist the client's eventId and
--    enforce uniqueness per design — retried batches become no-ops.
--    Nullable: legacy rows have none (Postgres unique indexes skip NULLs).
ALTER TABLE "DesignEvent" ADD COLUMN "eventId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "DesignEvent_designId_eventId_key" ON "DesignEvent"("designId", "eventId");
