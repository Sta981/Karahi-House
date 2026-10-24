import { execFileSync } from "node:child_process";
import { readFileSync,writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadCommit } from "./lib/load-commit.mjs";
import { loadVersion } from "./lib/load-version.mjs";
const input=".data/real-mic-nova-replay.json",metadata=".data/nova-profile-snapshots.json";
const names=["menu-schema","speech","order-operations","cart-journal","menu","phonetic","matcher","privacy","dialog","llm-policy","llm","llm-context","turn-metrics","brain"];
const require=createRequire(import.meta.url);
const apiFrom=folder=>Object.assign({},...names.map(name=>require(path.resolve(folder,`${name}.js`))));
const unrelated="ordinary conversations concern changing weather distant clouds city traffic office calendars weekend schedules book reviews garden paths sunlight shadows music travel stories".split(" ");
const extras=[10,20,40].map(length=>Array.from({length},(_,index)=>unrelated[index%unrelated.length]).join(" "));
const texts=JSON.parse(readFileSync(input,"utf8"));
globalThis.fetch=async()=>{throw Error("Offline profiling cannot call providers");};
async function sequence(api){let state=api.newState();const rows=[];
 for(const [index,text] of texts.entries()){
  const start=performance.now(),cpu=process.cpuUsage();const result=await api.runSmartTurn(state,text,[],{provider:null,onRouting(){}});const elapsed=performance.now()-start,used=process.cpuUsage(cpu);
  rows.push({turn:index+1,words:text.split(/\s+/).length,wallMs:elapsed,cpuMs:(used.user+used.system)/1000,phaseBefore:state.phase,phaseAfter:result.state.phase,route:result.routing.route,signature:createHash("sha256").update(JSON.stringify({state:result.state,reply:result.reply,matches:result.matches})).digest("hex")});state=result.state;
 }
 const long=[];for(const text of extras){const start=performance.now(),result=api.runTurn(api.newState(),text);long.push({words:text.split(/\s+/).length,wallMs:performance.now()-start,signature:createHash("sha256").update(JSON.stringify(result)).digest("hex")});}
 return {rows,long};
}
const pct=values=>{const sorted=values.toSorted((a,b)=>a-b);return {n:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
if(process.argv[2]==="--worker"){
 const folder=process.argv[3];console.log(JSON.stringify(await sequence(apiFrom(folder))));
}else{
 const label=process.argv[2];if(!["before","after"].includes(label))throw Error("Use before or after; replay inputs must stay private under .data");
 const version=loadVersion(),current={fingerprint:version.fingerprint,folder:path.resolve(".data/version-runtime",version.fingerprint)};
 let variants;
 if(label==="before"){
  const commit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),original=loadCommit(commit);
  const baseline={commit,fingerprint:original.fingerprint,folder:path.resolve(".data/performance-reference",commit)};
  writeFileSync(metadata,JSON.stringify({original:baseline,preOptimization:current},null,2));variants={original:baseline,preOptimization:current};
 }else variants={optimized:current};
 const results={};
 for(const [name,variant]of Object.entries(variants)){
  const cold=[];for(let round=0;round<20;round++)cold.push(JSON.parse(execFileSync(process.execPath,["scripts/profile-nova-replay.mjs","--worker",variant.folder],{encoding:"utf8",maxBuffer:4*1024*1024,stdio:["ignore","pipe","pipe"]})));
  const api=apiFrom(variant.folder);await sequence(api);const warm=[];for(let round=0;round<20;round++)warm.push(await sequence(api));
  const summarize=runs=>({overall:pct(runs.flatMap(run=>run.rows.map(row=>row.wallMs))),turns:texts.map((text,index)=>({turn:index+1,words:text.split(/\s+/).length,phaseBefore:runs[0].rows[index].phaseBefore,route:runs[0].rows[index].route,...pct(runs.map(run=>run.rows[index].wallMs))})),unrelated:extras.map((text,index)=>({words:text.split(/\s+/).length,...pct(runs.map(run=>run.long[index].wallMs))}))});
  results[name]={...variant,cold:summarize(cold),warm:summarize(warm),signatures:{turns:warm[0].rows.map(row=>row.signature),unrelated:warm[0].long.map(row=>row.signature)}};
  console.log(JSON.stringify({variant:name,cold:results[name].cold.overall,warm:results[name].warm.overall}));
 }
 const report={kind:"private-real-mic-text-offline-replay-no-audio",repetitions:20,coldDefinition:"fresh Node process per sequence; precomputed immutable menu indexes loaded before timing",warmDefinition:"same process/menu indexes/JIT; fresh dialogue state each sequence; no transcript/result cache",providerCalls:0,rawUtterancesPublished:false,results};
 if(label==="after"){const before=JSON.parse(readFileSync("eval/results/nova-replay-before.json","utf8")).results.preOptimization;report.performanceChangePreservesResults=JSON.stringify(before.signatures)===JSON.stringify(results.optimized.signatures);}
 writeFileSync(`eval/results/nova-replay-${label}.json`,JSON.stringify(report,null,2)+"\n");
}
