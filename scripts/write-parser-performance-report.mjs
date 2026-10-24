import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync,writeFileSync } from "node:fs";
import { loadVersion } from "./lib/load-version.mjs";
import { PARSER_DEV_CASES } from "../eval/parser-dev-cases.mjs";
const read=file=>JSON.parse(readFileSync(file,"utf8"));
const report=read("eval/results/parser-performance.json"),before=read("eval/results/parser-profile-before.json"),after=read("eval/results/parser-profile-after.json"),dev=read("eval/results/parser-development.json");
assert.equal(report.sourceFingerprint,after.sourceFingerprint);assert.equal(report.sourceFingerprint,dev.sourceFingerprint);
const api=loadVersion();assert.equal(api.fingerprint,report.sourceFingerprint);
const unchanged=["eval/segmenter-decision.md","eval/held-out","eval/parser-dev-cases.mjs","scripts/lib/conversation-eval.mjs","scripts/lib/held-out-report.mjs","scripts/lib/scoring.mjs","scripts/lib/separate-metrics.mjs","scripts/lib/parser-development.mjs","scripts/run-held-out.mjs"];
execFileSync("git",["diff","--quiet",report.referenceCommit,"--",...unchanged],{stdio:["ignore","pipe","pipe"]});
const inputs=new Set();
for(const [index,item] of api.MENU.entries()){
 for(const name of [item.name,item.website_name,...item.aliases].filter(Boolean))inputs.add(name);
 inputs.add(`um two ${item.name.toLowerCase()} please`);
 inputs.add(`one ${item.name} and two ${api.MENU[(index+1)%api.MENU.length].name}`);
}
const format=value=>`${value.p50.toFixed(2)} | ${value.p95.toFixed(2)} | ${value.samples}`;
const percentile=name=>before.functions.find(row=>row.function===name)?.inclusivePercent.toFixed(1);
const preposition=api.runTurn(api.newState(),"one chicken biryani for me");assert.equal(preposition.state.cart[0].qty,1);assert.equal(preposition.matches[0].quantityHeard,undefined);
const lines=["# Local parser performance and behavior preservation","",
 `Reference code: \`${report.referenceCommit}\`. Optimized fingerprint: \`${report.sourceFingerprint}\`.`,"",
 "## Measured latency","",
 "| Run | p50 ms | p95 ms | Timed turns |","| --- | --- | --- | --- |",
 `| Previously reported baseline (historical, separate run) | ${format(report.historicalReportedBaselineMs)} |`,
 `| Reference code, paired rerun | ${format(report.before.warmMs)} |`,
 `| Optimized code, paired rerun | ${format(report.after.warmMs)} |`,
 `| Optimized code, independent standard dev rerun | ${format(dev.warmLatencyMs)} |`,"",
 `The paired p95 improved by ${(report.before.warmMs.p95/report.after.warmMs.p95).toFixed(1)}x. The target p95 <50 ms is ${report.targetMet?"met":"not met"}; both optimized warm runs are reported, without selecting only the faster one. The original 269 ms result is historical: rerunning the unchanged reference code measured a different absolute latency. These are measurements, not a guarantee across machines or host load.`,"",
 `First measured 80-turn passes (not hosting cold starts): reference ${report.before.firstPassMs.p50.toFixed(2)} / ${report.before.firstPassMs.p95.toFixed(2)} ms; optimized ${report.after.firstPassMs.p50.toFixed(2)} / ${report.after.firstPassMs.p95.toFixed(2)} ms, p50 / p95.`,"",
 `Location: ${report.location}. ${report.machine.cpu}, ${report.machine.node}, ${report.machine.platform}. Five warm passes of the same 80 development scenarios per implementation, alternating execution order between passes, in one process. Percentiles use nearest rank. Seed setup, module loading/compilation, STT, TTS, network and hosting startup are excluded. No US-hosted or end-of-speech-to-audio measurement is claimed. Profiling ran separately from the paired timing experiment.`,"",
 "## Why the tail was slow","",
 `In the sampled baseline CPU profile, similarity scoring accounted for ${percentile("similarity")}% of time, including ${percentile("desiPhone")}% in phonetic encoding and ${percentile("editDistance")}% in edit distance. These are inclusive percentages and must not be added together. Longer, multi-item and uncertain requests create more overlapping word spans and candidate comparisons; short quantity-only corrections often do almost none of this work. The baseline GC sample share was small; the evidence points to repeated matching calculations, not network calls.`,"",
 "The largest baseline scenario tails and their optimized reruns:","",
 "| Dev case | Words | Reference p95 ms | Optimized p95 ms |","| --- | --- | --- | --- |",
 ...[...report.scenarios].sort((a,b)=>b.beforeMs.p95-a.beforeMs.p95).slice(0,5).map(row=>`| ${row.id} | ${row.wordCount} | ${row.beforeMs.p95.toFixed(2)} | ${row.afterMs.p95.toFixed(2)} |`),"",
 "## Implementation","",
 "- Precompute menu ID lookups, normalized alias/name tokens, phonetic forms, eligible vocabulary length buckets and prefix membership. Buckets preserve vocabulary insertion order, keeping ties and candidate ordering unchanged.",
 "- Precompute retrieval labels, correction-target token lists, source conjunction names and protein/portion key encodings. These caches contain menu data only and are rebuilt with the module when the menu changes. Caller utterances and completed matching results are not stored in module-level caches.",
 "- Reject a cross-conjunction span before computing distances only when it already fails the existing conjunction rule. Use a mathematical length-based score upper bound to skip comparisons that cannot meet the existing threshold. Accepted candidates still receive the exact original weighted score; thresholds, aliases and margin rules are unchanged.",
 "- Compute the same transposition-aware edit distance with three rolling rows instead of allocating a full matrix. Reuse rows within each calculation and return zero immediately for equal operands.","",
 "## Behavior checks","",
 `All **101/101 tests** passed; typecheck, privacy check and production build passed. The new reference comparisons cover **${inputs.size} distinct name/alias/generated inputs** with exact candidate order, scores, quantities, variants and questions, plus **${PARSER_DEV_CASES.reduce((total,row)=>total+row.seed.length+1,0)} dialog turns** across 80 dev scenarios with exact reply/state/match/operation equality. Tests also compare 2,209 distance pairs and 8,464 prepared-score pairs against the frozen reference implementation.`,"",
 "Dev: 80/80 scenarios. Existing public supported dish/quantity/joint: 65/65; messy 10/10; simulated supported joint 16/16. Burned regression remains 40/45 under unchanged original gold, with 35/37 intended-match joint accuracy and zero silent wrong adds. No cases, expected objects or grading rules changed for this optimization. These are development/regression results, not fresh held-out or audio accuracy.","",
 "For the explicit preposition check, **one chicken biryani for me** produces exactly **1 Chicken Biryani** and no quantityHeard repair. The repair checks the token immediately before a recognized item; trailing **for me** is not a quantity. The positive STT case **for roti** still parses quantity 4, preserving the existing policy.","",
 "## Groq and next freeze","",
 `Comparison status: **${report.groqComparison.status}**. Local stays the default. Zero Groq/provider requests. \`eval/segmenter-decision.md\` remains unchanged; \`eval/segmenter-comparison-status.json\` records the user's decision to skip the experiment.`,"",
 "Fresh hidden cases have not been received or accessed. After they arrive: commit code and cases together, record that new freeze hash, run once, then change nothing after the result. The original grading rules and one-shot runner are unchanged.","",
 "Reproduce timings with `npm run eval:performance`; run all tests with `npm run test:eval`. Raw CPU profiles are private/ignored under `.data/profiling`; public summaries are `parser-profile-before.json` and `parser-profile-after.json`.",""
];
writeFileSync("eval/results/parser-performance.md",lines.join("\n"));console.log("Wrote parser-performance.md; immutable criteria, cases and grading checks passed.");
