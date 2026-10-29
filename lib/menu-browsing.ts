import { MENU, type MenuItem } from "./menu";

export const MENU_CATEGORIES=[...new Set(MENU.map(item=>item.category))];
export const MENU_FALLBACK="Sorry, I missed that. Are you asking about desserts, drinks or something else?";
export const CATEGORY_LIST=`Menu categories: ${MENU_CATEGORIES.join(", ")}.`;
export type BrowseState={key:string;offset:number};
const groups:Record<string,(item:MenuItem)=>boolean>={
 desserts:item=>item.category==="Desserts", drinks:item=>item.category==="Beverages",
 breads:item=>item.category==="Naan"&&item.id!=="RICE",
 rice:item=>item.category==="Biryani"||item.id==="RICE", kids:item=>item.category==="Kids",
 starters:item=>item.category==="Sides", bbq:item=>item.category==="BBQ Dishes",
 vegetarian:item=>item.category==="Veggie Dishes",
};
// These repairs are intent scoped. They never become order aliases.
export function browseKey(text:string):string|undefined{
 let heard=text.toLowerCase().replace(/\bin suite\b/g,"sweet");
 if(/\bwhat (?:do you|you) have in\b/.test(heard))heard=heard.replace(/\bbarracks\b/g,"desserts");
 if(/\b(?:desserts?|deserts?|sweets?|mithai|sweet)\b/.test(heard))return "desserts";
 if(/\b(?:beverages?|drinks?|cold drinks?)\b/.test(heard))return "drinks";
 if(/\b(?:breads?|naan|naans)\b/.test(heard))return "breads";
 if(/\b(?:rice|biryani|biriyani)\b/.test(heard))return "rice";
 if(/\b(?:kids?|children)\b/.test(heard))return "kids";
 if(/\b(?:starters?|appetizers?|appetisers?)\b/.test(heard))return "starters";
 if(/\b(?:bbq|barbecue|barbeque|grill(?:ed)?)\b/.test(heard))return "bbq";
 if(/\b(?:veg|veggie|vegetarian|vegetables?)\b/.test(heard))return "vegetarian";
 const protein=heard.match(/\b(chicken|lamb|goat|beef|fish|shrimp|paneer)\b/)?.[1];
 if(protein&&/\b(?:dishes|meals|items|choices|options|menu|something|anything)\b/.test(heard))return `protein:${protein}`;
 const category=MENU_CATEGORIES.find(category=>heard.includes(category.toLowerCase()));
 return category?`category:${category}`:undefined;
}
export function browsePool(key:string):MenuItem[]{
 if(key.startsWith("protein:")){const protein=key.slice(8);return MENU.filter(item=>item.protein?.toLowerCase()===protein||new RegExp(`^${protein}\\b`,"i").test(item.name));}
 return MENU.filter(groups[key]??(item=>item.category===key.slice(9)));
}
export function categoryOrderRequest(text:string):{key:string;items:MenuItem[];qtyText?:string;mixed?:boolean}|undefined{
 if(!/\b(?:add|i want|i need|i would like)\b/i.test(text)||! /\b(?:all|every|each)\b/i.test(text)||! /\b(?:section|sections|category|categories|dishes|items)\b/i.test(text))return;
 const key=browseKey(text);if(!key)return;const items=browsePool(key);if(!items.length)return;
 // Bulk expansion names exactly one real category. A second category/extra
 // request cannot silently disappear into this operation.
 if(MENU_CATEGORIES.filter(category=>text.toLowerCase().includes(category.toLowerCase())).length>1||/\b(?:and|aur|also|plus|with)\b/i.test(text))return {key,items,mixed:true};
 const invalid=/\b(?:minus|negative)\b|-\s*\d|\d+\.\d+\s+(?:of\s+)?each\b|\b(?:half|quarter)\s+(?:of\s+)?each\b/i.test(text);
 const qtyText=invalid?"invalid":text.match(/\b((?:twenty|thirty|forty)\s+(?:one|two|three|four|five|six|seven|eight|nine)|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|\d+)(?:\s+\1)?(?:\s+of)?\s+each\b/i)?.[1];
 return {key,items,qtyText};
}
export function recipientPreference(text:string):boolean{return /\b(?:something|food|meal)\s+for\s+(?:my|our|the)\s+(?:grandpa|grandma|grandfather|grandmother|parents?|family|friend|guest)\b/i.test(text);}
export function browsePage(key:string,offset=0){
 const pool=browsePool(key),start=offset>=pool.length?0:offset,items=pool.slice(start,start+5);
 // Small tails are folded into an overlapping final page of at least three.
 const page=items.length<3&&pool.length>=3?pool.slice(-3):items;
 const reply=page.map(item=>`${item.name} ${item.size?"from ":""}$${(item.price_cents/100).toFixed(2)}`).join("; ")+". Want more?";
 return {reply,next:{key,offset:start+items.length},items:page};
}
export function menuBrowsing(text:string,previous?:BrowseState):{reply:string;browsing?:BrowseState;garbled?:boolean}|undefined{
 const heard=text.toLowerCase().trim();
 if(previous&&/^(?:yes|yeah|more|yes please|show me more|what else)[.!?]*$/.test(heard)){
  if(previous.key==="menu")return {reply:`${CATEGORY_LIST} Which category would you like?`,browsing:previous};
  const page=browsePage(previous.key,previous.offset);return {reply:page.reply,browsing:page.next};
 }
 const frame=/\b(?:what (?:do you|you) have|what(?:'s| is) on|show|list|menu|options|choices|anything|something|recommend|do you (?:serve|have)|tell me about)\b/.test(heard)||/\b(?:dishes|meals|items)\b.*\b(?:available|tell me|running)\b|\b(?:which|what|tell me)\b.*\b(?:dishes|meals|items)\b|\brunning items\b/.test(heard);
 // Bare full item names retain their ordering meaning. Bare category names
 // with no canonical item of that name can still browse.
 const bare=/^(?:desserts?|deserts?|sweets?|mithai|beverages?|drinks?|cold drinks?|breads?|naan|kids|starters?|bbq|veg|vegetarian)[.!?]*$/.test(heard)||!!previous&&/^rice[.!?]*$/.test(heard);
 if(!frame&&!bare)return;
 const lookup=frame?heard.replace(/\b(in|with|of) (?:lamp|lamps)\b/g,"$1 lamb"):heard;
 const key=browseKey(lookup);
 if(key){const page=browsePage(key);return {reply:page.reply,browsing:page.next};}
 if(/\b(?:full|whole|entire|on the|your) menu\b|^menu[.!?]*$|^what (?:do you|you) have[.!?]*$|\b(?:running items|items (?:are )?running)\b/.test(heard))return {reply:CATEGORY_LIST,browsing:{key:"menu",offset:0}};
 if(/\b(?:menu|what (?:do you|you) have|options|choices)\b/.test(heard))return {reply:`${MENU_FALLBACK} ${CATEGORY_LIST}`,garbled:true};
}
