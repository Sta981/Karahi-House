// Read-only reference implementation from Git, compiled into the ignored cache.
// Only library files are read. No held-out cases, graders, env or config files.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync,writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
export function loadCommit(commit){
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error("Full reference commit required");
 const names=["menu-schema","speech","order-operations","cart-journal","menu","phonetic","matcher","privacy","dialog","llm-policy","llm","llm-context","turn-metrics","brain"];
 const read=file=>execFileSync("git",["show",`${commit}:lib/${file}`],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 const sources=names.map(name=>({name,source:read(`${name}.ts`)}));
 const aliases=read("menu-aliases.json"),policy=read("recognition-policy.json");
 const fingerprint=createHash("sha256").update(JSON.stringify(sources)).update(aliases).update(policy).digest("hex");
 const folder=path.resolve(".data/performance-reference",commit);mkdirSync(folder,{recursive:true});
 writeFileSync(path.join(folder,"menu-aliases.json"),aliases);writeFileSync(path.join(folder,"recognition-policy.json"),policy);
 for(const {name,source} of sources)writeFileSync(path.join(folder,`${name}.js`),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText);
 const require=createRequire(import.meta.url);
 return Object.assign({commit,fingerprint},...names.map(name=>require(path.join(folder,`${name}.js`))));
}
