import { Module } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { ModelsModule } from "../models/models.module";
import { UsersModule } from "../users/users.module";
import { AgentQueueService } from "./agent-queue.service";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";

@Module({
  imports: [UsersModule, ModelsModule],
  controllers: [AgentsController],
  providers: [PrismaService, AgentQueueService, AgentsService],
  exports: [AgentQueueService, AgentsService, ModelsModule]
})
export class AgentsModule {}
