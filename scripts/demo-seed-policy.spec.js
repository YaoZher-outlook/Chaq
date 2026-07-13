const assert = require("node:assert/strict");
const test = require("node:test");
const { assertDemoSeedAllowed } = require("./demo-seed-policy");

test("demo seed is denied by default", () => {
  assert.throws(() => assertDemoSeedAllowed({ NODE_ENV: "development" }), /disabled by default/);
});

test("demo seed requires the exact local opt-in", () => {
  assert.doesNotThrow(() => assertDemoSeedAllowed({ NODE_ENV: "development", CHAQ_ALLOW_DEMO_SEED: "1" }));
  assert.throws(
    () => assertDemoSeedAllowed({ NODE_ENV: "development", CHAQ_ALLOW_DEMO_SEED: "true" }),
    /disabled by default/
  );
});

test("production seed is denied even with the opt-in", () => {
  assert.throws(
    () => assertDemoSeedAllowed({ NODE_ENV: "production", CHAQ_ALLOW_DEMO_SEED: "1" }),
    /NODE_ENV=production/
  );
});
