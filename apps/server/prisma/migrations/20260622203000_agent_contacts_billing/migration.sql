ALTER TYPE "TokenTransactionKind" ADD VALUE 'AGENT_SERVICE_FEE';
ALTER TYPE "TokenTransactionKind" ADD VALUE 'AGENT_SERVICE_EARNING';

ALTER TABLE "Agent"
ADD COLUMN "serviceFee" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ModelCallLog"
ADD COLUMN "serviceFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "beneficiaryUserId" TEXT;

CREATE TABLE "AgentContact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "alias" TEXT,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentContact_userId_agentId_key" ON "AgentContact"("userId", "agentId");
CREATE INDEX "AgentContact_agentId_createdAt_idx" ON "AgentContact"("agentId", "createdAt");
CREATE INDEX "AgentContact_userId_updatedAt_idx" ON "AgentContact"("userId", "updatedAt");

ALTER TABLE "AgentContact"
ADD CONSTRAINT "AgentContact_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentContact"
ADD CONSTRAINT "AgentContact_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
