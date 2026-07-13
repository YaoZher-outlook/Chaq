import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSessionToken, UtilityBootstrapTokenStore } from "./utility-bootstrap-tokens";

const token = "a".repeat(43);

test("normalizeSessionToken accepts only a server-format base64url token", () => {
  assert.equal(normalizeSessionToken(`  ${token}  `), token);
  assert.equal(normalizeSessionToken("short"), null);
  assert.equal(normalizeSessionToken(`${"a".repeat(42)}+`), null);
  assert.equal(normalizeSessionToken({ token }), null);
});

test("utility bootstrap credentials are scoped, expiring, and consumed once", () => {
  let now = 1_000;
  const store = new UtilityBootstrapTokenStore(100, () => now);
  store.issue(7, token);

  assert.equal(store.consume(8), null);
  assert.equal(store.consume(7), token);
  assert.equal(store.consume(7), null);

  store.issue(7, token);
  now = 1_100;
  assert.equal(store.consume(7), null);
});

test("utility bootstrap credentials reject invalid owners and tokens", () => {
  const store = new UtilityBootstrapTokenStore();
  assert.throws(() => store.issue(0, token), /Invalid/);
  assert.throws(() => store.issue(1, "not-a-session-token"), /Invalid/);
});
