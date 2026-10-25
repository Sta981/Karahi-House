import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { auraPronunciation, splitSpeech } from "./pronunciation.mjs";
import type { Tts } from "./contracts";
import { AuraWsTts } from "./aura-ws";
import {AuraHttpPool,type AuraRequest} from "./aura-http";
import type {TtsObserver} from "./contracts";

export class KokoroTts implements Tts {
  name = "kokoro";
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private id = 0;
  private tail: Promise<unknown> = Promise.resolve();
  warm() {
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const child = fork(path.resolve("voice/kokoro-worker.mjs"), [], { execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", ...{ windowsHide: true } });
      this.child = child;
      const timer = setTimeout(() => { child.kill(); reject(Error("Kokoro warmup timed out (model download or CPU).")); }, 300000);
      child.on("message", (msg: any) => {
        if (msg.type === "ready") { clearTimeout(timer); resolve(); }
        if (msg.type === "failure" && !msg.id) { clearTimeout(timer); reject(Error("Kokoro load failed; check model download and ONNX CPU runtime.")); }
      });
      child.on("error", () => { clearTimeout(timer); reject(Error("Kokoro worker failed")); });
      child.on("exit", () => { clearTimeout(timer); this.child = undefined; this.starting = undefined; reject(Error("Kokoro worker exited")); });
    });
    return this.starting;
  }
  private generate(text: string, signal: AbortSignal): Promise<Buffer> {
    const task = this.tail.catch(() => {}).then(async () => {
      signal.throwIfAborted(); await this.warm(); signal.throwIfAborted();
      const child = this.child!, id = ++this.id;
      return new Promise<Buffer>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
        const onExit = () => { cleanup(); reject(Error("Kokoro worker exited")); };
        const onMessage = (msg: any) => {
          if (msg.id !== id) return; cleanup();
          if (msg.type === "audio") resolve(Buffer.from(msg.pcm)); else reject(Error("Kokoro synthesis failed"));
        };
        const timer = setTimeout(() => { cleanup(); child.kill(); reject(Error("Kokoro synthesis timeout")); }, 30000);
        child.on("message", onMessage); child.once("exit", onExit); child.send({ type: "speak", id, text });
      });
    });
    // Cancelled CPU jobs finish in isolation; stale audio is discarded. Queue is
    // serialized, so rapidly interrupting cannot launch parallel CPU syntheses.
    this.tail = task; return task;
  }
  async *speak(text: string, signal: AbortSignal) {
    for (const part of splitSpeech(text)) {
      signal.throwIfAborted(); const pcm = await this.generate(part, signal); signal.throwIfAborted();
      for (let offset = 0; offset < pcm.length; offset += 3840) { signal.throwIfAborted(); yield pcm.subarray(offset, offset + 3840); }
    }
  }
  close() { this.child?.kill(); }
}
export class AuraTts implements Tts {
  name = "aura-2";
  private pool?:AuraHttpPool;private request:AuraRequest;
  constructor(private timeoutMs=8000,transport?:AuraRequest){this.pool=transport?undefined:new AuraHttpPool();this.request=transport??this.pool!.request;}
  async warm() { if (!process.env.DEEPGRAM_API_KEY?.trim()) throw Error("DEEPGRAM_API_KEY is missing"); }
  async *speak(text: string, signal: AbortSignal,observe?:TtsObserver) {
    // Escaped IPA objects expand request length. Split BEFORE the documented
    // 2000-character Aura limit; preserve every part of a long order read-back.
    for (const [index,part] of splitSpeech(text, 100).entries()) yield* this.speakPart(part, signal,observe,index);
  }
  private async *speakPart(text: string, signal: AbortSignal,observe?:TtsObserver,part=0) {
    const key = process.env.DEEPGRAM_API_KEY?.trim(); if (!key) throw Error("DEEPGRAM_API_KEY is missing");
    const url = new URL("https://api.deepgram.com/v1/speak");
    for (const [key, value] of Object.entries({ model: "aura-2-thalia-en", encoding: "linear16", sample_rate: "24000", container: "none", mip_opt_out: "true" })) url.searchParams.set(key, value);
    for(let attempt=1;attempt<=2;attempt++){
      signal.throwIfAborted();const start=performance.now(),deadline=new AbortController(),linked=AbortSignal.any([signal,deadline.signal]);let firstByteMs:number|undefined,previous=start;
      let idle:ReturnType<typeof setTimeout>;const expire=()=>deadline.abort(new DOMException("Aura inactivity timeout","TimeoutError"));
      const progress=()=>{clearTimeout(idle);idle=setTimeout(expire,this.timeoutMs);};progress();
      const hardLimit=setTimeout(expire,Math.max(60000,this.timeoutMs*2));const clear=()=>{clearTimeout(idle);clearTimeout(hardLimit);};
      const chunks:Buffer[]=[];const emit:TtsObserver=event=>observe?.({...event,part,attempt});emit({type:"attempt_start",atMs:0});
      try{
        const response=await this.request(url,{signal:linked,headers:{Authorization:`Token ${key}`,"Content-Type":"application/json"},body:JSON.stringify({text:auraPronunciation(text)})},emit);
        progress();
        emit({type:"headers",atMs:performance.now()-start});
        if(!response.ok||!response.body){await response.body?.cancel();throw Error(`Aura synthesis HTTP ${response.status}`);}
        for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){
          signal.throwIfAborted();if(chunk.length)progress();const now=performance.now();firstByteMs??=now-start;
          chunks.push(Buffer.from(chunk));emit({type:"raw_chunk",atMs:now-start,gapMs:now-previous,bytes:chunk.length});previous=now;
        }
        const pcm=Buffer.concat(chunks);if(!pcm.length||pcm.length%2)throw Error("Incomplete PCM sample from Aura");
        emit({type:"attempt_end",ok:true,totalMs:performance.now()-start,firstByteMs,chunks:chunks.length,bytes:pcm.length});
        // Atomic sentence-sized parts make a mid-body timeout safe to retry:
        // no partial words or order facts have reached the caller yet.
        clear();yield pcm;return;
      }catch(error){
        const timeout=deadline.signal.aborted||error instanceof Error&&/timeout/i.test(error.name+error.message);
        const connection=error instanceof Error&&/ECONNRESET|EPIPE|ECONNREFUSED|socket|fetch failed/i.test(error.message);
        const reason=signal.aborted?"aborted":timeout?"timeout":connection?"connection":"http";
        emit({type:"attempt_end",ok:false,reason,totalMs:performance.now()-start,firstByteMs,chunks:chunks.length});
        if(attempt===1&&!signal.aborted&&(timeout||connection)){emit({type:"retry",reason});continue;}
        signal.throwIfAborted();throw Error(timeout?"Aura synthesis timeout after one retry":connection?"Aura connection failed after one retry":"Aura synthesis failed");
      }finally{clear();}
    }
  }
  close() {this.pool?.close();}
}
export function makeTts(name: string, transport = process.env.VOICE_AURA_TRANSPORT?.trim() || "http"): Tts {
  if (name === "kokoro") return new KokoroTts();
  if (name === "aura-2") {
    if(transport==="http")return new AuraTts();
    if(transport==="ws")return new AuraWsTts();
    throw Error("VOICE_AURA_TRANSPORT must be http or ws");
  }
  throw Error("VOICE_TTS_PROVIDER must be kokoro or aura-2");
}
