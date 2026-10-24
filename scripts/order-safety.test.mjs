import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadVersion } from "./lib/load-version.mjs";
import { scoreSeparate } from "./lib/separate-metrics.mjs";
const api=loadVersion();
const offline={provider:null,onRouting:()=>{}};
const turn=(state,text)=>api.runSmartTurn(state,text,[],offline);
test("competing overlapping names clarify without changing either item or quantity",async()=>{
  for(const text of ["two garlik naan","do garlik naan aur aik mango lassi"]){
    const clear=text.includes("lassi")?1:0;
    const first=await turn(undefined,text);assert.equal(first.state.cart.length,clear);assert.equal(first.state.recognition.issues[0].reason,"low_margin");
    const unclear=await turn(first.state,"yes");assert.equal(unclear.state.cart.length,clear);
    const named=await turn(first.state,"garlic naan");assert.equal(named.state.cart.find(c=>c.itemId==="GARLIC_NAAN_BREAD").qty,2);
    assert.equal(named.state.cart.some(c=>c.itemId==="PLAIN_NAAN_BREAD"),false);
  }
});
test("quantity corrections replace the last or named line and invalidate checkout recap",async()=>{
  let result=await turn(undefined,"one half chicken lahori karahi and one garlic naan");
  result=await turn(result.state,"Mild Spice");result.state.phase="confirm";
  result=await turn(result.state,"no, make it two");assert.deepEqual(result.state.cart.map(c=>c.qty),[1,2]);assert.equal(result.state.phase,"open");assert.equal(result.summary,undefined);
  result=await turn(result.state,"no, make it three garlic naan");assert.deepEqual(result.state.cart.map(c=>c.qty),[1,3]);assert.equal(result.state.cart.length,2);
});
test("invalid and uncertain corrections cannot add or silently retarget items",async()=>{
  const first=await turn(undefined,"one garlic naan Mild Spice");
  for(const text of ["no, make it zero","no, make it 51","no, make it two pizza","no, make it two garlik naan"]){
    const result=await turn(first.state,text);assert.deepEqual(result.state.cart,JSON.parse(JSON.stringify(first.state.cart)),text);assert.equal(result.routing.route,"local");
  }
});
test("all six previous fallbacks are local and callback values are absent from logs and replies",async()=>{
  const logs=[],original=console.info;console.info=value=>logs.push(String(value));
  try{
    const phone=[415,555,1234].join("");
    for(const text of ["hello there","thank you very much","my name is Ahmed",`my callback number is ${phone}`,"is pickup available","that will be all thanks"]){
      const result=await api.runSmartTurn(undefined,text,[],{provider:null,onRouting:api.recordTurn});assert.equal(result.routing.route,"local");assert.equal(result.reply.includes(phone),false);
      if(text.includes("callback"))assert.ok(result.state.callbackNumber===phone,"Callback captured privately");
    }
    assert.equal(logs.length,6);assert.equal(logs.join().includes(phone),false);
    const mixed=await turn(undefined,`I have an allergy; my callback number is ${phone}`);assert.equal(mixed.state.needsReview,true);assert.equal(mixed.state.notes.join().includes(phone),false);
    assert.equal(api.buildLlmRequest(`question including ${phone}`,api.newState(),[]).user.includes(phone),false);
    assert.doesNotMatch(readFileSync("app/api/voice/respond/route.ts","utf8"),/console\.log\([^\n]*(?:callbackNumber|\.\.\.result\.summary)/);
  }finally{console.info=original;}
});
test("model replies with digits, currency, spelled-out quantities or order claims are rejected",async()=>{
  for(const say of ["It costs $5.","The total is five dollars.","I added two naan.","Your order is accepted.","It is on its way.","Your food will arrive soon.","Here are ２ naan.","Here are ٢ naan.","A dozen naan."])assert.equal(api.parseLlmReply(JSON.stringify({say})),null);
  for(const say of api.GAP_REPLIES)assert.equal(api.parseLlmReply(JSON.stringify({say})),say);
});
test("separate metrics distinguish wrong dish from wrong quantity",()=>{
  const expected=[{itemId:"GARLIC_NAAN_BREAD",qty:2,protein:null,portion:null}];
  assert.deepEqual(scoreSeparate(expected,[{itemId:"PLAIN_NAAN_BREAD",qty:2}]),{dish:false,quantity:true,joint:false});
  assert.deepEqual(scoreSeparate(expected,[{itemId:"GARLIC_NAAN_BREAD",qty:1}]),{dish:true,quantity:false,joint:false});
  assert.deepEqual(scoreSeparate(expected,[]),{dish:false,quantity:false,joint:false});
});
