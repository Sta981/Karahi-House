export function parseVoiceCsv(text){
 const rows=[];let row=[],cell="",quoted=false;
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(char==='"'){if(quoted&&text[index+1]==='"'){cell+='"';index++;}else quoted=!quoted;}
  else if(char===','&&!quoted){row.push(cell);cell="";}
  else if(char==='\n'&&!quoted){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}
  else cell+=char;
 }
 if(quoted)throw Error("CSV ends inside a quoted cell");
 if(cell||row.length){row.push(cell);rows.push(row);}
 const fields=rows.shift()?.map(field=>field.replace(/^\uFEFF/,""))??[];
 if(!fields.includes("turn_id")||!fields.includes("transcript_redacted"))throw Error("Not a voice turn export");
 return rows.filter(row=>row.some(Boolean)).map(row=>{if(row.length!==fields.length)throw Error("CSV column count mismatch");return Object.fromEntries(fields.map((field,index)=>[field,row[index]]));});
}
export function voicePercentiles(values){const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);const at=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;return {n:sorted.length,p50:at(.5),p95:at(.95),max:sorted.at(-1)??null};}
export function summarizeVoiceCsv(rows){
 const metric=field=>voicePercentiles(rows.filter(row=>row[field]!==undefined&&row[field]!==""&&Number.isFinite(Number(row[field]))).map(row=>Number(row[field])));
 return {rows:rows.length,quantiles:"nearest rank; matches the current /voice dashboard",models:[...new Set(rows.map(row=>row.model))],endpointProfiles:[...new Set(rows.map(row=>row.endpoint_profile))],buildCommits:[...new Set(rows.map(row=>row.build_commit||"unknown"))],ttsProviders:[...new Set(rows.map(row=>row.tts_provider||"unknown"))],informativePlaybackMs:metric("first_informative_playback_ms"),informativeByteMs:metric("first_informative_byte_ms"),firstByteMs:metric("total_ms"),engineMs:metric("engine_ms"),contentFirstByteMs:metric("tts_content_first_byte_ms"),ackToContentGapMs:metric("acknowledgement_gap_ms"),missingInformativePlayback:rows.filter(row=>row.first_informative_playback_ms===undefined||row.first_informative_playback_ms==="").length,playbackFinished:rows.filter(row=>row.playback_finished==="true").length,bargeInCuts:rows.filter(row=>row.interrupted_by_barge_in==="true").length,statuses:rows.reduce((counts,row)=>(counts[row.status]=(counts[row.status]??0)+1,counts),{})};
}
