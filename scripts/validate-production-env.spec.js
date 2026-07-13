const test = require("node:test");
const assert = require("node:assert/strict");
const { assertProductionEnv, parseEnv, validateProductionEnv } = require("./validate-production-env");

function validEnvironment() {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://chaq:a-long-random-db-password@postgres:5432/chaq?schema=public",
    REDIS_URL: "redis://redis:6379",
    SERVER_HOST: "0.0.0.0",
    SERVER_PORT: "24537",
    CLIENT_ORIGIN: "https://chaq.test",
    PUBLIC_API_URL: "https://api.chaq.test/api",
    MODEL_SECRET_KEY: "model-secret-that-is-longer-than-thirty-two-characters",
    SESSION_HASH_SECRET: "session-secret-that-is-different-and-long-enough",
    TRUST_PROXY: "1",
    AGENT_WORKER_CONCURRENCY: "4",
    MODEL_REQUEST_TIMEOUT_MS: "60000",
    SMTP_HOST: "smtp.chaq.test",
    SMTP_PORT: "465",
    SMTP_USER: "chaq",
    SMTP_PASS: "a-long-random-smtp-password",
    SMTP_FROM: "no-reply@chaq.test",
    SMTP_SECURE: "1",
    SMTP_STARTTLS: "0"
  };
}

test("production environment accepts separated secrets and secure endpoints", () => {
  assert.deepEqual(validateProductionEnv(validEnvironment()), { errors: [], warnings: [] });
  assert.deepEqual(assertProductionEnv(validEnvironment()), { errors: [], warnings: [] });
});

test("production environment rejects an enabled demo seed gate", () => {
  const env = validEnvironment();
  env.CHAQ_ALLOW_DEMO_SEED = "1";
  assert.throws(() => assertProductionEnv(env), /CHAQ_ALLOW_DEMO_SEED must not be enabled/);
});

test("production environment rejects template and shared secrets", () => {
  const env = validEnvironment();
  env.MODEL_SECRET_KEY = "replace-with-at-least-32-random-characters";
  env.SESSION_HASH_SECRET = env.MODEL_SECRET_KEY;
  const result = validateProductionEnv(env);
  assert.ok(result.errors.some((error) => error.includes("MODEL_SECRET_KEY still contains")));
  assert.ok(result.errors.some((error) => error.includes("must be different")));
});

test("production environment requires encrypted SMTP", () => {
  const env = validEnvironment();
  env.SMTP_SECURE = "0";
  env.SMTP_STARTTLS = "0";
  const result = validateProductionEnv(env);
  assert.ok(result.errors.some((error) => error.includes("SMTP must use")));
});

test("production environment rejects CORS origins with paths", () => {
  const env = validEnvironment();
  env.CLIENT_ORIGIN = "https://chaq.test/app";
  const result = validateProductionEnv(env);
  assert.ok(result.errors.some((error) => error.includes("CLIENT_ORIGIN entries")));
});

test("production environment rejects unsafe proxy trust", () => {
  const trustAll = validEnvironment();
  trustAll.TRUST_PROXY = "true";
  assert.ok(validateProductionEnv(trustAll).errors.some((error) => error.includes("TRUST_PROXY=true")));

  const invalidHopCount = validEnvironment();
  invalidHopCount.TRUST_PROXY = "0";
  assert.ok(validateProductionEnv(invalidHopCount).errors.some((error) => error.includes("hop count")));
});

test("production environment accepts fractional payment pricing and rejects invalid ports", () => {
  const env = validEnvironment();
  Object.assign(env, {
    PAYMENT_ACCOUNT_NUMBER: "6222000000000000",
    PAYMENT_BANK_NAME: "Test bank",
    PAYMENT_ACCOUNT_NAME: "Chaq",
    PAYMENT_CNY_PER_M_TOKEN: "0.5",
    PAYMENT_MIN_M_TOKEN: "0.5",
    PAYMENT_MAX_M_TOKEN: "500",
    PAYMENT_ORDER_EXPIRES_MINUTES: "1440"
  });
  assert.deepEqual(validateProductionEnv(env), { errors: [], warnings: [] });

  env.SMTP_PORT = "70000";
  assert.ok(validateProductionEnv(env).errors.some((error) => error.includes("SMTP_PORT must not exceed")));
});

test("env parser preserves values containing equals signs", () => {
  assert.deepEqual(parseEnv("A=one=two\nB=\"three four\"\n# comment\n"), { A: "one=two", B: "three four" });
});
