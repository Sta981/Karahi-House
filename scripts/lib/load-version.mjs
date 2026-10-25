import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

export function loadVersion(version = "new") {
  if (!["old", "previous", "new"].includes(version)) throw new Error("Unknown menu version");
  const sourceRoot = version === "old" ? "eval/archive/old-menu/lib" : version === "previous" ? "eval/archive/previous-menu/lib" : "lib";
  const files = [...(version === "new" ? ["menu-schema","speech","order-operations","cart-journal","menu-browsing"] : []), "menu", "phonetic", "matcher", "privacy", "dialog", "llm-policy", "llm", "llm-context", "turn-metrics", "brain"];
  const sources = files.map((name) => ({ name, source: readFileSync(`${sourceRoot}/${name}.ts`, "utf8") }));
  const aliasText = version === "new" ? readFileSync("lib/menu-aliases.json", "utf8") : "";
  const policyText = version === "new" ? readFileSync("lib/recognition-policy.json", "utf8") : "";
  const fingerprint = createHash("sha256").update(JSON.stringify(sources)).update(aliasText).update(policyText).digest("hex");
  const runtime = path.resolve(".data/version-runtime", fingerprint);
  mkdirSync(runtime, { recursive: true });
  if (version === "new") writeFileSync(path.join(runtime, "menu-aliases.json"), aliasText);
  if (version === "new") writeFileSync(path.join(runtime, "recognition-policy.json"), policyText);
  for (const { name, source } of sources) writeFileSync(path.join(runtime, `${name}.js`), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText);
  const require = createRequire(import.meta.url);
  return Object.assign({ fingerprint }, ...[...(version === "new" ? ["menu-schema","speech","order-operations","cart-journal"] : []), "menu", "phonetic", "matcher", "dialog", "brain", "llm", "llm-context", "privacy", "turn-metrics", "llm-policy"]
    .map((name) => require(path.join(runtime, `${name}.js`))));
}
