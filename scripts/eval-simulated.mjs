import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { SIMULATED_STT_CASES } from "../eval/simulated-stt-cases.mjs";
import { loadMatcher, sha256 } from "./lib/load-matcher.mjs";
import { scoreSeparate, summarizeSeparate } from "./lib/separate-metrics.mjs";

globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const { matchUtterance, analyzeUtterance, sourceFingerprint } = loadMatcher();
assert.equal(SIMULATED_STT_CASES.length, 20);
const cases = SIMULATED_STT_CASES.map((row) => {
  const actual = matchUtterance(row.text);
  const analysis = analyzeUtterance(row.text);
  const issue = analysis.issues[0];
  return { ...row, actual: actual.map(({ itemId, qty, protein, portion }) => ({ itemId, qty, protein, portion })),
    ...scoreSeparate(row.items, actual), route: issue ? "clarify" : analysis.matches.length ? "matched" : "unrecognized",
    clarification: issue?.question ?? null,
    expectedCandidatePresent: issue?.candidates.some((candidate) => row.items.some((item) => item.itemId === candidate.itemId)) ?? false };
});
const report = { kind: "simulated-stt-development-only", simulated: true, corpusHash: sha256(JSON.stringify(SIMULATED_STT_CASES)),
  sourceFingerprint, measuredSpeakers: 0, measuredAudio: 0, providerCalls: 0, cases: cases.length,
  metrics: summarizeSeparate(cases), clarificationTurns: cases.filter((row) => row.route === "clarify").length,
  unrecognizedTurns: cases.filter((row) => row.route === "unrecognized").length, rows: cases,
  definitions: { dish: "Exact dish/protein/portion multiset, ignoring quantity", quantity: "Exact mention-count and quantity vector in spoken order, ignoring dish identity", joint: "Dish, quantity, protein and portion all exact" } };
mkdirSync("eval/results", { recursive: true });
writeFileSync("eval/results/text-simulated.json", JSON.stringify(report, null, 2) + "\n");
const fraction = (m) => `${m.numerator}/${m.denominator} (${m.percent}%)`;
const md = ["# Simulated speech-recognition errors", "",
  "20 author-created development cases. All tagged simulated. No actual speech engine, speakers, audio or provider requests. These are not held-out accent results.", "",
  `Dish identification: **${fraction(report.metrics.dish)}**. Quantity vector: **${fraction(report.metrics.quantity)}**. Joint: **${fraction(report.metrics.joint)}**.`, "",
  `Clarification turns: ${report.clarificationTurns}; unrecognized: ${report.unrecognizedTurns}. Top-one extraction metrics are not increased by a safe clarification.`, "",
  "| Simulated transcript | Dish | Quantity | Handling |", "| --- | --- | --- | --- |",
  ...cases.map((row) => `| ${row.text} | ${row.dish ? "pass" : "MISS"} | ${row.quantity ? "pass" : "MISS"} | ${row.clarification ?? row.route} |`), "",
  ...Object.entries(report.definitions).map(([key, value]) => `- ${key}: ${value}`), "",
  "Reproduce with `npm run eval:simulated`. No tuning on these results was performed in this pass.", ""].join("\n");
writeFileSync("eval/results/text-simulated.md", md);
console.log(`Simulated STT: dish ${fraction(report.metrics.dish)}; quantities ${fraction(report.metrics.quantity)}; joint ${fraction(report.metrics.joint)}`);
console.log(`Clarify ${report.clarificationTurns}; unrecognized ${report.unrecognizedTurns}; actual audio 0; provider requests 0`);
console.log("Report: eval/results/text-simulated.md");
