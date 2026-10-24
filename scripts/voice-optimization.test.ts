import test from "node:test";
import assert from "node:assert/strict";
import { FixedAudioTts, FIXED_PHRASES } from "../voice/fixed-audio";
import type { Tts } from "../voice/contracts";
import { VoiceSession } from "../voice/session";
import { ContinuationGuard } from "../voice/continuation";
import { safeTranscript,voiceCsv } from "../voice/turn-log";
import { TurnRecorder } from "../voice/turn-recorder";
import { LocalTurnLog } from "../voice/local-log";
import { mkdirSync,mkdtempSync,writeFileSync,existsSync } from "node:fs";
import path from "node:path";
const collect = async (tts:Tts,text:string,signal=new AbortController().signal) => {const chunks=[];for await(const chunk of tts.speak(text,signal))chunks.push(chunk);return Buffer.concat(chunks);};
test("fixed menu/template audio excludes caller data and preserves the entire engine reply",async()=>{
 const calls:string[]=[];
 const base:Tts={name:"fixture",warm:async()=>{},close(){},async *speak(text,signal){signal.throwIfAborted();calls.push(text);yield Buffer.from(text,"utf16le");}};
 const cache=new FixedAudioTts(base,true,false);await cache.warm();assert.equal(calls.length,FIXED_PHRASES.length);
 const replies=["Half or Full for Chicken Lahori Karahi?","Please check: 2 Garlic Naan Bread. Subtotal $7.98. Is that correct?","That dish isn't on this menu. Would you like Beef Nihari or Saag Paneer instead?","Noted: 1 Rice. Subtotal $2.99. Anything else?"];
 for(const text of replies)assert.equal((await collect(cache,text)).toString("utf16le"),text);
 assert.equal(cache.stats().entries,FIXED_PHRASES.length);assert.equal(cache.plan(replies[0]).firstByteCached,true);
 assert.ok(calls.slice(FIXED_PHRASES.length).every(text=>!FIXED_PHRASES.some(phrase=>phrase.text===text)));
 const count=calls.length;await collect(cache,FIXED_PHRASES[1].text);assert.equal(calls.length,count);cache.close();
});
test("interrupting a cached lead-in aborts its prefetched dynamic item audio",async()=>{
 let cancelled=false;
 const base:Tts={name:"fixture",warm:async()=>{},close(){},async *speak(text,signal){
  if(FIXED_PHRASES.some(phrase=>phrase.text===text)){yield Buffer.from([0,0]);return;}
  await new Promise<void>(resolve=>signal.addEventListener("abort",()=>{cancelled=true;resolve();},{once:true}));signal.throwIfAborted();
 }};
 const cache=new FixedAudioTts(base);await cache.warm();const abort=new AbortController(),stream=cache.speak("Half or Full for Chicken Lahori Karahi?",abort.signal);
 await stream.next();abort.abort();await stream.return(undefined);assert.equal(cancelled,true);cache.close();
});
test("speculative engine entry point is absent; only final turns can change orders",async()=>{
 const events:any[]=[];const tts:Tts={name:"fixture",warm:async()=>{},close(){},async *speak(){yield Buffer.from([0,0]);}};
 const session=new VoiceSession(tts,event=>events.push(event),false);assert.equal("prepare" in session,false);assert.equal(events.length,0);
 await session.turn("three rice");let reply=events.filter(event=>event.type==="reply").at(-1);assert.equal(reply.cart[0].qty,3);assert.equal(reply.speculativeHit,false);
 await session.turn("make it four");reply=events.filter(event=>event.type==="reply").at(-1);assert.equal(reply.cart.length,1);assert.equal(reply.cart[0].qty,4);assert.equal(reply.speculativeHit,false);session.close();
});
test("pause guard joins a resumed utterance and cannot commit a prefix before the new final",async()=>{
 const emitted:any[]=[];const guard=new ContinuationGuard(400,event=>emitted.push(event));
 const loud=Buffer.alloc(2560);for(let i=0;i<loud.length;i+=2)loud.writeInt16LE(10000,i);
 guard.audio(loud);guard.final({type:"final",text:"one rice",audioEndSeconds:.08,endpointReason:"nova_speech_final"});
 for(let i=0;i<4;i++)guard.audio(Buffer.alloc(2560));
 await new Promise(resolve=>setTimeout(resolve,270));guard.audio(loud);
 await new Promise(resolve=>setTimeout(resolve,450));assert.equal(emitted.length,0);
 guard.final({type:"final",text:"and one mango lassi",audioEndSeconds:.48,endpointReason:"nova_speech_final"});
 await new Promise(resolve=>setTimeout(resolve,150));assert.equal(emitted.length,1);assert.equal(emitted[0].text,"one rice and one mango lassi");guard.close();
});
test("turn logs redact numeric/spoken callbacks, exclude notes/customer fields and escape CSV formulas",()=>{
 const rows:any[]=[];const recorder=new TurnRecorder({callId:"test",location:"Lahore local",model:"flux",profile:"baseline+guard1600"},row=>rows.push(structuredClone(row)));
 recorder.event({type:"transcript",text:"callback number is five five five one two three four five six seven"});
 recorder.event({type:"reply",generation:1,cart:[{itemId:"RICE",qty:1,unitPriceCents:299,notes:["contact 5551234567"]}],engineMs:1,endpointReason:"flux_confidence"});
 let row=rows.at(-1);assert.equal(row.transcript,"[callback turn redacted]");assert.equal(JSON.stringify(row).includes("5551234567"),false);assert.equal(JSON.stringify(row).includes("notes"),false);assert.equal(row.latency,null);
 recorder.latency(1,{totalMs:1200,endpointAndUplinkMs:1000,engineMs:1,ttsFirstByteMs:199,returnNetworkMs:0,browserRttMs:1,clockUncertaintyMs:.5});assert.equal(rows.at(-1).status,"first_audio");
 row={...rows.at(-1),transcript:'=HYPERLINK("bad")'};assert.ok(voiceCsv([row]).includes("'=HYPERLINK"));assert.equal(safeTranscript("one rice and 5551234567"),"one rice and [phone redacted]");
 assert.equal(safeTranscript("mera number nine two three"),"[callback turn redacted]");assert.equal(safeTranscript("+۹۲۳۱۲۳۴۵۶۷۸۹"),"[phone redacted]");
 assert.equal(safeTranscript("five five five one two three four five six seven"),"[phone redacted]");
 assert.equal(safeTranscript("one rice and two garlic naan"),"one rice and two garlic naan");
});
test("thirty-day log pruning removes only owned dated logs and CSV files",()=>{
 mkdirSync(".data",{recursive:true});const directory=mkdtempSync(path.resolve(".data/voice-log-retention-"));
 for(const name of ["turns-1999-01-01.jsonl","turns-1999-01-01.csv","keep.txt"])writeFileSync(path.join(directory,name),"synthetic fixture");
 new LocalTurnLog(directory);assert.equal(existsSync(path.join(directory,"turns-1999-01-01.jsonl")),false);assert.equal(existsSync(path.join(directory,"turns-1999-01-01.csv")),false);assert.equal(existsSync(path.join(directory,"keep.txt")),true);
});
