import { loadEnvFile } from "node:process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { AuraTts } from "../voice/tts";
import { openStt,stateKeyterms } from "../voice/stt";
import { endpointSettings } from "../voice/endpointing";
import type { SttModel,SttEvent } from "../voice/contracts";
import { ContinuationGuard } from "../voice/continuation";
import { ENDPOINT_CASES,resampleEndpoint } from "../voice/endpoint-fixtures";
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const candidates=[350,750,1100,1400];
type Final=Extract<SttEvent,{type:"final"}>&{receivedMs:number};
async function main(){
 loadEnvFile(".env.local");const tts=new AuraTts(),fixtures=[];
 for(const row of ENDPOINT_CASES){
  const pieces=[];for(const text of row.parts){const chunks=[];for await(const chunk of tts.speak(text,AbortSignal.timeout(30000)))chunks.push(chunk);pieces.push(resampleEndpoint(Buffer.concat(chunks)));}
  const suffix=pieces.length>1?(pieces[0].length/32+row.gapMs)/1000:null;
  const pcm=Buffer.concat(pieces.length>1?[pieces[0],Buffer.alloc(row.gapMs*32),pieces[1]]:pieces);
  fixtures.push({...row,pcm,suffix,endSeconds:pcm.length/32000});
 }
 tts.close();const rows:any[]=[];console.log("Same six endpoint scenarios synthesized in RAM; paired guards share each stream.");
 try{for(const model of ["flux","nova-3","nova-3-en-IN"] as SttModel[])for(const fixture of fixtures){
  let start=0;const raw:Final[]=[],configurations:boolean[]=[],errors:string[]=[];
  const variants=[{id:"fixed1600",wait:1600},...candidates.map(completeMs=>({id:`adaptive${completeMs}`,wait:{completeMs,incompleteMs:1600,uncertainMs:1600}}))];
  const finals=new Map(variants.map(variant=>[variant.id,[] as Final[]]));
  const guards=variants.map(variant=>new ContinuationGuard(variant.wait,event=>finals.get(variant.id)!.push({...event,receivedMs:performance.now()-start})));
  let stream;
  for(let attempt=0;attempt<3;attempt++)try{stream=await openStt(model,event=>{
   if(event.type==="final"){raw.push({...event,receivedMs:performance.now()-start});for(const guard of guards)guard.final(event);}
   if(event.type==="configuration")configurations.push(event.accepted);
   if(event.type==="error")errors.push(event.code);
  },endpointSettings(model));break;}catch{if(attempt===2)throw Error("STT handshake failed");await pause(1000*(attempt+1));}
  if(!stream)throw Error("No STT stream");
  try{
   stream.configureKeyterms?.(stateKeyterms(["Half","Full"]));await pause(250);start=performance.now();
   const bytes=Buffer.concat([Buffer.alloc(6400),fixture.pcm,Buffer.alloc(144000)]);
   for(let offset=0;offset<bytes.length;offset+=2560){const due=start+offset/32;if(due>performance.now())await pause(due-performance.now());const frame=Buffer.alloc(2560);bytes.copy(frame,0,offset,offset+2560);for(const guard of guards)guard.audio(frame);stream.send(frame);}
   await pause(150);
  }finally{stream.close();guards.forEach(guard=>guard.close());}
  const eos=.2+fixture.endSeconds,suffix=fixture.suffix===null?null:.2+fixture.suffix;
  for(const variant of variants){
   const values=finals.get(variant.id)!,last=values.at(-1);
   rows.push({model,id:fixture.id,variant:variant.id,gapMs:fixture.gapMs,text:fixture.parts.join(" "),prematureBoundary:suffix!==null&&values.some(event=>event.audioEndSeconds!==null&&event.audioEndSeconds<suffix-.1),talkOverRisk:values.some(event=>event.receivedMs<eos*1000),missing:!last,splitTurns:values.length>1,endpointMs:last?last.receivedMs-eos*1000:null,finals:values,rawFinals:raw,configureAccepted:configurations.includes(true),configureRejected:configurations.includes(false),errors});
  }
  console.log(JSON.stringify({model,id:fixture.id,configureAccepted:configurations.includes(true),variants:rows.slice(-variants.length).map(row=>({id:row.variant,premature:row.prematureBoundary,missing:row.missing,ms:row.endpointMs}))}));
 }}finally{writeFileSync("eval/results/voice-adaptive.json",JSON.stringify({kind:"paired-synthetic-pause-development-not-accent-eval",location:"Lahore local",audioStored:false,criteria:"eval/adaptive-endpoint-decision.md",candidates,rows},null,2)+"\n");}
}
void main().catch(()=>{console.error("Adaptive experiment failed; partial metrics retained, no raw provider errors logged.");process.exitCode=1;});
