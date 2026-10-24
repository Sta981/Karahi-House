// Same-process, alternating-order A/B of two LOCAL implementations. Never Groq.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync,writeFileSync } from "node:fs";
import os from "node:os";
import { loadCommit } from "./lib/load-commit.mjs";
import { loadVersion } from "./lib/load-version.mjs";
import { PARSER_DEV_CASES } from "../eval/parser-dev-cases.mjs";
import { runDevelopment,percentiles } from "./lib/parser-development.mjs";
const commit="f911ee6bcaea618fd12fc09be0711b8f0912ec65";
let requests=0;globalThis.fetch=async()=>{requests++;throw Error("Performance benchmark is offline");};
const before=loadCommit(commit),after=loadVersion();
const rows={before:[],after:[]},first={};
for(const [label,api] of [["before",before],["after",after]]){
 first[label]=await runDevelopment(api,PARSER_DEV_CASES);
 assert.ok(first[label].every(row=>row.pass),`${label} dev behavior failed`);
}
for(let pass=0;pass<5;pass++){
 for(const label of pass%2?["after","before"]:["before","after"]){
  const result=await runDevelopment(label==="before"?before:after,PARSER_DEV_CASES);
  assert.ok(result.every(row=>row.pass),`${label} repeated behavior failed`);
  rows[label].push(...result);
 }
 console.log(`Paired local timing pass ${pass+1}/5 complete.`);
}
assert.equal(requests,0);
const aggregate=label=>({firstPassMs:percentiles(first[label].map(row=>row.localMs)),warmMs:percentiles(rows[label].map(row=>row.localMs)),warmCorrectionsMs:percentiles(rows[label].filter(row=>row.group==="corrections").map(row=>row.localMs))});
const previous=JSON.parse(execFileSync("git",["show",`${commit}:eval/results/parser-development.json`],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
const scenarios=PARSER_DEV_CASES.map(row=>({id:row.id,text:row.text,wordCount:row.text.split(/\s+/).length,beforeMs:percentiles(rows.before.filter(result=>result.id===row.id).map(row=>row.localMs)),afterMs:percentiles(rows.after.filter(result=>result.id===row.id).map(row=>row.localMs))}));
const report={kind:"local-parser-performance-only-not-held-out",referenceCommit:commit,referenceFingerprint:before.fingerprint,sourceFingerprint:after.fingerprint,location:"Lahore laptop; synchronous in-process local turns; no tunnel or US hosting",machine:{node:process.version,platform:os.platform(),cpu:os.cpus()[0]?.model},cases:80,warmPasses:5,providerRequests:requests,historicalReportedBaselineMs:previous.warmLatencyMs,before:aggregate("before"),after:aggregate("after"),targetP95Ms:50,targetMet:aggregate("after").warmMs.p95<50,groqComparison:JSON.parse(readFileSync("eval/segmenter-comparison-status.json","utf8")),scenarios};
writeFileSync("eval/results/parser-performance.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,scenarios:undefined},null,2));
