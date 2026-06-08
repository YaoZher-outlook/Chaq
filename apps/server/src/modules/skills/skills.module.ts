import { Module } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { ModelsModule } from "../models/models.module";
import { UsersModule } from "../users/users.module";
import { SkillsController } from "./skills.controller";
import { SkillsService } from "./skills.service";

@Module({
  imports: [UsersModule, ModelsModule],
  controllers: [SkillsController],
  providers: [SkillsService, PrismaService],
  exports: [SkillsService]
})
export class SkillsModule {}
