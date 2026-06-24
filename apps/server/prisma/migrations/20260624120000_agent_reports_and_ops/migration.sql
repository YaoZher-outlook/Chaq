-- Moderation reports for public/unlisted Agent review and marketplace Skill review.

CREATE TYPE "SkillReportStatus" AS ENUM ('PENDING', 'DISMISSED', 'ACTIONED');

ALTER TABLE "SkillReport"
  ADD COLUMN "status" "SkillReportStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "adminNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "SkillReport_status_createdAt_idx" ON "SkillReport"("status", "createdAt");

ALTER TABLE "SkillReport"
  ADD CONSTRAINT "SkillReport_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "AgentReportStatus" AS ENUM ('PENDING', 'DISMISSED', 'ACTIONED');

CREATE TABLE "AgentReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "AgentReportStatus" NOT NULL DEFAULT 'PENDING',
  "adminNote" TEXT NOT NULL DEFAULT '',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentReport_status_createdAt_idx" ON "AgentReport"("status", "createdAt");
CREATE INDEX "AgentReport_agentId_idx" ON "AgentReport"("agentId");
CREATE INDEX "AgentReport_reporterId_idx" ON "AgentReport"("reporterId");

ALTER TABLE "AgentReport"
  ADD CONSTRAINT "AgentReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentReport"
  ADD CONSTRAINT "AgentReport_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentReport"
  ADD CONSTRAINT "AgentReport_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
