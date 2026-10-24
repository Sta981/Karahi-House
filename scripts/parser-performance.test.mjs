import assert from "node:assert/strict";
import test from "node:test";
import { loadVersion } from "./lib/load-version.mjs";
import { loadCommit } from "./lib/load-commit.mjs";
import { PARSER_DEV_CASES } from "../eval/parser-dev-cases.mjs";
const current=loadVersion(),reference=loadCommit("f911ee6bcaea618fd12fc09be0711b8f0912ec65");
globalThis.fetch=async()=>{throw Error("Performance parity tests are offline");};
test("three-row edit distance exactly matches the prior matrix, including transpositions",()=>{
 const words=[""];
 for(let length=1;length<=3;length++)for(const prefix of words.filter(word=>word.length===length-1))for(const letter of ["a","b","c"])words.push(prefix+letter);
 words.push("é","a🐟","🐟a","abca","acba","chicken","chiken");
 for(const a of words)for(const b of words)assert.equal(current.editDistance(a,b),reference.editDistance(a,b),`${a}/${b}`);
});
test("prepared scores are exact and pruning bounds never reject a possible original score",()=>{
 const labels=["","123","CHICKEN 65","Fish & Chips","chicken shynwari","garlik naan","raita","Rice!",...current.MENU.map(item=>item.name)];
 for(let left=0;left<labels.length;left++)for(let right=0;right<labels.length;right++){
  const a=labels[left],b=labels[right],expected=reference.similarity(a,b);
  const pa=current.preparePhonetic(a),pb=current.preparePhonetic(b);
  assert.equal(current.preparedSimilarity(pa,pb),expected,`${a}/${b}`);
  assert.equal(current.similarity(a,b),expected,`${a}/${b}`);
  assert.ok(current.similarityUpperBound(pa,pb)>=expected,`${a}/${b}`);
 }
});
test("indexed matcher preserves every name/alias, generated variant, candidate order and score",()=>{
 const inputs=new Set();
 for(const [index,item] of current.MENU.entries()){
  for(const name of [item.name,item.website_name,...item.aliases].filter(Boolean))inputs.add(name);
  inputs.add(`um two ${item.name.toLowerCase()} please`);
  inputs.add(`one ${item.name} and two ${current.MENU[(index+1)%current.MENU.length].name}`);
 }
 for(const text of inputs)assert.deepEqual(current.analyzeUtterance(text),reference.analyzeUtterance(text),text);
 const original=current.analyzeUtterance("two garlic naans");original.matches[0].qty=49;
 assert.deepEqual(current.analyzeUtterance("two garlic naans"),reference.analyzeUtterance("two garlic naans"));
});
test("historical index optimization preserved 80 dev conversations before later dialog changes",()=>{
 // This is a historical optimization-parity assertion, not a current behavior
 // grader. Live-call fixes intentionally change replies/state. Keep the exact
 // original assertions on the last committed implementation before those fixes;
 // current behavior remains checked by parser-properties and live-call patterns.
 const optimized=loadCommit("0df2cc3477e2498872908fcfeb5783a925b78fee");
 let turns=0;
 for(const row of PARSER_DEV_CASES){
  let before=reference.newState(),after=optimized.newState();
  for(const text of [...row.seed,row.text]){
   const expected=reference.runTurn(before,text),actual=optimized.runTurn(after,text);
   // Restaurant approval changes the source hash, not menu items or parser
   // behavior. Pin each version's hash, then compare all other fields exactly.
   assert.equal(expected.state.menuHash,reference.MENU_SOURCE_SHA256);
   assert.equal(actual.state.menuHash,optimized.MENU_SOURCE_SHA256);
   assert.deepEqual(actual,{...expected,state:{...expected.state,menuHash:optimized.MENU_SOURCE_SHA256}},`${row.id}: ${text}`);before=expected.state;after=actual.state;turns++;
  }
 }
 assert.ok(turns>80);
});
