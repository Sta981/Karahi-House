// Production startup/auth check on this laptop. This is NOT a US deployment.
// Renders only fixed synthetic templates; never starts a valid STT session.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const port = 3112;
const base = `http://127.0.0.1:${port}`;
const started = performance.now();
const child = spawn(process.execPath,["--import","tsx","scripts/voice-server.ts"],{
  windowsHide:true,stdio:["ignore","pipe","pipe"],
  env:{...process.env,NODE_ENV:"production",PORT:String(port),
    VOICE_DEPLOYMENT_LABEL:"Lahore local",VOICE_BIND_ADDRESS:"0.0.0.0",
    VOICE_DEMO_ACCESS_TOKEN:randomBytes(32).toString("hex"),
    VOICE_TTS_PROVIDER:"aura-2",VOICE_FIXED_AUDIO_CACHE:"true",
    VOICE_FAQ_ENABLED:"false",VOICE_SPECULATIVE_ENGINE:"false",
    VOICE_PERSIST_LOGS:"false"}
});
// Suppress child output, including generic framework diagnostics; report only
// bounded health fields and outcomes, never environment variables.
child.stdout.resume();child.stderr.resume();
let exited = false;child.once("exit",()=>{exited=true;});
try {
  let health;
  while(performance.now()-started<90000){
    if(exited)throw Error("Production process exited before ready");
    try{const response=await fetch(`${base}/voice-health`,{signal:AbortSignal.timeout(1500)});if(response.ok){health=await response.json();break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!health?.ok||health.location!=="Lahore local"||!health.requiresAccessCode)throw Error("Production readiness/auth configuration failed");
  const readyMs=performance.now()-started;
  const page=await fetch(`${base}/voice`,{signal:AbortSignal.timeout(10000)});
  if(!page.ok)throw Error("Production voice page failed");
  await page.body?.cancel();
  const invalidCodeRejected=await new Promise((resolve,reject)=>{
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws/voice`,{origin:base});
    let denied=false;
    const timer=setTimeout(()=>{ws.terminate();reject(Error("Access-code check timed out"));},5000);
    ws.on("open",()=>ws.send(JSON.stringify({type:"start",model:"flux",accessCode:"incorrect"})));
    ws.on("message",data=>{const event=JSON.parse(data.toString());if(event.type==="ready")reject(Error("Unauthenticated session unexpectedly ready"));if(event.code==="access_denied")denied=true;});
    ws.on("error",()=>{clearTimeout(timer);reject(Error("Access-code socket failed"));});
    ws.on("close",code=>{clearTimeout(timer);resolve(denied&&code===1008);});
  });
  if(!invalidCodeRejected)throw Error("Invalid access code was not rejected");
  const report={ok:true,location:"Lahore local",productionMode:true,publicBind:true,
    launchToReadyMs:readyMs,applicationStartup:health.startup,fixedAudio:health.fixedAudio,
    voicePageStatus:page.status,invalidCodeRejected,audioFramesSent:0,
    validSttSessionsStarted:0,usDeployment:false,recordingsStored:false};
  writeFileSync("eval/results/voice-production-static.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report));
} finally {
  child.kill();
}
