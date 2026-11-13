-- v0.23: BYOK — per-user AI providers (profile page).
-- Signed-in users can save their own provider credentials and route
-- provider-backed features through them instead of the operator slots.

-- CreateTable
CREATE TABLE "UserAIProvider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "slots" TEXT NOT NULL DEFAULT 'text',
    "models" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAIProvider_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UserAIProvider" ADD CONSTRAINT "UserAIProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "UserAIProvider_userId_idx" ON "UserAIProvider"("userId");

