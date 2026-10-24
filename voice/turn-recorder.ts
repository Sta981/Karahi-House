import { safeTranscript,loggedCart,type VoiceLogRow,type LatencyStages } from "./turn-log";
export class TurnRecorder {
  private rows=new Map<number,VoiceLogRow>();
  private transcript="";
  constructor(private meta:{callId:string;location:string;model:string;profile:string},private publish:(row:VoiceLogRow)=>void){}
  event(event:Record<string,unknown>) {
    if(event.type==="transcript")this.transcript=safeTranscript(String(event.text));
    if(event.type==="reply"){
      const generation=Number(event.generation);
      const row:VoiceLogRow={turnId:`${this.meta.callId}:${generation}`,atUtc:new Date().toISOString(),location:this.meta.location,model:this.meta.model,endpointProfile:this.meta.profile,transcript:this.transcript,matchedCart:loggedCart(event.cart as Record<string,any>[]),endpointReason:String(event.endpointReason??"unknown"),status:"awaiting_audio",engineMs:Number(event.engineMs),ttsFirstByteMs:null,firstByteCached:false,speculativeHit:!!event.speculativeHit,preparationMs:Number(event.preparationMs??0),latency:null};
      row.replyTextLength=String(event.text??"").length;this.rows.set(generation,row);this.publish(row);
      const profile=event.engineProfile as Record<string,unknown>|undefined;
      if(profile&&["recognitionMs","dialogMs","wallMs","cpuMs","cartLinesBefore"].every(key=>typeof profile[key]==="number"&&Number.isFinite(profile[key]))){row.engineProfile={recognitionMs:Number(profile.recognitionMs),dialogMs:Number(profile.dialogMs),wallMs:Number(profile.wallMs),cpuMs:Number(profile.cpuMs),phase:String(profile.phase).slice(0,20),cartLinesBefore:Number(profile.cartLinesBefore)};this.publish(row);}
      if(typeof event.supersedesGeneration==="number"){const old=this.rows.get(event.supersedesGeneration);if(old){old.status="no_audio";old.endpointReason+="+revised_by_continuation";this.publish(old);}}
    }
    if(event.type==="audio_start"){
      const row=this.rows.get(Number(event.generation));if(row){row.ttsFirstByteMs=Number(event.ttsFirstByteMs);row.firstByteCached=!!event.firstByteCached;row.acknowledgement=!!event.acknowledgement;this.publish(row);}
    }
    if(event.type==="content_start"){const row=this.rows.get(Number(event.generation));if(row){row.contentFirstByteMs=Number(event.contentFirstByteMs);this.publish(row);}}
    if(event.type==="error")for(const row of this.rows.values())if(row.status==="awaiting_audio"){row.status="failed";this.publish(row);}
  }
  playback(generation:number,metrics:Record<string,any>){
    const row=this.rows.get(generation);if(!row||!metrics)return;
    const numeric=["replyTextLength","receivedChunks","droppedChunks","lateChunks","activeChunks","maxGapMs"];
    if(!numeric.every(key=>typeof metrics[key]==="number"&&Number.isFinite(metrics[key])&&metrics[key]>=0&&metrics[key]<1000000))return;
    const trigger=metrics.trigger&&["browser_vad","manual","server_turn","continuation","tts_error"].includes(metrics.trigger.source)?{source:metrics.trigger.source,...Object.fromEntries(["energy","threshold","speechMs"].filter(key=>typeof metrics.trigger[key]==="number"&&Number.isFinite(metrics.trigger[key])).map(key=>[key,metrics.trigger[key]]))}:undefined;
    row.playback={...Object.fromEntries(numeric.map(key=>[key,metrics[key]])),replyTextLength:row.replyTextLength??0,finished:metrics.finished===true,serverAudioEnded:metrics.serverAudioEnded===true,interruptedByBargeIn:metrics.interruptedByBargeIn===true,failed:metrics.failed===true,acknowledgementGapMs:typeof metrics.acknowledgementGapMs==="number"&&Number.isFinite(metrics.acknowledgementGapMs)?Math.max(0,metrics.acknowledgementGapMs):null,...(trigger?{trigger}:{})} as any;this.publish(row);
  }
  latency(generation:number,timing:Record<string,unknown>) {
    const row=this.rows.get(generation),keys=["totalMs","endpointAndUplinkMs","engineMs","ttsFirstByteMs","returnNetworkMs","browserRttMs","clockUncertaintyMs"] as const;
    if(!row||!timing||!keys.every(key=>typeof timing[key]==="number"&&Number.isFinite(timing[key])&&Math.abs(timing[key] as number)<60000))return;
    row.latency=Object.fromEntries(keys.map(key=>[key,timing[key]])) as LatencyStages;row.status="first_audio";this.publish(row);
  }
  end(){for(const row of this.rows.values())if(row.status==="awaiting_audio"){row.status="no_audio";this.publish(row);}}
}
