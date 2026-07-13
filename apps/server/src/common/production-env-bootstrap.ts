import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

type ProductionValidationResult = {
  errors: string[];
  warnings: string[];
};

type ProductionEnvironmentValidator = {
  assertProductionEnv: (env: NodeJS.ProcessEnv) => ProductionValidationResult;
};

function findValidatorPath(startDirectory = __dirname): string {
  let directory = startDirectory;
  while (true) {
    const candidate = join(directory, "scripts", "validate-production-env.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("Production environment validator is missing; refusing to start in production mode.");
}

export function assertProductionEnvironmentOnBootstrap(
  processName: string,
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn
): void {
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() !== "production") return;

  const validatorPath = findValidatorPath();
  const validator = require(validatorPath) as ProductionEnvironmentValidator;
  try {
    const result = validator.assertProductionEnv(env);
    for (const warning of result.warnings) warn(`[env:warn] ${warning}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Refusing to start ${processName}: ${detail}`, { cause: error });
  }
}
