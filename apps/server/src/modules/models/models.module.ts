import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";

@Module({
  imports: [UsersModule],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService]
})
export class ModelsModule {}
