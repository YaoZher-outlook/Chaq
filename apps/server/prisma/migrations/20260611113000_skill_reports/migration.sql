CREATE TABLE "SkillReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SkillReport_reporterId_idx" ON "SkillReport"("reporterId");
CREATE INDEX "SkillReport_skillId_idx" ON "SkillReport"("skillId");

ALTER TABLE "SkillReport"
  ADD CONSTRAINT "SkillReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SkillReport"
  ADD CONSTRAINT "SkillReport_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
