ALTER TABLE "ModelCallLog"
ADD COLUMN "agentRunId" TEXT,
ADD COLUMN "responseContent" TEXT;

CREATE UNIQUE INDEX "ModelCallLog_agentRunId_key" ON "ModelCallLog"("agentRunId");
