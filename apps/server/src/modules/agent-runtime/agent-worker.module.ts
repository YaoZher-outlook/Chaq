import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../../common/prisma.service";
import { AgentsModule } from "../agents/agents.module";
import { AgentRuntimeModule } from "./agent-runtime.module";
import { AgentWorkerService } from "./agent-worker.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [process.env.CHAQ_ENV_FILE || "E:\\Environment\\Chaq\\server.env", ".env"]
    }),
    AgentsModule,
    AgentRuntimeModule
  ],
  providers: [PrismaService, AgentWorkerService]
})
export class AgentWorkerModule {}
