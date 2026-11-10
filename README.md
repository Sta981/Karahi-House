# Karahi House — Voice AI Ordering Assistant

A browser-based voice ordering demo for **Karahi House**, 1409 Polk Street, San Francisco. The project explores how a voice agent can understand food orders, handle menu questions, clarify ambiguous requests, and build a pickup ticket—while making order changes explicit and reviewable.

The system is designed to test speech recognition across different English configurations and small English/Hindi mixed-language orders. **Accent accuracy has not been independently established**: there is no scored multi-speaker accent dataset, and synthetic speech results are not evidence of real-world accent performance.

> **Demo status:** Orders are simulated and remain `DEMO` / `pending_acceptance`. The application is not connected to the restaurant's phone line, POS, payment system, delivery service, or staff workflow. Nothing is submitted to the restaurant.

## The problem

Voice ordering is more than speech-to-text. A useful ordering assistant must distinguish between a new item, a quantity correction, a removal, a menu question, and a request for clarification. A misheard dish or number can become a wrong order if recognized text is allowed to change the cart without checks.

This project addresses that problem with two separate responsibilities:

- **Speech layer:** transcribes the caller's speech and speaks the agent's response.
- **Order layer:** applies local menu knowledge, validates the requested action, asks for missing choices, and discloses cart changes.

The separation matters: a fluent voice response is not proof that the underlying order is correct.

## What the demo does

- Streams microphone audio from a browser to a local voice server.
- Supports Deepgram STT configurations: Flux English, Nova-3 multilingual, and Nova-3 Indian English.
- Uses **Aura-2 Thalia** for default speech generation, with Kokoro available as an explicit alternative.
- Answers menu questions from the local approved menu data.
- Handles item quantities, size and spice choices, notes, removals, and pickup names.
- Asks for clarification when a dish, protein, size, spice, or removal target is ambiguous.
- Uses shared intent permissions and a semantic cart diff so questions and complaints cannot silently mutate an order.
- Reads back the complete order and subtotal before creating a demo ticket.
- Shows the ticket in the browser and allows a redacted JSON download.
- Can optionally email a redacted demo ticket to one configured owner test inbox through Resend. The SMS preview is simulated and is **not sent**.

The current multilingual path uses a small explicit vocabulary for common ordering phrases. Romanized transcript display is a presentation feature; it does not translate speech or improve the underlying speech recognizer. Full Urdu/Punjabi conversation support is not implemented.

## How it works

```text
Browser microphone
       |
       v
AudioWorklet capture
       |
       v
WebSocket voice server
       |
       v
Deepgram speech-to-text
       |
       v
Local recognition + order engine
       |
       +--> Menu lookup and clarification
       |
       +--> Intent authorization + cart validation
       |
       v
Response generation
       |
       v
Aura-2 Thalia text-to-speech
       |
       v
Browser audio playback
       |
       v
Read-back confirmation -> DEMO ticket
```

### Order safety and checkout

The order engine uses local menu facts for item names, quantities, sizes, spice levels, prices, and subtotal calculations. It does not treat every recognized phrase as permission to edit the cart.

- Questions and complaints are read-only.
- A removal request cannot become an addition.
- Ambiguous removals ask how many items to remove.
- Cart changes are summarized from the before/after state.
- A changed cart requires a fresh read-back.
- In streaming voice, the agent asks **“Anything else?”** after the complete read-back. A no-more answer confirms that read-back; “yes” resumes ordering.
- The resulting ticket remains pending staff acceptance.

The legacy text flow has a separate confirmation mode and still asks “Is that correct?” before accepting a yes.

## Technology

| Area | Implementation |
|---|---|
| Application | Next.js 15, React 19, TypeScript |
| Speech-to-text | Deepgram Flux / Nova-3 |
| Text-to-speech | Deepgram Aura-2 Thalia |
| Voice transport | Browser AudioWorklet and WebSocket |
| Order processing | Local TypeScript recognition and order engine |
| Mixed-script display | Sanscript transliteration |
| Optional email | Resend |
| Testing | Node test runner, TypeScript/tsx, Playwright |

Vapi and Twilio are not used for the active voice pipeline. The FAQ LLM is disabled by default; adding API keys alone does not enable it.

## Run locally

### Requirements

- Node.js and npm
- Chrome or Edge with microphone access
- A Deepgram API key

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the public example file to a private local environment file:

**macOS / Linux**
```bash
cp env.example .env.local
```

**Windows PowerShell**
```powershell
Copy-Item env.example .env.local
```

Add your Deepgram key to `.env.local`:

```dotenv
DEEPGRAM_API_KEY=your_deepgram_api_key
```

Do not commit `.env.local`, expose server keys through `NEXT_PUBLIC_` variables, or paste credentials into issues or chat.

### 3. Check the environment and start the voice server

```bash
npm run check:env
npm run dev:voice
```

Open [http://127.0.0.1:3000/voice](http://127.0.0.1:3000/voice), allow microphone access, and use headphones.

**Use `npm run dev:voice` for the streaming voice demo.** The ordinary `npm run dev` command serves the text/legacy browser-speech experience; it does not start the same streaming WebSocket voice pipeline.

The voice server uses port 3000 by default and a dedicated `.next-dev-voice` cache. It does not silently select another port. To reset generated development caches, stop the server with Ctrl+C and run:

```bash
npm run clean
npm run dev:voice
```

## Menu data

The active menu source is `lib/menu-source.json`, imported from the restaurant-approved menu file. The repository documentation records 84 unique item IDs, 13 items with size choices, and 66 spice-enabled items. Prices are stored as integer cents.

`lib/menu.ts` is generated from the menu source; aliases are maintained separately. Older menus and third-party listings are not used as sources for new prices. The approved menu still flags six size surcharges as unverified, so the demo preserves that warning. Tax is not configured: displayed totals are subtotals, not tax-inclusive totals.

## Testing and evaluation

Run the portable checks from the project root:

```bash
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

For the local order-engine suite, run:

```bash
npm run test:engine
```

The repository also includes a five-minute scripted walkthrough, real-microphone test instructions, CSV analysis utilities, and regression tests. See the linked documentation below for the exact scope of each test.

### What the measurements do—and do not—show

The project records speech-end-to-informative-playback latency separately from neutral acknowledgements. Historical synthetic tests used fixed inputs with real speech providers; owner-recorded microphone sessions used different utterances and small sample sizes.

These measurements are useful for debugging endpointing, playback, and response delays. They are **not** a controlled comparison of accent recognition, a population-level accuracy score, or proof that the system handles every real order correctly. Some recorded sessions contain incomplete replies, missing timings, or regressions. The latest Roman-display and checkout changes still require fresh real-microphone retesting.

See [known limitations and recorded measurements](docs/known-limitations.md) before interpreting any benchmark.

## Privacy, safety, and deployment limits

- Server-side audio and transcript persistence is disabled.
- The ticket cache is held in server memory, is bounded, expires after thirty minutes, and is lost on restart.
- Tickets are redacted; callback numbers are not retained in the ticket payload.
- Optional Resend delivery is disabled unless explicitly enabled and configured. It targets one owner test inbox, not the restaurant.
- The SMS preview always reports `sent: false`; no carrier API is called.
- A provider accepting an email request does not prove inbox delivery.
- There is no durable ticket database, staff acceptance interface, delivery webhook, or POS integration.
- Public/tunnel access requires the configured access-token protections. The local server is not intended to be exposed publicly without them.

This is a development and demonstration system, not a production ordering service. Before production use it would need independently evaluated speech performance, real staff workflows, durable storage, secure deployment, operational monitoring, failure recovery, and explicit restaurant/POS integration.

## Project documentation

- [Five-minute demo script](docs/demo-script.md)
- [Known limitations and latency measurements](docs/known-limitations.md)
- [Action-safety design](docs/action-safety.md)
- [Mixed-language behavior and retest guide](docs/code-switching.md)
- [Ticket delivery, storage, and idempotency](docs/ticket-delivery.md)
- [Real-microphone test script](docs/real-mic-script.md)
- [GitHub publication workflow](docs/github-workflow.md)

## Roadmap

- Collect a consented, multi-speaker evaluation set covering relevant accents, dish names, numbers, and code-switching.
- Score speech transcription and final-cart correctness separately.
- Retest the current checkout and mixed-language changes on real microphones.
- Improve clarification and recovery for noisy, incomplete, or conflicting speech.
- Add durable ticket storage and a staff acceptance workflow.
- Evaluate a production deployment and restaurant integrations only after safety and reliability requirements are met.

## License and status

This repository is a development demo. Check the repository's current files and configuration before reusing it or deploying it in another environment.
