import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionEnvironmentOnBootstrap } from "./production-env-bootstrap";

test("non-production bootstrap does not require production-only configuration", () => {
  assert.doesNotThrow(() => assertProductionEnvironmentOnBootstrap("test API", { NODE_ENV: "development" }));
});

test("production bootstrap fails closed through the shared validator", () => {
  assert.throws(
    () => assertProductionEnvironmentOnBootstrap("test worker", { NODE_ENV: "production" }),
    /Refusing to start test worker: Production environment validation failed/
  );
});

test("production bootstrap accepts only a constrained local preview profile", () => {
  const { previewValues } = require("../../../../scripts/prepare-preview-env") as {
    previewValues: (existing?: Record<string, string>) => NodeJS.ProcessEnv;
  };
  const warnings: string[] = [];
  const env = previewValues();
  assert.doesNotThrow(() => assertProductionEnvironmentOnBootstrap("test preview API", env, (warning) => warnings.push(warning)));
  assert.ok(warnings.some((warning) => warning.includes("project API log")));

  assert.throws(
    () => assertProductionEnvironmentOnBootstrap("test preview API", { ...env, SERVER_HOST: "0.0.0.0" }),
    /SERVER_HOST must be a loopback host/
  );
});
