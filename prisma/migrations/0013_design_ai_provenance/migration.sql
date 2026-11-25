-- v0.32 (Unified Canvix AI): design provenance — the brief contract an
-- autonomous generation was verified against, persisted ON the design
-- it was applied to. Chat-agent refinements of the SAME design merge
-- the stored brief into every run's contract (mergeBriefs), so
-- required texts/colors cannot silently vanish during refinement.

-- CreateTable
CREATE TABLE "DesignProvenance" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "brief" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL DEFAULT 'passed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignProvenance_designId_key" ON "DesignProvenance"("designId");

-- AddForeignKey
ALTER TABLE "DesignProvenance" ADD CONSTRAINT "DesignProvenance_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;
