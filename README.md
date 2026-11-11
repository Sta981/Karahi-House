# Karahi House: Accent-Aware Voice AI Ordering Assistant

A voice AI ordering prototype built around a real-world restaurant use case: **Karahi House in San Francisco, California**. The goal is to make voice-based food ordering more reliable when callers speak with South Asian accents, use regional dish names, or mix English with familiar Urdu/Hindi ordering phrases.

**Restaurant:** [Karahi House — Official Website](https://www.karahihousesf.com/)  
**Online menu & ordering:** [Karahi House on HeyEats](https://app.heyeats.shop/store/karahi-house/shop)  
**Location:** [1409 Polk Street, San Francisco — Google Maps](https://maps.app.goo.gl/LoJvtozd1FcDDPpR8?g_st=ac)

> **The real-world problem:** A restaurant may have a menu full of culturally specific dish names—Chicken Karahi, Shinwari Karahi, Seekh Kebab, qeema, naan and more—while general-purpose speech recognition is often optimized for much more common English speech. A caller saying “chicken karahi” or “seekh kebab” can be transcribed incorrectly, especially when pronunciation, accent, background noise, or code-switching is involved. If the system misunderstands the dish or quantity, the order can be wrong before a staff member ever sees it.

I built this project to address that gap for the Karahi House ordering context: **recognize the spoken request as accurately as the available speech provider allows, ground decisions in the restaurant's menu, clarify uncertainty, and prevent an uncertain transcript from silently changing the order.**

This is a working development prototype, not a claim of a completed restaurant deployment. The current demo creates simulated pickup tickets; it is not connected to the restaurant's live phone line, POS, payment system, or staff workflow.

## Why this problem matters

Voice ordering is not just converting audio into text. A useful restaurant voice agent must understand:

- Dish names that may be unfamiliar to general-purpose speech recognizers.
- Different pronunciations of the same food item.
- Quantities and portion sizes such as Half and Full.
- Spice preferences and item-specific modifications.
- Short mixed-language phrases such as “do naan”, “aik karahi”, or “adha”.
- The difference between ordering an item, asking about it, correcting it, or removing it.

For example, a recognition error that changes “seekh kebab” into an unrelated phrase is not a cosmetic transcription issue. It can cause the wrong menu item to be selected. Similarly, interpreting “remove one” as “remove all” can corrupt the cart.

The system therefore treats speech recognition and order correctness as separate problems. It combines provider-level speech recognition with menu-grounded local processing, clarification, action permissions, and a final order read-back.

## How the system addresses accent and ordering errors

### 1. Speech recognition configurations for real caller variation

The browser voice demo supports three Deepgram speech-to-text configurations:

- **Flux English**
- **Nova-3 multilingual** with English and Hindi language hints
- **Nova-3 Indian English**

This makes it possible to test different recognition configurations against the same restaurant-ordering workflow. Nova-3 multilingual is the initial selection for mixed-language testing; it is **not** declared the most accurate model.

The browser captures microphone audio through an AudioWorklet and streams it to the local voice server over WebSocket. The voice pipeline supports adaptive endpointing, interruption handling, and streamed speech playback.

### 2. Menu-grounded recognition and mixed-language normalization

The order engine works against the restaurant's local approved menu data rather than allowing a language model to invent dishes or prices.

A small explicit vocabulary handles common ordering fillers, number words, Half/Full answers, spice phrases, completion phrases, and removal requests in supported Roman and native-script forms. This helps normalize familiar phrases such as:

| Caller phrase | Intended local interpretation |
|---|---|
| “do garlic naan” | Add two Garlic Naan |
| “aik mango lassi” | Add one Mango Lassi |
| “adha” | Half, when answering a pending size question |
| “kam mirch” | Mild Spice, when answering a pending spice question |
| “naan hata do” | Ask how many to remove if the quantity is ambiguous |

The multilingual transcript can be displayed in approximate Roman letters for readability. This is a presentation-only transliteration: it does not translate speech, improve the speech recognizer, or feed transliterated text into menu matching. Full Urdu/Punjabi conversation recognition is not currently supported.

### 3. Safe, menu-grounded order engine

The local TypeScript order engine handles menu lookup, item quantities, size and spice choices, notes, removals, pickup names, subtotal calculation, and checkout.

It also enforces action boundaries:

- A menu question or complaint cannot silently add an item.
- A removal request cannot turn into an addition.
- Ambiguous removals ask whether to remove one, both, or all relevant items.
- A changed cart is disclosed using the before-and-after order state.
- A correction invalidates the previous read-back.
- The complete order and subtotal are read back before the demo ticket is created.

The optional FAQ LLM is disabled by default. Order items, menu prices, and subtotal calculations come from local application logic, not generated model output.

## End-to-end architecture

```text
Caller
  |
  v
Browser microphone
  |
  v
AudioWorklet capture
  |
  v
WebSocket voice server
  |
  v
Deepgram STT
(Flux / Nova-3 multilingual / Nova-3 en-IN)
  |
  v
Local recognition and normalization
  |
  v
Menu-grounded order engine
  |
  +--> Item / quantity / size / spice handling
  |
  +--> Intent permissions and cart validation
  |
  +--> Clarification when speech or intent is ambiguous
  |
  v
Order read-back and caller confirmation
  |
  v
DEMO pickup ticket
  |
  +--> Browser ticket and JSON download
  |
  +--> Optional owner test-inbox email (Resend)
  |
  v
Aura-2 Thalia text-to-speech
  |
  v
Caller hears the response
```

The active streaming voice path uses Deepgram for speech-to-text and Aura-2 Thalia for speech generation. Vapi and Twilio are not used in the current voice pipeline.

## Restaurant menu and business context

The active menu source is `lib/menu-source.json`, based on the restaurant-approved menu data. The repository's menu documentation records:

- 84 unique menu item IDs.
- 13 items with size choices.
- 66 spice-enabled items.
- Five supported spice options.
- Prices stored as integer cents.

The engine uses this local data for item names, options, and price calculations. The menu source still flags six size surcharges as unverified. Tax is not configured, so the displayed amount is a subtotal rather than a tax-inclusive total. Allergies and other staff-review requests require human review.

## Demo checkout and ticket behavior

In the streaming voice flow, the caller can indicate that ordering is complete. The agent resolves missing choices and the pickup name, reads back the full order and subtotal, and asks **“Anything else?”** A no-more response confirms that read-back; “yes” returns to ordering. If the cart changes, the agent must read it back again.

A completed demo request produces a ticket marked:

- `label: DEMO`
- `status: pending_acceptance`
- `staffAccepted: false`

The browser displays the ticket and offers a redacted JSON download. Optional email notification can be enabled for one configured owner test inbox using Resend. The SMS preview is simulated and is **not sent**.

**No order is sent to Karahi House.** There is no live staff acceptance workflow, durable ticket database, restaurant email routing, POS connection, payment processing, or delivery integration in this version.

## Running locally

### Requirements

- Node.js and npm
- Chrome or Edge
- Microphone access
- A Deepgram API key

### Install

```bash
npm install
```

### Configure environment

Copy `env.example` to a private `.env.local` file.

**macOS / Linux**
```bash
cp env.example .env.local
```

**Windows PowerShell**
```powershell
Copy-Item env.example .env.local
```

Add your Deepgram key locally:

```dotenv
DEEPGRAM_API_KEY=your_deepgram_api_key
```

Never commit `.env.local` or expose server credentials through `NEXT_PUBLIC_` variables.

### Start the voice demo

```bash
npm run check:env
npm run dev:voice
```

Open [http://127.0.0.1:3000/voice](http://127.0.0.1:3000/voice), allow microphone access, and use headphones.

For the streaming WebSocket voice experience, use `npm run dev:voice`. The ordinary `npm run dev` command serves the text/legacy browser-speech experience and does not start the same streaming voice pipeline.

The voice server uses port 3000 by default and a dedicated `.next-dev-voice` cache. To reset generated development caches, stop the server with Ctrl+C and run:

```bash
npm run clean
npm run dev:voice
```

## Testing and evaluation

The repository includes order-engine tests, voice pipeline tests, browser checks, scripted demo checks, privacy checks, and regression tests.

Run the main checks:

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

Run the local order-engine suite:

```bash
npm run test:engine
```

### Honest evaluation of accent robustness

The project records latency from speech end to informative playback and includes both synthetic-provider tests and owner-recorded microphone sessions. These are useful for debugging response time, endpointing, and playback behavior.

However, **the current measurements do not prove a particular accent-recognition accuracy**. There is no independently scored, multi-speaker dataset covering Pakistani, Indian, Nepali, or Afghan accents, and the recorded real-microphone samples are small and not a controlled model comparison. Synthetic speech cannot substitute for human accent evaluation.

The next meaningful evaluation step is a consented test set of real speakers reading natural restaurant orders, with separate scoring for:
1. Speech transcription correctness.
2. Correct menu-item and quantity extraction.
3. Final-cart correctness after clarification and confirmation.

See [known limitations and recorded measurements](docs/known-limitations.md) for the current evidence and failed/regressed trials.

## Privacy and deployment limitations

- Server-side audio and transcript persistence is disabled.
- The server ticket cache is in memory, bounded, and expires after thirty minutes or server restart.
- Tickets are redacted; callback numbers are not retained in the ticket payload.
- Optional Resend email is disabled unless explicitly enabled and configured for one owner test inbox.
- The SMS preview always has `sent: false`; no carrier API is called.
- Provider acceptance of an email request does not prove inbox delivery.
- Public/tunnel access requires the configured access-token protections.
- The current app is a local development demo, not a production phone service.

## Project documentation

- [Five-minute demo script](docs/demo-script.md)
- [Known limitations and measured results](docs/known-limitations.md)
- [Action-safety design](docs/action-safety.md)
- [Mixed-language behavior and retest guide](docs/code-switching.md)
- [Ticket delivery, storage, and idempotency](docs/ticket-delivery.md)
- [Real-microphone test script](docs/real-mic-script.md)
- [GitHub publication workflow](docs/github-workflow.md)

## Roadmap

- Build a consented multi-speaker accent evaluation set using real restaurant-ordering phrases.
- Measure word error rate, dish/quantity extraction accuracy, and final-cart correctness separately.
- Improve recognition and clarification for unfamiliar dish names, code-switching, and noisy audio.
- Retest current mixed-language and checkout behavior with real microphones.
- Add durable ticket storage and a staff-facing acceptance workflow.
- Evaluate secure hosting and real restaurant integrations only after reliability and operational requirements are met.

## Project status

This project demonstrates an engineering approach to a real restaurant voice-ordering challenge: combine speech recognition with menu knowledge and safe transaction logic instead of trusting raw transcripts. It is currently a development prototype and has not been deployed as Karahi House's live ordering system.
