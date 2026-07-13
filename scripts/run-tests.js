const { spawnSync } = require("node:child_process");
const { mkdirSync, readdirSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const testTemp = path.join(root, ".chaq-data", "test-tmp");
mkdirSync(testTemp, { recursive: true });
const ignoredDirectories = new Set(["node_modules", "dist", "out", "release", "coverage", ".git", ".chaq-data"]);
const testPattern = /\.(spec|test)\.[cm]?[jt]sx?$/;

function discoverTests(directory) {
  const tests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) tests.push(...discoverTests(absolute));
    else if (entry.isFile() && testPattern.test(entry.name)) tests.push(path.relative(root, absolute).replace(/\\/g, "/"));
  }
  return tests;
}

const testFiles = ["apps", "packages", "scripts"]
  .flatMap((directory) => discoverTests(path.join(root, directory)))
  .sort((left, right) => left.localeCompare(right, "en"));

if (!testFiles.length) {
  console.error("[test] No test files were discovered.");
  process.exit(1);
}

const nodeArguments = [];
if (process.argv.includes("--coverage")) {
  nodeArguments.push(
    "--experimental-test-coverage",
    "--test-coverage-exclude=**/*.spec.*",
    "--test-coverage-exclude=**/*.test.*",
    `--test-coverage-lines=${process.env.CHAQ_COVERAGE_LINES || "55"}`,
    `--test-coverage-branches=${process.env.CHAQ_COVERAGE_BRANCHES || "65"}`,
    `--test-coverage-functions=${process.env.CHAQ_COVERAGE_FUNCTIONS || "55"}`
  );
}
nodeArguments.push("--import", "tsx", "--test", ...testFiles);

console.log(`[test] Running ${testFiles.length} discovered test files${process.argv.includes("--coverage") ? " with coverage" : ""}.`);

const result = spawnSync(process.execPath, nodeArguments, {
  stdio: "inherit",
  env: {
    ...process.env,
    TEMP: testTemp,
    TMP: testTemp,
    TMPDIR: testTemp,
    TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH || "tsconfig.json"
  }
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
