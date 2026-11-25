-- v0.32.1 (Unified Canvix AI hardening, review P1): server-side
-- verification state on design provenance. The design save now
-- re-validates the stored brief against the SAVED pages and flips
-- `verified` — stored provenance carries proof, not a client's
-- claim. `verifiedAt` binds the proof to the document version it
-- was checked against.

-- AlterTable
ALTER TABLE "DesignProvenance" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "verifiedAt" TIMESTAMP(3);
