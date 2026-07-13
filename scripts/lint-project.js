const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true
});
if (listed.error) throw listed.error;
if (listed.status !== 0) {
  process.stderr.write(listed.stderr || "Could not list project files.\n");
  process.exit(listed.status || 1);
}

const files = listed.stdout.split("\0").filter(Boolean).sort((left, right) => left.localeCompare(right, "en"));
const textExtensions = new Set([".bat", ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".prisma", ".ts", ".tsx", ".yml", ".yaml"]);
const errors = [];

for (const relative of files) {
  const extension = path.extname(relative).toLowerCase();
  if (!textExtensions.has(extension) && ![".dockerignore", ".env.example", ".env.production.example", ".gitattributes", ".gitignore", ".npmrc", "Dockerfile.server"].includes(path.basename(relative))) {
    continue;
  }

  const absolute = path.join(root, relative);
  // `git ls-files --cached` still lists a tracked file that is intentionally
  // deleted in the working tree. It is not part of the candidate artifact.
  if (!existsSync(absolute)) continue;
  const text = readFileSync(absolute, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/^(<<<<<<<|=======|>>>>>>>)(?: |$)/.test(lines[index])) {
      errors.push(`${relative}:${index + 1} contains an unresolved merge marker.`);
    }
    if (/[ \t]+$/.test(lines[index])) {
      errors.push(`${relative}:${index + 1} has trailing whitespace.`);
    }
  }

  if (extension === ".json") {
    try {
      JSON.parse(text);
    } catch (error) {
      errors.push(`${relative} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (extension === ".ts" || extension === ".tsx") {
    const kind = extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, kind);
    for (const diagnostic of source.parseDiagnostics) {
      const location = diagnostic.start == null ? { line: 0, character: 0 } : source.getLineAndCharacterOfPosition(diagnostic.start);
      errors.push(`${relative}:${location.line + 1}:${location.character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
  }

  if ([".js", ".cjs", ".mjs"].includes(extension)) {
    const checked = spawnSync(process.execPath, ["--check", absolute], { cwd: root, encoding: "utf8", windowsHide: true });
    if (checked.status !== 0) errors.push(`${relative} failed node --check:\n${(checked.stderr || checked.stdout).trim()}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`[lint] ${error}`);
  console.error(`[lint] Failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`[lint] Checked ${files.length} tracked and untracked project files.`);
