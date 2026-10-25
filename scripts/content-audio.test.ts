import test from "node:test";
import assert from "node:assert/strict";
import { FixedAudioTts } from "../voice/fixed-audio";
import { MENU } from "../lib/menu";
import { browsePage } from "../lib/menu-browsing";
import type { Tts, TtsTelemetry } from "../voice/contracts";
import { runTurn, newState } from "../lib/dialog";
import { BARGE_IN_DEFAULTS, qualifiedBargeIn } from "../voice/barge-in";
import { ContinuationGuard } from "../voice/continuation";
import { TurnRecorder } from "../voice/turn-recorder";
import { voiceCsv } from "../voice/turn-log";
import { AuraTts } from "../voice/tts";
const base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(){throw Error("Unexpected provider call for fixed content");}};

test("every category first page, fallback and a normal add are provider-free cached content",async()=>{
 const tts=new FixedAudioTts(base);await tts.warm();
 try{for(const phrase of ["desserts","drinks","breads","rice","kids","starters","bbq","vegetarian"].map(key=>browsePage(key).reply).concat(["Could you say that again? You can order or ask about the menu.",runTurn(newState(),"two onion naan").reply])){
  const plan=tts.plan(phrase);assert.equal(plan.dynamicCharacters,0,phrase);assert.equal(plan.acknowledgementBytes,0);
  const events:TtsTelemetry[]=[];let bytes=0;for await(const chunk of tts.speak(phrase,new AbortController().signal,event=>events.push(event)))bytes+=chunk.length;
  assert.ok(bytes>0);assert.ok(events.some(event=>event.type==="segment"&&event.kind==="informative"));assert.equal(events.some(event=>event.kind==="neutral"),false);
 }}finally{tts.close();}
});
test("all menu names, prices and common quantities have cached fragments",async()=>{
 const tts=new FixedAudioTts(base);await tts.warm();try{for(const item of MENU){
  assert.equal(tts.plan(item.name).dynamicCharacters,0);assert.equal(tts.plan(`$${(item.price_cents/100).toFixed(2)}`).dynamicCharacters,0);
 }for(let qty=1;qty<=10;qty++)assert.equal(tts.plan(String(qty)).dynamicCharacters,0);
 }finally{tts.close();}
});
test("computed USD subtotals compose exact dollars/cents; notes and larger unknown amounts stay dynamic",async()=>{
 const tts=new FixedAudioTts(base);await tts.warm();try{
  for(const dollars of [0,1,11,28,48,99])for(const cents of [0,1,7,48,97,99]){
   const text=`Subtotal $${dollars}.${String(cents).padStart(2,"0")}. Anything else?`;assert.equal(tts.plan(text).dynamicCharacters,0,text);
   let bytes=0;for await(const chunk of tts.speak(text,new AbortController().signal))bytes+=chunk.length;assert.ok(bytes>0);
  }
  assert.ok(tts.plan("Notes: $28.97").dynamicCharacters>0);assert.ok(tts.plan("Subtotal $123.45.").dynamicCharacters>0);
 }finally{tts.close();}
});
test("live Aura releases buffered PCM before EOF and never retries already released words",async()=>{
 const original=process.env.DEEPGRAM_API_KEY;process.env.DEEPGRAM_API_KEY="fixture";
 let calls=0;let body!:ReadableStreamDefaultController<Uint8Array>;
 const provider=new AuraTts(1000,async()=>{calls++;return new Response(new ReadableStream({start(controller){body=controller;controller.enqueue(new Uint8Array(28800));}}));},true);
 try{const iterator=provider.speak("A streamed fixture reply.",new AbortController().signal);
  const first=await iterator.next();assert.equal(first.value?.length,28800);assert.equal(first.done,false);
  body.error(new DOMException("fixture timeout","TimeoutError"));await assert.rejects(()=>iterator.next());assert.equal(calls,1,"A retry after released audio would repeat words");
 }finally{provider.close();if(original===undefined)delete process.env.DEEPGRAM_API_KEY;else process.env.DEEPGRAM_API_KEY=original;}
});
test("clarifications and rejections never acquire an acknowledgement",async()=>{
 const tts=new FixedAudioTts(base,true,true);await tts.warm();try{for(const text of ["Which protein would you like?","Sorry, that is unavailable.","Added 1 Rice. Anything else?","Anything else?"])assert.equal(tts.plan(text).acknowledgementBytes,0);}finally{tts.close();}
});
test("480ms VAD qualification rejects the old 320ms interruption",()=>{
 assert.equal(BARGE_IN_DEFAULTS.minSpeechMs,480);assert.equal(qualifiedBargeIn({source:"browser_vad",energy:.14,threshold:.04,speechMs:320}),false);assert.equal(qualifiedBargeIn({source:"browser_vad",energy:.14,threshold:.04,speechMs:480}),true);
});
test("finite question answers take the answer wait while new food does not",async()=>{
 const seen:any[]=[],guard=new ContinuationGuard({completeMs:100,incompleteMs:160,uncertainMs:90,answerMs:20},event=>seen.push(event),undefined,()=>["Half","Full"]);
 guard.final({type:"final",text:"full",audioEndSeconds:null});await new Promise(resolve=>setTimeout(resolve,60));assert.equal(seen.length,1);assert.match(seen[0].endpointReason,/adaptive_answer_20ms/);guard.close();
});
test("ack and informative timing remain distinct in the CSV",()=>{
 const rows:any[]=[],recorder=new TurnRecorder({callId:"fixture",location:"Lahore local",model:"nova-3-en-IN",profile:"fixture"},row=>rows.push(structuredClone(row)));
 recorder.event({type:"reply",generation:1,text:"fixture",cart:[],engineMs:1});recorder.event({type:"audio_start",generation:1,ttsFirstByteMs:5,acknowledgement:true});recorder.event({type:"content_start",generation:1,contentFirstByteMs:600});
 assert.equal(rows.at(-1).ackFirstByteMs,5);assert.equal(rows.at(-1).contentFirstByteMs,600);
 const csv=voiceCsv([rows.at(-1)]).split("\r\n"),head=csv[0].split(","),data=csv[1].split(",");assert.equal(head.length,data.length);assert.ok(head.includes('"ack_first_byte_ms"'));
});
