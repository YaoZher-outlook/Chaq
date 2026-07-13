import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";

@Module({
  imports: [UsersModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService]
})
export class MarketplaceModule {}
