import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TEXT_CASES } from "../eval/text-cases.mjs";
import { loadMatcher } from "./lib/load-matcher.mjs";
import { loadDialog } from "./lib/load-dialog.mjs";

// Use the unchanged Day 1 extraction evaluator and the exact same labels.
process.stdout.write(execFileSync(process.execPath, ["scripts/eval-text.mjs"], { encoding: "utf8" }));
const baseline = JSON.parse(readFileSync("eval/results/text-baseline.json", "utf8"));
const current = JSON.parse(readFileSync(".data/reports/text-current.json", "utf8"));
assert.equal(current.corpusHash, baseline.corpusHash, "Corpus changed; do not present this as a direct before/after comparison");
assert.deepEqual(current.evaluatorHashes, baseline.evaluatorHashes, "Extraction evaluator changed; comparison requires review");

const { analyzeUtterance } = loadMatcher();
const { runTurn, newState, fingerprint } = loadDialog();
const policies = TEXT_CASES.filter((row) => ["clarify", "unavailable"].includes(row.expected.disposition)).map((row) => {
  const analysis = analyzeUtterance(row.text);
  const turn = runTurn(newState(), row.text, analysis);
  const issue = analysis.issues[0];
  const expectedIds = row.expected.candidates?.slice().sort();
  const actualIds = issue?.candidates.map((candidate) => candidate.itemId).sort();
  const candidatePass = !expectedIds || JSON.stringify(expectedIds) === JSON.stringify(actualIds);
  const pass = issue?.kind === row.expected.disposition && candidatePass && turn.state.cart.length === 0 && !turn.summary && !turn.endCall;
  return { id: row.id, input: row.text, expected: row.expected.disposition, actual: issue?.kind ?? "no_issue", candidatePass,
    prematureCartItems: turn.state.cart.length, reply: turn.reply, pass };
});

const comparison = {
  kind: "known-synthetic-text-regression-after-recognition-fixes",
  corpusHash: current.corpusHash,
  baselineSourceFingerprint: baseline.sourceFingerprint,
  currentSourceFingerprint: current.sourceFingerprint,
  dialogFingerprint: fingerprint,
  unchangedExtractionEvaluator: true,
  baselineMetrics: baseline.metrics,
  currentExtractionMetrics: current.metrics,
  structuredFirstTurnPolicy: { passed: policies.filter((row) => row.pass).length, total: policies.length, cases: policies },
  measuredHumanSpeakers: 0,
  measuredAudioUtterances: 0,
  providerCalls: 0,
  limitations: [
    "Known synthetic development cases only. These improvements do not establish held-out speech or final-order accuracy.",
    "The legacy extraction evaluator remains unchanged; new policy checks are reported separately, not backfilled into the baseline.",
    "Policy checks verify first-turn structured classification, expected candidate IDs, and no premature cart addition/submission.",
    "Multi-turn regression tests are exercised separately by npm run test:eval; a broader conversation evaluation is still pending.",
  ],
};
mkdirSync("eval/results", { recursive: true });
writeFileSync("eval/results/text-after-recognition.json", `${JSON.stringify(comparison, null, 2)}\n`);
const fraction = (value) => `${value.numerator}/${value.denominator} (${value.percent}%)`;
const columns = [
  ["Exact item sets", "supportedUtteranceItemExact"],
  ["Exact quantities and annotated variants", "supportedUtteranceSlotExact"],
  ["Supported-item mention precision", "supportedMentionPrecision"],
  ["Supported-item mention recall", "supportedMentionRecall"],
  ["No-match behavior on negative/unavailable cases", "noMenuMentionOrUnavailableRejection"],
];
const markdown = [
  "# Recognition fixes: comparison with the frozen Day 1 baseline", "",
  "Same 100 synthetic text cases and unchanged extraction evaluator. No human speakers, recordings, provider calls, or latency measurements.", "",
  "| Measure | Original | After fixes |", "| --- | --- | --- |",
  ...columns.map(([name, key]) => `| ${name} | ${fraction(baseline.metrics[key])} | ${fraction(current.metrics[key])} |`), "",
  "## Separate first-turn policy check", "",
  `Passed **${comparison.structuredFirstTurnPolicy.passed}/${policies.length}** clarification/unavailable-item cases. These were previously unmeasured; they are not a comparable baseline accuracy score.`, "",
  "| Input | Result | Reply |", "| --- | --- | --- |",
  ...policies.map((row) => `| ${row.input} | ${row.pass ? "pass" : "FAIL"} | ${row.reply} |`), "",
  "Chicken Kirby now retrieves chicken Karahi as a candidate and requires explicit confirmation before adding it. Explicit chicken Korma requests remain Korma.", "",
  "Quantity fixes cover numeric prefixes, Urdu do after mujhe, articles before dozen/couple, and boundaries between ordered items. Out-of-range quantities ask for restatement instead of silently clamping.", "",
  ...comparison.limitations.map((note) => `- ${note}`), "",
  "Reproduce current results with `npm run eval:recognition`. The frozen baseline JSON and Markdown are never replaced.", "",
].join("\n");
writeFileSync("eval/results/text-after-recognition.md", markdown);
console.log(`Separate structured first-turn policies: ${comparison.structuredFirstTurnPolicy.passed}/${policies.length}`);
console.log("Comparison: eval/results/text-after-recognition.md");
if (policies.some((row) => !row.pass)) process.exitCode = 1;
