// Development-only relabeling. No held-out file or matcher predictions are inputs.
import { readFileSync } from "node:fs";
import { TEXT_CASES } from "./text-cases.mjs";
import { STRICT_SLOT_CASES } from "./strict-slot-labels.mjs";
import { MESSY_CASES } from "./messy-cases.mjs";
import { SIMULATED_STT_CASES } from "./simulated-stt-cases.mjs";
const source = JSON.parse(readFileSync("lib/menu-source.json", "utf8"));
const previous = JSON.parse(readFileSync("eval/archive/previous-menu/cases.json", "utf8"));
const fixedIds = { "brains-karahi":"BRAINS_KARAHI", "butter-tikka-masala":"BUTTER_TIKKA_MASALA",
  "chicken-seekh-kebab":"CHICKEN_SEEKH_KABAB", "beef-seekh-kebab":"BEEF_SEEKH_KABAB", "lamb-seekh-kebab":"LAMB_SEEKH_KABAB",
  "garlic-naan":"GARLIC_NAAN_BREAD", "plain-naan":"PLAIN_NAAN_BREAD", "cheese-naan":"CHEESE_NAAN_BREAD", "onion-naan":"ONION_NAAN",
  "veggie-samosa":"VEG_SAMOSAS", "plain-rice":"RICE" };
const families = {"lahori-karahi":"LAHORI_KARAHI", "white-karahi":"WHITE_KARAHI", "shinwari-karahi":"SHINWARI_KARAHI", "black-pepper-karahi":"KARAHI_BLACK_PEPPER"};
export function finalId(id, protein) {
  if (families[id]) return protein ? `${protein.toUpperCase()}_${families[id]}` : null;
  const mapped = fixedIds[id] ?? id.toUpperCase().replaceAll("-","_");
  return source.items.some(item => item.id === mapped) ? mapped : null;
}
const strict = new Map(STRICT_SLOT_CASES.map(row=>[row.id,row.items]));
const mapItem = item => ({...item,itemId:finalId(item.itemId,item.protein)});
const generic = text => /\b(?:chicken|chikan|chiken|murgh)\s+(?:karahi|kadai|kadhai|kirby)\b/i.test(text) && !/\b(?:lahori|white|shinwari|shinvari|pepper|keema)\b/i.test(text);
export const CHICKEN_CHOICES = source.items.filter(item=>item.protein === "Chicken" && /karahi/i.test(item.name)).map(item=>item.id);
const seekh = source.items.filter(item=>/seekh/i.test(item.name)).map(item=>item.id);
// Explicit follow-up behavior changes, separate from menu migration. These
// labels come from the user's requested safety rules, never model predictions.
export const FOLLOWUP_LABEL_CHANGES = [
  {suite:"dev",id:"aliases-05",reason:"Distinctive maghaz token proposes Brains Karahi; confirm the actual dish/preparation."},
  {suite:"dev",id:"aliases-08",reason:"Palak Paneer is not listed; offer Saag Paneer without a silent alias substitution."},
  {suite:"dev",id:"aliases-17",reason:"A standalone samosa token must be confirmed."},
  {suite:"dev",id:"code_switch-04",reason:"A standalone samosa token must be confirmed; retain quantity four."},
  {suite:"dev",id:"code_switch-13",reason:"Confirm samosa; immediately add the clear Mango Lassi without losing quantities."},
  {suite:"dev",id:"code_switch-17",reason:"Approved canonical-name policy: exact Kheer and full Gulab Jamun names resolve immediately."},
  {suite:"messy",id:"messy-07",reason:"Approved partial-cart policy: the clear Mango Lassi enters immediately; only garlik naan waits."},
  {suite:"simulated",id:"simulated-08",reason:"Palak near-miss is unavailable; proposed Saag Paneer has source protein null, not Paneer."},
];
const singleTokenChoices={"aliases-05":"BRAINS_KARAHI","aliases-17":"VEG_SAMOSAS","code_switch-04":"VEG_SAMOSAS","code_switch-13":"VEG_SAMOSAS"};
export const CURRENT_TEXT_CASES = TEXT_CASES.map(row=>{
  let expected = {...row.expected};
  const items = strict.get(row.id) ?? [];
  if (row.id === "aliases-07") expected={disposition:"unavailable"};
  else if (row.id === "aliases-08") expected={disposition:"unavailable",candidates:["SAAG_PANEER"]};
  else if (singleTokenChoices[row.id]) expected={disposition:"clarify",candidates:[singleTokenChoices[row.id]]};
  else if (row.id === "aliases-13") expected={disposition:"clarify",candidates:["GOAT_BIRYANI","LAMB_BIRYANI"]};
  else if (generic(row.text)) expected={disposition:"clarify",candidates:CHICKEN_CHOICES};
  else if (items.some(item=>families[item.itemId] && !item.protein)) expected={disposition:"clarify",
    candidates:source.items.filter(item=>item.id.endsWith(families[items[0].itemId])).map(item=>item.id)};
  else if (expected.disposition === "match") expected={disposition:"match",items:items.map(mapItem)};
  else if (row.text === "seekh kebab") expected={disposition:"clarify",candidates:seekh};
  else if (row.text === "chicken curry") expected={disposition:"clarify",candidates:["CHICKEN_LAHORI_KARAHI","CHICKEN_WHITE_KARAHI","KORMA_CHICKEN"]};
  else if (expected.candidates) expected={...expected,candidates:expected.candidates.map(id=>finalId(id))};
  return {...row,expected};
});
const line = (itemId,qty=1,size=null,spice=null)=>({itemId,qty,variantLabel:size,spiceLevel:spice});
const medium = cart => cart.map(entry=>({...entry,spiceLevel:source.items.find(item=>item.id === entry.itemId).spice ? "Medium Spice" : null}));
const initialCarts = [
  [line("GARLIC_NAAN_BREAD",2)], [line("CHICKEN_BIRYANI")], [line("CHICKEN_LAHORI_KARAHI",1,"Half")],
  [line("BEEF_SEEKH_KABAB",2)], [line("ROTI",3)], [line("GOAT_SHINWARI_KARAHI",1,"Full")],
  [line("GARLIC_NAAN_BREAD",2),line("MANGO_LASSI")],
  [line("CHICKEN_WHITE_KARAHI",1,"Half"),line("PLAIN_NAAN_BREAD",3)],
  [line("GARLIC_NAAN_BREAD")], [line("CHICKEN_LAHORI_KARAHI",1,"Half"),line("GARLIC_NAAN_BREAD")],
];
export const CURRENT_MESSY_CASES = MESSY_CASES.map((row,index)=>{
  const original=row.turns;
  const clarification=original[0].clarification;
  const start=initialCarts[index];
  const turns=clarification ? [{text:original[0].text,cart:row.id==="messy-07"?[line("MANGO_LASSI")]:[],clarification:true},
    {text:original[1].text,cart:start,phase:"ask_spice"}] : [{text:original[0].text,cart:start,phase:"ask_spice"}];
  turns.push({text:"Medium Spice",cart:medium(start),phase:"open"});
  if (row.tags.includes("quantity-correction")) turns.push({text:original[1].text,cart:medium(start.map((entry,at)=>at === start.length-1 ? {...entry,qty:2} : entry)),phase:"open"});
  return {...row,turns};
});
export const CURRENT_SIMULATED_CASES=SIMULATED_STT_CASES.map(row=>({...row,
  expectedDisposition: ["simulated-07","simulated-08"].includes(row.id) ? "unavailable" : ["simulated-01","simulated-02"].includes(row.id) ? "clarify" : "match",
  ...(row.id === "simulated-08" ? {candidateItems:[{itemId:"SAAG_PANEER",qty:1,protein:null,portion:null}]} : {}),
  items:["simulated-07","simulated-08"].includes(row.id) ? [] : row.items.map(mapItem)}));

// Every changed disposition and every identity/modifier migration is visible.
export const MENU_CASE_CHANGES=[];
for (const [suite,current,key] of [["dev",CURRENT_TEXT_CASES,"text"],["messy",CURRENT_MESSY_CASES,"messy"],["simulated",CURRENT_SIMULATED_CASES,"simulated"]]) {
  for (const row of current) {
    const before=previous[key].find(entry=>entry.id===row.id);
    const oldDisposition=before.expected?.disposition ?? before.expectedDisposition ?? (before.retired ? "unavailable" : "match");
    const newDisposition=row.expected?.disposition ?? row.expectedDisposition ?? "match";
    const changedDisposition=oldDisposition !== newDisposition;
    const oldItems=[...(before.expected?.items ?? before.items ?? before.turns?.flatMap(turn=>turn.cart) ?? []),
      ...(before.expected?.candidates ?? []).map(itemId=>({itemId}))];
    const newItems=[...(row.expected?.items ?? row.items ?? row.turns?.flatMap(turn=>turn.cart) ?? []),
      ...(row.expected?.candidates ?? []).map(itemId=>({itemId}))];
    const absentOldIds=[...new Set(oldItems.filter(entry=>!source.items.some(item=>item.id===entry.itemId)).map(entry=>entry.itemId))];
    const optionChange=suite==="messy" || (oldDisposition==="match" && newDisposition==="clarify");
    const conservativeAliasRevision=["aliases-07","aliases-13","simulated-07"].includes(row.id);
    const followupChange=FOLLOWUP_LABEL_CHANGES.find(change=>change.suite===suite&&change.id===row.id);
    if (changedDisposition || absentOldIds.length || optionChange || conservativeAliasRevision) MENU_CASE_CHANGES.push({suite,id:row.id,text:row.text ?? row.turns.map(turn=>turn.text).join(" → "),
      oldDisposition,newDisposition,changedDisposition,absentOldIds,optionChange,
      changeKind:followupChange?"user_requested_followup_policy":"menu_migration",
      reason:followupChange ? `User-requested follow-up policy: ${followupChange.reason}` : row.id==="edge-04" ? "Menu alternatives changed from seekh-karahi dishes to standalone kababs; still requires explicit selection" : ["simulated-01","simulated-02"].includes(row.id) ? "Still clarification; only the historical intended-item annotation ID changed, not a successful dish identification" : conservativeAliasRevision ? row.id === "aliases-13" ? "mutton requires Goat/Lamb confirmation; no assumed protein" : "Butter Chicken not listed; do not infer Butter Tikka Masala's protein" : changedDisposition ? `${oldDisposition} → ${newDisposition}; final source changes availability or requires a protein/style choice` : optionChange ? "required order spice added; size now belongs to a protein-specific ID" : "ID changed; retained dish mapped explicitly to final source",
      replacementIds:[...new Set(newItems.map(entry=>entry.itemId))]});
  }
}
