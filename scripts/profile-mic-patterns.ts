import { performance } from "node:perf_hooks";
import { Session } from "node:inspector";
import { mkdirSync,writeFileSync } from "node:fs";
import { runSmartTurn } from "../lib/brain";
import { newState } from "../lib/dialog";
async function main(){
const label=process.argv[2]||"before";
if(!["before","after"].includes(label))throw Error("Expected before or after");
const patterns=[
 {kind:"quantity_bread",seed:[],text:"could we get too cheese naan"},
 {kind:"family_only",seed:[],text:"um shinwari please"},
 {kind:"exact_order",seed:[],text:"one lamb biryani please"},
 {kind:"spice_answer",seed:["one lamb biryani","that's it"],text:"mild spice"},
 {kind:"size_answer",seed:["one goat white karahi"],text:"full"},
 {kind:"partial_removal",seed:["two garlic naan","one mango lassi"],text:"take off the garlic bread"},
 {kind:"unknown",seed:[],text:"can we order a lamb rogan josh"},
 {kind:"multi_item",seed:[],text:"two rice and a mango lassi"},
 {kind:"correction",seed:["one rice"],text:"actually make that four"},
];
const rows:any[]=[];const profiler=new Session();profiler.connect();
const post=(method:string)=>new Promise<any>((resolve,reject)=>profiler.post(method as any,(error,result)=>error?reject(error):resolve(result)));
await post("Profiler.enable");await post("Profiler.start");
for(let round=0;round<12;round++)for(const pattern of patterns){
 let state=newState();for(const seed of pattern.seed)state=(await runSmartTurn(state,seed,[],{provider:null,onRouting(){}})).state;
 const start=performance.now(),cpu=process.cpuUsage();await runSmartTurn(state,pattern.text,[],{provider:null,onRouting(){}});
 const used=process.cpuUsage(cpu);rows.push({kind:pattern.kind,round,wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000});
}
const {profile}=await post("Profiler.stop");profiler.disconnect();
const pct=(values:number[])=>{const sorted=values.toSorted((a,b)=>a-b);return {n:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
const nodes=new Map<number,any>(profile.nodes.map((node:any)=>[node.id,node])),totals=new Map<string,number>();
for(let index=0;index<profile.samples.length;index++){const frame=nodes.get(profile.samples[index])?.callFrame;if(frame){const name=frame.functionName||"(anonymous)";totals.set(name,(totals.get(name)||0)+(profile.timeDeltas[index]||0));}}
const report={label,kind:"synthetic-pattern-cpu-profile-not-real-call",cold:rows.filter(row=>row.round===0),warm:pct(rows.filter(row=>row.round>0).map(row=>row.wallMs)),byKind:patterns.map(pattern=>({kind:pattern.kind,...pct(rows.filter(row=>row.round>0&&row.kind===pattern.kind).map(row=>row.wallMs))})),topCpu:[...totals].toSorted((a,b)=>b[1]-a[1]).slice(0,12).map(([name,microseconds])=>({name,microseconds}))};
mkdirSync(".data/profiling",{recursive:true});writeFileSync(`.data/profiling/mic-patterns-${label}.cpuprofile`,JSON.stringify(profile));
writeFileSync(`eval/results/mic-patterns-${label}.json`,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
}
void main();
