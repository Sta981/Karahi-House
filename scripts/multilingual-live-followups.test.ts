import test from "node:test";
import assert from "node:assert/strict";
import {newState,runTurn} from "../lib/dialog";
import {analyzeUtterance} from "../lib/matcher";
import {normalizeCodeSwitch} from "../lib/code-switch";
import {replayCartOperations} from "../lib/cart-journal";
const qty=(state:ReturnType<typeof newState>,id:string)=>state.cart.filter(line=>line.itemId===id).reduce((sum,line)=>sum+line.qty,0);

test("an implicit quantity boundary preserves resolved sides beside an uncertain family",()=>{
 const r=runTurn(newState(),"black pepper karahi three onion naan and two mango lassi");
 assert.equal(qty(r.state,"ONION_NAAN"),3);assert.equal(qty(r.state,"MANGO_LASSI"),2);
 assert.ok(r.state.recognition);assert.ok(r.state.recognition.issues[0].candidates.every(item=>/Black Pepper/.test(item.name)));
 assert.match(r.reply,/Added 3 Onion Naan/);assert.match(r.reply,/Added 2 Mango Lassi/);
});
test("quantity-delimited spoken lists retain every item and larger English counts",()=>{
 const r=runTurn(newState(),"thirteen cheese naan bread seventeen roti twenty four mango lassi three mint chutney");
 for(const [id,count]of [["CHEESE_NAAN_BREAD",13],["ROTI",17],["MANGO_LASSI",24],["MINT_CHUTNEY",3]] as const)assert.equal(qty(r.state,id),count,id);
 assert.equal(r.state.recognition,undefined);
 assert.equal(analyzeUtterance("fifty one roti").matches.length,0);
});
test("known native dish words and ordering fillers resolve multiple independent dishes",()=>{
 const text="अच्छा मुझे इसके अलावा दो दाल मखनी तीन आलू गोभी और एक चना मसाला भी चाहिए";
 assert.equal(normalizeCodeSwitch(text).unsupportedScript,false);
 const r=runTurn(newState(),text);
 for(const [id,count]of [["DAL_MAKHANI",2],["ALOO_GOBI",3],["CHANA_MASALA",1]] as const)assert.equal(qty(r.state,id),count,id);
 assert.equal(r.state.needsReview,undefined);
});
test("code-switched mixed lists keep the burger question and immediately disclose clear additions",()=>{
 const r=runTurn(newState(),"मुझे तीन onion naan एक burger और दो mango लस्सी दे दो");
 assert.equal(qty(r.state,"ONION_NAAN"),3);assert.equal(qty(r.state,"MANGO_LASSI"),2);assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),0);
 assert.match(r.reply,/Kids Chicken Burger.*Add it/);assert.equal(r.state.recognition?.issues.length,1);
 const accepted=runTurn(r.state,"yes");assert.equal(qty(accepted.state,"KIDS_CHICKEN_BURGER"),1);assert.equal(qty(accepted.state,"ONION_NAAN"),3);
});
test("native and Roman menu questions are read-only and never staff-review dispositions",()=>{
 const state=runTurn(newState(),"two mango lassi").state;
 for(const text of ["आपके पास क्या है खाने में","aur aapke paas kya hai khane mein","aap ke paas kya hai"]){
  const r=runTurn(state,text);assert.deepEqual(r.state.cart,state.cart,text);assert.match(r.reply,/Menu categories:/);assert.equal(r.state.needsReview,undefined);
 }
});
test("a reordered noisy karahi with an explicit style cannot propose korma",()=>{
 let r=runTurn(newState(),"two lamb kerahi full in white");
 assert.equal(r.state.cart.length,0);assert.deepEqual(r.state.recognition?.issues[0].candidates.map(item=>item.itemId),["LAMB_WHITE_KARAHI"]);
 r=runTurn(r.state,"yes");assert.equal(qty(r.state,"LAMB_WHITE_KARAHI"),2);assert.equal(r.state.cart[0].size,"Full");assert.equal(qty(r.state,"KORMA_LAMB"),0);
 const bare=analyzeUtterance("two lamb kerahi half");assert.equal(bare.matches.length,0);assert.ok(bare.issues[0].candidates.length>1);assert.ok(bare.issues[0].candidates.every(candidate=>/karahi/i.test(candidate.name)));
});
test("an empty-cart discourse restart can order but never changes an existing removal target",()=>{
 let r=runTurn(newState(),"actually i want three cheese naan and two mango lassi");assert.equal(qty(r.state,"CHEESE_NAAN_BREAD"),3);assert.equal(qty(r.state,"MANGO_LASSI"),2);
 const pending=runTurn(runTurn(newState(),"two cheese naan").state,"remove cheese naan");
 r=runTurn(pending.state,"actually i want three mango lassi");assert.equal(qty(r.state,"MANGO_LASSI"),0);assert.equal(qty(r.state,"CHEESE_NAAN_BREAD"),2);
});
test("pack-versus-piece quantities clarify and unsupported native food words cannot disappear",()=>{
 const packed=runTurn(newState(),"three boxes of six gulab jamun");assert.equal(packed.state.cart.length,0);assert.match(packed.reply,/How many menu orders/);
 const state=runTurn(newState(),"one mango lassi").state;
 const unknown=runTurn(state,"दो अज्ञातव्यंजन rice");assert.deepEqual(unknown.state.cart,state.cart);assert.match(unknown.reply,/repeat/);
});
test("completion plus a finite preparation-time question resumes safe checkout",()=>{
 let r=runTurn(newState({closingMode:"anything_else"}),"two mango lassi");
 r=runTurn(r.state,"okay my order is finished and when can i collect my order");
 assert.match(r.reply,/about 30 minutes.*What name/);assert.equal(r.state.phase,"ask_name");assert.equal(r.endCall,undefined);
 r=runTurn(r.state,"Synthetic Guest");assert.match(r.reply,/Please check:.*2 Mango Lassi.*Anything else/);
 assert.equal(runTurn(r.state,"no").endCall,true);
 const informal=runTurn(runTurn(newState({closingMode:"anything_else"}),"one mango lassi").state,"my order is completed now and how much time i can get my order");assert.match(informal.reply,/about 30 minutes.*What name/);
});
test("an unknown native clause blocks itself while independent clear items still enter the cart",()=>{
 const r=runTurn(newState(),"दो अज्ञातव्यंजन rice और तीन onion naan एक mango लस्सी");
 assert.equal(qty(r.state,"RICE"),0);assert.equal(qty(r.state,"ONION_NAAN"),3);assert.equal(qty(r.state,"MANGO_LASSI"),1);assert.ok(r.state.recognition);assert.match(r.reply,/repeat it in English/);
});
test("new uncertain requests queue behind an existing clarification without dropping clear dishes",()=>{
 const pending=runTurn(newState(),"white karahi");
 let r=runTurn(pending.state,"two onion naan and a burger");assert.equal(qty(r.state,"ONION_NAAN"),2);assert.equal(r.state.recognition?.issues.length,2);
 r=runTurn(r.state,"goat");assert.match(r.reply,/Burger.*Add it/);assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),0);
 r=runTurn(r.state,"yes");assert.equal(qty(r.state,"KIDS_CHICKEN_BURGER"),1);assert.equal(qty(r.state,"ONION_NAAN"),2);assert.ok(r.state.pending);
});
test("a multi-item discourse correction asks add versus replace before mutating existing lines",()=>{
 const original=runTurn(newState(),"two mango lassi").state;
 const choice=runTurn(original,"actually i need three onion naan and one mint chutney");assert.deepEqual(choice.state.cart,original.cart);assert.match(choice.reply,/Add those items, or replace/);
 const extra=runTurn(choice.state,"add them");assert.equal(qty(extra.state,"MANGO_LASSI"),2);assert.equal(qty(extra.state,"ONION_NAAN"),3);assert.equal(qty(extra.state,"MINT_CHUTNEY"),1);
 const replacement=runTurn(choice.state,"replace my order");assert.equal(qty(replacement.state,"MANGO_LASSI"),0);assert.equal(qty(replacement.state,"ONION_NAAN"),3);assert.equal(qty(replacement.state,"MINT_CHUTNEY"),1);
 assert.equal(runTurn(choice.state,"yes").operations?.length,0);
});
test("deterministic list variants disclose all changes and their journals replay exactly",()=>{
 for(let count=1;count<=12;count++){
  const state=newState(),r=runTurn(state,`${count} mango lassi ${count+1} onion naan and ${count+2} mint chutney`);
  assert.equal(qty(r.state,"MANGO_LASSI"),count);assert.equal(qty(r.state,"ONION_NAAN"),count+1);assert.equal(qty(r.state,"MINT_CHUTNEY"),count+2);
  for(const fact of r.disclosure??[])assert.ok(r.reply.includes(fact));
  assert.deepEqual(replayCartOperations(state.cart,r.operations??[]),r.state.cart);
 }
});
