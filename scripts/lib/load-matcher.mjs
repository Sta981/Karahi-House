import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function loadMatcher() {
  const files = ["lib/menu.ts", "lib/phonetic.ts", "lib/matcher.ts"];
  const sources = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const sourceHashes = Object.fromEntries(sources.map(({ file, text }) => [file, sha256(text)]));
  const sourceFingerprint = sha256(JSON.stringify(sourceHashes));
  const runtime = path.resolve(".data", "eval-runtime", sourceFingerprint);
  mkdirSync(runtime, { recursive: true });
  for (const { file, text } of sources) {
    const compiled = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    writeFileSync(path.join(runtime, `${path.basename(file, ".ts")}.js`), compiled);
  }
  const require = createRequire(import.meta.url);
  return {
    ...require(path.join(runtime, "matcher.js")),
    menu: require(path.join(runtime, "menu.js")).MENU,
    sourceHashes,
    sourceFingerprint,
  };
}
