import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {parseVoiceCsv,summarizeVoiceCsv} from "./lib/voice-csv.mjs";
const filename=process.argv[2];
if(!filename||/held[-_ ]?out|grading/i.test(filename))throw Error("Provide only an explicitly selected development voice CSV");
const bytes=readFileSync(filename),all=parseVoiceCsv(bytes.toString("utf8"));
const requiredAt=process.argv.indexOf("--require-commit"),required=requiredAt>=0?process.argv[requiredAt+1]:undefined;
if(requiredAt>=0&&!/^[a-f0-9]{40}$/.test(required??""))throw Error("Expected a full source commit");
const rows=required?all.filter(row=>row.build_commit===required&&row.build_dirty==="false"):all;
const report={kind:"private development voice export; not held-out",sourceSha256:createHash("sha256").update(bytes).digest("hex"),requiredCommit:required??null,excludedRows:all.length-rows.length,...summarizeVoiceCsv(rows)};
mkdirSync(".data",{recursive:true});writeFileSync(".data/voice-csv-analysis.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
if(process.argv.includes("--prepare-replay")){
 const madeAt=new Date(),deleteAfter=new Date(madeAt.getTime()+30*86400000);
 const fixture={kind:"development replay only",sourceSha256:report.sourceSha256,createdAt:madeAt.toISOString(),deleteAfter:deleteAfter.toISOString(),expectedFinalCart:null,expectationStatus:"waiting for the caller's intended final cart",turns:all.map((row,index)=>({id:`development_turn_${index+1}`,text:row.transcript_redacted,endpointReason:row.endpoint_reason,supersedesPrevious:index>0&&all[index-1].endpoint_reason.includes("revised_by_continuation")&&row.endpoint_reason.includes("continuation_merged")}))};
 writeFileSync(path.resolve(".data/live-call-replay-v1.json"),JSON.stringify(fixture,null,2)+"\n");
}
