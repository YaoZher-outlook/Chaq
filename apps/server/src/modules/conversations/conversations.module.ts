import { Module } from "@nestjs/common";
import { RealtimeModule } from "../../common/realtime.module";
import { AgentsModule } from "../agents/agents.module";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

@Module({
  imports: [AgentsModule, RealtimeModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService]
})
export class ConversationsModule {}
