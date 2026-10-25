import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GREETING,newState,runTurn} from "../lib/dialog";
test("client walkthrough preserves required choices, corrections, removal and exact local read-back",()=>{
 const script=readFileSync("docs/demo-script.md","utf8");let state=newState();assert.ok(script.includes(GREETING));
 const phrases=["one chicken lahori karahi","full","two garlic naan","make it three","one mango lassi","remove one mango lassi","what do you have in desserts","that's all","mild spice","Demo Guest","yes"];
 let summary;
 for(let index=0;index<phrases.length;index++){const result=runTurn(state,phrases[index]);state=result.state;assert.ok(script.includes(phrases[index]));assert.ok(script.includes(result.reply),`Documented answer differs for ${phrases[index]}: ${result.reply}`);if(index<phrases.length-1)assert.equal(result.summary,undefined);else summary=result.summary;}
 assert.equal(summary?.status,"pending_acceptance");assert.equal(summary?.subtotalCents,4797);assert.deepEqual(summary?.items.map(({name,qty,variant,spice})=>({name,qty,variant,spice})),[{name:"Chicken Lahori Karahi",qty:1,variant:"Full",spice:"Mild Spice"},{name:"Garlic Naan Bread",qty:3,variant:undefined,spice:"Mild Spice"}]);assert.equal(state.phase,"closed");
});
