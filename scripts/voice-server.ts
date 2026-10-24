import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { randomUUID, timingSafeEqual } from "node:crypto";
import next from "next";
import WebSocket, { WebSocketServer } from "ws";
import { makeTts } from "../voice/tts";
import { openStt, KEYTERMS,stateKeyterms } from "../voice/stt";
import { VoiceSession } from "../voice/session";
import { FixedAudioTts } from "../voice/fixed-audio";
import { ContinuationGuard } from "../voice/continuation";
import { DEFAULT_ADAPTIVE,COMPLETE_WAIT,adaptiveWait } from "../voice/phrase-completeness";
import { endpointSettings } from "../voice/endpointing";
import { type VoiceLogRow } from "../voice/turn-log";
import { TurnRecorder } from "../voice/turn-recorder";
import type { SttModel, SttStream } from "../voice/contracts";

async function main() {
const bootStarted=performance.now();
if (existsSync(".env.local")) loadEnvFile(".env.local");
const port = Number(process.env.PORT || 3000);
const locationLabel=process.env.VOICE_DEPLOYMENT_LABEL|| (process.env.RENDER==="true"?"US-hosted":"Lahore local");
if(!["Lahore local","US-hosted"].includes(locationLabel))throw Error("Unknown deployment label");
const host = process.env.VOICE_BIND_ADDRESS || (locationLabel==="US-hosted"?"0.0.0.0":"127.0.0.1");
const accessCode=process.env.VOICE_DEMO_ACCESS_TOKEN?.trim()||"";
if(host!=="127.0.0.1"&&accessCode.length<24)throw Error("Public demo requires a private access code of at least twenty-four characters");
if(process.env.VOICE_PERSIST_LOGS==="true")throw Error("Server transcript persistence is disabled. Use browser-local CSV exports.");
const logToDisk=false;
const app = next({ dev: process.env.NODE_ENV !== "production", hostname: host, port });
await app.prepare();
const nextReadyMs=performance.now()-bootStarted;
const handle = app.getRequestHandler();
const ttsName = process.env.VOICE_TTS_PROVIDER?.trim() || "aura-2";
const tts = new FixedAudioTts(makeTts(ttsName), process.env.VOICE_FIXED_AUDIO_CACHE !== "false");
let warmError = "";
let readyMs:number|null=null;
// Fixed synthetic phrases are rendered once per boot using signup credits;
// this startup cost/time is separate from warm turn latency. No caller audio.
const warm = tts.warm().then(()=>{readyMs=performance.now()-bootStarted;}).catch(() => { warmError = "TTS is unavailable. Check credentials, credits and connection; no fallback provider was called."; });
const server = createServer((req, res) => {
  if (req.url === "/voice-health") {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    res.statusCode=!warmError&&readyMs!==null?200:503;
    res.end(JSON.stringify({
      ok:!warmError&&readyMs!==null,tts:ttsName,stt:["flux","nova-3","nova-3-en-IN"],location:locationLabel,
      keyterms:KEYTERMS.length,keyPresent:!!process.env.DEEPGRAM_API_KEY?.trim(),faqEnabled:process.env.VOICE_FAQ_ENABLED==="true",
      recordingsStored:false,transcriptsPersisted:false,fixedAudio:tts.stats(),startup:{nextReadyMs,readyMs},
      requiresAccessCode:!!accessCode,localLogs:logToDisk,endpointProfile:process.env.VOICE_ENDPOINT_PROFILE||"baseline",
      endpointMode:process.env.VOICE_ENDPOINT_MODE||"adaptive",adaptive:{completeWaitMs:COMPLETE_WAIT,incompleteMs:DEFAULT_ADAPTIVE.incompleteMs,uncertainMs:DEFAULT_ADAPTIVE.uncertainMs},speculationEnabled:false
    }));return;
  }
  void handle(req, res);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
server.on("upgrade", (req, socket, head) => {
  if (req.url?.split("?")[0] !== "/ws/voice") { void app.getUpgradeHandler()(req, socket, head); return; }
  // Browser same-origin check; no public credential-bearing socket without it.
  let allowed = false;
  try { allowed = new URL(req.headers.origin || "").host === req.headers.host; } catch {}
  if (!allowed || wss.clients.size >= 1) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});
wss.on("connection", ws => {
  let stt: SttStream | undefined, session: VoiceSession | undefined, guard: ContinuationGuard | undefined, starting = false, active = false, frames = 0;
  const meta={callId:randomUUID(),location:locationLabel,model:"",profile:""};
  const publish=(row:VoiceLogRow)=>{
    if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"turn_log",row}));
  };
  const recorder=new TurnRecorder(meta,publish);
  const emit = (event: Record<string, unknown> | Buffer) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) { ws.close(1013, "Audio connection too slow"); return; }
    ws.send(Buffer.isBuffer(event) ? event : JSON.stringify(event));
    if(Buffer.isBuffer(event))return;
    recorder.event(event);
    if(event.type==="reply"&&process.env.VOICE_STATE_KEYTERMS!=="false")stt?.configureKeyterms?.(stateKeyterms(session?.recognitionHints()??[]));
  };
  const stop = () => { active = false; stt?.close(); stt = undefined; guard?.close(); guard = undefined; session?.close(); session = undefined;recorder.end(); };
  const limit = setTimeout(() => { stop(); ws.close(1000, "Ten minute demo limit"); }, 600000);
  ws.on("message", async (bytes, binary) => {
    if (binary) {
      if (!active || !stt || bytes instanceof Array) return;
      const pcm = Buffer.from(bytes as Buffer);
      if (pcm.length !== 2560) { emit({ type: "error", code: "invalid_audio_frame" }); return; }
      frames++; guard?.audio(pcm); stt.send(pcm); return;
    }
    let message: Record<string, any>;
    try { message = JSON.parse(bytes.toString()); } catch { return; }
    if (message.type === "ping" && typeof message.sent === "number") { emit({ type: "pong", sent: message.sent, server: performance.now() }); return; }
    if(message.type==="latency"){
      recorder.latency(Number(message.generation),message.timing);return;
    }
    if (message.type === "stop") { stop(); ws.close(); return; }
    if (message.type === "barge_in") { session?.interrupt(); return; }
    if (message.type === "mic_ready" && active) { void session?.greet(); return; }
    if (message.type !== "start" || active || starting) return;
    if(accessCode){const entered=Buffer.from(typeof message.accessCode==="string"?message.accessCode:"");const expected=Buffer.from(accessCode);if(entered.length!==expected.length||!timingSafeEqual(entered,expected)){emit({type:"error",code:"access_denied",message:"Enter the private demo access code."});ws.close(1008,"Access denied");return;}}
    const model: SttModel = message.model === "nova-3" ? "nova-3" : message.model==="nova-3-en-IN"?"nova-3-en-IN":"flux";
    starting = true;
    try {
      await warm;
      if (warmError) throw Error(warmError);
      if (ws.readyState !== WebSocket.OPEN) return;
      session = new VoiceSession(tts, emit, process.env.VOICE_FAQ_ENABLED === "true");
      const completeMs=Number(process.env.VOICE_ADAPTIVE_COMPLETE_MS||adaptiveWait(model).completeMs);
      if(!Number.isInteger(completeMs)||completeMs<100||completeMs>1600)throw Error("Invalid adaptive wait");
      const adaptive={...DEFAULT_ADAPTIVE,completeMs};
      const wait=process.env.VOICE_ENDPOINT_MODE==="fixed"?1600:adaptive;
      const profile = endpointSettings(model,process.env.VOICE_ENDPOINT_PROFILE||"baseline");
      meta.model=model;meta.profile=`${profile.id}+${typeof wait==="number"?"fixed1600":`adaptive${completeMs}`}`;
      guard = new ContinuationGuard(wait,event=>void session?.turn(event.text,event.audioEndSeconds,event.endpointReason));
      stt = await openStt(model, event => {
        if (event.type === "speech") session?.interrupt();
        else if (event.type === "final") { guard?.final(event); }
        else if (event.type === "partial"||event.type==="configuration") { emit(event); }
        else { emit(event); stop(); ws.close(1011, "STT failed"); }
      },profile);
      if (ws.readyState !== WebSocket.OPEN) { stop(); return; }
      active = true;
      emit({ type: "ready", model, tts: ttsName, sampleRate: 16000, frameMs: 80, keyterms: KEYTERMS.length, recordingsStored: false, endpointProfile: profile.id, endpointMode:typeof wait==="number"?"fixed":"adaptive",speculationEnabled:false,location:locationLabel,localLogs:logToDisk });
    } catch {
      emit({ type: "error", code: "voice_start_failed", message: warmError || "Could not connect to Deepgram. Check the key, credits and network; no fallback provider was called." });
      stop(); ws.close(1011, "Voice start failed");
    } finally { starting = false; }
  });
  ws.on("error", stop);
  ws.on("close", () => { clearTimeout(limit); stop(); console.log(JSON.stringify({ event: "voice_closed", audioFrames: frames, audioMinutes: frames * .08 / 60, recordingsStored: false })); });
});
server.listen(port, host, () => console.log(`Streaming demo: http://${host}:${port}/voice (TTS=${ttsName}; LLM FAQ ${process.env.VOICE_FAQ_ENABLED === "true" ? "enabled" : "off"}; no recording)`));
function shutdown() { for (const client of wss.clients) client.close(); tts.close(); server.close(); void app.close().then(() => process.exit()); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
}
void main().catch(() => { console.error("Voice server could not start; check the port and configuration."); process.exitCode = 1; });
