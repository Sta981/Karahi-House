// Real providers + Edge transport, with a fixed synthetic menu clip as input.
// This checks playback completion, not human accent accuracy or intelligibility.
import assert from "node:assert/strict";
import { readFileSync,writeFileSync } from "node:fs";
import { chromium } from "playwright";
const manifest=JSON.parse(readFileSync("public/voice-audio/manifest.json","utf8"));
const clip=manifest.entries.find(entry=>entry.text==="Mango Lassi");
const pcm=readFileSync(`public/voice-audio/${clip.file}`),samples=[];
for(let i=0;i<pcm.length;i+=2)samples.push(pcm.readInt16LE(i)/32768);
const url=process.env.VOICE_BROWSER_URL||"http://127.0.0.1:3000";
const health=await(await fetch(`${url}/voice-health`)).json();
assert.ok(health.ok&&!health.requiresAccessCode,"Start the local password-free voice server first");
const browser=await chromium.launch({channel:"msedge",headless:true}),results=[];
try{for(const model of ["flux","nova-3","nova-3-en-IN"]){
 const context=await browser.newContext(),page=await context.newPage(),pageErrors=[];
 page.on("pageerror",error=>pageErrors.push(error.name));
 await page.addInitScript(()=>{
  const state={transcripts:0,replies:0,bytes:0,audioEnds:0,errors:[],playback:[],latency:[],profiles:[]};window.__providerFixture=state;
  const Native=window.WebSocket;
  window.WebSocket=class extends Native{
   constructor(...args){super(...args);if(!String(args[0]).includes("/ws/voice"))return;
    this.addEventListener("message",event=>{
     if(event.data instanceof ArrayBuffer){const view=new DataView(event.data);if(view.byteLength>4&&view.getUint32(0,true)>0)state.bytes+=view.byteLength-4;return;}
     const message=JSON.parse(event.data);
     if(message.type==="transcript")state.transcripts++;
     if(message.type==="reply"){state.replies++;state.profiles.push({generation:message.generation,replyTextLength:message.text.length,engineMs:message.engineMs,...message.engineProfile});}
     if(message.type==="audio_end"&&message.generation>0)state.audioEnds++;
     if(message.type==="error")state.errors.push({code:message.code,reason:message.reason});
    });
   }
   send(data){if(typeof data==="string"){const message=JSON.parse(data);if(message.type==="playback")state.playback.push({generation:message.generation,...message.metrics});if(message.type==="latency")state.latency.push(message.timing);}return super.send(data);}
  };
  navigator.mediaDevices.getUserMedia=async()=>{
   const audio=new AudioContext();await audio.resume();const destination=audio.createMediaStreamDestination();
   state.play=values=>{const buffer=audio.createBuffer(1,values.length,24000);buffer.getChannelData(0).set(values);const source=audio.createBufferSource();source.buffer=buffer;source.connect(destination);source.start();};
   return destination.stream;
  };
 });
 const result={model,synthetic:true,ok:false};
 try{
  await page.goto(`${url}/voice`);assert.equal(await page.getByLabel("Hosted demo access code").count(),0);
  await page.getByLabel("Recognition model").selectOption(model);await page.getByRole("button",{name:"Start microphone"}).click();
  await page.getByRole("status").filter({hasText:"Listening"}).waitFor({timeout:30000});await page.waitForTimeout(400);
  await page.evaluate(values=>window.__providerFixture.play(values),samples);
  await page.waitForFunction(()=>window.__providerFixture.playback.some(row=>row.generation>0&&row.replyTextLength>0&&row.finished),null,{timeout:45000});
  const details=await page.evaluate(()=>{const state=window.__providerFixture,latest=new Map();for(const row of state.playback)latest.set(row.generation,row);return {transcripts:state.transcripts,replies:state.replies,bytes:state.bytes,audioEnds:state.audioEnds,errors:state.errors,profiles:state.profiles,latency:state.latency,playback:[...latest.values()]};});
  Object.assign(result,details,{pageErrors,ok:details.errors.length===0&&pageErrors.length===0});
 }catch(error){Object.assign(result,{failure:error.name,...await page.evaluate(()=>{const state=window.__providerFixture,latest=new Map();for(const row of state.playback)latest.set(row.generation,row);return {transcripts:state.transcripts,replies:state.replies,bytes:state.bytes,audioEnds:state.audioEnds,errors:state.errors,profiles:state.profiles,latency:state.latency,playback:[...latest.values()]};}).catch(()=>({errors:[]}))});}
 finally{await page.getByRole("button",{name:"End call"}).click().catch(()=>{});await context.close();await new Promise(resolve=>setTimeout(resolve,500));}
 results.push(result);console.log(JSON.stringify(result));
}}finally{await browser.close();writeFileSync("eval/results/mic-provider-browser.json",JSON.stringify({kind:"synthetic-real-providers-browser-completion-not-human-accent-or-intelligibility",audioStored:false,transcriptsStored:false,location:health.location,results},null,2)+"\n");}
if(results.some(result=>!result.ok))process.exitCode=1;
