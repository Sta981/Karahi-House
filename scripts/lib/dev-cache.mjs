import { existsSync, lstatSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync, realpathSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const kinds = ["voice", "browser", "web", "clean"];
const busy = (message, code = "DEV_CACHE_BUSY") => Object.assign(new Error(message), { code });

function lockDirectory(root) {
  let directory = realpathSync(root);
  for (const name of [".data", "dev-cache-locks"]) {
    directory = path.join(directory, name);
    if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory)) throw Error("Development lock directory must stay inside the project");
    mkdirSync(directory, { recursive: true });
  }
  return directory;
}

function readLock(file) {
  if (!existsSync(file)) return null;
  if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw busy("Cannot verify development cache ownership; stop the demo before cleaning.");
  let record;
  try { record = JSON.parse(readFileSync(file, "utf8")); } catch { throw busy("Cannot verify development cache ownership; stop the demo before cleaning."); }
  if (!Number.isInteger(record.pid) || record.pid < 1 || typeof record.token !== "string") throw busy("Cannot verify development cache ownership; stop the demo before cleaning.");
  return record;
}

function alive(record) {
  if (!record) return false;
  try { process.kill(record.pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

// Only PID + random ownership token are written: no audio, text, keys or cart.
// One voice lock covers every port, so a second invocation cannot prepare or
// clear the running demo's cache even when PORT is overridden.
export function acquireDevelopmentCache(root, kind) {
  if (!kinds.includes(kind)) throw Error("Unknown development cache kind");
  const directory = lockDirectory(root), file = path.join(directory, `${kind}.json`);
  const cleanFile = path.join(directory, "clean.json");
  if (kind !== "clean" && alive(readLock(cleanFile))) throw busy("Cache cleanup is running. Try npm run dev:voice again when it finishes.", "DEV_CLEAN_BUSY");
  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
    let fd;
    try { fd = openSync(file, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const record = readLock(file);
      if (alive(record)) throw busy(kind === "voice" ? "Voice demo is already running. Open its existing URL or stop it with Ctrl+C before restarting; no second server was started." : "A development server or cache cleanup is already running. Stop it before retrying.");
      if (record && readLock(file)?.token === record.token) unlinkSync(file);
      continue;
    }
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); acquired = true; }
    finally { closeSync(fd); }
  }
  if (!acquired) throw busy("Development cache ownership changed; retry after stopping the demo.");
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener("exit", release);
    try { if (readLock(file)?.token === token) unlinkSync(file); } catch { /* keep ownership fail-closed */ }
  };
  process.once("exit", release);
  if (kind !== "clean" && alive(readLock(cleanFile))) { release(); throw busy("Cache cleanup is running. Retry after it finishes.", "DEV_CLEAN_BUSY"); }
  return release;
}

export function cleanDevelopmentCaches(workspace) {
  const root = realpathSync(workspace), release = acquireDevelopmentCache(root, "clean");
  try {
    const locks = lockDirectory(root);
    for (const kind of kinds.filter(kind => kind !== "clean")) {
      if (alive(readLock(path.join(locks, `${kind}.json`)))) throw busy("Stop the running development server with Ctrl+C, then run npm run clean. Its live cache was not removed.");
    }
    const targets = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.name.startsWith(".next-dev-") && (entry.isDirectory() || entry.isSymbolicLink()))
      .map(entry => {
        const target = path.resolve(root, entry.name);
        // Validate every absolute target before deleting any. Never follow a
        // junction/symlink or enumerate arbitrary parent/Desktop directories.
        if (path.dirname(target) !== root || lstatSync(target).isSymbolicLink() || realpathSync(target) !== target) throw Error("Refusing to clean a cache outside the project or through a symlink");
        return target;
      });
    for (const target of targets) rmSync(target, { recursive: true, force: true });
    return targets.map(target => path.basename(target));
  } finally { release(); }
}
