import { randomBytes, randomInt } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthSessionStatus } from "@prisma/client";
import { normalizeEmail, isValidPassword, sendVerificationEmail } from "../../common/email";
import { PrismaService } from "../../common/prisma.service";
import { hashPassword, hashSessionToken, verifyPassword } from "../../common/password";

const defaultSessionDays = 14;

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async login(username: string, password: string) {
    const normalized = normalizeEmail(username);
    const user = await (this.prisma.user as any).findFirst({
      where: {
        OR: [
          { username },
          { username: normalized },
          { email: normalized }
        ]
      },
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

  async requestRegisterCode(emailInput: string): Promise<{ ok: true }> {
    const email = normalizeEmail(emailInput);
    await this.assertEmailAvailable(email);
    const code = this.createCode();
    await (this.prisma as any).emailVerificationCode.create({
      data: {
        email,
        purpose: "register",
        codeHash: hashSessionToken(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });
    await sendVerificationEmail(email, code, "register");
    return { ok: true };
  }

  async register(input: { email: string; password: string; confirmPassword: string; code: string }) {
    const email = normalizeEmail(input.email);
    await this.assertEmailAvailable(email);
    this.assertPassword(input.password, input.confirmPassword);
    await this.consumeCode(email, "register", input.code);

    const userId = await this.createUniqueUserId();
    const user = await (this.prisma.user as any).create({
      data: {
        id: userId,
        username: email,
        email,
        passwordHash: hashPassword(input.password),
        displayName: userId,
        avatarUrl: null,
        settings: { create: {} }
      },
      include: { settings: true }
    });
    return this.createSessionResponse(user);
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
    email?: string | null;
    displayName: string;
    avatarUrl: string | null;
    role: string;
    tokenBalance: number;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email ?? null,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tokenBalance: user.tokenBalance,
      createdAt: user.createdAt.toISOString()
    };
  }

  private async createSessionResponse(user: any) {
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

  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await (this.prisma.user as any).findFirst({
      where: {
        OR: [
          { username: email },
          { email }
        ]
      },
      select: { id: true }
    });
    if (existing) {
      throw new ConflictException("该邮箱已经被注册。");
    }
  }

  private assertPassword(password: string, confirmPassword: string): void {
    if (password !== confirmPassword) {
      throw new BadRequestException("两次输入的密码不一致。");
    }
    if (!isValidPassword(password)) {
      throw new BadRequestException("密码需为 8-64 位，并同时包含字母和数字。");
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

  private createCode(): string {
    return String(randomInt(100000, 1000000));
  }

  private async createUniqueUserId(): Promise<string> {
    for (let index = 0; index < 8; index += 1) {
      const id = `u_${randomBytes(5).toString("hex")}`;
      const existing = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return id;
    }
    throw new BadRequestException("无法生成唯一用户 UID，请稍后重试。");
  }
}

export const demoPasswordHash = hashPassword("123456", "chaq-demo-salt");
