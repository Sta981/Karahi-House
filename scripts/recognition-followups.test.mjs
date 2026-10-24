import assert from "node:assert/strict";
import test from "node:test";
import { loadVersion } from "./lib/load-version.mjs";
import { CURRENT_SIMULATED_CASES } from "../eval/menu-current-cases.mjs";
import { SIMULATED_STT_CASES } from "../eval/simulated-stt-cases.mjs";
const api=loadVersion(),offline={provider:null,onRouting:()=>{}};
const turn=(state,text)=>api.runSmartTurn(state,text,[],offline);

test("STT number homophones apply only immediately before a recognized item",()=>{
  for(const [text,qty] of [["to garlic naan",2],["too garlic naan",2],["for roti",4],["fore garlic naan",4],["tree plain naan",3],["won mango lassi",1],["wun mango lassi",1],["ate veggie samosa",8]])assert.equal(api.matchUtterance(text)[0]?.qty,qty,text);
  for(const text of ["to","too","for","tree"])assert.equal(api.extractQuantityHint(text),undefined,text);
});
test("ordinary prepositions, verbs, distant homophones and named item numbers are not quantities",()=>{
  for(const text of ["I'd like to order garlic naan","I'm looking for roti","thanks for garlic naan","I ate roti","I won mango lassi","too many garlic naan","garlic naan for my dad","one chicken biryani for me"])assert.equal(api.matchUtterance(text)[0]?.qty,1,text);
  assert.equal(api.matchUtterance("one chicken 65")[0].qty,1);
  assert.equal(api.matchUtterance("one platter for 4 people")[0].qty,1);
});
test("for after an item remains a preposition and never supplies quantity four",async()=>{
  for(const [text,qty] of [["one chicken biryani for me",1],["two chicken biryani for our family",2],["one rice for my friend",1]]){
    const analysis=api.analyzeUtterance(text);assert.equal(analysis.matches.length,1,text);
    assert.equal(analysis.matches[0].qty,qty,text);assert.equal(analysis.matches[0].quantityHeard,undefined,text);
    const result=await turn(undefined,text);assert.equal(result.state.cart.length,1,text);
    assert.equal(result.state.cart[0].qty,qty,text);assert.doesNotMatch(result.reply,/quantity 4/);
    assert.equal(result.usedLLM,false);
  }
  assert.equal(api.matchUtterance("for roti")[0].qty,4,"STT repair directly before a recognized dish is retained");
});
test("repaired quantities are spoken before the spice prompt and in final read-back",async()=>{
  let result=await turn(undefined,"too garlic naan");assert.equal(result.state.cart[0].qty,2);assert.match(result.reply,/quantity 2.*Garlic Naan Bread/);
  result=await turn(result.state,"Mild Spice");result=await turn(result.state,"that's all");result=await turn(result.state,"Ahmed");
  assert.match(result.reply,/2 Garlic Naan Bread/);assert.match(result.reply,/\$7\.98/);
});
test("truncated distinctive tokens confirm while canonical one-word names resolve",async()=>{
  for(const [text,id] of [["gulab","GULAB_JAMUN"],["falooda","FALOODA_ICE_CREAM"],["rasmalai","RASMALAI"],["kheer","KHEER"],["nihari","BEEF_NIHARI"],["pakora","FISH_PAKORA"],["samosa","VEG_SAMOSAS"],["raita","RAITA"],["papad","PAPADAM"]]){
    const first=await turn(undefined,`one ${text}`);
    if(["rasmalai","kheer","raita"].includes(text)){assert.equal(first.state.cart[0]?.itemId,id,text);assert.equal(first.state.recognition,undefined);continue;}
    assert.equal(first.state.cart.length,0,text);assert.match(first.reply,/did you mean/i,text);
    assert.equal(first.state.recognition.issues[0].candidates[0].itemId,id,text);
    const yes=await turn(first.state,"yes");assert.equal(yes.state.cart[0].itemId,id,text);assert.equal(yes.usedLLM,false);
  }
  const noisy=await turn(undefined,"one gulab german");assert.equal(noisy.state.cart.length,0);assert.equal((await turn(noisy.state,"yes")).state.cart[0].itemId,"GULAB_JAMUN");
});
test("lassi requires a named flavor; yes cannot pick one silently",async()=>{
  const first=await turn(undefined,"too lassi");assert.equal(first.state.recognition.issues[0].candidates.length,3);assert.equal(first.state.cart.length,0);
  assert.equal((await turn(first.state,"yes")).state.cart.length,0);
  const named=await turn(first.state,"sweet lassi");assert.equal(named.state.cart[0].itemId,"SWEET_YOGURT_LASSI");assert.equal(named.state.cart[0].qty,2);
});
test("near-miss dishes offer a real replacement and never silently enter the cart",async()=>{
  for(const [text,id] of [["butter chicken","BUTTER_TIKKA_MASALA"],["butter kitchen","BUTTER_TIKKA_MASALA"],["palak paneer","SAAG_PANEER"],["palak pan here","SAAG_PANEER"]]){
    const first=await turn(undefined,text);assert.equal(first.state.cart.length,0,text);assert.match(first.reply,/isn't on this menu/i);
    assert.equal(first.state.recognition.issues[0].kind,"unavailable");assert.equal(first.state.recognition.issues[0].candidates[0].itemId,id);
    const yes=await turn(first.state,"yes");assert.equal(yes.state.cart[0].itemId,id);assert.equal(yes.state.cart[0].unitPriceCents,api.getItem(id).price_cents);assert.equal(yes.usedLLM,false);
  }
});
test("quantity repairs stay scoped to each item and conflicting counts need clarification",async()=>{
  const result=await turn(undefined,"one chicken biryani and too garlic naan");assert.deepEqual(result.state.cart.map(c=>c.qty),[1,2]);assert.match(result.reply,/quantity 2/);
  const conflict=await turn(undefined,"one too garlic naan");assert.equal(conflict.state.cart.length,0);assert.equal(conflict.state.recognition.issues[0].reason,"quantity");
});
test("Saag Paneer simulated ground truth uses source protein null",async()=>{
  assert.equal(SIMULATED_STT_CASES.find(row=>row.id==="simulated-08").items[0].protein,null);
  const row=CURRENT_SIMULATED_CASES.find(row=>row.id==="simulated-08");assert.equal(api.getItem("SAAG_PANEER").protein??null,null);
  assert.equal(row.expectedDisposition,"unavailable");assert.equal(row.candidateItems[0].protein,null);
  const result=await turn(undefined,row.text);assert.equal(result.state.recognition.issues[0].candidates[0].protein??null,null);
});
