import { loadEnvFile } from "node:process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { AuraTts } from "../voice/tts";
import { openStt } from "../voice/stt";
import { ENDPOINT_PROFILES } from "../voice/endpointing";
import type { SttModel, SttEvent } from "../voice/contracts";
import { ContinuationGuard } from "../voice/continuation";
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
import {ENDPOINT_CASES as CASES,resampleEndpoint as resample} from "../voice/endpoint-fixtures";
async function main(){
 loadEnvFile(".env.local");const tts=new AuraTts(),fixtures: {id:string;text:string;pcm:Buffer;suffixStartSeconds:number|null;endSeconds:number}[]=[];
 for(const row of CASES){const pieces:Buffer[]=[];for(const text of row.parts){const chunks=[];for await(const chunk of tts.speak(text,AbortSignal.timeout(30000)))chunks.push(chunk);pieces.push(resample(Buffer.concat(chunks)));}
  const suffixStartSeconds=pieces.length>1?(pieces[0].length/32+row.gapMs)/1000:null;
  const pcm=Buffer.concat(pieces.length>1?[pieces[0],Buffer.alloc(row.gapMs*32),pieces[1]]:pieces);
  fixtures.push({id:row.id,text:row.parts.join(" "),pcm,suffixStartSeconds,endSeconds:pcm.length/32000});
 }
 console.log("Six synthetic fixtures generated in RAM; no recordings saved.");
 const rows:Record<string,any>[]=[];
 try{
  const guarded=process.argv.includes("--guard-only"),profiles=guarded?[ENDPOINT_PROFILES[0]]:ENDPOINT_PROFILES;
  for(const [profileIndex,profile] of profiles.entries())for(const model of (profileIndex%2?["nova-3","flux"]:["flux","nova-3"]) as SttModel[])for(const fixture of fixtures){
   const events:(SttEvent&{receivedMs:number})[]=[];let start=0;
   const guardMs=Number(process.env.VOICE_CONTINUATION_MS||1600);
   const rawFinals:(SttEvent&{receivedMs:number})[]=[],guard=guarded?new ContinuationGuard(guardMs,event=>events.push({...event,receivedMs:performance.now()-start})):undefined;
   let stream;for(let attempt=0;attempt<3;attempt++)try{stream=await openStt(model,event=>{if(event.type==="final"){rawFinals.push({...event,receivedMs:performance.now()-start});if(guard)guard.final(event);else events.push({...event,receivedMs:performance.now()-start});}else if(event.type==="error")events.push({...event,receivedMs:performance.now()-start});},profile);break;}catch(error){
    const code=error instanceof Error&&/^Deepgram handshake HTTP \d+$/.test(error.message)?error.message:"STT connection failed";
    console.log(JSON.stringify({model,profile:profile.id,id:fixture.id,connectionAttempt:attempt+1,code}));
    if(attempt===2)throw Error(code);await pause((attempt+1)*1000);
   }
   if(!stream)throw Error("STT stream unavailable");
   try{start=performance.now();const bytes=Buffer.concat([Buffer.alloc(6400),fixture.pcm,Buffer.alloc(128000)]);
    for(let offset=0;offset<bytes.length;offset+=2560){const due=start+offset/32,remaining=due-performance.now();if(remaining>0)await pause(remaining);const frame=Buffer.alloc(2560);bytes.copy(frame,0,offset,offset+2560);guard?.audio(frame);stream.send(frame);}
    await pause(150);
   }finally{stream.close();guard?.close();await pause(300);}
   const finals=events.filter(event=>event.type==="final") as (Extract<SttEvent,{type:"final"}>&{receivedMs:number})[];
   const endSeconds=.2+fixture.endSeconds,suffix=fixture.suffixStartSeconds===null?null:.2+fixture.suffixStartSeconds;
   const premature=!!suffix&&finals.some(event=>event.audioEndSeconds!==null&&event.audioEndSeconds<suffix-.1);
   const final=finals.at(-1);
   const row={model,profile:guarded?`baseline+guard${guardMs}`:profile.id,id:fixture.id,text:fixture.text,gapMs:CASES.find(row=>row.id===fixture.id)!.gapMs,prematureBoundary:premature,talkOverRisk:finals.some(event=>event.receivedMs<endSeconds*1000),missing:!final,splitTurns:finals.length>1,endpointMs:final?final.receivedMs-endSeconds*1000:null,finals,rawFinals};
   rows.push(row);console.log(JSON.stringify({model,profile:profile.id,id:fixture.id,premature,endpointMs:row.endpointMs}));
  }
 }finally{tts.close();writeFileSync(process.argv.includes("--guard-only")?"eval/results/voice-continuation.json":"eval/results/voice-endpointing.json",JSON.stringify({kind:"synthetic-pause-development-not-accent-eval",location:"Lahore local",audioStored:false,decisionCriteria:"eval/endpoint-decision.md",profiles:ENDPOINT_PROFILES,rows},null,2)+"\n");}
}
void main().catch(()=>{console.error("Endpoint experiment failed; no raw provider errors or credentials logged.");process.exitCode=1;});
