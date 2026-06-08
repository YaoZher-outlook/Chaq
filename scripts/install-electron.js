const fs = require("node:fs");
const path = require("node:path");
const { electronCache } = require("./env-paths");

const root = path.resolve(__dirname, "..");

fs.mkdirSync(electronCache, { recursive: true });

process.env.electron_config_cache ||= electronCache;
process.env.ELECTRON_MIRROR ||= "https://npmmirror.com/mirrors/electron/";
process.env.npm_config_electron_mirror ||= process.env.ELECTRON_MIRROR;

require(path.join(root, "node_modules", "electron", "install.js"));
