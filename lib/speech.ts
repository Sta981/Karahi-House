import { MENU } from "./menu";

// Lexical normalization only. Keep negation, quantities, spice, size and item
// numbers. Never stem arbitrary words (brains/chips are menu words).
const PLURALS: Record<string,string> = {
  naans:"naan",nans:"nan",rotis:"roti",pakoras:"pakora",pakodas:"pakoda",
  kababs:"kabab",kebabs:"kebab",kabobs:"kabob",cabobs:"cabob",sodas:"soda",
  lassis:"lassi",lasis:"lasi",samosas:"samosa",samosay:"samosa",botis:"boti",
  papadams:"papadam",papadums:"papadum",papads:"papad",burgers:"burger",
};
const FILLERS = new Set(["um","uh","erm","umm","uhh","please","plz","sir","brother","bro","yaar","bhai","jaan","packing","parcel","takeout","regular","chahiye","dena","dein","deejiye","dijiye","deyo","deo","diyo","dyo","chahida","chahide","wali","wala"]);
const FLAVORS=[...new Set(MENU.filter(item=>/lassi$/i.test(item.name)).map(item=>item.name.toLowerCase().split(" ")[0]))];
const BREAD_CONTEXT=new Set(["garlic","plain","cheese","chili","onion","keema"]);
const NAAN_MISHEARINGS=new Set(["none","knot","nun","non"]);
export function speechTokens(text:string):string[]{
  let value=text.toLowerCase().replace(/\bsaath\s+mein\b/g,"and").replace(/\bde\s+(?:dein|do|dena)\b/g," ");
  // A fused bread mishearing is repaired only as an ordering fragment. It
  // cannot rewrite a customer's name, callback, or an arbitrary sentence.
  if(/^(?:(?:i|would|like|want|need|add|get|me|please|can|have|a|an|one|two|three|four|too|to|for|\d+)\s+)*ganina(?:\s+(?:please|bread|naan))?[.!]?$/i.test(value.trim()))value=value.replace(/\bganina\b/g,"garlic naan");
  let tokens=value.replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean).map(token=>PLURALS[token]??token).filter(token=>!FILLERS.has(token));
  tokens=tokens.filter((token,index)=>index===0||token!==tokens[index-1]);
  // Context-only STT repair. "none" elsewhere retains its ordinary meaning.
  tokens=tokens.map((token,index)=>NAAN_MISHEARINGS.has(token)&&(BREAD_CONTEXT.has(tokens[index-1])||BREAD_CONTEXT.has(tokens[index+1]))?"naan":token);
  // Trailing flavor stays inside this item clause; never cross a conjunction.
  for(let i=0;i<tokens.length-1;i++)if(["lassi","lasi"].includes(tokens[i])&&FLAVORS.includes(tokens[i+1])){
    [tokens[i],tokens[i+1]]=[tokens[i+1],tokens[i]];
  }
  return tokens;
}
export const speechText=(text:string)=>speechTokens(text).join(" ");
const FULL_NAMES=new Map<string,string[]>();
for(const item of MENU)for(const name of [item.name,item.website_name])if(name){
  const key=speechText(name);FULL_NAMES.set(key,[...new Set([...(FULL_NAMES.get(key)??[]),item.id])]);
}
export function exactFullNameIds(text:string):string[]{return FULL_NAMES.get(speechText(text))??[];}
