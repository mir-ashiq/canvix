-- v0.32.4: per-design agent run ledger — compact records of what each
-- Canvix AI run did on a design, fed back into the next run's context.

-- CreateTable
CREATE TABLE "DesignAgentRun" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    "request" VARCHAR(240) NOT NULL,
    "summary" VARCHAR(600) NOT NULL,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "findings" VARCHAR(1200),

    CONSTRAINT "DesignAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignAgentRun_designId_createdAt_idx" ON "DesignAgentRun"("designId", "createdAt");

-- AddForeignKey
ALTER TABLE "DesignAgentRun" ADD CONSTRAINT "DesignAgentRun_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;
