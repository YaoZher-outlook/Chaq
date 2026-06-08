import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "./common/prisma.service";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { MarketplaceModule } from "./modules/marketplace/marketplace.module";
import { ModelsModule } from "./modules/models/models.module";
import { SkillsModule } from "./modules/skills/skills.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    UsersModule,
    MarketplaceModule,
    ModelsModule,
    SkillsModule
  ],
  providers: [PrismaService],
  exports: [PrismaService]
})
export class AppModule {}
