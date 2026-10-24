import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TEXT_CASES } from "../eval/text-cases.mjs";
import { STRICT_SLOT_CASES } from "../eval/strict-slot-labels.mjs";
import { MESSY_CASES } from "../eval/messy-cases.mjs";
import { SIMULATED_STT_CASES } from "../eval/simulated-stt-cases.mjs";
import { CURRENT_TEXT_CASES, CURRENT_MESSY_CASES, CURRENT_SIMULATED_CASES, MENU_CASE_CHANGES, FOLLOWUP_LABEL_CHANGES } from "../eval/menu-current-cases.mjs";
import { loadVersion } from "./lib/load-version.mjs";
import { scoreSeparate, summarizeSeparate } from "./lib/separate-metrics.mjs";
import { sameSlots, ratio } from "./lib/scoring.mjs";
import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["scripts/import-menu.mjs", "--check"], { stdio: ["ignore", "pipe", "pipe"] });

// Deliberately no globbing: never discover or load held-out files/attachments.
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden"); };
const strict = new Map(STRICT_SLOT_CASES.map((row) => [row.id, row.items]));
const previousCases = JSON.parse(readFileSync("eval/archive/previous-menu/cases.json", "utf8"));
const oldRows = TEXT_CASES.map((row) => ({ ...row, expected: row.expected.disposition === "match" ?
  { ...row.expected, items: strict.get(row.id) } : row.expected }));

async function runVersion(version) {
  const api = loadVersion(version);
  const texts = version === "previous" ? previousCases.text : CURRENT_TEXT_CASES;
  const messy = version === "previous" ? previousCases.messy : CURRENT_MESSY_CASES;
  const simulated = version === "previous" ? previousCases.simulated : CURRENT_SIMULATED_CASES;
  const routing = api.emptyTurnCounts();
  const rows = [];
  for (const row of texts) {
    const actual = api.matchUtterance(row.text);
    const analysis = api.analyzeUtterance(row.text);
    const turn = await api.runSmartTurn(undefined, row.text, [], { provider: null, onRouting: (event) => api.countTurn(routing, event) });
    const expected = row.expected;
    const issue = analysis.issues[0];
    const policyPass = expected.disposition === "ignore" ? analysis.matches.length === 0 && !issue :
      ["unavailable", "clarify"].includes(expected.disposition) ? issue?.kind === expected.disposition &&
        (!expected.candidates || sameSlots(expected.candidates.map((itemId) => ({ itemId })), issue.candidates)) && turn.state.cart.length === 0 : null;
    rows.push({ id: row.id, text: api.redactPhoneNumbers(row.text), expected, actual,
      ...(expected.disposition === "match" ? scoreSeparate(expected.items, actual) : {}),
      policyPass, handling: issue?.kind ?? (turn.state.needsReview ? "staff_review" : "local"), reply: turn.reply });
  }
  const positive = rows.filter((row) => row.expected.disposition === "match");
  const policies = rows.filter((row) => row.policyPass !== null);
  const scenarios = [];
  for (const row of messy) {
    let state;
    const turns = [];
    for (const turn of row.turns) {
      const result = await api.runSmartTurn(state, turn.text, [], { provider: null, onRouting: () => {} });
      state = result.state;
      const cart = state.cart.map(({itemId,qty,variantLabel,spiceLevel}) => ({itemId,qty,variantLabel:variantLabel ?? null,...(version === "new" ? {spiceLevel:spiceLevel ?? null} : {})}));
      const pass = turn.expectedUnavailable ? state.recognition?.issues[0]?.kind === "unavailable" && state.cart.length === 0 :
        sameSlots(turn.cart, cart) && (turn.clarification ? Boolean(state.recognition) : !state.recognition && !state.pending) &&
        (!turn.phase || state.phase === turn.phase) && !state.needsReview && !result.summary;
      turns.push({ text: turn.text, expected: turn.cart, actual: cart, expectedUnavailable: Boolean(turn.expectedUnavailable), pass, reply: result.reply });
    }
    scenarios.push({ id: row.id, pass: turns.every((turn) => turn.pass), turns });
  }
  const simulations = simulated.map((row) => {
    const actual = api.matchUtterance(row.text);
    const analysis = api.analyzeUtterance(row.text);
    const expectedDisposition = row.expectedDisposition ?? "match";
    const extractScored = expectedDisposition === "match";
    return { id: row.id, text: row.text, simulated: true, retired: Boolean(row.retired), expected: row.items, ...(row.candidateItems?{candidateItems:row.candidateItems}:{}), actual, expectedDisposition, extractScored,
      ...(extractScored ? scoreSeparate(row.items, actual) : {}), handling: analysis.issues[0]?.kind ?? (analysis.matches.length ? "matched" : "unrecognized"),
      policyPass: extractScored ? null : analysis.issues[0]?.kind === expectedDisposition && (!row.candidateItems || sameSlots(row.candidateItems.map(item=>({itemId:item.itemId,protein:item.protein})),analysis.issues[0].candidates.map(item=>({...item,protein:item.protein??null})))),
      unavailablePass: row.retired ? analysis.issues[0]?.kind === "unavailable" : null };
  });
  return { version, sourceFingerprint: api.fingerprint, menuItems: api.MENU.length,
    dev: { cases: rows.length, supported: positive.length, metrics: summarizeSeparate(positive), policy: ratio(policies.filter((row) => row.policyPass).length, policies.length),
      routing, rows, misses: rows.filter((row) => row.expected.disposition === "match" ? !row.joint : !row.policyPass) },
    messy: { scenarios: scenarios.length, passed: scenarios.filter((row) => row.pass).length,
      turns: scenarios.flatMap((row) => row.turns).length, passedTurns: scenarios.flatMap((row) => row.turns).filter((turn) => turn.pass).length, rows: scenarios },
    simulated: { cases: simulations.length, supported: simulations.filter((row) => row.extractScored).length,
      metrics: summarizeSeparate(simulations.filter((row) => row.extractScored)),
      policy: ratio(simulations.filter((row) => row.policyPass === true).length, simulations.filter((row) => row.policyPass !== null).length),
      unavailable: ratio(simulations.filter((row) => row.retired && row.unavailablePass).length, simulations.filter((row) => row.retired).length), rows: simulations } };
}

const results = { oldMenu: await runVersion("previous"), newMenu: await runVersion("new") };
const oldPositiveIds = new Set(results.oldMenu.dev.rows.filter(row => row.expected.disposition === "match").map(row=>row.id));
const oldSimPositiveIds = new Set(results.oldMenu.simulated.rows.filter(row=>row.extractScored).map(row=>row.id));
const sharedDevIds = new Set(results.newMenu.dev.rows.filter((row) => row.expected.disposition === "match" && oldPositiveIds.has(row.id)).map((row) => row.id));
const sharedSimIds = new Set(results.newMenu.simulated.rows.filter((row) => row.extractScored && oldSimPositiveIds.has(row.id)).map((row) => row.id));
const sharedSupported = { development: {
  old: summarizeSeparate(results.oldMenu.dev.rows.filter((row) => sharedDevIds.has(row.id))), new: summarizeSeparate(results.newMenu.dev.rows.filter(row=>sharedDevIds.has(row.id))) },
  simulated: { old: summarizeSeparate(results.oldMenu.simulated.rows.filter((row) => sharedSimIds.has(row.id))), new: summarizeSeparate(results.newMenu.simulated.rows.filter(row=>sharedSimIds.has(row.id))) } };
const beforeFollowups=JSON.parse(readFileSync("eval/archive/final-menu-before-followups/report.json","utf8")).newMenu;
const commonSim=new Set(results.newMenu.simulated.rows.filter(row=>row.extractScored).map(row=>row.id));
const followupComparison={source:"eval/archive/final-menu-before-followups/report.json",labelChanges:FOLLOWUP_LABEL_CHANGES,
  sharedSimulated:{before:summarizeSeparate(beforeFollowups.simulated.rows.filter(row=>row.extractScored&&commonSim.has(row.id))),after:results.newMenu.simulated.metrics}};
assert.equal(networkAttempts, 0);
const report = { kind: "menu-migration-development-comparison", heldOutAccessed: false, providerRequests: 0,
  oldBaselinePreserved: true, originalMenuSource: "eval/archive/previous-menu/lib/menu.ts", newMenuSource: "lib/menu-source.json",
  changes: MENU_CASE_CHANGES, sharedSupported, followupComparison, ...results,
  limitations: ["Known development text only; held-out attachment not opened, copied, parsed or run.",
    "Supported denominators differ: removed dishes are reclassified as unavailable and newly ambiguous names as clarification. Scores are not an apples-to-apples accuracy gain.",
    "Dish includes explicit protein/portion, ignores quantity. Quantity vector uses spoken mention order independently of dish identity and requires matching mention count.",
    "New menu uses supplied cents and size deltas. Six deltas are marked unverified; the menu is approved by the restaurant.",
    "Messy conversations now include a shared-spice reply; old has 14 turns and new has 24. This changes the task."] };
mkdirSync("eval/results", { recursive: true });
writeFileSync("eval/results/menu-migration-eval.json", JSON.stringify(report, null, 2) + "\n");
const fraction = (value) => value ? `${value.numerator}/${value.denominator} (${value.percent}%)` : "not applicable";
const md = ["# Old-menu versus new-menu development evaluation", "",
  "Old menu is the preceding 64-item catalog and exact archived engine/labels. New menu is the final 84-item website JSON. These are known development cases. No held-out file was accessed. No provider calls.", "",
  "| Menu / dataset | Cases | Supported dish requests | Dish/protein/portion | Quantity | Joint |", "| --- | ---: | ---: | --- | --- | --- |",
  ...Object.values(results).flatMap((row) => [["development",row.dev],["simulated ASR",row.simulated]].map(([suite,data]) =>
    `| ${row.version} / ${suite} | ${data.cases} | ${data.supported} | ${fraction(data.metrics.dish)} | ${fraction(data.metrics.quantity)} | ${fraction(data.metrics.joint)} |`)), "",
  ...Object.values(results).map((row) => `${row.version} messy: ${row.messy.passed}/${row.messy.scenarios} scenarios; ${row.messy.passedTurns}/${row.messy.turns} turns. Development policy: ${fraction(row.dev.policy)}. Local routing: ${row.dev.routing.localResolved}/${row.dev.routing.turns}.`), "",
  "## Same supported cases, both menus", "",
  "| Shared cohort | Old dish | New dish | Old quantity | New quantity |", "| --- | --- | --- | --- | --- |",
  ...Object.entries(sharedSupported).map(([name,data]) => `| ${name} | ${fraction(data.old.dish)} | ${fraction(data.new.dish)} | ${fraction(data.old.quantity)} | ${fraction(data.new.quantity)} |`), "",
  "Cohort membership and required modifiers changed; do not interpret differing percentages as a controlled recognition gain. Earlier 75-item results remain archived separately.", "",
  "## Explicit user-requested follow-up changes (not menu migration)", "",
  ...FOLLOWUP_LABEL_CHANGES.map(row=>`- ${row.suite} ${row.id}: ${row.reason}`),"",
  `Same ${commonSim.size} supported simulated cases before/after these fixes: dish ${fraction(followupComparison.sharedSimulated.before.dish)} → ${fraction(followupComparison.sharedSimulated.after.dish)}; quantity ${fraction(followupComparison.sharedSimulated.before.quantity)} → ${fraction(followupComparison.sharedSimulated.after.quantity)}; joint ${fraction(followupComparison.sharedSimulated.before.joint)} → ${fraction(followupComparison.sharedSimulated.after.joint)}.`,"",
  "Retrieval metrics may include candidates that still require confirmation. These are not completed-order or real-speaker accuracy scores.","",
  "## Changed development cases", "", "| Suite | ID | Input | Change |", "| --- | --- | --- | --- |",
  ...MENU_CASE_CHANGES.map((row) => `| ${row.suite} | ${row.id} | ${row.text ?? "see scenario"} | ${row.reason}; absent old IDs: ${row.absentOldIds.join(", ") || "none"}; final IDs: ${row.replacementIds.join(", ") || "clarification"} |`), "",
  "## Every new-menu development miss", "", ...results.newMenu.dev.misses.map((row) => `- ${row.id}: ${row.text}; expected ${row.expected.disposition}; handling ${row.handling}; joint=${row.joint ?? "not applicable"}; policy=${row.policyPass ?? "not applicable"}.`), "",
  "## Every new-menu simulated miss", "", ...results.newMenu.simulated.rows.filter((row) => row.extractScored ? !row.joint : !row.policyPass).map((row) =>
    `- ${row.id}: ${row.text}; ${!row.extractScored ? `expected ${row.expectedDisposition}; recognition policy failed` : `dish=${row.dish}; quantity=${row.quantity}; joint=${row.joint}`}; handling=${row.handling}.`), "",
  "## Every new-menu messy miss", "", ...results.newMenu.messy.rows.filter((row) => !row.pass).flatMap((row) => row.turns.filter((turn) => !turn.pass).map((turn) => `- ${row.id}: ${turn.text}; ${turn.reply}`)), "",
  ...report.limitations.map((note) => `- ${note}`), "", "Run `npm run eval:menu`. Historical baseline files and old-menu reports remain separate.", ""].join("\n");
writeFileSync("eval/results/menu-migration-eval.md", md);
writeFileSync("eval/results/menu-invalid-cases.md", ["# Final-menu development case migration", "",
  "Every changed availability label, absent former ID/candidate, and required modifier update is listed below. These are known development cases. No held-out access.", "",
  "Butter Chicken is not listed; it is no longer assumed equivalent to Butter Tikka Masala, whose protein is unspecified. This affects dev aliases-07 and simulated-07. Mutton is not silently assigned to Goat: dev aliases-13 now asks Goat or Lamb. Previous grouped karahi IDs are absent, so a protein-specific item must be selected. Several dishes previously marked unavailable are present again. All ten messy scenarios add an explicit shared-spice reply.", "",
  "The original 100 text phrases, 10 messy scenarios and 20 simulated phrases remain frozen. Only the reviewed label overlay and extra modifier replies change. Renaming an ID is not counted as dish removal.", "",
  "| Suite | ID | Input | Earlier → final | Invalid former IDs | Final IDs | Required update |", "| --- | --- | --- | --- | --- | --- | --- |",
  ...MENU_CASE_CHANGES.map(row=>`| ${row.suite} | ${row.id} | ${row.text} | ${row.oldDisposition} → ${row.newDisposition} | ${row.absentOldIds.join(", ") || "—"} | ${row.replacementIds.join(", ") || "—"} | ${row.reason} |`), ""].join("\n"));
for (const row of Object.values(results)) console.log(`${row.version}: dev dish ${fraction(row.dev.metrics.dish)}; quantity ${fraction(row.dev.metrics.quantity)}; joint ${fraction(row.dev.metrics.joint)}; messy ${row.messy.passed}/${row.messy.scenarios}; simulated dish ${fraction(row.simulated.metrics.dish)}; quantity ${fraction(row.simulated.metrics.quantity)}`);
console.log(`Changes: ${MENU_CASE_CHANGES.length}; provider requests 0; held-out accessed false. Report: eval/results/menu-migration-eval.md`);
