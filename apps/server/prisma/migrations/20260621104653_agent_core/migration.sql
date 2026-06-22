-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AgentAutonomyMode" AS ENUM ('MANUAL', 'COPILOT', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AgentVisibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "AgentMemoryKind" AS ENUM ('EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'SOCIAL', 'REFLECTION');

-- CreateEnum
CREATE TYPE "AgentGoalStatus" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentRunTrigger" AS ENUM ('USER_MESSAGE', 'AGENT_MESSAGE', 'SCHEDULED', 'GOAL', 'EVENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('HUMAN_AGENT', 'AGENT_AGENT', 'GROUP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ParticipantKind" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ConversationMessageKind" AS ENUM ('TEXT', 'SYSTEM', 'ACTION', 'SUMMARY');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentEventKind" AS ENUM ('OBSERVATION', 'THOUGHT', 'PLAN', 'ACTION', 'MESSAGE', 'MEMORY', 'GOAL', 'TASK', 'RELATIONSHIP', 'SYSTEM', 'ERROR');

-- CreateEnum
CREATE TYPE "RelationshipKind" AS ENUM ('OWNER', 'FAMILY', 'FRIEND', 'PARTNER', 'COLLEAGUE', 'ACQUAINTANCE', 'RIVAL', 'MENTOR', 'MENTEE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AgentToolKind" AS ENUM ('BUILTIN', 'HTTP');

-- CreateEnum
CREATE TYPE "ToolRiskLevel" AS ENUM ('SAFE', 'CONFIRM', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "KnowledgeSourceKind" AS ENUM ('NOTE', 'FILE', 'CHAT_IMPORT', 'URL', 'SKILL_MIGRATION');

-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "TokenTransactionKind" ADD VALUE 'AGENT_MODEL_USAGE';

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "legacySkillId" TEXT,
    "modelProviderId" TEXT,
    "model" TEXT,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "tagline" TEXT NOT NULL DEFAULT '',
    "biography" TEXT NOT NULL DEFAULT '',
    "persona" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "values" TEXT[],
    "worldview" TEXT NOT NULL DEFAULT '',
    "boundaries" TEXT NOT NULL DEFAULT '',
    "identity" JSONB NOT NULL,
    "tags" TEXT[],
    "status" "AgentStatus" NOT NULL DEFAULT 'DRAFT',
    "autonomyMode" "AgentAutonomyMode" NOT NULL DEFAULT 'COPILOT',
    "visibility" "AgentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "initiative" INTEGER NOT NULL DEFAULT 55,
    "reflectionDepth" INTEGER NOT NULL DEFAULT 2,
    "scheduleEveryMinutes" INTEGER NOT NULL DEFAULT 60,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "dailyTokenBudget" INTEGER NOT NULL DEFAULT 5000,
    "dailyActionBudget" INTEGER NOT NULL DEFAULT 30,
    "tokensUsedToday" INTEGER NOT NULL DEFAULT 0,
    "actionsUsedToday" INTEGER NOT NULL DEFAULT 0,
    "budgetResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentKnowledgeSource" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "KnowledgeSourceKind" NOT NULL,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'PROCESSING',
    "title" TEXT NOT NULL,
    "originUri" TEXT,
    "contentHash" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentKnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "keywords" TEXT[],
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "AgentMemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "salience" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "emotionalValence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "keywords" TEXT[],
    "embedding" JSONB,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialRelationship" (
    "id" TEXT NOT NULL,
    "sourceAgentId" TEXT NOT NULL,
    "targetKind" "ParticipantKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "kind" "RelationshipKind" NOT NULL DEFAULT 'ACQUAINTANCE',
    "customKind" TEXT,
    "affinity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trust" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "familiarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sentiment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interactionCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "lastInteractionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentGoal" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "parentGoalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AgentGoalStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "success" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "goalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "toolName" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTool" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AgentToolKind" NOT NULL DEFAULT 'BUILTIN',
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "riskLevel" "ToolRiskLevel" NOT NULL DEFAULT 'SAFE',
    "config" JSONB,
    "permissions" JSONB,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "createdByKind" "ParticipantKind" NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "participantKind" "ParticipantKind" NOT NULL,
    "participantId" TEXT NOT NULL,
    "displayNameSnapshot" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorKind" "ParticipantKind" NOT NULL,
    "authorId" TEXT,
    "kind" "ConversationMessageKind" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'DELIVERED',
    "replyToId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "conversationId" TEXT,
    "trigger" "AgentRunTrigger" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "triggerPayload" JSONB,
    "state" JSONB,
    "plan" JSONB,
    "outcome" JSONB,
    "error" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "chargedTokens" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "agentId" TEXT NOT NULL,
    "runId" TEXT,
    "kind" "AgentEventKind" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_legacySkillId_key" ON "Agent"("legacySkillId");

-- CreateIndex
CREATE INDEX "Agent_ownerId_status_idx" ON "Agent"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Agent_status_autonomyMode_nextRunAt_idx" ON "Agent"("status", "autonomyMode", "nextRunAt");

-- CreateIndex
CREATE INDEX "Agent_modelProviderId_idx" ON "Agent"("modelProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_ownerId_handle_key" ON "Agent"("ownerId", "handle");

-- CreateIndex
CREATE INDEX "AgentVersion_agentId_createdAt_idx" ON "AgentVersion"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVersion_agentId_version_key" ON "AgentVersion"("agentId", "version");

-- CreateIndex
CREATE INDEX "AgentKnowledgeSource_agentId_status_idx" ON "AgentKnowledgeSource"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentKnowledgeSource_contentHash_idx" ON "AgentKnowledgeSource"("contentHash");

-- CreateIndex
CREATE INDEX "AgentKnowledgeChunk_sourceId_idx" ON "AgentKnowledgeChunk"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentKnowledgeChunk_sourceId_position_key" ON "AgentKnowledgeChunk"("sourceId", "position");

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_kind_salience_idx" ON "AgentMemory"("agentId", "kind", "salience");

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_createdAt_idx" ON "AgentMemory"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialRelationship_sourceAgentId_affinity_idx" ON "SocialRelationship"("sourceAgentId", "affinity");

-- CreateIndex
CREATE INDEX "SocialRelationship_targetKind_targetId_idx" ON "SocialRelationship"("targetKind", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialRelationship_sourceAgentId_targetKind_targetId_key" ON "SocialRelationship"("sourceAgentId", "targetKind", "targetId");

-- CreateIndex
CREATE INDEX "AgentGoal_agentId_status_priority_idx" ON "AgentGoal"("agentId", "status", "priority");

-- CreateIndex
CREATE INDEX "AgentGoal_parentGoalId_idx" ON "AgentGoal"("parentGoalId");

-- CreateIndex
CREATE INDEX "AgentTask_agentId_status_scheduledFor_idx" ON "AgentTask"("agentId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AgentTask_goalId_idx" ON "AgentTask"("goalId");

-- CreateIndex
CREATE INDEX "AgentTool_agentId_enabled_idx" ON "AgentTool"("agentId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTool_agentId_name_key" ON "AgentTool"("agentId", "name");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_createdByKind_createdById_idx" ON "Conversation"("createdByKind", "createdById");

-- CreateIndex
CREATE INDEX "ConversationParticipant_participantKind_participantId_idx" ON "ConversationParticipant"("participantKind", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_participantKind_part_key" ON "ConversationParticipant"("conversationId", "participantKind", "participantId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_authorKind_authorId_idx" ON "ConversationMessage"("authorKind", "authorId");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_status_createdAt_idx" ON "AgentRun"("agentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_idx" ON "AgentRun"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_idempotencyKey_key" ON "AgentEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentEvent_agentId_createdAt_idx" ON "AgentEvent"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_runId_idx" ON "AgentEvent"("runId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_legacySkillId_fkey" FOREIGN KEY ("legacySkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_modelProviderId_fkey" FOREIGN KEY ("modelProviderId") REFERENCES "ModelProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnowledgeSource" ADD CONSTRAINT "AgentKnowledgeSource_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnowledgeChunk" ADD CONSTRAINT "AgentKnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AgentKnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialRelationship" ADD CONSTRAINT "SocialRelationship_sourceAgentId_fkey" FOREIGN KEY ("sourceAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGoal" ADD CONSTRAINT "AgentGoal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGoal" ADD CONSTRAINT "AgentGoal_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "AgentGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "AgentGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTool" ADD CONSTRAINT "AgentTool_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
