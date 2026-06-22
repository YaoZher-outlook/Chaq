const fs = require("node:fs");
const { serverEnv } = require("./env-paths");

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

const envFile = process.env.CHAQ_ENV_FILE || serverEnv;
if (!fs.existsSync(envFile)) {
  console.error(`Chaq env file not found: ${envFile}`);
  process.exit(1);
}

const entries = parseEnv(fs.readFileSync(envFile, "utf8"));
console.log(`set "CHAQ_ENV_FILE=${envFile}"`);
for (const [key, value] of Object.entries(entries)) {
  console.log(`set "${key}=${value}"`);
}
