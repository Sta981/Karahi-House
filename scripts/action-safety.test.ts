import test from "node:test";
import assert from "node:assert/strict";
import { newState,runTurn,type DialogState,type TurnResult } from "../lib/dialog";
import { cartChanges,classifyTurn,equivalentLine,permitsCart } from "../lib/turn-safety";
import { replayCartOperations } from "../lib/cart-journal";

function call(...turns:string[]){let state=newState(),result:TurnResult|undefined;for(const text of turns){result=runTurn(state,text);state=result.state;}return result!;}
const quantity=(s:DialogState,id:string)=>s.cart.filter(line=>line.itemId===id).reduce((n,line)=>n+line.qty,0);
test("intent precedes matching; cart questions and complaints stay read-only in every pending mode",()=>{
 const states=[call("three mango lassi").state,call("two garlic naan and one plain naan","remove naan").state,call("one tikka").state,call("one lamb white karahi").state];
 for(const state of states)for(const text of ["why are there extra garlic naans","you put three mango lassi in my order","how many mango lassi are in the cart","is chicken boti in my order","why did you remove my plain naan"]){
  const before=structuredClone(state),r=runTurn(state,text);assert.ok(['question','complaint'].includes(r.intent!),text);assert.deepEqual(r.state.cart,before.cart,text);assert.deepEqual(state,before);assert.equal(r.operations?.length,0);assert.match(r.reply,/You have|cart is empty/);
 }
 assert.equal(classifyTurn(newState(),"hello").intent,"chitchat");assert.equal(classifyTurn(newState(),"all done goodbye").intent,"done");
 const mixed=call("one mango lassi and that is all goodbye");assert.equal(quantity(mixed.state,"MANGO_LASSI"),1);assert.equal(mixed.intent,"add_order");
});
test("disclosures are generated after reply rewrites for every affected line",()=>{
 let result=call("one mango lassi"),state=result.state;
 result=runTurn(state,"one mango lassi");assert.equal(quantity(result.state,"MANGO_LASSI"),2);assert.match(result.reply,/Added 1 Mango Lassi/);assert.ok(result.disclosure?.every(fact=>result.reply.includes(fact)));
 state=result.state;result=runTurn(state,"make it one");assert.equal(quantity(result.state,"MANGO_LASSI"),1);assert.match(result.reply,/Removed 1 Mango Lassi, 1 left/);
 result=call("one lamb white karahi half mild","make it full");assert.match(result.reply,/Changed .*Half.* to .*Full/);
 result=call("one chicken biryani","checkout","extra spicy");assert.match(result.reply,/Changed .*Chicken Biryani.*Extra Spicy/);
});
test("same-turn noun phrase restarts clarify; explicit additive conjunctions preserve requested quantities",()=>{
 for(const phrase of ["mango lassi one mango lassi","garlic naan a garlic naan","chicken boti one chicken boti"]){const r=call(phrase);assert.equal(r.state.cart.length,0,phrase);assert.ok(r.state.repetition,phrase);assert.match(r.reply,/One or two/);const confirmed=runTurn(r.state,"two please");assert.equal(confirmed.state.cart.reduce((n,line)=>n+line.qty,0),2);}
 for(const connector of ['and','also','another','aur']){const r=call(`one mango lassi ${connector} one mango lassi`);assert.equal(quantity(r.state,"MANGO_LASSI"),2,connector);assert.equal(r.state.repetition,undefined);}
 const separate=call("one mango lassi","one mango lassi");assert.equal(quantity(separate.state,"MANGO_LASSI"),2);
});
test("an uncertain repetition never swallows another dish or its required size answer",()=>{
 const r=call("mango lassi a mango lassi","one goat white karahi","full");
 assert.equal(quantity(r.state,"GOAT_WHITE_KARAHI"),1);assert.equal(quantity(r.state,"MANGO_LASSI"),0);assert.ok(r.state.repetition);
 const resolved=runTurn(r.state,"one mango lassi");assert.equal(quantity(resolved.state,"MANGO_LASSI"),1);assert.equal(quantity(resolved.state,"GOAT_WHITE_KARAHI"),1);
});
test("explicit canonical correction overrides a stale family without replacing unrelated resolved food",()=>{
 const first=call("one mango lassi and one tikka");const r=runTurn(first.state,"no not the tikka dish one lamb boti");assert.equal(quantity(r.state,"LAMB_BOTI"),1);assert.equal(quantity(r.state,"MANGO_LASSI"),1);assert.ok(!r.state.cart.some(line=>line.itemId.includes("TIKKA_MASALA")));assert.match(r.reply,/Added 1 Lamb Boti/);
});
test("negated canonical dish names are replacement targets, never additional orders",()=>{
 const r=call("one chicken tikka masala and one mango lassi","not the chicken tikka masala lamb boti");
 assert.equal(quantity(r.state,"CHICKEN_TIKKA_MASALA"),0);assert.equal(quantity(r.state,"LAMB_BOTI"),1);assert.equal(quantity(r.state,"MANGO_LASSI"),1);assert.match(r.reply,/Removed.*Chicken Tikka Masala.*Added.*Lamb Boti/);
});
test("equivalent duplicate lines support quantity removal; differing modifiers remain distinct",()=>{
 let r=call("one mango lassi and two mango lassi","remove two mango lassi");assert.equal(quantity(r.state,"MANGO_LASSI"),1);assert.match(r.reply,/Removed 2 Mango Lassi, 1 left/);
 r=call("one chicken biryani mild and one chicken biryani spicy","remove one chicken biryani");assert.equal(quantity(r.state,"CHICKEN_BIRYANI"),2);assert.ok(r.state.pendingCorrection);assert.match(r.reply,/Mild Spice.*Spicy/);
 const s=call("two garlic naan").state;s.cart.push({...structuredClone(s.cart[0]),notes:["without butter"]});r=runTurn(s,"remove one garlic naan");assert.equal(r.state.cart.length,2);assert.ok(r.state.pendingCorrection);
 r=runTurn(r.state,"one garlic naan without butter");if(r.state.removalConfirmation)r=runTurn(r.state,"yes");assert.equal(r.state.cart.length,2);assert.equal(r.state.cart.filter(line=>line.notes.includes("without butter")).reduce((n,line)=>n+line.qty,0),1);assert.equal(quantity(r.state,"GARLIC_NAAN_BREAD"),3);
});
test("pending removal never escapes into add or replacement on correction words",()=>{
 for(const answer of ["mango lassi instead","switch mango lassi with chicken boti","also two garlic naan","replace it with a lamb boti"]){const state=call("two mango lassi","remove something please").state;const r=runTurn(state,answer);assert.equal(r.intent,"removal");assert.deepEqual(r.state.cart,state.cart);assert.ok(!r.operations?.length);}
 const removed=call("two mango lassi","remove something please","one mango lassi");assert.equal(quantity(removed.state,"MANGO_LASSI"),1);
});
test("desired quantities set an equivalent group's total instead of appending",()=>{
 for(const phrase of ["only one mango lassi","just one mango lassi","make it one","one is enough"]){const r=call("two mango lassi and two mango lassi",phrase);assert.equal(quantity(r.state,"MANGO_LASSI"),1,phrase);assert.equal(r.state.cart.length,1);assert.ok(r.disclosure?.length);}
});
test("unresolved burger request persists alongside other dishes until explicit acceptance",()=>{
 const r=call("one burger and one mango lassi");assert.equal(quantity(r.state,"MANGO_LASSI"),1);assert.ok(r.state.recognition?.issues.some(issue=>issue.candidates.some(item=>item.itemId==="KIDS_CHICKEN_BURGER")));assert.match(r.reply,/Kids Chicken Burger, \$8\.99\. Add it/);
 const yes=runTurn(r.state,"yes");assert.equal(quantity(yes.state,"KIDS_CHICKEN_BURGER"),1);assert.equal(quantity(yes.state,"MANGO_LASSI"),1);
 const pending=call("one burger and one tikka");const corrected=runTurn(pending.state,"not the tikka one lamb boti");assert.equal(quantity(corrected.state,"LAMB_BOTI"),1);assert.ok(corrected.state.recognition?.issues.some(issue=>issue.candidates.some(candidate=>candidate.itemId==="KIDS_CHICKEN_BURGER")));assert.equal(quantity(corrected.state,"KIDS_CHICKEN_BURGER"),0);
 const total=call("three mango lassi and one burger","only one mango lassi");assert.equal(quantity(total.state,"MANGO_LASSI"),1);assert.ok(total.state.recognition?.issues.some(issue=>issue.candidates.some(candidate=>candidate.itemId==="KIDS_CHICKEN_BURGER")));assert.match(total.reply,/Kids Chicken Burger/);
});
test("permission gate rejects additions and modifier conversions during removal",()=>{
 const state=call("two mango lassi and one chicken biryani mild").state;
 assert.equal(permitsCart("removal",state.cart,[...state.cart,{...state.cart[0]}]),false);
 const modified=structuredClone(state.cart);modified[1].spiceLevel="Spicy";assert.equal(permitsCart("removal",state.cart,modified),false);
 for(const intent of ['question','complaint','confirm','done','chitchat'] as const)assert.equal(permitsCart(intent,state.cart,modified),false);
});
test("seeded random sequences preserve disclosure, action permissions and journal replay",()=>{
 const phrases=["one mango lassi","two garlic naan","one plain naan","remove one mango lassi","remove something","switch to chicken boti","one lamb boti","why did you add another mango lassi","how many garlic naan are in my order","only one mango lassi","make it two","one chicken biryani mild","set chicken biryani extra spicy","yes","no","that is all","one burger","mango lassi a mango lassi","two please","how much is the total","garlic naan instead","hello"];
 let count=0;
 for(let seed=1;seed<=12;seed++){
  let random=seed,state=newState();
  for(let step=0;step<60;step++){
   random=(Math.imul(random,1664525)+1013904223)>>>0;const text=phrases[random%phrases.length];if(state.phase==="closed")state=newState();
   const before=structuredClone(state),r=runTurn(state,text);assert.deepEqual(state,before,`input mutated ${seed}:${step}`);assert.deepEqual(replayCartOperations(state.cart,r.operations??[]),r.state.cart);
   if(JSON.stringify(state.cart)!==JSON.stringify(r.state.cart)){assert.ok(r.disclosure?.length,`${seed}:${step} ${text}`);for(const fact of r.disclosure!)assert.ok(r.reply.includes(fact),`${seed}:${step} lost ${fact}`);assert.ok(cartChanges(state.cart,r.state.cart).length);}
   if(['removal','complaint','question'].includes(r.intent!)){const available=new Map<string,number>();for(const line of state.cart)available.set(equivalentLine(line),(available.get(equivalentLine(line))??0)+line.qty);for(const line of r.state.cart){const key=equivalentLine(line);available.set(key,(available.get(key)??0)-line.qty);assert.ok(available.get(key)!>=0,`${r.intent} added ${line.name}`);}}
   state=r.state;count++;
  }
 }
 assert.equal(count,720);
});
