import {readFileSync,writeFileSync} from "node:fs";
import {isDeepStrictEqual} from "node:util";
import {newState,runTurn} from "../lib/dialog";
import {replayCartOperations} from "../lib/cart-journal";
import {cartChanges,permitsCart} from "../lib/turn-safety";
const filename=process.argv[2]??".data/live-call-replay-v1.json";
if(/held[-_ ]?out|grading/i.test(filename))throw Error("Only development session fixtures are allowed");
const fixture=JSON.parse(readFileSync(filename,"utf8"));
if(fixture.kind!=="development replay only"||!Array.isArray(fixture.turns))throw Error("Not a development replay");
if(new Date(fixture.deleteAfter).getTime()<=Date.now())throw Error("The consent retention window has expired; delete this fixture");
let state=newState(),checkpoint=structuredClone(state);const rows=[];
for(const turn of fixture.turns){
 if(turn.supersedesPrevious)state=structuredClone(checkpoint);
 checkpoint=structuredClone(state);
 const result=runTurn(state,turn.text);
 const changes=cartChanges(state.cart,result.state.cart),disclosed=!changes.length||changes.every(change=>result.reply.includes(change.text));
 const permissions=permitsCart(result.intent!,state.cart,result.state.cart),replay=isDeepStrictEqual(replayCartOperations(state.cart,result.operations??[]),result.state.cart);
 rows.push({id:turn.id,text:turn.text,intent:result.intent,reply:result.reply,cart:result.state.cart,disclosed,permissions,replay,safetyRollback:result.safetyRollback??false});state=result.state;
}
const summary={kind:"development replay; never held-out",turns:rows.length,disclosurePasses:rows.filter(row=>row.disclosed).length,permissionPasses:rows.filter(row=>row.permissions).length,journalReplayPasses:rows.filter(row=>row.replay).length,finalCartGraded:fixture.expectedFinalCart!==null,finalCartCorrect:fixture.expectedFinalCart===null?null:isDeepStrictEqual(state.cart.map(({itemId,qty,size,spiceLevel,notes})=>({itemId,qty,size:size??null,spice:spiceLevel??null,notes})),fixture.expectedFinalCart),finalCart:state.cart.map(({itemId,qty,size,spiceLevel})=>({itemId,qty,size:size??null,spice:spiceLevel??null}))};
writeFileSync(".data/live-call-replay-v1-result.json",JSON.stringify({summary,rows},null,2)+"\n");console.log(JSON.stringify(summary,null,2));
if(rows.some(row=>!row.disclosed||!row.permissions||!row.replay)||summary.finalCartCorrect===false)process.exitCode=1;
