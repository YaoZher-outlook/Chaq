import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AgentWorkerModule } from "./modules/agent-runtime/agent-worker.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AgentWorkerModule);
  app.enableShutdownHooks();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
