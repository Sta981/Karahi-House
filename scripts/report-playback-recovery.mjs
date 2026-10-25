import {readFileSync,writeFileSync} from "node:fs";
const read=name=>JSON.parse(readFileSync(`eval/results/${name}.json`,"utf8"));
const report=read("voice-latency-30"),before=read("tts-chunks-before"),after=read("tts-chunks-after"),access=read("voice-access"),budgets=read("engine-budget-stability");
if(report.summary.some(row=>row.attempted!==30))throw Error("Do not publish provisional thirty-turn results");
const n=value=>typeof value==="number"?value.toFixed(0):"n/a",pair=value=>`${n(value.p50)} / ${n(value.p95)}`;
const pct=values=>{const sorted=values.filter(Number.isFinite).toSorted((a,b)=>a-b);return {n:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]};};
const attempts=report.rows.flatMap(row=>row.generations??[]).flatMap(row=>row.telemetry??[]).filter(row=>row.type==="attempt_end");
const connections=report.rows.flatMap(row=>row.generations??[]).flatMap(row=>row.telemetry??[]).filter(row=>row.type==="transport"&&typeof row.reused==="boolean");
const chunkRows=report.rows.flatMap(row=>row.generations??[]).flatMap(generation=>{
 const seen=new Set();return (generation.telemetry??[]).filter(event=>{if(event.type!=="raw_chunk")return false;const key=`${event.part}:${event.attempt}`;if(!seen.has(key)){seen.add(key);return false;}return true;});
});
const faults=report.rows.filter(row=>row.failure||row.errors?.length||!row.finished);
const baselineFault=read("voice-latency-30-total-deadline");
const healthyTimeout=baselineFault.rows.filter(row=>row.errors?.some(error=>error.code==="tts_failed")).map(row=>`${row.model}/${row.id}`).join(", ");
const output=`# Playback recovery, access control and measured latency

Lahore local laptop, 2026-10-25. Measured audio-layer source: ${report.sourceCommit}. Real Deepgram STT and Aura-2 HTTP; fixed synthetic inputs spoken by Microsoft Zira Desktop. No human accent accuracy, acoustic loopback latency or US-hosted result is claimed. No recordings or transcripts are persisted by the voice server. Held-out cases and grading rules were not read, changed or run.

## What caused the gaps and timeout

The old cache could play a short fragment such as Added before the remote sentence tail was ready. A fast first byte hid that pause. The initial three provider browser turns completed two replies with 1.4–2.9 second scheduled gaps; the third request timed out.

Before changing transport, six real requests (three raw and three cached) were traced. Raw first-byte times were ${before.rows.filter(row=>row.mode==="raw").map(row=>n(row.firstByteMs)).join(", ")} ms; raw total times were ${before.rows.filter(row=>row.mode==="raw").map(row=>n(row.totalMs)).join(", ")} ms. These are different requests with variable cloud/network timings, not a paired speed claim.

Current raw per-chunk/request diagnostics are retained in tts-chunks-after.json and the final per-turn ttsChunks metadata. The dedicated HTTPS Agent uses keep-alive, a small pool and TCP no-delay. Connection reuse is observed on ${connections.filter(row=>row.reused).length}/${connections.length} measured responses. Node fetch can already pool connections; explicit ownership and reuse telemetry are improvements in control/diagnosis, not proof that the old code always reconnected.

| Real Aura attempt stage | n | p50 / p95 ms |
|---|---:|---:|
| Request → first provider body bytes | ${pct(attempts.map(row=>row.firstByteMs)).n} | ${pair(pct(attempts.map(row=>row.firstByteMs)))} |
| Request → complete atomic part | ${pct(attempts.map(row=>row.totalMs)).n} | ${pair(pct(attempts.map(row=>row.totalMs)))} |
| Consecutive raw body-chunk arrival gaps | ${chunkRows.length} | ${pair(pct(chunkRows.map(row=>row.gapMs)))} |

An intermediate run exposed a false timeout during ${healthyTimeout||"a long read-back"}: the body was still delivering hundreds of chunks when a fixed eight-second total timer expired. Both attempts were cut off. This experiment is preserved separately and is not mixed into final latency percentiles. The final implementation resets an eight-second inactivity timer on headers and every nonempty chunk; a separate sixty-second part watchdog remains. Healthy long bodies are no longer treated as stalled solely because eight seconds elapsed.

The diagnostic itself initially published the entire growing log for every chunk. That repeated large updates in the audio loop. Raw timings now append in memory, and a complete row is published at audio/content/playback milestones. A regression test verifies that one hundred chunk events produce no per-chunk full-row publications and are all present at completion.

## Buffering, retry and recovery

- Short replies (up to eighty characters) wait for the complete informative reply. Longer replies use a 300 ms minimum audio buffer; Aura produces atomic parts of at most one hundred source characters. Existing cached leading fragments and Anything else remain reusable, but are held with the dynamic content rather than playing an unfinished lead-in alone.
- Acknowledgements are marked neutral. While the provider works, cached One moment audio is scheduled after approximately 1100 ms of uncovered playback time, leaving some margin around the requested 1200 ms. If work is still pending after that clip, recovery can repeat. These prompts never mutate the cart or count as informative audio.
- Timeout/connection failure gets at most one retry per atomic provider request. Failed-part PCM is held back, so retry does not replay a partial word or a partially delivered order claim. Caller cancellation never retries.
- If both attempts fail, a cached notice says the voice is having trouble and asks the browser user to check the text reply. It is allowed to finish; the turn remains failed and the cart/microphone remain active. A late acknowledgement timing update cannot turn that failure into a successful reply.
- Per-turn CSV includes raw chunk timing, attempt counts/reasons, first provider byte, total part time, actual browser source-ended completion, dropped/late chunks, stall prompts, gap count and first informative playback time. A gap count means scheduled PCM buffers were separated by at least eighty milliseconds. It excludes silence inside PCM and is not an acoustic measurement.

## Ninety-turn result

The same thirty public script clips are sent once to each configuration, with the script's five session resets. Greeting/setup is excluded. Known trimmed synthetic speech end is compared with browser byte receipt and scheduled AudioContext playback. Informative audio excludes Okay and One moment. Failed/missing turns remain in the table and have no invented latency value; percentile n is the number that produced the relevant event. Partial informative playback does not imply the full reply finished.

| STT configuration | Completed / attempted | First byte p50 / p95 ms (n) | First playback p50 / p95 ms (n) | First informative playback p50 / p95 ms (n) |
|---|---:|---:|---:|---:|
${report.summary.map(row=>`| ${row.model} | ${row.completed}/${row.attempted} | ${pair(row.firstByteMs)} (${row.firstByteMs.n}) | ${pair(row.firstPlaybackMs)} (${row.firstPlaybackMs.n}) | ${pair(row.firstInformativePlaybackMs)} (${row.firstInformativePlaybackMs.n}) |`).join("\n")}

Maximum first-informative times: ${report.summary.map(summary=>`${summary.model}: ${n(Math.max(...report.rows.filter(row=>row.model===summary.model).map(row=>row.firstInformativePlaybackMs??0)))} ms`).join("; ")}. Long tail delays remain visible even though p95 is lower.

| Configuration | Gap count >=80 ms | Maximum scheduled gap ms | Turns with gap >1200 ms | Stall prompts | Retries |
|---|---:|---:|---:|---:|---:|
${report.summary.map(row=>`| ${row.model} | ${row.gapCount} | ${n(row.maxGapMs)} | ${row.gapsOver1200ms}/${row.attempted} | ${row.stalls} | ${row.retries} |`).join("\n")}

Waits are **uncertain: 900 ms**, incomplete tails: 1600 ms; complete Flux: 750 ms, Nova multilingual: 1100 ms, Nova en-IN: 1600 ms. Yes, the uncertain guard was reduced from 1600 to 900 ms. Complete/incomplete waits were not all reduced to 900 ms. Continuation merge remains 2200 ms, restoring the prior dialogue/cart journal and processing the merged final once. No interim/speculative engine execution.

| Configuration | Premature engine releases | Premature any audio | Premature informative audio | Revisions |
|---|---:|---:|---:|---:|
${report.summary.map(row=>`| ${row.model} | ${row.prematureEngineRelease}/${row.attempted} | ${row.anyPrematureAudio}/${row.attempted} | ${row.prematureInformativeAudio}/${row.attempted} | ${row.revisions} |`).join("\n")}

Premature means before the known final caller speech end minus fifty milliseconds, counting every generation in a scripted turn, including superseded ones. This controlled synthetic check does not establish the human caller cut-off rate. Split/unsplit journal properties exercise revision even when the live script does not trigger it.

Every incomplete/failed turn:

${faults.length?faults.map(row=>`- ${row.model}/${row.id}: ${row.failure?`harness wait for completion: ${row.failure}`:"incomplete playback"}; ${row.errors.map(error=>`${error.code}${error.reason?`: ${error.reason}`:""}`).join(", ")||"no reported provider error"}; generations=${row.generations.length}, informative=${row.firstInformativePlaybackMs===null?"none":`${n(row.firstInformativePlaybackMs)} ms`}; interruption=${row.generations.at(-1)?.playback?.trigger?.source??"none"}.`).join("\n"):"- None in this run."}

A harness completion timeout is not an Aura timeout. The Flux incomplete turn produced its acknowledgement, was marked cancelled by a server-turn interrupt, and never produced informative playback. It is retained as a miss; its cancellation's upstream cause is not established by these logs. Final-run TTS errors: ${report.rows.filter(row=>row.errors.some(error=>error.code==="tts_failed")).length}. Natural retries are counted separately from terminal failures; fault-injection tests also verify the retry limit and notice path.

The recovery buffer prevents a cached unfinished sentence from being followed by a long empty buffer gap, but it can delay useful information. First acknowledgement latency must not be advertised as informative-response latency. Remote synthesis/body delivery and complete-part buffering remain material latency costs; these measurements do not justify a sub-second useful-response claim. No STT accent winner is selected.

## Access behavior

The default bind is always 127.0.0.1, including when a deployment label is set. Local direct requests need no access code. A public bind, non-local peer/Host, forwarding headers or forced tunnel mode require VOICE_DEMO_ACCESS_TOKEN of at least twenty-four characters. Origin checks and constant-time token validation happen before STT/TTS access.

Actual probes:

| Probe | Result |
|---|---|
${access.rows.map(row=>`| ${row.id} | ${row.status!==undefined?`HTTP ${row.status}; requiresAccessCode=${row.requiresAccessCode}`:row.code??`refused=${row.refused}; warning=${row.startupWarning}`} |`).join("\n")}

The correct-token probe intentionally used an isolated server with provider keys disabled: it passed authorization, then reached the unavailable-provider warm gate. That HTTP 503 / voice_start_failed result is deliberate; the access probes made zero provider calls. Tokens were never printed.

For a tunnel, set these names in private .env.local, then restart the server: VOICE_DEMO_ACCESS_TOKEN and VOICE_REQUIRE_ACCESS_TOKEN (true). Forced mode is mandatory for a proxy that hides or rewrites all public Host/Origin/forwarding metadata; the server cannot infer a network path that a proxy completely conceals. Normal ngrok public Host/forwarded requests already fail closed without the token. Do not put the token into a URL or Git.

Missing/short token on a non-local bind prints: WARNING: VOICE_DEMO_ACCESS_TOKEN is missing or too short. Refusing public/tunnel access. Startup exits without binding. The same refusal applies to forced tunnel mode without a token. Local-only startup remains password-free. No Render deployment was performed.

## Stable timing budgets and validation

The engine test warms each input size, alternates ten/twenty/forty-word batches over seven rounds, and checks the median of batch medians. Relative limits account for the actual seven-word sliding-window counts (49/119/259), with lexical/JIT variance and a small fixed allowance. A single scheduler/GC pause no longer fails an absolute p95/max gate. Absolute latency benchmarks remain separate; the fifty-millisecond p95 target is not silently redefined as a real-time guarantee.

Five independent runs during browser/provider activity: **${budgets.passed}/${budgets.total} passed**. Median forty-word times: ${budgets.rows.map(row=>n(row.median40Ms)).join(", ")} ms. These tests verify bounded relative scaling and no LLM/shortlist work, not worst-case OS scheduling.

Validation: 45 voice tests, 23 live-call/bounds tests, 53 selected engine tests, 3 publication tests; Edge transport/CSV/recovery fixture, typecheck, privacy check and production build. The eighty public dev scenarios remain 80/80. No held-out/burned suite was run and no grading rule changed. No menu, price or matcher behavior changed in this update. LLM FAQ remains disabled; no Groq or Vapi calls.

Primary references: [Node HTTPS Agent](https://nodejs.org/docs/latest-v24.x/api/https.html#class-httpsagent), [Node HTTP Agent](https://nodejs.org/docs/latest-v24.x/api/http.html#class-httpagent), [Deepgram Aura Flush](https://developers.deepgram.com/docs/tts-ws-flush). Persistent HTTP pooling is used here; no STT-specific KeepAlive message is invented for Aura TTS.
`;
writeFileSync("docs/playback-recovery.md",output);console.log(JSON.stringify({report:"docs/playback-recovery.md",turns:report.rows.length,sourceCommit:report.sourceCommit,incomplete:faults.length,budgetPasses:budgets.passed}));
