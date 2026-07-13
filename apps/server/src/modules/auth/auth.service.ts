import { randomBytes, randomInt } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthSessionStatus } from "@prisma/client";
import { normalizeEmail, isValidPassword, sendVerificationEmail } from "../../common/email";
import { PrismaService } from "../../common/prisma.service";
import { RateLimitService } from "../../common/rate-limit.service";
import { hashPassword, hashSessionToken, verifyPassword } from "../../common/password";
import { SESSION_REVOCATION_BUS, type SessionRevocationBus } from "../../common/session-revocation";

const defaultSessionDays = 14;
// Keep the expensive password verification path for unknown accounts too, so
// login response time does not become an account-existence oracle.
const dummyPasswordHash = hashPassword("invalid-auth-password", "chaq-auth-dummy-salt");

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(SESSION_REVOCATION_BUS) private readonly sessionRevocations: SessionRevocationBus
  ) {}

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
    const passwordValid = verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || !passwordValid) {
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
    await this.assertEmailCodeRateLimit(email, "register");
    // Keep the response indistinguishable for already registered addresses.
    // Registration itself still enforces the unique email constraint.
    if (await this.emailExists(email)) return { ok: true };
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
    this.assertPassword(input.password, input.confirmPassword);
    await this.consumeCode(email, "register", input.code);
    // Validate the one-time credential before checking account existence so
    // this endpoint cannot be used as a registered-email oracle.
    await this.assertEmailAvailable(email);

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
    const tokenHash = hashSessionToken(sessionToken);
    await this.prisma.authSession.updateMany({
      where: { tokenHash },
      data: { status: AuthSessionStatus.REVOKED }
    });
    // Publish even when the row was already revoked. This lets a repeated
    // logout close a connection that missed an earlier cross-instance event.
    this.sessionRevocations.publish({ tokenHash });
    return { ok: true };
  }

  async userForSession(sessionToken: string | undefined) {
    return (await this.authenticateSession(sessionToken))?.user ?? null;
  }

  async authenticateSession(sessionToken: string | undefined) {
    if (!sessionToken) {
      return null;
    }
    const tokenHash = hashSessionToken(sessionToken);
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: { include: { settings: true } } }
    });
    if (!session || session.status !== AuthSessionStatus.ACTIVE || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return {
      sessionId: session.id,
      tokenHash,
      expiresAt: session.expiresAt,
      user: session.user
    };
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
    if (await this.emailExists(email)) {
      throw new ConflictException("该邮箱已经被注册。");
    }
  }

  private async emailExists(email: string): Promise<boolean> {
    const existing = await (this.prisma.user as any).findFirst({
      where: {
        OR: [
          { username: email },
          { email }
        ]
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private assertPassword(password: string, confirmPassword: string): void {
    if (password !== confirmPassword) {
      throw new BadRequestException("两次输入的密码不一致。");
    }
    if (!isValidPassword(password)) {
      throw new BadRequestException("密码需要 8-64 位，并同时包含字母和数字。");
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
    const codeHash = hashSessionToken(code.trim());
    if (!record || record.codeHash !== codeHash) {
      throw new BadRequestException("邮箱验证码错误或已过期。");
    }
    const consumed = await (this.prisma as any).emailVerificationCode.updateMany({
      where: { id: record.id, codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() }
    });
    if (consumed.count !== 1) {
      throw new BadRequestException("邮箱验证码错误或已过期。");
    }
  }

  private createCode(): string {
    return String(randomInt(100000, 1000000));
  }

  private async assertEmailCodeRateLimit(email: string, purpose: string): Promise<void> {
    const result = await this.rateLimit.consume(`email-code:${purpose}`, email, 3, 10 * 60, { failureMode: "local" });
    if (!result.allowed) {
      throw new BadRequestException(`验证码请求过于频繁，请 ${result.retryAfterSeconds} 秒后再试。`);
    }
  }

  private async assertEmailCodeVerifyRateLimit(email: string, purpose: string): Promise<void> {
    const result = await this.rateLimit.consume(`email-code-verify:${purpose}`, email, 8, 10 * 60, { failureMode: "local" });
    if (!result.allowed) {
      throw new BadRequestException(`验证码尝试过于频繁，请 ${result.retryAfterSeconds} 秒后再试。`);
    }
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
