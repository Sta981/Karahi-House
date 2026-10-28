# Small mixed-language orders

For Hindi mixed with English, select **Nova-3 multilingual (English/Hindi mix)** on `/voice`. Nova-3 Indian English is an English configuration; selecting an Indian English accent does not enable other languages. The English Flux option also stays English. No model winner is claimed.

The multilingual option is now the default for mixed-language testing. The live interim/final transcripts and turn-log table show **Roman letters**. The server uses known-word spellings plus pinned [Sanscript 1.3.3](https://github.com/indic-transliteration/sanscript.js) for Devanagari, Gurmukhi, Urdu/Arabic, Bengali, Gujarati, Tamil, Telugu, Kannada, Malayalam and Sinhala script. Generic transliteration can be approximate, especially where vowels are unwritten. Other unsupported words show a placeholder. This does not translate a language or make an English-only speech model multilingual.

Romanization is presentation-only and never feeds item/quantity matching. The engine receives the actual STT text and its explicit safe vocabulary. Exported CSVs retain the redacted original in `transcript_redacted` and add `transcript_roman`. Both fields redact phone candidates, including native-script digit words. No audio is stored and no extra language API is called.

The multilingual connection now sends `model=nova-3`, `language=multi`, and repeated `language_hint=en` / `language_hint=hi`. Hints bias detection rather than restrict it and remain fixed during the connection. They appear in the runtime information and exported `stt_config`. This change uses the existing `DEEPGRAM_API_KEY`; no new key or LLM is required. See [Deepgram's language-prompting documentation](https://developers.deepgram.com/docs/nova-3-language-prompting).

The local engine handles a small explicit vocabulary: Roman Urdu/Hindi/Punjabi ordering fillers and numbers, Half/Full answers, common spice phrases, done phrases, and prefix/postfix removals. Common Devanagari, Shahmukhi/Urdu and Gurmukhi tokens map to the same local operations. This is text normalization, **not evidence that the STT recognizes those languages**. Unknown script becomes an explicit unresolved word, never silently disappears: its clause asks for a repeat in English and adds nothing; independent quantity/conjunction-delimited clear clauses can resolve. Non-ordering unknown-script turns remain read-only. Names and callbacks bypass this translation. See [latest two-call follow-up](multilingual-live-followups.md).

Hindi appears in Deepgram's current Nova-3 multilingual list; Urdu and Punjabi do not. Similar everyday Urdu/Hindi words may be heard, but Urdu/Punjabi speech reliability is not established. Full conversations and arbitrary translation are not implemented. A provider change is needed to evaluate those languages properly: [Soniox documents Hindi, Urdu and Punjabi in its real-time language list](https://soniox.com/docs/stt/concepts/supported-languages). It is not integrated or called by this build, and no API credits/account availability are assumed.

## Retest with your real voice

Run `npm run dev:voice`, open `/voice`, select the multilingual option and export the CSV before resetting. Try these synthetic development examples; do not use them as hidden cases:

| Say | Expected local behavior if STT provides those words |
|---|---|
| “Mujhe do garlic naan de dein.” | Add two Garlic Naan Bread and disclose two. |
| “Mainu ikk mango lassi deyo.” | Add one Mango Lassi. |
| “Aik lamb white karahi chahiye.” | Ask Half/Full; add nothing for this dish until size is answered. |
| “Aadha, kam mirch.” | Resolve the pending dish as Half, Mild Spice. |
| “Garlic naan hata do.”, when two are present | Ask “Remove one or both Garlic Naan Bread?”; change nothing yet. |
| “Ek.” / “Dono.” | Remove one / both of that pending equivalent item group. |
| “Aur kuch nahi.” | End collection; ask the whole-order spice question if needed. |
| “Bilkul mirch nahi.” | No Spice; no negative dish-replacement interpretation. |
| “Yahi order hai.” / “It's done now.” | Start checkout; resolve required choices/name, then read the complete order once and ask “Anything else?”. |
| “Nhi.” / “Enough.” after that read-back | Confirm no more items, keep the request pending staff acceptance, say thanks and end after playback. |

Enter the intended wording beside any wrong transcript in the page's local mishearing export. Missing/wrong STT text and wrong engine actions are separate failures. Twelve new development test groups cover these patterns and removal properties; live multilingual recognition/latency has not been measured for this revision. Replies remain English.

## Removal quantity safety

An unspecified removal of an equivalent group with more than one item asks a quantity. “Yes” alone does not authorize deleting the group. Explicit counts subtract that count; explicit “all” or “both” are validated against availability. Equivalent lines share a count; differing size/spice/notes need a target clarification. A stale pending count cannot operate on a changed cart. Cancellation and cart/price questions leave the cart intact. Every committed subtraction is disclosed with the remaining count and journaled locally.

Three earlier development tests were adjusted to explicitly request all items or answer the new quantity question; an exhaustive property now checks no mutation before that answer. The runtime test loader includes the new normalization module. Held-out inputs and grading rules are unchanged.
