import { writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { KokoroTts } from "../voice/tts";
async function main() {
const tts = new KokoroTts(), start = performance.now();
const report: Record<string, any> = { kind: "synthetic-local-tts-no-recordings", location: "Lahore laptop CPU", node: process.version, cpu: os.cpus()[0]?.model, package: "kokoro-js@1.2.1", model: "onnx-community/Kokoro-82M-v1.0-ONNX", dtype: "q8", threads: 2, voice: "af_heart", samples: [] };
try {
  await tts.warm(); report.warmupMs = performance.now()-start;
  const texts = ["What would you like for pickup?", "One Chicken Biryani. What spice level would you like?", "Two Garlic Naan and one Mango Lassi.", "Your subtotal is $23.50. Shall I read that back?", "One full Chicken Lahori Karahi, mild spice."];
  for (const text of texts) {
    const begun = performance.now(); let firstMs: number | null = null, bytes = 0;
    for await (const chunk of tts.speak(text, new AbortController().signal)) { firstMs ??= performance.now()-begun; bytes += chunk.length; }
    const row = { text, firstByteMs: firstMs, completeMs: performance.now()-begun, audioSeconds: bytes/48000, bytes }; report.samples.push(row); console.log(JSON.stringify(row));
  }
  report.ok = true;
} catch (error) { report.ok = false; report.failure = error instanceof Error ? error.message : "Kokoro probe failed"; }
finally {
  tts.close(); mkdirSync("eval/results", { recursive: true });
  writeFileSync("eval/results/voice-kokoro.json", JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({ok:report.ok,warmupMs:report.warmupMs,failure:report.failure,recordingsStored:false}));
}
}
void main();
