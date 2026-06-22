const net = require("node:net");

const [, , label = "service", rawPort] = process.argv;
const port = Number(rawPort);
const runningOnly = process.argv.includes("--running");

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid port for ${label}: ${rawPort}`);
  process.exit(1);
}

const reservedByUserProjects = new Set([4100, 4010, 8200, 8020]);

if (reservedByUserProjects.has(port)) {
  console.error(`Port ${port} is reserved for your existing web projects. Pick another port before starting ${label}.`);
  process.exit(1);
}

function canConnect(host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(650);
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

function canListen(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function main() {
  for (const host of ["127.0.0.1", "::1"]) {
    if (await canConnect(host)) {
      if (runningOnly) process.exit(0);
      console.error(`Port ${port} is already reachable on ${host}; ${label} will not start another copy.`);
      process.exit(1);
    }
  }

  if (runningOnly) process.exit(1);

  try {
    await canListen("127.0.0.1");
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use; ${label} will not start on this port.`);
    } else {
      console.error(`Could not check port ${port} for ${label}: ${error.message}`);
    }
    process.exit(1);
  }

  console.log(`Port ${port} is available for ${label}.`);
}

main().catch((error) => {
  console.error(`Could not check port ${port} for ${label}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
