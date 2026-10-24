import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { sha256 } from "./load-matcher.mjs";

// No dotenv, SDK requests, or live credentials are loaded by this test helper.
export function loadDialog() {
  const files = ["menu", "phonetic", "matcher", "privacy", "dialog", "llm-policy", "llm", "llm-context", "turn-metrics", "brain"];
  const sources = files.map((name) => ({ name, source: readFileSync(`lib/${name}.ts`, "utf8") }));
  const fingerprint = sha256(JSON.stringify(sources));
  const runtime = path.resolve(".data/dialog-test-runtime", fingerprint);
  mkdirSync(runtime, { recursive: true });
  for (const { name, source } of sources) {
    writeFileSync(path.join(runtime, `${name}.js`), ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText);
  }
  const require = createRequire(import.meta.url);
  return { ...require(path.join(runtime, "dialog.js")), ...require(path.join(runtime, "brain.js")),
    ...require(path.join(runtime, "llm.js")), ...require(path.join(runtime, "llm-context.js")),
    ...require(path.join(runtime, "turn-metrics.js")), ...require(path.join(runtime, "privacy.js")),
    ...require(path.join(runtime, "llm-policy.js")), fingerprint };
}
