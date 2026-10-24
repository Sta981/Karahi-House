// Real Edge + AudioWorklet + local WebSocket + real order engine.
// STT and TTS are deterministic fixtures: these are NOT provider/audio accuracy
// or production latency measurements. No microphone or recordings are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import next from "next";
import { chromium } from "playwright";
import WebSocket, { WebSocketServer } from "ws";
import { VoiceSession } from "../voice/session";
import type { Tts } from "../voice/contracts";
import { KEYTERMS } from "../voice/stt";
import { TurnRecorder } from "../voice/turn-recorder";
async function main() {
  const report:Record<string,any>={kind:"browser-transport-fixtures-not-live-STT-or-TTS",browser:"Microsoft Edge",location:"Lahore laptop localhost",recordingsStored:false};
  const app=next({dev:true,hostname:"127.0.0.1",port:3101});await app.prepare();
  const handler=app.getRequestHandler(),server=createServer((req,res)=>void handler(req,res));
  const wss=new WebSocketServer({noServer:true});
  server.on("upgrade",(req,socket,head)=>{if(req.url==="/ws/voice")wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws));else void app.getUpgradeHandler()(req,socket,head);});
  const fixture:Tts={name:"fixture",warm:async()=>{},close(){},async *speak(_text,signal){
    await new Promise(resolve=>setTimeout(resolve,25));
    for(let i=0;i<30;i++){signal.throwIfAborted();const pcm=Buffer.alloc(3840);for(let j=0;j<1920;j++)pcm.writeInt16LE(Math.sin(j/24000*440*Math.PI*2)*1500,j*2);yield pcm;await new Promise(resolve=>setTimeout(resolve,20));}
  }};
  let turns=0,bargeIns=0;
  wss.on("connection",ws=>{
    const recorder=new TurnRecorder({callId:"fixture",location:"Lahore local",model:"flux",profile:"fixture"},row=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"turn_log",row}));});
    const emit=(event:Record<string,unknown>|Buffer)=>{if(ws.readyState===WebSocket.OPEN)ws.send(Buffer.isBuffer(event)?event:JSON.stringify(event));if(!Buffer.isBuffer(event))recorder.event(event);};
    const session=new VoiceSession(fixture,emit);let loud=0,quiet=0,speaking=false;
    ws.on("message",(data,binary)=>{
      if(binary){const pcm=Buffer.from(data as Buffer);let sum=0;for(let i=0;i<pcm.length;i+=2)sum+=(pcm.readInt16LE(i)/32768)**2;
        if(Math.sqrt(sum/(pcm.length/2))>.025){loud++;quiet=0;if(loud===2){speaking=true;session.interrupt();}}
        else{quiet++;loud=0;if(speaking&&quiet===4){speaking=false;turns++;void session.turn(turns===1?"one rice":"one mango lassi",turns);}}return;}
      const msg=JSON.parse(data.toString());
      if(msg.type==="ping")emit({type:"pong",sent:msg.sent,server:performance.now()});
      if(msg.type==="start")emit({type:"ready",model:msg.model,tts:"fixture",sampleRate:16000,frameMs:80,keyterms:KEYTERMS.length});
      if(msg.type==="mic_ready")void session.greet();
      if(msg.type==="barge_in"){bargeIns++;session.interrupt();}
      if(msg.type==="latency")recorder.latency(msg.generation,msg.timing);
      if(msg.type==="stop")ws.close();
    });ws.on("close",()=>session.close());
  });
  await new Promise<void>(resolve=>server.listen(3101,"127.0.0.1",resolve));
  const browser=await chromium.launch({channel:"msedge",headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
  try{
    const context=await browser.newContext();const page=await context.newPage();
    const failures:string[]=[];page.on("pageerror",error=>failures.push(error.message));
    await page.addInitScript(()=>{
      const state:any={contexts:[],stops:0,tracks:[]};(window as any).__voiceFixture=state;
      const original=AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop=function(...args:any[]){state.stops++;return original.apply(this,args as [number?]);};
      navigator.mediaDevices.getUserMedia=async()=>{
        const audio=new AudioContext();state.contexts.push(audio);const dest=audio.createMediaStreamDestination();
        const oscillator=audio.createOscillator(),gain=audio.createGain();gain.gain.value=0;oscillator.connect(gain);gain.connect(dest);oscillator.start();await audio.resume();
        state.speak=async()=>{gain.gain.setValueAtTime(.2,audio.currentTime);await new Promise(resolve=>setTimeout(resolve,500));gain.gain.setValueAtTime(0,audio.currentTime);};
        state.tracks.push(...dest.stream.getTracks());return dest.stream;
      };
    });
    await page.goto("http://127.0.0.1:3101/voice");await page.getByLabel("Recognition model").selectOption("flux");await page.getByRole("button",{name:"Start microphone"}).click();
    await page.getByRole("status").filter({hasText:"Listening"}).waitFor({timeout:30000});
    await page.waitForTimeout(150);const initialStops=await page.evaluate(()=>(window as any).__voiceFixture.stops);
    await page.evaluate(()=>(window as any).__voiceFixture.speak());
    await page.waitForFunction(()=>document.body.innerText.includes("× Rice"),{},{timeout:15000});
    await page.waitForTimeout(400);
    const before=await page.evaluate(()=>(window as any).__voiceFixture.stops);
    await page.evaluate(()=>(window as any).__voiceFixture.speak());
    await page.waitForFunction(()=>document.body.innerText.includes("× Mango Lassi"),{},{timeout:15000});
    await page.waitForTimeout(500);
    const after=await page.evaluate(()=>(window as any).__voiceFixture.stops);
    assert.ok(before>initialStops,"Speech start must stop greeting playback");assert.ok(after>before,"Second speech must stop first reply playback");assert.equal(turns,2);assert.ok(bargeIns>=2);
    const table=await page.locator("table").first().innerText();assert.match(table,/Speech end → first audio byte/);
    const downloadPromise=page.waitForEvent("download");await page.getByRole("button",{name:"Export turn log CSV"}).click();const download=await downloadPromise;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream!)chunks.push(chunk);const csv=Buffer.concat(chunks).toString("utf8");assert.match(csv,/transcript_redacted/);assert.match(csv,/one rice/);assert.match(csv,/MANGO_LASSI/);report.csvExport=true;
    await page.getByLabel(/^Intended words/).first().fill("one intended demo dish");const correctedDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Export mishearings CSV"}).click();const corrected=await correctedDownload;const correctedStream=await corrected.createReadStream(),correctedChunks=[];for await(const chunk of correctedStream!)correctedChunks.push(chunk);const correctionCsv=Buffer.concat(correctedChunks).toString("utf8");assert.match(correctionCsv,/one intended demo dish/);assert.match(correctionCsv,/pending_manual_review/);report.mishearingsExport=true;
    await page.getByRole("button",{name:"End call"}).click();
    const released=await page.evaluate(()=>(window as any).__voiceFixture.tracks.every((track:MediaStreamTrack)=>track.readyState==="ended"));assert.equal(released,true);assert.deepEqual(failures,[]);
    report.ok=true;report.turns=turns;report.bargeIns=bargeIns;report.stoppedPlaybackSources=after;report.micReleased=released;report.latencyTableFixtureOnly=table;
  }catch(error){report.ok=false;report.failure=error instanceof Error?error.message:"Browser failed";}
  finally{await browser.close();for(const ws of wss.clients)ws.terminate();wss.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await app.close();writeFileSync("eval/results/voice-browser.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
  if(!report.ok)process.exitCode=1;
}
void main().then(()=>process.exit(process.exitCode ?? 0));
