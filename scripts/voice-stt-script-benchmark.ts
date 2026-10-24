// SAME thirty public mic-script utterances, synthetic audio generated once in
// memory and broadcast to three streams. No engine/held-out/grader imports.
import { loadEnvFile } from "node:process";
import { readFileSync,writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { AuraTts } from "../voice/tts";
import { openStt,stateKeyterms } from "../voice/stt";
import { MODIFIERS } from "../lib/menu";
import { resampleEndpoint } from "../voice/endpoint-fixtures";
import type { SttModel,SttStream } from "../voice/contracts";
const models:SttModel[]=["flux","nova-3","nova-3-en-IN"];
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const normal=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").split(/\s+/).filter(Boolean).join(" ");
async function main(){
 loadEnvFile(".env.local");const script=JSON.parse(readFileSync("docs/real-mic-script.json","utf8"));if(script.rows.length!==30)throw Error("Expected the same thirty public script turns");
 const tts=new AuraTts(),fixtures=[];
 for(const row of script.rows){
  const pieces:Buffer[]=[];let last=0;
  for(const marker of String(row.text).matchAll(/\[pause (\d+) ms\]/g)){
   const chunks=[];for await(const chunk of tts.speak(row.text.slice(last,marker.index),AbortSignal.timeout(30000)))chunks.push(chunk);pieces.push(resampleEndpoint(Buffer.concat(chunks)),Buffer.alloc(Number(marker[1])*32));last=marker.index!+marker[0].length;
  }
  const chunks=[];for await(const chunk of tts.speak(row.text.slice(last),AbortSignal.timeout(30000)))chunks.push(chunk);pieces.push(resampleEndpoint(Buffer.concat(chunks)));
  fixtures.push({...row,text:row.text.replace(/\[pause \d+ ms\]/g," "),pcm:Buffer.concat(pieces)});console.log(`Synthetic public script ${fixtures.length}/30 generated in RAM.`);
 }
 tts.close();const rows:any[]=[],streams=new Map<SttModel,SttStream>(),configuration:Record<string,boolean[]>={};let active:any,start=0,totalFrames=0;
 const close=()=>{for(const stream of streams.values())stream.close();streams.clear();};
 try{for(const fixture of fixtures){
  if(fixture.reset){close();await pause(200);totalFrames=0;
   for(const model of models){configuration[model]??=[];const stream=await openStt(model,event=>{
    if(event.type==="configuration"){configuration[model].push(event.accepted);return;}
    if(!active)return;
    if(event.type==="final")active.results[model].finals.push({...event,receivedMs:performance.now()-start});
    if(event.type==="error")active.results[model].errors.push(event.code);
   });streams.set(model,stream);stream.configureKeyterms?.(stateKeyterms(["Half","Full",...MODIFIERS.spice_level.options]));}
  }
  active={id:fixture.id,session:fixture.session,text:fixture.text,insertedPause:/\[pause/.test(script.rows.find((row:any)=>row.id===fixture.id).text),results:Object.fromEntries(models.map(model=>[model,{finals:[],errors:[]}]))};
  start=performance.now();const bytes=Buffer.concat([Buffer.alloc(6400),fixture.pcm,Buffer.alloc(112000)]);
  for(let offset=0;offset<bytes.length;offset+=2560){const due=start+offset/32;if(due>performance.now())await pause(due-performance.now());const frame=Buffer.alloc(2560);bytes.copy(frame,0,offset,offset+2560);for(const stream of streams.values())stream.send(frame);totalFrames++;}
  await pause(150);
  for(const model of models){const result=active.results[model];result.transcript=result.finals.map((event:any)=>event.text).join(" ");result.exactSyntheticText=normal(result.transcript)===normal(fixture.text);result.splitFinals=result.finals.length>1;result.missing=!result.finals.length;}
  rows.push(active);active=undefined;console.log(JSON.stringify({turn:rows.length,session:fixture.session,models:models.map(model=>({model,exact:rows.at(-1).results[model].exactSyntheticText,missing:rows.at(-1).results[model].missing}))}));
 }}finally{close();writeFileSync("eval/results/voice-stt-30.json",JSON.stringify({kind:"synthetic-same-public-30-turn-script-NOT-accent-accuracy",location:"Lahore local",script:"docs/real-mic-script.json",turnsPerModel:30,models,simultaneousStreams:3,policy:"identical PCM and fixed keyterms; no gold/matcher-driven per-turn bias; no engine scoring; not a production latency measurement",audioStored:false,realSpeakers:0,modelSelected:false,configuration,rows},null,2)+"\n");}
}
void main().catch(()=>{console.error("Thirty-turn STT diagnostic failed; available metrics retained, no raw errors logged.");process.exitCode=1;});
