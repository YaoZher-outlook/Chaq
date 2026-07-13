const { mkdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { electronBuilderCache, projectRoot } = require("./env-paths");

const cli = require.resolve("electron-builder/out/cli/cli.js", { paths: [projectRoot] });
mkdirSync(electronBuilderCache, { recursive: true });

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || electronBuilderCache
  },
  stdio: "inherit",
  windowsHide: true
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
