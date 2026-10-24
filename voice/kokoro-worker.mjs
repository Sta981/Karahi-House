// A separate process prevents CPU inference from blocking mic transport/barge-in.
// Audio exists in memory only. Model files are cached under ignored .data/models.
import { KokoroTTS } from "kokoro-js";
import { env, StyleTextToSpeech2Model, AutoTokenizer } from "@huggingface/transformers";
import { phonemize } from "phonemizer";
import { pronunciationParts } from "./pronunciation.mjs";
env.cacheDir = process.env.KOKORO_CACHE_DIR || ".data/models";
let model;
const voice = "af_heart";
async function synthesize(text) {
  if (!pronunciationParts(text).some(part => part.ipa)) return model.generate(text, { voice });
  // Normalize only currency in template output before eSpeak. Every numerical
  // value remains identical. Preserve punctuation and never drop read-back text.
  const spoken = text.replace(/\$(\d+)(?:\.(\d{2}))?/g, (_m, dollars, cents) => `${dollars} dollars${Number(cents) ? ` and ${Number(cents)} cents` : ""}`);
  const parts = pronunciationParts(spoken);
  let phones = "";
  for (const part of parts) {
    if (part.ipa) phones += part.ipa;
    else if (/^[\s.,!?;:()\-]+$/.test(part.text)) phones += part.text;
    else phones += (await phonemize(part.text, "en-us")).join(" ").replace(/ʲ/g, "j").replace(/r/g, "ɹ").replace(/x/g, "k").replace(/ɬ/g, "l");
  }
  const { input_ids } = model.tokenizer(phones.trim());
  if (input_ids.data.length > 510) throw Error("phoneme_chunk_too_long");
  return model.generate_from_ids(input_ids, { voice });
}
try {
  // KokoroTTS.from_pretrained discards session_options. Use its public constructor
  // so the ONNX thread limit actually applies on a two-core laptop.
  const id = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const [weights, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(id, { dtype: "q8", device: "cpu", session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } }),
    AutoTokenizer.from_pretrained(id),
  ]);
  model = new KokoroTTS(weights, tokenizer);
  // Warm once, outside measured conversational turns.
  await synthesize("Hello.");
  process.send?.({ type: "ready" });
} catch { process.send?.({ type: "failure", code: "kokoro_load_failed" }); process.exit(1); }
process.on("message", async message => {
  if (message.type !== "speak") return;
  try {
    const audio = await synthesize(message.text);
    const pcm = new Int16Array(audio.audio.length);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, audio.audio[i])) * 32767);
    process.send?.({ type: "audio", id: message.id, pcm: Buffer.from(pcm.buffer) });
  } catch { process.send?.({ type: "failure", id: message.id, code: "kokoro_synthesis_failed" }); }
});
