import { Body, Controller, Headers, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { parseBody } from "../../common/http-errors";
import { AuthService } from "./auth.service";

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(120)
});

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() body: unknown) {
    const input = parseBody(loginSchema, body);
    return this.auth.login(input.username, input.password);
  }

  @Post("logout")
  logout(@Headers("x-session-token") sessionToken?: string) {
    return this.auth.logout(sessionToken);
  }
}
