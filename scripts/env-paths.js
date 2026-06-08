const path = require("node:path");

const environmentRoot = process.env.CHAQ_ENV_ROOT || "E:\\Environment";
const chaqEnvironmentRoot = path.join(environmentRoot, "Chaq");

module.exports = {
  environmentRoot,
  chaqEnvironmentRoot,
  electronCache: path.join(chaqEnvironmentRoot, "electron-cache"),
  npmCache: path.join(chaqEnvironmentRoot, "npm-cache"),
  userData: path.join(chaqEnvironmentRoot, "user-data")
};
