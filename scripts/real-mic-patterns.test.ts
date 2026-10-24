import test from "node:test";
import assert from "node:assert/strict";
import { newState,runTurn } from "../lib/dialog";
import { analyzeUtterance } from "../lib/matcher";
import { speechText } from "../lib/speech";
const seed=(...texts:string[])=>texts.reduce((state,text)=>runTurn(state,text).state,newState());

test("request verbs do not suppress item-adjacent number homophones",()=>{
  for(const verb of ["need","want","get","take","have"]){
    for(const word of ["to","too"]){
      const result=runTurn(newState(),`we ${verb} ${word} cheese naan please`);
      assert.equal(result.state.cart[0]?.qty,2,`${verb}/${word}`);
      assert.match(result.reply,/2 Cheese Naan/i);assert.doesNotMatch(result.reply,/I heard quantity/i);
    }
  }
  assert.equal(runTurn(newState(),"get for onion naan").state.cart[0]?.qty,4);
  assert.equal(runTurn(newState(),"one lamb biryani for me").state.cart[0]?.qty,1);
  assert.equal(runTurn(newState(),"one rice for my friend").state.cart[0]?.qty,1);
  for(const heard of ["none","knot","nun","non"]){
    const result=runTurn(newState(),`we want too cheese ${heard} please`);
    assert.equal(result.state.cart[0]?.itemId,"CHEESE_NAAN_BREAD");assert.equal(result.state.cart[0]?.qty,2);
  }
});
test("naan mishearings require an immediately adjacent bread modifier",()=>{
  for(const modifier of ["garlic","plain","cheese","chili","onion","keema"])for(const heard of ["none","knot","nun","non"]){
    assert.equal(speechText(`${modifier} ${heard}`),`${modifier} naan`);
  }
  for(const phrase of ["none of that","tie a knot","a nun","non dairy","rice and none"]){assert.equal(speechText(phrase).includes("naan"),false);}
});
test("routine collecting replies are short and omit empty-cart boilerplate",()=>{
  for(const text of ["one mango lassi","two rice","one chicken biryani"]){
    const result=runTurn(newState(),text);assert.doesNotMatch(result.reply,/No items added|I heard quantity/i);
    assert.ok(result.reply.split(/\s+/).length<=15,result.reply);assert.equal((result.reply.match(/\?/g)||[]).length,1);
  }
});
test("whole-order spice waits for completion and applies to all eligible lines",()=>{
  let state=newState();
  for(const text of ["one chicken biryani","two fish pakora","one mango lassi"]){const result=runTurn(state,text);state=result.state;assert.notEqual(state.phase,"ask_spice");assert.match(result.reply,/Anything else/);}
  let result=runTurn(state,"nothing else");state=result.state;assert.equal(state.phase,"ask_spice");assert.match(result.reply,/spice/i);
  const question=result.reply;result=runTurn(state,"uh sorry");assert.notEqual(result.reply,question);
  result=runTurn(state,"medium spice");assert.equal(result.state.phase,"ask_name");
  assert.equal(result.state.cart.find(line=>line.itemId==="CHICKEN_BIRYANI")?.spiceLevel,"Medium Spice");
  assert.equal(result.state.cart.find(line=>line.itemId==="FISH_PAKORA")?.spiceLevel,"Medium Spice");
  assert.equal(result.state.cart.find(line=>line.itemId==="MANGO_LASSI")?.spiceLevel,undefined);
});
test("no after anything-else ends collection and more food resumes it",()=>{
  let state=seed("one chicken biryani");let result=runTurn(state,"no");assert.equal(result.state.phase,"ask_spice");
  result=runTurn(result.state,"add a mango lassi");assert.equal(result.state.phase,"open");assert.match(result.reply,/Anything else/);
  result=runTurn(result.state,"checkout");
  assert.equal(result.state.phase,"ask_spice");
});
test("distinctive karahi families ask only the missing protein",()=>{
  for(const [word,proteins] of [["lahori",["Chicken","Lamb","Goat"]],["white",["Chicken","Lamb","Goat"]],["black pepper",["Chicken","Lamb","Goat"]],["shinwari",["Chicken","Lamb","Goat","Beef"]]] as const){
    const result=runTurn(newState(),`um ${word} please`);assert.equal(result.state.cart.length,0);
    assert.deepEqual([...new Set(result.state.recognition!.issues[0].candidates.map(candidate=>candidate.protein))].sort(),[...proteins].sort());
    assert.doesNotMatch(result.reply,/style/i);for(const protein of proteins)assert.ok(result.reply.includes(protein));
    const chosen=runTurn(result.state,"lamb");assert.ok(chosen.state.pending?.itemId.startsWith("LAMB_"));assert.match(chosen.reply,/Half or Full/);
  }
});
test("keema retains the bread/style choice and then narrows to real proteins",()=>{
  let result=runTurn(newState(),"some keema please");assert.match(result.reply,/Keema Karahi or Keema Naan/);
  result=runTurn(result.state,"karahi");assert.match(result.reply,/Chicken/);assert.match(result.reply,/Lamb/);assert.match(result.reply,/Beef/);assert.doesNotMatch(result.reply,/Keema Naan/);
});
test("unique partial removal asks consent; cancellation leaves the cart unchanged",()=>{
  const initial=seed("three cheese naan","one mango lassi");
  const result=runTurn(initial,"remove cheese knot");assert.ok(result.state.removalConfirmation);assert.deepEqual(result.state.cart,initial.cart);assert.match(result.reply,/Remove Cheese Naan/);assert.doesNotMatch(result.reply,/You have/);
  const no=runTurn(result.state,"no");assert.deepEqual(no.state.cart,initial.cart);
  const yes=runTurn(result.state,"yes");assert.equal(yes.state.cart.length,1);assert.match(yes.reply,/Removed 3 Cheese Naan/);
});
test("tied removal targets enumerate the cart without deleting a line",()=>{
  const initial=seed("one cheese naan","two garlic naan");const result=runTurn(initial,"remove naan");
  assert.deepEqual(result.state.cart,initial.cart);assert.ok(result.state.pendingCorrection);assert.match(result.reply,/Cheese Naan/);assert.match(result.reply,/Garlic Naan/);
});
