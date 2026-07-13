import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { FileLogger } from "./common/file-logger";
import { AuthService } from "./modules/auth/auth.service";
import { RateLimitService } from "./common/rate-limit.service";
import { RealtimeService } from "./common/realtime.service";
import { apiRateLimitIdentities, credentialRateLimitIdentities } from "./common/credential-rate-limit";
import { isAllowedClientOrigin } from "./common/cors-origin";
import { isPublicHealthPath } from "./common/public-route";
import { assertProductionEnvironmentOnBootstrap } from "./common/production-env-bootstrap";

type ExpressMiddleware = (request: unknown, response: unknown, next: () => void) => void;
type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;
const expressBody = require("express") as {
  json: (options: { limit: string }) => ExpressMiddleware;
  urlencoded: (options: { extended: boolean; limit: string }) => ExpressMiddleware;
};

type SessionRequest = {
  body?: unknown;
  ip?: string;
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
  assertProductionEnvironmentOnBootstrap("Chaq API");
  const logger = new FileLogger();
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger });
  configureTrustedProxy(app.getHttpAdapter().getInstance() as { set: (name: string, value: string | number | string[]) => void });
  app.use(expressBody.json({ limit: "12mb" }));
  app.use(expressBody.urlencoded({ extended: true, limit: "12mb" }));
  const defaultClientOrigin = process.env.NODE_ENV === "production"
    ? "https://chaq.yaozher.com"
    : "http://localhost:27337";
  const configuredOrigins = new Set(
    (process.env.CLIENT_ORIGIN || defaultClientOrigin)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  app.enableCors({
    origin: (origin: string | undefined, callback: CorsOriginCallback) => {
      if (!origin || origin === "null" || origin.startsWith("file://")) {
        callback(null, true);
        return;
      }
      if (isAllowedClientOrigin(origin, configuredOrigins, process.env.NODE_ENV === "production")) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    allowedHeaders: ["content-type", "x-session-token"]
  });

  const auth = app.get(AuthService);
  const rateLimit = app.get(RateLimitService);
  app.get(RealtimeService).bind(app.getHttpServer(), auth);
  app.use(async (request: SessionRequest, response: SessionResponse, next: () => void) => {
    const path = request.path ?? "";
    const isHealth = isPublicHealthPath(path);
    const isCredentialRoute = path.endsWith("/auth/login") || path.endsWith("/auth/register") || path.endsWith("/auth/register/code");
    if (!isHealth && request.method !== "OPTIONS") {
      const results = isCredentialRoute
        ? await credentialRateLimits(rateLimit, request)
        : await apiRateLimits(rateLimit, request);
      const result = results.reduce((strictest, current) => {
        if (!current.allowed && strictest.allowed) return current;
        if (current.allowed === strictest.allowed && current.remaining < strictest.remaining) return current;
        return strictest;
      });
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
  logger.log(`Chaq server listening on http://${host}:${port}/api`, "Bootstrap");
}

async function apiRateLimits(rateLimit: RateLimitService, request: SessionRequest) {
  const identities = apiRateLimitIdentities(request);
  const checks = [
    rateLimit.consume("api:ip", identities.ip, 600, 60, { failureMode: "local" })
  ];
  if (identities.session) {
    checks.push(rateLimit.consume("api:session", identities.session, 300, 60, { failureMode: "local" }));
  }
  return Promise.all(checks);
}

async function credentialRateLimits(rateLimit: RateLimitService, request: SessionRequest) {
  const identities = credentialRateLimitIdentities(request);
  const checks = [
    rateLimit.consume("credential:ip", identities.ip, 60, 10 * 60, { failureMode: "local" })
  ];
  if (identities.account) {
    checks.push(rateLimit.consume("credential:account", identities.account, 10, 10 * 60, { failureMode: "local" }));
  }
  return Promise.all(checks);
}

function configureTrustedProxy(expressApp: { set: (name: string, value: string | number | string[]) => void }): void {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return;
  if (raw.toLowerCase() === "true") {
    throw new Error("TRUST_PROXY=true is unsafe; configure a hop count or explicit proxy subnet instead.");
  }
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops < 1 || hops > 10) throw new Error("TRUST_PROXY hop count must be between 1 and 10.");
    expressApp.set("trust proxy", hops);
    return;
  }
  expressApp.set("trust proxy", raw.split(",").map((value) => value.trim()).filter(Boolean));
}

bootstrap().catch((error) => {
  new FileLogger().error(error);
  process.exit(1);
});
