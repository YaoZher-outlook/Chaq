import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RateLimitService } from "./rate-limit.service";

@Global()
@Module({
  providers: [PrismaService, RateLimitService],
  exports: [PrismaService, RateLimitService]
})
export class CoreModule {}
