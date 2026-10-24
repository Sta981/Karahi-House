import test from "node:test";
import assert from "node:assert/strict";
import { newState,runTurn,cartTotalCents } from "../lib/dialog";
import { analyzeUtterance,closestMenuItems } from "../lib/matcher";
import { MENU } from "../lib/menu";
import { replayCartOperations } from "../lib/cart-journal";

function call(...turns:string[]){let state=newState(),result;for(const turn of turns){result=runTurn(state,turn);state=result.state;}return result!;}
test("unresolved compounds cannot extract one-word sides or desserts",()=>{
 for(const phrase of ["lamb creamy rice","beef special raita","chicken deluxe kheer","goat white papadam"]){
  const result=call(phrase);assert.equal(result.state.cart.length,0,phrase);assert.ok(result.state.recognition,phrase);assert.match(result.reply,/No items added/);
 }
});
test("one unavailable clause adds nothing; clear comma/conjunction clauses are read back",()=>{
 for(const separator of [" and ",", "," aur "]){
  const result=call(`one mango lassi${separator}vegetable pakoda rice`);
  assert.deepEqual(result.state.cart.map(line=>line.itemId),["MANGO_LASSI"]);assert.match(result.reply,/Added 1 Mango Lassi/);assert.ok(!result.state.cart.some(line=>line.name==="Rice"));
 }
});
test("notes cannot exempt an unresolved food compound from the safety boundary",()=>{
 assert.equal(call("lamb fancy rice without onions").state.cart.length,0);
 assert.equal(call("one rice on the side").state.cart.length,1);
});
test("removal uses the current cart, tolerates noise and reads removed quantity",()=>{
 const result=call("one mango lassi and three garlic naan mild spice","remove the garlic now please");
 assert.deepEqual(result.state.cart.map(line=>line.itemId),["MANGO_LASSI"]);assert.match(result.reply,/Removed 3 Garlic Naan/);
});
test("tied removal names enumerate cart lines; a later partial answer removes only its target",()=>{
 let result=call("two garlic naan and one plain naan mild spice","remove naan");
 assert.equal(result.state.cart.length,2);assert.match(result.reply,/You have.*Garlic Naan.*Plain Naan/);
 result=runTurn(result.state,"garlic please");assert.equal(result.state.cart.length,1);assert.match(result.reply,/Removed 2 Garlic Naan/);
 const uncertain=call("one garlic naan mild spice and one mango lassi","remove the garlic coconut dish");assert.equal(uncertain.state.cart.length,2);assert.ok(uncertain.state.pendingCorrection);assert.match(uncertain.reply,/You have/);
});
test("pending size accepts constrained STT answers; those words do not create dishes",()=>{
 for(const [heard,size]of [["haf please","Half"],["fool please","Full"],["have","Half"]]){
  const result=call("one goat white karahi",heard);assert.equal(result.state.cart[0]?.size,size);assert.match(result.reply,new RegExp(size));
 }
 let repeated=call("one lamb white karahi","lamb white karahi please");assert.equal(repeated.state.queued?.length??0,0);assert.equal(repeated.state.cart.length,0);
 repeated=runTurn(repeated.state,"full medium spice");assert.equal(repeated.state.cart.length,1);assert.equal(repeated.state.pending,undefined);
 const mixed=call("one goat white karahi","goat white karahi and a mango lassi");assert.equal(mixed.state.queued?.length??0,0);assert.deepEqual(mixed.state.cart.map(line=>line.itemId),["MANGO_LASSI"]);assert.equal(mixed.state.pending?.itemId,"GOAT_WHITE_KARAHI");
});
test("price and subtotal questions preserve pending size and recognition",()=>{
 let result=call("two lamb white karahi","what does lamb white karahi cost");
 assert.equal(result.state.pending?.qty,2);assert.match(result.reply,/Half \$.*Full \$.*Half or Full/);
 result=runTurn(result.state,"full no spice");const cents=cartTotalCents(result.state.cart);
 result=runTurn(result.state,"tell me the subtotal");assert.ok(result.reply.includes(`$${(cents/100).toFixed(2)}`));
 const clarification=call("one gulab","how much does it cost");assert.ok(clarification.state.recognition);assert.match(clarification.reply,/Gulab Jamun.*\$/);
});
test("pending spice and yes/no are constrained without globally repairing food words",()=>{
 let result=call("one chicken biryani","spicey");assert.equal(result.state.cart[0]?.spiceLevel,"Spicy");
 result=call("one gulab","yeas");assert.equal(result.state.cart[0]?.itemId,"GULAB_JAMUN");
 result=call("one mango lassi","checkout","Test Customer","yess");assert.equal(result.state.phase,"confirm");assert.equal(result.state.answerConfirmation?.kind,"yesno");assert.match(result.reply,/Did you mean yes/);assert.equal(result.state.cart.length,1);
 assert.equal(call("fool").state.cart.length,0);
});
test("misses never repeat an identical reply and eventually offer real categories",()=>{
 let state=call("one lamb white karahi").state;const replies=[];
 for(const utterance of ["pardon me","i cannot decide","could you explain"]){const result=runTurn(state,utterance);replies.push(result.reply);state=result.state;}
 for(let i=1;i<replies.length;i++)assert.notEqual(replies[i],replies[i-1]);assert.ok(replies.some(reply=>reply.includes("Menu categories:")),JSON.stringify(replies));
});
test("phonetic dish evidence outranks an unrelated shared protein",()=>{
 const suggestions=closestMenuItems("lamb keema",5);assert.ok(suggestions[0].name.toLowerCase().includes("keema"));
 const analysis=analyzeUtterance("chicken curry please");assert.match(analysis.issues[0]?.question??"",/karahi.*tikka masala.*korma/i);
 assert.ok(suggestions.every(item=>MENU.some(real=>real.id===item.id)));
});
test("cart journals replay after clause clarification and partial removal",()=>{
 let state=newState();for(const text of ["one mango lassi and lamb cloudy rice","no","three garlic naan mild spice","remove one garlic now"]){
  const result=runTurn(state,text);assert.deepEqual(replayCartOperations(state.cart,result.operations!),result.state.cart);state=result.state;
 }
});
