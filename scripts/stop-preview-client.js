const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { projectRoot } = require("./env-paths");

const previewExecutablePath = path.join(
  projectRoot,
  "apps",
  "desktop",
  "release-preview",
  "win-unpacked",
  "Chaq.exe"
);

const queryScript = String.raw`
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$processes = @(
  Get-CimInstance Win32_Process -Filter "Name = 'Chaq.exe'" -ErrorAction Stop |
    Select-Object ProcessId, ExecutablePath
)
ConvertTo-Json -Compress -InputObject @($processes)
`;

const actionScript = String.raw`
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop
$expectedPath = [string]$payload.expectedExecutablePath
foreach ($processIdValue in @($payload.processIds)) {
  $processId = [int]$processIdValue
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
  if ($null -eq $processInfo) { continue }
  if (-not [string]::Equals(
    [string]$processInfo.ExecutablePath,
    $expectedPath,
    [StringComparison]::OrdinalIgnoreCase
  )) { continue }

  try {
    $nativeProcess = Get-Process -Id $processId -ErrorAction Stop
  } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
    continue
  }
  [void]$nativeProcess.CloseMainWindow()
}
`;

function sameWindowsExecutablePath(candidate, expected) {
  return typeof candidate === "string"
    && typeof expected === "string"
    && path.win32.isAbsolute(candidate)
    && path.win32.isAbsolute(expected)
    && candidate.toLowerCase() === expected.toLowerCase();
}

function selectExactPreviewProcesses(records, expectedExecutablePath) {
  if (!Array.isArray(records) || !path.win32.isAbsolute(expectedExecutablePath)) return [];
  const selected = new Map();
  for (const record of records) {
    const processId = Number(record?.ProcessId ?? record?.processId);
    const executablePath = record?.ExecutablePath ?? record?.executablePath;
    if (!Number.isSafeInteger(processId) || processId <= 0) continue;
    if (!sameWindowsExecutablePath(executablePath, expectedExecutablePath)) continue;
    selected.set(processId, { processId, executablePath });
  }
  return [...selected.values()].sort((left, right) => left.processId - right.processId);
}

function runPowerShell(script, input) {
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    encoding: "utf8",
    input,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "unknown PowerShell error").trim();
    throw new Error(`Could not safely inspect or stop the preview client: ${detail}`);
  }
  return String(result.stdout || "").trim();
}

function queryPreviewClientProcesses(expectedExecutablePath) {
  let records;
  const output = runPowerShell(queryScript);
  try {
    records = output ? JSON.parse(output) : null;
  } catch (error) {
    throw new Error(`Could not safely inspect preview client processes: invalid process query output (${error.message}).`);
  }
  if (!Array.isArray(records)) {
    throw new Error("Could not safely inspect preview client processes: the process query did not return an array.");
  }
  for (const record of records) {
    const processId = Number(record?.ProcessId);
    if (!Number.isSafeInteger(processId) || processId <= 0 || typeof record?.ExecutablePath !== "string" || !record.ExecutablePath) {
      throw new Error("Could not safely inspect every Chaq.exe process path; refusing to stop any process.");
    }
  }
  return selectExactPreviewProcesses(records, expectedExecutablePath);
}

function requestGracefulClose(processes, expectedExecutablePath) {
  if (!processes.length) return;
  runPowerShell(actionScript, JSON.stringify({
    expectedExecutablePath,
    processIds: processes.map((processInfo) => processInfo.processId)
  }));
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForPreviewClient(options = {}) {
  const expectedExecutablePath = options.executablePath || previewExecutablePath;
  const waitMs = options.waitMs ?? 5000;
  const pollMs = options.pollMs ?? 250;
  const stableMs = options.stableMs ?? 1000;
  if (process.platform !== "win32") return [];
  if (!path.win32.isAbsolute(expectedExecutablePath)) {
    throw new Error(`Preview executable path must be absolute: ${expectedExecutablePath}`);
  }

  const deadline = Date.now() + waitMs;
  let stableSince = null;
  let stableProcessIds = new Set();
  while (true) {
    const running = queryPreviewClientProcesses(expectedExecutablePath);
    const now = Date.now();
    const runningIds = new Set(running.map(({ processId }) => processId));
    if (!stableProcessIds.size) {
      stableProcessIds = runningIds;
      stableSince = runningIds.size ? now : null;
    } else {
      stableProcessIds = new Set([...stableProcessIds].filter((processId) => runningIds.has(processId)));
      if (!stableProcessIds.size) {
        stableProcessIds = runningIds;
        stableSince = runningIds.size ? now : null;
      }
    }
    if (stableSince !== null && now - stableSince >= stableMs) {
      return running.filter(({ processId }) => stableProcessIds.has(processId));
    }
    if (now >= deadline) return [];
    sleep(Math.min(pollMs, Math.max(deadline - now, 1)));
  }
}

function stopPreviewClient(options = {}) {
  const expectedExecutablePath = options.executablePath || previewExecutablePath;
  const gracePeriodMs = Math.max(options.gracePeriodMs ?? 8000, 8000);

  if (process.platform !== "win32") return { gracefullyRequested: 0 };
  if (!path.win32.isAbsolute(expectedExecutablePath)) {
    throw new Error(`Preview executable path must be absolute: ${expectedExecutablePath}`);
  }

  const initial = queryPreviewClientProcesses(expectedExecutablePath);
  if (!initial.length) return { gracefullyRequested: 0 };

  requestGracefulClose(initial, expectedExecutablePath);
  sleep(gracePeriodMs);

  const remaining = queryPreviewClientProcesses(expectedExecutablePath);
  if (remaining.length) {
    throw new Error(
      `Preview client is still running (PIDs: ${remaining.map(({ processId }) => processId).join(", ")}). `
      + "Save your work, close the preview client manually, and retry. It was not force-terminated to protect local data."
    );
  }
  return { gracefullyRequested: initial.length };
}

if (require.main === module) {
  try {
    if (process.argv.includes("--wait-running")) {
      const running = waitForPreviewClient();
      if (running.length) {
        console.log(`[Chaq] Preview client is running from the expected package (PIDs: ${running.map(({ processId }) => processId).join(", ")}).`);
      } else {
        console.log("[Chaq] No stable preview client process appeared at the expected executable path.");
        process.exitCode = 1;
      }
    } else {
      const result = stopPreviewClient();
      if (result.gracefullyRequested) {
        console.log(`[Chaq] Gracefully closed ${result.gracefullyRequested} matching preview client process(es).`);
      } else {
        console.log("[Chaq] No matching preview client process is running.");
      }
    }
  } catch (error) {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  previewExecutablePath,
  sameWindowsExecutablePath,
  selectExactPreviewProcesses,
  stopPreviewClient,
  waitForPreviewClient
};
