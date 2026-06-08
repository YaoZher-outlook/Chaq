import { randomBytes } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthSessionStatus } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { hashPassword, hashSessionToken, verifyPassword } from "../../common/password";

const defaultSessionDays = 14;

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { settings: true }
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException("用户名或密码错误。");
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + defaultSessionDays * 24 * 60 * 60 * 1000);
    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt
      }
    });

    return {
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      user: this.publicUser(user),
      settings: user.settings ?? await this.ensureSettings(user.id)
    };
  }

  async logout(sessionToken: string | undefined): Promise<{ ok: true }> {
    if (!sessionToken) {
      return { ok: true };
    }
    await this.prisma.authSession.updateMany({
      where: { tokenHash: hashSessionToken(sessionToken) },
      data: { status: AuthSessionStatus.REVOKED }
    });
    return { ok: true };
  }

  async userForSession(sessionToken: string | undefined) {
    if (!sessionToken) {
      return null;
    }
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(sessionToken) },
      include: { user: { include: { settings: true } } }
    });
    if (!session || session.status !== AuthSessionStatus.ACTIVE || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return session.user;
  }

  async ensureSettings(userId: string) {
    return this.prisma.userSetting.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
  }

  publicUser(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    role: string;
    tokenBalance: number;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tokenBalance: user.tokenBalance,
      createdAt: user.createdAt.toISOString()
    };
  }
}

export const demoPasswordHash = hashPassword("123456", "chaq-demo-salt");
