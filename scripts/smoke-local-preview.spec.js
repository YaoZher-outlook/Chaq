const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { smokeLocalPreview } = require("./smoke-local-preview");

test("local preview smoke binds credentials to localhost and logs out the issued session", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chaq-preview-smoke-"));
  const envFile = path.join(directory, "preview.env");
  fs.writeFileSync(envFile, "CHAQ_PREVIEW_USERNAME=preview\nCHAQ_PREVIEW_PASSWORD=PreviewPassword9\n", "utf8");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const calls = [];
  const responses = [
    new Response(JSON.stringify({ sessionToken: "issued-session" }), { status: 200 }),
    new Response(JSON.stringify({ username: "preview", role: "ADMIN" }), { status: 200 }),
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  ];
  const result = await smokeLocalPreview({
    envFile,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    }
  });

  assert.deepEqual(result, { username: "preview", role: "ADMIN" });
  assert.deepEqual(calls.map((call) => call.url), [
    "http://127.0.0.1:24538/api/auth/login",
    "http://127.0.0.1:24538/api/users/me",
    "http://127.0.0.1:24538/api/auth/logout"
  ]);
  assert.equal(JSON.parse(calls[0].init.body).password, "PreviewPassword9");
  assert.equal(calls[1].init.headers["x-session-token"], "issued-session");
  assert.equal(calls[2].init.headers["x-session-token"], "issued-session");
});
