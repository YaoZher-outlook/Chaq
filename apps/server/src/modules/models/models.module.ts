import { Module } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { UsersModule } from "../users/users.module";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";

@Module({
  imports: [UsersModule],
  controllers: [ModelsController],
  providers: [ModelsService, PrismaService],
  exports: [ModelsService]
})
export class ModelsModule {}
