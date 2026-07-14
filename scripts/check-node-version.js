const minimum = [22, 12, 0];

function parseVersion(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(value, required = minimum) {
  const parsed = parseVersion(value);
  if (!parsed) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (parsed[index] > required[index]) return true;
    if (parsed[index] < required[index]) return false;
  }
  return true;
}

if (require.main === module) {
  if (!versionAtLeast(process.versions.node)) {
    console.error(`[ERROR] Node.js 22.12.0 or newer is required; current version is ${process.version}.`);
    process.exit(1);
  }
  console.log(`[Chaq] Node.js ${process.versions.node} is supported.`);
}

module.exports = { parseVersion, versionAtLeast };
