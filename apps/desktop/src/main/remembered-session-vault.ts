import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

export type RememberedSession = {
  accountId: string;
  sessionToken: string;
  expiresAt: string;
};

export type SessionVaultCodec = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

type StoredSession = {
  accountId: string;
  expiresAt: string;
  ciphertext: string;
};

type StoredVault = {
  version: 1;
  sessions: StoredSession[];
};

export class RememberedSessionVault {
  constructor(
    private readonly filePath: string,
    private readonly codec: SessionVaultCodec
  ) {}

  save(session: RememberedSession): void {
    validateSession(session);
    if (!this.codec.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法安全记住登录状态。");
    }
    const sessions = this.read().filter((entry) => entry.accountId !== session.accountId);
    sessions.unshift({
      accountId: session.accountId,
      expiresAt: session.expiresAt,
      ciphertext: this.codec.encryptString(session.sessionToken).toString("base64")
    });
    this.persist(sessions.slice(0, 6));
  }

  get(accountId: string): RememberedSession | null {
    const entry = this.read().find((candidate) => candidate.accountId === accountId);
    if (!entry) return null;
    if (Date.parse(entry.expiresAt) <= Date.now()) {
      this.delete(accountId);
      return null;
    }
    if (!this.codec.isEncryptionAvailable()) {
      throw new Error("系统安全存储当前不可用，无法读取已记住的登录状态。");
    }
    return {
      accountId: entry.accountId,
      expiresAt: entry.expiresAt,
      sessionToken: this.codec.decryptString(Buffer.from(entry.ciphertext, "base64"))
    };
  }

  delete(accountId: string): void {
    const sessions = this.read();
    const next = sessions.filter((entry) => entry.accountId !== accountId);
    if (next.length !== sessions.length) this.persist(next);
  }

  private read(): StoredSession[] {
    const interrupted = readStoredVault(this.temporaryPath);
    if (interrupted) {
      replaceFile(this.temporaryPath, this.filePath);
      syncDirectory(dirname(this.filePath));
      return interrupted;
    }

    const primary = readStoredVault(this.filePath);
    if (primary) {
      rmSync(this.temporaryPath, { force: true });
      return primary;
    }

    const backup = readStoredVault(this.backupPath);
    if (!backup) return [];
    this.persist(backup, false);
    return backup;
  }

  private persist(sessions: StoredSession[], backupExisting = true): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const value: StoredVault = { version: 1, sessions };
    let committed = false;
    try {
      writeAndSync(this.temporaryPath, JSON.stringify(value));
      if (backupExisting && existsSync(this.filePath)) {
        writeAndSync(this.backupTemporaryPath, readFileSync(this.filePath));
        replaceFile(this.backupTemporaryPath, this.backupPath);
      }
      replaceFile(this.temporaryPath, this.filePath);
      syncDirectory(dirname(this.filePath));
      committed = true;
    } finally {
      // A valid temporary vault is the newest recoverable copy. Keep it when
      // commit fails so read() can finish the replacement on the next attempt.
      if (committed) {
        rmSync(this.temporaryPath, { force: true });
        rmSync(this.backupTemporaryPath, { force: true });
      }
    }
  }

  private get temporaryPath(): string {
    return `${this.filePath}.tmp`;
  }

  private get backupPath(): string {
    return `${this.filePath}.bak`;
  }

  private get backupTemporaryPath(): string {
    return `${this.filePath}.bak.tmp`;
  }
}

function readStoredVault(filePath: string): StoredSession[] | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<StoredVault>;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions) || !parsed.sessions.every(isStoredSession)) return null;
    return parsed.sessions;
  } catch {
    return null;
  }
}

function writeAndSync(filePath: string, value: string | Buffer): void {
  const descriptor = openSync(filePath, "w", 0o600);
  try {
    writeFileSync(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function replaceFile(source: string, target: string): void {
  try {
    renameSync(source, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!existsSync(target) || !["EEXIST", "EPERM", "EACCES"].includes(code ?? "")) throw error;
  }
  unlinkSync(target);
  renameSync(source, target);
}

function syncDirectory(directoryPath: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directoryPath, "r");
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function validateSession(session: RememberedSession): void {
  if (!session.accountId || session.accountId.length > 200) throw new Error("无效的账号标识。");
  if (!session.sessionToken || session.sessionToken.length > 10_000) throw new Error("无效的登录凭据。");
  if (!Number.isFinite(Date.parse(session.expiresAt))) throw new Error("无效的登录凭据过期时间。");
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<StoredSession>;
  return typeof entry.accountId === "string"
    && typeof entry.expiresAt === "string"
    && typeof entry.ciphertext === "string";
}
