import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [AgentsModule],
  controllers: [HealthController]
})
export class HealthModule {}
