-- Canvix initial schema (all 7 tables + indexes)
-- Idempotent by design: safe to run on a fresh database AND on one that
-- was previously provisioned with `prisma db push` (v0.7 and earlier),
-- so switching hosts (e.g. Neon → Supabase) never dead-ends deploy.
-- Apply with:  npx prisma migrate deploy

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE IF NOT EXISTS "Design" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Untitled design',
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "thumbnail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'blank',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DesignVersion" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Version',
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Template" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "accent" TEXT NOT NULL DEFAULT '#00C4CC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DesignEvent" (
    "id" BIGSERIAL NOT NULL,
    "designId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Presence" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "cursor" JSONB,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Comment" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "elementId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorColor" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AIUsage" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DesignVersion_designId_createdAt_idx" ON "DesignVersion"("designId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Template_slug_key" ON "Template"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DesignEvent_designId_id_idx" ON "DesignEvent"("designId", "id" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Presence_designId_lastSeen_idx" ON "Presence"("designId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Presence_designId_id_key" ON "Presence"("designId", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Comment_designId_createdAt_idx" ON "Comment"("designId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Comment_designId_resolved_idx" ON "Comment"("designId", "resolved");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AIUsage_createdAt_idx" ON "AIUsage"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

