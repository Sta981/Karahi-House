import { loadEnvFile } from "node:process";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { AuraWsTts } from "../voice/aura-ws";
import { FixedAudioTts, FIXED_PHRASES } from "../voice/fixed-audio";
async function main() {
  loadEnvFile(".env.local");
  const base = new AuraWsTts(), cached = new FixedAudioTts(base);
  const rows: Record<string,unknown>[] = [];
  const measure = async (tts: typeof base | typeof cached,text:string) => {
    const start=performance.now();let first:number|null=null,bytes=0;
    for await(const chunk of tts.speak(text,AbortSignal.timeout(30000))){first??=performance.now()-start;bytes+=chunk.length;}
    return {firstByteMs:first,completeMs:performance.now()-start,bytes};
  };
  try {
    await cached.warm(); console.log(JSON.stringify({startup:cached.stats()}));
    for (const [i,phrase] of FIXED_PHRASES.entries()) {
      const beforeFirst=i%2===0;
      const first=await measure(beforeFirst?base:cached,phrase.text),second=await measure(beforeFirst?cached:base,phrase.text);
      rows.push({id:phrase.id,before:beforeFirst?first:second,after:beforeFirst?second:first});
      console.log(`Fixed phrase ${i+1}/${FIXED_PHRASES.length} measured.`);
    }
    writeFileSync("eval/results/voice-cache.json",JSON.stringify({kind:"live-Aura-fixed-synthetic-phrases-only",location:"Lahore local",audioStored:false,cache:cached.stats(),rows},null,2)+"\n");
  } finally {cached.close();}
}
void main().catch(()=>{console.error("Fixed audio benchmark failed; no provider payload or credential logged.");process.exitCode=1;});
