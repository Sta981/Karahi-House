# Known limitations

This is a laptop pickup-order demo with menu questions and catering inquiries. Menu approval is not production approval of the voice system. Neither 95% dish recognition nor perfect real-world orders has been established.

## Recognition and action safety

- Real-mic sessions have shown dish/number mishearings and interruptions. Correct transcripts have also exposed engine failures: duplicates, stale candidates and unintended additions. Intent permissions, cart disclosure and regressions address those patterns; passing tests does not prove every spoken phrasing safe.
- No independently scored multi-speaker accent corpus has been completed. Owner-reported calls do not establish population accuracy, a model winner or a controlled accuracy improvement. Synthetic speech is not an accent test.
- Ambiguous names, proteins, truncated dishes and “hot” need clarification. Read-back and explicit confirmation remain mandatory. The private 23-turn development replay checks safety; intended final cart is still missing, so final-cart correctness is ungraded.
- Accented English and a small explicit Urdu/Hindi/Punjabi text vocabulary are in scope. The multilingual Nova option hints English/Hindi and is the initial selection for mixed-speech tests, not an accuracy winner. Native-script transcripts now display in approximate Roman letters through a local transliterator; CSV retains both raw redacted and Roman fields. This does not improve STT or enable arbitrary translation. Only the explicit safe vocabulary enters the engine; approximate generic transliteration cannot create orders. The current Nova language list does not include Urdu/Punjabi. Full conversations, Nepali, Pashto and Dari remain future work. See [language scope](code-switching.md).
- Streaming voice closes only after missing required choices/name, the current read-back and a finite no-more answer to “Anything else?”. “Yes” continues ordering. The legacy text demo retains its yes-to-correct confirmation. These new voice closing and Roman-display paths have offline/browser fixture coverage; real-mic behavior remains to be retested. A failed goodbye synthesis keeps the browser call active rather than falsely reporting completed playback.
- Safety disclosures/read-back can exceed fifteen words. STT may drop/merge speech before the engine sees it; continuation rollback cannot undo words already played.

## Latency by recorded build and configuration

All rows are **Lahore local**, speech end to first **informative browser playback**, p50/p95 seconds, excluding neutral acknowledgements. Quantiles use nearest rank. Timing estimates are not acoustic loopback. There are no US-hosted measurements; hosting is on hold. A tunnel is not a US server.

The synthetic builds used the same thirty public inputs per configuration with real Deepgram STT/Aura-2. “n” counts informative arrivals; a partially heard reply may have timing without finishing.

| Build | Input / STT | Informative n / attempted | Finished / attempted | p50 / p95 s |
|---|---|---:|---:|---:|
| `ad79292`, 32 clips | Synthetic / Flux English | 29/30 | 29/30 | 3.745 / 6.361 |
| `ad79292` | Synthetic / Nova-3 multilingual | 30/30 | 30/30 | 4.045 / 6.677 |
| `ad79292` | Synthetic / Nova-3 en-IN | 30/30 | 30/30 | 3.894 / 6.163 |
| `0b52d26`, atomic buffering trial | Synthetic / Flux English | 29/30 | 29/30 | 2.808 / 24.992 |
| `0b52d26` | Synthetic / Nova-3 multilingual | 29/30 | 28/30 | 3.366 / 18.206 |
| `0b52d26` | Synthetic / Nova-3 en-IN | 29/30 | 29/30 | 1.277 / 5.016 |
| `784ab85`, streaming/311 clips | Synthetic / Flux English | 30/30 | 30/30 | 1.242 / 4.921 |
| `784ab85` | Synthetic / Nova-3 multilingual | 30/30 | 30/30 | 1.453 / 7.343 |
| `784ab85` | Synthetic / Nova-3 en-IN | 30/30 | 30/30 | 1.008 / 1.763 |
| Unknown earlier build, `baseline+adaptive1600` | Owner real mic / Nova-3 en-IN | 20/23 logged turns | 15/23 | 4.354 / 8.250 |
| `86bb58f` source / `90486c1` published | Action-safety revision | No fresh controlled measurement | Not measured | Not measured |
| `a3102c4`, `baseline+adaptive800` | Owner real mic / Nova-3 en-IN / Aura-2 | 17/17 logged turns | 15/17 | 2.496 / 6.734 |
| `318a3d3`, `baseline+adaptive800` | Owner real mic / Nova-3 en-IN / Aura-2 | 11/11 logged turns | 9/11 | 2.900 / 3.713 |
| `bef1721`, first export, `baseline+adaptive1100` | Owner real mic / Nova-3 multi / Aura-2 | 9/11 logged rows | 9/11 | 3.384 / 56.681 |
| `bef1721`, second export, `baseline+adaptive1100` | Owner real mic / Nova-3 multi / Aura-2 | 2/7 logged rows | 1/7 | 3.299 / 4.802 |
| Current mixed-list/recovery revision | All three configs | No live measurement yet | Not measured | Not measured |

Real-mic worst informative latency was **17.344 s**; three rows have no informative measurement, four report barge-in cuts. Old first transport-byte median 1.879 s includes neutral audio and is not the informative headline. The pasted page was a transient nineteen-measurement snapshot; the complete CSV has twenty. These values cannot be attributed to a newer build without a retest recording its commit/configuration.

The separate `a3102c4` real-mic export contains seventeen clean-build rows. Informative byte p50/p95: 2.468/6.156 s; engine: 57.5/253.1 ms. Zero barge-in cuts were logged; fifteen replies finished, one was revised by continuation and one was still active/stopped at export. One `no_audio` status conflicts with its informative timing, so timing arrivals do not prove complete playback. With seventeen samples, nearest-rank p95 equals the maximum. A removal had one logged TTS stall prompt. No independently labeled accuracy or matched-input improvement follows from these counts.

The `318a3d3` export contains eleven clean-build rows, all English transcripts. Informative byte p50/p95: 2.283/3.625 s; engine: 9.1/83.2 ms; nine replies finished and zero barge-in cuts were logged. The final completion intents were not handled in that build. This export cannot verify the reported native-script display or establish Urdu/Punjabi recognition. With eleven samples, nearest-rank p95 equals the maximum. Its different utterances do not establish a controlled latency gain.

The atomic trial is a retained regression: waiting for body completion caused long tails. Streaming improved the synthetic run, but dynamic synthesis still stalled on Flux and multilingual Nova. One startup attempt timed out before upload (zero attempted turns); a warm retry produced the ninety-turn run. An earlier same-input trial had a premature release each on Flux and en-IN; zero in the later run does not prove zero cut-offs. Deliberate greeting interruptions are not a validated false-positive rate.

Earlier static-cache load was 353 ms and total dev startup 6.84 s. Startup, build time and warm-turn latency are different. These are not promises for another laptop or host. Supporting reports: [menu/playback](menu-playback-followups.md), [action safety](action-safety.md). Raw caller CSVs remain private.

## Voice and deployment

The two `bef1721` multilingual exports exposed native-word/list failures and a 56.681-second useful-audio wait. The second has five missing informative arrivals, four manual cuts and two browser-VAD cuts; its percentiles cover just two replies. Engine p50/p95 was 5.1/35.0 ms and 27.7/92.4 ms. Trickling TTS and complete-reply buffering caused the longest wait. A new six-second synthesis deadline plays a cached failure notice on exhaustion; it may reject slow otherwise healthy dynamic speech. It does not bound the whole speech-to-reply interval. See [diagnosis and tests](multilingual-live-followups.md). New real-mic timing is unmeasured.

- No restaurant phone line, carrier calling, live transfer or tested incoming US call is connected. Browser mic/WebSocket is the active path; Vapi/Twilio are unused. Legacy Twilio code is inactive; signup was blocked at phone verification.
- One voice session, ten-minute cap; laptop/internet/provider-credit availability is required. Rate limits, networking and output gaps remain possible. Speech-end estimates have VAD/clock uncertainty.
- Complete waits: Flux 750 ms, Nova multi 1100 ms, en-IN 800 ms; uncertain 900 ms, unfinished 1600 ms, finite answers 600 ms. Provider endpointing adds time. A transcript-ending heuristic cannot guarantee completion.
- Barge-in requires 480 ms sustained speech plus energy/echo checks. It can react late or misclassify echo/noise/short answers. Ignore-interruptions mode intentionally prevents barge-in.
- Aura-2 Thalia is default; no automatic fallback. Kokoro is explicit. On the measured i7-7600U CPU, kokoro-js 1.2.1 took **5.033–12.137 s to first byte for five synthetic prompts**, plus **7.249 s warmup**. That implementation is too slow for the target on this laptop; another machine/implementation is unmeasured.
- No new live latency claim is made for notifications. Email runs alongside voice; final call closure can wait for its attempt. Final text confirmation can wait up to the email timeout. External email timing is separate from audio timing.

## Menu and business rules

- `lib/menu-source.json`, supplied as `karahi_house_menu_final.json`, is the only active menu, copied by the project owner from the website and **approved by the restaurant**. It validates 84 items/unique IDs, 13 sized items, 66 spice items, five spice options and integer cents. Older menus/listings do not supply additions or prices.
- The approved file itself marks **six size surcharges unverified**. That warning is preserved, not resolved from another source. Some website descriptions are flagged AI-generated; they cannot guarantee ingredients or allergy safety.
- Full weekly hours were not captured. “Closes at 11:30 PM” and pickup “about thirty minutes” are capture-day text, not guaranteed hours/ETA. Urgency is a note, not faster service.
- Tax is not configured: amounts are subtotals, not final amounts due. No payment is collected. Inventory, substitutions, preparation times and operational acceptance rules are not integrated.
- Delivery/catering booking are out of scope; catering is inquiry-only. Allergies/human requests need staff review; no live callback/transfer is available. Redacted notifications alone cannot support a real callback.

## Handoff and retention

DEMO email and simulated SMS are wired but explicitly disabled by default. Mock tests do not establish inbox arrival. Resend credentials and the owner's test inbox are required; no real carrier SMS exists. Email-provider acceptance leaves the order `pending_acceptance`. Staff acceptance, POS/printer, durable ticket storage, retry queue and delivery webhooks remain future work. Restart may lose unfinished sending. See [delivery/storage](ticket-delivery.md).

The server saves no audio/transcript on disk. It holds transient call state and a bounded thirty-minute redacted ticket cache. Tab exports, downloads, Resend storage and inbox copies have separate retention; ending a call does not delete those copies. Delete consented evaluation exports within thirty days. Only aggregates and synthetic examples are published. Held-out files/grading rules are excluded from this work and these claims.
