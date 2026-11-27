-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserAIProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "slots" TEXT NOT NULL DEFAULT 'text',
    "models" JSONB NOT NULL DEFAULT {},
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserAIProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'designs:read',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Untitled design',
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "pages" JSONB NOT NULL DEFAULT [],
    "thumbnail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'blank',
    "ownerId" TEXT,
    "anonKey" TEXT,
    "folderId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Design_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Design_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignProvenance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "brief" JSONB NOT NULL DEFAULT {},
    "outcome" TEXT NOT NULL DEFAULT 'passed',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesignProvenance_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "anonKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Version',
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesignVersion_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "accent" TEXT NOT NULL DEFAULT '#00C4CC',
    "fields" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DesignEvent" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "eventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Presence" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "cursor" JSONB,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("designId", "id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "elementId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorColor" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BLOB NOT NULL,
    "ownerId" TEXT,
    "anonKey" TEXT,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT,
    "name" TEXT,
    "keepInLibrary" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "status" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PluginInstall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PluginAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "sha256" TEXT NOT NULL,
    CONSTRAINT "PluginAsset_installId_fkey" FOREIGN KEY ("installId") REFERENCES "PluginInstall" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrafficStat" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "day" DATETIME NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "DailyActive" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "day" DATETIME NOT NULL,
    "actor" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UserTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "accent" TEXT NOT NULL DEFAULT '#00C4CC',
    "ownerId" TEXT,
    "anonKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BrandKitRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'My brand',
    "colors" JSONB NOT NULL,
    "palettes" JSONB NOT NULL,
    "headingFont" TEXT NOT NULL DEFAULT 'Montserrat',
    "bodyFont" TEXT NOT NULL DEFAULT 'Inter',
    "logos" JSONB NOT NULL,
    "ownerId" TEXT,
    "anonKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DesignAgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "findings" TEXT,
    CONSTRAINT "DesignAgentRun_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "UserAIProvider_userId_idx" ON "UserAIProvider"("userId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "Design_ownerId_idx" ON "Design"("ownerId");

-- CreateIndex
CREATE INDEX "Design_anonKey_idx" ON "Design"("anonKey");

-- CreateIndex
CREATE INDEX "Design_folderId_idx" ON "Design"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignProvenance_designId_key" ON "DesignProvenance"("designId");

-- CreateIndex
CREATE INDEX "Folder_ownerId_idx" ON "Folder"("ownerId");

-- CreateIndex
CREATE INDEX "Folder_anonKey_idx" ON "Folder"("anonKey");

-- CreateIndex
CREATE INDEX "DesignVersion_designId_createdAt_idx" ON "DesignVersion"("designId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Template_slug_key" ON "Template"("slug");

-- CreateIndex
CREATE INDEX "DesignEvent_designId_id_idx" ON "DesignEvent"("designId", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DesignEvent_designId_eventId_key" ON "DesignEvent"("designId", "eventId");

-- CreateIndex
CREATE INDEX "Presence_designId_lastSeen_idx" ON "Presence"("designId", "lastSeen");

-- CreateIndex
CREATE INDEX "Comment_designId_createdAt_idx" ON "Comment"("designId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_designId_resolved_idx" ON "Comment"("designId", "resolved");

-- CreateIndex
CREATE INDEX "Media_ownerId_idx" ON "Media"("ownerId");

-- CreateIndex
CREATE INDEX "Media_anonKey_idx" ON "Media"("anonKey");

-- CreateIndex
CREATE INDEX "Media_finalizedAt_createdAt_idx" ON "Media"("finalizedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Media_contentHash_idx" ON "Media"("contentHash");

-- CreateIndex
CREATE INDEX "Media_ownerId_keepInLibrary_idx" ON "Media"("ownerId", "keepInLibrary");

-- CreateIndex
CREATE INDEX "AIUsage_createdAt_idx" ON "AIUsage"("createdAt");

-- CreateIndex
CREATE INDEX "PluginInstall_userId_idx" ON "PluginInstall"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginInstall_userId_pluginId_key" ON "PluginInstall"("userId", "pluginId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginAsset_installId_path_key" ON "PluginAsset"("installId", "path");

-- CreateIndex
CREATE INDEX "TrafficStat_day_idx" ON "TrafficStat"("day");

-- CreateIndex
CREATE UNIQUE INDEX "TrafficStat_day_route_method_status_key" ON "TrafficStat"("day", "route", "method", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyActive_day_actor_key" ON "DailyActive"("day", "actor");

-- CreateIndex
CREATE INDEX "UserTemplate_ownerId_idx" ON "UserTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "UserTemplate_anonKey_idx" ON "UserTemplate"("anonKey");

-- CreateIndex
CREATE INDEX "BrandKitRecord_ownerId_idx" ON "BrandKitRecord"("ownerId");

-- CreateIndex
CREATE INDEX "BrandKitRecord_anonKey_idx" ON "BrandKitRecord"("anonKey");

-- CreateIndex
CREATE INDEX "DesignAgentRun_designId_createdAt_idx" ON "DesignAgentRun"("designId", "createdAt");
