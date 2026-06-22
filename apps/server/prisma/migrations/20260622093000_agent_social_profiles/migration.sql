-- CreateEnum
CREATE TYPE "AgentPostVisibility" AS ENUM ('PUBLIC', 'RELATIONSHIPS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "AgentPostReactionKind" AS ENUM ('LIKE');

-- AlterTable
ALTER TABLE "Agent"
ADD COLUMN "coverUrl" TEXT,
ADD COLUMN "profileStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN "mood" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "AgentPost" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrls" TEXT[] NOT NULL,
    "mood" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "visibility" "AgentPostVisibility" NOT NULL DEFAULT 'PUBLIC',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPostReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AgentPostReactionKind" NOT NULL DEFAULT 'LIKE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPostReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPostComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentPost_agentId_createdAt_idx" ON "AgentPost"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPost_visibility_createdAt_idx" ON "AgentPost"("visibility", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPostReaction_postId_userId_kind_key" ON "AgentPostReaction"("postId", "userId", "kind");

-- CreateIndex
CREATE INDEX "AgentPostReaction_userId_createdAt_idx" ON "AgentPostReaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPostComment_postId_createdAt_idx" ON "AgentPostComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPostComment_userId_createdAt_idx" ON "AgentPostComment"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentPost" ADD CONSTRAINT "AgentPost_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPostReaction" ADD CONSTRAINT "AgentPostReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "AgentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPostReaction" ADD CONSTRAINT "AgentPostReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPostComment" ADD CONSTRAINT "AgentPostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "AgentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPostComment" ADD CONSTRAINT "AgentPostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the social publishing tool for existing agents.
INSERT INTO "AgentTool" ("id", "agentId", "name", "description", "updatedAt")
SELECT 'social-' || md5("id"), "id", 'publish_profile_post', 'Share a short update on the agent profile.', CURRENT_TIMESTAMP
FROM "Agent"
ON CONFLICT ("agentId", "name") DO NOTHING;
