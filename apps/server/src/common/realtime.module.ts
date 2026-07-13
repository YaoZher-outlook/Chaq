import { Module } from "@nestjs/common";
import { RealtimeService } from "./realtime.service";
import { InMemorySessionRevocationBus, SESSION_REVOCATION_BUS } from "./session-revocation";

@Module({
  providers: [
    RealtimeService,
    {
      provide: SESSION_REVOCATION_BUS,
      useClass: InMemorySessionRevocationBus
    }
  ],
  exports: [RealtimeService, SESSION_REVOCATION_BUS]
})
export class RealtimeModule {}
