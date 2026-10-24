// Produce a reviewed runtime-only bundle. Never reads eval cases/graders, .env,
// .data contents or git credentials. No upload/publication occurs here.
import { execFileSync } from "node:child_process";
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root=path.resolve("."),git=args=>execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
if(git(["status","--porcelain"]))throw Error("Commit the reviewed code before packaging a deployment");
const commit=git(["rev-parse","HEAD"]);
const roots=["app/","components/","lib/","voice/","public/"];
const exact=new Set([".gitignore",".gitattributes","package.json","package-lock.json","next.config.mjs","tsconfig.json","next-env.d.ts","render.yaml","scripts/import-menu.mjs","scripts/voice-server.ts","scripts/prerender-voice-audio.ts"]);
const files=git(["ls-files"]).split(/\r?\n/).filter(file=>roots.some(prefix=>file.startsWith(prefix))||exact.has(file));
if(files.some(file=>file.startsWith("eval/")||file.includes(".env")||file.startsWith(".data/")))throw Error("Private or evaluation file in runtime bundle");
const parent=path.resolve(".data/deploy");mkdirSync(parent,{recursive:true});const target=mkdtempSync(path.join(parent,"runtime-"));
const manifest=[];
for(const file of files){const from=path.resolve(root,file),to=path.resolve(target,file);if(!from.startsWith(root+path.sep)||!to.startsWith(target+path.sep))throw Error("Runtime path escaped workspace");mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to);manifest.push({file,sha256:createHash("sha256").update(readFileSync(from)).digest("hex")});}
writeFileSync(path.join(target,"deployment-manifest.json"),JSON.stringify({commit,region:"oregon",plan:"free",files:manifest},null,2)+"\n");
writeFileSync(path.join(parent,"bundle.json"),JSON.stringify({commit,sourceDirectory:target,files:files.length,heldOutIncluded:false,credentialsIncluded:false},null,2)+"\n");
console.log(JSON.stringify({commit,sourceDirectory:target,files:files.length,region:"oregon",plan:"free",heldOutIncluded:false,credentialsIncluded:false}));
