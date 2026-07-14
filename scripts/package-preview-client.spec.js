const assert = require("node:assert/strict");
const test = require("node:test");
const {
  manifestMatches,
  normalizeMigrationRelativePath,
  previewBuildEnvironment,
  selectNonOverwritingMigrationFiles
} = require("./package-preview-client");

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

test("preview build environment removes inherited VITE variables and pins production settings", () => {
  const environment = previewBuildEnvironment({
    PATH: "test-path",
    NODE_ENV: "development",
    CHAQ_ENV_ROOT: "C:\\unexpected-root",
    ELECTRON_BUILDER_CACHE: "C:\\unexpected-builder-cache",
    TEMP: "C:\\unexpected-temp",
    ELECTRON_BUILDER_CACHE: "C:\\unexpected-builder-cache",
    npm_config_cache: "C:\\unexpected-npm-cache",
    VITE_SERVER_URL: "https://unexpected.example/api",
    VITE_UNTRUSTED_BUILD_VALUE: "must-not-leak",
    vite_lowercase_value: "must-not-leak-either"
  });

  assert.equal(environment.PATH, "test-path");
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.CHAQ_ENV_ROOT, "");
  assert.equal(environment.ELECTRON_BUILDER_CACHE, "");
  assert.doesNotMatch(environment.TEMP, /^C:/i);
  assert.equal(environment.VITE_SERVER_URL, "http://127.0.0.1:24538/api");
  assert.equal(environment.VITE_PUBLIC_SERVER_URL, "http://127.0.0.1:24538/api");
  assert.equal(environment.VITE_ALLOW_LOCAL_API_FALLBACK, "1");
  assert.equal(environment.VITE_FORCE_SERVER_URL, "1");
  assert.equal(environment.ELECTRON_BUILDER_CACHE, "");
  assert.match(environment.ELECTRON_CACHE, /[\\/]\.chaq-data[\\/]electron-cache$/);
  assert.match(environment.electron_config_cache, /[\\/]\.chaq-data[\\/]electron-cache$/);
  assert.match(environment.npm_config_cache, /[\\/]\.chaq-data[\\/]npm-cache$/);
  assert.equal("VITE_UNTRUSTED_BUILD_VALUE" in environment, false);
  assert.equal("vite_lowercase_value" in environment, false);
});

test("legacy preview data migration selects only safe files missing from the durable destination", () => {
  assert.equal(normalizeMigrationRelativePath("user-data\\session.json"), "user-data/session.json");
  assert.equal(normalizeMigrationRelativePath("..\\outside.txt"), null);
  assert.equal(normalizeMigrationRelativePath("E:\\outside.txt"), null);

  assert.deepEqual(selectNonOverwritingMigrationFiles([
    "user-data\\session.json",
    "user-data\\new.json",
    "runtime-cache-v2\\Cache\\entry",
    "USER-DATA\\NEW.JSON",
    "..\\outside.txt"
  ], [
    "USER-DATA/session.json"
  ]), [
    "user-data/new.json",
    "runtime-cache-v2/Cache/entry"
  ]);
});
