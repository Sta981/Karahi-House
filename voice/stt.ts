import WebSocket from "ws";
import source from "../lib/menu-source.json";
import { NOVA_MULTILINGUAL_LANGUAGE_HINTS, type SttEvent, type SttModel, type SttStream } from "./contracts";
import { endpointSettings, type EndpointSettings } from "./endpointing";
import { sttCloseError } from "./connection-status";

// Final-source vocabulary only; no notes, caller identity or price data.
export const MENU_WORDS = [...new Set(source.items.flatMap(item => item.name.match(/[A-Za-z]+/g) ?? []))];
// Familiar English descriptors do not need phonetic bias. Preserve all South
// Asian dish vocabulary and proteins; keep the actual provider tokenizer budget.
const COMMON_WORDS = new Set("Bread or for People Can Pieces Kids Leg Breast Black White Green Ice Cream Mixed Pickles Nuggets Burger Fries Sweet Salty Plain Spicy Cheese Onion Butter Mango Vegetable Garlic Chili".toLowerCase().split(" "));
export function boundedKeyterms(terms:string[]):string[]{
 const result:string[]=[];let bytes=0;
 for(const term of [...new Set(terms)]){const length=Buffer.byteLength(term,"utf8")+1;if(bytes+length>450)continue;result.push(term);bytes+=length;}
 return result;
}
// Repeated plain query parameters, multi-word phrases kept in one value. A
// conservative UTF-8 byte bound is stricter than the documented 500-token cap;
// it is not a claim to implement Deepgram's private tokenizer.
export const KEYTERMS=boundedKeyterms(["chicken karahi","garlic naan","seekh kabab",...MENU_WORDS.filter(word=>!COMMON_WORDS.has(word.toLowerCase()))]);
export const stateKeyterms=(answers:string[])=>boundedKeyterms([...answers,...KEYTERMS]);
export function sttUrl(model: SttModel, settings = endpointSettings(model),terms:readonly string[]=KEYTERMS) {
  const url = new URL(model === "flux" ? "wss://api.deepgram.com/v2/listen" : "wss://api.deepgram.com/v1/listen");
  const options = model === "flux" ? { model: "flux-general-en", eot_threshold: String(settings.fluxThreshold), eot_timeout_ms: String(settings.fluxTimeoutMs) } :
    { model: "nova-3", language: model==="nova-3-en-IN"?"en-IN":"multi", channels: "1", interim_results: "true", vad_events: "true", endpointing: String(settings.novaEndpointMs), utterance_end_ms: String(settings.novaUtteranceEndMs) };
  for (const [key, value] of Object.entries({ ...options, encoding: "linear16", sample_rate: "16000", mip_opt_out: "true" }))
    if (value !== undefined) url.searchParams.set(key, value);
  for (const term of boundedKeyterms([...terms])) url.searchParams.append("keyterm", term);
  if(model==="nova-3")for(const language of NOVA_MULTILINGUAL_LANGUAGE_HINTS)url.searchParams.append("language_hint",language);
  return url.toString();
}

// Only finalized provider turns may enter the engine. Interims never change a cart.
export class TranscriptDecoder {
  private pieces: string[] = [];
  private seen = new Set<string>();
  private lastEnd: number | null = null;
  constructor(private model: SttModel, private emit: (event: SttEvent) => void) {}
  accept(message: Record<string, any>) {
    if(message.type==="ConfigureSuccess"||message.type==="ConfigureFailure")return this.emit({type:"configuration",accepted:message.type==="ConfigureSuccess"});
    if (message.type === "Error") return this.emit({ type: "error", code: "stt_provider_error" });
    if (this.model === "flux") {
      if (message.type !== "TurnInfo") return;
      if (message.event === "StartOfTurn" || message.event === "TurnResumed") this.emit({ type: "speech" });
      const text = String(message.transcript ?? "").trim();
      if (message.event !== "EndOfTurn") { if (text) this.emit({ type: "partial", text }); return; }
      const id = `flux:${message.turn_index}`;
      if (!text || this.seen.has(id)) return;
      this.remember(id);
      const end = message.words?.at(-1)?.end ?? message.audio_window_end;
      this.emit({ type: "final", text, audioEndSeconds: typeof end === "number" ? end : null, endpointReason: String(message.trigger??"").toLowerCase().includes("timeout") ? "flux_timeout" : "flux_confidence" });
      return;
    }
    if (message.type === "SpeechStarted") { this.emit({ type: "speech" }); return; }
    if (message.type === "UtteranceEnd") { this.flush("nova_utterance_end"); return; }
    if (message.type !== "Results") return;
    const alternative = message.channel?.alternatives?.[0];
    const text = String(alternative?.transcript ?? "").trim();
    const id = `nova:${message.start}:${message.duration}`;
    if (message.is_final && text && !this.seen.has(id)) {
      this.remember(id); this.pieces.push(text);
      this.lastEnd = alternative.words?.at(-1)?.end ?? (message.start + message.duration);
    } else if (text && !message.is_final) this.emit({ type: "partial", text: [...this.pieces,text].join(" ") });
    if (message.speech_final) this.flush("nova_speech_final");
  }
  private remember(id: string) { this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!); }
  private flush(endpointReason: string) {
    const text = this.pieces.join(" ").trim(); this.pieces = [];
    if (text) this.emit({ type: "final", text, audioEndSeconds: this.lastEnd, endpointReason });
    this.lastEnd = null;
  }
}

export async function openStt(model: SttModel, emit: (event: SttEvent) => void, settings?: EndpointSettings,options?:{keyterms?:string[]}): Promise<SttStream> {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) throw Error("DEEPGRAM_API_KEY is missing");
  const url=sttUrl(model,settings,options?.keyterms??KEYTERMS);
  const socket = new WebSocket(url, { headers: { Authorization: `Token ${key}` }, handshakeTimeout: 15000 });
  const decoder = new TranscriptDecoder(model, emit);
  let closed = false;
  socket.on("message", bytes => {
    try { decoder.accept(JSON.parse(bytes.toString())); } catch { emit({ type: "error", code: "stt_invalid_message" }); }
  });
  socket.on("error", () => { if (!closed) emit({ type: "error", code: "stt_connection_failed" }); });
  socket.on("close", (code, reason) => { if (!closed) emit(sttCloseError(code, reason.toString())); });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", () => reject(Error("Deepgram connection failed; check key, credits and network")));
    socket.once("unexpected-response", (_req, res) => { res.resume(); socket.terminate(); reject(Error(`Deepgram handshake HTTP ${res.statusCode}`)); });
  });
  console.log(JSON.stringify({event:"stt_connected",model,keytermCount:new URL(url).searchParams.getAll("keyterm").length,languageHints:new URL(url).searchParams.getAll("language_hint")}));
  return {
    configureKeyterms(terms){if(!closed&&socket.readyState===WebSocket.OPEN){const bounded=boundedKeyterms(terms);socket.send(JSON.stringify({type:"Configure",keyterms:bounded}));console.log(JSON.stringify({event:"stt_keyterms_sent",model,keytermCount:bounded.length}));}},
    send(pcm) {
      if (closed || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 128000) { emit({ type: "error", code: "stt_audio_backpressure" }); return; }
      socket.send(pcm);
    },
    close() {
      if (closed) return; closed = true;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
      socket.close(); setTimeout(() => socket.terminate(), 1000).unref();
    },
  };
}
