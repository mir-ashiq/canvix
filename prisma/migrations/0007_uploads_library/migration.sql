-- v0.14 (D1): persistent uploads library
-- Additive only: three nullable/defaulted columns on Media.
--   contentHash   — sha256 of the finalized bytes; finalize dedupes an
--                   upload against the owner's earlier identical upload
--                   (attribution-scoped: never across accounts)
--   name          — the original filename, surfaced in the library UI
--   keepInLibrary — library membership; true for every upload finalized
--                   from v0.14 on. The media orphan GC skips these rows
--                   (they are *kept*, not orphaned); --prune-library
--                   opts back in. Legacy audio/video rows keep false and
--                   behave exactly as before.

ALTER TABLE "Media" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "Media" ADD COLUMN "name" TEXT;
ALTER TABLE "Media" ADD COLUMN "keepInLibrary" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Media_contentHash_idx" ON "Media"("contentHash");
CREATE INDEX "Media_ownerId_keepInLibrary_idx" ON "Media"("ownerId", "keepInLibrary");
