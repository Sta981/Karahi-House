import {request} from "node:http";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {writeFileSync} from "node:fs";
import {once} from "node:events";
import WebSocket from "ws";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function health(port,headers={}){return new Promise((resolve,reject)=>{const req=request({host:"127.0.0.1",port,path:"/voice-health",headers,timeout:3000},res=>{const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("end",()=>{const body=JSON.parse(Buffer.concat(chunks).toString());resolve({status:res.statusCode,requiresAccessCode:body.requiresAccessCode,error:body.error??null});});});req.on("error",reject);req.on("timeout",()=>req.destroy(Error("probe timeout")));req.end();});}
const rows=[];
for(const [id,headers]of [["direct_local",{}],["public_host",{Host:"demo.example.invalid"}],["forwarded_local_host",{"X-Forwarded-For":"192.0.2.10"}],["tunnel_host_rewrite",{"X-Forwarded-Host":"demo.example.invalid"}]])rows.push({id,...await health(3000,headers)});
const childEnv={...process.env,NODE_ENV:"production",PORT:"3105",DEEPGRAM_API_KEY:"",GROQ_API_KEY:"",LLM_PROVIDER:"",VOICE_TTS_PROVIDER:"aura-2",VOICE_FAQ_ENABLED:"false",VOICE_BIND_ADDRESS:"0.0.0.0",VOICE_REQUIRE_ACCESS_TOKEN:"",VOICE_DEMO_ACCESS_TOKEN:""};
const rejected=spawn(process.execPath,["--import","tsx","scripts/voice-server.ts"],{cwd:process.cwd(),env:childEnv,windowsHide:true,stdio:["ignore","pipe","pipe"]});let warning="";rejected.stderr.on("data",chunk=>warning+=chunk);
const [exitCode]=await once(rejected,"exit");rows.push({id:"public_bind_missing_token",refused:exitCode!==0,startupWarning:warning.includes("WARNING: VOICE_DEMO_ACCESS_TOKEN")});
const token=randomBytes(24).toString("base64url");
const fixture=spawn(process.execPath,["--import","tsx","scripts/voice-server.ts"],{cwd:process.cwd(),env:{...childEnv,VOICE_BIND_ADDRESS:"127.0.0.1",VOICE_REQUIRE_ACCESS_TOKEN:"true",VOICE_DEMO_ACCESS_TOKEN:token},windowsHide:true,stdio:["ignore","pipe","pipe"]});
fixture.stdout.resume();fixture.stderr.resume();
const authenticated=entered=>new Promise((resolve,reject)=>{
 const ws=new WebSocket("ws://127.0.0.1:3105/ws/voice",{origin:"http://127.0.0.1:3105"}),timer=setTimeout(()=>{ws.terminate();reject(Error("auth probe timed out"));},5000);
 ws.on("open",()=>ws.send(JSON.stringify({type:"start",model:"flux",accessCode:entered})));
 ws.on("message",bytes=>{const event=JSON.parse(bytes.toString());if(event.type==="error"){clearTimeout(timer);resolve(event.code);ws.close();}});ws.on("error",()=>{clearTimeout(timer);reject(Error("auth fixture connection failed"));});
});
try{
 let online;for(let count=0;count<50;count++){try{online=await health(3105);break;}catch{await pause(200);}}
 if(!online)throw Error("Access fixture did not start");rows.push({id:"forced_tunnel_mode",...online});
 for(const [id,entered]of [["missing_token",""],["wrong_token","incorrect"],["correct_token",token]]){
  const code=await authenticated(entered);rows.push({id,code,passed:id==="correct_token"?code==="voice_start_failed":code==="access_denied"});await pause(150);
 }
 // Correct authentication reaches the explicitly disabled-key TTS warm gate.
 // It cannot open STT or generate speech, so this probe makes zero API calls.
}finally{fixture.kill();await once(fixture,"exit").catch(()=>{});}
const ok=rows.find(row=>row.id==="direct_local")?.status===200&&rows.filter(row=>["public_host","forwarded_local_host","tunnel_host_rewrite"].includes(row.id)).every(row=>row.requiresAccessCode===true)&&rows.filter(row=>"passed"in row).every(row=>row.passed)&&rows.find(row=>row.id==="public_bind_missing_token")?.startupWarning;
const report={kind:"real-local-server-access-probes-with-zero-provider-calls",tokenValuesPrinted:false,ok,rows};writeFileSync("eval/results/voice-access.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(!ok)process.exitCode=1;
