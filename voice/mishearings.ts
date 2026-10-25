import { safeTranscript,csvCell } from "./turn-log";
import type { VoiceRuntimeInfo } from "./runtime-info";
export type Mishearing={turnId:string;atUtc:string;model:string;location:string;heard:string;intended:string;runtime?:VoiceRuntimeInfo};
// User-authored intent only. Browser export; no server request or auto-aliasing.
export function mishearingsCsv(rows:Mishearing[]):string{
 const fields=["turn_id","at_utc","model","deployment","stt_heard_redacted","user_meant_redacted","source","alias_review","build_commit","build_dirty","stt_config","endpoint_settings","tts_provider","tts_model"];
 return [fields.map(csvCell).join(","),...rows.filter(row=>row.intended.trim()).map(row=>[row.turnId,row.atUtc,row.model,row.location,safeTranscript(row.heard),safeTranscript(row.intended),"user_correction","pending_manual_review",row.runtime?.buildCommit??"unknown",row.runtime?.buildDirty,row.runtime?.sttConfig,row.runtime?.endpointSettings,row.runtime?.ttsProvider??"unknown",row.runtime?.ttsModel??"unknown"].map(csvCell).join(","))].join("\r\n")+"\r\n";
}
