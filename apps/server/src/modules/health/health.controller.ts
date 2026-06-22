import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AgentQueueService } from "../agents/agent-queue.service";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AgentQueueService) private readonly queue: AgentQueueService
  ) {}

  @Get("live")
  live() {
    return { status: "ok", service: "chaq-api", time: new Date().toISOString() };
  }

  @Get("ready")
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const queue = await this.queue.counts();
      return { status: "ok", database: "ready", redis: "ready", queue, time: new Date().toISOString() };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: "degraded",
        message: error instanceof Error ? error.message : String(error),
        time: new Date().toISOString()
      });
    }
  }
}
