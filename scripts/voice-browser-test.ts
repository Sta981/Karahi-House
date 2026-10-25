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
  const handler=app.getRequestHandler(),server=createServer((req,res)=>{
    if(req.url==="/voice-health"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ok:true,requiresAccessCode:false}));return;}
    void handler(req,res);
  });
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
        if(Math.sqrt(sum/(pcm.length/2))>.025){loud++;quiet=0;if(loud===4)speaking=true;}
        else{quiet++;loud=0;if(speaking&&quiet===4){speaking=false;turns++;void session.turn(turns===1?"one rice":turns===2?"one mango lassi":"two papadam",turns);}}return;}
      const msg=JSON.parse(data.toString());
      if(msg.type==="ping")emit({type:"pong",sent:msg.sent,server:performance.now()});
      if(msg.type==="fixture_failure")emit({type:"error",code:"tts_failed",recoverable:true});
      if(msg.type==="fixture_close"){emit({type:"error",code:"stt_audio_timeout"});ws.close(1011,"STT failed");}
      if(msg.type==="start")emit({type:"ready",model:msg.model,tts:"fixture",sampleRate:16000,frameMs:80,keyterms:KEYTERMS.length});
      if(msg.type==="mic_ready")void session.greet();
      if(msg.type==="barge_in"){bargeIns++;session.interrupt({source:msg.source,energy:msg.energy,threshold:msg.threshold,speechMs:msg.speechMs});}
      if(msg.type==="playback")recorder.playback(msg.generation,msg.metrics);
      if(msg.type==="latency")recorder.latency(msg.generation,msg.timing);
      if(msg.type==="audio_timing")recorder.audioTiming(msg.generation,msg.timing);
      if(msg.type==="stop")ws.close();
    });ws.on("close",()=>session.close());
  });
  await new Promise<void>(resolve=>server.listen(3101,"127.0.0.1",resolve));
  const browser=await chromium.launch({channel:"msedge",headless:true});
  try{
    const context=await browser.newContext();const page=await context.newPage();
    const failures:string[]=[];page.on("pageerror",error=>failures.push(error.message));
    await page.addInitScript(()=>{
      const state:any={contexts:[],stops:0,tracks:[],sockets:[],playback:[],micGranted:false,socketBeforeMic:false};(window as any).__voiceFixture=state;
      const Socket=window.WebSocket;
      window.WebSocket=new Proxy(Socket,{construct(Target,args){if(String(args[0]).includes("/ws/voice")){state.socketBeforeMic=!state.micGranted;const socket=new Target(...args as [string]),send=socket.send.bind(socket);socket.send=function(data){if(typeof data==="string"){const message=JSON.parse(data);if(message.type==="playback")state.playback.push(message);}return send(data);};state.sockets.push(socket);return socket;}return new Target(...args as [string]);}});
      const original=AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop=function(...args:any[]){state.stops++;return original.apply(this,args as [number?]);};
      navigator.mediaDevices.getUserMedia=async()=>{
        const audio=new AudioContext();state.contexts.push(audio);const dest=audio.createMediaStreamDestination();
        const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=733;gain.gain.value=0;oscillator.connect(gain);gain.connect(dest);oscillator.start();await audio.resume();
        state.speak=async()=>{gain.gain.setValueAtTime(.2,audio.currentTime);await new Promise(resolve=>setTimeout(resolve,500));gain.gain.setValueAtTime(0,audio.currentTime);};
        await new Promise(resolve=>setTimeout(resolve,350));state.micGranted=true;state.tracks.push(...dest.stream.getTracks());return dest.stream;
      };
    });
    await page.goto("http://127.0.0.1:3101/voice");assert.equal(await page.getByLabel("Hosted demo access code").count(),0);await page.getByLabel("Recognition model").selectOption("flux");await page.getByRole("button",{name:"Start microphone"}).click();
    await page.getByRole("status").filter({hasText:"Listening"}).waitFor({timeout:30000});
    assert.equal(await page.evaluate(()=>(window as any).__voiceFixture.socketBeforeMic),false);report.microphoneBeforeStt=true;report.localPasswordHidden=true;
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
    await page.evaluate(()=>(window as any).__voiceFixture.sockets[0].send(JSON.stringify({type:"fixture_failure"})));
    await page.getByRole("status").filter({hasText:"Voice output failed"}).waitFor();assert.equal(await page.getByRole("button",{name:"Start microphone"}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>(window as any).__voiceFixture.tracks.every((track:MediaStreamTrack)=>track.readyState==="live")),true);report.synthesisFailureKeepsMic=true;
    await page.evaluate(()=>(window as any).__voiceFixture.speak());await page.waitForFunction(()=>document.body.innerText.includes("2 × Papadam"),{},{timeout:15000});report.nextTurnAfterSynthesisFailure=true;
    await page.waitForFunction(()=>(window as any).__voiceFixture.playback.some((row:any)=>row.metrics.finished),{},{timeout:15000});
    const playback=await page.evaluate(()=>(window as any).__voiceFixture.playback);
    const latest=new Map<number,any>();for(const row of playback)latest.set(row.generation,row.metrics);
    report.playback=[...latest].map(([generation,metrics])=>({generation,...metrics}));
    assert.ok(report.playback.some((row:any)=>row.finished),"Last browser playback source must finish naturally");
    assert.ok(report.playback.some((row:any)=>row.interruptedByBargeIn&&row.trigger?.source==="browser_vad"&&row.trigger?.speechMs>=320));
    assert.match(csv,/playback_finished/);assert.match(csv,/engine_profile/);
    await page.evaluate(()=>(window as any).__voiceFixture.sockets[0].send(JSON.stringify({type:"fixture_close"})));
    await page.getByRole("status").filter({hasText:"stopped receiving microphone audio"}).waitFor();assert.equal(await page.getByRole("button",{name:"Start microphone"}).isEnabled(),true);report.disconnectReasonPreserved=true;
    const released=await page.evaluate(()=>(window as any).__voiceFixture.tracks.every((track:MediaStreamTrack)=>track.readyState==="ended"));assert.equal(released,true);assert.deepEqual(failures,[]);
    report.ok=true;report.turns=turns;report.bargeIns=bargeIns;report.stoppedPlaybackSources=after;report.micReleased=released;report.latencyTableFixtureOnly=table;
  }catch(error){report.ok=false;report.failure=error instanceof Error?error.message:"Browser failed";}
  finally{await browser.close();for(const ws of wss.clients)ws.terminate();wss.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await app.close();writeFileSync("eval/results/voice-browser.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
  if(!report.ok)process.exitCode=1;
}
void main().then(()=>process.exit(process.exitCode ?? 0));
