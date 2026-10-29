import test from "node:test";
import assert from "node:assert/strict";
import {MENU} from "../lib/menu";
import {newState,runTurn} from "../lib/dialog";
import {runSmartTurn} from "../lib/brain";
import {analyzeUtterance} from "../lib/matcher";
import {isNoMoreAnswer,completionWithTiming,explicitActionText} from "../lib/closing";
import {replayCartOperations} from "../lib/cart-journal";
const qty=(s:ReturnType<typeof newState>,id:string)=>s.cart.filter(line=>line.itemId===id).reduce((n,line)=>n+line.qty,0);
const kids=MENU.filter(item=>item.category==="Kids");

test("polite action prefixes grant only the explicit action, while thanks alone stays read-only",()=>{
 const r=runTurn(newState(),"thanks please add two mango lassi");assert.equal(qty(r.state,"MANGO_LASSI"),2);
 assert.deepEqual(runTurn(r.state,"thank you").state.cart,r.state.cart);
 assert.equal(explicitActionText("no onions please"),"no onions please");
 assert.equal(explicitActionText("actually i want to say remove one roti"),"remove one roti");
});
test("an explicit one-each category order expands only current menu items and discloses every line",()=>{
 const r=runTurn(newState(),"thank you add every dish in the kids section one of each");
 assert.deepEqual(r.state.cart.map(line=>line.itemId).sort(),kids.map(item=>item.id).sort());
 for(const item of kids){assert.equal(qty(r.state,item.id),1);assert.ok(r.reply.includes(item.name));}
 assert.equal(r.state.recognition,undefined);assert.deepEqual(replayCartOperations([],r.operations??[]),r.state.cart);
});
test("a category without an each-count asks consent; no, stale cart and bare yes cannot choose a category",()=>{
 const r=runTurn(newState(),"add all items in the kids section");assert.equal(r.state.cart.length,0);assert.ok(r.state.categoryOrder);
 assert.equal(runTurn(r.state,"yes please").state.cart.length,kids.length);
 const counted=runTurn(r.state,"two of each");for(const item of kids)assert.equal(qty(counted.state,item.id),2);
 assert.equal(runTurn(r.state,"no").state.cart.length,0);
 assert.equal(runTurn(newState(),"yes").state.cart.length,0);
 const stale=structuredClone(r.state);stale.cart=runTurn(newState(),"one mango lassi").state.cart;
 const answer=runTurn(stale,"yes");assert.equal(answer.state.cart.length,1);assert.match(answer.reply,/cart changed/i);
});
test("category browsing is read-only; required modifiers follow source data on group additions",()=>{
 const s=runTurn(newState(),"two mango lassi").state;
 assert.deepEqual(runTurn(s,"do you have every dish in the kids section").state.cart,s.cart);
 const r=runTurn(newState(),"add all items in the kids section one each extra spicy");
 assert.ok(r.state.cart.every(line=>!line.spiceLevel));assert.equal(r.summary,undefined);
 const sized=runTurn(newState(),"add all items in the white karahi category one each");assert.equal(sized.state.cart.length,MENU.filter(item=>item.category==="White Karahi"&&!item.size).length);assert.ok(sized.state.pending);assert.equal(sized.endCall,undefined);
});
test("negated and invalid-count category requests never create lines",()=>{
 const s=runTurn(newState(),"two mango lassi").state;
 for(const text of ["do not add every item in the kids section one each","add all kids section items minus one each","add all kids section items 1.5 each","add all kids section items 51 each"]){const r=runTurn(s,text);assert.deepEqual(r.state.cart,s.cart,text);}
 const large=runTurn(newState(),"add all kids section items thirteen each");for(const item of kids)assert.equal(qty(large.state,item.id),13);
});

test("bulk categories combined with another category or extra food cannot silently drop the extra request",()=>{
 const s=runTurn(newState(),"two onion naan").state;
 for(const text of ["add all kids section items one each and three mango lassi","add all kids section items one each with two roti","add all kids and desserts section items one each"]){
  const r=runTurn(s,text);assert.deepEqual(r.state.cart,s.cart,text);assert.match(r.reply,/Which category/);assert.equal(r.state.categoryOrder,undefined);assert.equal(r.operations?.length,0);
 }
});
test("short nuggets names retrieve the real pack without inventing a new item or food quantity",()=>{
 let r=runTurn(newState(),"nuggets");assert.equal(r.state.cart.length,0);assert.ok(r.state.recognition);assert.match(r.reply,/Chicken Nuggets/);
 r=runTurn(r.state,"yes");assert.equal(qty(r.state,"CHICKEN_NUGGETS_8_PIECES"),1);
 const full=runTurn(newState(),"two chicken nuggets please");assert.equal(qty(full.state,"CHICKEN_NUGGETS_8_PIECES"),2);assert.match(full.reply,/8 Pieces/);
});
test("accepting one candidate with an additional uncertain request keeps the second question",()=>{
 let r=runTurn(newState(),"one burger");r=runTurn(r.state,"yes and also nuggets");
 assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),1);assert.equal(qty(r.state,"CHICKEN_NUGGETS_8_PIECES"),0);assert.match(r.reply,/Nuggets/);
 r=runTurn(r.state,"yes");assert.equal(qty(r.state,"CHICKEN_NUGGETS_8_PIECES"),1);assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),1);
});
test("negative product questions cannot add, remove or change any cart quantity",()=>{
 const s=runTurn(newState(),"two mango lassi").state;
 for(const text of ["don't you have chicken nuggets","do not you have nuggets"]){const r=runTurn(s,text);assert.deepEqual(r.state.cart,s.cart);assert.match(r.reply,/7\.99/);assert.equal(r.intent,"question");}
});
test("polite negative completion reaches spice, name, read-back and final no-more exactly once",()=>{
 for(const phrase of ["no we're done thank you very much","no it's over thanks a lot","everything is done"]){
  let r=runTurn(newState({closingMode:"anything_else"}),"two chicken biryani");
  r=runTurn(r.state,phrase);assert.equal(r.state.phase,"ask_spice",phrase);assert.equal(r.state.cart[0].qty,2);assert.equal(r.endCall,undefined);
  r=runTurn(r.state,"medium");r=runTurn(r.state,"Synthetic Guest");assert.match(r.reply,/Please check:.*Anything else/);
  r=runTurn(r.state,"no thank you so much");assert.equal(r.endCall,true);assert.equal(r.summary?.status,"pending_acceptance");
 }
});
test("declining an outstanding correction then completing never applies the abandoned operation",()=>{
 const s=runTurn(newState({closingMode:"anything_else"}),"two onion naan").state;
 const pending=runTurn(s,"remove onion naan");assert.ok(pending.state.removalQuantity);
 const r=runTurn(pending.state,"do not change anything we're done thanks");assert.deepEqual(r.state.cart,s.cart);assert.equal(r.state.removalQuantity,undefined);assert.equal(r.state.phase,"ask_spice");assert.equal(r.operations?.length,0);
});
test("timing questions are answered locally and resume size; money questions retain their subtotal meaning",async()=>{
 const s=runTurn(newState(),"one goat white karahi").state;
 for(const text of ["how long will it take to prepare my order","how much time does my order take"]){
  const r=await runSmartTurn(s,text,[],{provider:null,onRouting(){}});assert.match(r.reply,/about 30 minutes.*Half or Full/);assert.deepEqual(r.state.cart,s.cart);assert.equal(r.usedLLM,false);
 }
 const order=runTurn(newState(),"two mango lassi").state;
 assert.match(runTurn(order,"how much is my order").reply,/\$9\.00/);
 const delivery=runTurn(order,"how long will delivery of my order take");assert.match(delivery.reply,/pickup only/i);assert.deepEqual(delivery.state.cart,order.cart);
});
test("a clean done-plus-time phrase works without a conjunction; merged noise is not confirmation",()=>{
 const phrase="we're done thank you very much how long will it take to prepare my order";
 assert.ok(completionWithTiming(phrase));const s=runTurn(newState({closingMode:"anything_else"}),"one chicken biryani").state;
 const r=runTurn(s,phrase);assert.match(r.reply,/about 30 minutes.*Spice for/);assert.equal(r.endCall,undefined);
 assert.equal(completionWithTiming("we're done random unrelated words how long will my order take"),undefined);
 for(const text of ["no onions","no remove one mango lassi","not enough spice"])assert.equal(isNoMoreAnswer(text),false);
});
test("absent removal targets and greetings preserve cart state and keep a removal question",()=>{
 const s=runTurn(newState(),"two onion naan").state;
 let r=runTurn(s,"remove beef nihari from my cart");assert.deepEqual(r.state.cart,s.cart);assert.match(r.reply,/Beef Nihari isn't in your cart/);
 r=runTurn(r.state,"hello");assert.deepEqual(r.state.cart,s.cart);assert.match(r.reply,/Which item should I remove/);assert.equal(r.state.needsReview,undefined);
 r=runTurn(r.state,"onion naan");assert.ok(r.state.removalQuantity);r=runTurn(r.state,"one");assert.equal(qty(r.state,"ONION_NAAN"),1);assert.match(r.reply,/Removed 1.*1 left/);
});
test("removal suffixes are scoped noise and an already absent line never removes something else",()=>{
 let r=runTurn(newState(),"two onion naan and one mango lassi");r=runTurn(r.state,"delete one onion naan from the order");assert.equal(qty(r.state,"ONION_NAAN"),1);assert.equal(qty(r.state,"MANGO_LASSI"),1);
 r=runTurn(r.state,"remove mango lassi");const cart=structuredClone(r.state.cart);r=runTurn(r.state,"remove mango lassi from my cart");assert.deepEqual(r.state.cart,cart);assert.match(r.reply,/isn't in your cart/);
});
test("unavailable branded drinks offer a real drink and recipient preferences are not food aliases",()=>{
 const r=runTurn(newState(),"three red bull please");assert.equal(r.state.cart.length,0);assert.match(r.reply,/isn't on this menu.*Soda/);assert.equal(r.state.recognition?.issues[0].kind,"unavailable");
 const preference=runTurn(r.state,"no i want a meal for my grandmother");assert.equal(preference.state.cart.length,0);assert.match(preference.reply,/prefer vegetarian food, chicken/);assert.equal(preference.state.recognition,undefined);
});
test("two conflicting proteins in a single dish ask rather than silently selecting the last protein",()=>{
 const a=analyzeUtterance("three chicken lamb biryani");assert.equal(a.matches.length,0);assert.ok(a.issues[0].candidates.some(item=>item.itemId==="CHICKEN_BIRYANI"));assert.ok(a.issues[0].candidates.some(item=>item.itemId==="LAMB_BIRYANI"));
 const r=runTurn(newState(),"three chicken lamb biryani");assert.equal(r.state.cart.length,0);assert.match(r.reply,/Chicken or Lamb/);
 assert.equal(qty(runTurn(r.state,"lamb").state,"LAMB_BIRYANI"),3);
});
