import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const iterations = 120_000;
const keyLength = 32;
const digest = "sha256";

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");
  return `sha256:${iterations}:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, rawIterations, salt, expected] = storedHash.split(":");
  if (scheme !== "sha256" || !rawIterations || !salt || !expected) {
    return false;
  }
  const actual = pbkdf2Sync(password, salt, Number(rawIterations), keyLength, digest).toString("hex");
  return safeEqual(actual, expected);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
