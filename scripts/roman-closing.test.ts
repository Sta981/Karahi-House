import test from "node:test";
import assert from "node:assert/strict";
import {newState,runTurn,VOICE_ORDER_GOODBYE,type DialogState} from "../lib/dialog";
import {romanTranscript} from "../voice/roman-transcript";
import {TurnRecorder} from "../voice/turn-recorder";
import {voiceCsv} from "../voice/turn-log";
import {parseVoiceCsv} from "./lib/voice-csv.mjs";
import {VoiceSession} from "../voice/session";
import {phraseCompletion} from "../voice/phrase-completeness";
import {isCompletionSignal,isNoMoreAnswer} from "../lib/closing";
import {FixedAudioTts} from "../voice/fixed-audio";
const call=(...texts:string[])=>{let r=runTurn(newState({closingMode:"anything_else"}),texts[0]);for(const text of texts.slice(1))r=runTurn(r.state,text);return r;};
const ready=()=>call("one mango lassi","that completes my order","Synthetic Guest");

test("completion signals end collection without skipping required choices or pickup name",()=>{
 for(const text of ["we're all set","done now","my order is finished","that's enough thanks","yhi order hai","eh hi order ae","bas ena hi"]){
  const r=call("one mango lassi",text);assert.equal(r.state.phase,"ask_name",text);assert.equal(r.endCall,undefined);assert.equal(r.summary,undefined);assert.equal(r.state.cart.length,1);assert.equal(phraseCompletion(text),"complete");
 }
 let r=call("one goat white karahi","we're all set");assert.ok(r.state.pending);assert.match(r.reply,/Half or Full/);assert.equal(r.endCall,undefined);
 r=runTurn(r.state,"half");assert.equal(r.state.phase,"ask_spice");r=runTurn(r.state,"no");assert.equal(r.state.phase,"ask_spice");assert.equal(r.endCall,undefined);
 r=runTurn(r.state,"mild");assert.equal(r.state.phase,"ask_name");r=runTurn(r.state,"no");assert.equal(r.state.customerName,undefined);assert.equal(r.endCall,undefined);
});
test("voice checkout reads the exact order once then no-more answers finalize and thank",()=>{
 for(const answer of ["no thanks","enough","it's over","it is done now","nhi","bas","correct"]){
  const r=ready();assert.equal(r.state.phase,"confirm");assert.match(r.reply,/1 Mango Lassi.*\$4\.50.*Anything else\?$/);assert.equal(r.summary,undefined);
  const end=runTurn(r.state,answer);assert.equal(end.state.phase,"closed",answer);assert.equal(end.endCall,true);assert.equal(end.reply,VOICE_ORDER_GOODBYE);assert.equal(end.summary?.status,"pending_acceptance");assert.equal(end.summary?.subtotalCents,450);assert.doesNotMatch(end.reply,/Please check/);
 }
});
test("yes to anything-else continues ordering; a new cart must be read back again",()=>{
 const r=ready(),more=runTurn(r.state,"yes please");assert.equal(more.state.phase,"open");assert.equal(more.summary,undefined);assert.equal(more.endCall,undefined);assert.match(more.reply,/What else/);
 let next=runTurn(more.state,"one mango lassi");assert.equal(next.state.cart.reduce((sum,line)=>sum+line.qty,0),2);
 next=runTurn(next.state,"that completes my order");assert.equal(next.state.phase,"confirm");assert.match(next.reply,/1 Mango Lassi; 1 Mango Lassi.*\$9\.00.*Anything else/);
 next=runTurn(next.state,"no");assert.equal(next.summary?.subtotalCents,900);
});
test("questions preserve the current read-back; complaints or changed facts need a fresh one",()=>{
 const r=ready(),price=runTurn(r.state,"what is the total");assert.equal(price.summary,undefined);assert.match(price.reply,/\$4\.50.*Anything else/);
 assert.equal(runTurn(price.state,"no").endCall,true);
 const complaint=runTurn(r.state,"that quantity is wrong");assert.deepEqual(complaint.state.cart,r.state.cart);const again=runTurn(complaint.state,"no");assert.equal(again.endCall,undefined);assert.match(again.reply,/Please check:.*Anything else/);
 const stale=structuredClone(r.state);stale.cart[0].qty=2;const checked=runTurn(stale,"no");assert.equal(checked.endCall,undefined);assert.match(checked.reply,/2 Mango Lassi.*\$9\.00/);
 const notes=runTurn(r.state,"no onions");assert.equal(notes.endCall,undefined);assert.equal(notes.summary,undefined);
});
test("unfinished and review-required orders cannot finalize on polite done words",()=>{
 let r=call("two garlic naan","remove garlic naan","it's over");assert.equal(r.endCall,undefined);assert.equal(r.state.cart[0].qty,2);
 const unsafe=structuredClone(ready().state);unsafe.needsReview=true;r=runTurn(unsafe,"enough");assert.equal(r.endCall,undefined);assert.equal(r.summary,undefined);
 const empty=call("we're all set");assert.equal(empty.endCall,true);assert.equal(empty.summary,undefined);
 for(const text of ["no onions","don't finish yet","enough spice","change the mango lassi","add another mango lassi"])assert.equal(isNoMoreAnswer(text),false,text);
});
test("common native completion and Roman Urdu/Punjabi variants share the same checkout",()=>{
 for(const text of ["यही ऑर्डर है","یہی آرڈر ہے","ਇਹੀ ਆਰਡਰ ਹੈ","yahi mera order hai"]){const r=call("one mango lassi",text);assert.equal(r.state.phase,"ask_name",text);assert.equal(r.state.needsReview,undefined);}
 for(const text of ["it is over","done now","no it's done now","enouh"])assert.equal(isCompletionSignal(text),true);
});
test("Roman display covers common South Asian scripts and leaves Latin text intact",()=>{
 for(const [text,expected]of [["मुझे दो garlic naan चाहिए","mujhe do garlic naan chahiye"],["ਮੈਨੂੰ ਦੋ garlic naan ਦਿਓ","mainu do garlic naan deyo"],["مجھے دو garlic naan دیں","mujhe do garlic naan dein"]])assert.equal(romanTranscript(text),expected);
 for(const text of ["नमस्ते","ਨਮਸਤੇ","নমস্কার","નમસ્તે","வணக்கம்","నమస్తే","ನಮಸ್ಕಾರ","നമസ്കാരം","ආයුබෝවන්"]){const roman=romanTranscript(text);assert.match(roman,/^[\x00-\x7f]+$/);assert.ok(!roman.includes("[unrecognized"),text);}
 for(const text of ["one garlic naan","mainu do naan deyo","constructor","no onions"])assert.equal(romanTranscript(text),text);
});
test("raw STT and Roman display stay separate and both CSV columns redact callbacks",()=>{
 const rows:any[]=[],recorder=new TurnRecorder({callId:"fixture",location:"Lahore local",model:"nova-3",profile:"fixture"},row=>rows.push(structuredClone(row)));
 recorder.event({type:"transcript",text:"मुझे दो garlic naan चाहिए"});recorder.event({type:"reply",generation:1,text:"Fixture",cart:[],engineMs:1});
 let csv=parseVoiceCsv(voiceCsv([rows.at(-1)]))[0];assert.equal(csv.transcript_redacted,"मुझे दो garlic naan चाहिए");assert.equal(csv.transcript_roman,"mujhe do garlic naan chahiye");
 for(const text of ["एक दो तीन चार पांच छह सात","੪੧੫੫੫੫੦੧੯੯"]){recorder.event({type:"transcript",text});recorder.event({type:"reply",generation:2,text:"Fixture",cart:[],engineMs:1});csv=parseVoiceCsv(voiceCsv([rows.at(-1)]))[0];assert.match(csv.transcript_redacted,/redacted/);assert.match(csv.transcript_roman,/redacted/);assert.ok(!JSON.stringify(csv).includes(text));}
});
test("Roman presentation cannot manufacture an engine match from unknown script",()=>{
 const raw="अनजानविशेषण rice";assert.match(romanTranscript(raw),/rice/);const r=call(raw);assert.equal(r.state.cart.length,0);assert.match(r.reply,/repeat.*English/);
});
test("voice closing emits goodbye audio before call_end and sends the confirmed ticket once",async()=>{
 const events:any[]=[],sent:any[]=[],session=new VoiceSession({name:"fixture",warm:async()=>{},close(){},async *speak(){yield Buffer.from([0,0]);}},event=>events.push(event),false,async summary=>{sent.push(summary);});
 try{for(const text of ["one mango lassi","we're all set","Synthetic Guest"])await session.turn(text);assert.equal(sent.length,0);const before=events.length;await session.turn("enough");const last=events.slice(before);assert.equal(sent.length,1);assert.equal(sent[0].status,"pending_acceptance");assert.equal(last.at(-1).type,"call_end");assert.ok(last.findIndex(event=>event.type==="audio_end")<last.findIndex(event=>event.type==="call_end"));assert.ok(last.some(event=>event.type==="reply"&&event.text===VOICE_ORDER_GOODBYE));await session.turn("no");assert.equal(sent.length,1);}finally{session.close();}
});
test("normal read-back and goodbye use checked clips without provider synthesis",async()=>{
 const tts=new FixedAudioTts({name:"aura-2",warm:async()=>{},close(){},async *speak(){throw Error("Unexpected provider request");}});await tts.warm();
 try{for(const text of [ready().reply,VOICE_ORDER_GOODBYE]){assert.equal(tts.plan(text).dynamicCharacters,0,text);let bytes=0;for await(const chunk of tts.speak(text,new AbortController().signal))bytes+=chunk.length;assert.ok(bytes>0);}}finally{tts.close();}
});
test("failed goodbye synthesis cannot report a completed call",async()=>{
 const events:any[]=[],session=new VoiceSession({name:"fixture",warm:async()=>{},close(){},async *speak(text){if(text===VOICE_ORDER_GOODBYE)throw Error("fixture timeout");yield Buffer.from([0,0]);}},event=>events.push(event));
 try{for(const text of ["one mango lassi","we're all set","Synthetic Guest","no"])await session.turn(text);assert.ok(events.some(event=>event.type==="error"&&event.code==="tts_failed"));assert.ok(!events.some(event=>event.type==="call_end"));}finally{session.close();}
});
