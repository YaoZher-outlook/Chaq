import assert from "node:assert/strict";
import test from "node:test";
import { isPublicHealthPath } from "./public-route";

test("only the exact liveness and readiness routes bypass authentication", () => {
  assert.equal(isPublicHealthPath("/api/health/live"), true);
  assert.equal(isPublicHealthPath("/api/health/ready/"), true);
  assert.equal(isPublicHealthPath("/health/live?probe=1"), true);
  assert.equal(isPublicHealthPath("/api/users/health/live"), false);
  assert.equal(isPublicHealthPath("/api/health/private"), false);
  assert.equal(isPublicHealthPath("/api/health/live/anything"), false);
});
