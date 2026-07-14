const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const configuredEnvironmentRoot = process.env.CHAQ_ENV_ROOT?.trim();
const environmentRoot = configuredEnvironmentRoot
  ? path.resolve(configuredEnvironmentRoot)
  : projectRoot;
const chaqEnvironmentRoot = configuredEnvironmentRoot
  ? path.join(environmentRoot, "Chaq")
  : path.join(projectRoot, ".chaq-data");

module.exports = {
  projectRoot,
  environmentRoot,
  chaqEnvironmentRoot,
  electronCache: path.join(chaqEnvironmentRoot, "electron-cache"),
  electronBuilderCache: path.join(chaqEnvironmentRoot, "electron-builder-cache"),
  runtimeCache: path.join(chaqEnvironmentRoot, "runtime-cache-v2"),
  npmCache: path.join(chaqEnvironmentRoot, "npm-cache"),
  dockerConfig: path.join(chaqEnvironmentRoot, "docker-config"),
  userData: path.join(chaqEnvironmentRoot, "user-data"),
  projectLogs: path.join(projectRoot, ".logs"),
  serverEnv: path.join(chaqEnvironmentRoot, "server.env"),
  previewEnv: path.join(chaqEnvironmentRoot, "preview.env"),
  workspaceServerEnv: path.join(projectRoot, "apps", "server", ".env"),
  postgresData: path.join(chaqEnvironmentRoot, "postgres-data"),
  postgresLog: path.join(chaqEnvironmentRoot, "logs", "postgres.log"),
  redisData: path.join(chaqEnvironmentRoot, "redis-data")
};
