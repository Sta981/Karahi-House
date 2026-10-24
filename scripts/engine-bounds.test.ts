import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { newState } from "../lib/dialog";
import { runSmartTurn } from "../lib/brain";

test("unrelated 10/20/40-word turns stay bounded with no provider or shortlist work",async()=>{
  const words="ordinary conversations concern changing weather distant clouds city traffic office calendars weekend schedules book reviews garden paths sunlight shadows music travel stories".split(" ");
  for(const length of [10,20,40]){
    const text=Array.from({length},(_,i)=>words[i%words.length]).join(" ");
    const run=async()=>{
      const start=performance.now();
      const result=await runSmartTurn(newState(),text,[],{provider:null,onRouting(){}});
      assert.equal(result.usedLLM,false);assert.equal(result.routing.candidateCount,0);
      assert.equal(result.state.cart.length,0);
      return performance.now()-start;
    };
    await run();const times=[];for(let i=0;i<20;i++)times.push(await run());times.sort((a,b)=>a-b);
    assert.ok(times[18]<50,`${length} words: p95 ${times[18].toFixed(1)} ms exceeds 50 ms budget`);
    // A separate absolute bound catches accidental unbounded work even if
    // only one invocation is slow; benchmarks report cold runs separately.
    assert.ok(times[19]<250,`${length} words: max ${times[19].toFixed(1)} ms exceeds 250 ms`);
  }
});
