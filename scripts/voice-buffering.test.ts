import test from "node:test";
import assert from "node:assert/strict";
import {AuraTts} from "../voice/tts";
import {FixedAudioTts} from "../voice/fixed-audio";
import {PlaybackLedger} from "../voice/playback";
import type {Tts,TtsTelemetry} from "../voice/contracts";
import {TurnRecorder} from "../voice/turn-recorder";
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test("a timed-out partial HTTP body retries once without duplicating PCM",async()=>{
 const key=process.env.DEEPGRAM_API_KEY;process.env.DEEPGRAM_API_KEY="fixture";let calls=0;
 const tts=new AuraTts(100,async()=>{calls++;if(calls===1)return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([99,0]));controller.error(new DOMException("fixture timeout","TimeoutError"));}}));return new Response(new Uint8Array([1,0,2,0]));});
 try{const audio:Buffer[]=[],events:TtsTelemetry[]=[];for await(const chunk of tts.speak("A fixture response.",new AbortController().signal,event=>events.push(event)))audio.push(chunk);
  assert.equal(calls,2);assert.deepEqual(Buffer.concat(audio),Buffer.from([1,0,2,0]));assert.equal(events.filter(event=>event.type==="retry").length,1);
 }finally{tts.close();if(key===undefined)delete process.env.DEEPGRAM_API_KEY;else process.env.DEEPGRAM_API_KEY=key;}
});
test("two timeouts exhaust the retry; caller cancellation never retries",async()=>{
 const key=process.env.DEEPGRAM_API_KEY;process.env.DEEPGRAM_API_KEY="fixture";let calls=0;
 const tts=new AuraTts(100,async()=>{calls++;throw new DOMException("fixture timeout","TimeoutError");});
 try{await assert.rejects(async()=>{for await(const _chunk of tts.speak("Fixture.",new AbortController().signal)){}},/after one retry/);assert.equal(calls,2);
  const abort=new AbortController();abort.abort();calls=0;await assert.rejects(async()=>{for await(const _chunk of tts.speak("Fixture.",abort.signal)){} });assert.equal(calls,0);
 }finally{tts.close();if(key===undefined)delete process.env.DEEPGRAM_API_KEY;else process.env.DEEPGRAM_API_KEY=key;}
});
test("healthy chunk progress can outlive the inactivity budget without retry",async()=>{
 const key=process.env.DEEPGRAM_API_KEY;process.env.DEEPGRAM_API_KEY="fixture";let calls=0;
 const tts=new AuraTts(70,async(_url,{signal})=>{calls++;return new Response(new ReadableStream({async start(controller){for(let i=0;i<8;i++){await wait(20);signal.throwIfAborted();controller.enqueue(new Uint8Array([1,0]));}controller.close();}}));});
 try{const audio:Buffer[]=[];for await(const chunk of tts.speak("Healthy streaming fixture.",new AbortController().signal))audio.push(chunk);assert.equal(calls,1);assert.equal(Buffer.concat(audio).length,16);}finally{tts.close();if(key===undefined)delete process.env.DEEPGRAM_API_KEY;else process.env.DEEPGRAM_API_KEY=key;}
});
test("short replies keep informative fragments together; stalled synthesis yields cached neutral audio",async()=>{
 let release!:()=>void;const ready=new Promise<void>(resolve=>release=resolve),events:TtsTelemetry[]=[],chunks:Buffer[]=[];
 const base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(){await ready;yield Buffer.from([1,0,2,0]);}};
 const tts=new FixedAudioTts(base,true,true,undefined,{targetMs:300,shortCharacters:180,stallMs:5});await tts.warm();
 // Shorten the fake ack/stall clock using a separate fixed-speech identity is
 // unnecessary: release after the first real cached stall (about ack+5 ms).
 const job=(async()=>{for await(const chunk of tts.speak("Added 2 Cheese Naan Bread, packed separately. Anything else?",new AbortController().signal,event=>{events.push(event);if(event.type==="stall")release();}))chunks.push(chunk);})();
 await job;assert.ok(events.some(event=>event.type==="stall"));assert.equal(events.filter(event=>event.type==="segment"&&event.kind==="informative").length,1);
 const batch=events.find(event=>event.type==="jitter_ready");assert.equal(batch?.wholeShortReply,true);assert.ok(chunks.length>=2);assert.ok(chunks.at(-1)!.includes(Buffer.from([1,0,2,0])),"The informative batch preserves the synthesized PCM before its cached closing question");tts.close();
});
test("gap counts exclude scheduling noise and include real underruns",()=>{
 const ledger=new PlaybackLedger();ledger.start(1,0);ledger.schedule(1,4800,0,.1);ledger.schedule(1,4800,.115,.1);ledger.schedule(1,4800,.5,.1);ledger.stall(1);
 assert.equal(ledger.metrics(1).gapCount,1);assert.equal(ledger.metrics(1).stallPrompts,1);assert.ok(Math.abs(ledger.metrics(1).maxGapMs-285)<.01);
});
test("exhausted synthesis plays a cached failure notice without claiming the reply finished",async()=>{
 const events:TtsTelemetry[]=[],base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(){throw Error("Aura timeout after one retry");}},tts=new FixedAudioTts(base);await tts.warm();
 const audio:Buffer[]=[];for await(const chunk of tts.speak("A dynamic fixture response.",new AbortController().signal,event=>events.push(event)))audio.push(chunk);
 assert.ok(events.some(event=>event.type==="terminal_failure"));assert.ok(audio.length>=1);assert.equal(events.some(event=>event.type==="segment"&&event.kind==="informative"),false);
 const ledger=new PlaybackLedger();ledger.schedule(1,4800,0,.1);ledger.fail(1);ledger.ended(1);ledger.serverEnd(1);assert.equal(ledger.metrics(1).finished,false);tts.close();
});
test("chunk telemetry is published once at completion and late ack timing cannot erase failure",()=>{
 const rows:any[]=[],recorder=new TurnRecorder({callId:"fixture",location:"Lahore local",model:"flux",profile:"fixture"},row=>rows.push(structuredClone(row)));
 recorder.event({type:"reply",generation:1,cart:[],text:"Fixture reply",engineMs:1});const initial=rows.length;
 for(let index=0;index<100;index++)recorder.event({type:"tts_telemetry",generation:1,event:{type:"raw_chunk",atMs:index,bytes:1920}});
 assert.equal(rows.length,initial,"Per-chunk logs must not repeatedly publish the whole growing row");
 recorder.event({type:"audio_end",generation:1});assert.equal(rows.at(-1).ttsChunks.length,100);assert.equal(rows.length,initial+1);
 recorder.event({type:"error",generation:1});recorder.latency(1,{totalMs:5,endpointAndUplinkMs:1,engineMs:1,ttsFirstByteMs:2,returnNetworkMs:1,browserRttMs:1,clockUncertaintyMs:.5});assert.equal(rows.at(-1).status,"failed");
});

test("a trickling provider hits the whole-reply deadline instead of resetting it forever",async()=>{
 let aborted=false;const events:TtsTelemetry[]=[],base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(_text,signal){
  try{for(let index=0;index<50;index++){await wait(5);signal.throwIfAborted();yield Buffer.from([1,0]);}}finally{aborted=signal.aborted;}
 }},tts=new FixedAudioTts(base,true,false,undefined,{targetMs:300,shortCharacters:80,stallMs:20,maxWaitMs:45});await tts.warm();
 for await(const _chunk of tts.speak("A dynamic response that will not finish.",new AbortController().signal,event=>events.push(event))){}
 assert.equal(aborted,true);assert.ok(events.some(event=>event.type==="terminal_failure"&&event.reason==="timeout"));assert.equal(events.some(event=>event.type==="segment"&&event.kind==="informative"),false);tts.close();
});

test("common clarification and language-recovery replies are entirely cached",async()=>{
 const base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(){throw Error("No provider call expected");}},tts=new FixedAudioTts(base);await tts.warm();
 for(const text of ["Kids Chicken Burger, $8.99. Add it?","No problem. Half or Full for Goat White Karahi?","I missed part of that. Please repeat the item or choice in English."]){
  assert.equal(tts.plan(text).dynamicCharacters,0,text);let bytes=0;for await(const chunk of tts.speak(text,new AbortController().signal))bytes+=chunk.length;assert.ok(bytes>0);
 }tts.close();
});

test("a cached TTS failure notice cannot end a call as if goodbye played",async()=>{
 const {VoiceSession}=await import("../voice/session"),events:any[]=[],base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(){throw Error("fixture timeout");}},tts=new FixedAudioTts(base);await tts.warm();
 // An empty-order goodbye is cached, so exercise a failed dynamic goodbye by
 // wrapping the neutral terminal-failure stream under the normal session.
 const failed:Tts={name:"aura-2",warm:async()=>{},close(){},speak:(_text,signal,observe)=>tts.speak("A dynamic failing goodbye.",signal,observe)};
 const ending=new VoiceSession(failed,event=>{if(!Buffer.isBuffer(event))events.push(event);});
 await ending.turn("goodbye",0);assert.ok(events.some(event=>event.type==="error"&&event.code==="tts_failed"));assert.equal(events.some(event=>event.type==="call_end"),false);ending.close();tts.close();
});
