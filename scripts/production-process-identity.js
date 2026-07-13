const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function parsePidRecord(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const pid = Number(value);
    return Number.isInteger(pid) && pid > 0 ? { version: 0, pid } : null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || parsed.version !== 1 || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function productionEntry(projectRoot, role, platform = process.platform) {
  const filename = role === "api" ? "main.js" : role === "worker" ? "worker.js" : null;
  if (!filename) throw new Error(`Unknown production process role: ${role}`);
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.join(projectRoot, "apps", "server", "dist", "src", filename);
}

function normalizeIdentityPath(value, platform = process.platform) {
  let text = String(value || "").trim();
  if (platform === "win32") {
    text = text.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase();
  }
  return text.replace(/[\\/]$/, "");
}

function splitProcessCommandLine(commandLine) {
  const args = [];
  const matcher = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = matcher.exec(String(commandLine || ""))) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

function isExpectedProjectProcess(identity, options) {
  const platform = options.platform || process.platform;
  const expectedEntry = options.expectedEntry
    || productionEntry(options.projectRoot, options.role, platform);
  if (!identity || !Number.isInteger(identity.pid) || identity.pid <= 0) return false;
  if (typeof identity.commandLine !== "string" || !identity.commandLine.trim()) return false;
  const argv = Array.isArray(identity.argv) && identity.argv.length
    ? identity.argv.map(String)
    : splitProcessCommandLine(identity.commandLine);
  if (argv.length < 2) return false;
  if (normalizeIdentityPath(argv[1], platform) !== normalizeIdentityPath(expectedEntry, platform)) return false;

  const expectedExecutable = options.executablePath || process.execPath;
  const actualExecutable = identity.executable || argv[0];
  return normalizeIdentityPath(actualExecutable, platform) === normalizeIdentityPath(expectedExecutable, platform);
}

function assessManagedProcess(record, identity, options) {
  const platform = options.platform || process.platform;
  const expectedEntry = options.expectedEntry
    || productionEntry(options.projectRoot, options.role, platform);
  if (!record || record.version !== 1) return { safe: false, reason: "legacy or invalid pid record" };
  if (record.role !== options.role) return { safe: false, reason: "pid role does not match" };
  if (normalizeIdentityPath(record.projectRoot, platform) !== normalizeIdentityPath(options.projectRoot, platform)) {
    return { safe: false, reason: "pid project root does not match" };
  }
  if (normalizeIdentityPath(record.entry, platform) !== normalizeIdentityPath(expectedEntry, platform)) {
    return { safe: false, reason: "pid entry does not match" };
  }
  if (!identity) return { safe: false, reason: "process does not exist or cannot be inspected" };
  if (identity.pid !== record.pid) return { safe: false, reason: "process pid does not match" };
  if (typeof identity.commandLine !== "string" || !identity.commandLine.trim()) {
    return { safe: false, reason: "process command line is unavailable" };
  }
  if (!record.startIdentity || !identity.startIdentity || record.startIdentity !== identity.startIdentity) {
    return { safe: false, reason: "process start identity does not match" };
  }
  if (!isExpectedProjectProcess(identity, {
    ...options,
    expectedEntry,
    executablePath: record.executable || options.executablePath
  })) {
    return { safe: false, reason: "process command does not match this project and role" };
  }
  return { safe: true, reason: "managed process identity matches" };
}

function windowsIdentityFromRow(row) {
  const pid = Number(row?.ProcessId);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const commandLine = typeof row.CommandLine === "string" ? row.CommandLine : "";
  return {
    pid,
    commandLine,
    argv: splitProcessCommandLine(commandLine),
    executable: typeof row.ExecutablePath === "string" ? row.ExecutablePath : null,
    startIdentity: row.StartIdentity ? `windows:${String(row.StartIdentity)}` : null
  };
}

function inspectWindowsProcesses(pid, spawnSyncImpl = spawnSync) {
  const filter = pid ? ` -Filter \"ProcessId = ${pid}\"` : " -Filter \"Name = 'node.exe'\"";
  const getProcess = pid
    ? `Get-Process -Id ${pid} -ErrorAction SilentlyContinue`
    : "Get-Process -Name node -ErrorAction SilentlyContinue";
  const ps = [
    "$ErrorActionPreference='Stop'; try {",
    `$items = Get-CimInstance Win32_Process${filter};`,
    "$rows = $items | ForEach-Object { [pscustomobject]@{",
    "ProcessId = $_.ProcessId; CommandLine = $_.CommandLine; ExecutablePath = $_.ExecutablePath;",
    "StartIdentity = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString() } else { $null }",
    "} } } catch {",
    `$items = ${getProcess};`,
    "$rows = $items | ForEach-Object { [pscustomobject]@{",
    "ProcessId = $_.Id; CommandLine = $null; ExecutablePath = $_.Path;",
    "StartIdentity = if ($_.StartTime) { $_.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() } else { $null }",
    "} } }; $rows | ConvertTo-Json -Compress"
  ].join(" ");
  const result = spawnSyncImpl("powershell.exe", ["-NoProfile", "-Command", ps], {
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  try {
    const parsed = JSON.parse(String(result.stdout).replace(/^\uFEFF/, ""));
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(windowsIdentityFromRow).filter(Boolean);
  } catch {
    return [];
  }
}

function inspectLinuxProcess(pid, fsImpl = fs) {
  try {
    const commandBuffer = fsImpl.readFileSync(`/proc/${pid}/cmdline`);
    const argv = commandBuffer.toString("utf8").split("\0").filter(Boolean);
    const commandLine = argv.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(" ");
    const stat = fsImpl.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return null;
    const fieldsAfterName = stat.slice(closeParen + 1).trim().split(/\s+/);
    const startTicks = fieldsAfterName[19];
    if (!startTicks || !commandLine) return null;
    let executable = null;
    try {
      executable = fsImpl.readlinkSync(`/proc/${pid}/exe`);
    } catch {
      // A readable command line is still useful; executable matching will fail closed if required.
    }
    return {
      pid,
      commandLine,
      argv,
      executable,
      startIdentity: `linux:${startTicks}`
    };
  } catch {
    return null;
  }
}

function getProcessIdentity(pid, dependencies = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const platform = dependencies.platform || process.platform;
  if (platform === "win32") {
    return inspectWindowsProcesses(pid, dependencies.spawnSyncImpl || spawnSync)[0] || null;
  }
  if (platform === "linux") return inspectLinuxProcess(pid, dependencies.fsImpl || fs);
  return null;
}

function stopManagedProcessRecord(record, options, dependencies) {
  const identity = record ? dependencies.inspect(record.pid) : null;
  const assessment = assessManagedProcess(record, identity, options);
  if (!assessment.safe) {
    if (record) dependencies.log(`[WARN] Refusing to stop pid=${record.pid}: ${assessment.reason}. Clearing stale pid record.`);
    dependencies.clear();
    return { stopped: false, reason: assessment.reason };
  }
  dependencies.terminate(record.pid, options.label);
  dependencies.clear();
  return { stopped: true, reason: assessment.reason };
}

module.exports = {
  assessManagedProcess,
  getProcessIdentity,
  inspectLinuxProcess,
  inspectWindowsProcesses,
  isExpectedProjectProcess,
  normalizeIdentityPath,
  parsePidRecord,
  productionEntry,
  splitProcessCommandLine,
  stopManagedProcessRecord
};
