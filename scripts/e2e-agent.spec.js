const assert = require("node:assert/strict");
const test = require("node:test");
const { isLoopbackHostname, resolveE2EBaseUrl } = require("./e2e-agent");

test("Agent E2E accepts loopback URLs by default", () => {
  assert.equal(resolveE2EBaseUrl({ CHAQ_E2E_SERVER_URL: "http://localhost:24537/api/" }), "http://localhost:24537/api");
  assert.equal(resolveE2EBaseUrl({ CHAQ_E2E_SERVER_URL: "http://127.42.1.9:24537/api" }), "http://127.42.1.9:24537/api");
  assert.equal(resolveE2EBaseUrl({ CHAQ_E2E_SERVER_URL: "http://[::1]:24537/api" }), "http://[::1]:24537/api");
  assert.equal(isLoopbackHostname("127.255.255.255"), true);
});

test("Agent E2E rejects remote URLs unless explicitly allowed", () => {
  assert.throws(
    () => resolveE2EBaseUrl({ CHAQ_E2E_SERVER_URL: "https://staging.chaq.test/api" }),
    /non-loopback URL/
  );
  assert.equal(
    resolveE2EBaseUrl({
      CHAQ_E2E_SERVER_URL: "https://staging.chaq.test/api",
      CHAQ_ALLOW_REMOTE_E2E: "1"
    }),
    "https://staging.chaq.test/api"
  );
});

test("Agent E2E always rejects production mode", () => {
  assert.throws(
    () => resolveE2EBaseUrl({
      NODE_ENV: "production",
      CHAQ_E2E_SERVER_URL: "http://127.0.0.1:24537/api",
      CHAQ_ALLOW_REMOTE_E2E: "1"
    }),
    /NODE_ENV=production/
  );
});

test("Agent E2E rejects ambiguous or non-HTTP targets", () => {
  assert.throws(() => resolveE2EBaseUrl({ CHAQ_E2E_SERVER_URL: "not a URL" }), /valid HTTP/);
  assert.throws(() => resolveE2EBaseUrl({ CHAQ_E2E_SERVER_URL: "file:///tmp/chaq" }), /HTTP\(S\)/);
  assert.throws(
    () => resolveE2EBaseUrl({ CHAQ_E2E_SERVER_URL: "http://127.0.0.1:24537/api?target=remote" }),
    /without credentials/
  );
});
