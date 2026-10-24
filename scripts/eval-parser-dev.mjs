import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import os from "node:os";
import { loadVersion } from "./lib/load-version.mjs";
import { PARSER_DEV_CASES } from "../eval/parser-dev-cases.mjs";
import { runDevelopment,summarizeDevelopment,percentiles } from "./lib/parser-development.mjs";
// Offline by construction, regardless of any configured keys or provider.
let requests=0;globalThis.fetch=async()=>{requests++;throw Error("Development evaluation is offline");};
const api=loadVersion();
const rows=await runDevelopment(api,PARSER_DEV_CASES);
console.log(`First development pass: ${rows.filter(row=>row.pass).length}/${rows.length}; timing warm-up repetitions next.`);
const correction=rows.filter(row=>row.group==="corrections"),speech=rows.filter(row=>row.group==="speech");
// Five additional timed passes after warm-up; all samples include validation,
// mutation and journal generation. No disk/network inside the measured turn.
const repeated=[];
for(let repeat=0;repeat<5;repeat++)repeated.push(...await runDevelopment(api,PARSER_DEV_CASES));
const comparison=JSON.parse(readFileSync("eval/segmenter-comparison-status.json","utf8"));
const report={kind:"development-not-held-out",sourceFingerprint:api.fingerprint,location:"local Lahore laptop; in-process text parser",machine:{platform:os.platform(),arch:os.arch(),node:process.version,cpu:os.cpus()[0]?.model},providerRequests:requests,groqComparison:{...comparison,criteriaCommit:"33b5488ba9453ba1953359c9be0645f6589dfebb",groqLatencyMs:null},all:summarizeDevelopment(rows),corrections:summarizeDevelopment(correction),speech:summarizeDevelopment(speech),warmLatencyMs:percentiles(repeated.map(row=>row.localMs)),warmCorrectionLatencyMs:percentiles(repeated.filter(row=>row.group==="corrections").map(row=>row.localMs)),rows};
if(requests)throw Error("Network was attempted");
mkdirSync("eval/results",{recursive:true});writeFileSync("eval/results/parser-development.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,rows:undefined},null,2));
for(const row of rows.filter(row=>!row.pass))console.log(JSON.stringify(row));
