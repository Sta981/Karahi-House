import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { safeTranscript, type VoiceLogRow } from "./turn-log";
export class LocalTurnLog {
  private directory:string;
  constructor(directory=path.resolve(".data/voice-logs")) {
    this.directory=path.resolve(directory);mkdirSync(this.directory,{recursive:true,mode:0o700});
    const cutoff=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
    for(const name of readdirSync(this.directory)) {
      const match=/^turns-(\d{4}-\d{2}-\d{2})\.(?:jsonl|csv)$/.exec(name);if(!match||match[1]>cutoff)continue;
      const target=path.resolve(this.directory,name);
      if(path.dirname(target)!==this.directory)throw Error("Log retention path escaped private directory");
      unlinkSync(target);
    }
  }
  write(row:VoiceLogRow) {
    const file=path.join(this.directory,`turns-${new Date().toISOString().slice(0,10)}.jsonl`);
    appendFileSync(file,JSON.stringify({...row,transcript:safeTranscript(row.transcript)})+"\n",{encoding:"utf8",mode:0o600});
  }
}
