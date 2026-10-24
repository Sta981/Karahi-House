import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
// Fixed PUBLIC text only; PCM stays in parent/child memory and is never printed.
export function syntheticAudio(rows){
 const encoded=execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File","scripts/synthetic-audio.ps1"],{windowsHide:true,input:JSON.stringify(rows),encoding:"utf8",maxBuffer:32*1024*1024,stdio:["pipe","pipe","pipe"]});
 const generated=JSON.parse(encoded);
 return generated.map(row=>{let pcm=Buffer.from(row.pcm,"base64");if(pcm.toString("ascii",0,4)==="RIFF")for(let at=12;at+8<=pcm.length;){const length=pcm.readUInt32LE(at+4);if(pcm.toString("ascii",at,at+4)==="data"){pcm=pcm.subarray(at+8,at+8+length);break;}at+=8+length+(length%2);}
  return {id:row.id,voice:row.voice,pcm,sha256:createHash("sha256").update(pcm).digest("hex")};});
}
