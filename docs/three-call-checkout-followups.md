# Three-call checkout follow-ups

Reviewed 29 October 2026, Lahore. All three exports identify clean source `973f8b21ac1a624116acf8dafb0a724aa9d2c2b4`, Nova-3 multilingual, English/Hindi hints, `baseline+adaptive1100` and Aura-2. Original CSVs, transcripts and development replays stay private; no caller audio was stored or uploaded for this work.

## Recorded results, before this revision

Speech end to first informative browser playback, nearest-rank quantiles:

| Export suffix | Logged rows | Informative arrivals | Finished replies | p50 / p95 seconds | Missing informative timing |
|---|---:|---:|---:|---:|---:|
| (3) | 7 | 5 | 4 | 5.601 / 9.710 | 2 |
| (4) | 20 | 18 | 13 | 1.836 / 7.605 | 2 |
| (5) | 15 | 14 | 13 | 3.539 / 8.076 | 1 |

There are 42 exported rows, 37 informative arrivals and 30 finished replies. An arrival can belong to partial or subsequently failed audio; it does not prove the reply finished. The six interruption flags cover caller/browser controls as well as speech detection. These are different conversations, not a controlled before/after comparison. Intended orders were not independently labeled, so there is no defensible accuracy percentage.

Engine p50/p95 milliseconds: (3) 25.9/174.2; (4) 39.4/113.4, maximum 206.9; (5) 20.0/175.9. Several affected replies spent seconds waiting for dynamic speech, while ordinary cached order replies had content ready in a few milliseconds. The six-second synthesis budget is not a six-second end-to-end guarantee: endpointing, the network and queued playback add time.

## Root causes and fixes

- **Checkout intent:** a leading negative done answer entered correction parsing, then the special-instructions path could interpret it as a note. Intent permissions rolled that mutation back. Finite completion now owns the turn before either parser. Courtesies and an explicit decline of an outstanding change are handled without deleting items. Missing size/spice/name, current read-back and final no-more answer remain required.
- **Time versus price:** order-time questions were caught by generic cart explanations or price lookup. They now answer approximate pickup time from a local template and resume the pending question. Delivery questions explicitly retain pickup-only scope. An order-total question still computes the subtotal locally. Clean completion plus time questions work with or without “and”; a merged, garbled tail cannot become confirmation.
- **Category ordering:** the engine lacked a way to expand a category request. Explicit one-each requests now use only the current menu's category members. Missing each-count or a large category requires consent; a stale cart invalidates that consent. Generic yes cannot choose a category. Source modifiers still apply: Kids have no spice and Desi Chicken has no size.
- **Nuggets and polite actions:** short full-name aliases retrieve the existing eight-piece product; the single distinctive word asks confirmation. Negative availability questions stay read-only. A polite prefix followed by an explicit add/remove command no longer causes a permission rollback. An additional uncertain item stays queued behind an accepted proposal.
- **Removal:** scoped “from my cart/order” noise is removed from targets. A known absent item is named without changing another line; cart-relative partial matches and ties take priority over generic aliases. Greetings and retries keep a removal question instead of unrelated categories. Yes after “Anything else?” resumes ordering.
- **Suggestions and conflicts:** the unavailable branded energy drink offers the real Soda (Can), with consent, instead of arbitrary phonetic food neighbors. A request for a relative's meal asks a food preference without making dietary assumptions. Conflicting proteins in one dish clarify and retain the requested quantity.
- **Turn boundaries:** finite acknowledgements/completion cannot be merged with the next order. Pending recognition supplies finite answer hints. Unfinished removal/recipient/connective tails use the existing 1600 ms unfinished wait. Complete/uncertain/answer wait values are unchanged. This is deterministic transport coverage, not a new measured cutoff rate.
- **Speech cache:** common removal, category, time and recovery templates are pre-rendered. Locally computed USD amounts below $10,000 compose exact integer dollar/cents clips, outside notes. The LLM remains off and never supplies order facts.

## Validation and limits

Seventeen new development engine groups and four new audio/transport groups use synthetic pattern variants, including negation, invalid quantities, mixed category/extra-item requests and cancelled partial audio. Mixed bulk requests clarify before expansion so no additional request silently disappears. Existing engine, journal/disclosure, removal, voice, notification and publication checks remain relevant. Held-out cases and grading rules are untouched. Browser fixtures verify transport/playback behavior; they are not real STT accuracy or live latency measurements.

Build-only synthesis encountered HTTP 200 responses whose bodies stalled before completion. The same Aura-2 voice's existing WebSocket adapter was used explicitly to recover missing synthetic assets; the demo's default HTTP transport is unchanged. A cancellation path could previously return partial PCM as a successful iterator completion; it now rejects. The cancelled candidate was invalidated and regenerated, and only completed jobs enter the cache. Recovery was paced below the documented [Flush limit](https://developers.deepgram.com/docs/tts-ws-flush). This is an asset build diagnostic, not a model/provider speed comparison.

Severely garbled dish words and the long mixed-language merged final remain uncertain; their intended words cannot be reconstructed from the CSV. They must clarify rather than silently change or submit the order. The new code requires a fresh microphone retest. No live latency gain, model winner, full Urdu/Punjabi support or perfect-order claim is made.
