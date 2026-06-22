const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  postgresData,
  postgresLog,
  serverEnv
} = require("./env-paths");

require("./prepare-env");

function parseEnv(text) {
  const entries = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index < 1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function readEnv() {
  const envFile = process.env.CHAQ_ENV_FILE || serverEnv;
  if (!fs.existsSync(envFile)) {
    throw new Error(`Chaq env file not found: ${envFile}. Run npm run env:prepare first.`);
  }
  return { envFile, values: parseEnv(fs.readFileSync(envFile, "utf8")) };
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = options.capture ? `${result.stdout || ""}${result.stderr || ""}`.trim() : "";
    throw new Error(`${path.basename(file)} ${args.join(" ")} failed with exit code ${result.status}${details ? `: ${details}` : ""}`);
  }
  return result.stdout?.trim() ?? "";
}

function serviceExists(name) {
  const result = spawnSync("sc.exe", ["query", name], {
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0;
}

function serviceUsesPort(name, port) {
  const result = spawnSync("sc.exe", ["qc", name], {
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.includes(`-p ${port}`);
}

function runningPostgresPort(pgData) {
  const pidFile = path.join(pgData, "postmaster.pid");
  if (!fs.existsSync(pidFile)) {
    return null;
  }
  const lines = fs.readFileSync(pidFile, "utf8").split(/\r?\n/);
  const port = Number(lines[3]);
  return Number.isInteger(port) ? port : null;
}

function canConnect(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1200);
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

async function waitForPort(port, label) {
  for (let index = 0; index < 25; index += 1) {
    if (await canConnect(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not open 127.0.0.1:${port} in time.`);
}

function postgresExe(pgBin, name) {
  const fullPath = path.join(pgBin, `${name}.exe`);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`${name}.exe not found in ${pgBin}`);
  }
  return fullPath;
}

async function startPostgres(env) {
  const pgBin = env.CHAQ_PG_BIN || "E:\\Environment\\pgsql\\bin";
  const pgData = env.CHAQ_PG_DATA_DIR || postgresData;
  const pgUser = env.CHAQ_PG_USER || "chaq";
  const pgPassword = env.CHAQ_PG_PASSWORD || "chaq";
  const pgDatabase = env.CHAQ_PG_DATABASE || "chaq";
  const pgPort = Number(env.CHAQ_PG_PORT || new URL(env.DATABASE_URL).port || 45432);
  const passwordFile = path.join(path.dirname(pgData), "postgres-password.tmp");

  fs.mkdirSync(pgData, { recursive: true });
  fs.mkdirSync(path.dirname(postgresLog), { recursive: true });

  const initdb = postgresExe(pgBin, "initdb");
  const pgCtl = postgresExe(pgBin, "pg_ctl");
  const pgIsReady = postgresExe(pgBin, "pg_isready");
  const psql = postgresExe(pgBin, "psql");
  const createdb = postgresExe(pgBin, "createdb");
  const serviceName = env.CHAQ_PG_SERVICE_NAME || "ChaqPostgreSQL";

  if (!fs.existsSync(path.join(pgData, "PG_VERSION"))) {
    console.log(`[Chaq] Initializing local PostgreSQL data at ${pgData}`);
    fs.writeFileSync(passwordFile, pgPassword, "utf8");
    try {
      run(initdb, ["-D", pgData, "-U", pgUser, "--pwfile", passwordFile, "-A", "scram-sha-256", "-E", "UTF8"]);
    } finally {
      fs.rmSync(passwordFile, { force: true });
    }
  }

  const ready = spawnSync(pgIsReady, ["-h", "127.0.0.1", "-p", String(pgPort), "-U", pgUser], {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: pgPassword },
    windowsHide: true
  });
  if (ready.status !== 0) {
    const runningPort = runningPostgresPort(pgData);
    if (runningPort && runningPort !== pgPort) {
      console.warn(`[WARN] PostgreSQL is running from ${pgData} on port ${runningPort}, but Chaq now expects ${pgPort}.`);
      console.warn(`[WARN] Stop the old process with: "${pgCtl}" stop -D "${pgData}" -m fast -w`);
      throw new Error(`PostgreSQL is running on the old port ${runningPort}. Stop it before starting Chaq on ${pgPort}.`);
    }

    if (serviceExists(serviceName) && serviceUsesPort(serviceName, pgPort)) {
      console.log(`[Chaq] Starting PostgreSQL Windows service ${serviceName} on 127.0.0.1:${pgPort}`);
      try {
        run("sc.exe", ["start", serviceName]);
      } catch (error) {
        console.warn(`[WARN] Could not start ${serviceName}; falling back to pg_ctl for this session.`);
        console.warn(`[WARN] ${error instanceof Error ? error.message : String(error)}`);
        run(pgCtl, ["-D", pgData, "-l", postgresLog, "-o", `-p ${pgPort} -h 127.0.0.1`, "start", "-w"], {
          env: { PGPASSWORD: pgPassword }
        });
      }
    } else {
      if (serviceExists(serviceName)) {
        console.warn(`[WARN] PostgreSQL service ${serviceName} exists but is not configured for port ${pgPort}.`);
        console.warn(`[WARN] Re-register it later if you want Windows service auto-start on the new port.`);
      }
      console.log(`[Chaq] Starting local PostgreSQL on 127.0.0.1:${pgPort}`);
      run(pgCtl, ["-D", pgData, "-l", postgresLog, "-o", `-p ${pgPort} -h 127.0.0.1`, "start", "-w"], {
        env: { PGPASSWORD: pgPassword }
      });
    }
  } else {
    console.log(`[Chaq] Local PostgreSQL is already ready on 127.0.0.1:${pgPort}`);
  }

  await waitForPort(pgPort, "PostgreSQL");
  const exists = run(psql, ["-h", "127.0.0.1", "-p", String(pgPort), "-U", pgUser, "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname='${pgDatabase.replace(/'/g, "''")}'`], {
    capture: true,
    env: { PGPASSWORD: pgPassword }
  });
  if (exists.trim() !== "1") {
    console.log(`[Chaq] Creating PostgreSQL database ${pgDatabase}`);
    run(createdb, ["-h", "127.0.0.1", "-p", String(pgPort), "-U", pgUser, pgDatabase], {
      env: { PGPASSWORD: pgPassword }
    });
  }
}

async function startRedis(env) {
  const redisPort = Number(env.CHAQ_REDIS_PORT || new URL(env.REDIS_URL).port || 46379);
  if (await canConnect(redisPort)) {
    console.log(`[Chaq] Docker Redis is already reachable on 127.0.0.1:${redisPort}`);
    return;
  }

  console.log(`[Chaq] Starting Redis with Docker Compose on 127.0.0.1:${redisPort}`);
  run("docker", ["compose", "up", "-d", "redis"]);
  await waitForPort(redisPort, "Redis");
}

async function main() {
  const { envFile, values } = readEnv();
  console.log(`[Chaq] Loading local environment from ${envFile}`);
  await startPostgres(values);
  await startRedis(values);
}

main().catch((error) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
