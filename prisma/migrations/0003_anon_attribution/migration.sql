-- v0.9.1 — anonymous attribution for ownerless designs.
--
-- POST /api/designs stamps every anonymous creation with the sha256 of a
-- per-browser `canvix_anon` cookie, so "adopt all" can be scoped to the
-- designs this browser actually created (never another person's work).
-- Existing ownerless rows keep anonKey = NULL (legacy): they are excluded
-- from bulk adoption and can only be claimed one-by-one, deliberately.

ALTER TABLE "Design" ADD COLUMN "anonKey" TEXT;

-- Adopt-all scans WHERE "ownerId" IS NULL AND "anonKey" = <caller hash>.
CREATE INDEX "Design_anonKey_idx" ON "Design"("anonKey");
