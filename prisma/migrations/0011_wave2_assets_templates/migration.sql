-- v0.17 (Wave 2): asset & template ecosystem
-- Two tables:
--   UserTemplate  — "Save as template" from the editor; attribution
--                   mirrors designs (account OR anon cookie hash).
--   BrandKitRecord — server-side brand kits (colours, palettes, fonts,
--                   logos) synced from the Brand panel.
-- Upgrade-safe: both are new tables, no changes to existing ones.

-- CreateTable
CREATE TABLE "UserTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "accent" TEXT NOT NULL DEFAULT '#00C4CC',
    "ownerId" TEXT,
    "anonKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKitRecord" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My brand',
    "colors" JSONB NOT NULL,
    "palettes" JSONB NOT NULL,
    "headingFont" TEXT NOT NULL DEFAULT 'Montserrat',
    "bodyFont" TEXT NOT NULL DEFAULT 'Inter',
    "logos" JSONB NOT NULL,
    "ownerId" TEXT,
    "anonKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTemplate_ownerId_idx" ON "UserTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "UserTemplate_anonKey_idx" ON "UserTemplate"("anonKey");

-- CreateIndex
CREATE INDEX "BrandKitRecord_ownerId_idx" ON "BrandKitRecord"("ownerId");

-- CreateIndex
CREATE INDEX "BrandKitRecord_anonKey_idx" ON "BrandKitRecord"("anonKey");

-- AddForeignKey
ALTER TABLE "UserTemplate" ADD CONSTRAINT "UserTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKitRecord" ADD CONSTRAINT "BrandKitRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- v0.17 (Wave 2): smart-template field declarations on built-in templates
ALTER TABLE "Template" ADD COLUMN "fields" JSONB;
