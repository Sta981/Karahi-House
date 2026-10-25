# Intent authorization and cart disclosure

Every transport uses the same public `runTurn` transaction: classify intent, prepare a private draft, validate the permitted changes, rewrite the reply, calculate the semantic cart diff, disclose every change, and commit. The existing operation journal remains the source for exact replay and continuation rollback; it is deliberately separate from the semantic diff used for speech.

The eight intents are `add_order`, `correction`, `removal`, `question`, `complaint`, `confirm`, `done`, and `chitchat`. Questions and complaints take a separate informational path and cannot call the cart mutation handlers. Other non-order intents cannot commit a changed cart. Explicit acceptance of a previously proposed addition is classified as `add_order`; a size answer completes that pending request; a spice answer authorizes a `correction`. Final checkout confirmation does not authorize new items. A mixed removal plus an explicit new addition is a correction, while a pending removal always confines the next action to removal.

After all repeat/category/clarification rewrites, code generates Added, Removed (with remaining quantity), and Changed templates from the before/after cart. Every modifier and note is included in the affected line. An undisclosable or unauthorized draft is discarded with no journal operations or submission summary. A purely structural regrouping with no caller-visible order change is discarded too. Array index shifts cannot turn a removal into a spoken claim that every subsequent dish changed. The optional FAQ model cannot generate or replace these order facts.

Repetition within an utterance asks for quantity unless an explicit additive connector is present. It does not deduplicate intentional additions on separate turns. The uncertain repetition remains pending while other clear dishes and size answers are processed. Explicit full-name corrections supersede the relevant stale family question; unrelated unresolved requests are retained. Bare burger is a question about the current menu's Kids Chicken Burger and its local price, never an automatic addition or a discarded request.

Removal groups equivalent lines by item, size, spice and notes. Requested quantity is subtracted across that group. Different modifiers require target clarification; exact existing note qualifiers can select their variant, while invented instructions cannot become a removal target. Partial target confirmation binds to the exact current line. Switch/instead in a pending removal cannot append or replace. Desired-total wording sets the equivalent group's combined quantity.

Validation: 154 selected tests pass: 42 live/pattern tests, 53 existing local recognition/order/provider-mock tests, 55 voice tests, and 4 publication tests. The new suite includes 720 deterministic seeded turns checking disclosure, quantity monotonicity for removal/question/complaint intents, immutable input state, and exact journal replay. Existing 80 public development scenarios remain passing. One prior development assertion intentionally changed: an unclear removal now lists the cart as requested. No held-out cases or grading rules were accessed or changed.

The owner's latest session is a private **development replay**, not a held-out evaluation. Its 23 finalized transcript rows and continuation supersession markers are stored only under ignored `.data/`, with a thirty-day deletion date. Replay currently passes 23/23 disclosure, 23/23 permission, and 23/23 journal checks. The intended final cart has not been supplied, so final-cart correctness is ungraded. These checks do not establish dish accuracy or microphone accuracy. No recordings are created, and the voice server persists neither transcripts nor audio.

Run private tools locally:

```powershell
npm run voice:analyze -- 'C:\path\to\development-export.csv' --prepare-replay
npm run dev:replay
```

The first command replaces the private development replay fixture; use it only for the intended session. After the caller supplies its intended cart, enter that expectation in the private fixture and rerun. New wording variants and properties live in normal committed test files, rather than copying caller utterances into public tests. Test runners do not load the private replay automatically.

# Earlier-build real-microphone timing

The provided `(2).csv` contains 23 Nova-3 en-IN rows labelled `baseline+adaptive1600`. It predates build provenance, so its commit and TTS provider are unknown from the CSV. Values below use nearest-rank quantiles, matching the current dashboard. The pasted page was a partial snapshot with only 19 informative-playback measurements; the completed export contains 20, so its percentiles differ.

| Measurement | n | p50 | p95 | Worst |
|---|---:|---:|---:|---:|
| Speech end to informative playback | 20 | 4354.3 ms | 8250.5 ms | 17344.3 ms |
| Speech end to informative browser byte | 20 | 4261.6 ms | 7774.5 ms | 16512.2 ms |
| Speech end to first transport byte | 23 | 1879.3 ms | 9317.6 ms | 12791.6 ms |
| Engine | 23 | 14.7 ms | 71.6 ms | 157.4 ms |
| TTS content first byte after synthesis request | 20 | 2340.3 ms | 3285.8 ms | 3690.7 ms |
| Acknowledgement to content playback gap | 20 | 1978.7 ms | 2749.3 ms | 3970.7 ms |

Three rows have no informative-playback measurement and `no_audio` status; they are not assigned zero latency or counted as successful informative turns. Fifteen rows report playback finished, and four report barge-in cuts. Receiving informative audio is not the same as finishing the complete reply. This is an earlier-build result, not a new-build latency claim. No provider calls were made for this safety change; fresh real-mic results must come from the owner's retest.

# Identifying future logs

The voice page shows the source Git commit and whether tracked source was dirty at server startup. On connection it shows the selected STT provider/model/language, keyterm count, provider endpoint settings, all four guard waits, continuation window, TTS provider and model. Every turn CSV row and every mishearing CSV row includes the same immutable runtime snapshot. Missing legacy metadata is `unknown`, never guessed from filenames. Restart the server after committing or updating code; its loaded engine and startup identity then agree.

Default waits remain Flux complete 750 ms, Nova multilingual complete 1100 ms, Nova en-IN complete 800 ms, uncertain 900 ms, unfinished 1600 ms, and finite answers 600 ms. TTS remains Aura-2 Thalia by default. Runtime exports record actual configured values, including overrides. The existing localhost/public-access restrictions and default-disabled LLM remain in force.

To require a new clean build when analyzing a fresh CSV:

```powershell
npm run voice:analyze -- 'C:\path\to\new-export.csv' --require-commit FULL_40_CHARACTER_COMMIT
```

Rows from another commit, dirty runs, and legacy rows are excluded and counted explicitly. Raw caller exports/replays stay private; only aggregate results and synthetic test wording are published.
