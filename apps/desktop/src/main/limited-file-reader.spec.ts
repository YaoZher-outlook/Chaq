import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFileWithLimit } from "./limited-file-reader";

test("reads an ordinary file that is within the configured limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "chaq-file-limit-"));
  const filePath = join(root, "small.txt");
  try {
    writeFileSync(filePath, "hello", "utf8");
    assert.equal((await readFileWithLimit(filePath, 5, "导入文件")).toString("utf8"), "hello");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an oversized file before returning its contents", async () => {
  const root = mkdtempSync(join(tmpdir(), "chaq-file-limit-"));
  const filePath = join(root, "large.txt");
  try {
    writeFileSync(filePath, "123456", "utf8");
    await assert.rejects(readFileWithLimit(filePath, 5, "导入文件"), /不超过 5 字节/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a directory instead of attempting to read it", async () => {
  const root = mkdtempSync(join(tmpdir(), "chaq-file-limit-"));
  try {
    await assert.rejects(readFileWithLimit(root, 1024, "导入文件"), /普通文件/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
