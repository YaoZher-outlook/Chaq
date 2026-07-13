export function isAllowedClientOrigin(
  origin: string | undefined,
  configuredOrigins: ReadonlySet<string>,
  production: boolean
): boolean {
  if (!origin || origin === "null" || origin.startsWith("file://")) return true;
  if (configuredOrigins.has(origin)) return true;
  return !production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
