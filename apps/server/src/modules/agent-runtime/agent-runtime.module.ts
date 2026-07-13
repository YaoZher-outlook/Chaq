import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { ModelsModule } from "../models/models.module";
import { AgentRuntimeService } from "./agent-runtime.service";

@Module({
  imports: [AgentsModule, ConversationsModule, ModelsModule],
  providers: [AgentRuntimeService],
  exports: [AgentRuntimeService]
})
export class AgentRuntimeModule {}
