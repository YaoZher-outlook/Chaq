const http = require("node:http");
const net = require("node:net");

const host = process.env.SERVER_HOST || "127.0.0.1";
const port = Number(process.env.SERVER_PORT || 24537);

function portIsReachable() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
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

function readHealth() {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: "/api/health/ready", timeout: 1_500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve(response.statusCode === 200
            && data.status === "ok"
            && data.database === "ready"
            && data.redis === "ready");
        } catch {
          resolve(false);
        }
      });
    });
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => resolve(false));
  });
}

async function main() {
  if (!(await portIsReachable())) process.exit(1);
  if (await readHealth()) {
    console.log(`[Chaq] API is already ready on http://${host}:${port}/api.`);
    process.exit(0);
  }
  console.error(`[ERROR] Port ${port} is occupied, but it is not a ready Chaq API.`);
  process.exit(2);
}

main().catch((error) => {
  console.error(`[ERROR] Could not inspect Chaq API: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
