const fs = require("node:fs");
const { chaqEnvironmentRoot, electronCache, npmCache, userData } = require("./env-paths");

for (const dir of [chaqEnvironmentRoot, electronCache, npmCache, userData]) {
  fs.mkdirSync(dir, { recursive: true });
}

console.log(`Chaq environment root: ${chaqEnvironmentRoot}`);
console.log(`Electron cache: ${electronCache}`);
console.log(`npm cache: ${npmCache}`);
console.log(`Electron user data: ${userData}`);
