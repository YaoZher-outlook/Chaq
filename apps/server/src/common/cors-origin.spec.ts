import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedClientOrigin } from "./cors-origin";

test("production CORS only permits configured web origins and desktop file origins", () => {
  const configured = new Set(["https://chaq.example"]);
  assert.equal(isAllowedClientOrigin("https://chaq.example", configured, true), true);
  assert.equal(isAllowedClientOrigin("http://localhost:27337", configured, true), false);
  assert.equal(isAllowedClientOrigin("http://127.0.0.1:27337", configured, true), false);
  assert.equal(isAllowedClientOrigin("file://desktop/index.html", configured, true), true);
  assert.equal(isAllowedClientOrigin("null", configured, true), true);
});

test("development CORS permits loopback origins", () => {
  assert.equal(isAllowedClientOrigin("http://localhost:27337", new Set(), false), true);
  assert.equal(isAllowedClientOrigin("https://127.0.0.1:4443", new Set(), false), true);
  assert.equal(isAllowedClientOrigin("https://attacker.example", new Set(), false), false);
});
