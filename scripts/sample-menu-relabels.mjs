import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const sourcePath="eval/archive/final-menu-before-followups/report.json";
const bytes=readFileSync(sourcePath), report=JSON.parse(bytes);
const seed=process.argv[2]??randomBytes(16).toString("hex");
let counter=0;
function choose(range){
  const limit=0x100000000-(0x100000000%range);
  for(;;){const n=createHash("sha256").update(`${seed}:${counter++}`).digest().readUInt32BE(0);if(n<limit)return n%range;}
}
const pool=report.changes.slice();
for(let at=pool.length-1;at>0;at--){const other=choose(at+1);[pool[at],pool[other]]=[pool[other],pool[at]];}
function labels(menu,change){
  if(change.suite==="dev")return menu.dev.rows.find(row=>row.id===change.id).expected;
  if(change.suite==="simulated"){
    const row=menu.simulated.rows.find(row=>row.id===change.id);
    return {disposition:row.expectedDisposition,items:row.expected};
  }
  return {turns:menu.messy.rows.find(row=>row.id===change.id).turns.map(turn=>({text:turn.text,cart:turn.expected,unavailable:turn.expectedUnavailable}))};
}
const auditNotes={
  "aliases-05":"The source preparation changed from Brains Mughaz Masala to Brains Karahi; calling this only an ID rename was incomplete. The later requested distinctive-token policy now requires confirmation of maghaz.",
  "edge-04":"These are different source dishes: previous chicken/beef seekh-karahi alternatives were replaced by standalone kababs. This changes offered choices, not a silently accepted item.",
  "simulated-01":"Both labels require clarification. The stored items were historical intended-item annotations, not scored matches or permission to choose Lahori.",
  "simulated-02":"Both labels require clarification. The stored items were historical intended-item annotations, not scored matches or permission to choose Lahori."
};
const selected=pool.slice(0,10).map(change=>({...change,before:labels(report.oldMenu,change),after:labels(report.newMenu,change),auditNote:auditNotes[change.id]??null}));
const sample={kind:"uniform-random-relabel-audit",seed,algorithm:"SHA256 counter stream; rejection-sampled Fisher-Yates; first ten, no replacement",sourcePath,
  sourceSha256:createHash("sha256").update(bytes).digest("hex"),poolSize:pool.length,selected};
writeFileSync("eval/results/menu-relabel-sample.json",JSON.stringify(sample,null,2)+"\n");
writeFileSync("eval/results/menu-relabel-sample.md",["# Ten randomly selected relabels","",
  `Seed: ${seed}. Pool: ${pool.length}. Source: ${sourcePath}. SHA256: ${sample.sourceSha256}.`,"",
  "Reproduce with node scripts/sample-menu-relabels.mjs <seed>. This sample was drawn before the requested recognition fixes. Nothing was hand-selected or resampled. This artifact preserves the earlier labels; later explicit corrections are disclosed separately.","",
  "Before and after are complete labels from the saved report, not current matcher predictions. Menu-ID changes, availability changes and modifier policy changes are distinguished in the reasons. Conservative alias policy changes are disclosed as such, rather than described as source name changes.","",
  ...selected.flatMap(row=>[`## ${row.suite}: ${row.id}`,"",`Input: ${row.text}`,"",`Original reason: ${row.reason}`, ...(row.auditNote?["",`Audit finding: ${row.auditNote}`]:[]),"","Before:","```json",JSON.stringify(row.before,null,2),"```","After:","```json",JSON.stringify(row.after,null,2),"```",""]),""].join("\n"));
console.log(JSON.stringify({seed,poolSize:pool.length,selected},null,2));
