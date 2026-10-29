-- v0.11 — media store for audio/video uploads.
--
-- A/V files are too large for the dataURL-in-element pattern images use;
-- they live here as bytea and elements reference `/api/media/<id>`.
-- Uploads are chunked (serverless body limits), appended via a raw
-- `bytes || chunk` UPDATE, and marked complete by `finalizedAt`.
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "ownerId" TEXT,
    "anonKey" TEXT,
    "finalizedAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Media_ownerId_idx" ON "Media"("ownerId");
CREATE INDEX "Media_anonKey_idx" ON "Media"("anonKey");
CREATE INDEX "Media_finalizedAt_createdAt_idx" ON "Media"("finalizedAt", "createdAt");
