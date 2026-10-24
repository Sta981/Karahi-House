import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
const read=path=>JSON.parse(readFileSync(path,"utf8"));
const dev=read("eval/results/parser-development.json"),burned=read("eval/results/burned_heldout_v1.json"),menus=read("eval/results/menu-migration-eval.json");
assert.equal(dev.sourceFingerprint,burned.sourceFingerprint);
assert.equal(dev.sourceFingerprint,menus.newMenu.sourceFingerprint);
const fraction=value=>`${value.numerator}/${value.denominator} (${value.percent}%)`;
const latency=value=>`${value.p50.toFixed(1)} / ${value.p95.toFixed(1)} ms (${value.samples} samples)`;
const lines=[
 "# Local parser fixes — development and burned regression", "",
 `Implementation fingerprint: \`${dev.sourceFingerprint}\`. This report belongs to the commit containing it; use \`git log -1 -- eval/results/parser-fixes.md\` for that commit.`, "",
 `Local corrections remain the default. Groq comparison: **${dev.groqComparison.status}**. Groq latency is unmeasured and no provider experiment ran. Every evaluation here made zero provider requests. No provider, phone, Vapi or audio test was enabled.`, "",
 "## Changes and root causes", "",
 "- A: Greedy vocabulary matching and cross-conjunction aliases could hide an adjacent item. `lib/speech.ts` normalizes plurals/fillers; `lib/matcher.ts` restricts conjunctions to actual dish names and examines uncovered clauses. Exact unique canonical names, including single words, resolve immediately. One-word vocabulary entries use exact spelling only; truncated/ambiguous names and close typo scores still ask.",
 "- B: `recognitionTurn` previously deferred clear items in a single queue. It now admits resolved items immediately, keeps only unresolved issues pending, and never replays admitted items when a choice is confirmed. A new clear item can enter while another identity or size is pending.",
 "- C: The old correction handler only understood a prefix quantity change; removal happened after matching. `lib/order-operations.ts` now interprets ordered add/remove/replace operations locally, including actually/wait/no wait/nahi/I mean, named replacements and partial removal. It preserves existing lines on ambiguous targets and asks. Removals/replacements do not append an unrequested dish; explicit new sides are separate adds. Quantity changes are read back locally. Legacy hata/nikal/take-it-off removal semantics are retained.",
 "- D: Korma now asks for protein; plausible misspellings offer a confirmation instead of being declared unavailable. Unavailable suggestions use live menu records, with protein-filtered retrieval when available. Trailing lassi flavors normalize, large Rice gets a one-size explanation, urgency stays in Notes, and an unrelated dish's size cannot answer the pending item's size question.",
 "- Every public local turn returns a before/after cart journal. Replay validates its targets and reconstructs the cart exactly. All items, modifiers, prices, totals and order replies remain local.", "",
 "## Fresh development scenarios", "",
 "These 80 synthetic development scenarios were repeatedly inspected while fixing the parser. They are not held-out and do not estimate unseen/audio accuracy. Their utterances differ from the burned suite. The initial annotation mistakes and first-run scores are preserved in `eval/parser-dev-label-audit.md` and `parser-development-initial.json`.", "",
 "| Check | Corrections | Speech/normalization | Total |", "| --- | --- | --- | --- |",
 ...[["Complete scenario","pass"],["Exact final cart","cart"],["Required question","questions"],["Disposition","disposition"],["Operation replay","replay"]].map(([label,key])=>`| ${label} | ${dev.corrections[key].correct}/40 | ${dev.speech[key].correct}/40 | ${dev.all[key].correct}/80 |`),
 `| Unrequested additions | ${dev.corrections.unsafe.length}/40 | ${dev.speech.unsafe.length}/40 | ${dev.all.unsafe.length}/80 |`, "",
 `Correction add/remove/replace **action-sequence** accuracy: ${dev.corrections.actions.correct}/40. Targets/quantities/sizes are checked through the exact cart assertions and additional properties. A future provider comparison additionally needs operation-level target/quantity/size labels; the verb score alone cannot select Groq.`, "",
 "All 83 original test groups are retained, with assertions ported where the approved policy changed. Eighteen added groups cover the 80 dev scenarios, bounded/seeded properties, exact optimization parity and the preposition regression, for **101/101 passing tests**. Checks include 150 seeded sequential operation replays, plural equivalence, no unrequested additions, ambiguous targets, size/spice preservation and non-duplication. Typecheck, privacy check and production build passed.", "",
 "## Local text-parser latency", "",
 `Location: ${dev.location}. ${dev.machine.cpu}; ${dev.machine.node}, ${dev.machine.platform}/${dev.machine.arch}.`, "",
 "| Measurement | p50 / p95 |", "| --- | --- |",
 `| First measured pass | ${latency(dev.all.latencyMs)} |`,
 `| Warm whole local turn | ${latency(dev.warmLatencyMs)} |`,
 `| Warm correction turns only | ${latency(dev.warmCorrectionLatencyMs)} |`, "",
 "Warm timings repeat the same 80 scenarios five times; correction timing uses 40 scenarios × five. The timed synchronous turn includes matching, local reduction, modifier questions and journal creation. Seed setup, module compilation, network, STT, TTS and cold hosting startup are excluded. These are local parser timings, not end-of-speech-to-audio latency. No US-hosted or Groq latency has been measured.", "",
 "## Existing public development regressions", "",
 "| Menu version | Supported dish | Quantity | Joint | Messy scenarios | Simulated supported joint |", "| --- | --- | --- | --- | --- | --- |",
 ...[menus.oldMenu,menus.newMenu].map(menu=>`| ${menu.version} | ${fraction(menu.dev.metrics.dish)} | ${fraction(menu.dev.metrics.quantity)} | ${fraction(menu.dev.metrics.joint)} | ${menu.messy.passed}/${menu.messy.scenarios} | ${fraction(menu.simulated.metrics.joint)} |`), "",
 "The old and final menu denominators differ; these are separate regressions, not an apples-to-apples improvement claim. The existing menu report retains policy counts and every row. The final menu is approved by the restaurant: 84 unique items, 13 sized, 66 spice=true and integer-cent base prices.", "",
 "## burned_heldout_v1 — regression only", "",
 "The 45 original cases are copied byte-for-byte from freeze commit `592b0d41b3ad62471bd427a6905a8eb715c25e4d` into a separate regression directory. Original gold and grading functions remain unchanged. This repeatable regression is **never held-out again**. The original one-shot runner and its lock were not run or modified.", "",
 "| Metric | Current burned regression |", "| --- | --- |",
 ...Object.entries(burned.metrics).map(([key,value])=>`| ${key} | ${fraction(value)} |`),
 `| Disposition | ${fraction(burned.disposition)} |`,
 `| Required question | ${fraction(burned.requiredQuestions)} |`,
 `| Exact cart | ${fraction(burned.cart)} |`,
 `| Complete case | ${fraction(burned.turnPass)} |`,
 `| Silent wrong adds / excess quantities | ${burned.silentWrongAdds.length} / ${burned.excessQuantityCases.length} |`, "",
 "Five strict misses remain: two safe typo clarifications (29, 31), and three unavailable-item follow-up questions (36–38) against original `mustAsk: []` expectations. No gold was changed to improve the score. Case 31 retains the resolved Dal Makhani while the naan identity waits. These are listed fully below and in `burned_heldout_v1.json`.", "",
 "## Every remaining burned-regression miss", "",
 ...burned.rows.filter(row=>!row.pass).flatMap(row=>row.turns.filter(turn=>!turn.pass).flatMap(turn=>[
  `### ${row.id}`, "", `Utterance: ${turn.text}`, "",
  "Expected (unchanged original gold):", "```json", JSON.stringify(turn.expected,null,2), "```", "",
  "Actual:", "```json", JSON.stringify(turn.actual,null,2), "```", "",
 ])),
 "## Next boundary", "",
 "Fresh hidden cases stay with the user until the optimization commit. On receipt, commit code and cases together, record the freeze hash, run once, and change nothing after the result. Grading rules remain unchanged. The user skipped the Groq experiment: comparison status is not needed: dev saturated. The original segmenter decision document is preserved unchanged; its companion status file records the current decision. Local stays the default and no Groq comparison will run.", "",
];
writeFileSync("eval/results/parser-fixes.md",lines.join("\n"));
console.log("Wrote eval/results/parser-fixes.md; implementation fingerprints agree.");
