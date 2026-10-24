import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TEXT_CASES } from "../eval/text-cases.mjs";
import { loadMatcher, sha256 } from "./lib/load-matcher.mjs";
import { mentionCounts, ratio, sameIds, sameSlots } from "./lib/scoring.mjs";

const args = process.argv.slice(2);
assert.ok(args.every((arg) => arg === "--baseline"), "Usage: npm run eval:text OR npm run eval:baseline");
const baselineMode = args.includes("--baseline");
const { matchUtterance, menu, sourceHashes, sourceFingerprint } = loadMatcher();
assert.equal(TEXT_CASES.length, 100, "Day 1 regression corpus must contain 100 cases");
assert.equal(new Set(TEXT_CASES.map((row) => row.id)).size, TEXT_CASES.length, "Duplicate case ID");
const menuIds = new Set(menu.map((item) => item.id));
for (const row of TEXT_CASES) {
  for (const item of row.expected.items ?? []) assert.ok(menuIds.has(item.itemId), `Invalid ground-truth ID in ${row.id}`);
  for (const id of row.expected.candidates ?? []) assert.ok(menuIds.has(id), `Invalid candidate ID in ${row.id}`);
}

const cases = TEXT_CASES.map((row) => {
  const actual = matchUtterance(row.text).map(({ itemId, qty, protein, portion, heard, score }) => ({
    itemId, qty, ...(protein ? { protein } : {}), ...(portion ? { portion } : {}), heard, score,
  }));
  const disposition = row.expected.disposition;
  return {
    ...row,
    actual,
    itemExact: disposition === "match" ? sameIds(row.expected.items, actual) : null,
    slotExact: disposition === "match" ? sameSlots(row.expected.items, actual) : null,
    rejectionPass: ["ignore", "unavailable"].includes(disposition) ? actual.length === 0 : null,
    // A candidate alone is not a clarification question or an unavailable response.
    policyEvaluation: ["clarify", "unavailable"].includes(disposition) ? "not_supported_by_legacy_matcher" : "not_applicable",
  };
});

const supported = cases.filter((row) => row.expected.disposition === "match");
const rejected = cases.filter((row) => row.rejectionPass !== null);
const clarifications = cases.filter((row) => row.expected.disposition === "clarify");
const unavailable = cases.filter((row) => row.expected.disposition === "unavailable");
const counts = supported.reduce((totals, row) => {
  const result = mentionCounts(row.expected.items, row.actual);
  for (const key of Object.keys(result)) totals[key] += result[key];
  return totals;
}, { correct: 0, expected: 0, predicted: 0 });

const metrics = {
  supportedUtteranceItemExact: ratio(supported.filter((row) => row.itemExact).length, supported.length),
  supportedUtteranceSlotExact: ratio(supported.filter((row) => row.slotExact).length, supported.length),
  supportedMentionPrecision: ratio(counts.correct, counts.predicted),
  supportedMentionRecall: ratio(counts.correct, counts.expected),
  noMenuMentionOrUnavailableRejection: ratio(rejected.filter((row) => row.rejectionPass).length, rejected.length),
  clarificationCases: clarifications.length,
  clarificationPolicy: "not measured: current matcher has no clarification interface",
  unavailableCases: unavailable.length,
  unavailableResponsePolicy: "not measured: no conversational response is evaluated",
};

const categoryMetrics = [...new Set(cases.map((row) => row.category))].map((category) => {
  const rows = cases.filter((row) => row.category === category);
  const positive = rows.filter((row) => row.itemExact !== null);
  const negative = rows.filter((row) => row.rejectionPass !== null);
  return {
    category, total: rows.length,
    itemExact: ratio(positive.filter((row) => row.itemExact).length, positive.length),
    slotExact: ratio(positive.filter((row) => row.slotExact).length, positive.length),
    rejection: ratio(negative.filter((row) => row.rejectionPass).length, negative.length),
    policyCasesNotMeasured: rows.filter((row) => row.policyEvaluation === "not_supported_by_legacy_matcher").length,
  };
});

const report = {
  schemaVersion: 1,
  kind: "synthetic-text-regression",
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  sourceHashes,
  sourceFingerprint,
  corpusHash: sha256(JSON.stringify(TEXT_CASES)),
  evaluatorHashes: Object.fromEntries(["scripts/eval-text.mjs", "scripts/lib/scoring.mjs", "scripts/lib/load-matcher.mjs"]
    .map((file) => [file, sha256(readFileSync(file))])),
  sample: { syntheticTextCases: cases.length, humanSpeakersMeasured: 0, audioUtterancesMeasured: 0, menuItems: menu.length },
  limitations: [
    "Synthetic regression corpus with known phrases; not a held-out speech/accent evaluation.",
    "Only matchUtterance is evaluated. No dialog, order submission, read-back, prices, LLM, STT, or TTS is evaluated.",
    "Item exactness requires all expected IDs and no extras. Slot exactness additionally requires quantity and all explicitly annotated fields.",
    "Precision and recall cover supported-item cases only; negatives and ambiguous requests are reported separately.",
    "No real-time latency, phone calls, API usage, or provider authentication is measured.",
    "Clarification and unavailable-response policies are unsupported by this matcher interface, not counted as successful responses.",
  ],
  metrics,
  categoryMetrics,
  cases,
};

const baselinePath = path.resolve("eval/results/text-baseline.json");
const output = baselineMode ? baselinePath : path.resolve(".data/reports/text-current.json");
mkdirSync(path.dirname(output), { recursive: true });
if (baselineMode && existsSync(output)) {
  const original = JSON.parse(readFileSync(output, "utf8"));
  const identity = (value) => JSON.stringify({ sourceHashes: value.sourceHashes, corpusHash: value.corpusHash, evaluatorHashes: value.evaluatorHashes, metrics: value.metrics, cases: value.cases });
  assert.equal(identity(original), identity(report), "Frozen baseline differs. Do not overwrite it; use npm run eval:text for the current matcher.");
  console.log("Frozen baseline reproduced; original artifacts left unchanged.");
} else {
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: baselineMode ? "wx" : "w" });
  if (baselineMode) {
    const fraction = (value) => value ? `${value.numerator}/${value.denominator} (${value.percent}%)` : "not applicable";
    const rows = categoryMetrics.map((row) => `| ${row.category} | ${row.total} | ${fraction(row.itemExact)} | ${fraction(row.slotExact)} | ${fraction(row.rejection)} | ${row.policyCasesNotMeasured} |`);
    const failures = cases.filter((row) => row.itemExact === false || row.slotExact === false || row.rejectionPass === false);
    const describe = (items) => items.length ? items.map((item) => `${item.qty ?? 1} x ${item.itemId}${item.protein ? ` (${item.protein})` : ""}${item.portion ? ` ${item.portion}` : ""}`).join("; ") : "no match";
    const failureRows = failures.map((row) => `| ${row.id} | ${row.text} | ${row.expected.disposition === "match" ? describe(row.expected.items) : "no menu match"} | ${describe(row.actual)} |`);
    const markdown = [
      "# Day 1: unchanged matcher baseline", "",
      "100 synthetic text cases. Actual human speakers: **0**. Actual audio recordings: **0**. No API calls.", "",
      `Menu entries: ${menu.length}. Source fingerprint: \`${sourceFingerprint}\`.`, "",
      `- Exact item sets on supported requests: **${fraction(metrics.supportedUtteranceItemExact)}**`,
      `- Exact quantities and explicitly annotated slots: **${fraction(metrics.supportedUtteranceSlotExact)}**`,
      `- Supported-item mention precision: ${fraction(metrics.supportedMentionPrecision)}`,
      `- Supported-item mention recall: ${fraction(metrics.supportedMentionRecall)}`,
      `- No-match behavior on no-menu/unavailable requests: ${fraction(metrics.noMenuMentionOrUnavailableRejection)}`, "",
      "## Categories", "",
      "| Category | Cases | Exact item sets | Exact annotated slots | Rejection | Policy unmeasured |",
      "| --- | ---: | --- | --- | --- | ---: |", ...rows, "",
      "## Failed extraction / rejection cases", "",
      "| Case | Input | Expected | Actual |", "| --- | --- | --- | --- |", ...failureRows, "",
      "## Interpretation", "",
      ...report.limitations.map((note) => `- ${note}`), "",
      "Ambiguous cases and their raw predictions are included in the JSON report. Correctly retrieving a candidate does not establish that the agent asked for confirmation.", "",
      "Reproduce with `npm run eval:baseline`. Use `npm run eval:text` for subsequent implementations; it never replaces this baseline.", "",
    ].join("\n");
    writeFileSync(path.resolve("eval/results/text-baseline.md"), markdown, { flag: "wx" });
  }
  console.log(`Report written: ${path.relative(process.cwd(), output)}`);
}

const format = (value) => value ? `${value.numerator}/${value.denominator} (${value.percent}%)` : "n/a";
console.log(`Synthetic text cases: ${cases.length}; human speakers: 0; audio utterances: 0; API calls: 0`);
console.log(`Exact supported item sets: ${format(metrics.supportedUtteranceItemExact)}`);
console.log(`Exact annotated slots: ${format(metrics.supportedUtteranceSlotExact)}`);
console.log(`Mention precision: ${format(metrics.supportedMentionPrecision)}; recall: ${format(metrics.supportedMentionRecall)}`);
console.log(`No-menu/unavailable rejection: ${format(metrics.noMenuMentionOrUnavailableRejection)}`);
console.log(`Clarification policy: not supported (${clarifications.length} cases); unavailable-response policy: not supported (${unavailable.length} cases)`);
for (const text of ["chicken Kirby", "paneer tikka", "pakoda", "chapli kabab"]) {
  const row = cases.find((entry) => entry.text === text);
  console.log(`${JSON.stringify(text)} -> ${row.actual.map((item) => item.itemId).join(", ") || "no match"}; expected ${row.expected.disposition}`);
}
if (!baselineMode && existsSync(baselinePath)) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (baseline.corpusHash !== report.corpusHash) {
    console.log("Corpus differs from the frozen baseline; scores must not be compared directly.");
  } else {
    const delta = metrics.supportedUtteranceSlotExact.percent - baseline.metrics.supportedUtteranceSlotExact.percent;
    console.log(`Annotated-slot change vs baseline: ${delta.toFixed(2)} percentage points`);
  }
}
