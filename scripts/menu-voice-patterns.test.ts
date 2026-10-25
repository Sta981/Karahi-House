import test from "node:test";
import assert from "node:assert/strict";
import { MENU } from "../lib/menu";
import { newState, runTurn } from "../lib/dialog";
import { browsePool, MENU_CATEGORIES } from "../lib/menu-browsing";
import { speechText } from "../lib/speech";
const seed=(...texts:string[])=>texts.reduce((state,text)=>runTurn(state,text).state,newState());

test("category browsing uses menu names and integer-cent prices without ordering",()=>{
 for(const [key,words] of Object.entries({desserts:["dessert","deserts","sweets","mithai"],drinks:["beverage","beverages","cold drinks"],breads:["bread","naan"],rice:["rice"],kids:["kids"],starters:["starters"],bbq:["BBQ"],vegetarian:["veg","vegetarian"]})){
  for(const word of words){const result=runTurn(newState(),`could you show the ${word} options please`),pool=browsePool(key),offered=pool.filter(item=>result.reply.includes(item.name));
   assert.ok(offered.length>=3&&offered.length<=5,`${word}: ${result.reply}`);
   for(const item of offered)assert.ok(result.reply.includes(`$${(item.price_cents/100).toFixed(2)}`));
   assert.match(result.reply,/Want more\?$/);assert.equal(result.state.cart.length,0);assert.ok(!result.state.needsReview);
  }
 }
});
test("full menu returns categories; browsing more preserves the cart and changes suggestions",()=>{
 const full=runTurn(newState(),"show your entire menu please");for(const category of MENU_CATEGORIES)assert.ok(full.reply.includes(category));assert.doesNotMatch(full.reply,/\$/);
 const initial=seed("two onion naan"),first=runTurn(initial,"any sweet options tonight"),second=runTurn(first.state,"yes please");
 assert.deepEqual(first.state.cart,initial.cart);assert.deepEqual(second.state.cart,initial.cart);assert.notEqual(first.reply,second.reply);
 assert.ok(browsePool("desserts").some(item=>first.reply.includes(item.name)));
 const direct=runTurn(newState(),"one rice");assert.equal(direct.state.cart[0]?.itemId,"RICE");assert.equal(runTurn(newState(),"garlic naan").state.cart[0]?.itemId,"GARLIC_NAAN_BREAD");
 const riceBrowse=runTurn(full.state,"rice");assert.equal(riceBrowse.state.cart.length,0);assert.equal(riceBrowse.state.browsing?.key,"rice");assert.match(riceBrowse.reply,/Want more/);
 assert.equal(runTurn(riceBrowse.state,"one rice").state.cart[0]?.itemId,"RICE");
});
test("garbled browsing never flags staff review or inserts food",()=>{
 let state=newState();for(let i=0;i<5;i++){const result=runTurn(state,`show menu options in zorb ${i}`);state=result.state;assert.ok(!state.needsReview);assert.equal(state.cart.length,0);assert.doesNotMatch(result.reply,/staff review|No items added|Let me clarify/);}
});
test("goodbyes close an empty call but cannot bypass order choices or read-back",()=>{
 for(const ending of ["goodbye for now","bye bye","please end this call","that's it thank you"]){
  const empty=runTurn(newState(),ending);assert.equal(empty.endCall,true);assert.equal(empty.state.phase,"closed");
  const full=runTurn(seed("two lamb biryani"),ending);assert.equal(full.state.phase,"ask_spice");assert.ok(!full.endCall);assert.equal(full.state.cart[0]?.qty,2);
 }
 let state=seed("a fish pakora","checkout","mild");assert.equal(state.phase,"ask_name");assert.equal(runTurn(state,"goodbye").state.customerName,undefined);
});
test("context repairs cannot rewrite ordinary words or customer names",()=>{
 assert.equal(runTurn(newState(),"add two ganina please").state.cart[0]?.itemId,"GARLIC_NAAN_BREAD");
 assert.equal(speechText("my name is Ganina"),"my name is ganina");
 const food=runTurn(newState(),"white please"),goat=runTurn(food.state,"got please");assert.equal(goat.state.pending?.itemId,"GOAT_WHITE_KARAHI");
 const half=runTurn(goat.state,"bot");assert.equal(half.state.cart[0]?.size,"Half");
 assert.equal(runTurn(newState(),"bot").state.cart.length,0);assert.equal(runTurn(newState(),"got").state.cart.length,0);
 const browse=runTurn(newState(),"what you have in barracks please");assert.ok(browsePool("desserts").every(item=>browse.reply.includes(item.name)));
 assert.ok(!runTurn(newState(),"barracks").state.browsing);assert.equal(runTurn(newState(),"anything in suite please").state.browsing?.key,"desserts");
});
test("no boilerplate prefixes or identical consecutive suggestions",()=>{
 let state=newState(),previous="";for(let i=0;i<4;i++){const result=runTurn(state,"can you get chicken vindaloo please");assert.doesNotMatch(result.reply,/No items added|Let me clarify/);assert.notEqual(result.reply,previous);previous=result.reply;state=result.state;}
 assert.equal(state.cart.length,0);
});
test("staff review needs allergy intent, a requested person or three failures",()=>{
 assert.ok(runTurn(newState(),"I am allergic to sesame").state.needsReview);
 assert.ok(runTurn(newState(),"connect me to a manager please").state.needsReview);
 assert.ok(!runTurn(newState(),"which desserts contain dairy").state.needsReview);
 let state=newState();for(let i=0;i<2;i++){state=runTurn(state,"zorb zorp glorp").state;assert.ok(!state.needsReview);}
});
