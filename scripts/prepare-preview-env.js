const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const {
  chaqEnvironmentRoot,
  dockerConfig,
  postgresData,
  previewEnv,
  projectLogs,
  redisData
} = require("./env-paths");

function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function previewValues(existing = {}, createSecret = () => randomBytes(48).toString("base64url")) {
  return {
    NODE_ENV: "production",
    CHAQ_RUNTIME_PROFILE: "local-preview",
    CHAQ_MAIL_MODE: "log",
    DATABASE_URL: "postgresql://chaq:chaq@127.0.0.1:45432/chaq?schema=public",
    REDIS_URL: "redis://127.0.0.1:46379",
    SERVER_PORT: "24538",
    SERVER_HOST: "127.0.0.1",
    CLIENT_ORIGIN: "http://127.0.0.1:27337",
    PUBLIC_API_URL: "http://127.0.0.1:24538/api",
    TRUST_PROXY: "",
    CHAQ_ALLOW_DEMO_SEED: "0",
    AGENT_WORKER_CONCURRENCY: "4",
    MODEL_REQUEST_TIMEOUT_MS: "60000",
    CHAQ_LOG_DIR: projectLogs,
    CHAQ_PG_DATA_DIR: postgresData,
    CHAQ_PG_USER: "chaq",
    CHAQ_PG_PASSWORD: "chaq",
    CHAQ_PG_DATABASE: "chaq",
    CHAQ_PG_PORT: "45432",
    CHAQ_PG_SERVICE_NAME: "ChaqPostgreSQL",
    CHAQ_REDIS_PORT: "46379",
    CHAQ_REDIS_DATA_DIR: redisData,
    DOCKER_CONFIG: dockerConfig,
    PAYMENT_ACCOUNT_NUMBER: "",
    MODEL_SECRET_KEY: validSecret(existing.MODEL_SECRET_KEY) ? existing.MODEL_SECRET_KEY : createSecret(),
    SESSION_HASH_SECRET: validSecret(existing.SESSION_HASH_SECRET) ? existing.SESSION_HASH_SECRET : createSecret(),
    CHAQ_PREVIEW_USERNAME: validUsername(existing.CHAQ_PREVIEW_USERNAME) ? existing.CHAQ_PREVIEW_USERNAME : "preview",
    CHAQ_PREVIEW_PASSWORD: validPreviewPassword(existing.CHAQ_PREVIEW_PASSWORD)
      ? existing.CHAQ_PREVIEW_PASSWORD
      : `Chaq-${createSecret().slice(0, 18)}9`,
    CHAQ_PREVIEW_DISPLAY_NAME: String(existing.CHAQ_PREVIEW_DISPLAY_NAME || "Chaq Preview").trim() || "Chaq Preview",
    CHAQ_PREVIEW_TOKEN_BALANCE: validBalance(existing.CHAQ_PREVIEW_TOKEN_BALANCE)
      ? String(existing.CHAQ_PREVIEW_TOKEN_BALANCE)
      : "1000000"
  };
}

function validSecret(value) {
  return typeof value === "string" && value.trim().length >= 32;
}

function validUsername(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{2,32}$/.test(value.trim());
}

function validPreviewPassword(value) {
  return typeof value === "string" && /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(value);
}

function validBalance(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
}

function formatEnvValue(value) {
  const text = String(value);
  return /[\s#"']/u.test(text) ? JSON.stringify(text) : text;
}

function serializePreviewEnv(values) {
  return [
    "# Chaq local production preview environment (generated; project-local only)",
    ...Object.entries(values).map(([key, value]) => `${key}=${formatEnvValue(value)}`),
    ""
  ].join("\r\n");
}

function writePreviewEnvironment(filePath = previewEnv) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  for (const directory of [chaqEnvironmentRoot, dockerConfig, postgresData, projectLogs, redisData]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const existing = fs.existsSync(filePath) ? parseEnv(fs.readFileSync(filePath, "utf8")) : {};
  const values = previewValues(existing);
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, serializePreviewEnv(values), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
  return { filePath, values };
}

function main() {
  const result = writePreviewEnvironment();
  console.log(`[Chaq] Local preview environment: ${result.filePath}`);
  if (process.argv.includes("--show-login")) {
    console.log(`[Chaq] Preview login: ${result.values.CHAQ_PREVIEW_USERNAME} / ${result.values.CHAQ_PREVIEW_PASSWORD}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[ERROR] Could not prepare local preview environment: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { parseEnv, previewValues, serializePreviewEnv, writePreviewEnvironment };
