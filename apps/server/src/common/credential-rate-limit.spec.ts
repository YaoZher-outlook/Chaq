import assert from "node:assert/strict";
import test from "node:test";
import { apiRateLimitIdentities, credentialRateLimitIdentities } from "./credential-rate-limit";
import { RateLimitService } from "./rate-limit.service";

test("credential limiter ignores attacker-controlled session headers and normalizes accounts", () => {
  const first = credentialRateLimitIdentities({
    ip: "::ffff:203.0.113.8",
    body: { username: "  User@Example.COM " },
    headers: { "x-session-token": "attacker-token-a" }
  } as never);
  const second = credentialRateLimitIdentities({
    ip: "203.0.113.8",
    body: { username: "user@example.com" },
    headers: { "x-session-token": "attacker-token-b" }
  } as never);

  assert.deepEqual(first, second);
  assert.ok(first.account);
});

test("credential limiter falls back to an enforcing local bucket when Redis is unavailable", async () => {
  const service = new RateLimitService() as any;
  service.redis = { connect: async () => { throw new Error("redis unavailable"); } };

  const first = await service.consume("credential:account", "account", 1, 60, { failureMode: "local" });
  const second = await service.consume("credential:account", "account", 1, 60, { failureMode: "local" });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.remaining, 0);
});

test("general API limiter always retains the IP identity across random session tokens", () => {
  const first = apiRateLimitIdentities({
    ip: "::ffff:203.0.113.8",
    headers: { "x-session-token": "random-a" }
  });
  const second = apiRateLimitIdentities({
    ip: "203.0.113.8",
    headers: { "x-session-token": "random-b" }
  });

  assert.equal(first.ip, second.ip);
  assert.notEqual(first.session, second.session);
});
