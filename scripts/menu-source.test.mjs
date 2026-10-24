import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadVersion } from "./lib/load-version.mjs";
import { CURRENT_TEXT_CASES, CURRENT_MESSY_CASES, CURRENT_SIMULATED_CASES } from "../eval/menu-current-cases.mjs";
import { TEXT_CASES } from "../eval/text-cases.mjs";
const api=loadVersion();
const offline={provider:null,onRouting:()=>{}};
const turn=(state,text)=>api.runSmartTurn(state,text,[],offline);
const source=JSON.parse(readFileSync("lib/menu-source.json","utf8"));

test("only the final source defines 84 items, prices and verbatim IDs; the original text corpus remains frozen",()=>{
  const baseline=JSON.parse(readFileSync("eval/results/text-baseline.json","utf8"));
  assert.equal(createHash("sha256").update(JSON.stringify(TEXT_CASES)).digest("hex"),baseline.corpusHash);
  assert.deepEqual(api.MENU.map(({aliases,...item})=>item),source.items);
  assert.deepEqual(api.MENU_VALIDATION,{items:84,uniqueIds:84,sizedItems:13,spiceItems:66,integerCentPrices:84,spiceOptions:5,unverifiedSizes:6});
  assert.equal(api.MENU_SOURCE_SHA256,createHash("sha256").update(readFileSync("lib/menu-source.json")).digest("hex"));
  assert.equal(api.RESTAURANT.menuApproved,true);
  assert.equal(api.RESTAURANT.phone,"(415) 466-8839");
  assert.equal(api.RESTAURANT.address,"1409 Polk Street, San Francisco, CA 94109");
  assert.equal(api.RESTAURANT.hoursNeedsReview,true);
  assert.equal(api.getItem("CHAI"),undefined);
  assert.equal(api.getItem("FISH_KARAHI").price_cents,2100);
  assert.equal(api.getItem("DESI_CHICKEN").size,undefined);
});
test("load validation rejects duplicate identities and invalid prices/modifier counts",()=>{
  const bad=change=>{const copy=structuredClone(source);change(copy);assert.throws(()=>api.validateMenu(copy),/Invalid final menu/);};
  bad(copy=>copy.items[0].id=copy.items[1].id);
  bad(copy=>copy.items[0].price_cents=24.50);
  bad(copy=>copy.items[0].size.Full=18.5);
  bad(copy=>copy.items[0].spice=false);
  bad(copy=>copy.modifiers.spice_level.options.pop());
});
test("every size is priced from integer cents and its data-defined surcharge",()=>{
  for(const item of api.MENU){
    assert.ok(Number.isSafeInteger(item.price_cents));
    if(item.size){
      assert.equal(api.unitPriceCents(item,"Half"),item.price_cents);
      assert.equal(api.unitPriceCents(item,"Full"),item.price_cents+item.size.Full);
      assert.throws(()=>api.unitPriceCents(item),/Size required/);
    }else{ assert.equal(api.unitPriceCents(item),item.price_cents);assert.throws(()=>api.unitPriceCents(item,"Full"),/no size/); }
  }
});
test("new aliases and website names refer only to live IDs",()=>{
  for(const [text,id] of [["chicken sick cabob","CHICKEN_SEEKH_KABAB"],["chikan biriyani","CHICKEN_BIRYANI"],
    ["mango lasi","MANGO_LASSI"],["daal makhni","DAL_MAKHANI"],["papad","PAPADAM"],["Rita","RAITA"],
    ["Galub Jamum","GULAB_JAMUN"],["Fish Tikka Masalas","FISH_TIKKA_MASALA"]]) assert.equal(api.matchUtterance(text)[0]?.itemId,id,text);
  for(const row of [...CURRENT_TEXT_CASES,...CURRENT_SIMULATED_CASES]) for(const item of row.expected?.items??row.items??[]) assert.ok(api.getItem(item.itemId),row.id);
  assert.equal(CURRENT_TEXT_CASES.length,100);assert.equal(CURRENT_SIMULATED_CASES.length,20);assert.equal(CURRENT_MESSY_CASES.length,10);
});
test("all final source canonical and website names resolve to their own IDs",()=>{
  for(const item of source.items)for(const label of [item.name,item.website_name].filter(Boolean)) {
    assert.equal(api.matchUtterance(label)[0]?.itemId,item.id,label);
  }
});
test("bare families, partial names and close typo scores cannot mutate the cart",async()=>{
  for(const text of ["karahi","tikka","seekh kabab","chicken Kirby","paneer tikka","two garlik naan","mutton biryani"]){
    const result=await turn(undefined,text);
    assert.equal(result.state.cart.length,0,text);
    assert.ok(result.state.recognition,text);
  }
  const ambiguous=await turn(undefined,"two garlik naan");
  const yes=await turn(ambiguous.state,"yes");
  assert.equal(yes.state.cart.length,0);
  const named=await turn(ambiguous.state,"garlic naan");
  assert.equal(named.state.cart[0].qty,2);
});
test("one order spice choice applies to current and future items while overrides survive",async()=>{
  let result=await turn(undefined,"one chicken biryani and two garlic naan");
  assert.equal(result.state.phase,"ask_spice");
  result=await turn(result.state,"Mild Spice");
  assert.ok(result.state.cart.every(line=>line.spiceLevel==="Mild Spice"));
  result=await turn(result.state,"make the chicken biryani extra spicy");
  assert.equal(result.state.cart.length,2);
  assert.equal(result.state.cart[0].spiceLevel,"Extra Spicy");
  result=await turn(result.state,"Medium Spice for the whole order");
  assert.equal(result.state.cart[0].spiceLevel,"Extra Spicy");
  assert.equal(result.state.cart[1].spiceLevel,"Medium Spice");
  result=await turn(result.state,"one roti");
  assert.equal(result.state.cart[2].spiceLevel,"Medium Spice");
  assert.equal(result.state.phase,"open");
});
test("sides, beverages, kids and desserts never get a spice modifier",async()=>{
  let result=await turn(undefined,"one mango lassi and one gulab jamun");
  assert.equal(result.state.phase,"open");
  result=await turn(result.state,"Spicy");
  assert.ok(result.state.cart.every(line=>line.spiceLevel===undefined));
});
test("hot requires a choice and cannot silently become a spice level",async()=>{
  let result=await turn(undefined,"one hot chicken biryani");
  assert.match(result.reply,/Spicy or Extra Spicy/);
  assert.equal(result.state.cart[0].spiceLevel,undefined);
  result=await turn(result.state,"Extra Spicy");
  assert.equal(result.state.cart[0].spiceLevel,"Extra Spicy");
  let ambiguous=await turn(undefined,"one hot garlik naan without green onions");
  ambiguous=await turn(ambiguous.state,"garlic naan");
  assert.match(ambiguous.reply,/Spicy or Extra Spicy/);
  assert.match(ambiguous.state.cart[0].notes.join(),/green onions/);
});
test("multiple missing sizes remain queued and notes survive each clarification",async()=>{
  let result=await turn(undefined,"one chicken lahori karahi without green onions and one goat white karahi");
  assert.equal(result.state.pending.itemId,"CHICKEN_LAHORI_KARAHI");
  assert.equal(result.state.queued.length,1);
  result=await turn(result.state,"Half");
  assert.equal(result.state.pending.itemId,"GOAT_WHITE_KARAHI");
  assert.match(result.state.cart[0].notes.join(),/green onions/);
  result=await turn(result.state,"Full");
  assert.equal(result.state.cart.length,2);
  assert.equal(result.state.cart[1].unitPriceCents,4200);
  assert.equal(result.state.cart[1].sizeVerified,false);
  assert.equal(result.state.phase,"ask_spice");
});
test("Desi Chicken has no inferred size; a requested size requires acknowledgment",async()=>{
  const standard=await turn(undefined,"one desi chicken");
  assert.equal(standard.state.cart[0].itemId,"DESI_CHICKEN");
  assert.equal(standard.state.cart[0].unitPriceCents,4000);
  const full=await turn(undefined,"one full desi chicken");
  assert.equal(full.state.cart.length,0);
  assert.match(full.reply,/no Half\/Full/);
  const yes=await turn(full.state,"yes");
  assert.equal(yes.state.cart[0].size,undefined);
});
test("quantity corrections replace, do not append, and totals ignore stale cached prices",async()=>{
  let result=await turn(undefined,"one garlic naan");
  result=await turn(result.state,"Mild Spice");
  result=await turn(result.state,"no, make it two");
  assert.equal(result.state.cart.length,1);assert.equal(result.state.cart[0].qty,2);
  result=await turn(result.state,"no, make it three garlic naan");
  assert.equal(result.state.cart.length,1);assert.equal(result.state.cart[0].qty,3);
  result.state.cart[0].unitPriceCents=1;result.state.cart[0].unitPrice=0.01;
  assert.equal(api.cartTotalCents(result.state.cart),1197);
});
test("unavailable dishes offer live suggestions with no substitution",async()=>{
  for(const text of ["chapli kabab","vegetable pakora","pepperoni pizza","okra masala","one chai","one whole chicken karahi","chicken jalfrezi","butter chicken"]){
    const result=await turn(undefined,text);
    assert.equal(result.state.cart.length,0,text);
    const issue=result.state.recognition.issues[0];
    assert.equal(issue.kind,"unavailable",text);
    assert.ok(issue.candidates.length>0,text);
    for(const candidate of issue.candidates)assert.ok(api.getItem(candidate.itemId));
  }
});
test("allergy review and callback privacy stay local",async()=>{
  const result=await turn(undefined,"one chicken biryani, peanut allergy");
  assert.equal(result.state.needsReview,true);assert.equal(result.state.cart.length,0);
  const events=[];const phone=[415,555,1234].join("");
  const callback=await api.runSmartTurn(result.state,`my callback number is ${phone}`,[],{provider:null,onRouting:event=>events.push(event)});
  assert.equal(callback.reply.includes(phone),false);assert.equal(JSON.stringify(events).includes(phone),false);
  assert.equal(callback.state.notes.join().includes(phone),false);
});
test("read-back includes modifiers and notes before a pending-acceptance demo ticket",async()=>{
  let result=await turn(undefined,"two full chicken lahori karahi without green onions");
  result=await turn(result.state,"No Spice");
  result=await turn(result.state,"that will be all");
  result=await turn(result.state,"Ahmed");
  assert.equal(result.state.phase,"confirm");
  assert.match(result.reply,/Full.*No Spice.*green onions/);
  assert.match(result.reply,/\$72\.00/);
  assert.equal(result.summary,undefined);
  result=await turn(result.state,"yes");
  assert.equal(result.summary.status,"pending_acceptance");
  assert.equal(result.summary.subtotalCents,7200);
  assert.equal(result.summary.menuApproved,true);
});
test("LLM remains display-only and rejects numeric/order claims",async()=>{
  for(const say of ["The price is $3.99.","Your order is accepted.","Added two naan."]){
    const result=await api.runSmartTurn(undefined,"what do you recommend",[],{provider:{completeJson:async()=>JSON.stringify({say})},onRouting:()=>{}});
    assert.equal(result.usedLLM,false);assert.equal(result.state.cart.length,0);assert.equal(result.routing.outcome,"rejected_reply");
  }
});
