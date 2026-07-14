const { mkdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { electronCache, npmCache, projectRoot } = require("./env-paths");
const { recordDependencyState } = require("./dependency-state");

const serverOnly = process.argv.includes("--server-only");
const cleanInstall = process.argv.includes("--ci");
const args = [cleanInstall ? "ci" : "install"];

if (serverOnly) {
  args.push(
    "--workspace", "@chaq/server",
    "--workspace", "@chaq/shared",
    "--include-workspace-root"
  );
}

mkdirSync(electronCache, { recursive: true });
mkdirSync(npmCache, { recursive: true });

const mirror = process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
const command = process.platform === "win32"
  ? (process.env.ComSpec || "cmd.exe")
  : "npm";
const commandArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", ["npm.cmd", ...args].map(quoteCommandArgument).join(" ")]
  : args;
const result = spawnSync(command, commandArgs, {
  cwd: projectRoot,
  env: {
    ...process.env,
    npm_config_cache: npmCache,
    electron_config_cache: electronCache,
    ELECTRON_MIRROR: mirror
  },
  stdio: "inherit",
  windowsHide: true
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (!serverOnly) {
  const electronResult = spawnSync(process.execPath, [
    require.resolve("./ensure-electron-runtime")
  ], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true
  });

  if (electronResult.error) throw electronResult.error;
  if (electronResult.status !== 0) process.exit(electronResult.status ?? 1);

  const dependencyState = recordDependencyState();
  console.log(`[dependencies] Recorded installed dependency state: ${dependencyState.stateFile}`);
}

process.exit(0);

function quoteCommandArgument(value) {
  return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(value)
    ? value
    : `"${String(value).replace(/"/g, '""')}"`;
}
