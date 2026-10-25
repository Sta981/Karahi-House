import test from "node:test";
import assert from "node:assert/strict";
import {runtimeInfo} from "../voice/runtime-info";
import {endpointSettings} from "../voice/endpointing";
import {TurnRecorder} from "../voice/turn-recorder";
import {voiceCsv} from "../voice/turn-log";
import {mishearingsCsv} from "../voice/mishearings";
import {parseVoiceCsv,summarizeVoiceCsv} from "./lib/voice-csv.mjs";
test("every exported turn has immutable runtime provenance and honest informative timing",()=>{
 const runtime=runtimeInfo({commit:"a".repeat(40),dirty:false},"nova-3-en-IN",endpointSettings("nova-3-en-IN"),{provider:"aura-2",model:"aura-2-thalia-en"},40,800,"adaptive"),rows:any[]=[];
 const recorder=new TurnRecorder({callId:"fixture",location:"Lahore local",model:"nova-3-en-IN",profile:"baseline+adaptive800",runtime},row=>rows.push(structuredClone(row)));
 recorder.event({type:"reply",generation:1,cart:[],text:"Fixture reply",engineMs:2});
 assert.equal(rows[0].runtime.buildCommit,"a".repeat(40));runtime.buildCommit="b".repeat(40);
 recorder.audioTiming(1,{speechToInformativePlaybackMs:1234});const output=parseVoiceCsv(voiceCsv([rows.at(-1)]));
 assert.equal(output[0].build_commit,"a".repeat(40));assert.equal(output[0].build_dirty,"false");assert.equal(output[0].tts_provider,"aura-2");assert.equal(JSON.parse(output[0].stt_config).language,"en-IN");assert.equal(JSON.parse(output[0].endpoint_settings).completeMs,800);
 assert.deepEqual(summarizeVoiceCsv(output).informativePlaybackMs,{n:1,p50:1234,p95:1234,max:1234});
 const csv=mishearingsCsv([{turnId:"fixture:1",atUtc:"fixture",model:"nova-3-en-IN",location:"Lahore local",heard:"fixture",intended:"synthetic intent",runtime:rows[0].runtime}]);assert.ok(csv.includes('"build_commit"'));assert.ok(csv.includes("a".repeat(40)));assert.ok(csv.includes('"tts_provider"'));
});
test("all STT configs and endpoint choices remain distinguishable; legacy provenance is unknown",()=>{
 const info=["flux","nova-3","nova-3-en-IN"].map(model=>runtimeInfo({commit:"c".repeat(40),dirty:true},model as any,endpointSettings(model as any),{provider:"kokoro",model:"kokoro-82m"},30,900,"adaptive"));
 assert.deepEqual(info.map(row=>row.sttConfig.language),["en","multi","en-IN"]);assert.ok(info.every(row=>row.buildDirty));
 const old=parseVoiceCsv('turn_id,transcript_redacted,first_informative_playback_ms\nfixture,"hello, there",\n');const summary=summarizeVoiceCsv(old);assert.deepEqual(summary.buildCommits,["unknown"]);assert.equal(summary.missingInformativePlayback,1);assert.equal(summary.informativePlaybackMs.n,0);
});
