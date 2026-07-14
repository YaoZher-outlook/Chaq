const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const {
  containerBelongsToCompose,
  dockerPortsExposeAllInterfaces,
  postgresBinIsComplete,
  reconcilePostmasterPid,
  redisDockerBindingIsLoopback,
  redisPing,
  resolvePostgresBin
} = require("./start-local-infra");

const tools = ["initdb", "pg_ctl", "pg_isready", "psql", "createdb"];

function fakeExistsFor(directory, missing = null) {
  const files = new Set(tools.filter((tool) => tool !== missing).map((tool) => path.join(directory, `${tool}.exe`).toLowerCase()));
  return (candidate) => files.has(String(candidate).toLowerCase());
}

test("PostgreSQL resolver prefers a complete explicit project tool directory", () => {
  const explicit = "X:\\workspace\\Chaq\\.chaq-data\\postgresql\\bin";
  assert.equal(postgresBinIsComplete(explicit, "win32", fakeExistsFor(explicit)), true);
  assert.equal(resolvePostgresBin({ CHAQ_PG_BIN: explicit }, {
    platform: "win32",
    exists: fakeExistsFor(explicit),
    environment: { Path: "Y:\\pgsql\\bin" },
    projectBin: "Z:\\fallback"
  }), explicit);
});

test("PostgreSQL resolver falls back to PATH only when the complete toolset exists", () => {
  const incomplete = "X:\\incomplete";
  const pathBin = "E:\\Environment\\pgsql\\bin";
  const exists = (candidate) => fakeExistsFor(pathBin)(candidate) || fakeExistsFor(incomplete, "createdb")(candidate);
  assert.equal(resolvePostgresBin({ CHAQ_PG_BIN: incomplete }, {
    platform: "win32",
    exists,
    environment: { Path: `${incomplete};${pathBin}` },
    projectBin: "X:\\missing-project-bin"
  }), pathBin);
});

test("PostgreSQL resolver reports an actionable error for missing tools", () => {
  assert.throws(() => resolvePostgresBin({}, {
    platform: "win32",
    exists: () => false,
    environment: { Path: "X:\\missing" },
    projectBin: "X:\\project-bin"
  }), /PostgreSQL tools.*add it to PATH/);
});

function createPostmasterFixture(pid = 12345, port = 45432) {
  const fixturesRoot = path.join(process.cwd(), ".chaq-data", "test-start-local-infra");
  fs.mkdirSync(fixturesRoot, { recursive: true });
  const pgData = fs.mkdtempSync(path.join(fixturesRoot, "postgres-"));
  fs.writeFileSync(
    path.join(pgData, "postmaster.pid"),
    `${pid}\n${pgData}\n1710000000\n${port}\n127.0.0.1\n`,
    "utf8"
  );
  return pgData;
}

test("stale PostgreSQL ownership file is removed only after pg_ctl and PID checks", (context) => {
  const pgData = createPostmasterFixture();
  context.after(() => fs.rmSync(pgData, { force: true, recursive: true }));

  const result = reconcilePostmasterPid(pgData, "pg_ctl", {
    postgresDataDirectoryIsRunning: () => false,
    processIsAlive: () => false
  });

  assert.equal(result.staleRemoved, true);
  assert.equal(fs.existsSync(path.join(pgData, "postmaster.pid")), false);
});

test("live PID prevents removal when pg_ctl cannot identify the PostgreSQL process", (context) => {
  const pgData = createPostmasterFixture(23456);
  const pidFile = path.join(pgData, "postmaster.pid");
  context.after(() => fs.rmSync(pgData, { force: true, recursive: true }));

  assert.throws(() => reconcilePostmasterPid(pgData, "pg_ctl", {
    postgresDataDirectoryIsRunning: () => false,
    processIsAlive: () => true
  }), /references live PID 23456.*Refusing to remove/);
  assert.equal(fs.existsSync(pidFile), true);
});

test("pg_ctl-confirmed PostgreSQL process preserves its ownership file", (context) => {
  const pgData = createPostmasterFixture(34567, 45433);
  const pidFile = path.join(pgData, "postmaster.pid");
  context.after(() => fs.rmSync(pgData, { force: true, recursive: true }));

  const result = reconcilePostmasterPid(pgData, "pg_ctl", {
    postgresDataDirectoryIsRunning: () => true,
    processIsAlive: () => {
      throw new Error("PID check must not run for a pg_ctl-confirmed process");
    }
  });

  assert.equal(result.running, true);
  assert.equal(result.port, 45433);
  assert.equal(fs.existsSync(pidFile), true);
});

async function withTcpServer(onConnection, callback) {
  const server = net.createServer(onConnection);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    await callback(address.port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Redis readiness sends RESP PING and requires a PONG response", async () => {
  let request = "";
  await withTcpServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      request += chunk;
      socket.end("+PONG\r\n");
    });
  }, async (port) => {
    assert.equal(await redisPing(port), true);
  });
  assert.equal(request, "*1\r\n$4\r\nPING\r\n");
});

test("an arbitrary TCP listener is not accepted as Redis", async () => {
  await withTcpServer((socket) => {
    socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"));
  }, async (port) => {
    assert.equal(await redisPing(port), false);
  });
});

test("local preview accepts only loopback Docker Redis port mappings", () => {
  assert.equal(redisDockerBindingIsLoopback({
    "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: "46379" }]
  }, 46379), true);
  assert.equal(redisDockerBindingIsLoopback(JSON.stringify({
    "6379/tcp": [{ HostIp: "0.0.0.0", HostPort: "46379" }]
  }), 46379), false);
  assert.equal(redisDockerBindingIsLoopback({
    "6379/tcp": [
      { HostIp: "127.0.0.1", HostPort: "46379" },
      { HostIp: "::", HostPort: "46379" }
    ]
  }, 46379), false);
  assert.equal(redisDockerBindingIsLoopback({}, 46379), false);
});

test("legacy Redis migration accepts only the exact local Compose project", () => {
  const composeFile = path.resolve("E:\\workspace\\Chaq\\docker-compose.yml");
  const metadata = {
    Config: {
      Labels: {
        "com.docker.compose.project": "chaq",
        "com.docker.compose.service": "redis",
        "com.docker.compose.project.config_files": composeFile
      }
    }
  };
  assert.equal(containerBelongsToCompose(metadata, "chaq", "redis", composeFile), true);
  assert.equal(containerBelongsToCompose(metadata, "chaq-preview", "redis", composeFile), false);
  assert.equal(containerBelongsToCompose(metadata, "chaq", "redis", path.resolve("other-compose.yml")), false);
});

test("legacy container exposure detection identifies wildcard host bindings", () => {
  assert.equal(dockerPortsExposeAllInterfaces({
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5432" }] } }
  }), true);
  assert.equal(dockerPortsExposeAllInterfaces({
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "::", HostPort: "5432" }] } }
  }), true);
  assert.equal(dockerPortsExposeAllInterfaces({
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }] } }
  }), false);
});
