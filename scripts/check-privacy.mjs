import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const root = realpathSync(".");
assert.equal(realpathSync(git(["rev-parse", "--show-toplevel"])), root, "Git root must be this project");
const privatePaths = [".env.local", ".data/ignore-probe.wav"];
for (const file of privatePaths) {
  git(["check-ignore", "--no-index", "--quiet", "--", file]);
  console.log(`${file}: ignored`);
}
assert.equal(git(["ls-files", "--", ".env.local", ".data"]), "", "Private files must not be tracked");
assert.equal(git(["ls-files", "--cached", "--", ":(glob)**/.env.local"]), "");

const lines = readFileSync(path.join(root, ".env.example"), "utf8").split(/\r?\n/);
let placeholders = 0;
for (const line of lines) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  // Do not echo a malformed line: it could contain a secret.
  assert.ok(/^[A-Z][A-Z0-9_]*=$/.test(line), ".env.example must contain empty placeholders only");
  placeholders++;
}
console.log(`.env.example: ${placeholders} empty placeholders; no values`);
console.log("Project Git root verified; no private files tracked. This check does not stage or commit files.");
