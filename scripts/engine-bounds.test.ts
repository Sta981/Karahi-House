import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { newState } from "../lib/dialog";
import { runSmartTurn } from "../lib/brain";

test("unrelated 10/20/40-word turns have bounded relative work and repeated median latency",async(t)=>{
  const words="ordinary conversations concern changing weather distant clouds city traffic office calendars weekend schedules book reviews garden paths sunlight shadows music travel stories".split(" ");
  const runs=new Map<number,()=>Promise<number>>(),samples=new Map<number,number[]>();
  for(const length of [10,20,40]){
    const text=Array.from({length},(_,i)=>words[i%words.length]).join(" ");
    const run=async()=>{
      const start=performance.now();
      const result=await runSmartTurn(newState(),text,[],{provider:null,onRouting(){}});
      assert.equal(result.usedLLM,false);assert.equal(result.routing.candidateCount,0);
      assert.equal(result.state.cart.length,0);
      return performance.now()-start;
    };
    for(let i=0;i<4;i++)await run();runs.set(length,run);samples.set(length,[]);
  }
  // Interleave sizes and rotate their order to share thermal/CPU conditions.
  // Median of seven batch medians tolerates isolated scheduling and GC pauses;
  // no one invocation decides whether a shared laptop passes the suite.
  const median=(values:number[])=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
  for(let round=0;round<7;round++)for(const length of round%2?[40,20,10]:[10,20,40]){
    const batch=[];for(let i=0;i<3;i++)batch.push(await runs.get(length)!());samples.get(length)!.push(median(batch));
  }
  const small=median(samples.get(10)!),medium=median(samples.get(20)!),large=median(samples.get(40)!);
  t.diagnostic(`budget ${JSON.stringify({median10Ms:small,median20Ms:medium,median40Ms:large,rounds:7,callsPerBatch:3})}`);
  // Seven-word sliding windows include edge effects: 49 windows for ten
  // words, 119 for twenty, 259 for forty. Allow 1.8x lexical/JIT variance,
  // rather than assuming every word costs the same. Quadratic growth (16x)
  // still fails. Absolute p50/p95 remain an independently reported benchmark.
  const windows=(words:number)=>7*words-21,allowance=(words:number)=>windows(words)/windows(10)*1.8;
  assert.ok(medium<=small*allowance(20)+2,`20/10-word median growth: ${medium.toFixed(1)}/${small.toFixed(1)} ms`);
  assert.ok(large<=small*allowance(40)+2,`40/10-word median growth: ${large.toFixed(1)}/${small.toFixed(1)} ms`);
});
