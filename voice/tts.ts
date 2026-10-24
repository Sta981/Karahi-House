import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { auraPronunciation, splitSpeech } from "./pronunciation.mjs";
import type { Tts } from "./contracts";
import { AuraWsTts } from "./aura-ws";

export class KokoroTts implements Tts {
  name = "kokoro";
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private id = 0;
  private tail: Promise<unknown> = Promise.resolve();
  warm() {
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const child = fork(path.resolve("voice/kokoro-worker.mjs"), [], { execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", ...{ windowsHide: true } });
      this.child = child;
      const timer = setTimeout(() => { child.kill(); reject(Error("Kokoro warmup timed out (model download or CPU).")); }, 300000);
      child.on("message", (msg: any) => {
        if (msg.type === "ready") { clearTimeout(timer); resolve(); }
        if (msg.type === "failure" && !msg.id) { clearTimeout(timer); reject(Error("Kokoro load failed; check model download and ONNX CPU runtime.")); }
      });
      child.on("error", () => { clearTimeout(timer); reject(Error("Kokoro worker failed")); });
      child.on("exit", () => { clearTimeout(timer); this.child = undefined; this.starting = undefined; reject(Error("Kokoro worker exited")); });
    });
    return this.starting;
  }
  private generate(text: string, signal: AbortSignal): Promise<Buffer> {
    const task = this.tail.catch(() => {}).then(async () => {
      signal.throwIfAborted(); await this.warm(); signal.throwIfAborted();
      const child = this.child!, id = ++this.id;
      return new Promise<Buffer>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
        const onExit = () => { cleanup(); reject(Error("Kokoro worker exited")); };
        const onMessage = (msg: any) => {
          if (msg.id !== id) return; cleanup();
          if (msg.type === "audio") resolve(Buffer.from(msg.pcm)); else reject(Error("Kokoro synthesis failed"));
        };
        const timer = setTimeout(() => { cleanup(); child.kill(); reject(Error("Kokoro synthesis timeout")); }, 30000);
        child.on("message", onMessage); child.once("exit", onExit); child.send({ type: "speak", id, text });
      });
    });
    // Cancelled CPU jobs finish in isolation; stale audio is discarded. Queue is
    // serialized, so rapidly interrupting cannot launch parallel CPU syntheses.
    this.tail = task; return task;
  }
  async *speak(text: string, signal: AbortSignal) {
    for (const part of splitSpeech(text)) {
      signal.throwIfAborted(); const pcm = await this.generate(part, signal); signal.throwIfAborted();
      for (let offset = 0; offset < pcm.length; offset += 3840) { signal.throwIfAborted(); yield pcm.subarray(offset, offset + 3840); }
    }
  }
  close() { this.child?.kill(); }
}
export class AuraTts implements Tts {
  name = "aura-2";
  constructor(private timeoutMs=20000){}
  async warm() { if (!process.env.DEEPGRAM_API_KEY?.trim()) throw Error("DEEPGRAM_API_KEY is missing"); }
  async *speak(text: string, signal: AbortSignal) {
    // Escaped IPA objects expand request length. Split BEFORE the documented
    // 2000-character Aura limit; preserve every part of a long order read-back.
    for (const part of splitSpeech(text, 160)) yield* this.speakPart(part, signal);
  }
  private async *speakPart(text: string, signal: AbortSignal) {
    const key = process.env.DEEPGRAM_API_KEY?.trim(); if (!key) throw Error("DEEPGRAM_API_KEY is missing");
    const url = new URL("https://api.deepgram.com/v1/speak");
    for (const [key, value] of Object.entries({ model: "aura-2-thalia-en", encoding: "linear16", sample_rate: "24000", container: "none", mip_opt_out: "true" })) url.searchParams.set(key, value);
    const response = await fetch(url, { method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]), headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: auraPronunciation(text) }) });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw Error(`Aura synthesis HTTP ${response.status}`); }
    let pending = Buffer.alloc(0);
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      signal.throwIfAborted(); const bytes = Buffer.concat([pending, Buffer.from(chunk)]); const end = bytes.length - bytes.length % 2;
      if (end) yield bytes.subarray(0, end); pending = bytes.subarray(end);
    }
    if (pending.length) throw Error("Incomplete PCM sample from Aura");
  }
  close() {}
}
export function makeTts(name: string, transport = process.env.VOICE_AURA_TRANSPORT?.trim() || "http"): Tts {
  if (name === "kokoro") return new KokoroTts();
  if (name === "aura-2") {
    if(transport==="http")return new AuraTts();
    if(transport==="ws")return new AuraWsTts();
    throw Error("VOICE_AURA_TRANSPORT must be http or ws");
  }
  throw Error("VOICE_TTS_PROVIDER must be kokoro or aura-2");
}
