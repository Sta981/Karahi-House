// Shared, browser-safe log format. No audio, callback number or customer fields.
import { redactPhoneNumbers } from "../lib/privacy";
export type LatencyStages = { totalMs: number; endpointAndUplinkMs: number; engineMs: number; ttsFirstByteMs: number; returnNetworkMs: number; browserRttMs: number; clockUncertaintyMs: number };
export type VoiceLogRow = {
  turnId: string; atUtc: string; location: string; model: string; endpointProfile: string;
  transcript: string; matchedCart: { itemId:string; qty:number; size:string|null; spice:string|null; unitPriceCents:number }[];
  endpointReason: string; status: "awaiting_audio"|"first_audio"|"no_audio"|"failed";
  engineMs: number; ttsFirstByteMs: number|null; firstByteCached: boolean; speculativeHit: boolean; preparationMs:number;
  latency: LatencyStages|null; acknowledgement?:boolean;contentFirstByteMs?:number;
};
export function safeTranscript(text:string) {
  // Even spoken-out callback numbers must not enter logs. Display in the live
  // call is separate; only this redacted representation is persisted/exported.
  const normalized=text.replace(/[۰-۹٠-٩०-९]/g,digit=>String(digit.charCodeAt(0)-(digit>="۰"&&digit<="۹"?0x6f0:digit>="٠"&&digit<="٩"?0x660:0x966)));
  if(/\b(?:callback|call.?back|phone|contact|mobile|call me|my number|mera number|number is)\b/i.test(normalized))return "[callback turn redacted]";
  // STT may spell a bare callback answer without any phone-related prefix.
  // Seven adjacent digit words are a phone candidate, never an order quantity.
  const digitWord="(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple|ek|aik|do|teen|char|chaar|paanch|panch|cheh|chhe|saat|aath|nau|sifar|shunya)";
  const spokenPhone=new RegExp(`\\b${digitWord}(?:[\\s,.-]+${digitWord}){6,}\\b`,"gi");
  return redactPhoneNumbers(normalized.replace(spokenPhone,"[phone redacted]")).slice(0,1000);
}
export function loggedCart(cart:Record<string,any>[]):VoiceLogRow["matchedCart"] {
  return cart.map(line=>({itemId:String(line.itemId),qty:Number(line.qty),size:line.size??null,spice:line.spiceLevel??null,unitPriceCents:Number(line.unitPriceCents)}));
}
export function csvCell(value:unknown) {
  let text=typeof value==="object"&&value!==null?JSON.stringify(value):value==null?"":String(value);
  if(typeof value==="string"&&/^[\s]*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function voiceCsv(rows:VoiceLogRow[]) {
  const fields=["turn_id","at_utc","location","model","endpoint_profile","transcript_redacted","matched_cart","endpoint_reason","status","first_byte_cached","speculative_hit","preparation_ms","total_ms","stt_endpointing_uplink_ms","engine_ms","tts_first_byte_ms","return_network_ms","browser_rtt_ms","clock_uncertainty_ms","acknowledgement","tts_content_first_byte_ms"];
  return [fields.map(csvCell).join(","),...rows.map(row=>[row.turnId,row.atUtc,row.location,row.model,row.endpointProfile,safeTranscript(row.transcript),row.matchedCart,row.endpointReason,row.status,row.firstByteCached,row.speculativeHit,row.preparationMs,row.latency?.totalMs,row.latency?.endpointAndUplinkMs,row.engineMs,row.ttsFirstByteMs,row.latency?.returnNetworkMs,row.latency?.browserRttMs,row.latency?.clockUncertaintyMs,row.acknowledgement??false,row.contentFirstByteMs].map(csvCell).join(","))].join("\r\n")+"\r\n";
}
