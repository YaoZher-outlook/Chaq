const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertLocalPreviewEnv,
  assertProductionEnv,
  parseEnv,
  validateLocalPreviewEnv,
  validateProductionEnv
} = require("./validate-production-env");

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

function validPreviewEnvironment() {
  const env = validEnvironment();
  Object.assign(env, {
    CHAQ_RUNTIME_PROFILE: "local-preview",
    CHAQ_MAIL_MODE: "log",
    DATABASE_URL: "postgresql://chaq:chaq@127.0.0.1:45432/chaq?schema=public",
    REDIS_URL: "redis://127.0.0.1:46379",
    SERVER_HOST: "127.0.0.1",
    SERVER_PORT: "24538",
    CLIENT_ORIGIN: "http://127.0.0.1:27337",
    PUBLIC_API_URL: "http://127.0.0.1:24538/api",
    TRUST_PROXY: "",
    PAYMENT_ACCOUNT_NUMBER: ""
  });
  delete env.SMTP_HOST;
  delete env.SMTP_PORT;
  delete env.SMTP_USER;
  delete env.SMTP_PASS;
  delete env.SMTP_FROM;
  delete env.SMTP_SECURE;
  delete env.SMTP_STARTTLS;
  return env;
}

test("production environment accepts separated secrets and secure endpoints", () => {
  assert.deepEqual(validateProductionEnv(validEnvironment()), { errors: [], warnings: [] });
  assert.deepEqual(assertProductionEnv(validEnvironment()), { errors: [], warnings: [] });
});

test("local preview accepts log mail only when every service is loopback-only", () => {
  const env = validPreviewEnvironment();
  const result = validateLocalPreviewEnv(env);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes("project API log")));
  assert.doesNotThrow(() => assertLocalPreviewEnv(env));
});

test("formal production never accepts the local preview mail escape hatch", () => {
  const result = validateProductionEnv(validPreviewEnvironment());
  assert.ok(result.errors.some((error) => error.includes("CHAQ_RUNTIME_PROFILE")));
  assert.ok(result.errors.some((error) => error.includes("CHAQ_MAIL_MODE")));
  assert.ok(result.errors.some((error) => error.includes("SMTP_HOST is required")));
});

test("formal production rejects unknown runtime profiles", () => {
  const env = validEnvironment();
  env.CHAQ_RUNTIME_PROFILE = "mystery";
  assert.ok(validateProductionEnv(env).errors.some((error) => error.includes("empty or standard")));
});

test("local preview rejects remote exposure, proxy trust, payment and SMTP inheritance", () => {
  const cases = [
    ["SERVER_HOST", "0.0.0.0", "SERVER_HOST"],
    ["DATABASE_URL", "postgresql://chaq:password@db.example.test:5432/chaq", "DATABASE_URL"],
    ["REDIS_URL", "redis://redis.example.test:6379", "REDIS_URL"],
    ["PUBLIC_API_URL", "https://api.example.test/api", "PUBLIC_API_URL"],
    ["CLIENT_ORIGIN", "https://client.example.test", "CLIENT_ORIGIN"],
    ["TRUST_PROXY", "1", "TRUST_PROXY"],
    ["PAYMENT_ACCOUNT_NUMBER", "6222000000000000", "Payments"],
    ["SMTP_HOST", "smtp.example.test", "SMTP_HOST"]
  ];
  for (const [key, value, expected] of cases) {
    const env = validPreviewEnvironment();
    env[key] = value;
    const result = validateLocalPreviewEnv(env);
    assert.ok(result.errors.some((error) => error.includes(expected)), `${key} should be rejected: ${result.errors.join(" | ")}`);
  }
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
