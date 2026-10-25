import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { publishable, assertNoSecrets, readStagedBlob } from "./lib/github-publication.mjs";

const remote = "https://github.com/Sta981/Karahi-House.git";
const root = realpathSync(".");
const git = (cwd, args, inherit = false) => execFileSync("git", ["-C", cwd, ...args], {
  encoding: "utf8", stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
});
if (realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()) !== root) throw Error("Run inside the project Git root");
for (const file of [".env.local", ".data/publication-probe"]) git(root, ["check-ignore", "--no-index", "--quiet", "--", file]);
const sourceCommit = git(root, ["rev-parse", "HEAD"]).trim();
const selected = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean).filter(publishable).sort();
const privateValues = [];
for (const name of [".env", ".env.local"]) {
  const file = path.join(root, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !/(?:SECRET|TOKEN|API_KEY|PRIVATE_KEY|PASSWORD)/.test(match[1])) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (value.length >= 12) privateValues.push(value);
  }
}
const snapshot = new Map();
for (const file of selected) {
  const from = path.join(root, file);
  if (lstatSync(from).isSymbolicLink()) throw Error(`Symlink forbidden in publication: ${file}`);
  const bytes = readFileSync(from);
  assertNoSecrets(file, bytes, privateValues);
  snapshot.set(file, bytes);
}
if (!snapshot.has("env.example") || !snapshot.has("package.json")) throw Error("Incomplete source snapshot");
console.log(JSON.stringify({ sourceCommit, files: snapshot.size, hiddenFiles: 0, heldOutFiles: 0, privateLogs: 0, credentialScan: "passed" }));
if (!process.argv.includes("--push")) process.exit(0);
if (git(root, ["status", "--porcelain"]).trim()) throw Error("Commit local changes before publishing");

const directory = path.resolve(root, ".data/github-publication");
if (!directory.startsWith(root + path.sep)) throw Error("Publication directory escaped the project");
mkdirSync(directory, { recursive: true });
if (realpathSync(directory) !== directory) throw Error("Publication directory must not be a symlink");
const initialized = existsSync(path.join(directory, ".git"));
if (!initialized) {
  git(directory, ["init", "--initial-branch=main"]);
  git(directory, ["remote", "add", "origin", remote]);
}
if (git(directory, ["remote", "get-url", "origin"]).trim() !== remote) throw Error("Unexpected publication remote");
if (git(directory, ["branch", "--show-current"]).trim() !== "main") throw Error("Unexpected publication branch");
git(directory, ["config", "core.autocrlf", "false"]);
git(directory, ["config", "user.name", git(root, ["config", "user.name"]).trim()]);
git(directory, ["config", "user.email", git(root, ["config", "user.email"]).trim()]);
writeFileSync(path.join(directory, ".git/info/exclude"), ".*\nnode_modules/\n*.tsbuildinfo\n");
writeFileSync(path.join(directory, ".git/info/attributes"), "*.pcm binary\n");
const refs = git(directory, ["-c", "credential.interactive=never", "ls-remote", "origin"]);
if (!initialized && refs.trim()) throw Error("Remote already contains history; refusing an unreviewed initial publication");
if (initialized && /refs\/heads\/main\s*$/m.test(refs)) {
  git(directory, ["fetch", "--quiet", "origin", "main"]);
  if (git(directory, ["rev-list", "--count", "HEAD..origin/main"]).trim() !== "0") throw Error("Remote has new changes; reconcile them before publishing");
}
// Delete only previously tracked export files that disappeared from the allowlist.
for (const file of git(directory, ["ls-files", "-z"]).split("\0").filter(Boolean)) {
  if (snapshot.has(file)) continue;
  const target = path.resolve(directory, file);
  if (!target.startsWith(directory + path.sep)) throw Error("Export deletion escaped the publication directory");
  rmSync(target, { force: true });
}
for (const [file, bytes] of snapshot) {
  const target = path.resolve(directory, file);
  if (!target.startsWith(directory + path.sep)) throw Error("Export path escaped the publication directory");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}
// Explicit paths only: untracked files in the export folder can never be swept in.
git(directory, ["add", "--", ...selected]);
git(directory, ["add", "--update"]);
for (const file of git(directory, ["ls-files", "-z"]).split("\0").filter(Boolean)) {
  if (!snapshot.has(file) || !publishable(file)) throw Error(`Unexpected tracked export: ${file}`);
  const staged = readStagedBlob(directory,file,snapshot.get(file).byteLength);
  if(!staged.equals(snapshot.get(file)))throw Error(`Staged export changed unexpectedly: ${file}`);
  assertNoSecrets(file, staged, privateValues);
}
if (git(directory, ["status", "--porcelain"]).trim()) {
  const subject = git(root, ["log", "-1", "--format=%s"]).trim();
  git(directory, ["commit", "-m", subject, "-m", `Source-commit: ${sourceCommit}\nFiltered source snapshot; private local history is not published.`]);
}
git(directory, ["-c", "credential.interactive=never", "push", "--set-upstream", "origin", "main"], true);
const commit = git(directory, ["rev-parse", "HEAD"]).trim();
const remoteCommit = git(directory, ["ls-remote", "origin", "refs/heads/main"]).trim().split(/\s+/)[0];
if (commit !== remoteCommit) throw Error("Remote commit verification failed");
console.log(JSON.stringify({ remote, branch: "main", sourceCommit, publishedCommit: commit, verified: true }));
