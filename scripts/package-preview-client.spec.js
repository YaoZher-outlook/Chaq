const assert = require("node:assert/strict");
const test = require("node:test");
const { manifestMatches } = require("./package-preview-client");

test("preview client manifest binds the executable to localhost build settings and source fingerprint", () => {
  const snapshot = {
    executableSize: 1234,
    executableMtimeMs: 5678,
    archiveSize: 9012,
    archiveSha256: "archive-hash"
  };
  const valid = {
    version: 2,
    apiUrl: "http://127.0.0.1:24538/api",
    forceConfiguredServer: true,
    fingerprint: "fingerprint",
    ...snapshot
  };
  assert.equal(manifestMatches(valid, "fingerprint", snapshot), true);
  assert.equal(manifestMatches({ ...valid, apiUrl: "https://public.example/api" }, "fingerprint", snapshot), false);
  assert.equal(manifestMatches({ ...valid, forceConfiguredServer: false }, "fingerprint", snapshot), false);
  assert.equal(manifestMatches(valid, "changed", snapshot), false);
  assert.equal(manifestMatches(valid, "fingerprint", { ...snapshot, executableSize: 1235 }), false);
  assert.equal(manifestMatches(valid, "fingerprint", { ...snapshot, archiveSha256: "changed" }), false);
});
