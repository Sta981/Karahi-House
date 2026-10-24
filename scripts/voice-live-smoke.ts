// Bounded signup-credit smoke test. Synthetic speech stays in RAM. No volunteer
// audio, held-out cases, transcripts from people, or credentials are persisted.
import { loadEnvFile } from "node:process";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";
import { AuraTts } from "../voice/tts";
async function main(sharedAudio?:Buffer[],forcedAck?:boolean){
  if(!process.argv.includes("--credits-confirmed"))throw Error("Confirm available signup credits before running this bounded live test.");
  loadEnvFile(".env.local");if(!process.env.DEEPGRAM_API_KEY?.trim())throw Error("DEEPGRAM_API_KEY missing");
  const paired=process.argv.includes("--paired-ab"),remote=process.argv.includes("--us"),optimized=process.argv.includes("--optimized"),ab=process.argv.includes("--latency-ab")||paired,ack=forcedAck??!process.argv.includes("--no-ack");
  const target=remote?process.env.VOICE_US_BASE_URL?.trim():"http://127.0.0.1:3110";
  if(!target||remote&&!target.startsWith("https://"))throw Error("VOICE_US_BASE_URL must be the real HTTPS deployment URL");
  const report:Record<string,any>={kind:"live-providers-synthetic-English-not-accent-eval",location:remote?"US-hosted":"Lahore local",browserLocation:"Lahore",sttModels:["flux-general-en","nova-3 language=multi"],tts:"aura-2-thalia-en",ttsTransport:"not-yet-verified",audioStored:false,creditsConfirmed:true,phrases:[],runs:[]};
  const fixtures:{text:string;id?:string;qty?:number;mustAsk?:string;size?:string;spice?:string;unavailable?:boolean}[]=ab?[
    {text:"Where are you located?"},{text:"One rice.",id:"RICE",qty:1,mustAsk:"spice level"},
    {text:"What are your hours?"},{text:"One mango lassi.",id:"MANGO_LASSI",qty:1}
  ]:optimized?[
    {text:"One chicken biryani.",id:"CHICKEN_BIRYANI",qty:1,mustAsk:"spice level"},
    {text:"Medium spice, please.",id:"CHICKEN_BIRYANI",qty:1,spice:"Medium Spice"},
    {text:"One lamb white karahi.",mustAsk:"Half or Full"},
    {text:"Full, no spice.",id:"LAMB_WHITE_KARAHI",qty:1,size:"Full",spice:"No Spice"},
    {text:"Could I get rogan josh, please?",unavailable:true},
  ]:[{text:"One rice.",id:"RICE",qty:1},{text:"One mango lassi.",id:"MANGO_LASSI",qty:1},{text:"Two garlic naan, mild spice.",id:"GARLIC_NAAN_BREAD",qty:2}];
  const synthesis=new AuraTts(),audio:Buffer[]=sharedAudio??[];
  if(!sharedAudio)try{await synthesis.warm();for(const row of fixtures){const chunks:Buffer[]=[];for await(const chunk of synthesis.speak(row.text,new AbortController().signal))chunks.push(chunk);audio.push(Buffer.concat(chunks));}}
  finally{synthesis.close();}
  if(paired&&!sharedAudio){if(remote)throw Error("US A/B needs separately controlled deployed flags; no fake flag change is assumed");await main(audio,false);await new Promise(resolve=>setTimeout(resolve,1000));await main(audio,true);return;}
  report.pairedIdenticalPcm=paired;report.fixtureHashes=audio.map(pcm=>createHash("sha256").update(pcm).digest("hex"));
  if(ab)report.sttModels=["flux-general-en","nova-3 language=multi","nova-3 language=en-IN"];
  report.phrases=fixtures;
  const launchAt=performance.now();
  const child=remote?undefined:spawn(process.execPath,["--import","tsx","scripts/voice-server.ts"],{env:{...process.env,PORT:"3110",VOICE_TTS_PROVIDER:"aura-2",VOICE_FAQ_ENABLED:"false",VOICE_PERSIST_LOGS:"false",VOICE_DEMO_ACCESS_TOKEN:"",VOICE_DEPLOYMENT_LABEL:"Lahore local",VOICE_BIND_ADDRESS:"127.0.0.1",VOICE_ACKNOWLEDGEMENT:String(ack)},stdio:["ignore","pipe","pipe"],windowsHide:true});
  // Do not forward provider errors/headers or environment to logs.
  child?.stdout?.resume();child?.stderr?.resume();
  const deadline=setTimeout(()=>child?.kill(),240000);
  const browser=await chromium.launch({channel:"msedge",headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
  try{
    const probeContext=await browser.newContext(),probe=await probeContext.newPage();let health:any,unready=false;
    for(let i=0;i<120;i++){
      try{const response=await probe.goto(`${target}/voice-health`,{timeout:15000});const text=await probe.locator("body").innerText();try{health=JSON.parse(text);}catch{}if(response?.ok()&&health?.ok)break;unready=true;}catch{unready=true;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    report.readiness={launchOrFirstProbeToBrowserReadyMs:performance.now()-launchAt,applicationStartup:health?.startup??null,fixedAudio:health?.fixedAudio??null,unreadyObserved:unready,kind:remote?(unready?"readiness wait observed; idle-wake cause not verified":"already warm; no cold-start measurement"):"fresh local process application startup; excludes fixture synthesis"};
    if(!health?.ok)throw Error("Voice health never became ready");if(health.location!==report.location)throw Error("Deployment label mismatch; refusing to mislabel a local/tunnel server as US-hosted");
    report.ttsTransport=health.ttsTransport??"not-reported";
    report.settings={endpointMode:health.endpointMode,adaptive:health.adaptive,endpointProfile:health.endpointProfile,speculationEnabled:health.speculationEnabled,cache:health.fixedAudio?.enabled,acknowledgement:health.fixedAudio?.acknowledgement,source:"server health"};await probeContext.close();
    for(const model of (ab?["flux","nova-3","nova-3-en-IN"]:["flux","nova-3"] )){
      const context=await browser.newContext();const page=await context.newPage();const pageErrors:string[]=[];page.on("pageerror",error=>pageErrors.push(error.message));
      await page.addInitScript("globalThis.__name = function(target){return target}; (" + (()=>{
        const state:any={clock:{rtt:Infinity,offset:0},events:[],metrics:[],contentMetrics:[],usage:0,fixtureEOS:null,seen:new Set(),contentSeen:new Set()};(window as any).__liveVoice=state;
        const Native=window.WebSocket;
        class ObservedSocket extends Native{
          constructor(url:string,protocols?:string|string[]){super(url,protocols);if(!String(url).includes("/ws/voice"))return;
            this.addEventListener("message",event=>{
              const now=performance.now();
              if(event.data instanceof ArrayBuffer){const data=new DataView(event.data);if(data.byteLength<5)return;const generation=data.getUint32(0,true);
                if(generation===0||!state.fixtureEOS||!state.audio||generation!==state.audio.generation)return;
                if(state.content?.generation===generation&&!state.contentSeen.has(generation)){state.contentSeen.add(generation);state.contentMetrics.push({generation,contentTotalMs:now-state.fixtureEOS});}
                if(state.seen.has(generation))return;
                state.seen.add(generation);const first=state.audio,clock=state.clock;
                state.metrics.push({generation,totalMs:now-state.fixtureEOS,endpointAndUplinkMs:first.finalAt-clock.offset-state.fixtureEOS,engineMs:first.engineMs,ttsFirstByteMs:first.ttsFirstByteMs,returnNetworkMs:now-(first.firstAt-clock.offset),browserRttMs:clock.rtt,clockUncertaintyMs:clock.rtt/2,firstByteCached:first.firstByteCached,acknowledgement:first.acknowledgement});return;
              }
              let message:any;try{message=JSON.parse(event.data);}catch{return;}
              if(message.type==="pong"){const rtt=now-message.sent;if(rtt<state.clock.rtt)state.clock={rtt,offset:message.server-(now+message.sent)/2};}
              if(message.type==="audio_start")state.audio=message;
              if(message.type==="content_start")state.content=message;
              if(message.type==="usage")state.usage+=message.ttsCharacters;
              if(["transcript","reply","error","ready"].includes(message.type))state.events.push(message);
            });
          }
        }
        (window as any).WebSocket=ObservedSocket;
        navigator.mediaDevices.getUserMedia=async()=>{
          const audio=new AudioContext({sampleRate:48000}),dest=audio.createMediaStreamDestination();await audio.resume();
          state.feed=(samples:number[])=>{
            const buffer=audio.createBuffer(1,samples.length,24000);buffer.copyToChannel(Float32Array.from(samples),0);
            const source=audio.createBufferSource();source.buffer=buffer;source.connect(dest);
            const at=audio.currentTime+.08;let last=samples.length-1;while(last>0&&Math.abs(samples[last])<.001)last--;
            state.fixtureEOS=performance.now()+(at-audio.currentTime+last/24000)*1000;
            source.start(at);source.onended=()=>source.disconnect();
          };
          // Keep the destination alive and provide real silence between phrases.
          const zero=audio.createConstantSource();zero.offset.value=0;zero.connect(dest);zero.start();
          state.finish=()=>void audio.close();return dest.stream;
        };
      }).toString() + ")();");
      const run:Record<string,any>={model,rows:[]};
      try{
        await page.goto(`${target}/voice`);await page.getByLabel("Recognition model").selectOption(model);
        if(remote)await page.getByLabel("Hosted demo access code").fill(process.env.VOICE_DEMO_ACCESS_TOKEN||"");
        await page.getByRole("button",{name:"Start microphone"}).click();
        await page.waitForFunction(()=>{const s=(window as any).__liveVoice;return s.events.some((e:any)=>e.type==="ready")||s.events.some((e:any)=>e.type==="error");},{},{timeout:25000});
        const startError=await page.evaluate(()=>(window as any).__liveVoice.events.find((event:any)=>event.type==="error"));
        if(startError)throw Error(startError.code);
        await page.getByRole("status").filter({hasText:"Listening"}).waitFor({timeout:15000});await page.waitForTimeout(900);
        for(let i=0;i<fixtures.length;i++){
          const before=await page.evaluate(()=>(window as any).__liveVoice.metrics.length);
          const pcm=audio[i],samples:number[]=[];for(let j=0;j<pcm.length;j+=2)samples.push(pcm.readInt16LE(j)/32768);
          await page.evaluate(samples=>(window as any).__liveVoice.feed(samples),samples);
          try{await page.waitForFunction((before:number)=>(window as any).__liveVoice.metrics.length>before,before,{timeout:18000});}
          catch{run.rows.push({input:fixtures[i].text,ok:false,failure:"No first audio within eighteen seconds",events:await page.evaluate(()=>(window as any).__liveVoice.events.slice(-3))});break;}
          await page.waitForTimeout(450);
          const result=await page.evaluate(()=>{const s=(window as any).__liveVoice;return {metric:s.metrics.at(-1),contentMetric:s.contentMetrics.find((row:any)=>row.generation===s.metrics.at(-1)?.generation)??null,transcript:s.events.filter((e:any)=>e.type==="transcript").at(-1)?.text,reply:s.events.filter((e:any)=>e.type==="reply").at(-1)};});
          const expected=fixtures[i],reply=result.reply?.text??"",cart=result.reply?.cart??[];
          const ok=(!expected.id||cart.some((item:any)=>item.itemId===expected.id&&item.qty===expected.qty&&(!expected.size||item.size===expected.size)&&(!expected.spice||item.spiceLevel===expected.spice)))&&(!expected.mustAsk||reply.toLowerCase().includes(expected.mustAsk.toLowerCase()))&&(!expected.unavailable||/(?:isn't|not|don't have).*(?:menu|dish)/i.test(reply));
          run.rows.push({input:expected.text,transcript:result.transcript,expected,cart,reply,ok,metric:result.metric,contentMetric:result.contentMetric});
          await page.waitForTimeout(600);
        }
        run.ttsCharacters=await page.evaluate(()=>(window as any).__liveVoice.usage);
        await page.getByRole("button",{name:"End call"}).click();await page.evaluate(()=>(window as any).__liveVoice.finish());
      }catch(error){run.failure=error instanceof Error?error.message:"Live test failed";run.status=await page.getByRole("status").allTextContents();run.pageErrors=pageErrors;run.events=await page.evaluate(()=>(window as any).__liveVoice.events);}
      report.runs.push(run);await context.close();await new Promise(resolve=>setTimeout(resolve,600));
    }
  }finally{clearTimeout(deadline);await browser.close();child?.kill();writeFileSync(ab?`eval/results/voice-${remote?"us":"lahore"}-ab-${ack?"on":"off"}.json`:remote?"eval/results/voice-us-hosted.json":"eval/results/voice-lahore-local.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
}
void main().then(()=>process.exit(0)).catch(()=>{console.error("Live smoke failed during setup; no credentials or audio were logged.");process.exit(1);});
