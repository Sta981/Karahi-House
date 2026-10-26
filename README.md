# Karahi House voice-agent demo

A browser pickup-order demo for Karahi House, **1409 Polk Street, San Francisco**. The menu is approved by the restaurant. Orders remain **DEMO, simulated, pending staff acceptance**. No restaurant phone line, payment collection, delivery ordering, live transfer or POS is connected.

Start with the [five-minute client script](docs/demo-script.md), [known limitations/measured results](docs/known-limitations.md), and [ticket delivery/storage](docs/ticket-delivery.md). No measured multi-speaker accent accuracy or perfect real-world order accuracy is claimed.

## Run locally

```sh
npm install
```

For a fresh public clone, set local Git exclusions using the [publication workflow](docs/github-workflow.md) before adding credentials; hidden exclusion files are not shipped. Copy visible `env.example` to private `.env.local` and add values locally. Default streaming voice needs only `DEEPGRAM_API_KEY`.

```sh
npm run check:env
npm run dev:voice
```

Open <http://127.0.0.1:3000/voice> in Chrome/Edge and allow the microphone. Select Flux English, Nova-3 multilingual or Nova-3 Indian English; no accent-model winner is established. Use headphones. One session, ten-minute cap. `npm run dev` serves text/legacy browser speech; streaming WebSocket voice requires `dev:voice`.

For the voice demo, **`npm run dev:voice` is the only startup command**: one server, port **3000** by default, one cache **`.next-dev-voice`**. Startup prints `3000 -> <full commit hash>` with a dirty marker for uncommitted changes. It does not pick an alternate port. A second invocation exits without touching the running cache. To reset generated development caches, stop the server with **Ctrl+C**, run **`npm run clean`**, then start `npm run dev:voice` again. Cleanup removes only the project's top-level `.next-dev-*` directories and refuses while a managed development server is running. Production `.next`, credentials and private data remain in place.

Pipeline: browser mic/AudioWorklet → WebSocket → Deepgram → local order engine → **Aura-2 Thalia** → browser playback. Vapi/Twilio are unused. Kokoro is an explicit alternative; measured laptop CPU performance was too slow for the target. FAQ LLM defaults off; keys alone do not enable it. Keep server credentials out of chat/source and `NEXT_PUBLIC_` variables.

## After read-back confirmation

The engine collects required sizes/spice, reads back the order/subtotal, and requires explicit confirmation. It then creates a redacted ticket with `DEMO`, `pending_acceptance`, `staffAccepted: false`. The tab shows the ticket and offers a JSON download. The server keeps only a bounded RAM copy (up to 100 tickets, thirty minutes, lost on restart), not a disk database.

Optional private notification names:

```dotenv
DEMO_NOTIFICATIONS_ENABLED=
RESEND_API_KEY=
DEMO_NOTIFICATION_EMAIL=
```

Set the enable flag explicitly to true when ready. Email goes only to the single configured **owner test inbox**, using Resend's fixed test sender. Use your Resend signup inbox ([official restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). The **simulated SMS** preview has `sent: false`; no carrier API is called. Missing configuration/failures are visible. Provider acceptance does not mean inbox delivery or restaurant acceptance. Actual inbox arrival remains to be checked after setup; tests use mocks. Nothing is sent to the restaurant.

Callback numbers are redacted. Tickets contain no audio, transcript/history or `transcriptHint`. Email runs alongside final voice speech; final text confirmation waits for its bounded attempt. A staff-acceptance workflow is still needed. See [delivery behavior and idempotency/retention limits](docs/ticket-delivery.md).

## Menu and local order facts

`lib/menu-source.json`, supplied as `karahi_house_menu_final.json`, is the only active menu: **84 unique IDs, 13 sized items, 66 spice-enabled items, five spice options, integer cents for all 84 prices**. `lib/menu.ts` is generated; aliases are separate. Older menus/listings do not supply additions or prices. The approved file still flags six size surcharges unverified; tickets retain that warning.

Items, quantities, size, spice, notes, prices, subtotal and read-back come from local code. Whole-order spice waits until ordering finishes; per-dish overrides are supported. “Hot”, ambiguous names/proteins and close typos require clarification. Tax is not configured: the amount is a subtotal. Allergies need staff review. Weekly hours, inventory and actual prep time need confirmation; catering is inquiry-only.

All transports share intent permissions and a semantic cart diff. Questions/complaints cannot mutate; removals cannot add. Committed changes are disclosed after reply rewrites. Validation covers 720 seeded turns and development patterns, not universal recognition accuracy. See [action-safety design](docs/action-safety.md).

Removing a multi-quantity item without a count asks **one or both / one or all**; “yes” alone cannot delete the whole group. For Hindi/English mixed speech, select **Nova-3 multilingual (English/Hindi mix)**. A small local vocabulary handles common numbers, size/spice answers and removal phrases in Roman/native script. English-only STT cannot recover words it never transcribed; Urdu/Punjabi speech is not supported by the current provider configuration. See [scope and real-mic retest](docs/code-switching.md).

## Measured latency

Headline: speech end → first **informative playback**, excluding neutral acknowledgements. All rows below are **Lahore local**, not US-hosted. Synthetic speech does not establish human-accent performance.

| Recorded build / input | STT | Informative n / attempted | p50 / p95 |
|---|---|---:|---:|
| `784ab85`, synthetic script / real providers | Flux English | 30/30 | 1.242 / 4.921 s |
| `784ab85`, same script | Nova-3 multilingual | 30/30 | 1.453 / 7.343 s |
| `784ab85`, same script | Nova-3 en-IN | 30/30 | 1.008 / 1.763 s |
| Unknown earlier build, owner real mic, `adaptive1600` | Nova-3 en-IN | 20/23 logged turns | 4.354 / 8.250 s |
| `a3102c4`, owner real mic, `adaptive800` | Nova-3 en-IN / Aura-2 | 17/17 logged turns | 2.496 / 6.734 s |

The earlier real-mic worst informative delay was **17.344 s**, with 15/23 finished replies. The new seventeen-row `a3102c4` export has 15/17 finished, zero barge-in cuts and a 6.734 s worst informative delay; one row has a conflicting `no_audio` status despite an informative timestamp. These are different utterances/sample sizes, not a controlled before/after accuracy test. The synthetic run finished 30/30 per configuration, with slow dynamic replies remaining. Failed/regressed trials remain in [known limitations](docs/known-limitations.md). The new removal/language revision awaits its own real-mic retest.

The page and each turn/mishearing CSV row identify commit, dirty status, STT, endpoint settings and TTS. Defaults: complete Flux 750 ms, Nova multi 1100 ms, en-IN 800 ms; uncertain 900 ms, unfinished 1600 ms, finite answers 600 ms. Provider endpointing adds time. Barge-in uses 480 ms sustained speech plus energy/echo checks; Ignore interruptions is available. All 311 fixed synthetic clips are pre-rendered; dynamic misses still depend on the provider. Engine speculation is off.

## Checks excluding held-out evaluation

```sh
npm run menu:check
npm run test:live
npm run test:voice
npm run test:notifications
npm run test:demo-script
npm run test:next-cache
npm run test:github
npm run test:voice:browser
npm run typecheck
npm run check:privacy
npm run build
```

Current validation passes 182 selected checks: 53 engine, 54 live/pattern, 55 voice, 4 publication, 8 notification, 1 scripted walkthrough and 7 development-cache checks. Notification checks use mock transport. The full local development checkout also supports `npm run test:engine`; some baseline-integrity checks need local evaluation artifacts intentionally excluded from the public snapshot. Development tests are not held-out or accent accuracy. Held-out files/grading rules are excluded from this checklist. Burned cases remain regression-only. The Groq segmenter comparison was skipped; local parsing remains default.

Use the [thirty-turn real-mic script](docs/real-mic-script.md) and [blank sheet](docs/real-mic-results-template.csv) for all three STT configs. Export before resetting. Enter intended words for mishearings; aliases need manual review. `npm run voice:analyze -- 'path-to-export.csv' --require-commit FULL_COMMIT_HASH` excludes other/dirty builds. Explicit provider benchmarks consume credits; offline checks above do not.

## Privacy, hosting and publication

`.env.local` and `/.data/` are ignored. Server audio/transcript persistence is disabled; enabling it refuses startup. Call state clears on disconnect; the separate redacted ticket cache has the lifetime above. CSVs, downloads and emails persist separately; delete consented evaluation exports within thirty days. Deepgram requests model-improvement opt-out; the application does not control every provider's retention.

The server binds to **127.0.0.1**, with no local password. Public/tunnel access requires `VOICE_DEMO_ACCESS_TOKEN`; set `VOICE_REQUIRE_ACCESS_TOKEN` before a tunnel hiding forwarding metadata. Public binding without a valid token refuses startup. No public deployment or US latency measurement exists; Render remains on hold.

GitHub gets a filtered snapshot through `npm run github:push`: hidden files, secrets, private CSVs/replays, evaluation outputs and held-out material are excluded. See [publication workflow](docs/github-workflow.md). Production builds use `.next`; voice uses `.next-dev-voice`; browser fixtures and ordinary Next dev use their own `.next-dev-browser`/`.next-dev-web`. A build or fixture run therefore does not delete the voice demo's CSS/JavaScript. All root `.next*` paths and the generated `next-env.d.ts` are ignored; generated cache/type files do not belong in Git. Only one voice demo runs at a time. If `EADDRINUSE` appears, use the existing demo or stop that instance before restarting it. Audio interfaces can be replaced by Vapi, LiveKit or Pipecat later.
