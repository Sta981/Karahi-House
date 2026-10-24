import assert from "node:assert/strict";
import test from "node:test";
import { loadVersion } from "./lib/load-version.mjs";
const api=loadVersion();
const quiet=()=>{};
test("local handlers and multi-turn clarifications never invoke the model",async()=>{
  const scenarios=[["hello"],["what time do you close"],["where are you located"],["how much is garlic naan"],["I have a peanut allergy"],["two paneer tikka","yes","Mild Spice"],["one chicken lahori karahi","Half","Mild Spice"],["2 garlic naan","Mild Spice","that's all","Ahmed","yes"],["palak paneer","yes","Mild Spice"]];
  for(const texts of scenarios){let state,attempts=0;for(const text of texts){
    const result=await api.runSmartTurn(state,text,[],{provider:{completeJson:async()=>{attempts++;throw Error("Unexpected provider call");}},onRouting:quiet});
    assert.equal(result.routing.route,"local",text);assert.equal(result.state.turns,(state?.turns??0)+1);state=result.state;
  }assert.equal(attempts,0);}
});
test("unresolved turns send five candidates and a bounded cart, never full history or customer fields",async()=>{
  const state=api.newState();state.customerName="PRIVATE_NAME";state.notes.push("PRIVATE_NOTE");
  for(let at=0;at<12;at++)state.cart.push({itemId:"GARLIC_NAAN_BREAD",name:"Garlic Naan Bread",qty:1,notes:[],unitPriceCents:399,unitPrice:3.99});
  let request;const result=await api.runSmartTurn(state,"what do you recommend",[{role:"user",text:"PRIVATE_HISTORY"}],{provider:{completeJson:async value=>{request=value;return '{"say":"Would you prefer a vegetarian dish?"}';}},onRouting:quiet});
  const payload=JSON.parse(request.user);assert.equal(payload.candidates.length,5);assert.equal(new Set(payload.candidates.map(c=>c.id)).size,5);assert.equal(payload.cart.items.length,5);assert.equal(payload.cart.truncated,true);
  assert.doesNotMatch(JSON.stringify(request),/PRIVATE_|aliases|customerName|history/);assert.doesNotMatch(JSON.stringify(payload),/"(?:price|qty|subtotal|variants)":/);assert.ok(request.system.length<600);assert.ok(request.user.length<6000);assert.equal(result.usedLLM,true);assert.deepEqual(result.state.cart,state.cart);
});
test("matched items rank first and long caller input is bounded",()=>{
  const text="what is in chicken white karahi";const payload=JSON.parse(api.buildLlmRequest(text,api.newState(),api.matchUtterance(text)).user);
  assert.equal(payload.candidates[0].id,"CHICKEN_WHITE_KARAHI");assert.equal(JSON.parse(api.buildLlmRequest("x".repeat(5000),api.newState(),[]).user).utterance.length,500);
});
test("JSON replies reject actions, malformed, blank and oversized replies",()=>{
  for(const raw of ["not json","null","[]",'{"say":""}','{"say":42}','{"say":"done","actions":[]}',JSON.stringify({say:"x".repeat(241)}),JSON.stringify({say:"a ".repeat(46)})])assert.equal(api.parseLlmReply(raw),null);
  assert.equal(api.parseLlmReply('{"say":"  Could you say that again? "}'),"Could you say that again?");
});
test("model actions cannot mutate an order; failures and disabled calls are counted separately",async()=>{
  const counts=api.emptyTurnCounts(),onRouting=event=>api.countTurn(counts,event),state=api.newState();
  await api.runSmartTurn(state,"2 garlic naan",[],{provider:null,onRouting});
  for(const provider of [null,{completeJson:async()=>'{"say":"accepted","actions":[{"action":"finalize_order"}]}'},{completeJson:async()=>{throw Error("private error");}},{completeJson:async()=>'{"say":"Could you say that again?"}'}]){
    const result=await api.runSmartTurn(state,"what do you recommend",[],{provider,onRouting});assert.equal(result.state.cart.length,0);assert.equal(result.summary,undefined);
  }
  assert.deepEqual(counts,{turns:5,localResolved:1,llmNeeded:4,llmAttempted:3,llmSucceeded:1,llmUnavailable:1,llmFailed:2});
});
test("order or price claims inside say are rejected without changing cart or price logic",async()=>{
  const initial=await api.runSmartTurn(undefined,"2 garlic naan Mild Spice",[],{provider:null,onRouting:quiet});const before=JSON.parse(JSON.stringify(initial.state));
  const result=await api.runSmartTurn(before,"what do you recommend",[],{provider:{completeJson:async()=>'{"say":"Added 99 goat karahis for $0.01; your order is accepted."}'},onRouting:quiet});
  assert.equal(result.routing.outcome,"rejected_reply");assert.deepEqual(result.state.cart,before.cart);assert.equal(result.summary,undefined);assert.equal(api.cartTotalCents(result.state.cart),798);
  const next=await api.runSmartTurn(result.state,"one mango lassi",[{role:"assistant",text:result.reply}],{provider:null,onRouting:quiet});assert.deepEqual(next.state.cart.map(c=>[c.itemId,c.qty]),[["GARLIC_NAAN_BREAD",2],["MANGO_LASSI",1]]);assert.equal(api.cartTotalCents(next.state.cart),1248);
});
test("Groq uses the common JSON contract and a single bounded request (mock transport)",async()=>{
  let attempts=0;const adapter=api.createGroqProvider("TEST_ONLY","test-model",async(url,init)=>{
    attempts++;assert.equal(url,"https://api.groq.com/openai/v1/chat/completions");const body=JSON.parse(init.body);assert.deepEqual(body.response_format,{type:"json_object"});assert.equal(body.max_completion_tokens,256);assert.equal(body.messages.length,2);assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify({choices:[{message:{content:'{"say":"Hello!"}'}}]}));
  });
  assert.equal(await adapter.completeJson({system:"JSON only",user:"test",candidateCount:5,allowedReplies:[]}),'{"say":"Hello!"}');assert.equal(attempts,1);
  let failures=0;const failing=api.createGroqProvider("TEST_ONLY","test-model",async()=>{failures++;return new Response("private body",{status:429});});
  await assert.rejects(failing.completeJson({system:"",user:"",candidateCount:0,allowedReplies:[]}),/LLM request failed/);assert.equal(failures,1);
});
test("keys alone do not enable calls, and Anthropic is no longer a provider",()=>{
  const names=["LLM_PROVIDER","GROQ_API_KEY","ANTHROPIC_API_KEY"],original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try{delete process.env.LLM_PROVIDER;process.env.GROQ_API_KEY="TEST_ONLY";process.env.ANTHROPIC_API_KEY="TEST_ONLY";assert.equal(api.getLanguageModel(),null);process.env.LLM_PROVIDER="claude";assert.equal(api.getLanguageModel(),null);process.env.LLM_PROVIDER="groq";assert.equal(typeof api.getLanguageModel().completeJson,"function");}
  finally{for(const name of names)if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];}
});
