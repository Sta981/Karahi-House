import { readdirSync,readFileSync,writeFileSync,mkdirSync } from "node:fs";
import path from "node:path";
import { voiceCsv,type VoiceLogRow } from "../voice/turn-log";
const directory=path.resolve(".data/voice-logs");mkdirSync(directory,{recursive:true});
const rows=new Map<string,VoiceLogRow>();
for(const name of readdirSync(directory).filter(name=>/^turns-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)))for(const line of readFileSync(path.join(directory,name),"utf8").split(/\r?\n/))if(line.trim()){const row=JSON.parse(line) as VoiceLogRow;rows.set(row.turnId,row);}
const name=`turns-${new Date().toISOString().slice(0,10)}.csv`,output=path.join(directory,name);writeFileSync(output,voiceCsv([...rows.values()].sort((a,b)=>a.atUtc.localeCompare(b.atUtc))));
console.log(`Exported ${rows.size} redacted turns to .data/voice-logs/${name}. No audio or credentials included.`);
