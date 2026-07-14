const assert = require("node:assert/strict");
const test = require("node:test");
const { parseVersion, versionAtLeast } = require("./check-node-version");

test("one-click launcher enforces the declared minimum Node.js version", () => {
  assert.deepEqual(parseVersion("v22.12.0"), [22, 12, 0]);
  assert.equal(versionAtLeast("22.11.9"), false);
  assert.equal(versionAtLeast("22.12.0"), true);
  assert.equal(versionAtLeast("23.0.0"), true);
  assert.equal(versionAtLeast("not-a-version"), false);
});
