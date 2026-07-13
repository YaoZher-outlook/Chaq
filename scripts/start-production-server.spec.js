const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assessManagedProcess,
  getProcessIdentity,
  inspectLinuxProcess,
  inspectWindowsProcesses,
  isExpectedProjectProcess,
  parsePidRecord,
  productionEntry,
  splitProcessCommandLine,
  stopManagedProcessRecord
} = require("./production-process-identity");

function fixture(platform, overrides = {}) {
  const projectRoot = platform === "win32" ? "X:\\workspace\\Chaq" : "/srv/chaq";
  const executable = platform === "win32" ? "X:\\tools\\nodejs\\node.exe" : "/usr/bin/node";
  const role = overrides.role || "api";
  const entry = productionEntry(projectRoot, role, platform);
  const pid = overrides.pid || 4242;
  const startIdentity = overrides.startIdentity || `${platform}:start-100`;
  const identity = {
    pid,
    executable,
    commandLine: `"${executable}" "${entry}"`,
    argv: [executable, entry],
    startIdentity,
    ...overrides.identity
  };
  const record = {
    version: 1,
    pid,
    role,
    projectRoot,
    entry,
    executable,
    startIdentity,
    recordedAt: "2026-07-13T00:00:00.000Z",
    ...overrides.record
  };
  const options = { platform, projectRoot, role, executablePath: executable, label: `production ${role}` };
  return { identity, options, record };
}

test("a reused Windows PID is cleared without terminating its new process", () => {
  const { identity, options, record } = fixture("win32", {
    identity: { startIdentity: "windows:start-200" }
  });
  const terminated = [];
  let cleared = 0;
  const result = stopManagedProcessRecord(record, options, {
    inspect: () => identity,
    terminate: (pid) => terminated.push(pid),
    clear: () => { cleared += 1; },
    log: () => undefined
  });

  assert.equal(result.stopped, false);
  assert.match(result.reason, /start identity/);
  assert.deepEqual(terminated, []);
  assert.equal(cleared, 1);
});

test("the matching Linux process identity is allowed to stop", () => {
  const { identity, options, record } = fixture("linux");
  const terminated = [];
  let cleared = 0;
  const result = stopManagedProcessRecord(record, options, {
    inspect: () => identity,
    terminate: (pid, label) => terminated.push({ pid, label }),
    clear: () => { cleared += 1; },
    log: () => undefined
  });

  assert.deepEqual(assessManagedProcess(record, identity, options), {
    safe: true,
    reason: "managed process identity matches"
  });
  assert.equal(result.stopped, true);
  assert.deepEqual(terminated, [{ pid: 4242, label: "production api" }]);
  assert.equal(cleared, 1);
});

test("an unavailable command line fails closed and only clears the stale pid", () => {
  const { identity, options, record } = fixture("win32", {
    identity: { commandLine: null, argv: [] }
  });
  const terminated = [];
  let cleared = 0;
  const result = stopManagedProcessRecord(record, options, {
    inspect: () => identity,
    terminate: (pid) => terminated.push(pid),
    clear: () => { cleared += 1; },
    log: () => undefined
  });

  assert.equal(result.stopped, false);
  assert.match(result.reason, /command line is unavailable/);
  assert.deepEqual(terminated, []);
  assert.equal(cleared, 1);
});

test("legacy numeric pid files cannot authorize termination", () => {
  const legacy = parsePidRecord("4242\r\n");
  const { identity, options } = fixture("linux");
  assert.deepEqual(legacy, { version: 0, pid: 4242 });
  assert.deepEqual(assessManagedProcess(legacy, identity, options), {
    safe: false,
    reason: "legacy or invalid pid record"
  });
});

test("pid record parsing rejects malformed content and accepts versioned records", () => {
  assert.equal(parsePidRecord(""), null);
  assert.equal(parsePidRecord("not-json"), null);
  assert.equal(parsePidRecord('{"version":1,"pid":0}'), null);
  const record = fixture("linux").record;
  assert.deepEqual(parsePidRecord(JSON.stringify(record)), record);
  assert.throws(() => productionEntry("/srv/chaq", "unknown", "linux"), /Unknown production process role/);
});

test("command matching requires the exact executable and absolute role entry", () => {
  const { identity, options } = fixture("win32");
  assert.equal(isExpectedProjectProcess(identity, options), true);
  assert.deepEqual(splitProcessCommandLine(identity.commandLine), identity.argv);
  assert.equal(isExpectedProjectProcess({ ...identity, pid: 0 }, options), false);
  assert.equal(isExpectedProjectProcess({ ...identity, commandLine: "", argv: [] }, options), false);
  assert.equal(isExpectedProjectProcess({ ...identity, commandLine: identity.executable, argv: [identity.executable] }, options), false);
  assert.equal(isExpectedProjectProcess({ ...identity, argv: [identity.executable, `${identity.argv[1]}.other`] }, options), false);
  assert.equal(isExpectedProjectProcess({ ...identity, executable: "Y:\\other\\node.exe" }, options), false);
});

test("managed identity assessment rejects every mismatched ownership field", () => {
  const { identity, options, record } = fixture("linux");
  const unsafe = [
    [{ ...record, role: "worker" }, identity, /role/],
    [{ ...record, projectRoot: "/srv/other" }, identity, /project root/],
    [{ ...record, entry: "/srv/other/main.js" }, identity, /entry/],
    [record, null, /does not exist/],
    [record, { ...identity, pid: 9999 }, /process pid/],
    [record, { ...identity, startIdentity: null }, /start identity/],
    [record, { ...identity, argv: [identity.executable, "/srv/other/main.js"] }, /command does not match/]
  ];
  for (const [candidateRecord, candidateIdentity, reason] of unsafe) {
    const result = assessManagedProcess(candidateRecord, candidateIdentity, options);
    assert.equal(result.safe, false);
    assert.match(result.reason, reason);
  }
});

test("Windows process inspection parses rows and fails closed on tool errors", () => {
  const row = {
    ProcessId: 4242,
    CommandLine: '"X:\\tools\\nodejs\\node.exe" "X:\\workspace\\Chaq\\apps\\server\\dist\\src\\main.js"',
    ExecutablePath: "X:\\tools\\nodejs\\node.exe",
    StartIdentity: "123456"
  };
  const inspected = inspectWindowsProcesses(4242, () => ({ status: 0, stdout: JSON.stringify(row) }));
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].startIdentity, "windows:123456");
  assert.deepEqual(inspected[0].argv, [
    "X:\\tools\\nodejs\\node.exe",
    "X:\\workspace\\Chaq\\apps\\server\\dist\\src\\main.js"
  ]);
  assert.deepEqual(inspectWindowsProcesses(null, () => ({ status: 1, stdout: "" })), []);
  assert.deepEqual(inspectWindowsProcesses(null, () => ({ status: 0, stdout: "not-json" })), []);
  assert.deepEqual(inspectWindowsProcesses(null, () => ({
    status: 0,
    stdout: JSON.stringify([{ ProcessId: 0 }, row])
  })).map((item) => item.pid), [4242]);
});

test("Linux /proc inspection captures argv, executable and stable start ticks", () => {
  const statFields = ["S", ...Array(18).fill("0"), "987654"];
  const fakeFs = {
    readFileSync(file) {
      if (file.endsWith("/cmdline")) return Buffer.from("/usr/bin/node\0/srv/chaq/apps/server/dist/src/main.js\0");
      if (file.endsWith("/stat")) return `4242 (node worker) ${statFields.join(" ")}`;
      throw new Error("unexpected file");
    },
    readlinkSync: () => "/usr/bin/node"
  };
  const identity = inspectLinuxProcess(4242, fakeFs);
  assert.equal(identity.startIdentity, "linux:987654");
  assert.deepEqual(identity.argv, ["/usr/bin/node", "/srv/chaq/apps/server/dist/src/main.js"]);
  assert.equal(getProcessIdentity(4242, { platform: "linux", fsImpl: fakeFs }).pid, 4242);
  assert.equal(inspectLinuxProcess(4242, { readFileSync: () => { throw new Error("denied"); } }), null);
  assert.equal(getProcessIdentity(0, { platform: "linux", fsImpl: fakeFs }), null);
  assert.equal(getProcessIdentity(4242, { platform: "darwin" }), null);
});
