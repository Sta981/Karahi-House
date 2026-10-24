// Public script only. Same locally synthesized PCM for every configuration.
import {loadEnvFile} from "node:process";
import {readFileSync,writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {syntheticAudio} from "./lib/synthetic-audio.mjs";
import {openStt,KEYTERMS} from "../voice/stt";
import {ContinuationGuard} from "../voice/continuation";
import {adaptiveWait} from "../voice/phrase-completeness";
import {VoiceSession} from "../voice/session";
import {newState,runTurn} from "../lib/dialog";
import type {SttModel,SttStream} from "../voice/contracts";
const models:SttModel[]=["flux","nova-3","nova-3-en-IN"],pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const pct=(values:number[])=>{const sorted=values.filter(Number.isFinite).toSorted((a,b)=>a-b);return {n:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1]??null,p95:sorted[Math.ceil(sorted.length*.95)-1]??null};};
const fakeTts={name:"endpoint-fixture",warm:async()=>{},close(){},async *speak(){yield Buffer.from([0,0]);}};
function trim(pcm:Buffer){let a=0,b=pcm.length;while(a+2<b&&Math.abs(pcm.readInt16LE(a))<35)a+=2;while(b>a+2&&Math.abs(pcm.readInt16LE(b-2))<35)b-=2;return pcm.subarray(Math.max(0,a-960),Math.min(pcm.length,b+960));}
async function main(){
 loadEnvFile(".env.local");const script=JSON.parse(readFileSync("docs/real-mic-script.json","utf8"));if(script.rows.length!==30)throw Error("Public script must have thirty rows");
 const clips=syntheticAudio(script.rows.map((row:any)=>({id:row.id,text:row.text}))),rows:any[]=[];
 const save=()=>{
  const summary=models.flatMap(model=>["uncertain1600","uncertain900_merge"].map(variant=>{
   const selected=rows.filter(row=>row.model===model&&row.variant===variant);
   return {model,variant,attempted:selected.length,endpointMs:pct(selected.flatMap(row=>row.endpointMs===null?[]:[row.endpointMs])),missing:selected.filter(row=>row.missing).length,earlyRelease:selected.filter(row=>row.earlyRelease).length,revisions:selected.reduce((sum,row)=>sum+row.revisions,0),cartEquivalent:selected.filter(row=>row.cartEquivalent).length,errors:selected.filter(row=>row.errors.length).length};
  }));
  writeFileSync("eval/results/mic-endpoint-matrix.json",JSON.stringify({kind:"synthetic-public-30-endpoint-release-NOT-human-accent-or-audible-cutoff",audioStored:false,voice:"Microsoft Zira Desktop",models,connections:"new provider connection per utterance; two local guards share each provider stream",earlyReleaseDefinition:"engine released a reply before the known final synthetic speech end; audible playback is measured separately",summary,rows},null,2)+"\n");return summary;
 };
 try{for(const [index,clip]of clips.entries()){
  const pcm=trim(clip.pcm),states:any[]=[];let start=0;
  for(const model of models){
   const shared={raw:[] as any[],errors:[] as string[]};
   for(const variant of ["uncertain1600","uncertain900_merge"]){
    const emissions:any[]=[],events:any[]=[],jobs:Promise<void>[]=[];let revisions=0;
    const session=new VoiceSession(fakeTts,event=>{if(!Buffer.isBuffer(event))events.push(event);});
    const wait={...adaptiveWait(model),uncertainMs:variant==="uncertain1600"?1600:900};
    const guard=new ContinuationGuard(wait,event=>{emissions.push({...event,releasedMs:performance.now()-start});jobs.push(session.turn(event.text,event.audioEndSeconds,event.endpointReason,event.continuationOf?{of:event.continuationOf,fragment:event.fragment??""}:undefined));},variant==="uncertain900_merge"?{windowMs:2200,onResume:()=>{revisions++;session.interrupt({source:"continuation"});}}:undefined);
    states.push({model,variant,shared,emissions,events,jobs,session,guard,get revisions(){return revisions;}});
   }
  }
  const streams=new Map<SttModel,SttStream>();
  await Promise.all(models.map(async model=>{try{
   const own=states.filter(state=>state.model===model),stream=await openStt(model,event=>{
    if(event.type==="final"){own[0].shared.raw.push(event);for(const state of own)state.guard.final(event);}
    if(event.type==="error")own[0].shared.errors.push(event.code);
   });streams.set(model,stream);
  }catch{states.find(state=>state.model===model).shared.errors.push("handshake_failed");}}));
  start=performance.now();const bytes=Buffer.concat([Buffer.alloc(6400),pcm,Buffer.alloc(128000)]),eos=200+pcm.length/32;
  try{
   for(let offset=0;offset<bytes.length;offset+=2560){const due=start+offset/32;if(due>performance.now())await pause(due-performance.now());const frame=Buffer.alloc(2560);bytes.copy(frame,0,offset,offset+2560);for(const state of states)state.guard.audio(frame);for(const stream of streams.values())stream.send(frame);}
   await pause(120);await Promise.all(states.flatMap(state=>state.jobs));
   for(const state of states){
    const last=state.emissions.at(-1),actual=state.events.filter((event:any)=>event.type==="reply").at(-1)?.cart??[];
    const raw=state.shared.raw.map((event:any)=>event.text).join(" ");const expected=raw?runTurn(newState(),raw).state.cart:[];
    rows.push({id:clip.id,scriptTurn:index+1,model:state.model,variant:state.variant,inputHash:clip.sha256,keytermCount:KEYTERMS.length,endpointMs:last?last.releasedMs-eos:null,missing:!last,earlyRelease:state.emissions.some((event:any)=>event.releasedMs<eos-50),revisions:state.revisions,cartEquivalent:!!last&&!!raw&&JSON.stringify(actual)===JSON.stringify(expected),releases:state.emissions.length,rawFinals:state.shared.raw.length,errors:state.shared.errors});
   }
  }finally{for(const stream of streams.values())stream.close();for(const state of states){state.guard.close();state.session.close();}}
  save();console.log(JSON.stringify({scriptTurn:index+1,completed:30,models:models.map(model=>({model,errors:states.find(state=>state.model===model).shared.errors.length}))}));await pause(150);
 }}finally{console.log(JSON.stringify({summary:save()}));}
}
void main().catch(()=>{console.error("Public thirty-turn endpoint experiment stopped; partial counts retained; no provider payload printed.");process.exitCode=1;});
