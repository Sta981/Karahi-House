// Public synthetic script + REAL STT/TTS + real browser scheduling. No recordings.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {chromium} from "playwright";
import {syntheticAudio} from "./lib/synthetic-audio.mjs";
const script=JSON.parse(readFileSync("docs/real-mic-script.json","utf8"));
mkdirSync("eval/results",{recursive:true});
if(script.rows.length!==30)throw Error("Expected the thirty PUBLIC development turns");
const clips=syntheticAudio(script.rows.map(row=>({id:row.id,text:row.text}))).map(clip=>{
 let start=0,end=clip.pcm.length;while(start+2<end&&Math.abs(clip.pcm.readInt16LE(start))<35)start+=2;while(end>start+2&&Math.abs(clip.pcm.readInt16LE(end-2))<35)end-=2;
 const pcm=clip.pcm.subarray(Math.max(0,start-960),Math.min(clip.pcm.length,end+960)),values=[];for(let i=0;i<pcm.length;i+=2)values.push(pcm.readInt16LE(i)/32768);
 return {id:clip.id,values,durationMs:pcm.length/32,hash:createHash("sha256").update(pcm).digest("hex")};
});
const base=process.env.VOICE_BROWSER_URL||"http://127.0.0.1:3000",health=await(await fetch(`${base}/voice-health`)).json();
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(!health.ok||health.requiresAccessCode)throw Error("This benchmark needs the direct localhost demo");
const percentile=values=>{const sorted=values.filter(Number.isFinite).toSorted((a,b)=>a-b);return {n:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1]??null,p95:sorted[Math.ceil(sorted.length*.95)-1]??null};};
const selection=process.argv.find(arg=>arg.startsWith("--model="))?.slice(8),limit=Number(process.argv.find(arg=>arg.startsWith("--limit="))?.slice(8)??30),label=process.argv.find(arg=>arg.startsWith("--label="))?.slice(8)??"";
if(label&&!/^[a-z0-9_-]+$/.test(label)||!Number.isInteger(limit)||limit<1||limit>30)throw Error("Invalid diagnostic options");
const rows=[],models=["flux","nova-3","nova-3-en-IN"].filter(model=>!selection||selection===model);
const save=()=>{
 const summary=models.map(model=>{const own=rows.filter(row=>row.model===model);return {model,attempted:own.length,completed:own.filter(row=>row.finished).length,missing:own.filter(row=>!row.generations?.length).length,failures:own.filter(row=>row.errors?.length||row.failure).length,
  firstByteMs:percentile(own.map(row=>row.firstByteMs)),firstPlaybackMs:percentile(own.map(row=>row.firstPlaybackMs)),firstInformativeByteMs:percentile(own.map(row=>row.firstInformativeByteMs)),bargeIns:own.reduce((n,row)=>n+(row.bargeIns??0),0),firstInformativePlaybackMs:percentile(own.map(row=>row.firstInformativePlaybackMs)),
  anyPrematureAudio:own.filter(row=>row.anyPrematureAudio).length,prematureInformativeAudio:own.filter(row=>row.prematureInformativeAudio).length,prematureEngineRelease:own.filter(row=>row.prematureEngineRelease).length,
  revisions:own.reduce((sum,row)=>sum+(row.revisions??0),0),gapCount:own.reduce((sum,row)=>sum+(row.gapCount??0),0),gapsOver1200ms:own.filter(row=>row.maxGapMs>1200).length,maxGapMs:Math.max(0,...own.map(row=>row.maxGapMs??0)),stalls:own.reduce((sum,row)=>sum+(row.stalls??0),0),retries:own.reduce((sum,row)=>sum+(row.retries??0),0)};});
 writeFileSync(`eval/results/voice-latency-30${label?`-${label}`:""}.json`,JSON.stringify({kind:"real-providers-synthetic-public-script-NOT-human-accent",sourceCommit,location:health.location,browser:"Edge",voice:"Microsoft Zira Desktop",audioStored:false,transcriptsStored:false,
  timingDefinition:"Known trimmed synthetic PCM end to first received byte and scheduled AudioContext start; informative excludes neutral acknowledgements/stall prompts; not acoustic loopback",cutoffDefinition:"Any/ informative playback or engine release before known final caller speech end minus 50 ms; count per scripted utterance, retaining revisions",waits:health.adaptive,buffering:health.fixedAudio?.buffering,summary,rows},null,2)+"\n");return summary;
};
const browser=await chromium.launch({channel:"msedge",headless:true});
try{for(const model of models){
 const context=await browser.newContext(),page=await context.newPage();
 await page.addInitScript(()=>{
  const state={byGeneration:{},currentGeneration:0,kind:"informative",current:null,lastReplyAt:0,errors:[],playbacks:{}};window.__latency30=state;
  const sourceStart=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(when=0,...args){
   // Fake microphone clips are 16 kHz; the agent's PCM playback is 24 kHz.
   if(this.buffer?.sampleRate===24000&&state.current&&state.currentGeneration>state.current.prior){const row=state.byGeneration[state.currentGeneration];if(row){const at=performance.now()+Math.max(0,when-this.context.currentTime)*1000;row.firstPlaybackAt??=at;if(state.kind==="informative")row.firstInformativeAt??=at;}}
   return sourceStart.call(this,when,...args);
  };
  const Native=window.WebSocket;
  window.WebSocket=class extends Native{
   constructor(...args){super(...args);if(!String(args[0]).includes("/ws/voice"))return;
    this.addEventListener("message",event=>{
     const now=performance.now();if(event.data instanceof ArrayBuffer){const view=new DataView(event.data);if(view.byteLength>4){const generation=view.getUint32(0,true),row=state.byGeneration[generation];if(row){row.firstByteAt??=now;if(state.kind==="informative")row.firstInformativeByteAt??=now;}}return;}
     const data=JSON.parse(event.data);
     if(data.type==="reply"){state.currentGeneration=data.generation;state.lastReplyAt=now;state.byGeneration[data.generation]={generation:data.generation,replyAt:now,replyLength:data.text.length,engineMs:data.engineMs,endpointReason:data.endpointReason,telemetry:[],supersedes:data.supersedesGeneration};}
     if(data.type==="audio_segment")state.kind=data.kind;
     if(data.type==="endpoint_probe"&&state.current)(state.current.probes??=[]).push({completeMs:data.completeMs,at:now,reason:data.reason});
     if(data.type==="endpoint_probe_resume"&&state.current)state.current.probeResumes=(state.current.probeResumes??0)+1;
     if(data.type==="turn_log"){const generation=Number(data.row.turnId.split(":").at(-1)),row=state.byGeneration[generation];if(row&&data.row.ttsChunks)row.telemetry=data.row.ttsChunks;}
     if(data.type==="error"){const error={code:data.code,reason:data.reason,at:now};state.errors.push(error);if(state.current)state.current.errors.push(error);}
    });
   }
   send(data){if(typeof data==="string"){const message=JSON.parse(data);if(message.type==="start"){state.byGeneration={};state.currentGeneration=0;state.lastReplyAt=0;state.current=null;state.kind="informative";}if(message.type==="playback"){const old=state.playbacks[message.generation];if(state.current&&message.metrics.interruptedByBargeIn&&!old?.interruptedByBargeIn&&message.metrics.receivedChunks>0)state.current.bargeIns=(state.current.bargeIns??0)+1;state.playbacks[message.generation]=message.metrics;const row=state.byGeneration[message.generation];if(row)row.playback=message.metrics;}}return super.send(data);}
  };
  navigator.mediaDevices.getUserMedia=async()=>{
   const audio=new AudioContext();await audio.resume();const destination=audio.createMediaStreamDestination();
   state.inject=values=>{const buffer=audio.createBuffer(1,values.length,16000);buffer.getChannelData(0).set(values);const source=audio.createBufferSource();source.buffer=buffer;source.connect(destination);const start=performance.now();state.current={prior:state.currentGeneration,start,eos:start+buffer.duration*1000,errors:[]};source.start();return state.current.eos;};
   return destination.stream;
  };
 });
 try{
  await page.goto(`${base}/voice`);
  for(const [index,clip]of clips.slice(0,limit).entries()){
   const definition=script.rows[index];
   if(definition.reset||!(await page.getByRole("button",{name:"Start microphone"}).isDisabled())){
    const end=page.getByRole("button",{name:"End call"});if(await end.isEnabled())await end.click();await page.waitForTimeout(400);
    console.log(JSON.stringify({event:"session_start",model,turn:index+1}));
    await page.getByLabel("Recognition model").selectOption(model);await page.getByRole("button",{name:"Start microphone"}).click();try{await page.getByRole("status").filter({hasText:"Listening"}).waitFor({timeout:40000});}catch(error){console.log(JSON.stringify({event:"startup_failed",model,status:await page.getByRole("status").last().innerText()}));throw error;}await page.waitForTimeout(250);
   }
   await page.evaluate(async()=>{const delay=window.__latency30.lastReplyAt+2400-performance.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));});
   await page.evaluate(values=>window.__latency30.inject(values),clip.values);
   let failure;
   try{await page.waitForFunction(()=>{const state=window.__latency30,active=state.current,own=Object.values(state.byGeneration).filter(row=>row.generation>active.prior),last=own.at(-1);return last?.playback?.finished||active.errors.length>0;},null,{timeout:45000});}catch(error){failure=error.name;}
   await page.waitForTimeout(200);
   const result=await page.evaluate(()=>{
    const state=window.__latency30,active=state.current,generations=Object.values(state.byGeneration).filter(row=>row.generation>active.prior),last=generations.at(-1),eos=active.eos;
    return {generations,finished:last?.playback?.finished??false,firstInformativeByteMs:typeof last?.firstInformativeByteAt==="number"?last.firstInformativeByteAt-eos:null,firstByteMs:typeof last?.firstByteAt==="number"?last.firstByteAt-eos:null,firstPlaybackMs:typeof last?.firstPlaybackAt==="number"?last.firstPlaybackAt-eos:null,firstInformativePlaybackMs:typeof last?.firstInformativeAt==="number"?last.firstInformativeAt-eos:null,
     anyPrematureAudio:generations.some(row=>row.firstPlaybackAt<eos-50),prematureInformativeAudio:generations.some(row=>row.firstInformativeAt<eos-50),prematureEngineRelease:generations.some(row=>row.replyAt<eos-50),revisions:generations.filter(row=>row.supersedes!==undefined).length,
     bargeIns:active.bargeIns??0,probes:(active.probes??[]).map(probe=>({...probe,endpointMs:probe.at-eos,premature:probe.at<eos-50,at:undefined})),probeResumes:active.probeResumes??0,
     gapCount:generations.reduce((sum,row)=>sum+(row.playback?.gapCount??0),0),maxGapMs:Math.max(0,...generations.map(row=>row.playback?.maxGapMs??0)),stalls:generations.reduce((sum,row)=>sum+(row.playback?.stallPrompts??0),0),retries:generations.reduce((sum,row)=>sum+row.telemetry.filter(event=>event.type==="retry").length,0),errors:active.errors.map(({code,reason})=>({code,reason}))};
   });
   // Absolute browser clock timestamps are useful only within the page; retain
   // relative chunk timings and totals, never transcript text or PCM.
   for(const generation of result.generations)for(const name of ["replyAt","firstByteAt","firstPlaybackAt","firstInformativeAt","firstInformativeByteAt"])delete generation[name];
   rows.push({id:clip.id,model,turn:index+1,inputHash:clip.hash,...result,...(failure?{failure}:{})});save();
   console.log(JSON.stringify({model,turn:index+1,finished:result.finished,firstByteMs:result.firstByteMs,informativeMs:result.firstInformativePlaybackMs,stalls:result.stalls,errors:result.errors.length}));
   if(failure){const end=page.getByRole("button",{name:"End call"});if(await end.isEnabled())await end.click();}
  }
 }finally{await page.getByRole("button",{name:"End call"}).click().catch(()=>{});await context.close();await new Promise(resolve=>setTimeout(resolve,400));}
}}finally{await browser.close();console.log(JSON.stringify({summary:save()}));}
