import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadVersion } from "./lib/load-version.mjs";
import { sameSlots } from "./lib/scoring.mjs";
import { TEXT_CASES } from "../eval/text-cases.mjs";
import { CURRENT_TEXT_CASES } from "../eval/menu-current-cases.mjs";
const api=loadVersion();
const {matchUtterance,analyzeUtterance,newState,runTurn}=api;
const quiet={provider:null,onRouting:()=>{}};
const turn=(state,text)=>api.runSmartTurn(state,text,[],quiet);

test("quantity parsing fixes numeric, article, and Urdu contexts without treating English do as two",()=>{
  for(const [text,qty] of [["4 roti",4],["a dozen plain naan",12],["a couple garlic naan",2],["mujhe do garlic naan chahiye",2],["do garlic naan",2],["let's do the garlic naan",1],["do you have garlic naan",1],["two dozen plain naan",24],["half dozen plain naan",6]])assert.equal(matchUtterance(text)[0]?.qty,qty,text);
  assert.deepEqual(matchUtterance("4 roti and 2 garlic naan").map(m=>[m.itemId,m.qty]),[["ROTI",4],["GARLIC_NAAN_BREAD",2]]);
  assert.equal(matchUtterance("one chicken 65")[0].itemId,"CHICKEN_65");
});
test("Kirby repair is narrow and never changes an explicit Korma order",()=>{
  assert.equal(analyzeUtterance("two half chicken Kirby").issues[0].kind,"clarify");
  assert.equal(matchUtterance("chicken korma")[0].itemId,"KORMA_CHICKEN");
  assert.equal(analyzeUtterance("Kirby").issues[0].candidates.length>1,true);
});
test("repaired dishes need confirmation even when all variants are present",()=>{
  const first=runTurn(newState(),"two half chicken Kirby");
  assert.equal(first.state.cart.length,0);
  assert.equal(runTurn(first.state,"yes").state.cart.length,0);
  const selected=runTurn(first.state,"chicken lahori karahi");
  assert.equal(selected.state.cart[0].itemId,"CHICKEN_LAHORI_KARAHI");
  assert.equal(selected.state.cart[0].qty,2);
  assert.equal(selected.state.cart[0].size,"Half");
});
test("truncated paneer and pakora names do not enter the cart before confirmation",()=>{
  for(const [text,id,qty] of [["two paneer tikka","PANEER_TIKKA_MASALA",2],["three pakoda","FISH_PAKORA",3]]){
    const first=runTurn(newState(),text);assert.equal(first.state.cart.length,0);
    const yes=runTurn(first.state,"yes please");assert.equal(yes.state.cart[0].itemId,id);assert.equal(yes.state.cart[0].qty,qty);
  }
});
test("full menu names do not trigger truncated-name clarification",()=>{
  for(const text of ["paneer tikka masala","fish pakora","chicken seekh kebab","goat biryani"])assert.equal(analyzeUtterance(text).issues.length,0,text);
});
test("explicitly unavailable food is not silently replaced",()=>{
  for(const text of ["two chapli kabab","vegetable pakora","butter chicken","palak paneer"]){
    const result=runTurn(newState(),text);assert.equal(result.state.cart.length,0,text);
    assert.equal(result.state.recognition.issues[0].kind,"unavailable");
    assert.ok(result.state.recognition.issues[0].candidates.every(c=>api.getItem(c.itemId)));
  }
  const veg=runTurn(newState(),"vegetable pakora");assert.equal(veg.state.recognition.issues[0].candidates.some(candidate=>candidate.itemId==="FISH_PAKORA"),false);
});
test("generic protein choices retain the requested quantity",()=>{
  const first=runTurn(newState(),"two biryani");
  const goat=runTurn(first.state,"goat");assert.equal(goat.state.cart[0].itemId,"GOAT_BIRYANI");assert.equal(goat.state.cart[0].qty,2);
  assert.equal(runTurn(first.state,"four vegetable please").state.cart[0].qty,4);
  const kebab=runTurn(newState(),"seekh kebab");assert.equal(runTurn(kebab.state,"mutton").state.cart.length,0);
});
test("a clarification reply can explicitly change quantity",()=>{
  const first=runTurn(newState(),"paneer tikka");assert.equal(runTurn(first.state,"yes three please").state.cart[0].qty,3);
  const replacement=runTurn(newState(),"two palak paneer");assert.equal(runTurn(replacement.state,"one saag paneer").state.cart[0].qty,1);
});
test("mixed orders retain clear items while waiting for ambiguous-item confirmation",()=>{
  const first=runTurn(newState(),"two garlic naan and pakoda");assert.equal(first.state.cart.length,1);assert.equal(first.state.cart[0].itemId,"GARLIC_NAAN_BREAD");
  const accepted=runTurn(first.state,"yes");assert.deepEqual(accepted.state.cart.map(c=>[c.itemId,c.qty]).sort(),[["GARLIC_NAAN_BREAD",2],["FISH_PAKORA",1]].sort());
  const rejected=runTurn(first.state,"no");assert.equal(rejected.state.cart[0].itemId,"GARLIC_NAAN_BREAD");assert.equal(rejected.state.cart.length,1);
});
test("confirmation can include another item without losing it",()=>{
  const first=runTurn(newState(),"pakoda");
  const second=runTurn(first.state,"yes and two garlic naan");assert.equal(second.state.cart.length,2);
  const next=runTurn(first.state,"yes and paneer tikka");assert.equal(next.state.cart.length,1);assert.equal(next.state.cart[0].itemId,"FISH_PAKORA");assert.ok(next.state.recognition);
  assert.equal(runTurn(next.state,"yes").state.cart.length,2);
});
test("invalid quantities ask for restatement and are never clamped or added",()=>{
  for(const text of ["0 garlic naan","51 garlic naan","five dozen plain naan"]){
    const first=runTurn(newState(),text);assert.equal(first.state.cart.length,0,text);assert.equal(first.state.recognition.issues[0].reason,"quantity");
    assert.equal(runTurn(first.state,"yes").state.cart.length,0);
  }
});
test("new ambiguous items interrupt checkout and require a new recap",()=>{
  let state=runTurn(newState(),"one garlic naan Mild Spice").state;state.phase="confirm";
  const first=runTurn(state,"yes and paneer tikka");assert.equal(first.summary,undefined);
  const second=runTurn(first.state,"yes");assert.equal(second.summary,undefined);assert.notEqual(second.state.phase,"confirm");assert.equal(second.state.cart.length,2);
});
test("failed clarification is saved for review and cannot finalize",()=>{
  const first=runTurn(newState(),"paneer tikka");
  const second=runTurn(first.state,"I don't know");const third=runTurn(second.state,"I don't know");
  assert.notEqual(third.state.needsReview,true);
  const fourth=runTurn(third.state,"I don't know");
  assert.equal(fourth.state.needsReview,true);assert.equal(fourth.state.cart.length,0);
  fourth.state.phase="confirm";assert.equal(runTurn(fourth.state,"yes").summary,undefined);
});
test("smart/LLM entry point cannot bypass recognition confirmation",async()=>{
  const first=await turn(undefined,"two paneer tikka");assert.equal(first.usedLLM,false);assert.equal(first.state.cart.length,0);
  const second=await turn(first.state,"yes");assert.equal(second.usedLLM,false);assert.equal(second.state.cart[0].qty,2);
});
test("allergies and human requests take priority over dish clarification",async()=>{
  for(const text of ["I'm allergic to fish, do you have pakoda?","Can I speak to a person about paneer tikka?"]){
    const result=await turn(undefined,text);assert.equal(result.usedLLM,false);assert.equal(result.state.needsReview,true);assert.equal(result.state.cart.length,0);assert.equal(result.state.recognition,undefined);
  }
});
test("the frozen corpus still matches the original baseline hash",()=>{
  const baseline=JSON.parse(readFileSync("eval/results/text-baseline.json","utf8"));
  assert.equal(createHash("sha256").update(JSON.stringify(TEXT_CASES)).digest("hex"),baseline.corpusHash);
  assert.equal(baseline.metrics.supportedUtteranceSlotExact.numerator,76);
});
test("frozen supported and negative cases remain exact after the fixes",()=>{
  // The phrases stay frozen; final-menu/user-requested policy labels are explicit.
  for(const row of CURRENT_TEXT_CASES){
    const analysis=analyzeUtterance(row.text);
    if(row.expected.disposition==="match")assert.ok(sameSlots(row.expected.items,matchUtterance(row.text).map(m=>({...m,protein:m.protein??null,portion:m.portion??null}))),row.id);
    else if(row.expected.disposition==="ignore"){assert.equal(analysis.matches.length,0,row.id);assert.equal(analysis.issues.length,0,row.id);}
    else assert.equal(analysis.issues[0]?.kind,row.expected.disposition,row.id);
  }
});
