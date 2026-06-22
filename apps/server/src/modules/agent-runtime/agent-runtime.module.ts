import { Module } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AgentsModule } from "../agents/agents.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { ModelsModule } from "../models/models.module";
import { AgentRuntimeService } from "./agent-runtime.service";

@Module({
  imports: [AgentsModule, ConversationsModule, ModelsModule],
  providers: [PrismaService, AgentRuntimeService],
  exports: [AgentRuntimeService]
})
export class AgentRuntimeModule {}
