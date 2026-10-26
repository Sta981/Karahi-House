import test from "node:test";
import assert from "node:assert/strict";
import { publishable, assertNoSecrets, readStagedBlob, stageSnapshotPaths } from "./lib/github-publication.mjs";
import {mkdirSync,mkdtempSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";

test("publication excludes hidden paths, private data and held-out material", () => {
  for (const file of [".env.local", ".env.example", ".gitignore", ".data/call.csv", ".git/config", "docs/.private/info.md", "eval/held-out/cases.json", "eval/results/voice-live.json", "eval/archive/old-menu/lib/menu.ts", "scripts/run-held-out.mjs", "scripts/lib/scoring.mjs", "docs/recording.wav", "docs/completed-results.csv", "docs/keys.pem", "scripts/../.env.local"]) assert.equal(publishable(file), false, file);
});
test("source, blank templates and synthetic audio remain publishable", () => {
  for (const file of ["app/page.tsx", "lib/menu-source.json", "voice/session.ts", "public/voice-audio/clip.pcm", "env.example", "package-lock.json", "scripts/live-call-patterns.test.ts", "eval/parser-dev-cases.mjs", "docs/real-mic-results-template.csv"]) assert.equal(publishable(file), true, file);
});
test("actual configured secrets and nonempty environment placeholders block publication without leaking values", () => {
  const secret = "a-test-credential-that-must-never-be-published";
  assert.throws(() => assertNoSecrets("app/page.tsx", Buffer.from(`value=${secret}`), [secret]), error => !error.message.includes(secret));
  assert.throws(() => assertNoSecrets("env.example", Buffer.from("DEEPGRAM_API_KEY=not-empty\n")));
  assert.doesNotThrow(() => assertNoSecrets("env.example", Buffer.from("# values belong in .env.local\nDEEPGRAM_API_KEY=\n")));
  assert.throws(() => assertNoSecrets("docs/key.txt", Buffer.from("-----BEGIN " + "PRIVATE KEY-----")));
});

test("large staged synthetic assets verify completely and errors never expose blob contents",()=>{
  mkdirSync(".data",{recursive:true});const directory=mkdtempSync(path.resolve(".data/publication-large-")),pcm=Buffer.alloc(1200000,65);
  execFileSync("git",["-C",directory,"init","--quiet"]);writeFileSync(path.join(directory,"synthetic.pcm"),pcm);
  execFileSync("git",["-C",directory,"add","--","synthetic.pcm"]);
  assert.ok(readStagedBlob(directory,"synthetic.pcm",pcm.length).equals(pcm));
  assert.throws(()=>readStagedBlob(directory,"missing.pcm",1),{message:"Staged blob verification failed; publication stopped without exposing its contents"});
});

test("long publication allowlists use literal stdin paths and never sweep in private files",()=>{
  mkdirSync(".data",{recursive:true});const directory=mkdtempSync(path.resolve(".data/publication-paths-"));
  execFileSync("git",["-C",directory,"init","--quiet"]);
  mkdirSync(path.join(directory,"public/voice-audio"),{recursive:true});
  const files=Array.from({length:500},(_,index)=>`public/voice-audio/${index.toString(16).padStart(64,"0")}.pcm`);
  files.push("public/voice-audio/clip with space.pcm","public/voice-audio/clip[one].pcm");
  assert.ok(files.join(" ").length>32767);
  for(const file of files)writeFileSync(path.join(directory,file),"synthetic fixture");
  writeFileSync(path.join(directory,".env.local"),"private fixture");
  writeFileSync(path.join(directory,"public/not-selected.txt"),"unselected fixture");
  stageSnapshotPaths(directory,files);
  const tracked=execFileSync("git",["-C",directory,"ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
  assert.deepEqual(tracked.sort(),files.sort());
  assert.throws(()=>stageSnapshotPaths(directory,[".env.local"]),/Invalid publication path/);
  assert.throws(()=>stageSnapshotPaths(directory,["public/bad\0path"]),/Invalid publication path/);
});
