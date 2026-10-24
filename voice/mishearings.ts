import { safeTranscript,csvCell } from "./turn-log";
export type Mishearing={turnId:string;atUtc:string;model:string;location:string;heard:string;intended:string};
// User-authored intent only. Browser export; no server request or auto-aliasing.
export function mishearingsCsv(rows:Mishearing[]):string{
 const fields=["turn_id","at_utc","model","deployment","stt_heard_redacted","user_meant_redacted","source","alias_review"];
 return [fields.map(csvCell).join(","),...rows.filter(row=>row.intended.trim()).map(row=>[row.turnId,row.atUtc,row.model,row.location,safeTranscript(row.heard),safeTranscript(row.intended),"user_correction","pending_manual_review"].map(csvCell).join(","))].join("\r\n")+"\r\n";
}
