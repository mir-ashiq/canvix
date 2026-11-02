-- v0.13 — plugin system install records (research/PLUGIN-SYSTEM.md §4.2).
--
-- Per-user snapshots of third-party plugin files, pinned at install
-- (sha256 per asset). Additive only: no existing table is touched, so
-- the rollback story is simply CANVIX_PLUGINS=0 (installs go dormant).
CREATE TABLE "PluginInstall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "PluginInstall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluginAsset" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    CONSTRAINT "PluginAsset_pkey" PRIMARY KEY ("id")
);

-- one install per (user, plugin); a reinstall replaces the row (and assets)
CREATE UNIQUE INDEX "PluginInstall_userId_pluginId_key" ON "PluginInstall"("userId", "pluginId");
CREATE INDEX "PluginInstall_userId_idx" ON "PluginInstall"("userId");
CREATE UNIQUE INDEX "PluginAsset_installId_path_key" ON "PluginAsset"("installId", "path");

-- referential integrity: deleting an install cascades its assets.
-- (Deleting a USER does not cascade installs — accounts have no
-- hard-delete path in Canvix today; if one appears, sweep first.)
ALTER TABLE "PluginAsset" ADD CONSTRAINT "PluginAsset_installId_fkey"
    FOREIGN KEY ("installId") REFERENCES "PluginInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
