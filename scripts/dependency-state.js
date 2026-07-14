const {
  closeSync,
  existsSync,
  fsyncSync,
  globSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { projectRoot } = require("./env-paths");

const STATE_VERSION = 3;
const STATE_FILE_NAME = "dependency-state.json";

function dependencyPaths(root = projectRoot) {
  const nodeModules = path.join(root, "node_modules");
  return {
    root,
    packageLock: path.join(root, "package-lock.json"),
    installedLock: path.join(nodeModules, ".package-lock.json"),
    nodeModules,
    stateDirectory: path.join(root, ".chaq-data"),
    stateFile: path.join(root, ".chaq-data", STATE_FILE_NAME)
  };
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson(file, label) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${file}`, { cause: error });
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${file}`, { cause: error });
  }
}

function electronRuntimeSnapshot(root = projectRoot) {
  const { nodeModules } = dependencyPaths(root);
  const electronDirectory = path.join(nodeModules, "electron");
  const electronPathFile = path.join(electronDirectory, "path.txt");
  let electronExecutable;
  try {
    electronExecutable = readFileSync(electronPathFile, "utf8").trim();
  } catch (error) {
    throw new Error(`Electron runtime path is missing or unreadable: ${electronPathFile}`, {
      cause: error
    });
  }
  if (!electronExecutable) {
    throw new Error(`Electron runtime path is empty: ${electronPathFile}`);
  }

  const electronRuntime = path.resolve(electronDirectory, "dist", electronExecutable);
  const electronDist = path.resolve(electronDirectory, "dist");
  const relativeRuntime = path.relative(electronDist, electronRuntime);
  if (
    relativeRuntime.startsWith(`..${path.sep}`)
    || relativeRuntime === ".."
    || path.isAbsolute(relativeRuntime)
  ) {
    throw new Error(`Electron runtime path escapes its dist directory: ${electronExecutable}`);
  }
  if (!existsSync(electronRuntime) || !statSync(electronRuntime).isFile()) {
    throw new Error(`Electron runtime is missing: ${electronRuntime}`);
  }

  return electronExecutable.replaceAll("\\", "/");
}

function workspacePatterns(manifest) {
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  if (Array.isArray(manifest.workspaces?.packages)) return manifest.workspaces.packages;
  return [];
}

function assertSupportedNode(
  version = process.versions.node,
  workspaceGlob = globSync
) {
  const [major = 0, minor = 0] = String(version).split(".").map(Number);
  if (
    !Number.isInteger(major)
    || !Number.isInteger(minor)
    || major < 22
    || (major === 22 && minor < 12)
    || typeof workspaceGlob !== "function"
  ) {
    throw new Error(
      `Dependency state workspace discovery requires Node.js >=22.12 with fs.globSync; current Node is ${version}.`
    );
  }
}

function projectManifests(root, rootManifest) {
  assertSupportedNode();
  const manifestFiles = new Set([path.join(root, "package.json")]);
  for (const value of workspacePatterns(rootManifest)) {
    if (typeof value !== "string" || value.startsWith("!")) continue;
    const pattern = value.replaceAll("\\", "/").replace(/\/+$/, "");
    for (const relativeFile of globSync(`${pattern}/package.json`, {
      cwd: root,
      nodir: true
    })) {
      const manifestFile = path.resolve(root, relativeFile);
      const relative = path.relative(root, manifestFile);
      if (
        relative === ".."
        || relative.startsWith(`..${path.sep}`)
        || relative.split(path.sep).includes("node_modules")
      ) {
        continue;
      }
      manifestFiles.add(manifestFile);
    }
  }

  return [...manifestFiles]
    .map((manifestFile) => {
      const directory = path.dirname(manifestFile);
      const relativeDirectory = lockPath(root, directory);
      return {
        directory,
        lockKey: relativeDirectory,
        manifestFile,
        manifest: readJson(manifestFile, "Project package manifest")
      };
    })
    .sort((left, right) => left.lockKey.localeCompare(right.lockKey));
}

function packageManifestSnapshot(projects) {
  const result = {};
  for (const project of projects) {
    result[project.lockKey || "."] = sha256File(project.manifestFile);
  }
  return result;
}

function lockPath(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function installedPackage(root, requesterDirectory, packageName) {
  let current = requesterDirectory;
  while (true) {
    const packageFile = path.join(current, "node_modules", ...packageName.split("/"), "package.json");
    if (existsSync(packageFile)) {
      return {
        directory: path.dirname(packageFile),
        lockKey: lockPath(root, path.dirname(packageFile)),
        manifest: readJson(packageFile, `Installed package ${packageName}`)
      };
    }
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current || !isWithin(root, parent)) break;
    current = parent;
  }
  throw new Error(`Direct dependency ${packageName} is not installed for ${lockPath(root, requesterDirectory) || "."}.`);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function sameRealPath(left, right) {
  const normalize = (value) => {
    const resolved = realpathSync.native(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function directDependencySnapshot(root, packageLock, configuredProjects) {
  const projects = configuredProjects || projectManifests(
    root,
    readJson(path.join(root, "package.json"), "Root package manifest")
  );
  const projectByLockKey = new Map(projects.map((project) => [project.lockKey, project]));
  const result = {};

  for (const project of projects) {
    const lockProject = packageLock.packages?.[project.lockKey];
    if (!lockProject) {
      throw new Error(`package-lock.json has no project entry for ${project.lockKey || "."}.`);
    }
    if (lockProject.name !== project.manifest.name || lockProject.version !== project.manifest.version) {
      throw new Error(`package-lock.json project metadata does not match ${project.lockKey || "."}/package.json.`);
    }

    const dependencies = {};
    for (const section of ["dependencies", "devDependencies"]) {
      const declared = project.manifest[section] || {};
      for (const packageName of Object.keys(declared).sort()) {
        if (dependencies[packageName]) {
          throw new Error(`${packageName} is declared more than once by ${project.lockKey || "."}.`);
        }
        const requested = declared[packageName];
        if (lockProject[section]?.[packageName] !== requested) {
          throw new Error(`package-lock.json does not match ${section}.${packageName} in ${project.lockKey || "."}/package.json.`);
        }

        const installed = installedPackage(root, project.directory, packageName);
        const lockInstalled = packageLock.packages?.[installed.lockKey];
        if (!lockInstalled) {
          throw new Error(`package-lock.json has no installed entry for ${installed.lockKey}.`);
        }
        if (typeof installed.manifest.version !== "string" || !installed.manifest.version) {
          throw new Error(`Installed package ${packageName} has no valid version at ${installed.lockKey}.`);
        }

        const item = {
          section,
          requested,
          installPath: installed.lockKey,
          version: installed.manifest.version
        };
        if (lockInstalled.link === true) {
          if (typeof lockInstalled.resolved !== "string") {
            throw new Error(`Workspace link ${installed.lockKey} has no resolved target in package-lock.json.`);
          }
          const workspaceKey = lockInstalled.resolved.replaceAll("\\", "/").replace(/^\.\//, "");
          const workspace = projectByLockKey.get(workspaceKey);
          if (!workspace) {
            throw new Error(`Workspace link ${installed.lockKey} targets unknown workspace ${workspaceKey}.`);
          }
          if (!sameRealPath(installed.directory, workspace.directory)) {
            throw new Error(`Workspace link ${installed.lockKey} does not point to ${workspaceKey}.`);
          }
          if (installed.manifest.version !== workspace.manifest.version) {
            throw new Error(`Workspace package ${packageName} version does not match ${workspaceKey}/package.json.`);
          }
          item.workspace = workspaceKey;
        } else if (lockInstalled.version !== installed.manifest.version) {
          throw new Error(`Installed package ${packageName} version ${installed.manifest.version} does not match package-lock.json version ${lockInstalled.version ?? "missing"}.`);
        }
        dependencies[packageName] = item;
      }
    }

    result[project.lockKey || "."] = {
      name: project.manifest.name,
      version: project.manifest.version,
      dependencies
    };
  }

  return result;
}

function createDependencySnapshot(root = projectRoot) {
  const paths = dependencyPaths(root);
  const packageLock = readJson(paths.packageLock, "Root package lock");
  readJson(paths.installedLock, "Installed package lock");
  const rootManifest = readJson(path.join(root, "package.json"), "Root package manifest");
  const projects = projectManifests(root, rootManifest);

  return {
    packageLockSha256: sha256File(paths.packageLock),
    installedLockSha256: sha256File(paths.installedLock),
    packageManifests: packageManifestSnapshot(projects),
    directDependencies: directDependencySnapshot(root, packageLock, projects),
    electronExecutable: electronRuntimeSnapshot(root)
  };
}

function recordDependencyState(root = projectRoot) {
  const paths = dependencyPaths(root);
  const snapshot = createDependencySnapshot(root);
  const state = {
    version: STATE_VERSION,
    recordedAt: new Date().toISOString(),
    ...snapshot
  };

  mkdirSync(paths.stateDirectory, { recursive: true });
  const temporary = `${paths.stateFile}.${process.pid}.${Date.now()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, paths.stateFile);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }

  return { state, stateFile: paths.stateFile };
}

function checkDependencyState(root = projectRoot) {
  const { stateFile } = dependencyPaths(root);
  let recorded;
  try {
    recorded = readJson(stateFile, "Dependency state");
  } catch (error) {
    return invalid(error.message, stateFile);
  }

  if (recorded.version !== STATE_VERSION) {
    return invalid(`Dependency state version ${recorded.version ?? "missing"} is unsupported.`, stateFile);
  }

  let current;
  try {
    current = createDependencySnapshot(root);
  } catch (error) {
    return invalid(error.message, stateFile);
  }

  if (recorded.packageLockSha256 !== current.packageLockSha256) {
    return invalid("package-lock.json changed after dependencies were installed.", stateFile);
  }
  if (recorded.installedLockSha256 !== current.installedLockSha256) {
    return invalid("node_modules/.package-lock.json changed after dependencies were installed.", stateFile);
  }
  if (JSON.stringify(recorded.packageManifests) !== JSON.stringify(current.packageManifests)) {
    return invalid("A root or workspace package.json changed after dependencies were installed.", stateFile);
  }
  if (recorded.electronExecutable !== current.electronExecutable) {
    return invalid("The installed Electron runtime changed after dependencies were installed.", stateFile);
  }
  if (JSON.stringify(recorded.directDependencies) !== JSON.stringify(current.directDependencies)) {
    return invalid("Direct project dependencies changed after dependencies were installed.", stateFile);
  }

  return { valid: true, reason: "Dependencies match package-lock.json.", stateFile };
}

function invalid(reason, stateFile) {
  return { valid: false, reason, stateFile };
}

function printUsage(io = console) {
  io.error("Usage: node scripts/dependency-state.js --check | --record");
}

function main(argv = process.argv.slice(2), root = projectRoot, io = console) {
  if (argv.length !== 1 || !["--check", "--record"].includes(argv[0])) {
    printUsage(io);
    return 2;
  }

  if (argv[0] === "--check") {
    const result = checkDependencyState(root);
    const output = result.valid ? io.log.bind(io) : io.error.bind(io);
    output(`[dependencies] ${result.reason}`);
    return result.valid ? 0 : 1;
  }

  try {
    const result = recordDependencyState(root);
    io.log(`[dependencies] Recorded installed dependency state: ${result.stateFile}`);
    return 0;
  } catch (error) {
    io.error(`[dependencies] Could not record dependency state: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  STATE_VERSION,
  assertSupportedNode,
  checkDependencyState,
  createDependencySnapshot,
  dependencyPaths,
  directDependencySnapshot,
  main,
  recordDependencyState,
  sha256File
};
