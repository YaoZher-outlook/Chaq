import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createStorageLayout,
  probeWritableDirectory,
  selectWritableStorageRoot,
  storageRootCandidates
} from "./storage-paths";

test("storage roots prefer an explicit environment root, then a relative app root, then Desktop", () => {
  const projectRoot = resolve("workspace-project");
  const desktopPath = resolve("desktop-fallback");
  const environmentRoot = resolve("external-environment");
  assert.deepEqual(storageRootCandidates({
    isPackaged: false,
    executablePath: resolve("bin", "Chaq.exe"),
    moduleDir: resolve(projectRoot, "apps", "desktop", "out", "main"),
    desktopPath,
    environmentRoot,
    projectRoot
  }), [
    join(environmentRoot, "Chaq"),
    join(projectRoot, ".chaq-data"),
    join(desktopPath, "Chaq")
  ]);
});

test("packaged storage defaults beside the executable", () => {
  const executablePath = resolve("portable", "Chaq.exe");
  const candidates = storageRootCandidates({
    isPackaged: true,
    executablePath,
    moduleDir: resolve("ignored"),
    desktopPath: resolve("desktop")
  });
  assert.equal(candidates[0], join(resolve("portable"), ".chaq-data"));
});

test("storage selection uses the first writable candidate and creates a coherent layout", () => {
  const selected = selectWritableStorageRoot(["first", "second", "third"], (candidate) => candidate === "second");
  assert.equal(selected, "second");
  assert.equal(selectWritableStorageRoot(["first"], () => false), null);
  const layout = createStorageLayout(resolve("chaq-root"));
  assert.equal(layout.userData, join(layout.root, "user-data"));
  assert.equal(layout.diskCache, join(layout.runtimeCache, "chromium"));
  assert.equal(layout.sessionData, join(layout.runtimeCache, "session-data"));
});

test("writability probing cleans up its temporary file", () => {
  const root = mkdtempSync(join(tmpdir(), "chaq-storage-paths-"));
  const candidate = join(root, "nested");
  try {
    assert.equal(probeWritableDirectory(candidate), true);
    assert.deepEqual(readdirSync(candidate), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
