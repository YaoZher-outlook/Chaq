import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FileLogger } from "./common/file-logger";
import { AgentWorkerModule } from "./modules/agent-runtime/agent-worker.module";
import { assertProductionEnvironmentOnBootstrap } from "./common/production-env-bootstrap";

async function bootstrap(): Promise<void> {
  assertProductionEnvironmentOnBootstrap("Chaq Agent worker");
  const app = await NestFactory.createApplicationContext(AgentWorkerModule, { logger: new FileLogger() });
  app.enableShutdownHooks();
}

bootstrap().catch((error) => {
  new FileLogger().error(error);
  process.exit(1);
});
