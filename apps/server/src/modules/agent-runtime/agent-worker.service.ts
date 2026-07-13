import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AgentAutonomyMode, AgentRunStatus, AgentRunTrigger, AgentStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { PrismaService } from "../../common/prisma.service";
import { AgentQueueService } from "../agents/agent-queue.service";
import { agentRunQueueName, redisConnectionOptions } from "../agents/redis-options";
import { AgentRuntimeService } from "./agent-runtime.service";

@Injectable()
export class AgentWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentWorkerService.name);
  private worker?: Worker;
  private timer?: NodeJS.Timeout;
  private scheduling = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AgentQueueService) private readonly queue: AgentQueueService,
    @Inject(AgentRuntimeService) private readonly runtime: AgentRuntimeService
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      agentRunQueueName,
      async (job) => this.runtime.executeRun(String(job.data.runId)),
      {
        connection: redisConnectionOptions(),
        concurrency: Math.max(1, Number(process.env.AGENT_WORKER_CONCURRENCY ?? 4) || 4),
        lockDuration: 120_000
      }
    );
    this.worker.on("completed", (job) => this.logger.log(`Completed agent run ${job.data.runId}`));
    this.worker.on("failed", (job, error) => this.logger.error(`Agent run ${job?.data.runId ?? "unknown"} failed: ${error.message}`));
    await this.schedule();
    this.timer = setInterval(() => {
      void this.schedule().catch((error) => this.logger.error(`Agent scheduler failed: ${error instanceof Error ? error.message : String(error)}`));
    }, 30_000);
    this.logger.log(`Agent worker is listening on queue ${agentRunQueueName}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async schedule(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
      await this.recoverQueuedRuns();
      const now = new Date();
      const agents = await this.prisma.agent.findMany({
        where: {
          status: AgentStatus.ACTIVE,
          autonomyMode: AgentAutonomyMode.AUTONOMOUS,
          nextRunAt: { lte: now }
        },
        take: 100,
        orderBy: { nextRunAt: "asc" }
      });
      for (const agent of agents) {
        const isNewDay = agent.budgetResetAt.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
        const actionsUsed = isNewDay ? 0 : agent.actionsUsedToday;
        const tokensUsed = isNewDay ? 0 : agent.tokensUsedToday;
        if (isNewDay) {
          await this.prisma.agent.update({
            where: { id: agent.id },
            data: { actionsUsedToday: 0, tokensUsedToday: 0, budgetResetAt: now }
          });
        }
        if (actionsUsed >= agent.dailyActionBudget || tokensUsed >= agent.dailyTokenBudget) {
          const nextBudgetWindow = new Date(now);
          nextBudgetWindow.setUTCDate(nextBudgetWindow.getUTCDate() + 1);
          nextBudgetWindow.setUTCHours(0, 0, 5, 0);
          await this.prisma.agent.update({ where: { id: agent.id }, data: { nextRunAt: nextBudgetWindow } });
          continue;
        }
        const claimed = await this.prisma.agent.updateMany({
          where: { id: agent.id, nextRunAt: agent.nextRunAt },
          data: { nextRunAt: new Date(now.getTime() + agent.scheduleEveryMinutes * 60_000) }
        });
        if (!claimed.count) continue;
        const run = await this.prisma.agentRun.create({
          data: { agentId: agent.id, trigger: AgentRunTrigger.SCHEDULED, status: AgentRunStatus.QUEUED }
        });
        await this.queue.enqueueRun(run.id);
      }
    } finally {
      this.scheduling = false;
    }
  }

  private async recoverQueuedRuns(): Promise<void> {
    const now = new Date();
    const legacyStaleBefore = new Date(now.getTime() - 30 * 60_000);
    const recovered = await this.prisma.agentRun.updateMany({
      where: {
        status: AgentRunStatus.RUNNING,
        OR: [
          { leaseExpiresAt: { lt: now } },
          { leaseExpiresAt: null, startedAt: { lt: legacyStaleBefore } }
        ]
      },
      data: {
        status: AgentRunStatus.QUEUED,
        executionId: null,
        leaseExpiresAt: null,
        startedAt: null,
        error: "Recovered after the worker stopped before completing this run."
      }
    });
    if (recovered.count) this.logger.warn(`Recovered ${recovered.count} stale agent runs`);
    const rows = await this.prisma.agentRun.findMany({
      where: { status: AgentRunStatus.QUEUED, createdAt: { lt: new Date(Date.now() - 10_000) } },
      select: { id: true },
      take: 200
    });
    await Promise.all(rows.map((row) => this.queue.enqueueRun(row.id).catch(() => undefined)));
  }
}
