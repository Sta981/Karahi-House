import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { TranscriptDecoder, sttUrl, KEYTERMS, MENU_WORDS,stateKeyterms } from "../voice/stt";
import { VoiceSession } from "../voice/session";
import { AuraTts } from "../voice/tts";
import { auraPronunciation, splitSpeech } from "../voice/pronunciation.mjs";
import type { SttEvent, Tts } from "../voice/contracts";
import WebSocket, { WebSocketServer } from "ws";
import { AuraWsTts } from "../voice/aura-ws";
const pause = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));

test("final-only menu keyterms, correct Flux/Nova endpoints, provider retention opt-out",()=>{
  const source=JSON.parse(readFileSync("lib/menu-source.json","utf8")); assert.deepEqual(MENU_WORDS,[...new Set(source.items.flatMap((item:any)=>item.name.match(/[A-Za-z]+/g)))]);
  assert.ok(KEYTERMS.length<=100);
  for(const term of KEYTERMS)assert.ok(term.split(/\s+/).every(word=>MENU_WORDS.some(menuWord=>menuWord.toLowerCase()===word.toLowerCase())));
  assert.ok(KEYTERMS.includes("chicken karahi"));assert.ok(KEYTERMS.includes("garlic naan"));assert.ok(KEYTERMS.includes("seekh kabab"));
  assert.ok(stateKeyterms(["Half","Full"]).reduce((n,term)=>n+Buffer.byteLength(term)+1,0)<=450);
  assert.equal(new URL(sttUrl("nova-3-en-IN")).searchParams.get("language"),"en-IN");
  for(const important of ["Karahi","Nihari","Kabab","Gulab","Jamun","Kheer","Rasmalai","Biryani","Pulao","Papadam","Raita","Lassi"])assert.ok(KEYTERMS.includes(important));
  for(const model of ["flux","nova-3"] as const){ const url=new URL(sttUrl(model)); assert.equal(url.pathname,model==="flux"?"/v2/listen":"/v1/listen");assert.equal(url.searchParams.get("mip_opt_out"),"true");assert.equal(url.searchParams.getAll("keyterm").length,KEYTERMS.length);if(model==="flux")assert.equal(url.searchParams.has("channels"),false); }
});
test("Flux eager end/resume cannot add an item; duplicate final cannot add twice",()=>{
  const events:SttEvent[]=[];const decoder=new TranscriptDecoder("flux",event=>events.push(event));
  for(const event of ["StartOfTurn","EagerEndOfTurn","TurnResumed","EndOfTurn","EndOfTurn"])decoder.accept({type:"TurnInfo",event,turn_index:1,transcript:"one rice",words:[{end:1.5}]});
  assert.equal(events.filter(event=>event.type==="final").length,1);assert.equal(events.filter(event=>event.type==="speech").length,2);
});
test("Nova aggregates final segments; empty speech_final and UtteranceEnd flush once",()=>{
 const events:SttEvent[]=[];const decoder=new TranscriptDecoder("nova-3",event=>events.push(event));
 const result=(start:number,text:string,final:boolean,speech=false)=>({type:"Results",start,duration:1,is_final:final,speech_final:speech,channel:{alternatives:[{transcript:text,words:[{end:start+1}]}]}});
 decoder.accept(result(0,"one rice",false));decoder.accept(result(0,"one rice",true));decoder.accept(result(0,"one rice",true));decoder.accept(result(1,"and mango lassi",true));decoder.accept(result(2,"",true,true));decoder.accept({type:"UtteranceEnd"});
 assert.deepEqual(events.filter(event=>event.type==="final"),[{type:"final",text:"one rice and mango lassi",audioEndSeconds:2,endpointReason:"nova_speech_final"}]);
});
test("barge-in aborts stale synthesis and drops every late frame while preserving cart",async()=>{
 const events:(Record<string,unknown>|Buffer)[]=[];let aborted=false;
 const tts:Tts={name:"fake",warm:async()=>{},close(){},async *speak(_text,signal){await pause(20);aborted ||= signal.aborted;yield Buffer.from([1,0,2,0]);}};
 const session=new VoiceSession(tts,event=>events.push(event));const pending=session.turn("one rice");await pause(3);session.interrupt();await pending;
 assert.equal(aborted,true);assert.equal(events.filter(Buffer.isBuffer).length,0);
 const replies=events.filter((event:any)=>event.type==="reply") as any[];assert.equal(replies[0].cart.length,1);assert.equal(replies[0].cart[0].qty,1);session.close();
});
test("voice uses unchanged deterministic templates and zero default LLM requests",async()=>{
 let network=0;const original=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error("offline");};
 const events:any[]=[];const tts:Tts={name:"fake",warm:async()=>{},close(){},async *speak(){yield Buffer.from([0,0]);}};
 try{const session=new VoiceSession(tts,event=>events.push(event));await session.turn("one chicken biryani for me");await session.turn("mild spice");const reply=events.filter(event=>event.type==="reply").at(-1);assert.equal(reply.cart[0].qty,1);assert.equal(reply.usedLLM,false);assert.equal(network,0);session.close();}finally{globalThis.fetch=original;}
});
test("speech chunking preserves all template numbers and full read-backs",()=>{
 const text="Two Chicken Biryani, mild spice, $27.00. ".repeat(20).trim();assert.equal(splitSpeech(text).join(" "),text);assert.ok(splitSpeech(text).every((chunk:string)=>chunk.length<=140));
 assert.equal(auraPronunciation("$12.50, 2 Karahi."), '$12.50, 2 \\{"word":"Karahi","pronounce":"kəɹˈɑːhi"\\}.');
});
test("Aura HTTP requests opt-out and streams complete PCM samples across byte boundaries",async()=>{
 const original=globalThis.fetch,key=process.env.DEEPGRAM_API_KEY;process.env.DEEPGRAM_API_KEY="test-key";let got:any;
 globalThis.fetch=async(url,init)=>{got={url:new URL(String(url)),init};return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,0,2]));controller.enqueue(new Uint8Array([0]));controller.close();}}));};
 try{const chunks=[];const transport:any=(url:any,init:any)=>globalThis.fetch(url,{...init,method:"POST"});for await(const chunk of new AuraTts(8000,transport).speak("One Karahi.",new AbortController().signal))chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),Buffer.from([1,0,2,0]));assert.equal(got.url.searchParams.get("mip_opt_out"),"true");assert.equal(got.url.searchParams.get("container"),"none");assert.match(got.init.body,/pronounce/);}finally{globalThis.fetch=original;if(key===undefined)delete process.env.DEEPGRAM_API_KEY;else process.env.DEEPGRAM_API_KEY=key;}
});
test("capture worklet outputs 16 kHz 80 ms PCM frames and detects speech without recording",()=>{
 let Capture:any;const messages:any[]=[];const sandbox={AudioWorkletProcessor:class{port={postMessage:(message:any)=>messages.push(message)};},sampleRate:48000,registerProcessor:(_name:string,type:any)=>Capture=type,Int16Array,Math};
 vm.runInNewContext(readFileSync("public/voice-capture.js","utf8"),sandbox);
 const capture=new Capture();for(let i=0;i<240;i++)capture.process([[new Float32Array(128).fill(i<150?.2:0)]]);
 const frames=messages.filter(row=>row.type==="pcm");assert.equal(frames.length,8);assert.ok(frames.every(row=>row.pcm.byteLength===2560));assert.equal(messages.filter(row=>row.type==="speech_start").length,1);assert.equal(messages.filter(row=>row.type==="speech_end").length,1);
});
test("pronunciation sheet covers all 84 current IDs and seven modifiers",()=>{
 const sheet=JSON.parse(readFileSync("docs/pronunciation-sheet.json","utf8")),source=JSON.parse(readFileSync("lib/menu-source.json","utf8"));assert.equal(sheet.entries.length,91);assert.deepEqual(sheet.entries.slice(0,84).map((row:any)=>row.id),source.items.map((item:any)=>item.id));
});
test("Aura WebSocket Clear barrier discards late old PCM before a new reply",async()=>{
 const server=new WebSocketServer({port:0,host:"127.0.0.1"});await new Promise<void>(resolve=>server.once("listening",resolve));
 const address=server.address();if(typeof address==="string"||!address)throw Error("No test port");
 const events:string[]=[];
 server.on("connection",socket=>{let timer:ReturnType<typeof setTimeout>|undefined;
  socket.on("message",bytes=>{const msg=JSON.parse(bytes.toString());events.push(msg.type);
   if(msg.type==="Flush"){socket.send(Buffer.from([1,0]));timer=setTimeout(()=>{socket.send(Buffer.from([2,0]));socket.send(JSON.stringify({type:"Flushed"}));},80);}
   if(msg.type==="Clear"){if(timer)clearTimeout(timer);socket.send(Buffer.from([9,0]));setTimeout(()=>{events.push("Cleared");socket.send(JSON.stringify({type:"Cleared"}));},30);}
  });socket.on("close",()=>{if(timer)clearTimeout(timer);});
 });
 const tts=new AuraWsTts(()=>new WebSocket(`ws://127.0.0.1:${address.port}`));
 try{
  const abort=new AbortController(),first=tts.speak("First reply.",abort.signal);assert.deepEqual((await first.next()).value,Buffer.from([1,0]));abort.abort();
  const second=(async()=>{const chunks=[];for await(const chunk of tts.speak("Second reply.",new AbortController().signal))chunks.push(chunk);return Buffer.concat(chunks);})();
  await first.return(undefined);assert.deepEqual(await second,Buffer.from([1,0,2,0]));
  assert.ok(events.indexOf("Cleared")<events.lastIndexOf("Speak"));
 }finally{tts.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
