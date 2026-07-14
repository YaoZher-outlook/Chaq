const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { postgresBinIsComplete, resolvePostgresBin } = require("./start-local-infra");

const tools = ["initdb", "pg_ctl", "pg_isready", "psql", "createdb"];

function fakeExistsFor(directory, missing = null) {
  const files = new Set(tools.filter((tool) => tool !== missing).map((tool) => path.join(directory, `${tool}.exe`).toLowerCase()));
  return (candidate) => files.has(String(candidate).toLowerCase());
}

test("PostgreSQL resolver prefers a complete explicit project tool directory", () => {
  const explicit = "X:\\workspace\\Chaq\\.chaq-data\\postgresql\\bin";
  assert.equal(postgresBinIsComplete(explicit, "win32", fakeExistsFor(explicit)), true);
  assert.equal(resolvePostgresBin({ CHAQ_PG_BIN: explicit }, {
    platform: "win32",
    exists: fakeExistsFor(explicit),
    environment: { Path: "Y:\\pgsql\\bin" },
    projectBin: "Z:\\fallback"
  }), explicit);
});

test("PostgreSQL resolver falls back to PATH only when the complete toolset exists", () => {
  const incomplete = "X:\\incomplete";
  const pathBin = "E:\\Environment\\pgsql\\bin";
  const exists = (candidate) => fakeExistsFor(pathBin)(candidate) || fakeExistsFor(incomplete, "createdb")(candidate);
  assert.equal(resolvePostgresBin({ CHAQ_PG_BIN: incomplete }, {
    platform: "win32",
    exists,
    environment: { Path: `${incomplete};${pathBin}` },
    projectBin: "X:\\missing-project-bin"
  }), pathBin);
});

test("PostgreSQL resolver reports an actionable error for missing tools", () => {
  assert.throws(() => resolvePostgresBin({}, {
    platform: "win32",
    exists: () => false,
    environment: { Path: "X:\\missing" },
    projectBin: "X:\\project-bin"
  }), /PostgreSQL tools.*add it to PATH/);
});
