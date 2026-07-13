const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type BootstrapTokenEntry = {
  token: string;
  expiresAt: number;
};

export function normalizeSessionToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

export class UtilityBootstrapTokenStore {
  private readonly entries = new Map<number, BootstrapTokenEntry>();

  constructor(
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now
  ) {}

  issue(webContentsId: number, value: unknown): void {
    const token = normalizeSessionToken(value);
    if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0 || !token) {
      throw new Error("Invalid utility-window bootstrap credential.");
    }
    this.entries.set(webContentsId, { token, expiresAt: this.now() + this.ttlMs });
  }

  consume(webContentsId: number): string | null {
    const entry = this.entries.get(webContentsId);
    this.entries.delete(webContentsId);
    if (!entry || entry.expiresAt <= this.now()) return null;
    return entry.token;
  }

  revoke(webContentsId: number): void {
    this.entries.delete(webContentsId);
  }
}
