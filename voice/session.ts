import { performance } from "node:perf_hooks";
import { runSmartTurn } from "../lib/brain";
import { GREETING, newState } from "../lib/dialog";
import { getItem,MODIFIERS } from "../lib/menu";
import type { Emit, Tts } from "./contracts";

export class VoiceSession {
  private state = newState();
  private generation = 0;
  private abort?: AbortController;
  private closed = false;
  constructor(private tts: Tts, private emit: Emit, private faqEnabled = false) {}
  recognitionHints():string[]{
    if(this.state.pendingCorrection)return ["no",...this.state.cart.map(line=>getItem(line.itemId)!.name)];
    if(this.state.recognition)return ["yes","no",...this.state.recognition.issues[0].candidates.map(candidate=>getItem(candidate.itemId)!.name)];
    if(this.state.pending)return ["Half","Full"];
    if(this.state.phase==="ask_spice")return MODIFIERS.spice_level.options;
    if(this.state.phase==="confirm")return ["yes","no"];
    return [];
  }
  interrupt() {
    this.abort?.abort(); this.abort = undefined;
    this.generation++;
    this.emit({ type: "interrupt", generation: this.generation });
  }
  async greet() { await this.reply(GREETING, 0, performance.now()); }
  async turn(text: string, audioEndSeconds: number | null = null, endpointReason = "manual_final") {
    if (this.closed || !text.trim() || text.length > 1000) return;
    this.interrupt();
    const generation = this.generation, finalAt = performance.now();
    this.emit({ type: "transcript", text, generation, audioEndSeconds, finalAt, endpointReason });
    const start = performance.now();
    // No provider is touched by default, even when Groq credentials exist.
    // Existing brain guards limit the optional FAQ path; it cannot mutate orders.
    const result = await runSmartTurn(this.state, text, [], { provider: this.faqEnabled ? undefined : null, onRouting: () => {} });
    if (this.closed || generation !== this.generation) return;
    this.state = result.state;
    const engineMs = performance.now() - start;
    this.emit({ type: "reply", text: result.reply, cart: this.state.cart, generation, usedLLM: result.usedLLM, engineMs, finalAt, endpointReason, speculativeHit:false, preparationMs:0 });
    await this.reply(result.reply, engineMs, finalAt, generation);
  }
  private async reply(text: string, engineMs: number, finalAt: number, generation = this.generation) {
    if (this.closed) return;
    const abort = new AbortController(); this.abort = abort;
    const requestedAt = performance.now(); let first = true,contentFirst=true,sentBytes=0;
    const audioPlan = this.tts.plan?.(text);
    this.emit({ type: "usage", ttsCharacters: audioPlan?.dynamicCharacters ?? text.length, generation, provider: this.tts.name });
    try {
      for await (const chunk of this.tts.speak(text, abort.signal)) {
        if (abort.signal.aborted || generation !== this.generation || this.closed) break;
        if (!chunk.length) continue;
        const firstAt = performance.now();
        if (first) {
          this.emit({ type: "audio_start", generation, sampleRate: 24000, finalAt, firstAt, engineMs, ttsFirstByteMs: firstAt - requestedAt, firstByteCached: audioPlan?.firstByteCached ?? false,acknowledgement:!!audioPlan?.acknowledgementBytes });
          first = false;
        }
        if(contentFirst&&sentBytes>=(audioPlan?.acknowledgementBytes??0)){contentFirst=false;this.emit({type:"content_start",generation,at:performance.now(),finalAt,contentFirstByteMs:performance.now()-requestedAt});}
        // A generation header on EVERY frame prevents audio from a cancelled reply resurfacing.
        const framed = Buffer.allocUnsafe(chunk.length + 4); framed.writeUInt32LE(generation, 0); chunk.copy(framed, 4);
        this.emit(framed);
        sentBytes+=chunk.length;
      }
      if (!abort.signal.aborted && generation === this.generation) this.emit({ type: "audio_end", generation });
    } catch(error) {
      const reason=error instanceof Error&&/rate limit|timeout|connection|PCM/i.test(error.message)?/rate limit/i.test(error.message)?"rate_limit":/timeout/i.test(error.message)?"timeout":/PCM/i.test(error.message)?"invalid_pcm":"connection":"synthesis";
      if (!abort.signal.aborted && !this.closed) this.emit({ type: "error", code: "tts_failed",reason, message: "Speech output failed. Your order is still visible; reconnect or choose another TTS provider." });
    }
  }
  close() { this.closed = true; this.abort?.abort(); this.state = newState(); }
}
