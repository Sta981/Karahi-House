import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Tts,TtsObserver } from "./contracts";
import { FIXED_PHRASES,AUDIO_IDENTITY } from "./audio-catalog";
export { FIXED_PHRASES } from "./audio-catalog";
type Part={text:string;cached:boolean;ack?:boolean};
export class FixedAudioTts implements Tts {
 readonly name:string;readonly cacheIdentity=AUDIO_IDENTITY;
 private cache=new Map<string,Buffer[]>();private warming?:Promise<void>;private startupMs=0;private staticLoadMs=0;private source="disabled";
 constructor(private base:Tts,private enabled=true,private acknowledgement=process.env.VOICE_ACKNOWLEDGEMENT!=="false",private directory=path.resolve("public/voice-audio"),private buffering={targetMs:300,shortCharacters:80,stallMs:1100}){this.name=base.name;}
 warm(){
  if(this.warming)return this.warming;
  this.warming=(async()=>{
   const started=performance.now();
   if(this.enabled&&this.name==="aura-2"){
    const loaded=performance.now(),manifest=JSON.parse(readFileSync(path.join(this.directory,"manifest.json"),"utf8"));
    if(manifest.identity!==AUDIO_IDENTITY||manifest.sampleRate!==24000||manifest.entries.length!==FIXED_PHRASES.length)throw Error("Rebuild stale static speech");
    for(const phrase of FIXED_PHRASES){
     const entry=manifest.entries.find((entry:any)=>entry.text===phrase.text);if(!entry||!/^[a-f0-9]{64}\.pcm$/.test(entry.file))throw Error("Invalid static speech entry");
     const pcm=readFileSync(path.join(this.directory,entry.file));if(pcm.length!==entry.bytes||pcm.length%2||createHash("sha256").update(pcm).digest("hex")!==entry.sha256)throw Error("Invalid static speech hash");
     this.cache.set(phrase.text,[pcm]);
    }
    this.staticLoadMs=performance.now()-loaded;this.source="static-build";
   }else if(this.enabled){
    // Explicit Kokoro/fixture alternative. Aura never synthesizes at startup.
    for(const phrase of FIXED_PHRASES){const chunks=[];for await(const chunk of this.base.speak(phrase.text,AbortSignal.timeout(30000)))chunks.push(Buffer.from(chunk));if(!chunks.length)throw Error("Empty template");this.cache.set(phrase.text,chunks);}
    this.source="explicit-alternative";
   }
   await this.base.warm();this.startupMs=performance.now()-started;
  })();return this.warming;
 }
 private parts(text:string):Part[]{
  if(!this.enabled||!this.cache.size)return [{text,cached:false}];
  const result:Part[]=[];let at=0;const noteAt=text.search(/\b(?:notes:|special instructions:)/i);
  while(at<text.length){
   let next:{at:number;text:string}|undefined;
   for(const phrase of FIXED_PHRASES){
    if(phrase.id.startsWith("ack_")||phrase.id==="stall"||phrase.id==="failure")continue;
    const index=text.startsWith(phrase.text,at)?at:-1;if(index<0||noteAt>=0&&index>=noteAt)continue;
    const left=index===0||!/[a-z]/i.test(text[index-1]),end=index+phrase.text.length,right=!/[a-z]$/i.test(phrase.text)||end===text.length||!/[a-z]/i.test(text[end]);
    // Never turn a following question mark/period into its own TTS request.
    const rest=text.slice(end);if(rest&&!/[a-z0-9]/i.test(rest)&&/^(?:item_|modifier_)/.test(phrase.id))continue;
    if(left&&right&&(!next||index<next.at||index===next.at&&phrase.text.length>next.text.length))next={at:index,text:phrase.text};
   }
   if(!next){const rest=text.slice(at),suffix=FIXED_PHRASES.find(phrase=>phrase.id==="anything_else"&&rest.endsWith(phrase.text)&&rest.length>phrase.text.length);
    if(suffix){result.push({text:rest.slice(0,-suffix.text.length),cached:false},{text:suffix.text,cached:true});}
    else result.push({text:rest,cached:false});break;}
   result.push({text:next.text,cached:true});at=next.at+next.text.length;
  }
  if(this.acknowledgement&&result.some(part=>!part.cached))result.unshift({text:"Okay. ",cached:true,ack:true});
  return result;
 }
 plan(text:string){const parts=this.parts(text);return {firstByteCached:!!parts[0]?.cached,cachedSegments:parts.filter(part=>part.cached).length,dynamicCharacters:parts.filter(part=>!part.cached).reduce((sum,part)=>sum+part.text.length,0),acknowledgementBytes:parts[0]?.ack?(this.cache.get(parts[0].text)?.reduce((sum,chunk)=>sum+chunk.length,0)??0):0};}
 stats(){return {enabled:this.enabled,ready:!this.enabled||this.cache.size===FIXED_PHRASES.length,entries:this.cache.size,bytes:[...this.cache.values()].flat().reduce((sum,chunk)=>sum+chunk.length,0),startupMs:this.startupMs,staticLoadMs:this.staticLoadMs,source:this.source,startupCharacters:0,acknowledgement:this.acknowledgement,buffering:this.buffering};}
 async *speak(text:string,signal:AbortSignal,observe?:TtsObserver){
  signal.throwIfAborted();const parts=this.parts(text),abort=new AbortController(),linked=AbortSignal.any([signal,abort.signal]);
  const informative=parts.filter(part=>!part.ack),short=text.length<=this.buffering.shortCharacters,hasRemote=informative.some(part=>!part.cached);
  let queue:Buffer[]=[],bytes=0,done=false,failure:unknown,dynamicReady=!hasRemote,wake:()=>void=()=>{},availableUntil=performance.now();
  const push=(chunk:Buffer)=>{queue.push(chunk);bytes+=chunk.length;wake();};
  // Consume the provider independently of playback/yields, so synthesis keeps
  // progressing while a neutral acknowledgement or stall prompt is playing.
  const producer=(async()=>{try{for(const part of informative){
    if(part.cached)for(const chunk of this.cache.get(part.text)!)push(chunk);
    else for await(const chunk of this.base.speak(part.text,linked,observe)){dynamicReady=true;push(chunk);}
  }}catch(error){failure=error;}finally{done=true;wake();}})();
  try{
   for(const part of parts.filter(part=>part.ack)){
    observe?.({type:"segment",kind:"neutral"});
    for(const chunk of this.cache.get(part.text)!){availableUntil=Math.max(availableUntil,performance.now())+chunk.length/48;yield chunk;}
   }
   while(true){
    signal.throwIfAborted();
    const ready=done||!short&&dynamicReady&&bytes>=this.buffering.targetMs*48;
    if(ready&&bytes&&!(failure&&short)){
      const batch=Buffer.concat(queue);queue=[];bytes=0;
      observe?.({type:"jitter_ready",bufferedMs:batch.length/48,wholeShortReply:short});observe?.({type:"segment",kind:"informative"});
      availableUntil=Math.max(availableUntil,performance.now())+batch.length/48;yield batch;
    }
    if(done){if(failure){
      signal.throwIfAborted();const fallback=this.cache.get("I'm having trouble speaking. Please check the text reply.");
      if(!fallback?.length)throw failure;
      const reason=failure instanceof Error&&/timeout/i.test(failure.message)?"timeout":failure instanceof Error&&/connection|socket/i.test(failure.message)?"connection":"http";
      observe?.({type:"terminal_failure",reason});observe?.({type:"segment",kind:"neutral"});
      for(const chunk of fallback)yield chunk;return;
    }break;}
    const delay=Math.max(0,availableUntil+this.buffering.stallMs-performance.now());
    let timer:ReturnType<typeof setTimeout>|undefined;
    const result=await new Promise<"data"|"stall">((resolve)=>{wake=()=>resolve("data");timer=setTimeout(()=>resolve("stall"),delay);if(done||(!short&&dynamicReady&&bytes>=this.buffering.targetMs*48))resolve("data");});
    clearTimeout(timer);wake=()=>{};signal.throwIfAborted();
    if(result==="stall"&&!done){
      const prompt=this.cache.get("One moment. ");if(prompt?.length){observe?.({type:"stall"});observe?.({type:"segment",kind:"neutral"});for(const chunk of prompt){availableUntil=Math.max(availableUntil,performance.now())+chunk.length/48;yield chunk;}}
      else availableUntil=performance.now();
    }
   }
  }finally{abort.abort();await producer;}
 }
 close(){this.base.close();this.cache.clear();}
}
