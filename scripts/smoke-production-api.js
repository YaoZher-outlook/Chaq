const assert = require("node:assert/strict");

const apiUrl = String(process.env.CHAQ_SMOKE_API_URL || "http://127.0.0.1:24537/api").replace(/\/$/, "");
const username = String(process.env.CHAQ_SMOKE_USERNAME || "").trim();
const password = String(process.env.CHAQ_SMOKE_PASSWORD || "");

async function request(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${path} returned non-JSON content (${response.status}).`);
    }
  }
  return { body, response };
}

async function main() {
  assert.ok(username, "CHAQ_SMOKE_USERNAME is required.");
  assert.ok(password, "CHAQ_SMOKE_PASSWORD is required.");

  const health = await request("/health/ready");
  assert.equal(health.response.status, 200, "readiness endpoint must succeed");
  assert.equal(health.body?.status, "ok", "readiness endpoint must report ok");

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.response.status, 201, `login failed: ${login.body?.message || login.response.status}`);
  assert.equal(login.body?.user?.username, username);
  assert.match(login.body?.sessionToken || "", /^[A-Za-z0-9_-]{32,}$/);
  const token = login.body.sessionToken;

  const me = await request("/users/me", { headers: { "x-session-token": token } });
  assert.equal(me.response.status, 200, `authenticated request failed: ${me.body?.message || me.response.status}`);
  assert.equal(me.body?.username, username);

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { "x-session-token": token },
    body: JSON.stringify({})
  });
  assert.equal(logout.response.status, 201, "logout must succeed");

  const revoked = await request("/users/me", { headers: { "x-session-token": token } });
  assert.equal(revoked.response.status, 401, "a logged-out token must be rejected");
  console.log("[smoke] Production API readiness, login, authenticated request, and logout passed.");
}

main().catch((error) => {
  console.error(`[smoke:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
