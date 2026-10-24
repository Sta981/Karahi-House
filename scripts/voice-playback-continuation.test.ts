import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PlaybackLedger } from "../voice/playback";
import { qualifiedBargeIn } from "../voice/barge-in";
import { VoiceSession } from "../voice/session";
import { newState,runTurn } from "../lib/dialog";
import { recordCartOperations,replayCartOperations,rollbackCartOperations } from "../lib/cart-journal";
import { ContinuationGuard } from "../voice/continuation";
const tts={name:"fixture",warm:async()=>{},close(){},async *speak(){yield Buffer.from([0,0]);}};
function capture(){let Capture:any;const events:any[]=[];vm.runInNewContext(readFileSync("public/voice-capture.js","utf8"),{sampleRate:48000,AudioWorkletProcessor:class{port={postMessage:(event:any)=>events.push(event)};},registerProcessor:(_name:string,value:any)=>Capture=value});return {processor:new Capture(),events};}
test("blips cannot trigger barge-in while sustained caller speech can",()=>{
 const {processor,events}=capture();for(let block=0;block<240;block++)processor.process([[new Float32Array(128).fill(block<50?.12:0)]]);
 assert.equal(events.filter(event=>event.type==="speech_start").length,0);
 for(let block=0;block<180;block++)processor.process([[new Float32Array(128).fill(.12)]]);
 const event=events.find(event=>event.type==="speech_start");assert.ok(event);assert.ok(event.speechMs>=320);assert.equal(qualifiedBargeIn(event),true);
 assert.equal(qualifiedBargeIn({...event,speechMs:160}),false);assert.equal(qualifiedBargeIn({...event,energy:.01}),false);
});
test("a correlated playback reference is suppressed without suppressing a distinct caller",()=>{
 const {processor,events}=capture();
 for(let block=0;block<240;block++){
  const reference=Float32Array.from({length:128},(_,index)=>Math.sin((block*128+index)/48000*2*Math.PI*220)*.12);
  processor.process([[Float32Array.from(reference,value=>value*.5)],[reference]]);
 }
 assert.equal(events.filter(event=>event.type==="speech_start").length,0);assert.ok(events.some(event=>event.reason==="playback_echo"));
 for(let block=240;block<460;block++){
  const reference=Float32Array.from({length:128},(_,index)=>Math.sin((block*128+index)/48000*2*Math.PI*220)*.12);
  const mic=Float32Array.from(reference,(value,index)=>value*.1+Math.sin((block*128+index)/48000*2*Math.PI*731)*.12);
  processor.process([[mic],[reference]]);
 }
 assert.equal(events.filter(event=>event.type==="speech_start").length,1);
});
test("playback EOF is not audible completion; gaps and original barge trigger are preserved",()=>{
 const ledger=new PlaybackLedger();ledger.reply(1,42);ledger.start(1,26880);ledger.schedule(1,26880,0,.56);ledger.schedule(1,48000,.91,1);
 ledger.serverEnd(1);assert.equal(ledger.metrics(1).finished,false);ledger.ended(1);assert.equal(ledger.metrics(1).finished,false);ledger.ended(1);
 assert.equal(ledger.metrics(1).finished,true);assert.ok(Math.abs(ledger.metrics(1).acknowledgementGapMs!-350)<.001);
 ledger.reply(2,17);ledger.schedule(2,48000,2,1);ledger.interrupt(2,{source:"browser_vad",energy:.1,threshold:.032,speechMs:320});ledger.interrupt(2,{source:"server_turn"});ledger.drop(2);ledger.ended(2);ledger.serverEnd(2);
 assert.equal(ledger.metrics(2).finished,false);assert.equal(ledger.metrics(2).trigger?.source,"browser_vad");assert.equal(ledger.metrics(2).lateChunks,1);
});
test("journal inversion restores exact carts across adds, removals and replacements",()=>{
 const a=runTurn(newState(),"two rice and one mango lassi").state.cart;
 const b=runTurn(newState(),"three fish pakora and two cheese naan").state.cart;
 const carts=[[],a,b,a.slice(0,1),[...a,...b]];
 for(const before of carts)for(const after of carts){const ops=recordCartOperations(before,after);assert.deepEqual(replayCartOperations(before,ops),after);assert.deepEqual(rollbackCartOperations(after,ops),before);}
});
test("split orders and corrections reproduce unsplit carts without duplicate additions",async()=>{
 const pairs=[
  ["two chicken biryani","and a mango lassi"],
  ["one goat white karahi","full mild spice"],
  ["three rice","actually make that two"],
  ["one lamb","shinwari karahi full no spice"],
  ["two cheese naan","and three fish pakora"],
 ];
 for(const [prefix,fragment] of pairs){
  for(const prior of [[],["one mango lassi"]]){
   let expected=newState();for(const text of prior)expected=runTurn(expected,text).state;expected=runTurn(expected,`${prefix} ${fragment}`).state;
   const events:any[]=[];const session=new VoiceSession(tts,event=>events.push(event));for(const text of prior)await session.turn(text);
   await session.turn(prefix);await session.turn(`${prefix} ${fragment}`,null,"test_continuation",{of:prefix,fragment});
   const cart=events.filter(event=>event.type==="reply").at(-1).cart;assert.deepEqual(cart,expected.cart,`${prefix} / ${fragment}`);session.close();
  }
 }
});
test("a fast uncertain final is revised when speech resumes within the merge window",async()=>{
 const events:any[]=[];let resumes=0;const guard=new ContinuationGuard({completeMs:10,incompleteMs:10,uncertainMs:10},event=>events.push(event),{windowMs:500,onResume:()=>resumes++});
 guard.final({type:"final",text:"one lamb",audioEndSeconds:null});await new Promise(resolve=>setTimeout(resolve,25));assert.equal(events.length,1);
 guard.confirmedSpeech();guard.final({type:"final",text:"white karahi full",audioEndSeconds:null});await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(resumes,1);assert.equal(events[1].text,"one lamb white karahi full");assert.equal(events[1].continuationOf,"one lamb");guard.close();
});
