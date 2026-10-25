import { cleanDevelopmentCaches } from "./lib/dev-cache.mjs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

try {
  const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
  if (realpathSync(process.cwd()) !== root) throw Error("Run cleanup from the project root");
  const removed = cleanDevelopmentCaches(root);
  console.log(removed.length ? `Removed ${removed.length} development cache folder(s): ${removed.join(", ")}` : "No .next-dev-* cache folders to remove.");
} catch (error) {
  console.error(error.code === "DEV_CACHE_BUSY" || error.code === "DEV_CLEAN_BUSY" ? error.message : "Cache cleanup stopped: verify that cache paths are inside this project and not symlinks.");
  process.exitCode = 1;
}
