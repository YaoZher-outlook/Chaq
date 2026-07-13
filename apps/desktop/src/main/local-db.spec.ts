import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SkillDraft } from "@chaq/shared";
import { isDuplicateColumnError, LocalDatabase } from "./local-db";

const codec = {
  encrypt: (value: string) => `encoded:${value}`,
  decrypt: (value: string) => value.replace(/^encoded:/, "")
};

test("schema migration ignores only the expected duplicate-column error", () => {
  assert.equal(isDuplicateColumnError(new Error("duplicate column name: user_id"), "user_id"), true);
  assert.equal(isDuplicateColumnError(new Error("database disk image is malformed"), "user_id"), false);
  assert.equal(isDuplicateColumnError(new Error("duplicate column name: another_column"), "user_id"), false);
});

test("coalesces several synchronous mutations into one durable replacement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chaq-local-db-batch-"));
  const dbPath = join(directory, "chaq.db");
  let database: LocalDatabase | null = null;
  let reopened: LocalDatabase | null = null;

  try {
    database = await LocalDatabase.create(dbPath, codec, { persistDelayMs: 60_000 });
    const baseline = readFileSync(dbPath);

    database.createSkill(draft("one"));
    database.createSkill(draft("two"));
    database.createSkill(draft("three"));

    assert.deepEqual(readFileSync(dbPath), baseline, "mutations should remain batched before flush");
    database.flush();

    assert.notDeepEqual(readFileSync(dbPath), baseline);
    assert.deepEqual(
      readFileSync(`${dbPath}.bak`),
      baseline,
      "one flush should preserve the single pre-batch generation"
    );

    database.close();
    database = null;
    reopened = await LocalDatabase.create(dbPath, codec);
    assert.deepEqual(reopened.listSkills().map((skill) => skill.name).sort(), ["one", "three", "two"]);
  } finally {
    reopened?.close();
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the scheduled flush persists a mutation burst as one generation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chaq-local-db-scheduled-batch-"));
  const dbPath = join(directory, "chaq.db");
  let database: LocalDatabase | null = null;

  try {
    database = await LocalDatabase.create(dbPath, codec, { persistDelayMs: 25 });
    const baseline = readFileSync(dbPath);

    database.createSkill(draft("first scheduled"));
    database.createSkill(draft("second scheduled"));
    database.createSkill(draft("third scheduled"));

    await waitFor(() => !readFileSync(dbPath).equals(baseline));
    assert.deepEqual(readFileSync(`${dbPath}.bak`), baseline);
    assert.equal(database.listSkills().length, 3);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("close synchronously flushes pending mutations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chaq-local-db-close-"));
  const dbPath = join(directory, "chaq.db");
  let database: LocalDatabase | null = null;
  let reopened: LocalDatabase | null = null;

  try {
    database = await LocalDatabase.create(dbPath, codec, { persistDelayMs: 60_000 });
    database.createSkill(draft("survives shutdown"));
    database.close();
    database = null;

    reopened = await LocalDatabase.create(dbPath, codec);
    assert.equal(reopened.listSkills()[0]?.name, "survives shutdown");
  } finally {
    reopened?.close();
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recovers a newer complete temporary database and preserves the old primary as backup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chaq-local-db-temp-recovery-"));
  const dbPath = join(directory, "chaq.db");
  const newerPath = join(directory, "newer.db");
  let original: LocalDatabase | null = null;
  let newer: LocalDatabase | null = null;
  let recovered: LocalDatabase | null = null;

  try {
    original = await LocalDatabase.create(dbPath, codec, { persistDelayMs: 60_000 });
    original.createSkill(draft("old generation"));
    original.close();
    original = null;
    const oldPrimary = readFileSync(dbPath);

    newer = await LocalDatabase.create(newerPath, codec, { persistDelayMs: 60_000 });
    newer.createSkill(draft("old generation"));
    newer.createSkill(draft("new generation"));
    newer.close();
    newer = null;

    copyFileSync(newerPath, `${dbPath}.tmp`);
    const future = new Date(Date.now() + 5_000);
    utimesSync(`${dbPath}.tmp`, future, future);

    recovered = await LocalDatabase.create(dbPath, codec);
    assert.deepEqual(
      recovered.listSkills().map((skill) => skill.name).sort(),
      ["new generation", "old generation"]
    );
    assert.deepEqual(readFileSync(`${dbPath}.bak`), oldPrimary);
    assert.equal(existsSync(`${dbPath}.tmp`), false);
  } finally {
    recovered?.close();
    newer?.close();
    original?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restores the backup when the primary and interrupted temporary file are corrupt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chaq-local-db-backup-recovery-"));
  const dbPath = join(directory, "chaq.db");
  let database: LocalDatabase | null = null;
  let recovered: LocalDatabase | null = null;

  try {
    database = await LocalDatabase.create(dbPath, codec, { persistDelayMs: 60_000 });
    database.createSkill(draft("recover me"));
    database.close();
    database = null;

    copyFileSync(dbPath, `${dbPath}.bak`);
    writeFileSync(dbPath, "truncated primary");
    writeFileSync(`${dbPath}.tmp`, "truncated temporary");

    recovered = await LocalDatabase.create(dbPath, codec);
    assert.equal(recovered.listSkills()[0]?.name, "recover me");
    assert.equal(readFileSync(dbPath).subarray(0, 16).toString("utf8"), "SQLite format 3\0");
    assert.equal(existsSync(`${dbPath}.tmp`), false);
  } finally {
    recovered?.close();
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function draft(name: string): SkillDraft {
  return {
    name,
    avatarUrl: null,
    description: `${name} description`,
    persona: `${name} persona`,
    tone: "calm",
    knowledge: "",
    boundaries: "",
    examples: [],
    tags: []
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the local database to flush.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
