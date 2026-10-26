import { MENU } from "./menu";
import { Match, RecognitionAnalysis, RecognitionIssue, analyzeUtterance, extractQuantityHint, extractVariantHints } from "./matcher";
import { speechText, speechTokens } from "./speech";
import { similarity } from "./phonetic";
const MENU_BY_ID = new Map(MENU.map(item => [item.id, item]));
const TARGET_LABELS = new Map(MENU.map(item => [item.id, [item.name,...item.aliases].map(speechTokens)]));
const CONJUNCTION_NAMES = MENU.flatMap(item => [item.name,item.website_name]
  .filter((name):name is string => Boolean(name) && /\b(?:and|aur|plus)\b/i.test(name!)).map(name=>name.toLowerCase()));

export interface OrderSegment { action:"add"|"remove"|"replace"; text:string; start:number; end:number; target?:string }
export interface OrderEntry { itemId:string; qty:number; portion?:"half"|"full"; spiceLevel?:string; spiceSource?:"order"|"override"; notes?:string[]; changed?:boolean; match?:Match }
export interface RemovalQuantityChoice { itemId:string; key:string; available:number; target:string }
export interface CorrectionPlan { segments:OrderSegment[]; entries:OrderEntry[]; issues:RecognitionIssue[]; question?:string; changed:Match[]; replaceIndex?:number; blockedSegment?:OrderSegment; removalQuantity?:RemovalQuantityChoice }
export const orderEntryKey=(entry:OrderEntry)=>JSON.stringify([entry.itemId,entry.portion??null,entry.spiceLevel??null,[...(entry.notes??[])].sort()]);
export function removalAmount(text:string,available:number):{qty?:number;invalid?:boolean}{
  const quantity=extractQuantityHint(text),all=/\b(?:all|everything|whole order|entire order)\b/i.test(text),both=/\bboth\b/i.test(text);
  if(both&&(available!==2||quantity!==undefined&&quantity!==2))return {invalid:true};
  if(all&&quantity!==undefined&&quantity!==available)return {invalid:true};
  const qty=all?available:both?2:quantity;
  return qty!==undefined&&(!Number.isSafeInteger(qty)||qty<1||qty>available)?{invalid:true}:{qty};
}
export function removalQuantityQuestion(name:string,available:number,alternate=false):string{
  const choices=available===2?"one or both":`one or all ${available}`;
  return alternate?`How many ${name}: ${choices}?`:`Remove ${choices} ${name}?`;
}
const MARKER=/\b(?:no\s*[, ]*\s*wait|i\s+mean|actually|wait|nahi|nahin|make\s+(?:it|that)|change\s+(?:it|that)(?:\s+to)?|take\s+it\s+off|hata|nikal|remove|delete|cancel|scrap|replace|swap|switch)\b/gi;
export const isRemovalCommand=(text:string)=>/\b(?:remove|delete|cancel|scrap|take\s+it\s+off|hata|nikal)\b/i.test(text);
export function hasCorrectionMarkers(text:string):boolean{
  if(/\b(?:how long|wait time|how much time)\b/i.test(text))return false;
  if(/\bmake (?:it|that) (?:quick|fast|spicy|extra spicy|mild|hot|medium|no spice)\b/i.test(text)&&!/(?:actually|wait|nahi|remove|replace|instead)/i.test(text))return false;
  return new RegExp(MARKER.source,"i").test(text)||/\binstead\b/i.test(text);
}
function meaningful(text:string){return !/^(?:\s|[,!.]|no\b|and\b|aur\b|uh\b|um\b)*$/i.test(text);}
export function segmentLocalCorrection(text:string):OrderSegment[]{
  const markers=[...text.matchAll(new RegExp(MARKER.source,"gi"))];
  if(!markers.length&&/\binstead\s*[.!]?$/i.test(text))return [{action:"replace",text:text.replace(/\binstead\s*[.!]?$/i,"").trim(),start:0,end:text.length}];
  const segments:OrderSegment[]=[];
  const push=(action:OrderSegment["action"],body:string,start:number,end:number,target?:string)=>{
    body=body.replace(/^\s*[,!.]+\s*|\s*[,!.]+\s*$/g,"").replace(/\binstead\s*$/i,"").trim();
    if(!body||!meaningful(body))return;
    // Conjunctions inside a named dish are not operation boundaries.
    const lowerBody=body.toLowerCase();
    const protectedSpans=CONJUNCTION_NAMES.flatMap(name=>{
      const at=lowerBody.indexOf(name);return at<0?[]:[[at,at+name.length]];
    });
    const boundaries=[...body.matchAll(/\b(?:and|aur|plus)\b/gi)].filter(found=>!protectedSpans.some(([a,b])=>found.index!>=a&&found.index!<b));
    let from=0,kind=action;
    for(const boundary of boundaries){
      const part=body.slice(from,boundary.index).trim();
      if(part)segments.push({action:kind,text:part,start,end,target});
      from=boundary.index!+boundary[0].length;
      const rest=body.slice(from);
      kind=action==="remove"&&!/^\s*(?:add|give|bring|get|i want|aik|ek|one|two|three|\d)/i.test(rest)?"remove":"add";
    }
    const part=body.slice(from).trim();if(part)segments.push({action:kind,text:part,start,end,target});
  };
  if(markers.length&&markers[0].index!>0)push("add",text.slice(0,markers[0].index),0,markers[0].index!);
  for(let i=0;i<markers.length;i++){
    const marker=markers[i],start=marker.index!+marker[0].length,end=markers[i+1]?.index??text.length;
    let body=text.slice(start,end),target:string|undefined;
    const remove=isRemovalCommand(marker[0]);
    if(!body.trim()&&/^take\s+it\s+off$/i.test(marker[0]))body="it";
    if(/^(?:replace|swap|switch)$/i.test(marker[0])){
      const pair=body.match(/^\s*(.+?)\s+(?:with|for|to)\s+(.+)$/i);
      if(pair){target=pair[1];body=pair[2];}else body="";
    }
    push(remove?"remove":"replace",body,start,end,target);
  }
  return segments;
}
export function targetIndexes(entries:OrderEntry[],text:string):number[]{
  const note=text.match(/\b(?:no|without|notes?)\b.*$/i)?.[0];
  const matchingNotes=note?new Set(entries.flatMap((entry,index)=>(entry.notes??[]).some(value=>speechText(value)===speechText(note))?[index]:[])):undefined;
  if(note&&!matchingNotes!.size)return [];
  if(/\bhot\b/i.test(text))return [];
  const spice=/\bextra spicy\b/i.test(text)?"Extra Spicy":/\bmild\b/i.test(text)?"Mild Spice":/\bmedium\b/i.test(text)?"Medium Spice":/\bspicy\b/i.test(text)?"Spicy":undefined;
  const portion=extractVariantHints(text).portion;
  const words=speechTokens(note?text.slice(0,text.indexOf(note)):text).filter(word=>!["the","a","an","it","that","last","one","two","three","four","five","six","seven","eight","nine","ten","ek","aik","ik","ikk","do","teen","tinn","chaar","char","paanch","panj","all","both","of","them","make","to","hi","now","lead","name","please","item","dish","spice","mild","medium","extra","spicy","half","full","only","just","i","wanted","want","need","is","enough","quantity","total"].includes(word)&&!/^\d+$/.test(word));
  if(!words.length)return /\b(?:it|that|last)\b/i.test(text)&&entries.length?[entries.length-1]:[];
  const ranked=entries.map((entry,index)=>({index,score:matchingNotes&&!matchingNotes.has(index)||spice&&entry.spiceLevel!==spice||portion&&entry.portion!==portion?0:Math.max(...TARGET_LABELS.get(entry.itemId)!.map(tokens=>words.reduce((score,word)=>{
    const best=Math.max(0,...tokens.map(token=>token===word?1:similarity(word,token)>=.86?.8:0));return score+best;
  },0)))})).sort((a,b)=>b.score-a.score);
  const best=ranked[0]?.score??0;
  // One shared word in an otherwise unresolved food target is insufficient.
  // Query coverage matters as well as the winning cart-relative margin.
  return best>=.8&&best/words.length>=.8?ranked.filter(row=>Math.abs(row.score-best)<.08).map(row=>row.index):[];
}
function asMatch(entry:OrderEntry):Match{
  const item=MENU_BY_ID.get(entry.itemId)!;
  return {...entry.match,itemId:item.id,name:item.name,heard:entry.match?.heard??item.name,score:1,start:0,end:1,qty:entry.qty,
    portion:entry.portion,spiceLevel:entry.spiceLevel,notes:entry.notes??[]};
}
// Local action interpreter. It never prices orders and never trusts model IDs.
export function planLocalCorrection(text:string,initial:OrderEntry[],analyze:(text:string)=>RecognitionAnalysis=analyzeUtterance):CorrectionPlan|undefined{
  if(!hasCorrectionMarkers(text))return;
  const segments=segmentLocalCorrection(text);
  if(!segments.length)return {segments,entries:initial.map(entry=>({...entry})),issues:[],question:"Which existing item should I change?",changed:[]};
  if(!initial.length&&segments.every(segment=>segment.action!=="remove")&&!segments.some(segment=>analyze(segment.text).matches.length||analyze(segment.text).issues.length)&&!segments.some(segment=>extractQuantityHint(segment.text)!==undefined||extractVariantHints(segment.text).portion))return;
  let entries:OrderEntry[]=initial.map(entry=>({...entry,notes:[...(entry.notes??[])]}));
  const issues:RecognitionIssue[]=[];
  let lastUnresolved:RecognitionIssue|undefined;
  let replaceIndex:number|undefined,blockedSegment:OrderSegment|undefined;
  let removalQuantity:RemovalQuantityChoice|undefined;
  const finish=(question?:string):CorrectionPlan=>({segments,entries,issues,question,replaceIndex,blockedSegment,removalQuantity,changed:entries.filter(entry=>entry.changed).map(asMatch)});
  for(const segment of segments){
    blockedSegment=segment;
    if(segment.action==="remove"){
      const indexes=/\b(?:everything|whole order|all items|entire order)\b/i.test(segment.text)?entries.map((_,i)=>i):targetIndexes(entries,segment.text);
      const whole=/\b(?:everything|whole order|all items|entire order)\b/i.test(segment.text);
      const key=orderEntryKey;
      if(indexes.length!==1&&!whole&&new Set(indexes.map(index=>key(entries[index]))).size!==1)return finish("Which existing item should I remove?");
      if(!indexes.length)return finish("Which existing item should I remove?");
      const available=indexes.reduce((sum,index)=>sum+entries[index].qty,0),amount=removalAmount(segment.text,available);
      if(amount.invalid)return finish("How many of that existing item should I remove?");
      const qty=amount.qty;
      if(qty===undefined&&!whole&&available>1){
        const entry=entries[indexes[0]];removalQuantity={itemId:entry.itemId,key:key(entry),available,target:segment.text};
        return finish(removalQuantityQuestion(MENU_BY_ID.get(entry.itemId)!.name,available));
      }
      if(qty!==undefined&&!whole){
        if(!Number.isSafeInteger(qty)||qty<1||qty>available)return finish("How many of that existing item should I remove?");
        let remaining=qty;
        for(const index of indexes){const count=Math.min(remaining,entries[index].qty);entries[index]={...entries[index],qty:entries[index].qty-count,changed:count>0||entries[index].changed};remaining-=count;}
        entries=entries.filter(entry=>entry.qty>0);continue;
      }
      entries=entries.filter((_,index)=>!indexes.includes(index));continue;
    }
    const analysis=analyze(segment.text);
    if(segment.action==="add"){
      entries.push(...analysis.matches.map(match=>({...match,changed:true,match})));
      issues.push(...analysis.issues);
      const last=analysis.issues[analysis.issues.length-1];
      lastUnresolved=last&&last.end>=Math.max(0,...analysis.matches.map(match=>match.end))?last:undefined;
      continue;
    }
    // A replacement may supersede an unresolved mention made earlier in this
    // turn. It replaces that logical slot, never the unrelated resolved cart.
    if(!segment.target&&lastUnresolved){
      if(analysis.matches.length===1&&!analysis.issues.length){
        const match=analysis.matches[0],prior=lastUnresolved.candidates[0];
        const qty=match.quantityExplicit?match.qty:prior?.qty??1;
        if(!Number.isSafeInteger(qty)||qty<1||qty>50)return finish("Please give a quantity from one to fifty.");
        issues.splice(issues.indexOf(lastUnresolved),1);lastUnresolved=undefined;
        entries.push({...match,qty,portion:match.portion??prior?.portion,changed:true,match});
        continue;
      }
      return finish(lastUnresolved.question);
    }
    let indexes:number[];
    if(segment.target)indexes=targetIndexes(entries,segment.target);
    else {
      const references=targetIndexes(entries,segment.text);
      if(references.length>1)return finish("Which existing item should I change?");
      const named=analysis.matches.length===1?entries.flatMap((entry,index)=>entry.itemId===analysis.matches[0].itemId?[index]:[]):[];
      indexes=named.length?named:entries.length?[entries.length-1]:[];
    }
    if(indexes.length!==1)return finish("Which existing item should I change?");
    const index=indexes[0],previous=entries[index];
    const qty=extractQuantityHint(segment.text)??(analysis.matches[0]?.quantityExplicit?analysis.matches[0].qty:undefined);
    if(qty!==undefined&&(!Number.isSafeInteger(qty)||qty<1||qty>50))return finish("Please give a quantity from one to fifty.");
    if(analysis.issues.length){
      const issue=analysis.issues[0];
      // A bare family in a quantity-only correction refers to the known target,
      // unless the caller explicitly requests another protein/style.
      const hints=extractVariantHints(segment.text);
      if(issue.reason==="ambiguous"&&issue.candidates.some(candidate=>candidate.itemId===previous.itemId)&&!hints.protein&&qty!==undefined){
        entries[index]={...previous,qty,changed:true};continue;
      }
      issues.push(...analysis.issues);
      replaceIndex=index;
      return finish(issue.question);
    }
    if(analysis.matches.length){
      if(analysis.matches.length!==1)return finish("Please state the replacement item separately.");
      const match=analysis.matches[0];
      entries[index]={...match,qty:match.quantityExplicit?match.qty:qty??previous.qty,portion:match.portion??(match.itemId===previous.itemId?previous.portion:undefined),
        spiceLevel:match.spiceLevel??(match.itemId===previous.itemId?previous.spiceLevel:undefined),spiceSource:match.spiceLevel?"override":match.itemId===previous.itemId?previous.spiceSource:undefined,notes:match.notes?.length?match.notes:match.itemId===previous.itemId?previous.notes:[],changed:true,match};
    }else{
      const portion=extractVariantHints(segment.text).portion;
      if(qty===undefined&&!portion)return finish("Which item and quantity or size should I change?");
      if(portion&&!MENU_BY_ID.get(previous.itemId)!.size)return finish("That item has no Half/Full option. Which item should I change?");
      entries[index]={...previous,qty:qty??previous.qty,portion:portion??previous.portion,changed:true};
    }
  }
  return finish();
}
