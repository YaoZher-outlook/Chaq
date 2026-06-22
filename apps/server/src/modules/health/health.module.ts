import { Module } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AgentsModule } from "../agents/agents.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [AgentsModule],
  controllers: [HealthController],
  providers: [PrismaService]
})
export class HealthModule {}
