import assert from "node:assert/strict";
import test from "node:test";
import { api, getServerUrl } from "./api";

const PRIMARY_SERVER = "https://primary.example.test/api";
const OTHER_SERVER = "https://other.example.test/api";
const ONLINE_SERVER = "https://chaq.yaozher.com/api";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("desktop API failover keeps credentials and writes on one server", async (t) => {
  const originalFetch = globalThis.fetch;
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });

  t.after(() => {
    globalThis.fetch = originalFetch;
    delete (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  });

  const reset = () => {
    local.clear();
    session.clear();
    local.setItem("chaq.serverUrl", PRIMARY_SERVER);
  };

  await t.test("login credentials are not sent to a fallback origin", async () => {
    reset();
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      throw new TypeError("primary is offline");
    }) as typeof fetch;

    await assert.rejects(api.login({ username: "private-user", password: "private-password" }));
    assert.deepEqual(calls, [{
      url: `${PRIMARY_SERVER}/auth/login`,
      body: JSON.stringify({ username: "private-user", password: "private-password" })
    }]);
  });

  await t.test("POST is not replayed after a retryable gateway response", async () => {
    reset();
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      calls.push(String(input));
      return jsonResponse({ message: "temporarily unavailable" }, 503);
    }) as typeof fetch;

    await assert.rejects(api.saveSettings({ theme: "dark" }));
    assert.deepEqual(calls, [`${PRIMARY_SERVER}/users/me/settings`]);
  });

  await t.test("unauthenticated GET may fail over to the next candidate", async () => {
    reset();
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(PRIMARY_SERVER)) throw new TypeError("primary is offline");
      return jsonResponse([]);
    }) as typeof fetch;

    assert.deepEqual(await api.providers(), []);
    assert.deepEqual(calls, [
      `${PRIMARY_SERVER}/models/providers`,
      `${ONLINE_SERVER}/models/providers`
    ]);
  });

  await t.test("an authenticated session stays on its successful origin", async () => {
    reset();
    const calls: Array<{ url: string; token: string | null }> = [];
    globalThis.fetch = (async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), token: headers.get("x-session-token") });
      return jsonResponse({ sessionToken: "issued-token" });
    }) as typeof fetch;

    await api.login({ username: "user", password: "password" });
    session.setItem("chaq.sessionToken", "issued-token");
    local.setItem("chaq.serverUrl", OTHER_SERVER);
    assert.equal(getServerUrl(), PRIMARY_SERVER);
    await api.providers();

    assert.deepEqual(calls, [
      { url: `${PRIMARY_SERVER}/auth/login`, token: null },
      { url: `${PRIMARY_SERVER}/models/providers`, token: "issued-token" }
    ]);
  });
});
