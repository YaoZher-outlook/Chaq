const assert = require("node:assert/strict");
const {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertSupportedNode,
  checkDependencyState,
  dependencyPaths,
  main,
  recordDependencyState,
  sha256File
} = require("./dependency-state");

const TEST_DIRECTORY = path.resolve(
  __dirname,
  "..",
  ".chaq-data",
  `dependency-state-tests-${process.pid}`
);

test.after(() => {
  rmSync(TEST_DIRECTORY, { recursive: true, force: true });
});

function createInstalledTree() {
  mkdirSync(TEST_DIRECTORY, { recursive: true });
  const root = mkdtempSync(path.join(TEST_DIRECTORY, "case-"));
  const manifests = {
    "": {
      name: "fixture-root",
      version: "1.0.0",
      private: true,
      workspaces: ["apps/*", "packages/*"],
      devDependencies: {
        concurrently: "^10.0.0",
        typescript: "^5.0.0"
      }
    },
    "apps/desktop": {
      name: "@fixture/desktop",
      version: "1.0.0",
      private: true,
      devDependencies: {
        electron: "43.1.0",
        "electron-builder": "^26.0.0",
        "electron-vite": "^5.0.0"
      }
    },
    "apps/server": {
      name: "@fixture/server",
      version: "1.0.0",
      private: true,
      dependencies: {
        "@fixture/shared": "file:../../packages/shared",
        "@prisma/client": "^5.20.0",
        prisma: "^5.20.0"
      },
      devDependencies: {
        tsx: "^4.0.0"
      }
    },
    "packages/shared": {
      name: "@fixture/shared",
      version: "1.0.0",
      private: true,
      dependencies: {
        zod: "^3.0.0"
      }
    }
  };
  const installedVersions = {
    concurrently: "10.1.0",
    typescript: "5.9.3",
    electron: "43.1.0",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.1",
    "@prisma/client": "5.22.0",
    prisma: "5.22.0",
    tsx: "4.23.0",
    zod: "3.25.76"
  };

  const packages = {};
  for (const [relativeDirectory, manifest] of Object.entries(manifests)) {
    const directory = path.join(root, ...relativeDirectory.split("/").filter(Boolean));
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest, null, 2));
    packages[relativeDirectory] = {
      name: manifest.name,
      version: manifest.version,
      ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
      ...(manifest.devDependencies ? { devDependencies: manifest.devDependencies } : {})
    };
  }

  for (const [packageName, version] of Object.entries(installedVersions)) {
    const packageDirectory = path.join(root, "node_modules", ...packageName.split("/"));
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({ name: packageName, version })
    );
    packages[`node_modules/${packageName}`] = { version };
  }

  const sharedLink = path.join(root, "node_modules", "@fixture", "shared");
  mkdirSync(path.dirname(sharedLink), { recursive: true });
  symlinkSync(
    path.join(root, "packages", "shared"),
    sharedLink,
    process.platform === "win32" ? "junction" : "dir"
  );
  packages["node_modules/@fixture/shared"] = {
    resolved: "packages/shared",
    link: true
  };

  const electronDirectory = path.join(root, "node_modules", "electron");
  mkdirSync(path.join(electronDirectory, "dist"), { recursive: true });
  writeFileSync(path.join(electronDirectory, "path.txt"), "electron.exe\n");
  writeFileSync(path.join(electronDirectory, "dist", "electron.exe"), "runtime");

  const packageLock = {
    name: "fixture-root",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages
  };
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(packageLock, null, 2));
  writeFileSync(
    path.join(root, "node_modules", ".package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages }, null, 2)
  );
  return root;
}

function withInstalledTree(callback) {
  const root = createInstalledTree();
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("records every root and workspace direct dependency, including build tooling and file links", () => {
  withInstalledTree((root) => {
    const { state, stateFile } = recordDependencyState(root);
    assert.equal(state.packageLockSha256, sha256File(path.join(root, "package-lock.json")));
    assert.equal(
      state.installedLockSha256,
      sha256File(path.join(root, "node_modules", ".package-lock.json"))
    );
    assert.equal(state.packageManifests["."], sha256File(path.join(root, "package.json")));
    assert.equal(
      state.packageManifests["apps/desktop"],
      sha256File(path.join(root, "apps", "desktop", "package.json"))
    );
    assert.equal(
      state.directDependencies["apps/desktop"].dependencies["electron-builder"].version,
      "26.15.3"
    );
    assert.equal(
      state.directDependencies["apps/server"].dependencies["@fixture/shared"].workspace,
      "packages/shared"
    );
    assert.equal(state.directDependencies["packages/shared"].dependencies.zod.version, "3.25.76");
    assert.equal(state.electronExecutable, "electron.exe");
    assert.deepEqual(checkDependencyState(root), {
      valid: true,
      reason: "Dependencies match package-lock.json.",
      stateFile
    });
    assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).version, 3);
  });
});

test("invalidates state when the root or installed lock changes", () => {
  withInstalledTree((root) => {
    recordDependencyState(root);
    appendFileSync(path.join(root, "package-lock.json"), "\n");
    assert.match(checkDependencyState(root).reason, /package-lock\.json changed/);

    recordDependencyState(root);
    appendFileSync(path.join(root, "node_modules", ".package-lock.json"), "\n");
    assert.match(checkDependencyState(root).reason, /node_modules\/\.package-lock\.json changed/);
  });
});

test("rejects missing direct packages, lock version mismatches, and incomplete Electron runtime", () => {
  withInstalledTree((root) => {
    recordDependencyState(root);
    rmSync(path.join(root, "node_modules", "electron-builder", "package.json"));
    assert.match(checkDependencyState(root).reason, /electron-builder is not installed/);
  });

  withInstalledTree((root) => {
    recordDependencyState(root);
    writeFileSync(
      path.join(root, "node_modules", "zod", "package.json"),
      JSON.stringify({ name: "zod", version: "9.0.0" })
    );
    assert.match(checkDependencyState(root).reason, /does not match package-lock\.json version/);
  });

  withInstalledTree((root) => {
    recordDependencyState(root);
    rmSync(path.join(root, "node_modules", "electron", "dist", "electron.exe"));
    assert.match(checkDependencyState(root).reason, /Electron runtime is missing/);
  });
});

test("rejects package manifests that are ahead of package-lock.json", () => {
  withInstalledTree((root) => {
    recordDependencyState(root);
    const serverManifestFile = path.join(root, "apps", "server", "package.json");
    const serverManifest = JSON.parse(readFileSync(serverManifestFile, "utf8"));
    serverManifest.dependencies["new-package"] = "^1.0.0";
    writeFileSync(serverManifestFile, JSON.stringify(serverManifest, null, 2));
    assert.match(checkDependencyState(root).reason, /package-lock\.json does not match dependencies\.new-package/);
  });
});

test("invalidates state for non-dependency package.json changes", () => {
  withInstalledTree((root) => {
    recordDependencyState(root);
    const sharedManifestFile = path.join(root, "packages", "shared", "package.json");
    const sharedManifest = JSON.parse(readFileSync(sharedManifestFile, "utf8"));
    sharedManifest.scripts = { build: "node build.js" };
    writeFileSync(sharedManifestFile, JSON.stringify(sharedManifest, null, 2));
    assert.match(checkDependencyState(root).reason, /root or workspace package\.json changed/);
  });

  withInstalledTree((root) => {
    recordDependencyState(root);
    const rootManifestFile = path.join(root, "package.json");
    const rootManifest = JSON.parse(readFileSync(rootManifestFile, "utf8"));
    rootManifest.overrides = { zod: "3.25.76" };
    writeFileSync(rootManifestFile, JSON.stringify(rootManifest, null, 2));
    assert.match(checkDependencyState(root).reason, /root or workspace package\.json changed/);
  });
});

test("reports the explicit Node baseline when workspace glob discovery is unavailable", () => {
  assert.throws(
    () => assertSupportedNode("22.11.0", () => []),
    /requires Node\.js >=22\.12/
  );
  assert.throws(
    () => assertSupportedNode("22.12.0", null),
    /requires Node\.js >=22\.12 with fs\.globSync/
  );
  assert.doesNotThrow(() => assertSupportedNode("22.12.0", () => []));
});

test("does not create a state file for an incomplete installation", () => {
  withInstalledTree((root) => {
    rmSync(path.join(root, "node_modules", ".package-lock.json"));
    assert.throws(() => recordDependencyState(root), /Installed package lock/);
    assert.equal(existsSync(dependencyPaths(root).stateFile), false);
  });
});

test("CLI contract returns 0 for valid state, 1 for stale state, and 2 for usage errors", () => {
  withInstalledTree((root) => {
    const messages = [];
    const io = {
      log: (message) => messages.push(message),
      error: (message) => messages.push(message)
    };

    assert.equal(main(["--check"], root, io), 1);
    assert.equal(main(["--record"], root, io), 0);
    assert.equal(main(["--check"], root, io), 0);
    assert.equal(main([], root, io), 2);
    assert.match(messages.join("\n"), /Dependencies match package-lock\.json/);
    assert.match(messages.join("\n"), /Usage:/);
  });
});
