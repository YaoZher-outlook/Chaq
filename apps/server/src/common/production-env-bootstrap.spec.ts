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
