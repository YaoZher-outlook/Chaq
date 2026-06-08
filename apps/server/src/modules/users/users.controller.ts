import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { TokenTransactionKind } from "@prisma/client";
import { z } from "zod";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { UsersService } from "./users.service";

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  avatarUrl: z.string().url().nullable().optional()
});

const adjustTokensSchema = z.object({
  amount: z.number().int(),
  kind: z.enum(["RECHARGE", "REFUND", "ADMIN_ADJUSTMENT"]).default("ADMIN_ADJUSTMENT"),
  note: z.string().max(300).optional()
});

const settingsSchema = z.object({
  language: z.enum(["zh", "en"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  backgroundUrl: z.string().max(500).nullable().optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
  windowOpacity: z.number().min(0.7).max(1).optional()
});

@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get("me")
  me(@CurrentUserId() userId: string) {
    return this.users.me(userId);
  }

  @Post("me")
  updateMe(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.users.updateMe(userId, parseBody(updateMeSchema, body));
  }

  @Get("me/tokens")
  tokenLedger(@CurrentUserId() userId: string) {
    return this.users.tokenLedger(userId);
  }

  @Get("me/settings")
  settings(@CurrentUserId() userId: string) {
    return this.users.settings(userId);
  }

  @Post("me/settings")
  updateSettings(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.users.updateSettings(userId, parseBody(settingsSchema, body));
  }

  @Post(":id/tokens")
  adjustTokens(@CurrentUserId() adminId: string, @Param("id") targetUserId: string, @Body() body: unknown) {
    const input = parseBody(adjustTokensSchema, body);
    return this.users.adjustTokens(adminId, targetUserId, input.amount, input.kind as TokenTransactionKind, input.note);
  }
}
