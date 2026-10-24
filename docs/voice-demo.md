# Streaming voice demo

Only `DEEPGRAM_API_KEY` is required for localhost. Put it privately in ignored `.env.local`, run `npm run dev:voice`, and open http://127.0.0.1:3000/voice in Chrome/Edge. If static assets are missing, run `npm run voice:prerender` once with signup credits. No Vapi, Twilio, Groq, Gemini or Anthropic call is made by the default voice path. Local `.env.example` contains names and empty placeholders only.

The pipeline is browser mic/AudioWorklet → same-origin WebSocket → Deepgram → local order engine → Aura-2 → PCM playback. Calls last at most ten minutes, one concurrent session. Audio is transient. Barge-in stops scheduled playback and aborts stale synthesis; every audio frame carries a generation ID. Use headphones when testing echo/false interruptions.

## Recognition and endpointing

Choose Flux English, Nova-3 multilingual, or Nova-3 Indian English. No default winner is selected. The same compact final-menu phrase keyterms use repeated plain query parameters and a conservative byte budget below the provider's 500-token cap. The engine supplies small, per-question valid-answer hints; Configure failures preserve the preceding terms without closing the stream. [Current-doc verification](stt-current-docs.md).

Provider finals are provisional until the adaptive local finalization wait settles. Complete phrases wait 750 ms with Flux, 1100 ms with Nova multi; unfinished/uncertain phrases wait 1600 ms. Nova en-IN retains 1600 ms for all phrase types because faster candidates cut off an observed continuation. These are provisional development settings from six paired pause cases per model. A complete prefix can still be followed by another item; no transcript-only predictor guarantees zero cut-offs. `VOICE_ENDPOINT_MODE=fixed` restores a fixed 1600 ms comparison. `VOICE_ADAPTIVE_COMPLETE_MS` overrides the complete wait for a controlled test; leave it unset normally. Provider profile defaults to baseline.

Engine speculation is removed. Interims/eager Flux events never run the engine or mutate a cart. Native Flux early events exist, but the small engine cost does not justify the cancelled-draft path. FAQ LLM remains off by default. All items, quantities, modifiers, prices, totals and final confirmation come from local code.

## TTS and static audio

Aura-2 is default, using persistent WSS and `aura-2-thalia-en`, 24 kHz PCM. Kokoro remains an explicit `VOICE_TTS_PROVIDER=kokoro` adapter, without automatic provider fallback. Kokoro-js 1.2.1's May 2025 release cadence does not justify calling it actively maintained; prior CPU first-byte timings were several seconds. Keep the earlier measured limitation visible in [the original voice report](../eval/results/voice-phase.md).

`npm run build` pre-renders/checks thirty fixed synthetic clips before Next builds: templates, Okay/Got it, modifiers and nine final-menu names. Reviewed assets/manifest are committed under public/voice-audio. Unchanged builds reuse them without API requests. Runtime verifies hashes and loads files; missing/stale assets fail visibly rather than synthesizing at startup. No caller text, names, notes or audio can create a static asset.

Leading cached fragments play while at most ONE dynamic tail is synthesized. Common names/modifiers can form cached leading fragments; punctuation is never sent as its own TTS job. If the reply starts with uncached text, a short cached Okay plays first (`VOICE_ACKNOWLEDGEMENT=false` disables it). Acknowledgement first byte, actual reply-content availability, and audible playback are different metrics. Okay is not order acceptance and does not replace read-back.

TTS interruption sends Clear and waits for Cleared before another utterance. A missing acknowledgement closes the connection rather than mixing generations. Pronunciation overrides remain in voice/pronunciation.mjs, separate from menu aliases. The [91-entry pronunciation sheet](pronunciation-sheet.md) covers all 84 names plus seven modifiers; human pronunciation review is still pending. [Aura controls](https://developers.deepgram.com/docs/tts-websocket), [pronunciation controls](https://developers.deepgram.com/docs/tts-voice-controls).

## Timing and privacy

Timing starts at estimated speech end, not final transcript receipt. Browser VAD uses 80 ms frames and provider word times as fallback; synthetic browser diagnostics separately use the known fixture's last non-silent sample. Stages are STT/uplink/finalization wait, engine, TTS first byte (including provider network), and estimated return transport/browser scheduling. Ping/pong reports clock uncertainty ±RTT/2. These measurements cannot isolate network from provider compute or renderer scheduling. Audio-byte arrival is not audible playback; output buffering/device latency and acknowledgement duration also matter.

No caller audio, transcripts or corrections are persisted by the server. `VOICE_PERSIST_LOGS=true` refuses startup. In-memory state clears on disconnect. The tab holds redacted transcript/cart/endpoint/timing rows and user-authored intended words; explicit CSV export is local to your browser. Save under ignored `.data` and delete within thirty days. Historical private logs from the previous version are not automatically erased. No MediaRecorder, localStorage or IndexedDB stores calls. Deepgram requests use `mip_opt_out=true`; [provider data policy](https://developers.deepgram.com/trust-security/your-data) describes processing/usage metadata, and opt-out billing is account-specific.

Use the [same 30-turn script](real-mic-script.md) and [90 blank rows](real-mic-results-template.csv) for the three variants. Rotate model order. Record actual clarification/recovery turns, not just the scripted expected path. Distinguish safe clarification from silent wrong additions and STT errors from dialogue failures. The user reported one real call, but no scored real-mic comparison has been completed by this agent; synthetic audio is not accent accuracy.

## Commands and hosting

`npm run test:live`, `npm run test:voice`, `npm run test:voice:browser`, `npm run typecheck`, `npm run check:privacy`, `npm run build` verify this phase. `npm run voice:adaptive` compares guards on the same six streams; `npm run voice:stt:30` broadcasts the same thirty synthetic utterances to all variants; `npm run voice:ack` isolates six paired TTS acknowledgements; `npm run voice:smoke -- --credits-confirmed --paired-ab` uses the same in-memory PCM for browser acknowledgement off/on. Provider diagnostics spend signup credits. Original held-out cases and grading rules are excluded.

The [private repo/Render setup](us-deployment.md) gives exact commands, environment names and health check. US-hosted latency remains unmeasured until a real deployment exists. Do not call a tunnel a US server. Separate Free Render idle wake, application cold startup, build time and warm-turn latency.

## Cost basis

The prior cost guide used the [public Deepgram rates](https://deepgram.com/pricing) checked 2026-10-24: Flux promotional $0.0065/min, Nova multi $0.0058/min, Nova English $0.0048/min and Aura-2 $0.030/1000 billable characters. These are estimates, not this account's invoice: retention opt-out may change rates. Count the full streamed duration including silence, and cancelled synthesis may still be billed. Static clips cost only when generated/changed, not per runtime boot; cache misses still use Aura. Signup credits cover testing while available. No paid hosting/LLM/carrier service has been provisioned.
