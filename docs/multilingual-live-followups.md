# Mixed-language call follow-ups

Analysis: 28 October 2026, Lahore. Both owner exports identify clean source `bef172127b5ad4ca75c19518f8266783e397be76`, Nova-3 multilingual, English/Hindi hints, `baseline+adaptive1100`, Aura-2. Caller CSVs and replay output remain private. No audio was recorded for this work.

## Observed results before fixes

Speech end to first informative browser playback; nearest-rank quantiles:

| Export | Logged rows | Informative arrivals | Finished replies | p50 / p95 | Missing informative timing |
|---|---:|---:|---:|---:|---:|
| First | 11 | 9 | 9 | 3.384 / 56.681 s | 2 |
| Second | 7 | 2 | 1 | 3.299 / 4.802 s | 5 |

Rows are exported engine turns, not a complete accounting of every spoken fragment. The second export's percentiles cover only two replies and do not establish faster performance. Both p95 values equal the maximum. First export: one manual playback cut. Second: four manual cuts and two browser-VAD cuts. Intended orders are not independently labeled; no dish/accent/joint accuracy is claimed.

Engine p50/p95: first 5.1/35.0 ms, second 27.7/92.4 ms. The worst informative wait included 53.624 seconds of TTS content waiting, not a slow matcher. Tiny provider chunks reset inactivity protection. A short offer waited 23.003 seconds for content with twelve stall prompts; another turn logged twenty-seven stalls. These are failures of the interaction.

## Fixes

- Repeated quantity-plus-food starts delimit spoken list entries. An uncertain family no longer suppresses an independent bread; each committed line is disclosed. An unresolved compound still cannot extract a one-word side.
- More explicit native dish words, ordering fillers and finite menu-question frames are understood locally. Reversed `daal chana` names the existing Chana Dal. Unknown native words remain explicit unresolved placeholders: their clause adds nothing; separately delimited clear items may resolve. Approximate display transliteration never supplies item identities.
- Reordered/noisy karahi evidence stays within real Karahi candidates and asks confirmation rather than offering Korma.
- New uncertain requests queue behind older questions. Empty-cart discourse repairs may restart an unresolved request. Multi-item corrections with an existing cart ask **add or replace** before any mutation; yes chooses neither.
- English counts above twelve and tens-plus-unit forms retain their value. Above fifty clarifies. Pack-versus-piece requests ask for menu-order count instead of selecting the inner number.
- A finite done-plus-pickup-time request answers approximate pickup time and resumes checkout. Required choices and unresolved requests still block submission.
- The static catalog now has **324** synthetic clips, including missing recovery/offer fragments. Common affected questions require zero dynamic synthesis in tests.
- A **six-second whole-reply synthesis budget** cancels trickling work, beyond provider inactivity/retry protection. Exhaustion plays the cached failure notice; microphone/order remain available. This can reject slow healthy synthesis. It is not an end-to-end latency guarantee and excludes STT endpointing and already scheduled playback. A neutral failure notice cannot masquerade as completed goodbye audio.

## Validation limits

Thirteen development pattern groups and three audio regression tests cover these changes, with synthetic wording rather than publishing private utterances. Held-out cases and grading rules are unchanged. One static build provider request failed; saved synthetic progress was reused and the missing clip succeeded on retry. No new real-mic benchmark is claimed. Garbled words still need clarification, full Urdu/Punjabi STT remains unsupported, and real interruptions can truncate playback. LLM, endpoint waits and barge-in thresholds are unchanged.
