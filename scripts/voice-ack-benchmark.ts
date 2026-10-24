import { loadEnvFile } from "node:process";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { AuraWsTts } from "../voice/aura-ws";
import { FixedAudioTts } from "../voice/fixed-audio";
import { newState,runTurn } from "../lib/dialog";
async function main(){
 loadEnvFile(".env.local");const base=new AuraWsTts(),off=new FixedAudioTts(base,true,false),on=new FixedAudioTts(base,true,true);const rows:any[]=[];
 const phrases=["where are you located","what are your hours","is pickup available","how long is the wait","do you do delivery","halal"].map(text=>runTurn(newState(),text).reply);
 let failure:string|null=null;
 const save=()=>writeFileSync("eval/results/voice-ack.json",JSON.stringify({kind:"paired-live-Aura-synthetic-FAQ-templates-not-full-call",location:"Lahore local",startup:on.stats(),rows,failure,audioStored:false,note:"First byte can be a neutral acknowledgement. Content availability and acknowledgement playback duration are separate; this is not a full-call latency measurement."},null,2)+"\n");
 const measure=async(tts:FixedAudioTts,text:string)=>{
  const started=performance.now(),plan=tts.plan(text);let bytes=0,first:number|null=null,content:number|null=null;
  for await(const chunk of tts.speak(text,AbortSignal.timeout(30000))){first??=performance.now()-started;if(bytes>=plan.acknowledgementBytes)content??=performance.now()-started;bytes+=chunk.length;}
  return {firstByteMs:first,contentFirstByteMs:content,bytes,acknowledgementMs:plan.acknowledgementBytes/48,plan};
 };
 try{await off.warm();await on.warm();for(const [index,text]of phrases.entries()){
   const first=index%2?await measure(on,text):await measure(off,text),second=index%2?await measure(off,text):await measure(on,text);
   rows.push({text,off:index%2?second:first,on:index%2?first:second});save();console.log(`Acknowledgement pair ${index+1}/${phrases.length}.`);
  }
  writeFileSync("eval/results/voice-ack.json",JSON.stringify({kind:"paired-live-Aura-synthetic-FAQ-templates-not-full-call",location:"Lahore local",startup:on.stats(),rows,audioStored:false,note:"First byte can be a neutral acknowledgement. Content availability and acknowledgement playback duration are separate; this is not a full-call latency measurement."},null,2)+"\n");
 }catch(error){failure=error instanceof Error&&/^(?:Aura [a-zA-Z -]+|The operation was aborted due to timeout)$/.test(error.message)?error.message:"Synthesis failed (provider payload excluded)";throw error;}finally{save();base.close();}
}
void main().catch(()=>{console.error("Acknowledgement benchmark failed; no provider payload logged.");process.exitCode=1;});
