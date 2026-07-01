const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { serverEnv, projectLogs } = require("./env-paths");

const root = path.resolve(__dirname, "..");
const publicBind = process.argv.includes("--public");
const skipBuild = process.argv.includes("--skip-build");
const statusOnly = process.argv.includes("--status");
const stopOnly = process.argv.includes("--stop");
const restart = process.argv.includes("--restart");
const foreground = process.argv.includes("--foreground");
const host = publicBind ? "0.0.0.0" : "127.0.0.1";
const port = Number(process.env.CHAQ_PROD_SERVER_PORT || process.env.SERVER_PORT || 24538);
const pidDir = path.join(projectLogs, "pids");
const apiPidFile = path.join(pidDir, `api-${port}.pid`);
const workerPidFile = path.join(pidDir, `worker-${port}.pid`);

function parseEnv(text) {
  const entries = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function command(name) {
  return process.platform === "win32" && !name.endsWith(".cmd") ? `${name}.cmd` : name;
}

function sanitizeEnv(source) {
  const env = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    const normalized = process.platform === "win32" ? key.toUpperCase() : key;
    if (process.platform === "win32" && normalized === "PATH") continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    env[key] = String(value);
  }
  if (process.platform === "win32") {
    env.Path = String(source.Path || source.PATH || process.env.Path || process.env.PATH || "");
  }
  return env;
}

function quoteCmdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function run(file, args, env) {
  console.log(`[Chaq] ${file} ${args.join(" ")}`);
  const safeEnv = sanitizeEnv(env);
  const commandLine = [file, ...args].map(quoteCmdArg).join(" ");
  const useCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
  const result = useCmd
    ? spawnSync(safeEnv.ComSpec || process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: root,
      env: safeEnv,
      stdio: "inherit",
      windowsHide: true
    })
    : spawnSync(file, args, {
    cwd: root,
    env: safeEnv,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function prismaClientAvailable() {
  const clientIndex = path.join(root, "node_modules", ".prisma", "client", "index.js");
  const clientSchema = path.join(root, "node_modules", ".prisma", "client", "schema.prisma");
  return fs.existsSync(clientIndex) && fs.existsSync(clientSchema);
}

function ensurePrismaClient(env) {
  if (env.FORCE_PRISMA_GENERATE === "1" || !prismaClientAvailable()) {
    try {
      run(command("npm"), ["run", "prisma:generate"], env);
    } catch (error) {
      const clientIndex = path.join(root, "node_modules", ".prisma", "client", "index.js");
      if (fs.existsSync(clientIndex)) {
        console.log("[WARN] Prisma generate failed, but an existing Prisma Client is available. Continuing startup.");
        console.log(`[WARN] ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      throw error;
    }
    return;
  }
  console.log("[Chaq] Prisma Client is available. Skipping generate to avoid Windows DLL locks.");
}

function ensureEnvironmentFile() {
  fs.mkdirSync(projectLogs, { recursive: true });
  if (fs.existsSync(serverEnv) && process.env.FORCE_ENV_PREPARE !== "1") {
    console.log(`[Chaq] Using existing server env: ${serverEnv}`);
    return;
  }
  try {
    require("./prepare-env");
  } catch (error) {
    if (fs.existsSync(serverEnv)) {
      console.log(`[WARN] Could not rewrite server env, using existing file: ${serverEnv}`);
      console.log(`[WARN] ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    throw error;
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($process) { exit 0 }; exit 1`
    ], {
      stdio: "pipe",
      encoding: "utf8",
      windowsHide: true
    });
    return result.status === 0;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function writePid(file, pid) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${pid}\r\n`, "utf8");
}

function removePid(file) {
  fs.rmSync(file, { force: true });
}

function findListeningPid(targetPort) {
  if (process.platform !== "win32") return null;
  const result = spawnSync("netstat.exe", ["-ano", "-p", "tcp"], {
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return null;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[1] || "";
    const pid = Number(parts[parts.length - 1]);
    if (local.endsWith(`:${targetPort}`) && Number.isInteger(pid)) return pid;
  }
  return null;
}

function normalizeProcessText(value) {
  return String(value || "").toLowerCase().replace(/\//g, "\\");
}

function findProjectNodePids(scriptName) {
  if (process.platform !== "win32") return [];
  const ps = [
    "$ErrorActionPreference='Stop'",
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
    "| Select-Object ProcessId,CommandLine",
    "| ConvertTo-Json -Compress"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const project = normalizeProcessText(root);
    const script = normalizeProcessText(path.join("apps", "server", "dist", "src", scriptName));
    return rows
      .filter((row) => {
        const commandLine = normalizeProcessText(row.CommandLine);
        return commandLine.includes(project) && commandLine.includes(script);
      })
      .map((row) => Number(row.ProcessId))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function productionWorkerRunning() {
  const pid = readPid(workerPidFile);
  return (pid && processExists(pid)) || findProjectNodePids("worker.js").length > 0;
}

function ensureProductionWorker(env) {
  if (productionWorkerRunning()) {
    console.log("[Chaq] Production Agent worker is already running.");
    return;
  }
  const workerEntry = path.join(root, "apps", "server", "dist", "src", "worker.js");
  if (!fs.existsSync(workerEntry)) {
    run(command("npm"), ["run", "build", "-w", "@chaq/shared"], env);
    run(command("npm"), ["run", "build", "-w", "@chaq/server"], env);
  }
  const workerPid = startProcess("Chaq production Agent worker", ["apps/server/dist/src/worker.js"], "worker-prod.log", env);
  writePid(workerPidFile, workerPid);
}

function stopPid(pid, label) {
  if (!processExists(pid)) {
    console.log(`[Chaq] ${label} pid=${pid} is not running.`);
    return;
  }
  console.log(`[Chaq] Stopping ${label} pid=${pid}...`);
  const result = process.platform === "win32"
    ? spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "pipe", encoding: "utf8", windowsHide: true })
    : spawnSync("kill", [String(pid)], { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0 && processExists(pid)) {
    throw new Error(`Could not stop ${label} pid=${pid}: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function canConnect(hostname, targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port: targetPort });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function readReady() {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/health/ready", timeout: 1500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve({
            ready: response.statusCode === 200 && data.status === "ok" && data.database === "ready" && data.redis === "ready",
            data
          });
        } catch {
          resolve({ ready: false, data: null });
        }
      });
    });
    request.once("timeout", () => {
      request.destroy();
      resolve({ ready: false, data: null });
    });
    request.once("error", () => resolve({ ready: false, data: null }));
  });
}

async function assertPortAvailableOrReady() {
  if (!(await canConnect("127.0.0.1", port))) return false;
  const status = await readReady();
  if (status.ready) {
    const mode = status.data && typeof status.data.mode === "string" ? status.data.mode : "unknown";
    if (mode !== "production" && mode !== "unknown") {
      throw new Error(`Port ${port} already has a Chaq API in ${mode} mode. Stop that process before starting production.`);
    }
    console.log(`[Chaq] API is already ready on http://127.0.0.1:${port}/api.`);
    if (mode === "unknown") {
      console.log("[Chaq] Existing API did not report runtime mode; startup was skipped to avoid a duplicate server.");
    }
    return true;
  }
  throw new Error(`Port ${port} is occupied, but it is not a ready Chaq API.`);
}

function startProcess(label, args, logName, env) {
  fs.mkdirSync(projectLogs, { recursive: true });
  const logPath = path.join(projectLogs, logName);
  fs.appendFileSync(logPath, `\r\n===== ${label} start ${new Date().toISOString()} =====\r\n`, "utf8");
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: sanitizeEnv(env),
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true
  });
  child.unref();
  fs.appendFileSync(logPath, `[Chaq] ${label} pid=${child.pid}\r\n`, "utf8");
  console.log(`[Chaq] Started ${label} pid=${child.pid}; log=${logPath}`);
  return child.pid;
}

function startForegroundProcess(label, args, logName, env) {
  fs.mkdirSync(projectLogs, { recursive: true });
  const logPath = path.join(projectLogs, logName);
  const log = fs.createWriteStream(logPath, { flags: "a" });
  log.write(`\r\n===== ${label} start ${new Date().toISOString()} =====\r\n`);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: sanitizeEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  log.write(`[Chaq] ${label} pid=${child.pid}\r\n`);
  console.log(`[Chaq] Started ${label} pid=${child.pid}; log=${logPath}`);

  child.stdout.on("data", (chunk) => {
    log.write(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    log.write(chunk);
    process.stderr.write(chunk);
  });
  child.on("exit", (code, signal) => {
    log.write(`[Chaq] ${label} exited with code=${code ?? ""} signal=${signal ?? ""}\r\n`);
    log.end();
  });

  return { child, label };
}

function stopForegroundChildren(children) {
  for (const item of children) {
    if (!item.child.killed && item.child.exitCode == null) {
      stopPid(item.child.pid, item.label);
    }
  }
  removePid(apiPidFile);
  removePid(workerPidFile);
}

function keepForegroundAlive(children) {
  return new Promise((resolve, reject) => {
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      console.log("[Chaq] Stopping production API server and Agent worker...");
      try {
        stopForegroundChildren(children);
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("SIGHUP", shutdown);

    for (const item of children) {
      item.child.once("exit", (code, signal) => {
        if (stopping) return;
        stopping = true;
        try {
          stopForegroundChildren(children.filter((candidate) => candidate !== item));
        } catch {
          // The original process exit is the actionable failure.
        }
        reject(new Error(`${item.label} exited unexpectedly with code=${code ?? ""} signal=${signal ?? ""}. Check .logs for details.`));
      });
    }
  });
}

async function printStatus() {
  const status = await readReady();
  const apiPid = readPid(apiPidFile);
  const workerPid = readPid(workerPidFile);
  const listenerPid = findListeningPid(port);
  const scannedApiPids = findProjectNodePids("main.js");
  const scannedWorkerPids = findProjectNodePids("worker.js");
  console.log(`[Chaq] Production port: ${port}`);
  console.log(`[Chaq] API ready: ${status.ready ? "yes" : "no"}`);
  if (status.data) {
    console.log(`[Chaq] API mode: ${status.data.mode || "unknown"}; host: ${status.data.host || "unknown"}`);
    console.log(`[Chaq] Database: ${status.data.database || "unknown"}; Redis: ${status.data.redis || "unknown"}`);
  }
  console.log(`[Chaq] API pid file: ${apiPid ?? "missing"}${apiPid ? ` (${processExists(apiPid) ? "running" : "stale"})` : ""}`);
  console.log(`[Chaq] Worker pid file: ${workerPid ?? "missing"}${workerPid ? ` (${processExists(workerPid) ? "running" : "stale"})` : ""}`);
  console.log(`[Chaq] Listening pid on ${port}: ${listenerPid ?? "none"}`);
  if (scannedApiPids.length) console.log(`[Chaq] Project production API pids: ${scannedApiPids.join(", ")}`);
  if (scannedWorkerPids.length) console.log(`[Chaq] Project production worker pids: ${scannedWorkerPids.join(", ")}`);
  if (status.ready && (!apiPid || !workerPid) && !scannedWorkerPids.length) {
    console.log("[WARN] Production API is ready, but pid files are missing. This process was probably started by an older launcher.");
    console.log("[WARN] Close old production node processes once, then run tools\\start-server-prod.bat to adopt the managed startup scheme.");
  }
  console.log(`[Chaq] Logs: ${path.join(projectLogs, "api-prod.log")} ; ${path.join(projectLogs, "worker-prod.log")}`);
  return status.ready;
}

async function stopProduction() {
  const status = await readReady();
  const apiPid = readPid(apiPidFile);
  const workerPid = readPid(workerPidFile);
  const listenerPid = findListeningPid(port);
  const scannedApiPids = findProjectNodePids("main.js");
  const scannedWorkerPids = findProjectNodePids("worker.js");
  if (listenerPid && status.ready && status.data?.mode !== "production") {
    throw new Error(`Port ${port} is used by a ${status.data?.mode || "non-production"} Chaq API. Refusing to stop it as production.`);
  }
  const seen = new Set();
  const pids = [
    { pid: workerPid, label: "production Agent worker", file: workerPidFile },
    { pid: apiPid, label: "production API", file: apiPidFile },
    !apiPid && listenerPid && status.ready ? { pid: listenerPid, label: "production API listener", file: null } : null,
    ...scannedWorkerPids.map((pid) => ({ pid, label: "production Agent worker", file: null })),
    ...scannedApiPids.map((pid) => ({ pid, label: "production API", file: null }))
  ].filter((item) => {
    if (!item?.pid || seen.has(item.pid)) return false;
    seen.add(item.pid);
    return true;
  });
  if (!pids.length) {
    console.log(`[Chaq] No production pid files found for port ${port}.`);
    if (!status.ready) return;
  }
  for (const item of pids) {
    stopPid(item.pid, item.label);
    if (item.file) removePid(item.file);
  }
  for (let index = 0; index < 20; index += 1) {
    if (!(await canConnect("127.0.0.1", port))) {
      console.log(`[Chaq] Production API port ${port} is stopped.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(`[WARN] Port ${port} is still reachable after stop. Check .logs\\api-prod.log and .logs\\worker-prod.log for details.`);
}

async function waitForReady() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await readReady();
    if (status.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Chaq API did not become ready on http://127.0.0.1:${port}/api within 90 seconds.`);
}

async function main() {
  if (statusOnly) {
    await printStatus();
    return;
  }
  if (stopOnly || restart) {
    await stopProduction();
    if (stopOnly) return;
  }

  ensureEnvironmentFile();
  const envFile = process.env.CHAQ_ENV_FILE || serverEnv;
  const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
  const env = {
    ...process.env,
    ...fileEnv,
    NODE_ENV: "production",
    CHAQ_SERVER_BIND: host,
    CHAQ_PROD_SERVER_PORT: String(port),
    SERVER_HOST: host,
    SERVER_PORT: String(port),
    CHAQ_LOG_DIR: projectLogs
  };

  console.log(`[Chaq] Starting production API server and Agent worker (${host}:${port}).`);
  if (await assertPortAvailableOrReady()) {
    ensureProductionWorker(env);
    return;
  }

  if (!fs.existsSync(path.join(root, "node_modules"))) {
    run(command("npm"), ["install"], env);
  }

  run(command("npm"), ["run", "infra:local"], env);
  ensurePrismaClient(env);
  run(command("npm"), ["exec", "-w", "@chaq/server", "--", "prisma", "migrate", "deploy"], env);

  if (!skipBuild || !fs.existsSync(path.join(root, "apps", "server", "dist", "src", "main.js"))) {
    run(command("npm"), ["run", "build", "-w", "@chaq/shared"], env);
    run(command("npm"), ["run", "build", "-w", "@chaq/server"], env);
  }

  if (foreground) {
    const children = [
      startForegroundProcess("Chaq production API", ["apps/server/dist/src/main.js"], "api-prod.log", env),
      startForegroundProcess("Chaq production Agent worker", ["apps/server/dist/src/worker.js"], "worker-prod.log", env)
    ];
    writePid(apiPidFile, children[0].child.pid);
    writePid(workerPidFile, children[1].child.pid);
    await waitForReady();
    console.log(`[Chaq] Production API is ready on http://127.0.0.1:${port}/api.`);
    if (publicBind) {
      console.log(`[Chaq] Public bind is enabled on 0.0.0.0:${port}. Put Cloudflare Tunnel or a TLS reverse proxy in front of it before Internet exposure.`);
    }
    console.log("[Chaq] Production server is running in this window. Press Ctrl+C or close this window to stop it.");
    await keepForegroundAlive(children);
    return;
  }

  const apiPid = startProcess("Chaq production API", ["apps/server/dist/src/main.js"], "api-prod.log", env);
  const workerPid = startProcess("Chaq production Agent worker", ["apps/server/dist/src/worker.js"], "worker-prod.log", env);
  writePid(apiPidFile, apiPid);
  writePid(workerPidFile, workerPid);
  await waitForReady();
  console.log(`[Chaq] Production API is ready on http://127.0.0.1:${port}/api.`);
  if (publicBind) {
    console.log(`[Chaq] Public bind is enabled on 0.0.0.0:${port}. Put Cloudflare Tunnel or a TLS reverse proxy in front of it before Internet exposure.`);
  }
}

main().catch((error) => {
  console.log(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
