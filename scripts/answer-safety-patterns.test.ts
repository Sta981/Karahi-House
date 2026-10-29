import test from "node:test";
import assert from "node:assert/strict";
import {newState,runTurn,cartTotalCents,type DialogState} from "../lib/dialog";
import {MENU} from "../lib/menu";
import {canAcceptRecognition} from "../lib/answer-scope";
import {replayCartOperations} from "../lib/cart-journal";
import {analyzeUtterance} from "../lib/matcher";
const call=(...turns:string[])=>{let r=runTurn(newState(),turns[0]);for(const text of turns.slice(1))r=runTurn(r.state,text);return r;};
const qty=(state:DialogState,id:string)=>state.cart.filter(line=>line.itemId===id).reduce((n,line)=>n+line.qty,0);

test("denials of an alleged request remain read-only across active questions",()=>{
 const states=[call("two mango lassi").state,call("one burger").state,call("one goat white karahi").state];
 for(const state of states)for(const text of ["i never asked you to include desi chicken i was asking about the size","i did not request desi chicken i only wanted information","i don't ask you to add chicken boti i ask about portions","i asked you to add chicken boti","i ask you to add chicken boti"]){const r=runTurn(state,text);assert.equal(r.intent,"complaint",text);assert.deepEqual(r.state.cart,state.cart);assert.equal(r.operations?.length,0);}
});
test("protein browsing and availability frames never manufacture an order candidate",()=>{
 for(const text of ["show me your goat dishes","i want chicken meals tell me which ones are available","which lamb options are available","can you list the items in lamp"]){const r=call(text);assert.equal(r.intent,"question",text);assert.equal(r.state.cart.length,0);assert.equal(r.state.recognition,undefined);assert.equal(r.state.needsReview,undefined);assert.match(r.reply,/\$.*Want more/);}
 assert.match(call("what items are running today").reply,/Menu categories/);
});
test("ordinary dish questions never become latent order proposals",()=>{
 const r=call("do you carry rogan josh");assert.equal(r.state.recognition,undefined);assert.match(r.reply,/don't have that dish/);assert.equal(runTurn(r.state,"yes").state.cart.length,0);
 const request=call("could i order chicken jalfrezi");assert.equal(request.intent,"add_order");assert.equal(request.state.cart.length,0);assert.equal(request.state.recognition?.issues[0].kind,"unavailable");
 const s=call("two mango lassi").state;const q=runTurn(s,"is desi chicken available");assert.deepEqual(q.state.cart,s.cart);assert.equal(q.state.recognition,undefined);assert.deepEqual(runTurn(q.state,"yes").state.cart,s.cart);
});
test("a serving-size question cannot turn yes into acceptance of an unrelated retained item",()=>{
 let r=call("one burger","one goat white karahi");assert.ok(r.state.pending);assert.ok(r.state.recognition);
 r=runTurn(r.state,"will the half goat white karahi feed three guests");assert.match(r.reply,/can't verify serving sizes.*Half or Full/);assert.equal(canAcceptRecognition(r.state),false);
 const yes=runTurn(r.state,"yes");assert.equal(qty(yes.state,"KIDS_CHICKEN_BURGER"),0);assert.equal(yes.state.cart.length,0);assert.match(yes.reply,/Half or Full/);
 const sized=runTurn(yes.state,"half");assert.equal(qty(sized.state,"GOAT_WHITE_KARAHI"),1);assert.equal(sized.state.cart[0].size,"Half");assert.equal(qty(sized.state,"KIDS_CHICKEN_BURGER"),0);assert.ok(sized.state.recognition);
});
test("yes belongs to the most recently emitted question rather than a retained candidate",()=>{
 let r=call("one burger");assert.equal(canAcceptRecognition(r.state),true);r=runTurn(r.state,"what desserts can you recommend");assert.equal(canAcceptRecognition(r.state),false);
 const answered=runTurn(r.state,"yes");assert.equal(qty(answered.state,"KIDS_CHICKEN_BURGER"),0);assert.equal(answered.state.cart.length,0);
 const untouched=call("one burger","yes");assert.equal(qty(untouched.state,"KIDS_CHICKEN_BURGER"),1);
});
test("a current explicit acceptance plus subtotal commits the candidate before computing the total",()=>{
 let r=call("two mango lassi and three burger");r=runTurn(r.state,"yeah and show me my total please");assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),3);assert.ok(r.reply.includes(`$${(cartTotalCents(r.state.cart)/100).toFixed(2)}`));assert.match(r.reply,/Added 3 Kids Chicken Burger/);
 assert.deepEqual(replayCartOperations(call("two mango lassi and three burger").state.cart,r.operations??[]),r.state.cart);
});
test("quantity-qualified consent stays bounded and never takes numbers from an information tail",()=>{
 const first=call("one burger");const r=runTurn(first.state,"yes include it three times");assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),3);
 for(const text of ["yes add it zero times","yes add it 51 times","yes but do not add it"]){assert.equal(runTurn(first.state,text).state.cart.length,0,text);}
});
test("current short full-name burger aliases and plurals preserve the requested quantity",()=>{
 const r=call("two chicken burgers and one mango lassi");assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),2);assert.equal(qty(r.state,"MANGO_LASSI"),1);
 assert.equal(qty(call("one burger").state,"KIDS_CHICKEN_BURGER"),0);
});
test("explicit decline then add supersedes the pending proposal without becoming a cooking note",()=>{
 const r=call("one burger","no add goat white karahi");assert.equal(r.state.recognition,undefined);assert.equal(r.state.pending?.itemId,"GOAT_WHITE_KARAHI");assert.deepEqual(r.state.pending?.notes,[]);assert.match(r.reply,/Half or Full/);
 const done=runTurn(r.state,"half");assert.equal(qty(done.state,"GOAT_WHITE_KARAHI"),1);assert.equal(qty(done.state,"KIDS_CHICKEN_BURGER"),0);
});
test("multi-item restatements with an existing overlap ask add versus replace instead of duplicating",()=>{
 const first=call("two lamb seekh kabab");let r=runTurn(first.state,"i want two lamb seekh kabab and three chicken seekh kabab");assert.deepEqual(r.state.cart,first.state.cart);assert.ok(r.state.pendingOrderList);assert.match(r.reply,/Add those items, or replace/);
 r=runTurn(r.state,"replace the order");assert.equal(qty(r.state,"LAMB_SEEKH_KABAB"),2);assert.equal(qty(r.state,"CHICKEN_SEEKH_KABAB"),3);
});
test("polite removal and item-adjacent number homophones subtract only the requested amount",()=>{
 for(const [text,amount] of [["could you just remove too onion naan",2],["please remove for onion naan",4],["delete tree onion naan",3]] as const){
  const first=call("five onion naan and one mango lassi");let r=runTurn(first.state,text);if(r.state.removalConfirmation)r=runTurn(r.state,"yes");assert.equal(qty(r.state,"ONION_NAAN"),5-amount,text);assert.equal(qty(r.state,"MANGO_LASSI"),1);assert.match(r.reply,new RegExp(`Removed ${amount} Onion Naan`));
 }
 const first=call("five onion naan");let pending=runTurn(first.state,"remove onion naan");pending=runTurn(pending.state,"too onion naan");if(pending.state.removalConfirmation)pending=runTurn(pending.state,"yes");assert.equal(qty(pending.state,"ONION_NAAN"),3);
 assert.deepEqual(runTurn(first.state,"remove one too onion naan").state.cart,first.state.cart);
});
test("protein lists contain only real matching menu items and retain a separate pending order",()=>{
 const first=call("one goat white karahi");const r=runTurn(first.state,"what beef dishes can i choose");assert.equal(r.state.pending?.itemId,first.state.pending?.itemId);assert.deepEqual(r.state.cart,first.state.cart);
 const offered=MENU.filter(item=>r.reply.includes(item.name));assert.ok(offered.length>=3&&offered.length<=5);assert.ok(offered.every(item=>item.protein==="Beef"||/^beef\b/i.test(item.name)));assert.equal(r.state.recognition,undefined);
});

test("karahi-like STT family sounds remain protein-scoped proposals with no guessed style",()=>{
 for(const text of ["three goat krahi","two chicken rahi without onions","one lamb cry"]){
  const analysis=analyzeUtterance(text);assert.equal(analysis.matches.length,0);const issue=analysis.issues[0];assert.equal(issue.reason,"stt_repair");assert.ok(issue.candidates.length>1);const protein=text.match(/goat|chicken|lamb/)![0];assert.ok(issue.candidates.every(item=>item.name.toLowerCase().startsWith(protein)&&/karahi/i.test(item.name)));assert.equal(call(text).state.cart.length,0);
 }
 assert.equal(analyzeUtterance("cry").matches.length,0);
});
test("affirmative restating of a current candidate resolves only that candidate; a different dish is not consent",()=>{
 const first=call("three chicken kebab");const accepted=runTurn(first.state,"yeah i want three chicken c kebab");assert.equal(qty(accepted.state,"CHICKEN_SEEKH_KABAB"),3);
 const burger=call("one burger");const different=runTurn(burger.state,"yes i want two mango lassi");assert.equal(qty(different.state,"KIDS_CHICKEN_BURGER"),0);assert.equal(qty(different.state,"MANGO_LASSI"),2);assert.ok(different.state.recognition);
});
test("seeded information and denial sequences cannot change quantities or authorize an unrelated retained proposal",()=>{
 const questions=["show me beef choices","could the half portion feed four guests","i never asked you to include chicken boti","what lamb meals are available"];
 for(let seed=1;seed<=24;seed++){
  let state=call("two mango lassi and one burger").state,random=seed;
  for(let turn=0;turn<8;turn++){
   random=(Math.imul(random,1664525)+1013904223)>>>0;const before=structuredClone(state),r=runTurn(state,questions[random%questions.length]);assert.deepEqual(r.state.cart,before.cart);assert.equal(r.operations?.length,0);assert.deepEqual(replayCartOperations(before.cart,r.operations??[]),r.state.cart);
   state=r.state;if(!canAcceptRecognition(state)){const yes=runTurn(state,"yes");assert.equal(qty(yes.state,"KIDS_CHICKEN_BURGER"),0);assert.deepEqual(yes.state.cart,before.cart);state=yes.state;}
  }
 }
});

test("an unresolved food description cannot silently disappear beside a multiword item",()=>{
 const r=call("two roast chicken boti and one mango lassi");assert.equal(qty(r.state,"CHICKEN_BOTI"),0);assert.equal(qty(r.state,"MANGO_LASSI"),1);assert.ok(r.state.recognition);assert.match(r.reply,/Added 1 Mango Lassi.*Did you mean Chicken Boti/);
});
