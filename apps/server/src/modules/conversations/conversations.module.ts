import { Module } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { RealtimeModule } from "../../common/realtime.module";
import { AgentsModule } from "../agents/agents.module";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

@Module({
  imports: [AgentsModule, RealtimeModule],
  controllers: [ConversationsController],
  providers: [PrismaService, ConversationsService],
  exports: [ConversationsService]
})
export class ConversationsModule {}
