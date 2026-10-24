// Stateful box-filter downsampling into 80 ms / 16 kHz / mono PCM16 frames.
// No MediaRecorder, file writes, uploads of past conversations, or audio logging.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.sum = 0; this.count = 0; this.phase = 0; this.ratio = sampleRate / 16000;
    this.frame = new Int16Array(1280); this.offset = 0; this.samples = 0;
    this.active = false; this.loud = 0; this.quiet = 0; this.lastLoud = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0]; if (!input) return true;
    for (const sample of input) {
      this.sum += sample; this.count++; this.phase++;
      if (this.phase < this.ratio) continue;
      const value = this.sum / this.count; this.phase -= this.ratio; this.sum = 0; this.count = 0;
      this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767); this.samples++;
      if (this.offset !== this.frame.length) continue;
      let energy = 0; for (const v of this.frame) energy += (v / 32768) ** 2;
      const loud = Math.sqrt(energy / this.frame.length) > .018;
      if (loud) {
        this.loud++; this.quiet = 0; this.lastLoud = this.samples;
        if (!this.active && this.loud >= 2) { this.active = true; this.port.postMessage({ type: "speech_start", audioSeconds: this.samples / 16000 }); }
      } else {
        this.loud = 0; this.quiet++;
        if (this.active && this.quiet >= 3) { this.active = false; this.port.postMessage({ type: "speech_end", audioSeconds: this.lastLoud / 16000, hangoverMs: (this.samples - this.lastLoud) / 16 }); }
      }
      this.port.postMessage({ type: "pcm", pcm: this.frame.buffer, audioSeconds: this.samples / 16000 }, [this.frame.buffer]);
      this.frame = new Int16Array(1280); this.offset = 0;
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
