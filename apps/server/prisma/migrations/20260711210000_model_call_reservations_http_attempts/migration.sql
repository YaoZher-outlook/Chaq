CREATE TYPE "ModelCallPurpose" AS ENUM ('CLOUD_CHAT', 'AGENT_COMPLETION', 'EMBEDDING', 'DISTILLATION');
CREATE TYPE "ModelCallReservationStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED');
CREATE TYPE "AgentHttpAttemptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN');

CREATE TABLE "ModelCallReservation" (
  "id" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "purpose" "ModelCallPurpose" NOT NULL,
  "status" "ModelCallReservationStatus" NOT NULL DEFAULT 'PENDING',
  "userId" TEXT NOT NULL,
  "providerId" TEXT,
  "model" TEXT NOT NULL,
  "reservedTokens" INTEGER NOT NULL,
  "chargedTokens" INTEGER NOT NULL DEFAULT 0,
  "promptTokenLimit" INTEGER NOT NULL DEFAULT 0,
  "completionTokenLimit" INTEGER NOT NULL DEFAULT 0,
  "promptTokens" INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "serviceFee" INTEGER NOT NULL DEFAULT 0,
  "beneficiaryUserId" TEXT,
  "response" JSONB,
  "error" TEXT,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelCallReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelCallReservation_requestKey_key" ON "ModelCallReservation"("requestKey");
CREATE INDEX "ModelCallReservation_userId_status_createdAt_idx" ON "ModelCallReservation"("userId", "status", "createdAt");
CREATE INDEX "ModelCallReservation_providerId_createdAt_idx" ON "ModelCallReservation"("providerId", "createdAt");

ALTER TABLE "ModelCallReservation"
ADD CONSTRAINT "ModelCallReservation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelCallReservation"
ADD CONSTRAINT "ModelCallReservation_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "ModelProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AgentHttpToolAttempt" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "outboundKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "status" "AgentHttpAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "httpStatus" INTEGER,
  "responsePreview" TEXT,
  "error" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentHttpToolAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentHttpToolAttempt_idempotencyKey_key" ON "AgentHttpToolAttempt"("idempotencyKey");
CREATE INDEX "AgentHttpToolAttempt_agentId_status_createdAt_idx" ON "AgentHttpToolAttempt"("agentId", "status", "createdAt");
CREATE INDEX "AgentHttpToolAttempt_runId_createdAt_idx" ON "AgentHttpToolAttempt"("runId", "createdAt");
CREATE INDEX "AgentHttpToolAttempt_toolId_createdAt_idx" ON "AgentHttpToolAttempt"("toolId", "createdAt");

ALTER TABLE "AgentHttpToolAttempt"
ADD CONSTRAINT "AgentHttpToolAttempt_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentHttpToolAttempt"
ADD CONSTRAINT "AgentHttpToolAttempt_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentHttpToolAttempt"
ADD CONSTRAINT "AgentHttpToolAttempt_toolId_fkey"
FOREIGN KEY ("toolId") REFERENCES "AgentTool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
