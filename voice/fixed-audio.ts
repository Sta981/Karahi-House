import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Tts } from "./contracts";
import { FIXED_PHRASES,AUDIO_IDENTITY } from "./audio-catalog";
export { FIXED_PHRASES } from "./audio-catalog";
type Part={text:string;cached:boolean;ack?:boolean};
export class FixedAudioTts implements Tts {
 readonly name:string;readonly cacheIdentity=AUDIO_IDENTITY;
 private cache=new Map<string,Buffer[]>();private warming?:Promise<void>;private startupMs=0;private staticLoadMs=0;private source="disabled";
 constructor(private base:Tts,private enabled=true,private acknowledgement=process.env.VOICE_ACKNOWLEDGEMENT!=="false",private directory=path.resolve("public/voice-audio")){this.name=base.name;}
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
    if(phrase.id.startsWith("ack_"))continue;
    const index=text.startsWith(phrase.text,at)?at:-1;if(index<0||noteAt>=0&&index>=noteAt)continue;
    const left=index===0||!/[a-z]/i.test(text[index-1]),end=index+phrase.text.length,right=!/[a-z]$/i.test(phrase.text)||end===text.length||!/[a-z]/i.test(text[end]);
    // Never turn a following question mark/period into its own TTS request.
    const rest=text.slice(end);if(rest&&!/[a-z0-9]/i.test(rest)&&/^(?:item_|modifier_)/.test(phrase.id))continue;
    if(left&&right&&(!next||index<next.at||index===next.at&&phrase.text.length>next.text.length))next={at:index,text:phrase.text};
   }
   if(!next){result.push({text:text.slice(at),cached:false});break;}
   result.push({text:next.text,cached:true});at=next.at+next.text.length;
  }
  if(this.acknowledgement&&!result[0]?.cached)result.unshift({text:"Okay. ",cached:true,ack:true});
  return result;
 }
 plan(text:string){const parts=this.parts(text);return {firstByteCached:!!parts[0]?.cached,cachedSegments:parts.filter(part=>part.cached).length,dynamicCharacters:parts.filter(part=>!part.cached).reduce((sum,part)=>sum+part.text.length,0),acknowledgementBytes:parts[0]?.ack?(this.cache.get(parts[0].text)?.reduce((sum,chunk)=>sum+chunk.length,0)??0):0};}
 stats(){return {enabled:this.enabled,ready:!this.enabled||this.cache.size===FIXED_PHRASES.length,entries:this.cache.size,bytes:[...this.cache.values()].flat().reduce((sum,chunk)=>sum+chunk.length,0),startupMs:this.startupMs,staticLoadMs:this.staticLoadMs,source:this.source,startupCharacters:0,acknowledgement:this.acknowledgement};}
 async *speak(text:string,signal:AbortSignal){
  signal.throwIfAborted();const parts=this.parts(text),abort=new AbortController(),linked=AbortSignal.any([signal,abort.signal]);
  let prefetched:{index:number;iterator:AsyncIterator<Buffer>;first:Promise<IteratorResult<Buffer>>}|undefined;
  try{for(let i=0;i<parts.length;i++){
   signal.throwIfAborted();const part=parts[i];
   if(part.cached){
    const next=parts.findIndex((part,index)=>index>i&&!part.cached);
    if(!prefetched&&next>=0){const iterator=this.base.speak(parts[next].text,linked)[Symbol.asyncIterator](),first=iterator.next();first.catch(()=>{});prefetched={index:next,iterator,first};}
    for(const chunk of this.cache.get(part.text)!){signal.throwIfAborted();yield chunk;}
   }else if(prefetched?.index===i){
    const current=prefetched;prefetched=undefined;let done=false;
    try{let value=await current.first;while(!value.done){signal.throwIfAborted();yield value.value;value=await current.iterator.next();}done=true;}finally{if(!done)abort.abort();await current.iterator.return?.().catch(()=>{});}
   }else yield* this.base.speak(part.text,linked);
  }}finally{abort.abort();if(prefetched){await prefetched.first.catch(()=>{});await prefetched.iterator.return?.().catch(()=>{});}}
 }
 close(){this.base.close();this.cache.clear();}
}
