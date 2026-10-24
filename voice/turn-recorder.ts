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
      this.rows.set(generation,row);this.publish(row);
    }
    if(event.type==="audio_start"){
      const row=this.rows.get(Number(event.generation));if(row){row.ttsFirstByteMs=Number(event.ttsFirstByteMs);row.firstByteCached=!!event.firstByteCached;row.acknowledgement=!!event.acknowledgement;this.publish(row);}
    }
    if(event.type==="content_start"){const row=this.rows.get(Number(event.generation));if(row){row.contentFirstByteMs=Number(event.contentFirstByteMs);this.publish(row);}}
    if(event.type==="error")for(const row of this.rows.values())if(row.status==="awaiting_audio"){row.status="failed";this.publish(row);}
  }
  latency(generation:number,timing:Record<string,unknown>) {
    const row=this.rows.get(generation),keys=["totalMs","endpointAndUplinkMs","engineMs","ttsFirstByteMs","returnNetworkMs","browserRttMs","clockUncertaintyMs"] as const;
    if(!row||!timing||!keys.every(key=>typeof timing[key]==="number"&&Number.isFinite(timing[key])&&Math.abs(timing[key] as number)<60000))return;
    row.latency=Object.fromEntries(keys.map(key=>[key,timing[key]])) as LatencyStages;row.status="first_audio";this.publish(row);
  }
  end(){for(const row of this.rows.values())if(row.status==="awaiting_audio"){row.status="no_audio";this.publish(row);}}
}
