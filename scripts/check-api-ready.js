const http = require("node:http");

const ports = process.argv
  .slice(2)
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 0);

const targets = ports.length ? ports : [24538, 24537];

function readReady(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/health/ready", timeout: 1500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve({
            port,
            ready: response.statusCode === 200 && data.status === "ok" && data.database === "ready" && data.redis === "ready",
            data
          });
        } catch {
          resolve({ port, ready: false, data: null });
        }
      });
    });
    request.once("timeout", () => {
      request.destroy();
      resolve({ port, ready: false, data: null });
    });
    request.once("error", () => resolve({ port, ready: false, data: null }));
  });
}

async function main() {
  for (const port of targets) {
    const status = await readReady(port);
    if (status.ready) {
      console.log(`[Chaq] API ready on http://127.0.0.1:${port}/api (${status.data?.mode || "unknown"}).`);
      process.exit(0);
    }
  }
  console.error(`[Chaq] No ready Chaq API found on ports: ${targets.join(", ")}.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`[ERROR] Could not inspect Chaq API: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
