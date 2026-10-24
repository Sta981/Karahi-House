import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TEXT_CASES } from "../eval/text-cases.mjs";
import { STRICT_SLOT_CASES, exactSlots } from "../eval/strict-slot-labels.mjs";
import { FALLBACK_REASONS } from "../eval/fallback-reasons.mjs";
import { RECORDING_PLAN } from "../eval/recording-plan.mjs";
import { loadMatcher, sha256 } from "./lib/load-matcher.mjs";
import { loadDialog } from "./lib/load-dialog.mjs";
import { ratio, sameSlots } from "./lib/scoring.mjs";
import { scoreSeparate, summarizeSeparate } from "./lib/separate-metrics.mjs";

let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden"); };
const baseline = JSON.parse(readFileSync("eval/results/text-baseline.json", "utf8"));
assert.equal(sha256(JSON.stringify(TEXT_CASES)), baseline.corpusHash);
const { matchUtterance, sourceFingerprint } = loadMatcher();
const { runSmartTurn, emptyTurnCounts, countTurn, redactPhoneNumbers } = loadDialog();
const baselineById = new Map(baseline.cases.map((row) => [row.id, row]));
const cases = STRICT_SLOT_CASES.map((row) => {
  const original = exactSlots(baselineById.get(row.id).actual);
  const current = exactSlots(matchUtterance(row.text));
  return { ...row, original, current, originalPass: sameSlots(row.items, original), currentPass: sameSlots(row.items, current),
    originalSeparate: scoreSeparate(row.items, original), currentSeparate: scoreSeparate(row.items, current) };
});
const counts = emptyTurnCounts();
const fallback = [];
const previousFallbacks = [];
for (const row of TEXT_CASES) {
  const result = await runSmartTurn(undefined, row.text, [], { provider: null, onRouting: (event) => countTurn(counts, event) });
  if (FALLBACK_REASONS[row.id]) previousFallbacks.push({ id: row.id, utterance: redactPhoneNumbers(row.text),
    previousWhy: FALLBACK_REASONS[row.id], currentRoute: result.routing.route });
  if (result.routing.route !== "llm_needed") continue;
  assert.ok(FALLBACK_REASONS[row.id], `Unexplained fallback: ${row.id}`);
  fallback.push({ id: row.id, utterance: redactPhoneNumbers(row.text), why: FALLBACK_REASONS[row.id], outcome: result.routing.outcome });
}
assert.equal(networkAttempts, 0);
const misses = cases.filter((row) => !row.originalPass || !row.currentPass);
const report = {
  kind: "strict-slot-text-audit-v1", corpusHash: baseline.corpusHash,
  strictLabelsHash: sha256(JSON.stringify(STRICT_SLOT_CASES)),
  originalSourceFingerprint: baseline.sourceFingerprint, currentSourceFingerprint: sourceFingerprint,
  originalPredictions: "Saved original baseline predictions, not rerun or reconstructed original source",
  development: { corpusCases: TEXT_CASES.length, supportedCases: cases.length,
    original: ratio(cases.filter((row) => row.originalPass).length, cases.length),
    current: ratio(cases.filter((row) => row.currentPass).length, cases.length) },
  heldOut: { evaluatedCases: 0, original: null, current: null, reason: "No pre-existing held-out text split; all frozen phrases were known development cases" },
  plannedAudio: { development: 60, heldOut: 40, measuredRecordings: 0, speakers: RECORDING_PLAN.targetSpeakers },
  scoring: "Exact item multiset, quantity, protein and portion on supported requests; explicit null means unspecified, never a wildcard. Any missed/extra item fails the entire utterance.",
  exclusions: { clarification: 5, unavailable: 4, noMenuMention: 10 },
  limitations: [
    "Supplemental explicit protein/portion labels are a new audit, applied identically to saved original predictions and current predictions. The original scorer and labels are untouched.",
    "Unspecified variants count as correctly extracted only if left unspecified; that is not a complete order or a resolved variant.",
    "All known synthetic text is development data. A retrospective split cannot establish held-out generalization.",
    "Fallbacks are routing gaps, not proof that a model is necessary; each case starts with an empty open state.",
  ],
  separateMetrics: { original: summarizeSeparate(cases.map((row) => row.originalSeparate)),
    current: summarizeSeparate(cases.map((row) => row.currentSeparate)) },
  metricDefinitions: { dish: "Exact dish/protein/portion multiset, ignoring quantity",
    quantity: "Exact mention-count and quantity vector in spoken order, ignoring dish identity; includes default one",
    joint: "Dish, quantity, protein and portion all exact" },
  routing: counts, fallback, previousFallbacks, misses, cases, networkAttempts,
};
mkdirSync("eval/results", { recursive: true });
writeFileSync("eval/results/text-audit.json", JSON.stringify(report, null, 2) + "\n");
const fraction = (value) => value ? `${value.numerator}/${value.denominator} (${value.percent}%)` : "not measured";
const describe = (items) => items.map((item) => `${item.qty} x ${item.itemId} [protein=${item.protein ?? "unspecified"}; portion=${item.portion ?? "unspecified"}]`).join("; ") || "none";
const markdown = [
  "# Strict slot accuracy and fallback audit", "",
  "Frozen 100-case synthetic text corpus. No genuine held-out text split exists. Original predictions come from the saved original baseline; current predictions are recomputed locally.", "",
  "| Split | Total corpus cases | Supported requests | Original | Current |",
  "| --- | ---: | ---: | --- | --- |",
  `| Development | 100 | ${cases.length} | ${fraction(report.development.original)} | ${fraction(report.development.current)} |`,
  "| Held out | 0 | 0 | not measured | not measured |", "",
  report.scoring, "",
  "Five clarification, four unavailable and ten no-menu-mention cases are outside dish/slot identification accuracy; they are not counted as correct orders.", "",
  "The planned 60/40 split belongs to future speaker recordings, not these 100 text cases. Actual audio evaluated: zero.", "",
  "## Every original or current miss", "",
  "| Input | Expected | Original | Current |", "| --- | --- | --- | --- |",
  ...misses.map((row) => `| ${row.text} | ${describe(row.items)} | ${describe(row.original)} | ${describe(row.current)} |`), "",
  "## Dish and quantity measured separately", "",
  "| Metric | Original | Current |", "| --- | --- | --- |",
  ...["dish", "quantity", "joint"].map((key) => `| ${key} | ${fraction(report.separateMetrics.original[key])} | ${fraction(report.separateMetrics.current[key])} |`), "",
  ...Object.entries(report.metricDefinitions).map(([key, value]) => `- ${key}: ${value}`), "",
  "## Six previous fallback turns", "",
  "| Utterance | Previous local gap | Current route |", "| --- | --- | --- |",
  ...previousFallbacks.map((row) => `| ${row.utterance} | ${row.previousWhy} | ${row.currentRoute} |`), "",
  "## Limits", "", ...report.limitations.map((note) => `- ${note}`), "",
  "Run `npm run eval:audit`. Provider is explicitly disabled and network is blocked.", "",
].join("\n");
writeFileSync("eval/results/text-audit.md", markdown);
console.log(`Strict development: original ${fraction(report.development.original)}; current ${fraction(report.development.current)}`);
console.log("Held out: not measured (0 cases); planned audio split is not a text test split.");
console.log(`Misses: original ${cases.filter((row) => !row.originalPass).length}; current ${cases.filter((row) => !row.currentPass).length}`);
console.log(`Fallback turns: ${fallback.length}; actual provider requests: ${networkAttempts}`);
console.log(`Separate dish: original ${fraction(report.separateMetrics.original.dish)}; current ${fraction(report.separateMetrics.current.dish)}`);
console.log(`Separate quantity: original ${fraction(report.separateMetrics.original.quantity)}; current ${fraction(report.separateMetrics.current.quantity)}`);
console.log("Report: eval/results/text-audit.md");
