// Manual development script only. Authored from final menu + intended actions;
// no matcher/engine predictions, held-out files or grading modules are imported.
import { readFileSync,writeFileSync } from "node:fs";
const menu=JSON.parse(readFileSync("lib/menu-source.json","utf8"));
for(const name of ["Chicken Biryani","Garlic Naan Bread","Lamb White Karahi","Mango Lassi","Fish Pakora","Rice","Gulab Jamun"])if(!menu.items.some(item=>item.name===name))throw Error("Manual script item absent from final source");
if(menu.items.some(item=>item.name.toLowerCase()==="butter chicken"))throw Error("Unavailable example is no longer absent");
const rows=[
 ["A",true,"Salam, can I order for pickup?","Pickup FAQ; no cart addition."],
 ["A",false,"Please add one chicken biryani.","1 Chicken Biryani; ask the order spice level."],
 ["A",false,"Medium spice for the order.","Chicken Biryani becomes Medium Spice."],
 ["A",false,"And two garlic naan, please.","Add 2 Garlic Naan Bread; inherit Medium Spice."],
 ["A",false,"No, make the garlic naan three.","Replace naan quantity with 3; no additional line."],
 ["A",false,"Remove one garlic naan.","Reduce naan quantity to 2; keep biryani."],
 ["B",true,"Can you do a lamb white karahi?","Ask Half/Full; never guess a size."],
 ["B",false,"Full, with no spice.","1 Full Lamb White Karahi, No Spice."],
 ["B",false,"Add a mango lassi as well.","Add 1 Mango Lassi; no spice/size question for lassi."],
 ["B",false,"Actually, make the karahi half.","Replace Full with Half; preserve quantity and No Spice."],
 ["B",false,"That will be all.","Ask the pickup name before read-back."],
 ["B",false,"Test Customer.","Read back cart and local subtotal; ask confirmation."],
 ["B",false,"Yes, that is correct.","Pending staff acceptance; never say restaurant accepted."],
 ["C",true,"One fish pakora, make it hot.","Ask Spicy versus Extra Spicy; hot must remain unset."],
 ["C",false,"Spicy, please.","Set Fish Pakora to Spicy."],
 ["C",false,"Actually, make the pakora extra spicy.","Override Fish Pakora to Extra Spicy; no added line."],
 ["C",false,"Please add butter chicken.","Unavailable; offer only actual menu items; no silent addition."],
 ["C",false,"No.","Decline the offered substitute; keep Fish Pakora."],
 ["C",false,"Add one gulab.","Ask to confirm Gulab Jamun; truncated name must not silently add."],
 ["C",false,"Yes, one gulab jamun.","Add 1 Gulab Jamun; dessert has no spice/size."],
 ["D",true,"Mujhe aik chicken biryani chahiye.","1 Chicken Biryani; ask spice."],
 ["D",false,"Bilkul no spice.","Set the order to No Spice."],
 ["D",false,"Do garlic naan bhi de dein.","Add 2 Garlic Naan Bread; inherit No Spice."],
 ["D",false,"Nahi, garlic naan teen kar dein.","Replace naan quantity with 3; do not append."],
 ["D",false,"Aur ek mango lassi.","Add 1 Mango Lassi; no spice modifier."],
 ["E",true,"One chicken [pause 700 ms] biryani, mild spice.","One complete item, Mild Spice; no reply during the pause."],
 ["E",false,"And one rice [pause 1000 ms] and one mango lassi.","Add both items once; no reply during the pause."],
 ["E",false,"One garlic naan [pause 600 ms] no, make it two, mild spice.","End with 2 Garlic Naan Bread, Mild Spice; no unrequested additions."],
 ["E",false,"Can I have a karahi?","Clarify protein/style; every offered candidate must be an actual karahi."],
 ["E",false,"I have a peanut allergy.","Mark needs_review and defer ingredient safety to staff."],
].map(([session,reset,text,expected],i)=>({id:`mic_${String(i+1).padStart(2,"0")}`,turn:i+1,session,reset,text,expected}));
if(rows.length!==30)throw Error("Script must contain exactly thirty spoken turns per model");
writeFileSync("docs/real-mic-script.json",JSON.stringify({kind:"manual-development-not-held-out",turnsPerModel:30,models:["flux","nova-3","nova-3-en-IN"],speakersExpected:1,menuSource:"lib/menu-source.json",expectationsFrom:"final menu and user intent; not matcher output",rows},null,2)+"\n");
writeFileSync("docs/real-mic-script.md",`# Real-microphone comparison: 30 turns per model\n\nUse your own accent and normal speaking pace, with headphones, the same microphone/network and the same deployment. No recordings. Audio is transient; only redacted transcript/cart/metrics logs are retained locally. This is one speaker and 60 spoken turns, not a population accent-accuracy estimate.\n\nRun exactly these thirty turns once with Flux and once with Nova-3. Start a fresh call at each session boundary A–E (turns 1, 7, 14, 21, 26). Within a session, keep the call/cart alive. Wait for replies except at the deliberate internal pauses. Do not speak the bracketed pause instructions. If interrupted during a pause, finish the original sentence and mark a premature cut-off. Use Test Customer instead of your real name; do not say a real phone number.\n\nAlternate which model goes first by session: A Flux→Nova; B Nova→Flux; C Flux→Nova; D Nova→Flux; E Flux→Nova. Export CSV before starting another call. Repeat the same procedure later for the other deployment; do not pool Lahore local and US-hosted latency. Let the first ready/greeting finish; note cold-start time separately.\n\nCopy the blank results sheet to private .data before filling it. Mark dish, quantity, size and spice/must-ask independently (pass/fail/NA), along with premature cut-off, false barge-in and subjective clarity. Record engine-policy failures separately from transcription failures. A safe clarification is different from a silent wrong addition. Never infer correctness from the agent's own confidence.\n\n| Turn | Session | Speak | Intended result / check |\n|---|---|---|---|\n${rows.map(row=>`| ${row.turn} | ${row.session}${row.reset?" — NEW CALL":""} | ${row.text} | ${row.expected} |`).join("\n")}\n\nDo not select Flux/Nova yet. After you fill the sheet, compare silent wrong adds and premature cut-offs first, then slot correctness and clarification burden, then warm p50/p95 latency. Report 1 speaker / 30 turns per model, missing turns and failures explicitly. Current synthetic results do not fill any of these real-mic score cells.\n`);
const cell=value=>'"'+String(value).replaceAll('"','""')+'"';
const headers=["model","turn_id","session","fresh_call","utterance_script","intended_result","deployment","speaker_id","actual_transcript","actual_cart","dish_pass_fail_na","quantity_pass_fail_na","size_pass_fail_na","spice_or_must_ask_pass_fail_na","disposition_pass_fail_na","safe_clarification","silent_wrong_add","premature_cutoff","false_barge_in","endpoint_reason","total_ms","stt_endpointing_uplink_ms","engine_ms","tts_first_byte_ms","return_network_ms","cold_start_ms_separate","voice_clarity_1_to_5","notes"];
writeFileSync("docs/real-mic-results-template.csv",[headers.map(cell).join(","),...["flux","nova-3","nova-3-en-IN"].flatMap(model=>rows.map(row=>[model,row.id,row.session,row.reset,row.text,row.expected,...Array(headers.length-6).fill("")].map(cell).join(",")))].join("\r\n")+"\r\n");
const guide=readFileSync("docs/real-mic-script.md","utf8").replace("one speaker and 60 spoken turns","one speaker and 90 scripted turns").replace("once with Flux and once with Nova-3","once each with Flux English, Nova-3 multilingual and Nova-3 Indian English (en-IN)").replace(/Alternate which model goes first by session:.*?Export CSV/,"Rotate model order: A Flux / multi / en-IN; B multi / en-IN / Flux; C en-IN / Flux / multi; D Flux / en-IN / multi; E multi / Flux / en-IN. Export CSV");
writeFileSync("docs/real-mic-script.md",guide);
console.log("Prepared the SAME 30 utterances for three models and 90 BLANK result rows; no matcher output used.");
writeFileSync("docs/real-mic-script.md",readFileSync("docs/real-mic-script.md","utf8")+"\nIf the agent asks a different question from the script, record the mismatch and answer the actual question to recover. Record recovery turns separately; they are extra turns, not replacements for the thirty scripted turns. Mark later failures caused by that mismatch as dependent conversation failures, rather than counting each as an independent STT error. Do not silently restart or discard a failed session.\n");
