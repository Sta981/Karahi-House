import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MESSY_CASES } from "../eval/messy-cases.mjs";
import { loadDialog } from "./lib/load-dialog.mjs";
import { sha256 } from "./lib/load-matcher.mjs";
import { sameSlots } from "./lib/scoring.mjs";

let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden"); };
const { runSmartTurn, fingerprint, emptyTurnCounts, countTurn } = loadDialog();
const routing = emptyTurnCounts();
const normalizeCart = (cart) => cart.map((line) => ({ itemId: line.itemId, qty: line.qty, variantLabel: line.variantLabel ?? null }));
assert.equal(MESSY_CASES.length, 10);
const cases = [];
for (const scenario of MESSY_CASES) {
  let state;
  const turns = [];
  for (const turn of scenario.turns) {
    const result = await runSmartTurn(state, turn.text, [], { provider: null, onRouting: (event) => countTurn(routing, event) });
    state = result.state;
    const actual = normalizeCart(state.cart);
    const pass = sameSlots(turn.cart, actual) && (turn.clarification ? Boolean(state.recognition) : !state.pending && !state.recognition) && !state.needsReview && !result.summary && !result.endCall;
    turns.push({ input: turn.text, expected: turn.cart, expectedClarification: Boolean(turn.clarification), actual, pass, reply: result.reply, routing: result.routing,
      pending: Boolean(state.pending || state.recognition), needsReview: Boolean(state.needsReview) });
  }
  cases.push({ id: scenario.id, tags: scenario.tags, pass: turns.every((turn) => turn.pass), turns });
}
assert.equal(networkAttempts, 0);
const report = {
  kind: "additional-messy-development-conversations", sourceFingerprint: fingerprint,
  datasetHash: sha256(JSON.stringify(MESSY_CASES)), datasetFileHash: sha256(readFileSync("eval/messy-cases.mjs")),
  scenarioCount: cases.length, turnCount: routing.turns, passedScenarios: cases.filter((row) => row.pass).length,
  passedTurns: cases.flatMap((row) => row.turns).filter((turn) => turn.pass).length,
  routing, networkAttempts, cases,
  limitations: ["New known development cases; not held out and not part of the frozen baseline.",
    "Scores test exact cart state after every turn, including protein/portion via the exact variant label; no partial credit.",
    "This command exits nonzero on misses so failures remain visible. No matcher/dialog fixes are made by the evaluator."],
};
mkdirSync("eval/results", { recursive: true });
writeFileSync("eval/results/text-messy.json", JSON.stringify(report, null, 2) + "\n");
const describe = (cart) => cart.map((line) => `${line.qty} x ${line.itemId}${line.variantLabel ? ` (${line.variantLabel})` : ""}`).join("; ") || "empty cart";
const markdown = [
  "# Ten additional messy development scenarios", "",
  `Exact scenario passes: **${report.passedScenarios}/${cases.length}**. Exact per-turn passes: **${report.passedTurns}/${report.turnCount}**. Real provider requests: **0**.`, "",
  "These are additional development cases, separate from the frozen 100. Corrections are conversational tests, not isolated matcher calls.", "",
  "| Case / turn | Utterance | Expected cart | Actual cart | Result |", "| --- | --- | --- | --- | --- |",
  ...cases.flatMap((row) => row.turns.map((turn, index) => `| ${row.id}/${index + 1} | ${turn.input} | ${describe(turn.expected)} | ${describe(turn.actual)} | ${turn.pass ? "pass" : "FAIL"} |`)), "",
  ...report.limitations.map((note) => `- ${note}`), "",
  "Run `npm run eval:messy`. Provider explicitly disabled; network blocked.", "",
].join("\n");
writeFileSync("eval/results/text-messy.md", markdown);
console.log(`Messy scenarios: ${report.passedScenarios}/${cases.length}; exact turns: ${report.passedTurns}/${report.turnCount}; provider requests: ${networkAttempts}`);
for (const row of cases.filter((row) => !row.pass)) {
  for (const turn of row.turns.filter((turn) => !turn.pass)) console.log(`MISS ${row.id}: ${turn.input}\n  expected ${describe(turn.expected)}\n  actual   ${describe(turn.actual)}`);
}
console.log("Report: eval/results/text-messy.md");
if (report.passedScenarios !== cases.length) process.exitCode = 1;
