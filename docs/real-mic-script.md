# Real-microphone comparison: 30 turns per model

Use your own accent and normal speaking pace, with headphones, the same microphone/network and the same deployment. No recordings. Audio is transient; only redacted transcript/cart/metrics logs are retained locally. This is one speaker and 90 scripted turns, not a population accent-accuracy estimate.

Run exactly these thirty turns once each with Flux English, Nova-3 multilingual and Nova-3 Indian English (en-IN). Start a fresh call at each session boundary A–E (turns 1, 7, 14, 21, 26). Within a session, keep the call/cart alive. Wait for replies except at the deliberate internal pauses. Do not speak the bracketed pause instructions. If interrupted during a pause, finish the original sentence and mark a premature cut-off. Use Test Customer instead of your real name; do not say a real phone number.

Rotate model order: A Flux / multi / en-IN; B multi / en-IN / Flux; C en-IN / Flux / multi; D Flux / en-IN / multi; E multi / Flux / en-IN. Export CSV before starting another call. Repeat the same procedure later for the other deployment; do not pool Lahore local and US-hosted latency. Let the first ready/greeting finish; note cold-start time separately.

Copy the blank results sheet to private .data before filling it. Mark dish, quantity, size and spice/must-ask independently (pass/fail/NA), along with premature cut-off, false barge-in and subjective clarity. Record engine-policy failures separately from transcription failures. A safe clarification is different from a silent wrong addition. Never infer correctness from the agent's own confidence.

| Turn | Session | Speak | Intended result / check |
|---|---|---|---|
| 1 | A — NEW CALL | Salam, can I order for pickup? | Pickup FAQ; no cart addition. |
| 2 | A | Please add one chicken biryani. | 1 Chicken Biryani; ask the order spice level. |
| 3 | A | Medium spice for the order. | Chicken Biryani becomes Medium Spice. |
| 4 | A | And two garlic naan, please. | Add 2 Garlic Naan Bread; inherit Medium Spice. |
| 5 | A | No, make the garlic naan three. | Replace naan quantity with 3; no additional line. |
| 6 | A | Remove one garlic naan. | Reduce naan quantity to 2; keep biryani. |
| 7 | B — NEW CALL | Can you do a lamb white karahi? | Ask Half/Full; never guess a size. |
| 8 | B | Full, with no spice. | 1 Full Lamb White Karahi, No Spice. |
| 9 | B | Add a mango lassi as well. | Add 1 Mango Lassi; no spice/size question for lassi. |
| 10 | B | Actually, make the karahi half. | Replace Full with Half; preserve quantity and No Spice. |
| 11 | B | That will be all. | Ask the pickup name before read-back. |
| 12 | B | Test Customer. | Read back cart and local subtotal; ask confirmation. |
| 13 | B | Yes, that is correct. | Pending staff acceptance; never say restaurant accepted. |
| 14 | C — NEW CALL | One fish pakora, make it hot. | Ask Spicy versus Extra Spicy; hot must remain unset. |
| 15 | C | Spicy, please. | Set Fish Pakora to Spicy. |
| 16 | C | Actually, make the pakora extra spicy. | Override Fish Pakora to Extra Spicy; no added line. |
| 17 | C | Please add butter chicken. | Unavailable; offer only actual menu items; no silent addition. |
| 18 | C | No. | Decline the offered substitute; keep Fish Pakora. |
| 19 | C | Add one gulab. | Ask to confirm Gulab Jamun; truncated name must not silently add. |
| 20 | C | Yes, one gulab jamun. | Add 1 Gulab Jamun; dessert has no spice/size. |
| 21 | D — NEW CALL | Mujhe aik chicken biryani chahiye. | 1 Chicken Biryani; ask spice. |
| 22 | D | Bilkul no spice. | Set the order to No Spice. |
| 23 | D | Do garlic naan bhi de dein. | Add 2 Garlic Naan Bread; inherit No Spice. |
| 24 | D | Nahi, garlic naan teen kar dein. | Replace naan quantity with 3; do not append. |
| 25 | D | Aur ek mango lassi. | Add 1 Mango Lassi; no spice modifier. |
| 26 | E — NEW CALL | One chicken [pause 700 ms] biryani, mild spice. | One complete item, Mild Spice; no reply during the pause. |
| 27 | E | And one rice [pause 1000 ms] and one mango lassi. | Add both items once; no reply during the pause. |
| 28 | E | One garlic naan [pause 600 ms] no, make it two, mild spice. | End with 2 Garlic Naan Bread, Mild Spice; no unrequested additions. |
| 29 | E | Can I have a karahi? | Clarify protein/style; every offered candidate must be an actual karahi. |
| 30 | E | I have a peanut allergy. | Mark needs_review and defer ingredient safety to staff. |

Do not select Flux/Nova yet. After you fill the sheet, compare silent wrong adds and premature cut-offs first, then slot correctness and clarification burden, then warm p50/p95 latency. Report 1 speaker / 30 turns per model, missing turns and failures explicitly. Current synthetic results do not fill any of these real-mic score cells.

If the agent asks a different question from the script, record the mismatch and answer the actual question to recover. Record recovery turns separately; they are extra turns, not replacements for the thirty scripted turns. Mark later failures caused by that mismatch as dependent conversation failures, rather than counting each as an independent STT error. Do not silently restart or discard a failed session.
