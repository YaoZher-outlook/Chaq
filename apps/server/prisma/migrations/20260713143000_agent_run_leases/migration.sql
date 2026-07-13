-- Runs left in RUNNING by an older worker have no lease owner. Requeue them
-- before introducing the single-active-run invariant.
UPDATE "AgentRun"
SET
  "status" = 'QUEUED',
  "startedAt" = NULL,
  "error" = 'Requeued while enabling leased agent-run execution.'
WHERE "status" = 'RUNNING';

ALTER TABLE "AgentRun"
  ADD COLUMN "executionId" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

-- Serializing runs per Agent makes the daily action/token counters enforceable
-- without holding a database transaction open across model and tool calls.
CREATE UNIQUE INDEX "AgentRun_one_running_per_agent"
  ON "AgentRun"("agentId")
  WHERE "status" = 'RUNNING';

CREATE INDEX "AgentRun_status_leaseExpiresAt_idx"
  ON "AgentRun"("status", "leaseExpiresAt");
