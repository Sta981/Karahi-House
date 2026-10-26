import assert from "node:assert/strict";
import test from "node:test";
import { loadVersion } from "./lib/load-version.mjs";
import { PARSER_DEV_CASES } from "../eval/parser-dev-cases.mjs";
import { runDevelopment } from "./lib/parser-development.mjs";
const api=loadVersion();
globalThis.fetch=async()=>{throw Error("Properties must remain offline");};
test("80 fresh independently labeled dev scenarios: exact cart, action, questions and no unsafe additions",async()=>{
 assert.equal(PARSER_DEV_CASES.length,80);assert.equal(new Set(PARSER_DEV_CASES.map(row=>row.id)).size,80);
 const rows=await runDevelopment(api,PARSER_DEV_CASES);
 assert.deepEqual(rows.filter(row=>!row.pass).map(row=>({id:row.id,expected:row.expected,actual:row.actual})),[]);
 assert.deepEqual(rows.filter(row=>row.unsafe),[]);
});
test("bounded exhaustive replacement/removal properties never append or mutate an ambiguous target",()=>{
 for(const qty of [1,2,3,7,12,50])for(const id of ["RICE","ROTI","MANGO_LASSI","GARLIC_NAAN_BREAD"]){
  const name=api.getItem(id).name;
  const initial=api.runTurn(api.newState(),`${qty} ${name}`).state;
  for(const count of [1,4,9]){
   const changed=api.runTurn(initial,`actually ${count} ${name}`);
   assert.equal(changed.state.cart.length,1);assert.equal(changed.state.cart[0].qty,count);
   assert.equal(changed.state.cart[0].itemId,id);
   assert.deepEqual(api.replayCartOperations(initial.cart,changed.operations),changed.state.cart);
  }
  let removed=api.runTurn(initial,`remove ${name}`);
  if(qty>1){assert.deepEqual(removed.state.cart,initial.cart);assert.equal(removed.operations.length,0);assert.equal(removed.state.removalQuantity.available,qty);removed=api.runTurn(removed.state,String(qty));}
  assert.equal(removed.state.cart.length,0);
  assert.equal(removed.operations.some(operation=>operation.action==="add"),false);
 }
 const initial=api.runTurn(api.newState(),"garlic naan and plain naan").state;
 for(const text of ["remove naan","replace naan with roti","actually three naan"]){
  const result=api.runTurn(initial,text);assert.deepEqual(result.state.cart,initial.cart);assert.ok(result.state.pendingCorrection);
 }
});
test("plural normalization preserves item IDs and quantities, including STT number repairs",()=>{
 for(const [singular,plural] of [["garlic naan","garlic naans"],["roti","rotis"],["fish pakora","fish pakoras"],["soda","sodas"],["beef seekh kabab","beef seekh kababs"]])for(const qty of ["two","four","too","for","tree"]){
  const project=text=>api.analyzeUtterance(text).matches.map(match=>[match.itemId,match.qty]);
  assert.deepEqual(project(`${qty} ${singular}`),project(`${qty} ${plural}`));
 }
});
test("one uncertain item preserves resolved items; confirmation cannot duplicate them",()=>{
 for(const name of ["rice","garlic naan","mango lassi"])for(const uncertain of ["pakoda","gulab","paneer tikka"]){
  const initial=api.runTurn(api.newState(),`three ${name}`).state;
  const waiting=api.runTurn(initial,`two ${uncertain} and one raita`);
  assert.deepEqual(waiting.state.cart.slice(0,initial.cart.length),initial.cart);
  assert.equal(waiting.state.cart.filter(line=>line.itemId==="RAITA").length,1);
  const yes=api.runTurn(waiting.state,"yes");
  assert.deepEqual(yes.state.cart.slice(0,initial.cart.length),initial.cart);
  assert.equal(yes.state.cart.filter(line=>line.itemId==="RAITA").length,1);
  assert.equal(yes.state.cart.length,initial.cart.length+2);
 }
});
test("seeded operation replay exactly reconstructs carts over add, clarify, override, correct and remove",()=>{
 let seed=19477;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const commands=["rice","mango lassi","two garlic naans","pakoda","yes","Mild Spice","actually three","remove that","half goat lahori karahi","Full","make it spicy","remove everything","butter chicken","no"];
 let state=api.newState(),replayed=[];
 for(let index=0;index<150;index++){
  const result=api.runTurn(state,commands[random(commands.length)]);
  replayed=api.replayCartOperations(replayed,result.operations);
  assert.deepEqual(replayed,result.state.cart,`operation replay at ${index}`);
  for(const line of replayed){assert.ok(api.getItem(line.itemId));assert.ok(line.qty>=1&&line.qty<=50);}
  state=result.state;
 }
 assert.throws(()=>api.replayCartOperations([],[{action:"replace",index:0,before:{},after:{}}]));
});
test("exact unique one-word names resolve; misspelled one-word names cannot silently add",()=>{
 for(const name of ["Raita","Kheer","Rasmalai","Rice","Roti","Papadam"]){
  const exact=api.analyzeUtterance(name);assert.equal(exact.matches.length,1,name);assert.equal(exact.issues.length,0,name);
  const typo=api.analyzeUtterance(name+"x");assert.equal(typo.matches.length,0,name);
 }
 for(const name of ["gulab","lassi"])assert.equal(api.runTurn(api.newState(),name).state.cart.length,0);
});
test("I mean supersedes an uncertain mention rather than leaving a ghost question or changing a resolved side",()=>{
 const initial=api.runTurn(api.newState(),"rice").state;
 const result=api.runTurn(initial,"um korma i mean lamb korma and two soda cans");
 assert.equal(result.state.recognition,undefined);
 assert.deepEqual(result.state.cart.map(line=>[line.itemId,line.qty]),[["RICE",1],["KORMA_LAMB",1],["SODA_CAN",2]]);
 assert.equal(result.state.pendingCorrection,undefined);
});
test("ambiguous correction follow-ups identify the target and never append; partial removals subtract locally",()=>{
 const initial=api.runTurn(api.newState(),"garlic naan and plain naan medium spice").state;
 const waiting=api.runTurn(initial,"remove the naan");
 const selected=api.runTurn(waiting.state,"garlic naan");
 assert.deepEqual(selected.state.cart.map(line=>line.itemId),["PLAIN_NAAN_BREAD"]);
 const replace=api.runTurn(initial,"replace naan with roti");
 const resolved=api.runTurn(replace.state,"plain naan");
 assert.deepEqual(resolved.state.cart.map(line=>line.itemId),["GARLIC_NAAN_BREAD","ROTI"]);
 const rice=api.runTurn(api.newState(),"seven rice").state;
 assert.equal(api.runTurn(rice,"remove two rice").state.cart[0].qty,5);
 assert.deepEqual(api.runTurn(rice,"remove nine rice").state.cart,rice.cart);
});
test("a clarified uncertain replacement replaces the original line without duplicates",()=>{
 const initial=api.runTurn(api.newState(),"rice").state;
 const waiting=api.runTurn(initial,"actually mango lasi");
 // An exact menu alias may already resolve; if clarification was required it
 // must replace the rice on confirmation, never create a second line.
 const result=waiting.state.recognition?api.runTurn(waiting.state,"mango lassi"):waiting;
 assert.deepEqual(result.state.cart.map(line=>line.itemId),["MANGO_LASSI"]);
 const uncertain=api.runTurn(initial,"actually three garlik naan");
 const resolved=api.runTurn(uncertain.state,"garlic naan");
 assert.deepEqual(resolved.state.cart.map(line=>[line.itemId,line.qty]),[["GARLIC_NAAN_BREAD",3]]);
});
test("cooking instructions and wait-time FAQ stay outside the correction parser",()=>{
 for(const text of ["how long is the wait","make it quick","make it hot","make it spicy"])
  assert.equal(api.hasCorrectionMarkers(text),false,text);
 let state=api.runTurn(api.newState(),"goat biryani medium spice").state;
 const result=api.runTurn(state,"actually make it mild");
 assert.equal(result.state.cart.length,1);assert.equal(result.state.cart[0].spiceLevel,"Mild Spice");
 assert.equal(result.state.pendingCorrection,undefined);
});
test("an unresolved identity admits independent later items exactly once",()=>{
 const initial=api.runTurn(api.newState(),"rice and lassi");
 const next=api.runTurn(initial.state,"two garlic naans");
 assert.deepEqual(next.state.cart.map(line=>[line.itemId,line.qty]),[["RICE",1],["GARLIC_NAAN_BREAD",2]]);
 assert.ok(next.state.recognition);
 const resolved=api.runTurn(next.state,"salty yogurt lassi");
 assert.deepEqual(resolved.state.cart.map(line=>line.itemId),["RICE","GARLIC_NAAN_BREAD","SALTY_YOGURT_LASSI"]);
});
test("a new named dish's size never fills a different pending dish's size",()=>{
 const initial=api.runTurn(api.newState(),"goat white karahi");
 const next=api.runTurn(initial.state,"two half lamb lahori karahi");
 assert.deepEqual(next.state.cart.map(line=>[line.itemId,line.size,line.qty]),[["LAMB_LAHORI_KARAHI","Half",2]]);
 assert.equal(next.state.pending.itemId,"GOAT_WHITE_KARAHI");assert.equal(next.state.pending.portion,undefined);
 const spicy=api.runTurn(next.state,"Medium Spice");
 const sized=api.runTurn(spicy.state,"Full");
 assert.equal(sized.state.cart.length,2);assert.equal(sized.state.cart[1].size,"Full");
 assert.equal(sized.state.cart[1].spiceLevel,"Medium Spice");
});
test("legacy Urdu and deictic removal commands never become additions, even with cooking notes",()=>{
 const initial=api.runTurn(api.newState(),"garlic naan medium spice").state;
 for(const text of ["hata garlic naan","nikal garlic naan","take it off"]){
  const result=api.runTurn(initial,text);assert.deepEqual(result.state.cart,[],text);
  assert.equal(result.operations.some(operation=>operation.action==="add"),false,text);
 }
 // A modifier-qualified reference may be ambiguous. Preserve it and ask;
 // never interpret the request as a new order or increase its quantity.
 for(const text of ["remove garlic naan no onions","hata garlic naan mild spice"]){
  const result=api.runTurn(initial,text);assert.deepEqual(result.state.cart,initial.cart,text);
  assert.ok(result.state.pendingCorrection,text);assert.equal(result.operations.length,0,text);
 }
 for(const text of ["hata garlic naan","nikal rice","take it off"])
  assert.deepEqual(api.runTurn(api.newState(),text).state.cart,[],text);
});
