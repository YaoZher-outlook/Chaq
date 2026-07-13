import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CoreModule } from "./common/core.module";
import { RealtimeModule } from "./common/realtime.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { MarketplaceModule } from "./modules/marketplace/marketplace.module";
import { ModelsModule } from "./modules/models/models.module";
import { SkillsModule } from "./modules/skills/skills.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { ConversationsModule } from "./modules/conversations/conversations.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [process.env.CHAQ_ENV_FILE || "apps/server/.env", ".env"]
    }),
    CoreModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    MarketplaceModule,
    ModelsModule,
    SkillsModule,
    AgentsModule,
    ConversationsModule,
    HealthModule
  ]
})
export class AppModule {}
