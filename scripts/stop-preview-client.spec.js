const assert = require("node:assert/strict");
const test = require("node:test");
const { sameWindowsExecutablePath, selectExactPreviewProcesses } = require("./stop-preview-client");

const expected = "E:\\Projects\\App\\Chaq\\apps\\desktop\\release-preview\\win-unpacked\\Chaq.exe";

test("preview process selection accepts only the exact absolute executable path", () => {
  const selected = selectExactPreviewProcesses([
    { ProcessId: 14, ExecutablePath: expected },
    { ProcessId: 12, ExecutablePath: expected.toUpperCase() },
    { ProcessId: 13, ExecutablePath: "E:\\Projects\\App\\Chaq\\apps\\desktop\\release\\win-unpacked\\Chaq.exe" },
    { ProcessId: 15, ExecutablePath: `${expected}.old` },
    { ProcessId: 16, ExecutablePath: "Chaq.exe" },
    { ProcessId: 17, ExecutablePath: null },
    { ProcessId: 14, ExecutablePath: expected }
  ], expected);

  assert.deepEqual(selected, [
    { processId: 12, executablePath: expected.toUpperCase() },
    { processId: 14, executablePath: expected }
  ]);
});

test("executable equality is ordinal case-insensitive but does not canonicalize nearby paths", () => {
  assert.equal(sameWindowsExecutablePath(expected.toUpperCase(), expected), true);
  assert.equal(sameWindowsExecutablePath(expected.replace("release-preview", "release-preview\\..\\release-preview"), expected), false);
  assert.equal(sameWindowsExecutablePath(`\\\\?\\${expected}`, expected), false);
  assert.equal(sameWindowsExecutablePath("Chaq.exe", expected), false);
});
