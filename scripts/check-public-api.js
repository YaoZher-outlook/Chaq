const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");

const defaultApiUrl = "https://chaq.yaozher.com/api";
const apiUrl = normalizeApiUrl(process.argv[2] || process.env.PUBLIC_API_URL || defaultApiUrl);
const localTarget = process.env.CHAQ_CLOUDFLARED_TARGET || "http://127.0.0.1:24538";

function normalizeApiUrl(value) {
  const url = new URL(String(value || defaultApiUrl).trim());
  if (!url.pathname || url.pathname === "/") url.pathname = "/api";
  url.hash = "";
  url.search = "";
  return url;
}

function readyUrl(baseUrl) {
  const url = new URL(baseUrl.toString());
  url.pathname = `${url.pathname.replace(/\/$/, "")}/health/ready`;
  return url;
}

function readJson(url) {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(url, { timeout: 8000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let data = null;
        try {
          data = body ? JSON.parse(body) : null;
        } catch {
          // Keep the raw status/body failure actionable below.
        }
        resolve({ statusCode: response.statusCode, data, body });
      });
    });
    request.once("timeout", () => {
      request.destroy(new Error(`Timed out connecting to ${url}`));
    });
    request.once("error", reject);
  });
}

function printCloudflaredHint() {
  console.error(`[Chaq] Cloudflared hostname: ${apiUrl.hostname}`);
  console.error(`[Chaq] Cloudflared service target: ${localTarget}`);
  console.error("[Chaq] Public API URL should be: https://chaq.yaozher.com/api");
}

async function main() {
  const host = apiUrl.hostname;
  try {
    const address = await dns.lookup(host);
    console.log(`[Chaq] DNS resolves ${host} -> ${address.address}`);
  } catch (error) {
    console.error(`[ERROR] DNS does not resolve ${host}: ${error instanceof Error ? error.message : String(error)}`);
    printCloudflaredHint();
    process.exit(2);
  }

  const url = readyUrl(apiUrl);
  let response;
  try {
    response = await readJson(url);
  } catch (error) {
    console.error(`[ERROR] Public API is not reachable at ${url}: ${error instanceof Error ? error.message : String(error)}`);
    printCloudflaredHint();
    process.exit(3);
  }

  const ready = response.statusCode === 200
    && response.data?.status === "ok"
    && response.data?.database === "ready"
    && response.data?.redis === "ready";
  if (!ready) {
    console.error(`[ERROR] Public API responded but is not ready at ${url} (HTTP ${response.statusCode || "unknown"}).`);
    printCloudflaredHint();
    process.exit(4);
  }

  console.log(`[Chaq] Public API ready on ${apiUrl.toString().replace(/\/$/, "")} (${response.data?.mode || "unknown"}).`);
}

main().catch((error) => {
  console.error(`[ERROR] Could not inspect public Chaq API: ${error instanceof Error ? error.message : String(error)}`);
  printCloudflaredHint();
  process.exit(1);
});
