# Four en-IN call reviews

Reviewed 29 October 2026. These four owner microphone exports all identify source `973f8b21ac1a624116acf8dafb0a724aa9d2c2b4`, **build_dirty=true**, Nova-3 `en-IN`, `baseline+adaptive800`, and Aura-2. The exact uncommitted code tested cannot be recovered, so they cannot establish a clean retest of `3b23332` or any other commit. Additional failures were reproduced in the current engine before fixing them. Original exports and development replay rows remain private; no microphone audio was stored.

## Recorded results from the old build

Speech end to first informative browser playback, nearest-rank quantiles:

| Export suffix | Logged rows | Informative arrivals | Finished replies | p50 / p95 seconds | Missing informative timing |
|---|---:|---:|---:|---:|---:|
| (5) | 9 | 7 | 6 | 1.605 / 14.926 | 2 |
| (6) | 17 | 13 | 11 | 2.664 / 7.677 | 4 |
| (7) | 13 | 10 | 7 | 1.761 / 5.357 | 3 |
| (8) | 7 | 6 | 3 | 1.792 / 6.928 | 1 |

There are 46 rows, 36 informative timestamps, and 27 finished replies. Partial/failed or superseded playback can have an informative timestamp; these percentiles do not imply successful completion. Ten rows flag interruptions: nine browser VAD and one manual. The CSV does not establish which VAD detections were false positives. Fifteen rows record a terminal synthesis timeout. No independent intended-order labels are available, so no accuracy percentage is reported.

The 14.926-second outlier contains 14.687 seconds in the combined STT/endpointing/uplink stage, 144 ms in the engine, and roughly 4 ms to cached content. Other slow/failing replies show remote speech bodies stalling against the existing six-second synthesis budget. Additional caching cannot eliminate a long recognition/network wait.

## Structural changes

- **Intent first:** denials of a request and statements reporting an earlier request stay read-only. A complaint naming a dish cannot append it. A polite explicit removal still reaches removal handling. An actual request beginning “could I order” retains its ordering meaning.
- **Question-bound consent:** recognition consent carries a fingerprint of the actual last emitted proposal, including quantity/modifiers. A retained candidate cannot consume yes after an unrelated menu or serving-size question. Voice endpoint answers and recognition hints follow this same scope.
- **Information is separate:** availability, protein-menu and serving questions cannot create latent order proposals. Protein browsing lists only matching current-menu items and local prices. An unavailable named dish is still explicitly unavailable. Serving counts are unspecified in the menu, so the reply says staff must verify and resumes the pending Half/Full question.
- **Accept plus subtotal:** finite acceptance plus a total question commits only the current proposed item, then calculates the subtotal locally. Bounded quantity-qualified consent works. A yes followed by a different new item cannot implicitly accept the old item.
- **Restatement and correction:** overlapping multi-item restatements ask add versus replace. Reporting an earlier request does not append another copy. A decline followed by an explicit canonical add can supersede the pending proposal without becoming a cooking note. Required size remains pending.
- **Recognition:** short Chicken Burger aliases and plurals refer only to Kids Chicken Burger; bare burger still requires consent. Recorded karahi-like family sounds immediately after a protein propose real matching karahis and require a style choice. They never select White or another style automatically. Unresolved food descriptions beside multiword items clarify while independent clear clauses remain in the cart.
- **Removal:** item-adjacent number homophones also work for existing-cart removals and quantity follow-ups. A preposition after the item is not a number. Conflicting explicit/repaired counts ask instead of deleting.
- **Speech:** unfinished add/include/order tails retain the unfinished wait. Five new synthetic clips cover subtotal, serving-size and browsing fragments, bringing the checked cache to 348 entries. These responses are verified without a dynamic provider request. Default STT waits, VAD thresholds, TTS provider/transport and whole-reply timeout are unchanged.

## Development validation and limits

Sixteen new engine pattern/property groups and three voice groups cover these changes. Seeded question/denial sequences verify unchanged carts and exact journal replay. The existing development case `speech-33` now expects a read-only availability answer with no item question and explicitly checks the unavailable reply. Its previous label expected an order proposal from an availability question. Case text and all held-out/grading rules are unchanged; the development module loader only adds the new runtime dependency.

Selected checks: 53 engine, 100 live/pattern, 77 voice, five publication, eight notification, one demo walkthrough and seven development-cache checks. Browser fixtures test transport/playback, not accent accuracy. The final production build validates the unchanged approved 84-item menu.

The relative timing guard failed once while a production build and browser fixture competed for CPU; the isolated live/pattern run passed all 100 checks with unchanged budgets (10/20/40-word medians 5.15/14.98/31.65 ms). Timing guards should run separately from build/browser jobs. These are offline diagnostics, not end-to-end microphone latency.

Offline replay of exported rows is diagnostic, not a reconstruction of every live turn: exports have gaps, continuation revisions and no reply text/intended final cart. Severely garbled removal targets remain clarification questions. Pending removal cannot become an addition. New microphone performance, cutoff rates and full Urdu/Punjabi recognition are unmeasured; no new STT winner or latency improvement is claimed.
