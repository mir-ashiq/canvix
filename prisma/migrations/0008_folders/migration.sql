-- v0.14 (D6): dashboard folders
-- A Folder is a named group of the caller's designs. Attribution
-- mirrors Design/Media (ownerId for accounts, anonKey for anonymous
-- browsers); folders are private organization. Designs gain a NULLABLE
-- folderId — null = "All designs" (the root), so every pre-existing
-- row and every caller without folders behaves exactly as before.
-- Deleting a folder unfiles its designs (ON DELETE SET NULL): a folder
-- delete never destroys work, live or trashed.

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "anonKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_ownerId_idx" ON "Folder"("ownerId");

-- CreateIndex
CREATE INDEX "Folder_anonKey_idx" ON "Folder"("anonKey");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddColumn: Design.folderId (nullable — migration is a no-op for data)
ALTER TABLE "Design" ADD COLUMN "folderId" TEXT;

-- CreateIndex
CREATE INDEX "Design_folderId_idx" ON "Design"("folderId");

-- AddForeignKey: unfile on folder delete, never cascade-delete designs
ALTER TABLE "Design" ADD CONSTRAINT "Design_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
