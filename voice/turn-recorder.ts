import { safeTranscript,loggedCart,type VoiceLogRow,type LatencyStages } from "./turn-log";
import type { VoiceRuntimeInfo } from "./runtime-info";
import {romanTranscript} from "./roman-transcript";
export class TurnRecorder {
  private rows=new Map<number,VoiceLogRow>();
  private transcript="";
  private roman="";
  constructor(private meta:{callId:string;location:string;model:string;profile:string;runtime?:VoiceRuntimeInfo},private publish:(row:VoiceLogRow)=>void){}
  event(event:Record<string,unknown>) {
    if(event.type==="tts_telemetry"){
      const row=this.rows.get(Number(event.generation)),data=event.event as Record<string,unknown>|undefined;if(!row||!data)return;
      const allowed=["type","atMs","gapMs","bytes","attempt","part","totalMs","firstByteMs","chunks","reused","ok","reason","phase","kind","bufferedMs","wholeShortReply","observedMs"];
      const values=Object.fromEntries(Object.entries(data).filter(([key,value])=>allowed.includes(key)&&(typeof value==="number"&&Number.isFinite(value)||typeof value==="boolean"||typeof value==="string"&&/^[a-z_]{1,32}$/.test(value))));
      row.ttsChunks??=[];if(row.ttsChunks.length<2048)row.ttsChunks.push(values as Record<string,number|string|boolean>);return;
    }
    if(event.type==="transcript"){
      const raw=safeTranscript(String(event.text)),roman=safeTranscript(romanTranscript(raw));
      const phone=/\[(?:callback turn|phone)(?: redacted)?\]/i.test(roman);
      this.transcript=phone?"[callback turn redacted]":raw;this.roman=phone?"[callback turn redacted]":roman;
    }
    if(event.type==="reply"){
      const generation=Number(event.generation);
      const row:VoiceLogRow={turnId:`${this.meta.callId}:${generation}`,atUtc:new Date().toISOString(),location:this.meta.location,model:this.meta.model,endpointProfile:this.meta.profile,transcript:this.transcript,matchedCart:loggedCart(event.cart as Record<string,any>[]),endpointReason:String(event.endpointReason??"unknown"),status:"awaiting_audio",engineMs:Number(event.engineMs),ttsFirstByteMs:null,firstByteCached:false,speculativeHit:!!event.speculativeHit,preparationMs:Number(event.preparationMs??0),latency:null};
      row.romanTranscript=this.roman;
      if(this.meta.runtime)row.runtime=structuredClone(this.meta.runtime);
      row.replyTextLength=String(event.text??"").length;this.rows.set(generation,row);this.publish(row);
      const profile=event.engineProfile as Record<string,unknown>|undefined;
      if(profile&&["recognitionMs","dialogMs","wallMs","cpuMs","cartLinesBefore"].every(key=>typeof profile[key]==="number"&&Number.isFinite(profile[key]))){row.engineProfile={recognitionMs:Number(profile.recognitionMs),dialogMs:Number(profile.dialogMs),wallMs:Number(profile.wallMs),cpuMs:Number(profile.cpuMs),phase:String(profile.phase).slice(0,20),cartLinesBefore:Number(profile.cartLinesBefore)};this.publish(row);}
      if(typeof event.supersedesGeneration==="number"){const old=this.rows.get(event.supersedesGeneration);if(old){old.status="no_audio";old.endpointReason+="+revised_by_continuation";this.publish(old);}}
    }
    if(event.type==="audio_start"){
      const row=this.rows.get(Number(event.generation));if(row){row.ttsFirstByteMs=Number(event.ttsFirstByteMs);row.firstByteCached=!!event.firstByteCached;row.acknowledgement=!!event.acknowledgement;if(row.acknowledgement)row.ackFirstByteMs=row.ttsFirstByteMs;this.publish(row);}
    }
    if(event.type==="content_start"){const row=this.rows.get(Number(event.generation));if(row){row.contentFirstByteMs=Number(event.contentFirstByteMs);this.publish(row);}}
    if(event.type==="audio_end"){const row=this.rows.get(Number(event.generation));if(row)this.publish(row);}
    if(event.type==="error")for(const [generation,row]of this.rows)if(event.generation===generation||row.status==="awaiting_audio"){row.status="failed";this.publish(row);}
  }
  playback(generation:number,metrics:Record<string,any>){
    const row=this.rows.get(generation);if(!row||!metrics)return;
    metrics={...metrics,gapCount:metrics.gapCount??0,stallPrompts:metrics.stallPrompts??0};
    const numeric=["replyTextLength","receivedChunks","droppedChunks","lateChunks","activeChunks","maxGapMs","gapCount","stallPrompts"];
    if(!numeric.every(key=>typeof metrics[key]==="number"&&Number.isFinite(metrics[key])&&metrics[key]>=0&&metrics[key]<1000000))return;
    const trigger=metrics.trigger&&["browser_vad","manual","server_turn","continuation","tts_error"].includes(metrics.trigger.source)?{source:metrics.trigger.source,...Object.fromEntries(["energy","threshold","speechMs"].filter(key=>typeof metrics.trigger[key]==="number"&&Number.isFinite(metrics.trigger[key])).map(key=>[key,metrics.trigger[key]]))}:undefined;
    row.playback={...Object.fromEntries(numeric.map(key=>[key,metrics[key]])),replyTextLength:row.replyTextLength??0,finished:metrics.finished===true,serverAudioEnded:metrics.serverAudioEnded===true,interruptedByBargeIn:metrics.interruptedByBargeIn===true,failed:metrics.failed===true,acknowledgementGapMs:typeof metrics.acknowledgementGapMs==="number"&&Number.isFinite(metrics.acknowledgementGapMs)?Math.max(0,metrics.acknowledgementGapMs):null,...(trigger?{trigger}:{})} as any;this.publish(row);
  }
  latency(generation:number,timing:Record<string,unknown>) {
    const row=this.rows.get(generation),keys=["totalMs","endpointAndUplinkMs","engineMs","ttsFirstByteMs","returnNetworkMs","browserRttMs","clockUncertaintyMs"] as const;
    if(!row||!timing||!keys.every(key=>typeof timing[key]==="number"&&Number.isFinite(timing[key])&&Math.abs(timing[key] as number)<60000))return;
    row.latency=Object.fromEntries(keys.map(key=>[key,timing[key]])) as LatencyStages;if(row.status!=="failed")row.status="first_audio";this.publish(row);
  }
  audioTiming(generation:number,timing:Record<string,unknown>){
    const row=this.rows.get(generation);if(!row||!timing)return;
    const values=Object.fromEntries(Object.entries(timing).filter(([key,value])=>["speechToFirstByteMs","speechToFirstPlaybackMs","speechToInformativeByteMs","speechToInformativePlaybackMs"].includes(key)&&typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<120000));
    row.audioTiming={...row.audioTiming,...values};this.publish(row);
  }
  end(){for(const row of this.rows.values())if(row.status==="awaiting_audio"){row.status="no_audio";this.publish(row);}}
}
