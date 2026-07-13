const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTH_PROTOCOL_PREFIX = "chaq-auth.";

export function realtimeSessionToken(header: string | string[] | undefined): string | null {
  const protocols = (Array.isArray(header) ? header : [header ?? ""])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (!protocols.includes("chaq-v1")) return null;
  const credentials = protocols.filter((protocol) => protocol.startsWith(AUTH_PROTOCOL_PREFIX));
  if (credentials.length !== 1) return null;
  const token = credentials[0].slice(AUTH_PROTOCOL_PREFIX.length);
  return SESSION_TOKEN_PATTERN.test(token) ? token : null;
}
