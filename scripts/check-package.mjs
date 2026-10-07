#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], {
  cwd,
  encoding: "utf8",
}));
assert.equal(manifest.length, 1, "Expected one package");
const paths = manifest[0].files.map((file) => file.path);
const required = ["package.json", "README.md", "LICENSE", "NOTICE.md", "src/index.ts", "src/codemode.ts", "resources/PI_BINDING.md", "resources/skills/ultracode/SKILL.md"];
for (const path of required) assert.ok(paths.includes(path), "Missing package resource: " + path);
const forbidden = paths.filter((path) =>
  path.startsWith("tests/") ||
  path.split("/").some((part) => ["node_modules", ".pi", ".git", ".github"].includes(part)) ||
  /(^|\/)(\.env(?:\..*)?|auth\.json|credentials\.json)$/.test(path) ||
  /\.(?:key|pem|p12|pfx)$/.test(path)
);
assert.deepEqual(forbidden, [], "Private or development files leaked into the package");
console.log("Package contents verified: " + paths.length + " files");
