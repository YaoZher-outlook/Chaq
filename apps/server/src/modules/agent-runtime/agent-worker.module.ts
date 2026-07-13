import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CoreModule } from "../../common/core.module";
import { AgentsModule } from "../agents/agents.module";
import { AgentRuntimeModule } from "./agent-runtime.module";
import { AgentWorkerService } from "./agent-worker.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [process.env.CHAQ_ENV_FILE || "apps/server/.env", ".env"]
    }),
    CoreModule,
    AgentsModule,
    AgentRuntimeModule
  ],
  providers: [AgentWorkerService]
})
export class AgentWorkerModule {}
