import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { TokenTransactionKind } from "@prisma/client";
import { z } from "zod";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { UsersService } from "./users.service";

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  avatarUrl: z.string().max(8_000_000).nullable().optional(),
  email: z.string().email().max(160).optional(),
  emailCode: z.string().min(4).max(12).optional(),
  currentPassword: z.string().max(120).optional(),
  newPassword: z.string().max(120).optional(),
  confirmPassword: z.string().max(120).optional()
});

const emailCodeSchema = z.object({
  email: z.string().email().max(160)
});

const adjustTokensSchema = z.object({
  amount: z.number().int(),
  kind: z.enum(["RECHARGE", "REFUND", "ADMIN_ADJUSTMENT"]).default("ADMIN_ADJUSTMENT"),
  note: z.string().max(300).optional()
});

const rechargeSchema = z.object({
  amount: z.number().positive().max(500_000_000),
  unit: z.enum(["token", "k", "m"]).default("m"),
  note: z.string().max(300).optional()
});

const rechargeSubmitSchema = z.object({
  payerNote: z.string().max(300).default("")
});

const rechargeModerationSchema = z.object({
  action: z.enum(["confirm", "reject"]),
  note: z.string().max(500).default("")
});

const settingsSchema = z.object({
  language: z.enum(["zh", "en"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  backgroundUrl: z.string().max(8_000_000).nullable().optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
  windowOpacity: z.number().min(0.7).max(1).optional(),
  notificationSound: z.boolean().optional(),
  iconFlash: z.boolean().optional(),
  localChatDataPath: z.string().max(1000).nullable().optional(),
  fileStoragePath: z.string().max(1000).nullable().optional()
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

  @Post("me/email-code")
  emailCode(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.users.requestEmailCode(userId, parseBody(emailCodeSchema, body).email);
  }

  @Get("me/tokens")
  tokenLedger(@CurrentUserId() userId: string) {
    return this.users.tokenLedger(userId);
  }

  @Get("me/wallet")
  wallet(@CurrentUserId() userId: string) {
    return this.users.walletSummary(userId);
  }

  @Get("me/recharge/config")
  rechargeConfig(@CurrentUserId() userId: string) {
    return this.users.rechargeConfig(userId);
  }

  @Post("me/recharge")
  recharge(@CurrentUserId() userId: string, @Body() body: unknown) {
    const input = parseBody(rechargeSchema, body);
    return this.users.createRechargeOrder(userId, { ...input, unit: input.unit ?? "m" });
  }

  @Post("me/recharge/:id/submit")
  submitRecharge(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.users.submitRechargeOrder(userId, id, parseBody(rechargeSubmitSchema, body).payerNote ?? "");
  }

  @Post("me/recharge/:id/cancel")
  cancelRecharge(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.users.cancelRechargeOrder(userId, id);
  }

  @Get("admin/recharge/orders")
  adminRechargeOrders(@CurrentUserId() userId: string) {
    return this.users.adminRechargeOrders(userId);
  }

  @Post("admin/recharge/orders/:id/resolve")
  resolveRechargeOrder(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    const input = parseBody(rechargeModerationSchema, body);
    return this.users.moderateRechargeOrder(userId, id, input.action, input.note ?? "");
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
