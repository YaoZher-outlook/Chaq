import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TokenTransactionKind, User, UserRole } from "@prisma/client";
import { hashPassword } from "../../common/password";
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
        passwordHash: hashPassword("123456", `auto-${userId}`),
        displayName: userId === adminId ? "Chaq Admin" : `Chaq 用户 ${userId.slice(0, 6)}`,
        role: userId === adminId ? UserRole.ADMIN : UserRole.USER,
        tokenBalance: userId === adminId ? 100000 : 10000,
        settings: { create: {} }
      },
      update: {}
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true }
    }) ?? await this.ensureUser(userId);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tokenBalance: user.tokenBalance,
      createdAt: user.createdAt.toISOString(),
      settings: "settings" in user ? user.settings : undefined
    };
  }

  async updateMe(userId: string, input: { displayName?: string; avatarUrl?: string | null }) {
    await this.ensureUser(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        avatarUrl: input.avatarUrl
      }
    });
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
    metadata?: Prisma.InputJsonValue
  ): Promise<number> {
    const user = await this.ensureUser(userId);
    if (user.tokenBalance < amount) {
      throw new ForbiddenException("Token balance is insufficient for this cloud model call.");
    }

    const balanceAfter = user.tokenBalance - amount;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenBalance: balanceAfter }
      }),
      this.prisma.tokenTransaction.create({
        data: {
          userId,
          kind: TokenTransactionKind.CLOUD_MODEL_USAGE,
          amount: -amount,
          balanceAfter,
          note,
          metadata
        }
      })
    ]);
    return balanceAfter;
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
        windowOpacity: input.windowOpacity
      },
      update: input
    });
  }

  async findOrThrow(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found.");
    }
    return user;
  }
}
