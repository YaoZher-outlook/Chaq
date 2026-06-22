import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { agentRunQueueName, redisConnectionOptions } from "./redis-options";

@Injectable()
export class AgentQueueService implements OnModuleDestroy {
  private readonly queue = new Queue(agentRunQueueName, {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 2_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 }
    }
  });

  async enqueueRun(runId: string, delay = 0): Promise<void> {
    await this.queue.add("agent.run", { runId }, { jobId: runId, delay: Math.max(0, delay) });
  }

  async counts(): Promise<{ queued: number; running: number }> {
    const counts = await this.queue.getJobCounts("waiting", "delayed", "active");
    return {
      queued: (counts.waiting ?? 0) + (counts.delayed ?? 0),
      running: counts.active ?? 0
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
