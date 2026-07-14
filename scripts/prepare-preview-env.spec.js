const assert = require("node:assert/strict");
const test = require("node:test");
const { parseEnv, previewValues, serializePreviewEnv } = require("./prepare-preview-env");

test("local preview environment is loopback-only and preserves generated credentials", () => {
  let generated = 0;
  const createSecret = () => `generated-secret-${String(++generated).padStart(40, "x")}`;
  const first = previewValues({}, createSecret);
  const second = previewValues(first, () => { throw new Error("credentials should be preserved"); });

  assert.equal(first.NODE_ENV, "production");
  assert.equal(first.CHAQ_RUNTIME_PROFILE, "local-preview");
  assert.equal(first.CHAQ_MAIL_MODE, "log");
  assert.equal(first.SERVER_HOST, "127.0.0.1");
  assert.match(first.PUBLIC_API_URL, /^http:\/\/127\.0\.0\.1:24538\/api$/);
  assert.equal(first.TRUST_PROXY, "");
  assert.equal(first.PAYMENT_ACCOUNT_NUMBER, "");
  assert.equal(second.MODEL_SECRET_KEY, first.MODEL_SECRET_KEY);
  assert.equal(second.SESSION_HASH_SECRET, first.SESSION_HASH_SECRET);
  assert.equal(second.CHAQ_PREVIEW_PASSWORD, first.CHAQ_PREVIEW_PASSWORD);
});

test("local preview serialization round-trips values containing spaces and equals signs", () => {
  const text = serializePreviewEnv({ SIMPLE: "value", COMPLEX: "one two=three" });
  assert.deepEqual(parseEnv(text), { SIMPLE: "value", COMPLEX: "one two=three" });
});

test("unsafe inherited preview endpoints and mail settings are overwritten", () => {
  const values = previewValues({
    SERVER_HOST: "0.0.0.0",
    PUBLIC_API_URL: "https://remote.example/api",
    SMTP_HOST: "smtp.example.test",
    TRUST_PROXY: "true",
    PAYMENT_ACCOUNT_NUMBER: "unsafe"
  }, () => "a-secure-generated-secret-value-that-is-long-enough");

  assert.equal(values.SERVER_HOST, "127.0.0.1");
  assert.equal(values.PUBLIC_API_URL, "http://127.0.0.1:24538/api");
  assert.equal(values.TRUST_PROXY, "");
  assert.equal(values.PAYMENT_ACCOUNT_NUMBER, "");
  assert.equal("SMTP_HOST" in values, false);
});
