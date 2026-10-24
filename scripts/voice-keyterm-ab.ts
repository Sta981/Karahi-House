import {loadEnvFile} from "node:process";
import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {syntheticAudio} from "./lib/synthetic-audio.mjs";
import {openStt,KEYTERMS} from "../voice/stt";
import type {SttModel,SttStream} from "../voice/contracts";
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 loadEnvFile(".env.local");const fixtures=syntheticAudio(["two garlic naan please","can we have garlic naan","a garlic naan for pickup","garlic naan","for garlic naan","garlic naan and mango lassi"].map((text,index)=>({id:`boost_${index+1}`,text}))),rows:any[]=[];
 const save=()=>{const summary=["flux","nova-3","nova-3-en-IN"].flatMap(model=>["control","phrase_boost"].map(variant=>{const own=rows.filter(row=>row.model===model&&row.variant===variant);return {model,variant,correct:own.filter(row=>row.recognizedGarlicNaan).length,total:own.length,missing:own.filter(row=>!row.finals).length,errors:own.filter(row=>row.errors.length).length};}));writeFileSync("eval/results/mic-keyterm-ab.json",JSON.stringify({kind:"paired-synthetic-phrase-boost-not-accent-accuracy",voice:"Microsoft Zira Desktop",audioStored:false,phrase:"garlic naan",control:"all other final-menu terms unchanged",summary,rows},null,2)+"\n");return summary;};
 try{for(const model of ["flux","nova-3","nova-3-en-IN"] as SttModel[])for(const fixture of fixtures){
  const results=[{variant:"control",keyterms:KEYTERMS.filter(term=>term!=="garlic naan"),finals:[] as string[],errors:[] as string[]},{variant:"phrase_boost",keyterms:KEYTERMS,finals:[] as string[],errors:[] as string[]}],streams:SttStream[]=[];
  try{for(const result of results){try{streams.push(await openStt(model,event=>{if(event.type==="final")result.finals.push(event.text);if(event.type==="error")result.errors.push(event.code);},undefined,{keyterms:result.keyterms}));}catch{result.errors.push("handshake_failed");}}
   const bytes=Buffer.concat([Buffer.alloc(6400),fixture.pcm,Buffer.alloc(112000)]),start=performance.now();
   for(let offset=0;offset<bytes.length;offset+=2560){const due=start+offset/32;if(due>performance.now())await pause(due-performance.now());const frame=Buffer.alloc(2560);bytes.copy(frame,0,offset,offset+2560);for(const stream of streams)stream.send(frame);}await pause(150);
   for(const result of results)rows.push({id:fixture.id,model,variant:result.variant,inputHash:fixture.sha256,keytermCount:result.keyterms.length,recognizedGarlicNaan:/\bgarlic\s+naan\b/i.test(result.finals.join(" ")),finals:result.finals.length,errors:result.errors});
  }finally{for(const stream of streams)stream.close();}
  save();console.log(JSON.stringify({model,id:fixture.id,results:rows.slice(-2).map(row=>({variant:row.variant,recognized:row.recognizedGarlicNaan,finals:row.finals,errors:row.errors.length}))}));await pause(200);
 }}finally{console.log(JSON.stringify({summary:save()}));}
}
void main().catch(()=>{console.error("Keyterm experiment stopped; available synthetic results retained.");process.exitCode=1;});
