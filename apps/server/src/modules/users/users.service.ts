import { randomBytes, randomInt } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RechargeOrderStatus, TokenTransactionKind, User, UserRole } from "@prisma/client";
import { isValidPassword, normalizeEmail, sendVerificationEmail } from "../../common/email";
import { hashPassword, hashSessionToken, verifyPassword } from "../../common/password";
import { PrismaService } from "../../common/prisma.service";
import { RateLimitService } from "../../common/rate-limit.service";

const defaultRechargePilotUser = "chen_zy";
const maxTokenBalance = 2_000_000_000;

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService
  ) {}

  async ensureUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found.");
    return user;
  }

  async me(userId: string) {
    const user = await (this.prisma.user as any).findUnique({
      where: { id: userId },
      include: { settings: true }
    });
    if (!user) throw new NotFoundException("User not found.");
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tokenBalance: user.tokenBalance,
      createdAt: user.createdAt.toISOString(),
      settings: "settings" in user ? user.settings : undefined
    };
  }

  async updateMe(userId: string, input: {
    displayName?: string;
    avatarUrl?: string | null;
    email?: string;
    emailCode?: string;
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }) {
    const user = await this.findOrThrow(userId);
    const data: any = {
      displayName: input.displayName,
      avatarUrl: input.avatarUrl
    };

    if (input.email) {
      if (!input.emailCode) {
        throw new BadRequestException("请先填写邮箱验证码。");
      }
      const email = normalizeEmail(input.email);
      await this.assertEmailAvailable(email, userId);
      await this.consumeCode(email, "bind_email", input.emailCode);
      data.email = email;
      data.username = email;
    }

    if (input.newPassword || input.confirmPassword || input.currentPassword) {
      if (!input.currentPassword || !verifyPassword(input.currentPassword, user.passwordHash)) {
        throw new BadRequestException("当前密码不正确。");
      }
      if (!input.newPassword || !input.confirmPassword || input.newPassword !== input.confirmPassword) {
        throw new BadRequestException("两次输入的新密码不一致。");
      }
      if (!isValidPassword(input.newPassword)) {
        throw new BadRequestException("密码需要 8-64 位，并同时包含字母和数字。");
      }
      data.passwordHash = hashPassword(input.newPassword);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data
    });
    return this.publicUser(updated);
  }

  async requestEmailCode(userId: string, emailInput: string): Promise<{ ok: true }> {
    await this.findOrThrow(userId);
    const email = normalizeEmail(emailInput);
    await this.assertEmailAvailable(email, userId);
    await this.assertEmailCodeRateLimit(email, "bind_email");
    const code = String(randomInt(100000, 1000000));
    await (this.prisma as any).emailVerificationCode.create({
      data: {
        email,
        purpose: "bind_email",
        codeHash: hashSessionToken(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });
    await sendVerificationEmail(email, code, "bind_email");
    return { ok: true };
  }

  async assertAdmin(userId: string): Promise<void> {
    const user = await this.ensureUser(userId);
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException("Admin permission required.");
    }
  }

  async adjustTokens(
    adminUserId: string,
    targetUserId: string,
    amount: number,
    kind: TokenTransactionKind,
    note?: string
  ) {
    await this.assertAdmin(adminUserId);
    const target = await this.ensureUser(targetUserId);
    const balanceAfter = target.tokenBalance + amount;
    if (balanceAfter < 0) {
      throw new ForbiddenException("Token balance cannot become negative.");
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: { tokenBalance: balanceAfter }
      });
      const transaction = await tx.tokenTransaction.create({
        data: {
          userId: targetUserId,
          kind,
          amount,
          balanceAfter,
          note
        }
      });
      return { user, transaction };
    });
  }

  async chargeForModelUsage(
    userId: string,
    amount: number,
    note: string,
    metadata?: Prisma.InputJsonValue,
    kind: TokenTransactionKind = TokenTransactionKind.CLOUD_MODEL_USAGE
  ): Promise<number> {
    await this.ensureUser(userId);
    return this.prisma.$transaction((tx) => this.chargeForModelUsageInTransaction(tx, userId, amount, note, metadata, kind));
  }

  async chargeForModelUsageInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    note: string,
    metadata?: Prisma.InputJsonValue,
    kind: TokenTransactionKind = TokenTransactionKind.CLOUD_MODEL_USAGE
  ): Promise<number> {
    const changed = await tx.user.updateMany({
      where: { id: userId, tokenBalance: { gte: amount } },
      data: { tokenBalance: { decrement: amount } }
    });
    if (!changed.count) {
      throw new ForbiddenException("Token balance is insufficient for this model call.");
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenBalance: true } });
    await tx.tokenTransaction.create({
      data: {
        userId,
        kind,
        amount: -amount,
        balanceAfter: user.tokenBalance,
        note,
        metadata
      }
    });
    return user.tokenBalance;
  }

  async creditTokensInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    note: string,
    metadata?: Prisma.InputJsonValue,
    kind: TokenTransactionKind = TokenTransactionKind.AGENT_SERVICE_EARNING
  ): Promise<number> {
    if (amount <= 0) return (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenBalance: true } })).tokenBalance;
    const user = await tx.user.update({
      where: { id: userId },
      data: { tokenBalance: { increment: amount } },
      select: { tokenBalance: true }
    });
    await tx.tokenTransaction.create({
      data: { userId, kind, amount, balanceAfter: user.tokenBalance, note, metadata }
    });
    return user.tokenBalance;
  }

  async tokenLedger(userId: string) {
    await this.ensureUser(userId);
    return this.prisma.tokenTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50
    });
  }

  async walletSummary(userId: string) {
    const user = await this.ensureUser(userId);
    await this.expireRechargeOrders();
    const rechargeOrdersQuery = typeof (this.prisma as any).rechargeOrder?.findMany === "function"
      ? this.prisma.rechargeOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 20
      })
      : Promise.resolve([]);
    const [transactions, spent, modelSpent, feesPaid, earnings, earningRows, rechargeOrders] = await Promise.all([
      this.prisma.tokenTransaction.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.tokenTransaction.aggregate({
        where: { userId, amount: { lt: 0 } },
        _sum: { amount: true }
      }),
      this.prisma.tokenTransaction.aggregate({
        where: { userId, kind: { in: [TokenTransactionKind.CLOUD_MODEL_USAGE, TokenTransactionKind.AGENT_MODEL_USAGE] } },
        _sum: { amount: true }
      }),
      this.prisma.tokenTransaction.aggregate({
        where: { userId, kind: TokenTransactionKind.AGENT_SERVICE_FEE },
        _sum: { amount: true }
      }),
      this.prisma.tokenTransaction.aggregate({
        where: { userId, kind: TokenTransactionKind.AGENT_SERVICE_EARNING },
        _sum: { amount: true }
      }),
      this.prisma.tokenTransaction.findMany({
        where: { userId, kind: TokenTransactionKind.AGENT_SERVICE_EARNING },
        select: { amount: true, metadata: true },
        orderBy: { createdAt: "desc" },
        take: 5000
      }),
      rechargeOrdersQuery
    ]);
    const grouped = new Map<string, { amount: number; transactionCount: number }>();
    for (const row of earningRows) {
      const agentId = (row.metadata as Record<string, unknown> | null)?.agentId;
      if (typeof agentId !== "string") continue;
      const current = grouped.get(agentId) ?? { amount: 0, transactionCount: 0 };
      current.amount += row.amount;
      current.transactionCount += 1;
      grouped.set(agentId, current);
    }
    const agents = grouped.size
      ? await this.prisma.agent.findMany({ where: { id: { in: [...grouped.keys()] } }, select: { id: true, name: true } })
      : [];
    const names = new Map(agents.map((agent) => [agent.id, agent.name]));
    return {
      balance: user.tokenBalance,
      totalSpent: Math.abs(spent._sum.amount ?? 0),
      modelSpent: Math.abs(modelSpent._sum.amount ?? 0),
      serviceFeesPaid: Math.abs(feesPaid._sum.amount ?? 0),
      serviceEarnings: earnings._sum.amount ?? 0,
      agentEarnings: [...grouped.entries()]
        .map(([agentId, value]) => ({ agentId, agentName: names.get(agentId) ?? "Archived Agent", ...value }))
        .sort((a, b) => b.amount - a.amount),
      transactions,
      rechargeOrders: rechargeOrders.map((order) => this.toRechargeOrder(order, true, this.paymentSettings()))
    };
  }

  async rechargeConfig(userId: string) {
    const user = await this.ensureUser(userId);
    const settings = this.paymentSettings();
    const allowed = user.username === settings.allowedUsername;
    return {
      enabled: settings.enabled,
      allowed,
      allowedUsername: settings.allowedUsername,
      cnyPerMToken: settings.cnyPerMToken,
      minMToken: settings.minMToken,
      maxMToken: settings.maxMToken,
      orderExpiresMinutes: settings.orderExpiresMinutes,
      paymentAccount: allowed && settings.enabled ? this.paymentAccount(settings, true) : undefined
    };
  }

  async createRechargeOrder(userId: string, input: { amount: number; unit: "token" | "k" | "m"; note?: string }) {
    const user = await this.ensureUser(userId);
    const settings = this.paymentSettings();
    this.assertRechargeAllowed(user, settings);
    if (!settings.enabled) {
      throw new BadRequestException("Recharge collection account is not configured.");
    }
    const rate = await this.rateLimit.consume("recharge-order-create", userId, 6, 60 * 60);
    if (!rate.allowed) {
      throw new BadRequestException(`Recharge order requests are too frequent. Retry after ${rate.retryAfterSeconds} seconds.`);
    }
    await this.expireRechargeOrders();
    const amountTokens = this.normalizeRechargeAmount(input, settings);
    const order = await this.prisma.rechargeOrder.create({
      data: {
        orderNo: this.createRechargeOrderNo(),
        userId,
        amountTokens,
        requestedAmount: input.amount,
        requestedUnit: input.unit,
        payableCny: this.payableCny(amountTokens, settings),
        paymentReference: this.createPaymentReference(),
        payerNote: input.note?.trim() ?? "",
        expiresAt: new Date(Date.now() + settings.orderExpiresMinutes * 60_000)
      }
    });
    return this.toRechargeOrder(order, true, settings);
  }

  async submitRechargeOrder(userId: string, orderId: string, payerNote = "") {
    const user = await this.ensureUser(userId);
    const settings = this.paymentSettings();
    this.assertRechargeAllowed(user, settings);
    await this.expireRechargeOrders();
    const changed = await this.prisma.rechargeOrder.updateMany({
      where: {
        id: orderId,
        userId,
        status: RechargeOrderStatus.PENDING,
        expiresAt: { gt: new Date() }
      },
      data: {
        status: RechargeOrderStatus.SUBMITTED,
        payerNote: payerNote.trim(),
        submittedAt: new Date()
      }
    });
    if (!changed.count) throw new BadRequestException("Recharge order cannot be submitted.");
    const order = await this.prisma.rechargeOrder.findUniqueOrThrow({ where: { id: orderId } });
    return this.toRechargeOrder(order, true, settings);
  }

  async cancelRechargeOrder(userId: string, orderId: string) {
    const changed = await this.prisma.rechargeOrder.updateMany({
      where: { id: orderId, userId, status: RechargeOrderStatus.PENDING },
      data: { status: RechargeOrderStatus.CANCELLED }
    });
    if (!changed.count) throw new BadRequestException("Recharge order cannot be cancelled.");
    const order = await this.prisma.rechargeOrder.findUniqueOrThrow({ where: { id: orderId } });
    return this.toRechargeOrder(order, true, this.paymentSettings());
  }

  async adminRechargeOrders(adminUserId: string) {
    await this.assertAdmin(adminUserId);
    await this.expireRechargeOrders();
    const settings = this.paymentSettings();
    const rows = await this.prisma.rechargeOrder.findMany({
      where: { status: { in: [RechargeOrderStatus.PENDING, RechargeOrderStatus.SUBMITTED] } },
      include: { user: { select: { id: true, username: true, email: true, displayName: true } } },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
      take: 200
    });
    return rows.map((row) => ({ ...this.toRechargeOrder(row, false, settings), user: row.user }));
  }

  async moderateRechargeOrder(adminUserId: string, orderId: string, action: "confirm" | "reject", note = "") {
    await this.assertAdmin(adminUserId);
    await this.expireRechargeOrders();
    if (action === "reject") {
      const changed = await this.prisma.rechargeOrder.updateMany({
        where: { id: orderId, status: { in: [RechargeOrderStatus.PENDING, RechargeOrderStatus.SUBMITTED] } },
        data: {
          status: RechargeOrderStatus.REJECTED,
          adminNote: note.trim(),
          reviewedById: adminUserId,
          reviewedAt: new Date()
        }
      });
      if (!changed.count) throw new BadRequestException("Recharge order cannot be rejected.");
      const order = await this.prisma.rechargeOrder.findUniqueOrThrow({ where: { id: orderId } });
      return this.toRechargeOrder(order, false, this.paymentSettings());
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException("Recharge order not found.");
      if (order.status !== RechargeOrderStatus.PENDING && order.status !== RechargeOrderStatus.SUBMITTED) {
        throw new BadRequestException("Recharge order has already been processed.");
      }
      if (order.expiresAt.getTime() <= Date.now()) {
        await tx.rechargeOrder.update({ where: { id: orderId }, data: { status: RechargeOrderStatus.EXPIRED } });
        throw new BadRequestException("Recharge order has expired.");
      }
      const changed = await tx.rechargeOrder.updateMany({
        where: {
          id: orderId,
          status: { in: [RechargeOrderStatus.PENDING, RechargeOrderStatus.SUBMITTED] },
          expiresAt: { gt: new Date() }
        },
        data: {
          status: RechargeOrderStatus.PAID,
          adminNote: note.trim(),
          reviewedById: adminUserId,
          reviewedAt: new Date()
        }
      });
      if (!changed.count) throw new BadRequestException("Recharge order has already been processed.");
      const user = await tx.user.update({
        where: { id: order.userId },
        data: { tokenBalance: { increment: order.amountTokens } },
        select: { tokenBalance: true }
      });
      if (user.tokenBalance > maxTokenBalance) {
        throw new BadRequestException("Token balance would exceed the current platform limit.");
      }
      const transaction = await tx.tokenTransaction.create({
        data: {
          userId: order.userId,
          kind: TokenTransactionKind.RECHARGE,
          amount: order.amountTokens,
          balanceAfter: user.tokenBalance,
          note: note.trim() || `Manual bank transfer confirmed: ${order.orderNo}`,
          metadata: {
            rechargeOrderId: order.id,
            orderNo: order.orderNo,
            paymentReference: order.paymentReference,
            payableCny: order.payableCny,
            paymentMethod: order.paymentMethod
          } as Prisma.InputJsonValue
        }
      });
      const updated = await tx.rechargeOrder.update({
        where: { id: orderId },
        data: { paidTransactionId: transaction.id }
      });
      return this.toRechargeOrder(updated, false, this.paymentSettings());
    });
  }

  private async expireRechargeOrders(): Promise<void> {
    if (typeof (this.prisma.rechargeOrder as any)?.updateMany !== "function") return;
    await this.prisma.rechargeOrder.updateMany({
      where: {
        status: { in: [RechargeOrderStatus.PENDING, RechargeOrderStatus.SUBMITTED] },
        expiresAt: { lte: new Date() }
      },
      data: { status: RechargeOrderStatus.EXPIRED }
    }).catch(() => undefined);
  }

  private assertRechargeAllowed(user: User, settings = this.paymentSettings()): void {
    if (user.username !== settings.allowedUsername) {
      throw new ForbiddenException(`Recharge is currently only available for ${settings.allowedUsername}.`);
    }
  }

  private normalizeRechargeAmount(input: { amount: number; unit: "token" | "k" | "m" }, settings = this.paymentSettings()): number {
    const unitFactor = input.unit === "m" ? 1_000_000 : input.unit === "k" ? 1_000 : 1;
    const raw = input.amount * unitFactor;
    const amountTokens = Math.round(raw);
    if (!Number.isFinite(raw) || Math.abs(raw - amountTokens) > 0.000001 || amountTokens <= 0) {
      throw new BadRequestException("Recharge amount must convert to a positive integer token value.");
    }
    if (amountTokens < settings.minMToken * 1_000_000) {
      throw new BadRequestException(`Recharge amount cannot be lower than ${settings.minMToken}M token.`);
    }
    if (amountTokens > settings.maxMToken * 1_000_000) {
      throw new BadRequestException(`Single recharge cannot exceed ${settings.maxMToken}M token.`);
    }
    return amountTokens;
  }

  private payableCny(amountTokens: number, settings = this.paymentSettings()): number {
    return Number(((amountTokens / 1_000_000) * settings.cnyPerMToken).toFixed(2));
  }

  private createRechargeOrderNo(): string {
    const date = new Date();
    const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    return `CHQ${ymd}${randomBytes(4).toString("hex").toUpperCase()}`;
  }

  private createPaymentReference(): string {
    return `CHQ-${randomBytes(4).toString("hex").toUpperCase()}`;
  }

  private paymentSettings() {
    const accountNumber = String(process.env.PAYMENT_ACCOUNT_NUMBER ?? "").trim();
    const cnyPerMToken = this.positiveNumberEnv("PAYMENT_CNY_PER_M_TOKEN", 1);
    return {
      enabled: Boolean(accountNumber),
      allowedUsername: String(process.env.PAYMENT_PILOT_USERNAME || defaultRechargePilotUser),
      bankName: String(process.env.PAYMENT_BANK_NAME || "Manual bank transfer"),
      accountName: String(process.env.PAYMENT_ACCOUNT_NAME || ""),
      accountNumber,
      cnyPerMToken,
      minMToken: this.positiveNumberEnv("PAYMENT_MIN_M_TOKEN", 1),
      maxMToken: this.positiveNumberEnv("PAYMENT_MAX_M_TOKEN", 500),
      orderExpiresMinutes: Math.round(this.positiveNumberEnv("PAYMENT_ORDER_EXPIRES_MINUTES", 24 * 60))
    };
  }

  private positiveNumberEnv(key: string, fallback: number): number {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private paymentAccount(settings = this.paymentSettings(), includeFullAccount = false) {
    return {
      bankName: settings.bankName,
      accountName: settings.accountName,
      accountNumberMasked: this.maskAccountNumber(settings.accountNumber),
      ...(includeFullAccount ? { accountNumber: settings.accountNumber } : {})
    };
  }

  private maskAccountNumber(value: string): string {
    if (value.length <= 8) return value ? "****" : "";
    return `${value.slice(0, 4)} **** **** ${value.slice(-4)}`;
  }

  private toRechargeOrder(row: any, includeAccount: boolean, settings = this.paymentSettings()) {
    return {
      id: row.id,
      orderNo: row.orderNo,
      userId: row.userId,
      status: String(row.status).toLowerCase(),
      amountTokens: row.amountTokens,
      requestedAmount: row.requestedAmount,
      requestedUnit: row.requestedUnit,
      payableCny: row.payableCny,
      paymentMethod: "bank_transfer",
      paymentReference: row.paymentReference,
      paymentAccount: includeAccount ? this.paymentAccount(settings, true) : this.paymentAccount(settings, false),
      payerNote: row.payerNote,
      adminNote: row.adminNote,
      paidTransactionId: row.paidTransactionId,
      submittedAt: row.submittedAt?.toISOString?.() ?? null,
      reviewedAt: row.reviewedAt?.toISOString?.() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async settings(userId: string) {
    await this.ensureUser(userId);
    return this.prisma.userSetting.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
  }

  async updateSettings(
    userId: string,
    input: {
      language?: string;
      theme?: string;
      backgroundUrl?: string | null;
      backgroundOpacity?: number;
      windowOpacity?: number;
      notificationSound?: boolean;
      iconFlash?: boolean;
      localChatDataPath?: string | null;
      fileStoragePath?: string | null;
    }
  ) {
    await this.ensureUser(userId);
    return this.prisma.userSetting.upsert({
      where: { userId },
      create: {
        userId,
        language: input.language,
        theme: input.theme,
        backgroundUrl: input.backgroundUrl,
        backgroundOpacity: input.backgroundOpacity,
        windowOpacity: input.windowOpacity,
        notificationSound: input.notificationSound,
        iconFlash: input.iconFlash,
        localChatDataPath: input.localChatDataPath,
        fileStoragePath: input.fileStoragePath
      } as any,
      update: input as any
    });
  }

  async findOrThrow(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found.");
    }
    return user;
  }

  private publicUser(user: any) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tokenBalance: user.tokenBalance,
      createdAt: user.createdAt.toISOString()
    };
  }

  private async assertEmailAvailable(email: string, currentUserId?: string): Promise<void> {
    const existing = await (this.prisma.user as any).findFirst({
      where: {
        OR: [
          { username: email },
          { email }
        ],
        NOT: currentUserId ? { id: currentUserId } : undefined
      },
      select: { id: true }
    });
    if (existing) {
      throw new ConflictException("该邮箱已经被注册。");
    }
  }

  private async consumeCode(email: string, purpose: string, code: string): Promise<void> {
    await this.assertEmailCodeVerifyRateLimit(email, purpose);
    const record = await (this.prisma as any).emailVerificationCode.findFirst({
      where: {
        email,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: "desc" }
    });
    if (!record || record.codeHash !== hashSessionToken(code.trim())) {
      throw new BadRequestException("邮箱验证码错误或已过期。");
    }
    await (this.prisma as any).emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() }
    });
  }

  private async assertEmailCodeRateLimit(email: string, purpose: string): Promise<void> {
    const result = await this.rateLimit.consume(`email-code:${purpose}`, email, 3, 10 * 60);
    if (!result.allowed) {
      throw new BadRequestException(`验证码请求过于频繁，请 ${result.retryAfterSeconds} 秒后再试。`);
    }
  }

  private async assertEmailCodeVerifyRateLimit(email: string, purpose: string): Promise<void> {
    const result = await this.rateLimit.consume(`email-code-verify:${purpose}`, email, 8, 10 * 60);
    if (!result.allowed) {
      throw new BadRequestException(`验证码尝试过于频繁，请 ${result.retryAfterSeconds} 秒后再试。`);
    }
  }
}
