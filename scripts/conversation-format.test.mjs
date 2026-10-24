// Schema/scorer unit tests use in-memory shape stubs, never held-out files.
import assert from "node:assert/strict";
import test from "node:test";
import { validateExpected, validateConversationFormat, scoreConversationTurn, candidateMatchesType, questionsMatch, standardPickupEtaOnly } from "./lib/conversation-eval.mjs";
const line={itemId:"ITEM",qty:1,size:null,spice:null,notes:[]};
const expected={disposition:"match",items:[line],cart:[],mustAsk:[{kind:"size",itemId:"ITEM",options:["Half","Full"]}],needsReview:false};
const api={getItem:()=>({spice:true}),MODIFIERS:{size:{options:["Half","Full"]},spice_level:{options:["Extra Spicy","Spicy","Medium Spice","Mild Spice","No Spice"]}}};
const result={reply:"<PROMPT>",matches:[{itemId:"ITEM",qty:1}],state:{phase:"ask_variant",pending:{itemId:"ITEM"},cart:[]}};
test("format v2 accepts explicit unset modifiers and an exact required-choice prompt",()=>{
  assert.doesNotThrow(()=>validateExpected(expected));assert.equal(scoreConversationTurn(expected,result,api).pass,true);
});
test("format v2 rejects missing modifiers, invalid sizes/spice and ambiguous old protein fields",()=>{
  for(const change of [value=>delete value.items[0].size,value=>value.items[0].size="Large",value=>value.items[0].spice="Hot",value=>value.items[0].protein="Paneer"]){
    const copy=structuredClone(expected);change(copy);assert.throws(()=>validateExpected(copy));
  }
});
test("format scoring catches a missing size question and a prematurely added item",()=>{
  const copy=structuredClone(result);copy.state.pending=undefined;copy.state.phase="open";copy.state.cart=[{itemId:"ITEM",qty:1,notes:[]}];
  const scored=scoreConversationTurn(expected,copy,api);assert.equal(scored.questions,false);assert.equal(scored.cart,false);assert.equal(scored.pass,false);
});
test("format scoring checks size and spice independently of correct dish and quantity",()=>{
  const wanted={...structuredClone(expected),items:[{...line,size:"Half",spice:"Mild Spice"}],cart:[{...line,size:"Half",spice:"Mild Spice"}],mustAsk:[]};
  const actual={reply:"<PROMPT>",matches:[{itemId:"ITEM",qty:1,portion:"full",spiceLevel:"Spicy"}],state:{phase:"open",cart:[{itemId:"ITEM",qty:1,size:"Full",spiceLevel:"Spicy",notes:[]}]}};
  const scored=scoreConversationTurn(wanted,actual,api);assert.equal(scored.dish,true);assert.equal(scored.quantity,true);assert.equal(scored.size,false);assert.equal(scored.spice,false);assert.equal(scored.joint,false);assert.equal(scored.pass,false);
});

// These are hand-built scorer inputs, not predictions or held-out utterances.
const typeItems=new Map([
  ["FISH",{name:"Fish Karahi"}], ["SHRIMP",{name:"Shrimp Karahi"}],
  ["MINCE",{name:"Beef Keema Karahi"}], ["BRAINS",{name:"Brains Karahi"}],
  ["PANEER",{name:"Karahi Paneer"}], ["SIZED",{name:"Goat White Karahi",size:{Half:0,Full:1}}],
  ["DESI",{name:"Desi Chicken",category:"White Karahi"}],
  ["TIKKA",{name:"Paneer Tikka Masala"}], ["SEAFOOD_TIKKA",{name:"Fish Tikka Masalas"}],
  ["RICE",{name:"Rice"}]
]);
const typeApi={getItem:id=>typeItems.get(id)};
test("type-based clarification permits any nonempty subset of real items of that type",()=>{
  const wanted=[{kind:"item",itemId:null,candidateType:"karahi"}];
  assert.doesNotThrow(()=>validateExpected({disposition:"clarify",items:[],cart:[],mustAsk:wanted,needsReview:false}));
  for(const options of [["FISH"],["SHRIMP","MINCE"],["BRAINS","PANEER","SIZED","DESI"]]){
    assert.equal(questionsMatch(wanted,[{kind:"item",itemId:options.length===1?options[0]:null,options}],typeApi),true);
  }
  assert.equal(candidateMatchesType(typeItems.get("TIKKA"),"tikka_masala"),true);
  assert.equal(candidateMatchesType(typeItems.get("SEAFOOD_TIKKA"),"tikka_masala"),true);
});

test("type-based clarification rejects unknown, wrong-type, empty and duplicate offers",()=>{
  const wanted=[{kind:"item",itemId:null,candidateType:"karahi"}];
  for(const options of [[],["UNKNOWN"],["FISH","RICE"],["TIKKA"],["FISH","FISH"]]){
    assert.equal(questionsMatch(wanted,[{kind:"item",itemId:null,options}],typeApi),false);
  }
  assert.equal(questionsMatch(wanted,[],typeApi),false);
  assert.equal(questionsMatch(wanted,[{kind:"size",itemId:null,options:["FISH"]}],typeApi),false);
  assert.equal(questionsMatch(wanted,[{kind:"item",itemId:"RICE",options:["FISH"]}],typeApi),false);
});

test("format rejects mixed exact/type candidate rules and non-item type predicates",()=>{
  const base={disposition:"clarify",items:[],cart:[],mustAsk:[],needsReview:false};
  for(const question of [
    {kind:"item",itemId:null,candidateType:"unknown"},
    {kind:"item",itemId:null,candidateType:"karahi",options:["FISH"]},
    {kind:"spice",itemId:null,candidateType:"karahi"},
    {kind:"item",itemId:"FISH",candidateType:"karahi"}
  ])assert.throws(()=>validateExpected({...base,mustAsk:[question]}));
});

test("clarification scoring still rejects adding any item despite valid offered candidates",()=>{
  const wanted={disposition:"clarify",items:[],cart:[],mustAsk:[{kind:"item",itemId:null,candidateType:"karahi"}],needsReview:false};
  const offered={reply:"Choose a style",matches:[],state:{cart:[],recognition:{issues:[{kind:"clarify",candidates:[{itemId:"FISH"}]}]}}};
  assert.equal(scoreConversationTurn(wanted,offered,typeApi).pass,true);
  offered.state.cart=[{itemId:"FISH",qty:1,notes:[]}];
  assert.equal(scoreConversationTurn(wanted,offered,typeApi).cart,false);
  assert.equal(scoreConversationTurn(wanted,offered,typeApi).pass,false);
});

test("urgency reply rule permits the standard approximate estimate without promising a rush",()=>{
  for(const reply of ['Noted: "make it quick". What spice level?',"About 30 minutes, subject to staff confirmation.","Usually around thirty minutes.","I can't promise faster; the estimate is about 30 minutes."]){
    assert.equal(standardPickupEtaOnly(reply),true,reply);
  }
  for(const reply of ["We'll rush it.","I promise it'll be ready faster.","Ready in 15 minutes.","I'll have it ready in five minutes.","It will be ready in 30 minutes.","Guaranteed in about 30 minutes."]){
    assert.equal(standardPickupEtaOnly(reply),false,reply);
  }
});

test("reply policy checks are explicit and independent of dish accuracy",()=>{
  const wanted={...structuredClone(expected),replyRules:["standard_pickup_eta_only"]};
  assert.doesNotThrow(()=>validateExpected(wanted));
  const scored=scoreConversationTurn(wanted,{...result,reply:"We'll rush it."},api);
  assert.equal(scored.dish,true);assert.equal(scored.replyRules,false);assert.equal(scored.pass,false);
  assert.throws(()=>validateExpected({...wanted,replyRules:["unknown"]}));
});

test("optional notes may be retained or omitted without allowing unrelated instructions",()=>{
  const wanted={...structuredClone(expected),items:[{...line,optionalNotes:["requested larger serving"]}],cart:[],mustAsk:expected.mustAsk};
  assert.doesNotThrow(()=>validateExpected(wanted));
  for(const notes of [[],["requested larger serving"]]){
    assert.equal(scoreConversationTurn(wanted,{...result,matches:[{itemId:"ITEM",qty:1,notes}]},api).joint,true);
  }
  assert.equal(scoreConversationTurn(wanted,{...result,matches:[{itemId:"ITEM",qty:1,notes:["different instruction"]}]},api).joint,false);
  assert.equal(scoreConversationTurn(wanted,{...result,matches:[{itemId:"ITEM",qty:1,notes:["requested larger serving","requested larger serving"]}]},api).joint,false);
});

test("frozen format requires forty-five uniquely identified cases with declared primary groups",()=>{
  const fixture={schemaVersion:2,cases:Array.from({length:45},(_,i)=>({id:`fixture_${i}`,group:"plain_english",turns:[{text:"synthetic format fixture",expected:structuredClone(expected)}]}))};
  assert.doesNotThrow(()=>validateConversationFormat(fixture));
  assert.throws(()=>validateConversationFormat({...fixture,cases:fixture.cases.slice(0,40)}));
  const bad=structuredClone(fixture);delete bad.cases[0].group;assert.throws(()=>validateConversationFormat(bad));
});

test("one eligible dish makes a global and per-dish spice clarification equivalent",()=>{
  const wanted=[{kind:"spice",itemId:"A",options:["Spicy","Extra Spicy"]}];
  const offered=[{kind:"spice",itemId:null,options:["Extra Spicy","Spicy"]}];
  const stub={getItem:id=>({spice:id!=="DRINK"})};
  assert.equal(questionsMatch(wanted,offered,stub,{items:[{itemId:"A"},{itemId:"DRINK"}]}),true);
  assert.equal(questionsMatch(wanted,offered,stub,{items:[{itemId:"A"},{itemId:"B"}]}),false);
});

test("unresolved identity clarification is not an exact positive identification",()=>{
  const copy=structuredClone(result);copy.state.pending=undefined;
  copy.state.recognition={issues:[{kind:"clarify",candidates:[{itemId:"ITEM"}]}]};
  const scored=scoreConversationTurn(expected,copy,api);
  assert.equal(scored.dish,false);assert.equal(scored.joint,false);assert.equal(scored.disposition,false);
});
