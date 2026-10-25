# Menu browsing and informative audio

Menu questions now take a local intent path before dish matching. Dessert, drink, bread, rice, kids, starter, BBQ and vegetarian synonyms return three to five real menu entries with prices and “Want more?”. Rice browsing includes Rice and the Biryani category; starters use Sides. The complete menu lists its actual category names. Browsing never edits the cart or sets staff review, including garbled browsing questions. Bare canonical dish orders still work.

Goodbye with food in the cart enters required choices, pickup name and read-back confirmation. An empty call says goodbye. Browser playback finishes before the connection and microphone close. Staff review requires allergy intent, a requested person, or three failed clarification attempts. Two misses offer categories. The two unwanted reply prefixes are gone; consecutive identical suggestions are replaced with recovery wording.

Mishearings remain scoped: ganina is a standalone ordering fragment, bread homophones require an adjacent bread modifier, in-suite/barracks repairs live in browsing intent, got is only a pending Goat protein answer, and bot is only a Half/Full answer. Nothing was added to the global menu alias JSON. Unknown-dish retrieval uses category evidence first, then phonetic evidence and protein within that category.

311 checked static clips include complete category pages, fallback and size/protein questions, all 84 item names, each distinct menu unit price, integer number clips zero through ninety-nine and modifiers. Build reuse requires no API call. Only synthetic menu/template audio ships. Caller notes and names remain uncached. Multiple uncached gaps coalesce into one synthesis request. Fragment joins may still sound less natural than a full synthesized sentence; this needs listening with the actual microphone setup.

Neutral “Okay” acknowledgements are no longer inserted. Remote synthesis could not guarantee content within 300 ms afterwards, and immediate cached content does not need an acknowledgement. Genuine stalls still use a separately labelled cached “One moment.” Live HTTP output now releases 300 ms PCM batches before provider EOF. Short replies can still buffer to completion. Retry is allowed once before any PCM is released; a mid-body failure after release uses the cached failure notice, avoiding repeated words/order facts. The inactivity timer and keep-alive pool remain. The TTS interface and deterministic price/order templates remain separate from transport. FAQ/LLM stays off.

The dashboard headlines speech end → first informative audio, and separately shows ack first byte, content first byte (`tts_content_first_byte_ms`) and the ack-end → informative-playback gap. An absent ack is an empty measurement, not zero or fabricated speed. The compatibility CSV field `tts_first_byte_ms` remains the first transport byte, which may be neutral; it is labelled accordingly.

Nova en-IN's complete-phrase wait is provisionally 800 ms, uncertain 900 ms, unfinished conjunction/quantity tails 1600 ms. Active finite questions use 600 ms. Continuation rollback remains on; interim/speculative engine is off. A read-only diagnostic flag compares 700/800/900/1600 ms guards on identical live en-IN PCM and provider final events, without engine/cart/TTS effects. This estimates endpoint-release delay and premature release, not four separate full conversations. Full pipeline metrics come from the same public thirty-turn script on each configuration.

Barge-in requires 480 ms (six 80 ms frames), uses a higher playback threshold and a stronger correlated-reference echo guard. Manual interruption stays available. “Ignore interruptions (demo)” sends silence while reply audio is queued/playing, keeping the STT clock continuous; turn-taking resumes after playback. This deliberately also ignores a real caller trying to interrupt in that mode.

Validation: 53 selected engine tests, 30 live-call/pattern/bounds tests, 53 voice tests and 3 publication tests. Public expectations were updated for removed boilerplate and the three-failure policy; no tests were removed. The runtime transpiler only gained the new menu-browsing dependency. Held-out files and grading rules were not changed or executed.

The [full local walkthrough](order-walkthrough.json) includes inputs, exact read-back and the final simulated pending-acceptance ticket. Its subtotal is $48.48: Full Chicken Lahori Karahi, Extra Spicy, no green onions ($36); two Garlic Naan Bread, Mild Spice ($7.98); Mango Lassi ($4.50). All cents come from the approved menu, not a model. Tax is not configured; payment at pickup; staff acceptance remains pending.

Current Flux documentation confirms that `EagerEndOfTurn`/`TurnResumed` require `eager_eot_threshold`. We continue to commit only final turns and keep speculative engine execution off. [Deepgram eager-EOT documentation](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot), [configuration](https://developers.deepgram.com/docs/flux/configuration).

Provider measurements and the aggregate audit of the two private CSVs follow below. No private CSV, transcript or recording is published. Render deployment remains on hold; localhost binds to 127.0.0.1 and tunnel/public access still requires the private token.

The first content-first trial (source `0b52d26`, 90 public synthetic turns) exposed 18?28 second informative-audio outliers caused by waiting for provider body EOF, including a 26.7-second body with first bytes at 2.7 seconds. Its complete failure-bearing output is retained separately. The next revision adds true buffered streaming and more fixed recovery speech. All thirty canonical public-script replies have zero remote synthesis characters in the offline cache-coverage check; this does not claim that live STT transcripts will follow the same state path. Computed subtotal clips below $100 combine exact integer dollars and cents; known menu unit prices keep whole clips. Larger unknown totals and caller notes remain dynamic. Number/price composition has separate semantic tests.

## Measurements

Runtime measured: `784ab85aea381ec2f5d724000ddc6075fa85c0e4`. **Lahore local**, Edge, public thirty-turn script per model; Microsoft Zira synthetic PCM, real Deepgram STT/TTS. This is not human accent accuracy or acoustic loopback. All 90 inputs match the earlier trial's PCM hashes: true. Model outputs/conversation paths can still vary between runs. The later menu-context correction is covered by pattern/regression tests; it does not change the audio implementation.

Headline: speech end → first **informative playback**, p50 / p95 milliseconds. Percentiles use only arrivals; completion/missing counts are alongside them.

| Configuration | Earlier 32-clip version | Initial 201-clip trial | Buffered streaming + 311 clips | Completed / attempted |
|---|---:|---:|---:|---:|
| Flux | 3745 / 6361 (n=29) | 2808 / 24992 (n=29) | 1242 / 4921 (n=30) | 30/30 |
| Nova-3 multi | 4045 / 6677 (n=30) | 3366 / 18206 (n=29) | 1453 / 7343 (n=30) | 30/30 |
| Nova-3 en-IN | 3894 / 6163 (n=30) | 1277 / 5016 (n=29) | 1008 / 1763 (n=30) | 30/30 |

The trial regression is retained: atomic body buffering produced 18–28 second outliers. The first body bytes in one example arrived at 2.7 seconds, but buffered output waited 26.7 seconds. Streaming and broader static coverage address this wait; they do not guarantee provider throughput or eliminate slow dynamic synthesis.

Trial completion counts were Flux 29/30, Nova multi 28/30 and en-IN 29/30. Arrival percentiles also retain informative audio from a turn that later failed to finish. All final-run turns finished.

| Configuration | First audio byte p50 / p95 | First informative byte p50 / p95 | Premature informative releases / 30 | Continuation revisions | Replies cut by VAD/manual barge-in | ≥80 ms playback gaps | Stall prompts |
|---|---:|---:|---:|---:|---:|---:|---:|
| Flux | 1224 / 2285 | 1224 / 4360 | 0 | 0 | 4 | 3 | 5 |
| Nova-3 multi | 1431 / 2591 | 1431 / 6623 | 0 | 0 | 4 | 5 | 8 |
| Nova-3 en-IN | 987 / 1737 | 987 / 1737 | 0 | 0 | 5 | 0 | 0 |

Barge-in counts include deliberately starting script speech while a greeting is playing. They are interruption counts, not a measured false-positive rate. The separate browser fixture verifies short-blip rejection, correlated echo rejection, sustained 480 ms speech, ignore-interruptions mode and finishing goodbye before releasing the mic. Synthetic speech cannot establish performance with room echo or your accent.

Ack first byte and ack-to-content gap have **n=0** in this content-first configuration: no neutral acknowledgement is inserted. `tts_content_first_byte_ms` is measured separately in the live dashboard/CSV. First transport byte may still be a neutral stall prompt; it is not the headline. Provider chunk timing stays separate from playable buffered content.

Paired en-IN **endpoint release** study: four read-only guards share exactly the same live audio and provider finals. No additional engine/cart/TTS path runs for these probes. These are endpoint-release delays, not four full-pipeline latency measurements.

| Complete-phrase wait | Endpoint release p50 / p95 ms | Last endpoint arrival n / 30 | Premature releases / 30 |
|---|---:|---:|---:|
| 700 | 1009 / 1791 | 30/30 | 0 |
| 800 | 1012 / 1791 | 30/30 | 0 |
| 900 | 1013 / 1792 | 30/30 | 0 |
| 1600 | 1481 / 1792 | 30/30 | 0 |

Complete-phrase subset only (16 turns; uncertain/incomplete phrases excluded):

| Wait ms | Endpoint release p50 / p95 ms | n |
|---|---:|---:|
| 700 | 978 / 1167 | 16 |
| 800 | 999 / 1167 | 16 |
| 900 | 1007 / 1168 | 16 |
| 1600 | 1534 / 1623 | 16 |

The earlier trial on identical inputs had one premature release at each of 700/800/900 ms and none at 1600 ms. The final run's zero does not prove pause safety; live provider final timing varies. The shorter waits save about half a second on the complete-phrase subset, while provider timing bounds further gains.

Recorded reply generations had dropped/late chunk counts: Flux 0/0; Nova-3 multi 0/0; Nova-3 en-IN 0/0. All final-run barge cuts occurred on the opening turn of a scripted session, during the deliberate greeting interruption.


Default waits: Flux complete 750 ms, Nova multi complete 1100 ms, en-IN complete 800 ms; uncertain 900 ms; unfinished conjunction/quantity tails 1600 ms; active finite questions 600 ms. A shorter wait cannot guarantee that a caller will not resume after a longer pause. Continuation rollback protects the cart; an already audible early response remains a conversational failure and is counted. En-IN's fast setting remains provisional pending your microphone test. `VOICE_ADAPTIVE_COMPLETE_MS=1600` remains an available cautious override. No model winner is selected.

The first post-revision browser connection timed out **before audio upload** (zero attempted turns). Its failed diagnostic is retained separately; a warm retry produced the ninety-turn run above. Root cause is not established. Static-cache startup was 353 ms; total local dev startup was 6.84 seconds including Next startup. These are separate from turn latency; no US-hosted measurement was performed because deployment remains on hold.

## Your two private CSVs

Only aggregates were copied. The 23-turn session recorded first transport-byte p50/p95 1879/9318 ms, but informative playback 4354/8250 ms (n=20; three missing), with ack-end → content gaps 1979/2749 ms. Server content-output time was 2340/3286 ms (n=20), versus a misleading 3/39 ms first transport byte. Four VAD interruptions used 320 ms. The earlier eight-turn file has no informative-playback columns, so none are reconstructed; it logged one additional 320 ms interruption. These are recorded historical values, not a controlled before/after human test. The dashboard now refreshes provider word-end timing even for answers shorter than the VAD minimum, preventing reuse of a previous turn's speech-end estimate.

Raw private CSVs remain in Downloads; no raw transcript or recording is included in Git or this report. The prior mic trace contained 1548 provider chunks (inter-chunk gap p50/p95 0.46/156.58 ms, maximum 1658.68 ms, including request-first gaps), one retried connection failure, 27 playback gaps and 17 stall prompts. This separates transport gaps from the much larger ack-to-content wait.

Validation: **140 selected tests pass** (53 engine, 30 live-call/pattern/bounds, 53 voice, 4 publication), plus the real Edge transport fixture, type check, privacy check and production build. The eighty public parser scenarios still pass. Held-out files and grading rules were not changed or run. No test was removed. The complete local read-back and ticket are in [order-walkthrough.json](order-walkthrough.json); subtotal $48.48, simulated and pending staff acceptance.

