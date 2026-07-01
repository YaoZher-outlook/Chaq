const { spawnSync } = require("node:child_process");

const testFiles = [
  "packages/shared/src/agent-contract.spec.ts",
  "apps/server/src/modules/conversations/conversation-mappers.spec.ts",
  "apps/server/src/modules/conversations/conversations.service.spec.ts",
  "apps/server/src/modules/agent-runtime/agent-runtime.spec.ts",
  "apps/server/src/modules/agents/agent-mappers.spec.ts",
  "apps/server/src/modules/agents/agents.service.spec.ts",
  "apps/server/src/modules/models/models.service.spec.ts",
  "apps/server/src/modules/users/users.service.spec.ts",
  "apps/desktop/src/renderer/lib/provider-presets.spec.ts"
];

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  stdio: "inherit",
  env: {
    ...process.env,
    TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH || "tsconfig.json"
  }
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
