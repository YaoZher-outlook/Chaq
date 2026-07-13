import { createHash } from "node:crypto";

type CredentialRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

export type CredentialRateLimitIdentities = {
  ip: string;
  account?: string;
};

export type ApiRateLimitIdentities = {
  ip: string;
  session?: string;
};

export function credentialRateLimitIdentities(request: CredentialRequest): CredentialRateLimitIdentities {
  const ip = normalizeIp(request.ip || request.socket?.remoteAddress || "unknown");
  const account = credentialAccount(request.body);
  return {
    ip: digest(ip),
    ...(account ? { account: digest(account) } : {})
  };
}

/**
 * Every API call keeps an IP baseline bucket. A session bucket is additional,
 * never a replacement, because the session header is attacker-controlled until
 * authentication succeeds.
 */
export function apiRateLimitIdentities(request: CredentialRequest): ApiRateLimitIdentities {
  const ip = normalizeIp(request.ip || request.socket?.remoteAddress || "unknown");
  const header = request.headers?.["x-session-token"];
  const token = (Array.isArray(header) ? header[0] : header)?.trim();
  return {
    ip: digest(ip),
    ...(token ? { session: digest(token.slice(0, 512)) } : {})
  };
}

function credentialAccount(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const candidate = typeof value.username === "string"
    ? value.username
    : typeof value.email === "string"
      ? value.email
      : null;
  const normalized = candidate?.trim().toLowerCase().slice(0, 256) ?? "";
  return normalized || null;
}

function normalizeIp(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized || "unknown";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
