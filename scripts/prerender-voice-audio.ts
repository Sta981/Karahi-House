// Build-only synthetic speech. No caller text/audio or private eval data.
import { existsSync,mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { AuraTts } from "../voice/tts";
import { FIXED_PHRASES,AUDIO_IDENTITY,AUDIO_VOICE,audioFile } from "../voice/audio-catalog";
async function main(){
 if(existsSync(".env.local"))loadEnvFile(".env.local");
 const directory=path.resolve("public/voice-audio");mkdirSync(directory,{recursive:true});
 const previous=existsSync(path.join(directory,"manifest.json"))?JSON.parse(readFileSync(path.join(directory,"manifest.json"),"utf8")):undefined;
 const progressPath=path.resolve(".data/static-speech-progress.json"),progress=existsSync(progressPath)?JSON.parse(readFileSync(progressPath,"utf8")):[];
 const tts=new AuraTts(60000),rows:any[]=[];let generated=0,sourceCharacters=0,next=0;const started=performance.now();
 const worker=async()=>{while(next<FIXED_PHRASES.length){const index=next++,phrase=FIXED_PHRASES[index];
   const file=audioFile(phrase.text),target=path.join(directory,file);
   const old=previous?.entries?.find((entry:any)=>entry.file===file)??progress.find((entry:any)=>entry.file===file);
   let pcm:Buffer|undefined;
   if(old&&existsSync(target)){const candidate=readFileSync(target);if(createHash("sha256").update(candidate).digest("hex")===old.sha256)pcm=candidate;}
   if(!pcm){
     if(process.argv.includes("--check"))throw Error("Static speech is missing or stale. Run npm run voice:prerender with signup credits.");
     const chunks:Buffer[]=[];for await(const chunk of tts.speak(phrase.text,AbortSignal.timeout(60000)))chunks.push(chunk);
     pcm=Buffer.concat(chunks);if(!pcm.length||pcm.length%2)throw Error("Invalid build-only PCM");
     writeFileSync(target,pcm);generated++;sourceCharacters+=phrase.text.length;
     mkdirSync(path.dirname(progressPath),{recursive:true});progress.push({file,sha256:createHash("sha256").update(pcm).digest("hex")});writeFileSync(progressPath,JSON.stringify(progress));
   }
   rows[index]={id:phrase.id,text:phrase.text,file,bytes:pcm.length,sha256:createHash("sha256").update(pcm).digest("hex")};
   if(generated&&generated%10===0)console.log(JSON.stringify({event:"static_build_progress",generated,total:FIXED_PHRASES.length}));
 }};
 try{const results=await Promise.allSettled([worker(),worker()]);for(const result of results)if(result.status==="rejected")throw result.reason;}finally{tts.close();}
 writeFileSync(path.join(directory,"manifest.json"),JSON.stringify({kind:"fixed-synthetic-menu-templates-only",identity:AUDIO_IDENTITY,voice:AUDIO_VOICE,sampleRate:24000,entries:rows},null,2)+"\n");
 const result={kind:"build-only-static-speech",generated,reused:rows.length-generated,entries:rows.length,sourceCharacters,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),elapsedMs:performance.now()-started,callerAudioStored:false,transcriptsStored:false};
 if(generated&&existsSync("eval/results"))writeFileSync("eval/results/voice-static-build.json",JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify(result));
}
void main().catch(()=>{console.error("Static speech build failed. Check Deepgram credentials/credits or regenerate missing assets locally; no provider payload logged.");process.exitCode=1;});
