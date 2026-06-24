const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { serverEnv, projectLogs } = require("./env-paths");

const root = path.resolve(__dirname, "..");
const publicBind = process.argv.includes("--public");
const skipBuild = process.argv.includes("--skip-build");
const host = publicBind ? "0.0.0.0" : "127.0.0.1";
const port = Number(process.env.SERVER_PORT || 24537);

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

function run(file, args, env) {
  console.log(`[Chaq] ${file} ${args.join(" ")}`);
  const result = spawnSync(file, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(" ")} failed with exit code ${result.status}`);
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
    env,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: false
  });
  child.unref();
  console.log(`[Chaq] Started ${label} pid=${child.pid}; log=${logPath}`);
  return child.pid;
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
  console.log(`[Chaq] Starting production API server and Agent worker (${host}:${port}).`);
  if (await assertPortAvailableOrReady()) return;

  run(command("npm"), ["run", "env:prepare"], process.env);
  const envFile = process.env.CHAQ_ENV_FILE || serverEnv;
  const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
  const env = {
    ...process.env,
    ...fileEnv,
    NODE_ENV: "production",
    CHAQ_SERVER_BIND: host,
    SERVER_HOST: host,
    SERVER_PORT: String(port),
    CHAQ_LOG_DIR: projectLogs
  };

  if (!fs.existsSync(path.join(root, "node_modules"))) {
    run(command("npm"), ["install"], env);
  }

  run(command("npm"), ["run", "infra:local"], env);
  run(command("npm"), ["run", "prisma:generate"], env);
  run(command("npm"), ["exec", "-w", "@chaq/server", "--", "prisma", "migrate", "deploy"], env);

  if (!skipBuild || !fs.existsSync(path.join(root, "apps", "server", "dist", "src", "main.js"))) {
    run(command("npm"), ["run", "build", "-w", "@chaq/shared"], env);
    run(command("npm"), ["run", "build", "-w", "@chaq/server"], env);
  }

  startProcess("Chaq production API", ["apps/server/dist/src/main.js"], "api-prod.log", env);
  startProcess("Chaq production Agent worker", ["apps/server/dist/src/worker.js"], "worker-prod.log", env);
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
