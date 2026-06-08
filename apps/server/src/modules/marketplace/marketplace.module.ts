import { Module } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { UsersModule } from "../users/users.module";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";

@Module({
  imports: [UsersModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, PrismaService]
})
export class MarketplaceModule {}
