import { createHash } from "node:crypto";
import { GREETING,ORDER_SPICE_QUESTION } from "../lib/dialog";
import { MENU,MODIFIERS,MENU_SOURCE_SHA256 } from "../lib/menu";
import { auraPronunciation } from "./pronunciation.mjs";
export const FIXED_PHRASES=[
 {id:"greeting",text:GREETING},{id:"spice",text:ORDER_SPICE_QUESTION},
 {id:"hot",text:'By "hot", do you mean Spicy or Extra Spicy?'},{id:"size",text:"Half or Full for "},
 {id:"anything_else",text:"Anything else?"},{id:"readback",text:"Please check: "},
 {id:"unavailable",text:"That dish isn't on this menu. Would you like "},{id:"unavailable_alternate",text:"I don't have that dish on this menu. Would you like "},
 {id:"ack_ok",text:"Okay. "},{id:"ack_got",text:"Got it. "},
 {id:"no_add",text:"No items added. "},{id:"added",text:"Added "},{id:"removed",text:"Removed "},{id:"noted",text:"Noted. "},
 ...["Half","Full",...MODIFIERS.spice_level.options].map((text,index)=>({id:`modifier_${index}`,text})),
 ...["RICE","ROTI","RAITA","KHEER","PAPADAM","GARLIC_NAAN_BREAD","CHICKEN_WHITE_KARAHI","CHICKEN_BIRYANI","MANGO_LASSI"].map(id=>{
   const item=MENU.find(item=>item.id===id);if(!item)throw Error("Audio fragment is not on final menu");return {id:`item_${id}`,text:item.name};
 })
];
export const AUDIO_VOICE="aura-2-thalia-en:linear16:24000:v2";
export const audioFile=(text:string)=>`${createHash("sha256").update(`${AUDIO_VOICE}:${auraPronunciation(text)}`).digest("hex")}.pcm`;
export const AUDIO_IDENTITY=createHash("sha256").update(JSON.stringify({voice:AUDIO_VOICE,menu:MENU_SOURCE_SHA256,phrases:FIXED_PHRASES.map(phrase=>[phrase.text,audioFile(phrase.text)])})).digest("hex");
