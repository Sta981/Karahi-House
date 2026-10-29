import { createHash } from "node:crypto";
import { GREETING,ORDER_SPICE_QUESTION,VOICE_ORDER_GOODBYE } from "../lib/dialog";
import { MENU,MODIFIERS,MENU_SOURCE_SHA256 } from "../lib/menu";
import { auraPronunciation } from "./pronunciation.mjs";
import { browsePage, MENU_CATEGORIES, CATEGORY_LIST, MENU_FALLBACK } from "../lib/menu-browsing";
const priceValues=[...new Set(MENU.flatMap(item=>[item.price_cents,...(item.size?[item.price_cents+item.size.Full]:[])]))];
export const FIXED_PHRASES=[
 {id:"greeting",text:GREETING},{id:"spice",text:ORDER_SPICE_QUESTION},
 {id:"hot",text:'By "hot", do you mean Spicy or Extra Spicy?'},{id:"size",text:"Half or Full for "},
 {id:"anything_else",text:"Anything else?"},{id:"readback",text:"Please check: "},
 {id:"unavailable",text:"That dish isn't on this menu. Would you like "},{id:"unavailable_alternate",text:"I don't have that dish on this menu. Would you like "},
 {id:"ack_ok",text:"Okay. "},{id:"ack_got",text:"Got it. "},
 {id:"stall",text:"One moment. "},
 {id:"failure",text:"I'm having trouble speaking. Please check the text reply."},
 ...["Your current subtotal is ","I can't verify serving sizes. Staff can advise.","Which style or protein would you like?","from "," for "].map((text,index)=>({id:`answer_scope_${index}`,text})),
 {id:"added",text:"Added "},{id:"removed",text:"Removed "},{id:"noted",text:"Noted. "},
 {id:"fallback",text:"Could you say that again? You can order or ask about the menu."},
 {id:"menu_fallback",text:`${MENU_FALLBACK} ${CATEGORY_LIST}`},{id:"categories",text:CATEGORY_LIST},
 {id:"want_more",text:"Want more?"},{id:"pickup_name",text:"What name for pickup?"},
 {id:"goodbye",text:"Goodbye! Thanks for calling Karahi House."},
 {id:"hello",text:"Hello! Would you like to order or ask about the menu?"},
 {id:"welcome",text:"You're welcome! Anything else?"},
 {id:"pending_acceptance",text:"Your demo request is pending staff acceptance. It has not been accepted by the restaurant."},
 {id:"voice_order_goodbye",text:VOICE_ORDER_GOODBYE},
 {id:"tax_disclosure",text:"tax is not configured."},{id:"pickup_readback",text:"Pickup, payment at pickup."},
 ...["Add it?","No problem. ","I missed part of that. Please repeat the item or choice in English.","Which existing item should I change?","Pickup is about 30 minutes; staff must confirm.","or","Should I add ","Add those items, or replace the current order?","I missed part of that item. Please repeat it in English.","Left those changes out. Anything else?"].map((text,index)=>({id:`recovery_${index}`,text})),
 ...["What else would you like?","Which item should I remove? You can also say cancel.","I'm here. Which item should I remove?","isn't in your cart. Which item should I remove?","What should I fix?","Add ","of each item in that category?","Please say yes to add those items, or no to leave them out.","Left those items out. Anything else?","Would they prefer vegetarian food, chicken, or something else?","This demo is pickup only. ","What name should I put on the pickup request?","Which existing item should I replace, and with what?","Which biryani: chicken, lamb, goat, or vegetable?","Red Bull isn't on this menu. Did you mean ","left.","total.","hundred","thousand"].map((text,index)=>({id:`client_followup_${index}`,text})),
 ...[" for the order. ","Did you mean ","Updated: ","You have ","Which existing item should I remove?","Which category would you like?","Which protein and karahi style would you like?","No problem. Anything else?","The team needs to review that before any order is accepted. What callback number should they use?",`I couldn't confirm that request, so I've marked it for staff review. ${CATEGORY_LIST} Which category would you like?`,"dollars","dollar","cents","cent","and"].map((text,index)=>({id:`common_${index}`,text})),
 ...MENU.filter(item=>item.size).map(item=>({id:`size_question_${item.id}`,text:`Half or Full for ${item.name}?`})),
 ...["Chicken, Lamb or Goat?","Chicken, Lamb, Goat or Beef?","Chicken, Lamb or Beef?","Keema Karahi or Keema Naan?","Which korma: Chicken, Goat or Lamb?","Which chicken dish: karahi, tikka masala or korma?"].map((text,index)=>({id:`family_question_${index}`,text})),
 ...["desserts","drinks","breads","rice","kids","starters","bbq","vegetarian",...MENU_CATEGORIES.map(category=>`category:${category}`)].flatMap((key,index)=>{
   const pages=[];for(let offset=0;offset<84;offset+=5){const page=browsePage(key,offset);if(offset&&page.next.offset<=5)break;pages.push({id:`browse_${index}_${offset}`,text:page.reply});}return pages;
 }),
 ...Array.from({length:100},(_,index)=>({id:`number_${index}`,text:String(index)})),
 ...priceValues.map(cents=>({id:`price_${cents}`,text:`$${(cents/100).toFixed(2)}`})),
 ...["and ","Subtotal ","Pickup, payment at pickup. Is that correct?"].map((text,index)=>({id:`connector_${index}`,text})),
 ...["Half","Full",...MODIFIERS.spice_level.options].map((text,index)=>({id:`modifier_${index}`,text})),
 ...MODIFIERS.spice_level.options.map((spice,index)=>({id:`order_spice_reply_${index}`,text:`${spice} for the order. Anything else?`})),
 ...MENU.map(item=>({id:`item_${item.id}`,text:item.name}))
].filter((phrase,index,all)=>all.findIndex(other=>other.text===phrase.text)===index);
export const AUDIO_VOICE="aura-2-thalia-en:linear16:24000:v2";
export const audioFile=(text:string)=>`${createHash("sha256").update(`${AUDIO_VOICE}:${auraPronunciation(text)}`).digest("hex")}.pcm`;
export const AUDIO_IDENTITY=createHash("sha256").update(JSON.stringify({voice:AUDIO_VOICE,menu:MENU_SOURCE_SHA256,phrases:FIXED_PHRASES.map(phrase=>[phrase.text,audioFile(phrase.text)])})).digest("hex");
