import { performance } from "node:perf_hooks";
import type { SttEvent } from "./contracts";
import { phraseCompletion,type AdaptiveWait } from "./phrase-completeness";
import { speechText } from "../lib/speech";
type Final = Extract<SttEvent,{type:"final"}>;
// Transport-only pause guard. Provider endpoints remain provisional until there
// is sufficient local silence and the final covers all subsequent speech.
// No cart operation or spoken reply is produced by a provisional endpoint.
export class ContinuationGuard {
  private pending?: Final;
  private timer?: ReturnType<typeof setTimeout>;
  private samples = 0;
  private lastVoiceSeconds = 0;
  private lastVoiceAt = performance.now();
  private lastEnergyAt = -Infinity;
  private resumedAtSeconds = 0;
  private audioOriginAt?: number;
  private closed = false;
  private emitted?:{event:Final;at:number};private mergeBase?:Final;private voicedFrames=0;
  constructor(private wait: number|AdaptiveWait, private emit: (event:Final)=>void,private continuation?:{windowMs:number;onResume:()=>void},private answers?:()=>string[]) {}
  confirmedSpeech(){
    if(this.closed||this.mergeBase||!this.continuation||!this.emitted||performance.now()-this.emitted.at>this.continuation.windowMs)return;
    if(/\b(?:that'?s all|that'?s it|nothing else|checkout|yes|no|correct)\s*[.!]?$/i.test(this.emitted.event.text))return;
    this.mergeBase=this.emitted.event;this.continuation.onResume();
  }
  private isAnswer(){const heard=speechText(this.pending?.text??"").replace(/^(?:yes|yeah) please$/,"yes");return !!this.answers?.().some(answer=>speechText(answer)===heard);}
  private duration(){if(typeof this.wait==="number")return this.wait;if(this.isAnswer())return this.wait.answerMs??600;const kind=phraseCompletion(this.pending?.text??"");return this.wait[`${kind}Ms`];}
  audio(pcm:Buffer) {
    this.samples += pcm.length/2;
    this.audioOriginAt ??= performance.now()-this.samples/16;
    let energy=0;for(let i=0;i<pcm.length;i+=2)energy+=(pcm.readInt16LE(i)/32768)**2;
    if(Math.sqrt(energy/(pcm.length/2))>.024) {
      this.voicedFrames++;if(this.voicedFrames===4)this.confirmedSpeech();
      if(performance.now()-this.lastEnergyAt>250)this.resumedAtSeconds=(this.samples-pcm.length/2)/16000;
      this.lastEnergyAt=performance.now();
      this.lastVoiceSeconds=this.samples/16000;this.lastVoiceAt=performance.now();
      if(this.timer)clearTimeout(this.timer);this.timer=undefined;
    }else this.voicedFrames=0;
    this.schedule();
  }
  final(event:Final) {
    if(this.closed)return;
    if(this.wait===0){this.emit(event);return;}
    if(this.mergeBase&&!this.pending){
      const base=this.mergeBase.text,fragment=event.text.toLowerCase().startsWith(base.toLowerCase())?event.text.slice(base.length).trim():event.text;
      event={...event,text:`${base} ${fragment}`.trim(),continuationOf:base,fragment};this.mergeBase=undefined;
    }
    this.pending=this.pending?{...event,text:`${this.pending.text} ${event.text}`,continuationOf:this.pending.continuationOf,fragment:this.pending.fragment?`${this.pending.fragment} ${event.text}`:undefined,endpointReason:`${event.endpointReason??"provider_final"}+continuation_merged`}:event;
    if(this.timer)clearTimeout(this.timer);this.timer=undefined;
    if(this.audioOriginAt!==undefined&&event.audioEndSeconds!==null)this.lastVoiceAt=Math.max(this.lastVoiceAt,this.audioOriginAt+event.audioEndSeconds*1000);
    this.schedule();
  }
  partial(text:string) { return this.pending ? `${this.pending.text} ${text}` : text; }
  private schedule() {
    if(this.closed||!this.pending||this.timer)return;
    const end=this.pending.audioEndSeconds;
    // Resumed audio cannot be ignored just because an older final is queued.
    // Wait for a new provider final that covers it; never commit interim words.
    if(end!==null&&this.resumedAtSeconds>end+.2)return;
    const settleMs=this.duration();
    const delay=Math.max(0,settleMs-(performance.now()-this.lastVoiceAt));
    this.timer=setTimeout(()=>{
      this.timer=undefined;
      if(!this.pending||this.closed)return;
      if(performance.now()-this.lastVoiceAt<this.duration()-1){this.schedule();return;}
      const event=this.pending;this.pending=undefined;
      this.emitted={event,at:performance.now()};
      this.emit({...event,endpointReason:`${event.endpointReason??"provider_final"}+${typeof this.wait==="number"?"fixed":`adaptive_${this.isAnswerText(event.text)?"answer":phraseCompletion(event.text)}`}_${settleMs}ms`});
    },delay);
  }
  private isAnswerText(text:string){return !!this.answers?.().some(answer=>speechText(answer)===speechText(text));}
  close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.pending=undefined;this.emitted=undefined;this.mergeBase=undefined;}
}
