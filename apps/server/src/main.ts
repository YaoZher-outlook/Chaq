import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AuthService } from "./modules/auth/auth.service";

type SessionRequest = {
  method?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  currentUser?: { id: string };
};

type SessionResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CLIENT_ORIGIN?.split(",") ?? ["http://localhost:5173"],
    credentials: true,
    allowedHeaders: ["content-type", "x-session-token"]
  });

  const auth = app.get(AuthService);
  app.use(async (request: SessionRequest, response: SessionResponse, next: () => void) => {
    const path = request.path ?? "";
    if (request.method === "OPTIONS" || path.endsWith("/auth/login")) {
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

  const port = Number(process.env.SERVER_PORT ?? 4537);
  await app.listen(port);
  console.log(`Chaq server listening on http://localhost:${port}/api`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
