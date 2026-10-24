import { readFileSync, writeFileSync, existsSync } from "node:fs";
const groups = [
  ["recognition", [
    "Legacy lowercase IDs; the numeric/Urdu/context checks should have been ported.",
    "The former single Lahori destination no longer exists; Kirby must ask for style. Preserve Korma separation.",
    "Obsolete behavior: yes could select generic chicken karahi. Final menu requires an explicit style choice.",
    "IDs changed; partial-name confirmation remains required and must be ported.",
    "IDs changed; full-name analysis (not only retrieval) lost direct coverage.",
    "Unavailable alternatives changed; no-substitution checks remain necessary.",
    "Grouped variants became distinct IDs; quantity preservation still applies.",
    "Legacy alternatives changed; explicit quantity changes still need coverage.",
    "Legacy IDs only; deferred clear-item preservation should have been ported.",
    "Legacy IDs only; extra items during confirmation should have been ported.",
    "Menu-independent safety coverage was unnecessarily archived.",
    "Legacy cart/IDs changed; checkout interruption remains necessary.",
    "Menu-independent staff-review/finalization safety needed porting.",
    "Legacy IDs changed; the LLM bypass guard still applies.",
    "Menu-independent allergy/staff priority should not have been dropped.",
    "Covered in the new source-integrity test, but historical baseline assertions were omitted.",
    "Old positive labels are obsolete; test the reviewed active overlay while preserving original bytes.",
  ]],
  ["order-safety", [
    "Partially replaced by the new low-margin test; mixed-order checks were lost.",
    "Partially replaced by the new correction test; invalidating a prior recap needed restoration.",
    "Invalid/uncertain correction regression coverage was lost.",
    "Partially replaced by callback privacy; real log capture and LLM-context redaction checks were lost.",
    "Partially replaced by LLM guards; the broad unsafe-output matrix was reduced.",
    "Menu-independent metric separation coverage should not have been dropped.",
  ]],
  ["llm-routing", [
    "Legacy scenario IDs needed migration; provider-call counting remains essential.",
    "Only cart fixture IDs changed; bounded/private LLM payload coverage was lost.",
    "A grouped white-karahi ID became a protein-specific ID; retrieval bounds still apply.",
    "Menu-independent JSON contract test should not have been archived.",
    "Menu-independent failure/disabled/action counters should not have been archived.",
    "Partially replaced by numeric guards; later-turn price/cart preservation coverage was lost.",
    "Menu-independent mocked transport test should not have been archived.",
    "Menu-independent opt-in test should not have been archived.",
  ]],
];
const rows=[];
for(const [suite,reasons] of groups){
  const text=readFileSync(`eval/archive/old-menu/tests/${suite}.test.mjs.txt`,"utf8");
  const names=[...text.matchAll(/\btest\("([^"]+)"/g)].map(match=>match[1]);
  if(names.length!==reasons.length)throw Error("Audit count mismatch");
  rows.push(...names.map((name,index)=>({suite,name,reason:reasons[index],port:`scripts/${suite}.test.mjs`,restored:existsSync(`scripts/${suite}.test.mjs`)})));
  if(existsSync(`scripts/${suite}.test.mjs`))for(const name of names)if(!readFileSync(`scripts/${suite}.test.mjs`,"utf8").includes(`test("${name}"`))throw Error(`Missing restored test: ${name}`);
}
const files=["scoring","menu-source","recognition","order-safety","llm-routing","recognition-followups","conversation-format"];
const currentTests=files.reduce((count,name)=>count+[...readFileSync(`scripts/${name}.test.mjs`,"utf8").matchAll(/\btest\("/g)].length,0);
writeFileSync("eval/results/test-coverage-audit.json",JSON.stringify({before:41,archived:31,unchangedScorer:10,replacementMenuTests:16,reportedAfter:26,currentTests,rows},null,2)+"\n");
writeFileSync("eval/results/test-coverage-audit.md",["# Audit of 41 → 26 tests","",
  "41 = 17 recognition + 6 order safety + 8 LLM routing + 10 scoring tests. Three suites (31 tests) were renamed to non-executable .mjs.txt archives; 16 final-menu tests were added and the ten scorer tests stayed active: 41 − 31 + 16 = 26.","",
  `This was not equivalent coverage. Changed menu IDs/semantics justified porting assertions, not dropping independent safeguards. All 31 are now ported under their original names with explicit final-menu semantics. The active suite has ${currentTests} tests: 26 retained + 31 restored + 8 requested recognition checks + 4 schema/scoring checks.`,"",
  "| Archived suite | Removed test | Why removed / audit finding | Port |","| --- | --- | --- | --- |",
  ...rows.map(row=>`| ${row.suite} | ${row.name} | ${row.reason} | ${row.restored ? "Restored: " : "To restore: "}${row.port} |`),""].join("\n"));
console.log(`Audited ${rows.length} archived tests: 17 recognition, 6 safety, 8 routing. Historical active count: 26.`);
