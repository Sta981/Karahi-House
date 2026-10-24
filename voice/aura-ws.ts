import WebSocket from "ws";
import { auraPronunciation, splitSpeech } from "./pronunciation.mjs";
import type { Tts } from "./contracts";
type Job = { chunks: Buffer[]; wake: () => void; done: boolean; cancelled: boolean; error?: Error; finish: () => void; finished: Promise<void> };

// Persistent TTS transport avoids repeated TLS setup when a reply is interrupted.
// Clear acknowledgement forms a barrier: no next utterance starts until old
// synthesis has been cleared. There is never an automatic provider fallback.
export class AuraWsTts implements Tts {
  name = "aura-2";
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private current?: Job;
  private queue: Promise<void> = Promise.resolve();
  constructor(private connect = () => {
    const key = process.env.DEEPGRAM_API_KEY?.trim(); if (!key) throw Error("DEEPGRAM_API_KEY is missing");
    const url = new URL("wss://api.deepgram.com/v1/speak");
    for (const [key, value] of Object.entries({ model: "aura-2-thalia-en", encoding: "linear16", sample_rate: "24000", mip_opt_out: "true" })) url.searchParams.set(key, value);
    return new WebSocket(url, { headers: { Authorization: `Token ${key}` }, handshakeTimeout: 15000 });
  }) {}
  warm(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.socket?.readyState === WebSocket.CONNECTING && this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try { socket = this.connect(); } catch { reject(Error("Aura connection configuration failed")); return; }
      this.socket = socket;
      socket.once("open", resolve);
      socket.on("error", () => { if(this.socket===socket)this.fail("Aura connection failed"); reject(Error("Aura connection failed")); });
      socket.on("unexpected-response", (_req,res) => { res.resume(); socket.terminate(); reject(Error(`Aura handshake HTTP ${res.statusCode}`)); });
      socket.on("close", () => {
        if(this.socket===socket){this.connecting = undefined; this.socket = undefined; this.fail("Aura connection closed");}
        reject(Error("Aura connection closed before ready"));
      });
      socket.on("message", (data, binary) => {
        if(this.socket!==socket)return;
        const job = this.current;
        if (binary) {
          if (!job || job.done || job.cancelled) return;
          const chunk = Buffer.from(data as Buffer);
          if (chunk.length % 2 || job.chunks.reduce((n,part)=>n+part.length,0) > 1024*1024) { this.fail("Aura PCM stream invalid or too slow"); return; }
          job.chunks.push(chunk); job.wake(); return;
        }
        let event: Record<string,unknown>; try { event = JSON.parse(data.toString()); } catch { this.fail("Aura invalid message"); return; }
        if (!job) return;
        if ((event.type === "Flushed" && !job.cancelled) || (event.type === "Cleared" && job.cancelled)) job.finish();
        if (event.type === "Error") this.fail(/limit|too many|429/i.test(`${event.code??""} ${event.description??""}`)?"Aura provider rate limit":"Aura provider error");
      });
    });
    return this.connecting;
  }
  private fail(message: string) {
    if (!this.current || this.current.done) return;
    this.current.error = Error(message); this.current.finish();
  }
  async *speak(text: string, signal: AbortSignal) {
    let unlock!: () => void;
    const previous = this.queue; this.queue = new Promise<void>(resolve => unlock = resolve);
    await previous;
    let job: Job | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (!job || job.done || job.cancelled) return;
      job.cancelled = true; job.chunks = []; job.wake();
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({type:"Clear"}));
      else job.finish();
    };
    try {
      signal.throwIfAborted(); await this.warm(); signal.throwIfAborted();
      let finished!: () => void; const done = new Promise<void>(resolve => finished = resolve);
      job = { chunks: [], wake: () => {}, done: false, cancelled: false, finished: done, finish() { this.done = true; this.wake(); finished(); } };
      this.current = job;
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { this.fail("Aura synthesis timeout"); this.socket?.terminate(); }, 20000);
      for (const part of splitSpeech(text, 120)) this.socket!.send(JSON.stringify({ type: "Speak", text: auraPronunciation(part) }));
      this.socket!.send(JSON.stringify({ type: "Flush" }));
      while (!job!.done || job!.chunks.length) {
        if (signal.aborted) { abort(); break; }
        if (job!.chunks.length) { yield job!.chunks.shift()!; continue; }
        await new Promise<void>(resolve => { job!.wake = resolve; });
      }
      if (job!.error) throw job!.error;
    } finally {
      if (job && !job.done) {
        abort();
        // A missing Clear acknowledgement must not leak an old reply into the
        // next one. Close the socket and reconnect instead of crossing epochs.
        let clearTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([job.finished, new Promise<void>(resolve => { clearTimer = setTimeout(() => { this.socket?.terminate(); job!.finish(); resolve(); }, 3000); })]);
        if (clearTimer) clearTimeout(clearTimer);
      }
      if (timer) clearTimeout(timer); signal.removeEventListener("abort",abort);
      if (this.current === job) this.current = undefined; unlock();
    }
  }
  close() { this.fail("Aura closed"); this.socket?.close(); this.socket?.terminate(); this.socket = undefined; this.connecting = undefined; }
}
