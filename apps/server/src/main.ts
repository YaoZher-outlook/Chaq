import "reflect-metadata";
import { createHash } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AuthService } from "./modules/auth/auth.service";
import { RateLimitService } from "./common/rate-limit.service";

type ExpressMiddleware = (request: unknown, response: unknown, next: () => void) => void;
const expressBody = require("express") as {
  json: (options: { limit: string }) => ExpressMiddleware;
  urlencoded: (options: { extended: boolean; limit: string }) => ExpressMiddleware;
};

type SessionRequest = {
  method?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  currentUser?: { id: string };
};

type SessionResponse = {
  status: (code: number) => { json: (body: unknown) => void };
  setHeader: (name: string, value: string | number) => void;
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(expressBody.json({ limit: "12mb" }));
  app.use(expressBody.urlencoded({ extended: true, limit: "12mb" }));
  app.enableCors({
    origin: process.env.CLIENT_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) ?? ["http://localhost:27337"],
    credentials: true,
    allowedHeaders: ["content-type", "x-session-token"]
  });

  const auth = app.get(AuthService);
  const rateLimit = app.get(RateLimitService);
  app.use(async (request: SessionRequest, response: SessionResponse, next: () => void) => {
    const path = request.path ?? "";
    const isHealth = path.includes("/health/");
    const isCredentialRoute = path.endsWith("/auth/login") || path.endsWith("/auth/register") || path.endsWith("/auth/register/code");
    if (!isHealth && request.method !== "OPTIONS") {
      const header = request.headers["x-session-token"];
      const token = Array.isArray(header) ? header[0] : header;
      const identity = createHash("sha256").update(token || request.socket?.remoteAddress || "unknown").digest("hex").slice(0, 24);
      const result = await rateLimit.consume(isCredentialRoute ? "credential" : "api", identity, isCredentialRoute ? 20 : 300, isCredentialRoute ? 600 : 60);
      response.setHeader("X-RateLimit-Limit", result.limit);
      response.setHeader("X-RateLimit-Remaining", result.remaining);
      if (!result.allowed) {
        response.setHeader("Retry-After", result.retryAfterSeconds);
        response.status(429).json({ message: "请求过于频繁，请稍后再试。", statusCode: 429 });
        return;
      }
    }
    if (
      request.method === "OPTIONS" ||
      isHealth ||
      path.endsWith("/auth/login") ||
      path.endsWith("/auth/register") ||
      path.endsWith("/auth/register/code")
    ) {
      next();
      return;
    }

    const header = request.headers["x-session-token"];
    const token = Array.isArray(header) ? header[0] : header;
    const user = await auth.userForSession(token);
    if (!user) {
      response.status(401).json({ message: "请先登录。", statusCode: 401 });
      return;
    }

    request.currentUser = { id: user.id };
    next();
  });

  app.setGlobalPrefix("api");

  const port = Number(process.env.SERVER_PORT ?? 24537);
  const host = process.env.SERVER_HOST || "127.0.0.1";
  await app.listen(port, host);
  console.log(`Chaq server listening on http://${host}:${port}/api`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
