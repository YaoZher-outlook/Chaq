const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { electronCache, projectRoot } = require("./env-paths");

const electronPackage = require.resolve("electron/package.json", {
  paths: [projectRoot]
});
const electronDirectory = path.dirname(electronPackage);
const installScript = path.join(electronDirectory, "install.js");

if (hasElectronRuntime()) process.exit(0);

mkdirSync(electronCache, { recursive: true });
console.log("Electron runtime is missing; restoring it in the project dependency tree...");

const result = spawnSync(process.execPath, [installScript], {
  cwd: projectRoot,
  env: {
    ...process.env,
    electron_config_cache: electronCache,
    ELECTRON_MIRROR:
      process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/"
  },
  stdio: "inherit",
  windowsHide: true
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (!hasElectronRuntime()) {
  throw new Error("Electron installer completed without producing a usable runtime.");
}

function hasElectronRuntime() {
  const pathFile = path.join(electronDirectory, "path.txt");
  if (!existsSync(pathFile)) return false;

  const executable = readFileSync(pathFile, "utf8").trim();
  return executable.length > 0
    && existsSync(path.join(electronDirectory, "dist", executable));
}
