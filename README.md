# Karahi House voice-agent demo

A pickup-order and menu/FAQ demo for Karahi House, 1409 Polk Street, San Francisco. The final menu is **approved by the restaurant**. Orders are still simulated and pending staff acceptance; no real restaurant notification, payment, delivery or POS integration is enabled.

GitHub receives a filtered source snapshot: hidden files, private data, evaluation outputs and held-out material stay on the laptop. Copy the visible `env.example` to private `.env.local` for setup. See the [GitHub update workflow](docs/github-workflow.md) for safe incremental pushes and local Git exclusions. Render deployment is currently on hold. Historical evaluation links below describe the local development repository; those private artifacts are intentionally absent from GitHub.

## Menu source

`lib/menu-source.json` is the only active menu: the supplied `karahi_house_menu_final.json`, with its status updated to approved. **84 unique IDs, 13 sized items, 66 spice-enabled items, integer-cent prices for all 84.** No items, prices or IDs changed during approval. `lib/menu.ts` is generated; edit the source intentionally and run `npm run menu:import`, never edit generated items directly. Names/website names and the separate final-source `lib/menu-aliases.json` drive matching. Earlier menu archives are historical evaluation records only.

Spice is shared across an order with named-item overrides. Missing sizes are asked locally; whole-order spice waits until the caller finishes ordering. “Hot” needs clarification. Notes are optional, quantities default to one, allergies require staff review. Prices/totals/read-back come from local code. Non-menu business information remains in the existing source/preserved metadata; full weekly hours still need confirmation. Catering is inquiry-only.

## Run the streaming laptop demo

```sh
npm install
npm run check:env
npm run dev:voice
```

Open <http://127.0.0.1:3000/voice> in Chrome/Edge and allow the microphone. Local calls have no access-code field or password requirement. Only **DEEPGRAM_API_KEY** is required in private `.env.local`. Kokoro needs no API key. The visible `env.example` lists configuration names with empty values. See [microphone/reply reliability changes](docs/voice-reliability.md) for permission ordering, live input indicators and recoverable speech failures.

The pipeline is browser AudioWorklet → WebSocket → Deepgram Flux or Nova-3 → existing in-process order engine → Kokoro or Aura-2 → browser PCM playback. It does not use Vapi or Twilio. The microphone remains active during replies; speech interrupts playback and cancels stale synthesis. One concurrent call, ten-minute session cap, no recordings saved.

Aura-2 is the default TTS and uses the same Deepgram key/signup credits. It uses HTTP streaming for laptop reliability; WebSocket TTS requires an explicit `VOICE_AURA_TRANSPORT=ws` choice. Kokoro remains an explicit alternative behind the TTS interface. Thirty fixed templates, neutral acknowledgements, modifiers and nine final-menu names are pre-rendered at build time and loaded from checked static assets. Caller audio/details never enter that cache. Leading fragments play while at most one dynamic tail is synthesized; punctuation never becomes a standalone synthesis request. The FAQ LLM defaults off. Engine speculation has been removed.

Adaptive finalization waits provisionally use 750 ms for complete Flux phrases, 1100 ms for complete Nova-3 multilingual phrases and 1600 ms for complete en-IN phrases. Unfinished text waits 1600 ms; uncertain text waits 900 ms, with cancellation and journal rollback if speech continues within 2200 ms. Browser barge-in requires 320 ms of sustained speech and an energy threshold, with playback-reference echo rejection. CSV logs distinguish actual browser playback completion, interruptions and gaps. No model is selected before real-mic comparison. [Latest real-mic fixes, replay profile and measured limitations](docs/real-mic-followups.md) includes the remaining Aura failures. [Block A](docs/live-call-fixes.md) documents clause safety, constrained answers, removals and mid-flow prices.

See the [voice setup, current provider docs and cost guide](docs/voice-demo.md), [measured results](eval/results/voice-phase.md), and [91-entry pronunciation review sheet](docs/pronunciation-sheet.md). Human accent and pronunciation evaluation remains pending; synthetic smoke tests do not establish real-world recognition accuracy.

`npm run dev` serves the existing text/legacy browser-speech demo. The new streaming WebSocket requires `npm run dev:voice`. Legacy Twilio webhook code remains inactive in this phase.

## Validation and evaluation

```sh
npm run menu:check
npm run test:eval
npm run test:live
npm run test:voice
npm run test:voice:browser
npm run typecheck
npm run check:privacy
npm run build
```

This update passes **53 selected engine tests**, **23 live-call/bounds tests**, **36 voice tests**, and the Edge transport/CSV/recovery fixture. Held-out tests are deliberately excluded; no test cases were removed. Run timing budgets on an otherwise idle laptop. The fixture smoke is not live provider latency. `node scripts/voice-provider-browser.mjs` checks actual provider playback with a synthetic clip and retains failures. `npm run voice:smoke -- --credits-confirmed --paired-ab` uses identical in-memory synthetic PCM for acknowledgement off/on, and consumes signup credits. `--us --latency-ab` targets an actual `VOICE_US_BASE_URL`. [US deployment setup](docs/us-deployment.md) specifies future private hosting; deployment is on hold.

For your accent comparison, use the [same 30-turn script](docs/real-mic-script.md) and [90-row blank results sheet](docs/real-mic-results-template.csv), covering Flux, Nova multi and Nova en-IN. Keep completed sheets in private `.data`. On `/voice`, export before starting another session. Enter your intended words beside misheard transcripts and export a separate private mishearings CSV; aliases require manual review. Report one speaker / thirty turns per variant; synthetic results are never accent accuracy. [Current STT controls](docs/stt-current-docs.md) explain phrase keyterms, per-state updates and alternatives.

Development/regression commands: `npm run eval:parser` (80 local scenarios), `npm run eval:menu` (public menu/messy/simulated cases), `npm run eval:burned` (**burned_heldout_v1**, regression only), and `npm run eval:performance` (paired old/optimized local timings). Details: [parser fixes](eval/results/parser-fixes.md), [performance profile](eval/results/parser-performance.md), [menu migration audit](eval/results/menu-migration-eval.md), [test-count audit](eval/results/test-coverage-audit.md).

Original held-out cases and grading rules remain unchanged and were not run during this voice phase. The 45 burned cases are never held-out again. A future fresh hidden set follows the existing commit/freeze/one-run protocol. The [segmenter decision](eval/segmenter-decision.md) is unchanged: comparison **not needed: dev saturated**; local remains the default and Groq comparison calls remain zero.

## Safety and separation

The deterministic engine owns dish selection, clarification, corrections, operation replay, quantities, portions, spice, prices and final read-back. Ambiguous names, low score margins and unavailable substitutes cannot silently add a dish. “For” after a dish stays a preposition, not quantity four.

Optional FAQ help uses one provider-neutral JSON adapter (`lib/llm.ts`); its short response is locally validated and cannot mutate orders or supply prices/quantity claims. Provider context is a shortlist and a short cart summary, with customer fields redacted. Voice uses no LLM by default. Do not enable Groq until its retention setting has been verified.

`.env.local` and `/.data/` are gitignored. The voice server saves no caller audio, transcripts or mishearings, on the laptop or hosted instance; enabling server persistence refuses startup. In-memory call state clears on disconnect. Redacted logs and typed corrections stay in the tab until you export CSV. Save privately and delete within thirty days. Historical private logs from earlier testing are not silently deleted; `voice:export` can still fold those old files. Deepgram requests retention opt-out. Only fixed SYNTHETIC speech is shipped under public/voice-audio. Public reports contain aggregate scores and synthetic examples only.

The audio interfaces in `voice/contracts.ts` are independent of the engine; Vapi, LiveKit or Pipecat can replace the audio layer later. A persistent US backend and real volunteer microphone tests are still needed before making production latency/accuracy claims.
