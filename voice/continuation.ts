import { performance } from "node:perf_hooks";
import type { SttEvent } from "./contracts";
import { phraseCompletion,type AdaptiveWait } from "./phrase-completeness";
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
  constructor(private wait: number|AdaptiveWait, private emit: (event:Final)=>void) {}
  private duration(){if(typeof this.wait==="number")return this.wait;const kind=phraseCompletion(this.pending?.text??"");return this.wait[`${kind}Ms`];}
  audio(pcm:Buffer) {
    this.samples += pcm.length/2;
    this.audioOriginAt ??= performance.now()-this.samples/16;
    let energy=0;for(let i=0;i<pcm.length;i+=2)energy+=(pcm.readInt16LE(i)/32768)**2;
    if(Math.sqrt(energy/(pcm.length/2))>.018) {
      if(performance.now()-this.lastEnergyAt>250)this.resumedAtSeconds=(this.samples-pcm.length/2)/16000;
      this.lastEnergyAt=performance.now();
      this.lastVoiceSeconds=this.samples/16000;this.lastVoiceAt=performance.now();
      if(this.timer)clearTimeout(this.timer);this.timer=undefined;
    }
    this.schedule();
  }
  final(event:Final) {
    if(this.closed)return;
    if(this.wait===0){this.emit(event);return;}
    this.pending=this.pending?{...event,text:`${this.pending.text} ${event.text}`,endpointReason:`${event.endpointReason??"provider_final"}+continuation_merged`}:event;
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
      this.emit({...event,endpointReason:`${event.endpointReason??"provider_final"}+${typeof this.wait==="number"?"fixed":`adaptive_${phraseCompletion(event.text)}`}_${settleMs}ms`});
    },delay);
  }
  close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.pending=undefined;}
}
