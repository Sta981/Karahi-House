import {loadEnvFile} from "node:process";
import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {AuraTts} from "../voice/tts";
import {FixedAudioTts} from "../voice/fixed-audio";
import {newState,runTurn} from "../lib/dialog";
async function main(){
 loadEnvFile(".env.local");const label=process.argv[2];if(!["before","after"].includes(label))throw Error("Specify before or after");
 const texts=["two cheese naan","one mango lassi","one lamb biryani"].map(text=>runTurn(newState(),text).reply),rows:any[]=[];
 for(const mode of ["raw","cached"]){const base=new AuraTts(),tts=mode==="raw"?base:new FixedAudioTts(base);await tts.warm();
  try{for(const [index,text]of texts.entries()){
   const start=performance.now(),chunks:any[]=[],events:any[]=[];let bytes=0,previous=start;
   try{for await(const chunk of tts.speak(text,AbortSignal.timeout(45000),(event:any)=>events.push(event))){const now=performance.now();chunks.push({atMs:now-start,gapMs:now-previous,bytes:chunk.length});previous=now;bytes+=chunk.length;}
    rows.push({id:index+1,mode,ok:true,replyCharacters:text.length,firstByteMs:chunks[0]?.atMs,totalMs:performance.now()-start,audioMs:bytes/48,maxInterChunkMs:Math.max(0,...chunks.slice(1).map(row=>row.gapMs)),chunks,events});
   }catch(error){rows.push({id:index+1,mode,ok:false,firstByteMs:chunks[0]?.atMs??null,totalMs:performance.now()-start,chunks,events,failure:error instanceof Error?error.name:"failure"});}
   writeFileSync(`eval/results/tts-chunks-${label}.json`,JSON.stringify({kind:"synthetic-real-Aura-chunk-diagnostic",location:"Lahore local",audioStored:false,rows},null,2)+"\n");
   console.log(JSON.stringify({...rows.at(-1),chunks:undefined,events:undefined}));
  }}finally{tts.close();}
 }
}
void main().catch(()=>{console.error("TTS diagnostic stopped; partial rows retained without audio or provider payloads");process.exitCode=1;});
