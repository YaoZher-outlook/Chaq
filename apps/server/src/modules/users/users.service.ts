import { randomInt } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TokenTransactionKind, User, UserRole } from "@prisma/client";
import { isValidPassword, normalizeEmail, sendVerificationEmail } from "../../common/email";
import { hashPassword, hashSessionToken, verifyPassword } from "../../common/password";
import { PrismaService } from "../../common/prisma.service";

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ensureUser(userId: string): Promise<User> {
    const adminId = process.env.DEMO_ADMIN_USER_ID ?? "admin-local";
    return this.prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        username: userId,
        email: userId.includes("@") ? normalizeEmail(userId) : undefined,
        passwordHash: hashPassword("123456", `auto-${userId}`),
        displayName: userId === adminId ? "Chaq Admin" : `Chaq 用户 ${userId.slice(0, 6)}`,
        role: userId === adminId ? UserRole.ADMIN : UserRole.USER,
        tokenBalance: userId === adminId ? 100000 : 10000,
        settings: { create: {} }
      } as any,
      update: {}
    });
  }

  async me(userId: string) {
    const user = await (this.prisma.user as any).findUnique({
      where: { id: userId },
      include: { settings: true }
    }) ?? await this.ensureUser(userId);
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
        throw new BadRequestException("密码需为 8-64 位，并同时包含字母和数字。");
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

  async tokenLedger(userId: string) {
    await this.ensureUser(userId);
    return this.prisma.tokenTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50
    });
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
}
