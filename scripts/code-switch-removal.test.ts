import test from "node:test";
import assert from "node:assert/strict";
import {newState,runTurn,type DialogState} from "../lib/dialog";
import {runSmartTurn} from "../lib/brain";
import {normalizeCodeSwitch} from "../lib/code-switch";
import {planLocalCorrection} from "../lib/order-operations";
import {replayCartOperations} from "../lib/cart-journal";
import {VoiceSession} from "../voice/session";
import {sttUrl} from "../voice/stt";
import {runtimeInfo} from "../voice/runtime-info";
import {endpointSettings} from "../voice/endpointing";
import type {Tts} from "../voice/contracts";
const call=(...phrases:string[])=>{let result=runTurn(newState(),phrases[0]);for(const text of phrases.slice(1))result=runTurn(result.state,text);return result;};
const count=(state:DialogState,id:string)=>state.cart.filter(line=>line.itemId===id).reduce((sum,line)=>sum+line.qty,0);

test("unspecified removal asks one or both; yes alone never authorizes both",()=>{
 const before=call("two mango lassi").state,r=runTurn(before,"please delete the mango lassi");
 assert.deepEqual(r.state.cart,before.cart);assert.match(r.reply,/one or both Mango Lassi/);assert.ok(r.state.removalQuantity);
 const yes=runTurn(r.state,"yes");assert.deepEqual(yes.state.cart,before.cart);assert.ok(yes.state.removalQuantity);
 const one=runTurn(yes.state,"only one please");assert.equal(count(one.state,"MANGO_LASSI"),1);assert.match(one.reply,/Removed 1 Mango Lassi, 1 left/);
 const both=runTurn(r.state,"both please");assert.equal(count(both.state,"MANGO_LASSI"),0);assert.match(both.reply,/Removed 2 Mango Lassi, 0 left/);
});
test("removal counts cover equivalent lines but never conflate different modifiers",()=>{
 const r=call("one mango lassi and one mango lassi","delete mango lassi");assert.equal(r.state.removalQuantity?.available,2);
 const one=runTurn(r.state,"one");assert.equal(count(one.state,"MANGO_LASSI"),1);
 const modified=call("one chicken biryani mild and one chicken biryani spicy","remove chicken biryani");assert.ok(modified.state.pendingCorrection);assert.equal(modified.state.removalQuantity,undefined);assert.match(modified.reply,/Mild Spice.*Spicy/);
});
test("quantity uncertainty cannot erase or increase cart contents and exact counts replay",()=>{
 for(let qty=2;qty<=7;qty++){
  const state=call(`${qty} mango lassi and one rice`).state,r=runTurn(state,"remove mango lassi");assert.deepEqual(r.state.cart,state.cart);
  for(const answer of ["yes","switch to chicken boti","add one rice","both"]){const next=runTurn(r.state,answer);if(answer!=="both"||qty!==2)assert.deepEqual(next.state.cart,state.cart);assert.deepEqual(replayCartOperations(r.state.cart,next.operations??[]),next.state.cart);}
  const next=runTurn(r.state,`${qty-1}`);assert.equal(count(next.state,"MANGO_LASSI"),1);assert.equal(count(next.state,"RICE"),1);assert.deepEqual(replayCartOperations(r.state.cart,next.operations??[]),next.state.cart);
 }
});
test("cancellation, price questions and stale carts preserve a pending removal safely",()=>{
 const r=call("three mango lassi","remove mango lassi"),no=runTurn(r.state,"no");assert.equal(count(no.state,"MANGO_LASSI"),3);assert.equal(no.state.removalQuantity,undefined);
 const price=runTurn(r.state,"what is the total");assert.deepEqual(price.state.cart,r.state.cart);assert.ok(price.state.removalQuantity);assert.match(price.reply,/subtotal.*Remove one or all 3/);
 const stale=structuredClone(r.state);stale.cart[0].qty=4;const next=runTurn(stale,"one");assert.equal(count(next.state,"MANGO_LASSI"),4);assert.match(next.reply,/cart changed/);
});
test("negated removal never deletes and a later explicit one-item removal wins",()=>{
 assert.equal(count(call("two mango lassi","do not remove the mango lassi").state,"MANGO_LASSI"),2);
 assert.equal(count(call("two mango lassi","don't remove all remove one mango lassi").state,"MANGO_LASSI"),1);
 const plan=planLocalCorrection("remove mango lassi",[{itemId:"MANGO_LASSI",qty:2}])!;assert.equal(plan.entries[0].qty,2);assert.ok(plan.removalQuantity);
});
test("Roman Urdu and Punjabi ordering fillers retain exact quantities and item choices",()=>{
 for(const text of ["mainu do garlic naan deyo","mennu do garlic naan chahide","mujhe do garlic naan de dein"]){const r=call(text);assert.equal(count(r.state,"GARLIC_NAAN_BREAD"),2,text);}
 assert.equal(count(call("mainu tinn plain naan deyo").state,"PLAIN_NAAN_BREAD"),3);
 assert.equal(count(call("mainu ikk mango lassi deyo").state,"MANGO_LASSI"),1);
 assert.equal(count(call("one lamb biryani for me").state,"LAMB_BIRYANI"),1);
 assert.equal(call("do you have rice").state.cart.length,0);
});
test("small native-script ordering vocabulary works without dropping unknown words",()=>{
 for(const text of ["मुझे दो garlic naan चाहिए","مجھے دو garlic naan دیں","ਮੈਨੂੰ ਦੋ garlic naan ਦਿਓ"]){assert.equal(count(call(text).state,"GARLIC_NAAN_BREAD"),2,text);}
 for(const digit of ["२","۲","٢","੨"]){assert.equal(count(call(`${digit} garlic naan`).state,"GARLIC_NAAN_BREAD"),2);}
 const dish=call("एक चिकन बिरयानी कम मिर्च");assert.equal(count(dish.state,"CHICKEN_BIRYANI"),1);assert.equal(dish.state.cart[0].spiceLevel,"Mild Spice");
 for(const text of ["अनजानविशेषण rice","ਅਣਪਛਾਤਾ rice","نامعلوم rice"]){const r=call(text);assert.equal(r.state.cart.length,0);assert.match(r.reply,/repeat.*English/);}
});
test("code-switched removal respects quantities, both and negation",()=>{
 let r=call("two garlic naan","garlic naan hata do");assert.ok(r.state.removalQuantity);r=runTurn(r.state,"ek");assert.equal(count(r.state,"GARLIC_NAAN_BREAD"),1);
 r=call("two garlic naan","garlic naan kadd deo","dono");assert.equal(count(r.state,"GARLIC_NAAN_BREAD"),0);
 r=call("two garlic naan","garlic naan mein se ek hata do");assert.equal(count(r.state,"GARLIC_NAAN_BREAD"),1);
 r=call("two garlic naan","garlic naan mat hata do");assert.equal(count(r.state,"GARLIC_NAAN_BREAD"),2);
 r=call("two garlic naan","na kadd deo garlic naan");assert.equal(count(r.state,"GARLIC_NAAN_BREAD"),2);
});
test("mixed size, spice, completion and browsing stay local with no dish inference",()=>{
 let r=call("mujhe aik lamb white karahi chahiye","aadha kam mirch");assert.equal(r.state.cart[0]?.size,"Half");assert.equal(r.state.cart[0]?.spiceLevel,"Mild Spice");
 r=call("one chicken biryani","aur kuch nahi");assert.equal(r.state.phase,"ask_spice");r=runTurn(r.state,"bilkul mirch nahi");assert.equal(r.state.cart[0].spiceLevel,"No Spice");
 const menu=call("मिठाई में क्या है");assert.equal(menu.state.cart.length,0);assert.match(menu.reply,/Gulab Jamun.*Kheer/);
 assert.equal(normalizeCodeSwitch("my name is Mainu").text,"my name is Mainu");assert.equal(normalizeCodeSwitch("Mainu",true).text,"Mainu");
});
test("smart voice entrypoint uses the same normalized analysis and never needs a model",async()=>{
 let calls=0;const provider={async completeJson(){calls++;throw Error("must stay local");}};
 for(const text of ["mainu do garlic naan deyo","एक चिकन बिरयानी कम मिर्च","अनजानविशेषण rice"]){const r=await runSmartTurn(newState(),text,[],{provider,onRouting:()=>{}});assert.equal(r.usedLLM,false);assert.ok(text.includes("अनजान")?r.state.cart.length===0:r.state.cart.length===1);}
 assert.equal(calls,0);
});
test("Nova multilingual sends English/Hindi hints only and runtime provenance agrees",()=>{
 for(const model of ["flux","nova-3","nova-3-en-IN"] as const){const url=new URL(sttUrl(model));const expected=model==="nova-3"?["en","hi"]:[];assert.deepEqual(url.searchParams.getAll("language_hint"),expected);assert.deepEqual(runtimeInfo({commit:"a".repeat(40),dirty:false},model,endpointSettings(model),{provider:"fixture",model:"fixture"},1,800,"adaptive").sttConfig.languageHints,expected);}
});
test("quantity question supplies constrained endpoint answers and never invokes STT in tests",async()=>{
 const events:any[]=[],tts:Tts={name:"fixture",warm:async()=>{},close(){},async *speak(){yield Buffer.from([0,0]);}},session=new VoiceSession(tts,event=>events.push(event));
 try{await session.turn("two mango lassi");await session.turn("remove mango lassi");assert.ok(session.endpointAnswers().includes("both"));assert.ok(session.recognitionHints().includes("Mango Lassi"));assert.equal(events.filter(event=>event.type==="reply").at(-1).cart[0].qty,2);await session.turn("one");assert.equal(events.filter(event=>event.type==="reply").at(-1).cart[0].qty,1);}finally{session.close();}
});
