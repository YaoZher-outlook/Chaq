const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function realtimeWebSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function realtimeWebSocketProtocols(sessionToken: string): ["chaq-v1", string] {
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) throw new Error("Invalid realtime session credential.");
  return ["chaq-v1", `chaq-auth.${sessionToken}`];
}
