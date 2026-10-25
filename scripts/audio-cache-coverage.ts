// Offline coverage of the PUBLIC script; no provider or held-out evaluation.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { newState, runTurn } from "../lib/dialog";
import { FixedAudioTts } from "../voice/fixed-audio";
async function main(){
 const tts=new FixedAudioTts({name:"aura-2",warm:async()=>{},close(){},async *speak(){throw Error("Unexpected provider call");}});
 await tts.warm();let state=newState();const rows=[];
 for(const row of JSON.parse(readFileSync("docs/real-mic-script.json","utf8")).rows){
  if(row.reset)state=newState();const result=runTurn(state,row.text.replace(/\[pause \d+ ms\]/g," "));state=result.state;
  rows.push({id:row.id,reply:result.reply,...tts.plan(result.reply)});
 }
 tts.close();mkdirSync("eval/results",{recursive:true});writeFileSync("eval/results/audio-cache-coverage.json",JSON.stringify({kind:"offline-public-synthetic-script-cache-coverage-not-STT-accuracy",providerCalls:0,fullyCached:rows.filter(row=>!row.dynamicCharacters).length,total:rows.length,rows},null,2)+"\n");
 console.log(JSON.stringify(rows.filter(row=>row.dynamicCharacters)));
}
void main();
