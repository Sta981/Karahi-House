import test from "node:test";
import assert from "node:assert/strict";
import {boundedEditDistance,editDistance,preparePhonetic,preparedSimilarity,similarityAtLeast} from "../lib/phonetic";
test("bounded distances preserve accepted transposition distances exhaustively",()=>{
 const words=[""];for(let length=1;length<=4;length++)for(const word of words.filter(word=>word.length===length-1))for(const char of "abc")words.push(word+char);
 for(const a of words)for(const b of words){const exact=editDistance(a,b);for(const limit of [0,1,2,3]){const bounded=boundedEditDistance(a,b,limit);assert.equal(bounded<=limit,exact<=limit);if(exact<=limit)assert.equal(bounded,exact);}}
});
test("threshold pruning keeps exact scores and decisions for menu-like and unrelated words",()=>{
 const words=["garlicnaan","cheesenaan","chickenkarahi","lahori","ordinary","sentences","answer","shinwari","blackpepper","mangolassi","neverendingconversation","rice",""];
 for(const a of words)for(const b of words)for(const threshold of [.76,.78,.8,.9]){const left=preparePhonetic(a),right=preparePhonetic(b),exact=preparedSimilarity(left,right),bounded=similarityAtLeast(left,right,threshold);assert.equal(bounded>=threshold,exact>=threshold);if(exact>=threshold)assert.equal(bounded,exact);}
});
