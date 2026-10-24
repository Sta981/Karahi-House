# Real-mic follow-ups and engine replay

Measured 2026-10-25 on the Lahore Windows laptop (Core i7-7600U). No US deployment, held-out evaluation, Groq call or caller recording was made. Human test utterances stay private; this report uses turn numbers and aggregates. The original 45 burned cases and grading rules were not read or changed.

## Order fixes

- Item-adjacent to/too means two after request verbs; for means four unless used as a preposition. Bread-adjacent none/knot/nun/non repairs remain in speech normalization, never the global alias list.
- Normal collecting replies acknowledge additions and ask one question. Quantity repairs use the ordinary quantity read-back, without a redundant “I heard quantity” sentence. Rejections/ambiguities still disclose additions or say none. Large-cart disclosures/read-backs can exceed fifteen words to preserve facts.
- Whole-order spice waits until done/no after Anything else. Explicit overrides still apply while collecting; hot asks Spicy versus Extra Spicy. Additional food resumes collection. Required sizes still ask immediately.
- Lahori, White, Black Pepper and Shinwari ask only missing proteins; Shinwari includes Beef. Keema first distinguishes Karahi versus Naan, then asks the real karahi proteins.
- Unique partial removals ask for confirmation; ties list the cart. Exact known names and established last-item references preserve their existing behavior. No removal can append a line.
- A clause reported unavailable/ambiguous adds nothing; resolved independent clauses stay in the cart.

Public development remains 80/80, with 0 unsafe additions. No cases were removed. 35 older dev question expectations changed from immediate spice to continued collection under the user's new policy; cart, quantity, size, spice, action and disposition labels stayed unchanged. IDs: correction-02, correction-07, correction-08, correction-10, correction-15, correction-16, correction-21, correction-23, correction-24, correction-25, correction-26, correction-27, correction-28, correction-35, correction-36, correction-38, correction-39, speech-01, speech-02, speech-03, speech-04, speech-05, speech-07, speech-08, speech-10, speech-24, speech-25, speech-26, speech-27, speech-28, speech-29, speech-36, speech-37, speech-38, speech-40.

Two quantity-readback assertions now check the concise Added N form. Three prior live-call tests now follow the requested removal confirmation/deferred-spice flow. Nine new pattern tests use different wording from the actual call. Property tests cover journal inversion, ten split-order/unsplit comparisons, echo rejection and short-blip rejection.

## The 765 ms engine spike

The original session has no per-turn stage CSV, so turn 10 cannot be proven to be the original 765.5 ms event. Replaying all ten transcripts in their supplied state order reproduces turn 10 as the slowest original turn: warm p50/p95 449.2 / 566.4 ms, maximum 729.7 ms. Original source commit: e19cd700fda1573d94d280e7c7eaf00b75a8767c.

The main waste was building the five-item LLM shortlist even when the LLM was disabled. Its nested phonetic comparisons repeatedly encoded query/menu words. The CPU profile also identifies menu-window phonetic comparisons and edit distance; GC is smaller. The fix checks provider availability first (disabled requests retrieve zero candidates), precomputes immutable menu keys and length cohorts, and uses mathematically safe score bounds and banded edit distance. Enabled FAQ retrieval uses the same scores with request-local memoization. Caller transcripts/results are not cached across requests.

Twenty fresh-process sequences and twenty warm sequences per version; fresh dialogue state each time, ten turns per sequence. “Cold” includes a fresh JIT/cohort cache, but immutable module/menu initialization finishes before the clock starts. The full original browser state was not exported, so the replay starts from newState and applies the supplied ten transcripts deterministically.

| Engine path | Before p50 / p95 ms | After p50 / p95 ms | Samples per version |
|---|---:|---:|---:|
| Cold sequence turns | 20.5 / 266.5 | 2.0 / 18.9 | 200 |
| Warm sequence turns | 12.1 / 449.2 | 0.8 / 5.8 | 200 |
| Turn 10, cold | 248.9 / 403.6 | 12.7 / 19.2 | 20 |
| Turn 10, warm | 449.2 / 566.4 | 5.3 / 12.5 | 20 |

Isolating performance changes from the earlier requested dialogue changes:

| Same-behavior snapshot | Before optimization p50 / p95 ms | After optimization p50 / p95 ms |
|---|---:|---:|
| Cold, 200 turns each | 26.6 / 364.8 | 2.0 / 18.9 |
| Warm, 200 turns each | 8.7 / 365.7 | 0.8 / 5.8 |

Per-turn warm p50/p95 (twenty repetitions of each):

| Turn | Original ms | Optimized ms |
|---|---:|---:|
| 1 | 0.4 / 2.3 | 0.5 / 1.7 |
| 2 | 13.1 / 25.9 | 2.2 / 3.8 |
| 3 | 7.9 / 14.9 | 0.8 / 3.3 |
| 4 | 45.0 / 61.1 | 0.2 / 0.6 |
| 5 | 183.9 / 232.9 | 1.0 / 2.1 |
| 6 | 2.4 / 4.5 | 0.6 / 1.6 |
| 7 | 0.4 / 1.5 | 0.4 / 1.5 |
| 8 | 1.2 / 3.7 | 0.9 / 2.3 |
| 9 | 52.3 / 96.7 | 0.8 / 1.3 |
| 10 | 449.2 / 566.4 | 5.3 / 12.5 |

Performance-only parity against the snapshot taken after the requested dialogue fixes, before optimization: **true**. All ten complete state/reply/match signatures and all three long-sentence signatures agree. This distinguishes intentional dialogue changes from the performance-only work. Zero provider requests in replay.

Unrelated sentences, twenty repetitions of each length (same corpus before/after; direct runTurn):

| Words | Before warm p50 / p95 ms | After warm p50 / p95 ms | After cold p50 / p95 ms |
|---|---:|---:|---:|
| 10 | 63.2 / 94.7 | 6.8 / 12.4 | 12.7 / 19.5 |
| 20 | 177.7 / 224.1 | 13.6 / 19.7 | 17.3 / 26.7 |
| 40 | 382.8 / 482.1 | 24.1 / 40.4 | 24.1 / 38.8 |

The automated 10/20/40-word budget requires warm p95 below 50 ms and every sampled invocation below 250 ms. It passes when run serially. A concurrent Edge/provider test pushed the 40-word p95 to 78.9 ms and failed that budget; serial rerun passed. These are measured budgets, not a hard real-time guarantee on a contended laptop. No truncation, deadline exit or lost dish was introduced to force a timing result.

## Endpointing and keyterms

Same thirty public script clips, synthesized once per input in RAM with Microsoft Zira Desktop, sent to three real STT configurations. Two local guards consume the SAME provider stream. New connections per utterance, not a full human dialogue. The old 1600 ms uncertain wait is compared with 900 ms uncertain + a 2200 ms continuation window. Existing conservative complete/incomplete waits remain unchanged.

If speech resumes, cancel playback/synthesis immediately; on the merged final, invert the recorded cart operations, restore the full dialogue checkpoint and process the merged utterance once. Finite question answers and checkout/name/confirmation transitions are guarded against unintended rollback. Interim transcripts never commit orders or start speculative TTS.

| Configuration | Before p50 / p95 ms | After p50 / p95 ms | Early releases before / after | Missing before / after |
|---|---:|---:|---:|---:|
| flux | 1481.1 / 1963.7 | 1357.6 / 1991.9 | 0/30 / 0/30 | 0 / 0 |
| nova-3 | 1411.4 / 1901.0 | 1191.2 / 1607.6 | 0/30 / 0/30 | 0 / 0 |
| nova-3-en-IN | 1497.3 / 1664.0 | 1390.2 / 1786.1 | 0/30 / 0/30 | 0 / 0 |

These are speech-end → engine-release measurements, excluding dynamic TTS/browser playback. Early release means a reply was released before the known final synthetic speech end; it is only a cut-off proxy. Every configuration/variant had 30/30 cart equivalence against the same unsplit ASR text; that is parser consistency, not intended-order recognition accuracy. No revisions were needed in these thirty clips; unit properties exercise rollback separately. Nova multilingual improved; Flux/en-IN p95 did not. No recognition winner is selected.

All configurations log **56 actual URL keyterms**, counts only. The paired garlic-naan experiment removes only that phrase for control (55); all other menu terms and PCM stay identical.

| Configuration | Exact garlic naan, control | Phrase included | Missing/failed control inputs |
|---|---:|---:|---:|
| flux | 1/6 | 2/6 | 0 |
| nova-3 | 4/6 | 6/6 | 1 |
| nova-3-en-IN | 6/6 | 6/6 | 0 |

For Nova multilingual, one control connection failed. On its five complete pairs, control is 4/5 versus boosted 5/5; the 4/6 versus 6/6 table retains the failure. These are tiny synthetic diagnostics, not evidence of the user's accent accuracy. Human accent accuracy remains unmeasured by this experiment.

Current docs: [keyterm syntax/500-token limit and dynamic Configure](https://developers.deepgram.com/docs/keyterm), [Flux eager events](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot), [Flux parameters](https://developers.deepgram.com/docs/flux/configuration). Multi-word phrases are single repeated query values, without weights. Flux EagerEndOfTurn/TurnResumed require eager_eot_threshold; the implementation deliberately leaves eager execution disabled and uses authoritative finals plus browser-qualified speech. Per-state hints are supported on both APIs. No undocumented N-best control is used.

## Playback and remaining failures

Barge-in now needs 320 ms sustained speech at RMS >=0.024, or >=0.032 during playback (plus a noise-floor threshold). The browser receives the playback reference and suppresses strongly correlated echoes before STT. Provider speech-start alone no longer cancels replies. Echo suppression is a heuristic and needs speaker/headphone testing with the user's real voice. Minimum duration deliberately adds reaction delay for short interruptions.

Every browser turn logs reply text length, actual source-ended completion (not network EOF), original interruption source/energy/duration, dropped/late chunks, acknowledgement-to-dynamic gap, maximum playback gap and engine stage profile. CSV exports all of these. No caller audio/transcript is persisted on the server. Pure echo/short-blip fixture tests pass; distinct sustained speech still interrupts.

Edge fixture: 3 turns, complete final playback, deliberate interruptions, TTS-failure recovery and CSV exports passed. The non-interrupted final source finished naturally; zero dropped/late chunks in that case. Fixture latency is not a live-provider claim.

Real-provider browser smoke uses one fixed synthetic Mango Lassi clip per configuration and the actual Aura HTTP path:

| Configuration | Completed spoken reply | First byte ms | Largest playback gap ms | Failure |
|---|---:|---:|---:|---|
| flux | 1/1 | 1341.1 | 2890.7 | none |
| nova-3 | 0/1 | n/a | n/a | tts_failed: timeout |
| nova-3-en-IN | 1/1 | 1148.8 | 1378.7 | none |

Two of three provider turns finished. One dynamic Aura request timed out. The two completed replies had about 1.4–2.9 seconds of silence after a short cached lead-in. Those lead-ins were not neutral acknowledgements, so acknowledgementGapMs is null and maxGapMs exposes the pause. Zero dropped/late chunks on completed replies; greeting interruptions were intentional synthetic caller speech. We cannot retrospectively attribute the user's earlier incomplete sentences without playback logs. Better VAD prevents one cancellation path, but remote dynamic TTS delays/timeouts remain unresolved; a quick first byte does not prove a fluid or complete reply. Headless playback completion does not measure human pronunciation/intelligibility.

The thirty fixed clips are build-time assets, including the shortened greeting and deferred spice question. Two assets were regenerated and twenty-eight reused; subsequent builds reused all thirty with zero synthesis requests and about 27 ms local manifest validation. Startup no longer synthesizes templates. Aura remains default; Kokoro is only the explicit interface alternative. No new API keys are needed.

## Validation and next real-mic run

- 53 selected engine tests, 23 live-call/bounds tests, 36 voice tests, 3 publication tests; Edge transport/recovery fixture, typecheck, privacy check and production build pass. The selected engine suite includes 80/80 public dev scenarios and journal/safety properties. No claim is made about unrun held-out/burned suites.
- Only public dev question labels changed for the new finish-before-spice policy; public thirty-turn script utterances remain unchanged (two expectation descriptions updated). No menu item, price or global alias changed.
- Use the same thirty-turn real-mic script and export the turn CSV and separate intended-words CSV. Inspect finished/interrupted/failed and playback-gap fields, not only first-byte latency. Saved exports belong in ignored .data and are deleted within thirty days.
- The voice server is local; Render remains on hold. Groq, Vapi and telephony remain off. The only required credential is DEEPGRAM_API_KEY in ignored .env.local.
