const net = require("node:net");

const [, , label = "service", rawPort] = process.argv;
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid port for ${label}: ${rawPort}`);
  process.exit(1);
}

const reservedByUserProjects = new Set([4100, 4010, 8200, 8020]);

if (reservedByUserProjects.has(port)) {
  console.error(`Port ${port} is reserved for your existing web projects. Pick another port before starting ${label}.`);
  process.exit(1);
}

const server = net.createServer();

server.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use; ${label} will not start on this port.`);
  } else {
    console.error(`Could not check port ${port} for ${label}: ${error.message}`);
  }
  process.exit(1);
});

server.once("listening", () => {
  server.close(() => {
    console.log(`Port ${port} is available for ${label}.`);
  });
});

server.listen(port, "127.0.0.1");
