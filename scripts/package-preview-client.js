const fs = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { projectRoot } = require("./env-paths");

const previewApiUrl = "http://127.0.0.1:24538/api";
const desktopDirectory = path.join(projectRoot, "apps", "desktop");
const executablePath = path.join(desktopDirectory, "release-preview", "win-unpacked", "Chaq.exe");
const archivePath = path.join(desktopDirectory, "release-preview", "win-unpacked", "resources", "app.asar");
const manifestPath = path.join(projectRoot, ".chaq-data", "preview-client-build.json");
const sourceDirectories = [
  path.join(desktopDirectory, "src"),
  path.join(projectRoot, "packages", "shared", "src")
];
const sourceFiles = [
  path.join(desktopDirectory, "package.json"),
  path.join(desktopDirectory, "electron.vite.config.ts"),
  path.join(desktopDirectory, "index.html"),
  path.join(projectRoot, "packages", "shared", "package.json"),
  path.join(projectRoot, "package-lock.json"),
  path.join(projectRoot, "scripts", "ensure-electron-runtime.js"),
  path.join(projectRoot, "scripts", "package-preview-client.js"),
  path.join(projectRoot, "scripts", "run-electron-builder.js"),
  path.join(projectRoot, "tools", "start-preview.bat")
];

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(absolute) : entry.isFile() ? [absolute] : [];
    });
}

function previewBuildFingerprint() {
  const hash = createHash("sha256");
  hash.update(`preview-api=${previewApiUrl}\nforce-server=1\n`);
  const files = [...sourceDirectories.flatMap(listFiles), ...sourceFiles]
    .filter((file, index, list) => fs.existsSync(file) && list.indexOf(file) === index)
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const file of files) {
    hash.update(path.relative(projectRoot, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function packagedClientSnapshot() {
  if (!fs.existsSync(executablePath) || !fs.existsSync(archivePath)) return null;
  const executable = fs.statSync(executablePath);
  const archive = fs.statSync(archivePath);
  return {
    executableSize: executable.size,
    executableMtimeMs: Math.trunc(executable.mtimeMs),
    archiveSize: archive.size,
    archiveSha256: createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex")
  };
}

function manifestMatches(manifest, fingerprint, snapshot) {
  return Boolean(
    manifest
    && snapshot
    && manifest.version === 2
    && manifest.apiUrl === previewApiUrl
    && manifest.forceConfiguredServer === true
    && manifest.fingerprint === fingerprint
    && manifest.executableSize === snapshot.executableSize
    && manifest.executableMtimeMs === snapshot.executableMtimeMs
    && manifest.archiveSize === snapshot.archiveSize
    && manifest.archiveSha256 === snapshot.archiveSha256
  );
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function previewClientIsCurrent() {
  return manifestMatches(readManifest(), previewBuildFingerprint(), packagedClientSnapshot());
}

function previewBuildEnvironment() {
  return {
    ...process.env,
    CHAQ_ENV_ROOT: "",
    VITE_SERVER_URL: previewApiUrl,
    VITE_PUBLIC_SERVER_URL: previewApiUrl,
    VITE_ALLOW_LOCAL_API_FALLBACK: "1",
    VITE_FORCE_SERVER_URL: "1"
  };
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(file)} ${args.join(" ")} failed with exit code ${result.status}.`);
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (!npmCli) {
    throw new Error("Could not locate npm-cli.js. Run this command through npm or install npm beside Node.js.");
  }
  return npmCli;
}

function writeManifest() {
  const snapshot = packagedClientSnapshot();
  if (!snapshot) throw new Error(`Preview executable was not produced at ${executablePath}.`);
  const manifest = {
    version: 2,
    apiUrl: previewApiUrl,
    forceConfiguredServer: true,
    fingerprint: previewBuildFingerprint(),
    ...snapshot,
    builtAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\r\n`, "utf8");
  fs.renameSync(temporary, manifestPath);
}

function buildPreviewClient() {
  const env = previewBuildEnvironment();
  run(process.execPath, [path.join(projectRoot, "scripts", "ensure-electron-runtime.js")], { env });
  run(process.execPath, [resolveNpmCli(), "run", "build", "-w", "@chaq/desktop"], { env });
  run(process.execPath, [
    path.join(projectRoot, "scripts", "run-electron-builder.js"),
    "--dir",
    "-c.win.signAndEditExecutable=false",
    "-c.directories.output=release-preview"
  ], { cwd: desktopDirectory, env });
  writeManifest();
  console.log(`[Chaq] Preview client package is current: ${executablePath}`);
}

if (require.main === module) {
  try {
    if (process.argv.includes("--check")) {
      if (previewClientIsCurrent()) {
        console.log("[Chaq] Preview client build manifest is current.");
        process.exit(0);
      }
      console.log("[Chaq] Preview client requires a rebuild.");
      process.exit(1);
    }
    buildPreviewClient();
  } catch (error) {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { manifestMatches, previewBuildFingerprint, previewClientIsCurrent };
