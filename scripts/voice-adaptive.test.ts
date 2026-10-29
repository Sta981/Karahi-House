import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,mkdirSync,mkdtempSync,writeFileSync } from "node:fs";
import path from "node:path";
import { FixedAudioTts } from "../voice/fixed-audio";
import { phraseCompletion } from "../voice/phrase-completeness";
import { mishearingsCsv } from "../voice/mishearings";
import { TranscriptDecoder } from "../voice/stt";
import { VoiceSession } from "../voice/session";
import {ContinuationGuard} from "../voice/continuation";
import {audioFile} from "../voice/audio-catalog";
import type { Tts,SttEvent } from "../voice/contracts";

test("finite acknowledgements and completion turns cannot merge with the next order",async()=>{
 for(const text of ["yeah","no we're done thanks","we're done how long will my order take"]){
  const emitted:any[]=[];let resume=0,resolve!:()=>void;
  const guard=new ContinuationGuard({completeMs:1,incompleteMs:1,uncertainMs:1,answerMs:1},event=>{emitted.push(event);resolve();},{windowMs:10000,onResume:()=>resume++},()=>["yes","yeah","no"]);
  const first=new Promise<void>(done=>resolve=done);guard.final({type:"final",text,audioEndSeconds:null});await first;
  guard.confirmedSpeech();assert.equal(resume,0,text);
  const second=new Promise<void>(done=>resolve=done);guard.final({type:"final",text:"two mango lassi",audioEndSeconds:null});await second;
  assert.equal(emitted[1].text,"two mango lassi");assert.equal(emitted[1].continuationOf,undefined);guard.close();
 }
});

test("unfinished removal and recipient frames wait while explicit completion remains complete",()=>{
 for(const text of ["please remove","food for my","remove the","one fish pakora but","i want to change"])assert.equal(phraseCompletion(text),"incomplete",text);
 assert.equal(phraseCompletion("we're done thank you very much"),"complete");
});

test("checkout, removal and group replies plus large USD totals use exact cached content",async()=>{
 const base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(){throw Error("No provider call expected");}},tts=new FixedAudioTts(base);await tts.warm();
 try{
  for(const text of ["Removed 1 Fish Pakora, 0 left. Removed 1 Fish Karahi, 0 left. Anything else?","Add 1 of each item in that category?","Red Bull isn't on this menu. Did you mean Soda (Can)?","Pickup is about 30 minutes; staff must confirm. Anything else?"]){assert.equal(tts.plan(text).dynamicCharacters,0,text);for await(const _chunk of tts.speak(text,new AbortController().signal)){} }
  for(const [amount,labels]of [["$220.33",["2","hundred","20","dollars","and","33","cents"]],["$1001.01",["1","thousand","1","dollars","and","1","cent"]]] as const){
   const chunks:Buffer[]=[];for await(const chunk of tts.speak(amount,new AbortController().signal))chunks.push(chunk);
   assert.deepEqual(Buffer.concat(chunks),Buffer.concat(labels.map(label=>readFileSync(path.join("public/voice-audio",audioFile(label))))));
  }
 }finally{tts.close();}
});
test("completion distinguishes item/modifier answers from unfinished tails",()=>{
 for(const text of ["two garlic naan please","full","medium spice","that's all","one mango lassi"] )assert.equal(phraseCompletion(text),"complete",text);
 for(const text of ["one chicken biryani and","aik mango lassi aur","i would like three","one fish pakora with","can i have the"])assert.equal(phraseCompletion(text),"incomplete",text);
 assert.equal(phraseCompletion("um one goat"),"uncertain");
});
test("static templates load without synthesis; tampered/missing assets fail closed",async()=>{
 let requests=0;const base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(){requests++;yield Buffer.from([0,0]);}};
 const cache=new FixedAudioTts(base,true,false);await cache.warm();assert.equal(requests,0);assert.equal(cache.stats().source,"static-build");assert.equal(cache.stats().startupCharacters,0);
 const bad=new FixedAudioTts(base,true,false,".data/nonexistent-static-audio");await assert.rejects(()=>bad.warm());assert.equal(requests,0);cache.close();
 mkdirSync(".data",{recursive:true});const directory=mkdtempSync(path.resolve(".data/corrupt-static-")),manifest=JSON.parse(readFileSync("public/voice-audio/manifest.json","utf8")),entry=manifest.entries[0];
 const pcm=Buffer.from(readFileSync(path.join("public/voice-audio",entry.file)));pcm[0]^=1;writeFileSync(path.join(directory,entry.file),pcm);writeFileSync(path.join(directory,"manifest.json"),JSON.stringify(manifest));
 await assert.rejects(()=>new FixedAudioTts(base,true,false,directory).warm(),/Invalid static speech hash/);assert.equal(requests,0);
});
test("dynamic synthesis cancels without an unsolicited acknowledgement",async()=>{
 let cancelled=false;const base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(_text,signal){await new Promise<void>(resolve=>signal.addEventListener("abort",()=>{cancelled=true;resolve();},{once:true}));signal.throwIfAborted();}};
 const cache=new FixedAudioTts(base,true,true);await cache.warm();const signal=new AbortController(),stream=cache.speak("A dynamic answer for a test.",signal.signal);
 assert.equal(cache.plan("A dynamic answer for a test.").acknowledgementBytes,0);
 const pending=stream.next();setTimeout(()=>signal.abort(),20);await assert.rejects(()=>pending);assert.equal(cancelled,true);cache.close();
});

test("fragment caching sends at most one nonempty dynamic request per reply",async()=>{
 const calls:string[]=[];const base:Tts={name:"aura-2",warm:async()=>{},close(){},async *speak(text){calls.push(text);yield Buffer.from([0,0]);}};
 const cache=new FixedAudioTts(base,true,false);await cache.warm();
 for(const reply of ["Added 2 Rice. Subtotal $5.98. Anything else?","Half or Full for Chicken White Karahi?","Please check: 2 Garlic Naan Bread. Subtotal $7.98. Is that correct?"]){
   const before=calls.length;for await(const _chunk of cache.speak(reply,new AbortController().signal)){}
   assert.ok(calls.length-before<=1);assert.ok(calls.slice(before).every(text=>/[a-z0-9]/i.test(text)));
 }
 assert.equal(cache.plan("Did you mean a different dish?").acknowledgementBytes,0);
 assert.equal(cache.plan("Half or Full for Goat White Karahi?").dynamicCharacters,0);
 cache.close();
});
test("mishearing exports require user intent, redact callbacks and never imply an approved alias",()=>{
 const row={turnId:"test",atUtc:"now",model:"flux",location:"Lahore local",heard:"my phone is 5551234567",intended:""};assert.equal(mishearingsCsv([row]).trim().split(/\r?\n/).length,1);
 const csv=mishearingsCsv([{...row,intended:"=formula"}]);assert.ok(!csv.includes("5551234567"));assert.ok(csv.includes("'=formula"));assert.ok(csv.includes("pending_manual_review"));
});
test("a rejected state-keyterm update preserves transcription and is not a fatal provider error",()=>{
 const events:SttEvent[]=[];const decoder=new TranscriptDecoder("nova-3-en-IN",event=>events.push(event));decoder.accept({type:"ConfigureFailure"});decoder.accept({type:"ConfigureSuccess"});assert.deepEqual(events,[{type:"configuration",accepted:false},{type:"configuration",accepted:true}]);
});
test("legacy speculation flags cannot activate interim engine or TTS work",async()=>{
 const previous=process.env.VOICE_SPECULATIVE_ENGINE;process.env.VOICE_SPECULATIVE_ENGINE="true";
 const events:any[]=[];let spoken=0,pending:Promise<void>|undefined;
 const session=new VoiceSession({name:"fixture",warm:async()=>{},close(){},async *speak(){spoken++;yield Buffer.from([0,0]);}},event=>events.push(event));
 const decoder=new TranscriptDecoder("flux",event=>{if(event.type==="final")pending=session.turn(event.text,event.audioEndSeconds,event.endpointReason);});
 try{
  decoder.accept({type:"TurnInfo",event:"EagerEndOfTurn",turn_index:1,transcript:"five rice"});decoder.accept({type:"TurnInfo",event:"TurnResumed",turn_index:1,transcript:"one rice"});
  assert.equal(spoken,0);assert.equal(events.length,0);
  decoder.accept({type:"TurnInfo",event:"EndOfTurn",turn_index:1,transcript:"one rice",words:[{end:1}]});await pending;
  assert.equal(events.find(event=>event.type==="reply").cart[0].qty,1);assert.equal(spoken,1);
 }finally{session.close();if(previous===undefined)delete process.env.VOICE_SPECULATIVE_ENGINE;else process.env.VOICE_SPECULATIVE_ENGINE=previous;}
});
