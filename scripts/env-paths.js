const path = require("node:path");

const environmentRoot = process.env.CHAQ_ENV_ROOT || "E:\\Environment";
const chaqEnvironmentRoot = path.join(environmentRoot, "Chaq");
const projectRoot = path.resolve(__dirname, "..");

module.exports = {
  projectRoot,
  environmentRoot,
  chaqEnvironmentRoot,
  electronCache: path.join(chaqEnvironmentRoot, "electron-cache"),
  runtimeCache: path.join(chaqEnvironmentRoot, "runtime-cache-v2"),
  npmCache: path.join(chaqEnvironmentRoot, "npm-cache"),
  userData: path.join(chaqEnvironmentRoot, "user-data"),
  serverEnv: path.join(chaqEnvironmentRoot, "server.env"),
  postgresData: path.join(chaqEnvironmentRoot, "postgres-data"),
  postgresLog: path.join(chaqEnvironmentRoot, "logs", "postgres.log")
};
