import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TEXT_CASES } from "../eval/text-cases.mjs";
import { ROUTING_SCENARIOS } from "../eval/routing-cases.mjs";
import { loadDialog } from "./lib/load-dialog.mjs";
import { sha256 } from "./lib/load-matcher.mjs";

// Hard block: this evaluator never loads dotenv or invokes a live provider.
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden in routing evaluation"); };
const { runSmartTurn, emptyTurnCounts, countTurn, redactPhoneNumbers, fingerprint } = loadDialog();
const baseline = JSON.parse(readFileSync("eval/results/text-baseline.json", "utf8"));
assert.equal(sha256(JSON.stringify(TEXT_CASES)), baseline.corpusHash, "Frozen corpus changed");

async function evaluate(scenarios) {
  const counts = emptyTurnCounts();
  const cases = [];
  for (const scenario of scenarios) {
    let state;
    for (let index = 0; index < scenario.turns.length; index++) {
      const turn = scenario.turns[index];
      const result = await runSmartTurn(state, turn.text, [], {
        provider: null,
        onRouting: (event) => countTurn(counts, event),
      });
      assert.equal(result.state.turns, (state?.turns ?? 0) + 1, "Count exactly once per turn");
      state = result.state;
      cases.push({ id: `${scenario.id}/${index + 1}`, input: redactPhoneNumbers(turn.text), ...result.routing,
        ...(turn.route ? { expectedRoute: turn.route, pass: result.routing.route === turn.route } : {}) });
    }
  }
  return { scenarioCount: scenarios.length, ...counts, cases };
}

const frozen = await evaluate(TEXT_CASES.map((row) => ({ id: row.id, turns: [{ text: row.text }] })));
const supplemental = await evaluate(ROUTING_SCENARIOS);
assert.equal(networkAttempts, 0);
assert.ok(supplemental.cases.every((row) => row.pass), "Supplemental routing expectation failed");
const report = {
  kind: "synthetic-offline-turn-routing", corpusHash: baseline.corpusHash, sourceFingerprint: fingerprint,
  frozen, supplemental, networkAttempts, measuredHumanSpeakers: 0, measuredAudioUtterances: 0,
  limitations: [
    "Local means a deterministic handler returned a reply or clarification, not independently verified conversation success.",
    "LLM needed means the fallback boundary was reached; disabled-provider replies are not counted as locally resolved.",
    "No LLM output quality, provider latency, live traffic or cost per call was measured.",
    "Frozen rows start independent conversations; supplemental scenarios include eight turns across three short conversations.",
  ],
};
mkdirSync("eval/results", { recursive: true });
writeFileSync("eval/results/text-routing.json", JSON.stringify(report, null, 2) + "\n");
const md = [
  "# Local versus LLM routing", "",
  "Offline, synthetic text only. Provider explicitly disabled; network blocked. The frozen Day 1 corpus and baseline remain unchanged.", "",
  "| Dataset | Turns | Local handler | LLM needed | API attempts |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...[["Frozen corpus", frozen], ["Additional routing scenarios", supplemental]].map(([name, row]) =>
    `| ${name} | ${row.turns} | ${row.localResolved} | ${row.llmNeeded} | ${row.llmAttempted} |`), "",
  `Additional expected routes: ${supplemental.cases.filter((row) => row.pass).length}/${supplemental.turns}.`, "",
  "## Frozen cases reaching the LLM boundary", "",
  ...frozen.cases.filter((row) => row.route === "llm_needed").map((row) => `- ${row.id}: ${row.input}`), "",
  ...report.limitations.map((note) => `- ${note}`), "",
  "Reproduce with `npm run eval:routing`. Runtime emits one `turn_routing` JSON log per turn with process totals; counts reset on restart and are separate across server processes.", "",
].join("\n");
writeFileSync("eval/results/text-routing.md", md);
for (const [name, row] of [["Frozen 100", frozen], ["Supplemental", supplemental]]) {
  console.log(`${name}: ${row.turns} turns; ${row.localResolved} local; ${row.llmNeeded} need LLM; ${row.llmAttempted} API attempts`);
}
console.log(`Supplemental route expectations: ${supplemental.cases.filter((row) => row.pass).length}/${supplemental.turns}`);
console.log("Report: eval/results/text-routing.md");
