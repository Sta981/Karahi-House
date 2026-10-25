import test from "node:test";
import assert from "node:assert/strict";
import config, { developmentConfig, useDevelopmentCache } from "../next.config.mjs";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants.js";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { acquireDevelopmentCache, cleanDevelopmentCaches } from "./lib/dev-cache.mjs";

test("one stable voice cache stays separate from build, ordinary dev and browser fixtures", () => {
  const dirs = [
    config(PHASE_PRODUCTION_BUILD).distDir ?? ".next",
    config(PHASE_DEVELOPMENT_SERVER).distDir,
    developmentConfig("voice").distDir,
    developmentConfig("browser").distDir,
  ];
  assert.equal(new Set(dirs).size, dirs.length);
  assert.equal(config(PHASE_PRODUCTION_SERVER).distDir ?? ".next", ".next");
});

test("isolated dev config preserves shared tracing and React settings", () => {
  const base = config(PHASE_PRODUCTION_BUILD);
  const { distDir, ...dev } = developmentConfig("voice");
  assert.deepEqual(dev, base);
  assert.equal(distDir, ".next-dev-voice");
});

test("cache names accept only known server kinds", () => {
  for (const kind of ["../private", "", ".next", "voice-3001"]) assert.throws(() => developmentConfig(kind));
});

test("custom servers select the config reloaded by prepare without affecting production", () => {
  const previous = process.env.KARAHI_NEXT_DEV_INSTANCE;
  try {
    useDevelopmentCache("voice");
    assert.equal(config(PHASE_DEVELOPMENT_SERVER).distDir, ".next-dev-voice");
    assert.equal(config(PHASE_PRODUCTION_BUILD).distDir ?? ".next", ".next");
    useDevelopmentCache("browser");
    assert.equal(config(PHASE_DEVELOPMENT_SERVER).distDir, ".next-dev-browser");
    process.env.KARAHI_NEXT_DEV_INSTANCE = "../private";
    assert.throws(() => config(PHASE_DEVELOPMENT_SERVER));
  } finally {
    if (previous === undefined) delete process.env.KARAHI_NEXT_DEV_INSTANCE;
    else process.env.KARAHI_NEXT_DEV_INSTANCE = previous;
  }
});

function fixture() {
  mkdirSync(".data", { recursive: true });
  return mkdtempSync(path.resolve(".data/cache-clean-test-"));
}

test("clean removes only top-level development caches and is safe to repeat", () => {
  const root = fixture();
  for (const dir of [".next-dev-voice", ".next-dev-old-3001", ".next", "public", ".data"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, "keep.txt"), "sentinel");
  }
  writeFileSync(path.join(root, ".env.local"), "private sentinel");
  assert.deepEqual(cleanDevelopmentCaches(root).sort(), [".next-dev-old-3001", ".next-dev-voice"]);
  for (const dir of [".next", "public", ".data"]) assert.equal(readFileSync(path.join(root, dir, "keep.txt"), "utf8"), "sentinel");
  assert.equal(readFileSync(path.join(root, ".env.local"), "utf8"), "private sentinel");
  assert.deepEqual(cleanDevelopmentCaches(root), []);
});

test("a running voice instance prevents a duplicate and cleaning its cache", () => {
  const root = fixture();
  mkdirSync(path.join(root, ".next-dev-voice"));
  const release = acquireDevelopmentCache(root, "voice");
  try {
    assert.throws(() => acquireDevelopmentCache(root, "voice"), { code: "DEV_CACHE_BUSY" });
    assert.throws(() => cleanDevelopmentCaches(root), { code: "DEV_CACHE_BUSY" });
    assert.equal(existsSync(path.join(root, ".next-dev-voice")), true);
  } finally { release(); }
  assert.deepEqual(cleanDevelopmentCaches(root), [".next-dev-voice"]);
});

test("clean preflights all targets and refuses junctions without deleting any", () => {
  const root = fixture(), outside = fixture();
  mkdirSync(path.join(root, ".next-dev-a-valid"));
  writeFileSync(path.join(outside, "keep.txt"), "sentinel");
  symlinkSync(outside, path.join(root, ".next-dev-z-junction"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => cleanDevelopmentCaches(root), /symlink/);
  assert.equal(existsSync(path.join(root, ".next-dev-a-valid")), true);
  assert.equal(readFileSync(path.join(outside, "keep.txt"), "utf8"), "sentinel");
});
