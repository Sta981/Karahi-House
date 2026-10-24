import { Session } from "node:inspector";
import { mkdirSync,writeFileSync } from "node:fs";
import path from "node:path";
import { loadVersion } from "./lib/load-version.mjs";
import { PARSER_DEV_CASES } from "../eval/parser-dev-cases.mjs";
import { runDevelopment } from "./lib/parser-development.mjs";
const label=process.argv[2];if(!["before","after"].includes(label))throw Error("Usage: node scripts/profile-parser.mjs before|after");
globalThis.fetch=async()=>{throw Error("Profiling is offline");};
const api=loadVersion(),session=new Session();session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
await post("Profiler.enable");await post("Profiler.start");
const rows=await runDevelopment(api,PARSER_DEV_CASES);
const {profile}=await post("Profiler.stop");session.disconnect();
mkdirSync(".data/profiling",{recursive:true});writeFileSync(`.data/profiling/parser-${label}.cpuprofile`,JSON.stringify(profile));
const samples=profile.samples??[],deltas=profile.timeDeltas??[],nodes=new Map(profile.nodes.map(node=>[node.id,node]));
const parents=new Map();for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id);
const grouped=new Map(),total=deltas.reduce((a,b)=>a+b,0);
const key=node=>`${node.callFrame.functionName||"(anonymous)"}|${path.basename(node.callFrame.url)}:${node.callFrame.lineNumber+1}`;
for(let index=0;index<samples.length;index++){
 let id=samples[index],first=true;const seen=new Set();
 while(nodes.has(id)){
  const node=nodes.get(id),name=key(node),entry=grouped.get(name)??{function:node.callFrame.functionName||"(anonymous)",file:path.basename(node.callFrame.url),selfUs:0,inclusiveUs:0};
  const us=deltas[index]??0;if(first)entry.selfUs+=us;if(!seen.has(name))entry.inclusiveUs+=us;
  grouped.set(name,entry);seen.add(name);first=false;id=parents.get(id);
 }
}
const functions=[...grouped.values()].map(row=>({...row,selfPercent:100*row.selfUs/total,inclusivePercent:100*row.inclusiveUs/total})).sort((a,b)=>b.selfUs-a.selfUs);
const report={kind:"sampled-cpu-profile-not-latency-benchmark",label,sourceFingerprint:api.fingerprint,scenarios:rows.length,passing:rows.filter(row=>row.pass).length,profiledUs:total,samples:samples.length,functions};
writeFileSync(`eval/results/parser-profile-${label}.json`,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,functions:functions.slice(0,12)},null,2));
