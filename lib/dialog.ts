// Deterministic order facts. The optional LLM never sets items or modifiers.
import { CATERING, MENU, MODIFIERS, RESTAURANT, MENU_SOURCE_SHA256, getItem, unitPriceCents } from "./menu";
import { Match, RecognitionAnalysis, RecognitionIssue, analyzeUtterance, matchUtterance, candidateQuestion, extractQuantityHint, extractVariantHints } from "./matcher";
import { redactPhoneNumbers } from "./privacy";
import { speechText } from "./speech";
import { hasCorrectionMarkers, isRemovalCommand, planLocalCorrection, segmentLocalCorrection, targetIndexes, orderEntryKey, removalAmount, removalQuantityQuestion, type RemovalQuantityChoice, OrderEntry, OrderSegment } from "./order-operations";
import { CartOperation, recordCartOperations } from "./cart-journal";
import { similarity } from "./phonetic";
import { speechTokens } from "./speech";
import { menuBrowsing, categoryOrderRequest, recipientPreference, CATEGORY_LIST, MENU_FALLBACK, type BrowseState } from "./menu-browsing";
import { classifyTurn, cartChanges, permitsCart, desiredTotal, equivalentLine, spokenLine, type TurnIntent } from "./turn-safety";
import { normalizeCodeSwitch } from "./code-switch";
import {isCompletionSignal,isNoMoreAnswer,wantsMore,completionWithTiming,explicitActionText,noChangeCompletion,preparationTimeQuestion} from "./closing";
import {canAcceptRecognition,recognitionConsent,recognitionKey} from "./answer-scope";

export interface CartLine {
  itemId: string; name: string; qty: number; size?: "Half" | "Full";
  variantLabel?: string; spiceLevel?: string; spiceSource?: "order" | "override";
  notes: string[]; unitPriceCents: number; unitPrice: number; sizeVerified?: boolean;
}
export interface PendingItem { itemId: string; qty: number; portion?: "half" | "full"; protein?: string; spiceLevel?: string; notes?: string[]; attempts?: number }
export interface DialogState {
  menuHash: string;
  phase: "open" | "ask_variant" | "ask_spice" | "ask_name" | "confirm" | "closed" | "catering";
  cart: CartLine[]; pending?: PendingItem; queued?: PendingItem[];
  recognition?: { issues: RecognitionIssue[]; matches: Match[]; attempts: number; replacement?:{itemId:string; index:number} };
  recognitionPrompt?:string;
  pendingCorrection?: { segment:OrderSegment; attempts:number };
  orderSpice?: string; spiceClarification?: { itemIds?: string[] };
  needsReview?: boolean; customerName?: string; callbackNumber?: string;
  orderType?: "pickup"; notes: string[]; turns: number;
  catering?: { date?: string; headcount?: number };
  lastReply?:string; recoveryMisses?:number;
  answerConfirmation?:{kind:"size"|"spice"|"yesno";value:string};
  checkoutRequested?:boolean;spiceAsked?:boolean;
  removalConfirmation?:{index:number;itemId:string;qty:number;target:string};
  removalQuantity?:RemovalQuantityChoice;
  browsing?:BrowseState; menuQuestionMisses?:number;
  repetition?:{itemId:string;choices:number[];portion?:"half"|"full";spiceLevel?:string;notes?:string[]};
  lastIntent?:TurnIntent;
  closingMode?:"correct"|"anything_else";readbackStamp?:string;
  pendingOrderList?:{text:string;cartStamp:string};
  categoryOrder?:{key:string;itemIds:string[];qtyEach:number;cartStamp:string;text:string};
}
export interface CallSummary {
  kind: "order" | "inquiry" | "catering"; status: "pending_acceptance" | "needs_review";
  demo: true; menuApproved: boolean; customerName?: string; orderType?: string;
  items: { name: string; variant?: string; qty: number; spice?: string; notes: string[]; lineTotal: number; lineTotalCents: number; sizeVerified?: boolean }[];
  subtotal: number; subtotalCents: number; notes: string[]; transcriptHint: string;
}
export interface TurnResult { reply: string; state: DialogState; matches: Match[]; operations?:CartOperation[]; summary?: CallSummary; needsLLM?: boolean; endCall?: boolean; intent?:TurnIntent; disclosure?:string[]; safetyRollback?:boolean }
export function newState(options?:Pick<DialogState,"closingMode">): DialogState { return { menuHash: MENU_SOURCE_SHA256, phase: "open", cart: [], notes: [], turns: 0,...options }; }
// Finite-answer repairs belong only to an active question, never menu aliases.
function constrainedAnswer(text:string,kind:"size"|"spice"|"yesno",choices:string[]):{value?:string;confirm?:string}{
  const tokens=speechTokens(text).filter(word=>!["the","a","one","please","size","portion","make","it","that","i","want","with"].includes(word));
  if(!tokens.length||tokens.length>4)return {};
  const heard=tokens.join(" ");
  const known:Record<string,string>=kind==="size"?{half:"half",haf:"half",haaf:"half",have:"half",bot:"half",full:"full",ful:"full",fool:"full"}:
    kind==="yesno"?{yes:"yes",yeah:"yes",yep:"yes",ya:"yes",yeas:"yes",haan:"yes",ji:"yes",correct:"yes",no:"no",nope:"no",know:"no",nah:"no",nahi:"no"}:
    {"no spice":"No Spice","not spicy":"No Spice",mild:"Mild Spice","mild spice":"Mild Spice",medium:"Medium Spice","medium spice":"Medium Spice",spicy:"Spicy",spicey:"Spicy","extra spicy":"Extra Spicy"};
  const exact=known[heard]??choices.find(choice=>choice.toLowerCase()===heard);
  if(exact&&choices.some(choice=>choice.toLowerCase()===exact.toLowerCase()))return {value:exact};
  const ranked=choices.map(value=>({value,score:Math.max(similarity(heard,value.toLowerCase()),similarity(heard,value.toLowerCase().replace(/ spice$/,"")))})).sort((a,b)=>b.score-a.score);
  if((ranked[0]?.score??0)>=.8&&ranked[0].score-(ranked[1]?.score??0)>=.08)return {confirm:ranked[0].value};
  return {};
}
export const GREETING = `Thanks for calling ${RESTAURANT.name}. What would you like?`;
export const VOICE_ORDER_GOODBYE="Thanks for calling Karahi House. Your demo request is pending staff acceptance.";
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export function cartTotalCents(cart: CartLine[]): number {
  return cart.reduce((total, line) => total + unitPriceCents(getItem(line.itemId)!, line.size) * line.qty, 0);
}
function cartSpoken(cart: CartLine[]): string {
  return cart.map(line => `${line.qty} ${line.name}${line.size ? `, ${line.size}` : ""}${line.spiceLevel ? `, ${line.spiceLevel}` : ""}${line.notes.length ? `, notes: ${line.notes.join("; ")}` : ""}`).join("; ");
}
export function buildSummary(state: DialogState, kind: CallSummary["kind"], hint: string): CallSummary {
  const subtotalCents = cartTotalCents(state.cart);
  return { kind, status: state.needsReview ? "needs_review" : "pending_acceptance", demo: true, menuApproved: RESTAURANT.menuApproved,
    customerName: state.customerName, orderType: state.orderType,
    items: state.cart.map(line => { const cents = unitPriceCents(getItem(line.itemId)!, line.size) * line.qty;
      return { name: line.name, variant: line.size, qty: line.qty, spice: line.spiceLevel, notes: line.notes,
        lineTotal: cents / 100, lineTotalCents: cents, sizeVerified: line.sizeVerified }; }),
    subtotal: subtotalCents / 100, subtotalCents, notes: state.notes, transcriptHint: hint };
}
export function requiresStaffReview(text: string): boolean {
  return /\b(?:allerg(?:y|ies|ic|ens?)|(?:speak|talk|transfer|connect)(?: me)? (?:to|with) (?:a |the )?(?:person|human|manager|staff|operator)|real person|human agent|want (?:a |the )?(?:person|manager|staff))\b/i.test(text);
}
const YES = /^(?:yes|yeah|yep|correct|haan|han|ji|okay|ok|sure)(?=$|[\s,.!])/i;
const DONE = {test:isCompletionSignal};
const reviewStamp=(s:DialogState)=>JSON.stringify([s.cart,s.customerName,s.orderType,s.needsReview??false]);
function reviewOrder(s:DialogState):string{
 s.phase="confirm";s.readbackStamp=reviewStamp(s);
 return `Please check: ${cartSpoken(s.cart)}. Subtotal ${money(cartTotalCents(s.cart))}; tax is not configured. Pickup, payment at pickup. ${s.closingMode==="anything_else"?"Anything else?":"Is that correct?"}`;
}
const spiceOptions = MODIFIERS.spice_level.options;
export const ORDER_SPICE_QUESTION=`Spice for the order: ${spiceOptions.join(", ")}?`;
function spiceFrom(text: string): string | undefined {
  const lower = text.toLowerCase();
  const exact = spiceOptions.find(option => lower.includes(option.toLowerCase()));
  if (exact) return exact;
  const phrase = /\b(?:not spicy|no mirchi)\b/.test(lower) ? "No Spice" : /\b(?:extra spicy|bohat teekha)\b/.test(lower) ? "Extra Spicy" :
    /\b(?:mild|less spice)\b/.test(lower) ? "Mild Spice" : /\bmedium\b/.test(lower) ? "Medium Spice" : /\b(?:spicy|teekha|tikha)\b/.test(lower) ? "Spicy" : undefined;
  return spiceOptions.find(option => option === phrase);
}
function notesFrom(text: string): string[] {
  const found = text.match(/(?:\b(?:notes?|special instructions?)\s*[:=]?\s+|\b(?:no (?!spice\b|mirchi\b|wait\b|make\b|actually\b|add\b|include\b|order\b)|without |on the side\b|less (?!spice\b)))(.+)$/i);
  return found ? [found[0].replace(/^(?:notes?|special instructions?)\s*[:=]?\s*/i, "").trim().slice(0, 180)] : [];
}
function applyOrderSpice(s: DialogState, spice: string) {
  s.orderSpice = spice;
  for (const line of s.cart) if (getItem(line.itemId)!.spice && line.spiceSource !== "override") {
    line.spiceLevel = spice; line.spiceSource = "order";
  }
}
function modifierQuestion(s: DialogState): string | undefined {
  if (s.pending) { s.phase = "ask_variant"; return `Half or Full for ${getItem(s.pending.itemId)!.name}?`; }
  if (s.spiceClarification) { s.phase = "ask_spice"; return 'By "hot", do you mean Spicy or Extra Spicy?'; }
  if (s.checkoutRequested && s.cart.some(line => getItem(line.itemId)!.spice && !line.spiceLevel)) {
    s.phase = "ask_spice";
    const asked=s.spiceAsked;s.spiceAsked=true;
    return asked?`Please choose: ${spiceOptions.join(", ")}.`:ORDER_SPICE_QUESTION;
  }
  if(s.checkoutRequested&&s.cart.length){if(s.customerName)return reviewOrder(s);s.phase="ask_name";return "What name for pickup?";}
  s.phase = "open";
}
function pendingQuestion(s:DialogState):string|undefined{
  if(s.categoryOrder)return `Add ${s.categoryOrder.qtyEach} of each item in that category?`;
  if(s.removalQuantity)return removalQuantityQuestion(getItem(s.removalQuantity.itemId)!.name,s.removalQuantity.available);
  if(s.removalConfirmation)return `Remove ${s.cart[s.removalConfirmation.index]?.name??"that item"}?`;
  if(s.answerConfirmation)return `Did you mean ${s.answerConfirmation.value}?`;
  if(s.pendingCorrection)return `You have ${cartSpoken(s.cart)}. Which existing item should I ${s.pendingCorrection.segment.action==="remove"?"remove":"change"}?`;
  if(s.repetition)return `${s.repetition.choices.join(" or ")} ${getItem(s.repetition.itemId)!.name}?`;
  if(s.recognition)return s.recognition.issues[0]?.question;
  if(s.pending)return `Half or Full for ${getItem(s.pending.itemId)!.name}?`;
  if(s.spiceClarification)return 'By "hot", do you mean Spicy or Extra Spicy?';
  if(s.checkoutRequested&&s.cart.some(line=>getItem(line.itemId)!.spice&&!line.spiceLevel))return ORDER_SPICE_QUESTION;
  if(s.phase==="ask_name")return "What name should I put on the pickup request?";
  if(s.phase==="confirm")return s.closingMode==="anything_else"?"Anything else?":"Is the order I read back correct?";
}
function priceTurn(s:DialogState,text:string,analysis:RecognitionAnalysis):TurnResult|undefined{
  if(!/\b(?:price|prices|cost|total|subtotal|bill|how much|how much is it)\b/i.test(text))return;
  const resume=pendingQuestion(s);
  let answer:string;
  if(/\b(?:total|subtotal|bill|how much (?:is it|so far|altogether|(?:is|for) (?:my|the|our|this) order))\b/i.test(text))answer=`Your current subtotal is ${money(cartTotalCents(s.cart))}; tax is not configured.`;
  else {
    const ids=[...new Set(analysis.matches.map(match=>match.itemId))];
    if(!ids.length&&s.pending)ids.push(s.pending.itemId);
    if(!ids.length&&s.recognition?.issues[0]?.candidates.length===1)ids.push(s.recognition.issues[0].candidates[0].itemId);
    if(!ids.length&&s.cart.length===1)ids.push(s.cart[0].itemId);
    answer=ids.length?ids.slice(0,4).map(id=>{const item=getItem(id)!;return item.size?`${item.name}: Half ${money(item.price_cents)}, Full ${money(item.price_cents+item.size.Full)}.`:`${item.name} is ${money(item.price_cents)}.`;}).join(" "):"Which item's price would you like?";
  }
  return {reply:`${answer}${resume&&!answer.endsWith("?")?` ${resume}`:""}`,state:s,matches:[]};
}
function addDraft(s: DialogState, draft: PendingItem) {
  const item = getItem(draft.itemId)!;
  const size = draft.portion === "half" ? "Half" : draft.portion === "full" ? "Full" : undefined;
  const cents = unitPriceCents(item, size);
  s.cart.push({ itemId: item.id, name: item.name, qty: draft.qty, size, variantLabel: size,
    spiceLevel: item.spice ? draft.spiceLevel ?? s.orderSpice : undefined,
    spiceSource: item.spice ? draft.spiceLevel ? "override" : s.orderSpice ? "order" : undefined : undefined,
    notes: draft.notes ?? [], unitPriceCents: cents, unitPrice: cents / 100,
    ...(item.size ? { sizeVerified: item.size_verified } : {}) });
  if (item.size && !item.size_verified && !s.notes.includes("Some size surcharges are unverified in the supplied menu.")) s.notes.push("Some size surcharges are unverified in the supplied menu.");
}
function processMatches(s: DialogState, matches: Match[]): { added: string[]; ask?: string } {
  if(matches.length&&s.phase==="confirm")s.phase="open";
  const added: string[] = [];
  for (const match of matches) {
    const draft: PendingItem = { itemId: match.itemId, qty: match.qty, portion: match.portion,
      spiceLevel: match.spiceLevel, notes: match.notes };
    const item = getItem(match.itemId)!;
    if (item.spice && match.spiceAmbiguous) s.spiceClarification = { itemIds: [...new Set([...(s.spiceClarification?.itemIds ?? []), item.id])] };
    if (item.size && !draft.portion) {
      if (!s.pending) s.pending = draft; else (s.queued ??= []).push(draft);
    } else { addDraft(s, draft); added.push(`${match.qty} ${item.name}`); }
  }
  return { added, ask: modifierQuestion(s) };
}
function decorateAnalysis(text:string,analysis:RecognitionAnalysis):RecognitionAnalysis{
  const clauses=text.split(/\b(?:and|aur|plus)\b/i);
  const urgency=text.match(/\b(?:make it quick|fast fast|as soon as possible|please hurry|hurry please|jaldi(?:\s+please)?|make it fast)\b/i)?.[0].toLowerCase();
  for(const match of [...analysis.matches,...analysis.issues.flatMap(issue=>issue.candidates)]){
    let offset=0;
    const indexed=clauses.map(part=>{const start=offset;offset+=speechTokens(part).length+1;return {part,start,end:offset-1};});
    const clause=indexed.find(part=>match.start>=part.start&&match.start<part.end)?.part??clauses.find(part=>speechText(part).includes(speechText(match.heard)))??(clauses.length===1?text:"");
    match.spiceLevel=spiceFrom(clause);match.spiceAmbiguous=/\bhot\b/i.test(clause)?true:undefined;
    match.notes=[...notesFrom(clause),...(urgency?[urgency]:[])];
  }
  return analysis;
}
function correctionOperationsTurn(s:DialogState,text:string):TurnResult|undefined{
  // Spice-only correction wording belongs to the existing local modifier
  // handler. It cannot create a new dish or invoke segmentation/model calls.
  if(hasCorrectionMarkers(text)&&spiceFrom(text)&&extractQuantityHint(text)===undefined&&!extractVariantHints(text).portion&&
      !isRemovalCommand(text)&&!/\b(?:replace|swap|switch)\b/i.test(text)){
    const analysis=analyzeUtterance(text);
    if(!analysis.issues.length&&analysis.matches.every(match=>s.cart.some(line=>line.itemId===match.itemId))){
      if(!analysis.matches.length&&s.cart.length){
        const line=s.cart[s.cart.length-1];
        if(getItem(line.itemId)!.spice){line.spiceLevel=spiceFrom(text);line.spiceSource="override";s.phase="open";return {reply:`Updated ${line.name} to ${line.spiceLevel}. ${modifierQuestion(s)??"Anything else?"}`,state:s,matches:[]};}
      }
      return;
    }
  }
  if(hasCorrectionMarkers(text)&&notesFrom(text).length&&extractQuantityHint(text)===undefined&&!extractVariantHints(text).portion&&
     !isRemovalCommand(text)&&!/\b(?:replace|swap|switch)\b/i.test(text))return;
  const initial:OrderEntry[]=[...s.cart.map(line=>({itemId:line.itemId,qty:line.qty,portion:line.size?.toLowerCase() as "half"|"full"|undefined,spiceLevel:line.spiceLevel,spiceSource:line.spiceSource,notes:line.notes})),
    ...[s.pending,...(s.queued??[])].filter((entry):entry is PendingItem=>Boolean(entry))];
  const segments=segmentLocalCorrection(text);
  if(segments.length===1&&segments[0].action==="remove"){
    const target=segments[0].text,indexes=targetIndexes(initial,target);
    if(indexes.length===1&&indexes[0]<s.cart.length){
      const index=indexes[0],item=getItem(s.cart[index].itemId)!;
      const literal=target.toLowerCase().replace(/[^a-z\s]/g," ").split(/\s+/).filter(word=>word&&!['the','now','please','one','two','three','four','five','six','seven','eight','nine','ten','a','an','ek','aik','ik','ikk','do','teen','tinn','chaar','char','paanch','panj','all','both','only','just'].includes(word)).join(" ");
      const exact=[item.name,item.website_name,...item.aliases].filter(Boolean).some(label=>label!.toLowerCase()===literal);
      const amount=removalAmount(target,s.cart[index].qty);
      if(!amount.invalid&&(amount.qty!==undefined||s.cart[index].qty===1)&&!exact&&!/^(?:it|that|last(?: item| one)?|everything|whole order|all items|entire order)$/i.test(target.trim())){
        s.removalConfirmation={index,itemId:item.id,qty:s.cart[index].qty,target};
        return {reply:`Remove ${spokenLine(s.cart[index],amount.qty??1)}?`,state:s,matches:[]};
      }
    }
  }
  const plan=planLocalCorrection(text,initial,value=>decorateAnalysis(value,analyzeUtterance(value)));
  if(!plan)return;
  s.phase="open";s.pending=undefined;s.queued=[];s.cart=[];s.pendingCorrection=undefined;
  const matches:Match[]=plan.entries.map(entry=>({itemId:entry.itemId,name:getItem(entry.itemId)!.name,qty:entry.qty,portion:entry.portion,spiceLevel:entry.spiceLevel,notes:entry.notes??[],score:1,start:0,end:1,heard:entry.match?.heard??getItem(entry.itemId)!.name}));
  const accepted:Match[]=[];
  for(const match of matches){
    if(match.portion&&!getItem(match.itemId)!.size){
      plan.issues.push({kind:"clarify",reason:"unsupported_size",heard:match.heard,start:0,end:1,candidates:[{...match,portion:undefined}],question:`${match.name} has no Half/Full option. Would you like the standard item?`});
    }else accepted.push(match);
  }
  const processed=processMatches(s,accepted);
  s.removalQuantity=plan.removalQuantity;
  for(let index=0;index<plan.entries.length;index++){const entry=plan.entries[index];const line=s.cart[index];if(line?.itemId===entry.itemId&&entry.spiceSource)line.spiceSource=entry.spiceSource;}
  if(plan.issues.length){
    const target=plan.replaceIndex!==undefined?plan.entries[plan.replaceIndex]:undefined;
    s.recognition={issues:plan.issues,matches:[],attempts:0,...(target?{replacement:{itemId:target.itemId,index:plan.replaceIndex!}}:{})};
    return {reply:plan.issues[0].question,state:s,matches:plan.changed};
  }
  if(plan.question){
    const segment=plan.blockedSegment??plan.segments[plan.segments.length-1]??{action:isRemovalCommand(text)?"remove" as const:"replace" as const,text:"",start:0,end:text.length};s.pendingCorrection={segment,attempts:0};
    if(plan.removalQuantity)return {reply:plan.question,state:s,matches:plan.changed};
    const tied=segment?.action==="remove"&&targetIndexes(initial,segment.text).length>1;
    return {reply:`${tied||segment?.action==="remove"?`You have ${cartSpoken(s.cart)||"an empty cart"}. `:""}${plan.question}`,state:s,matches:plan.changed};
  }
  return {reply:`Updated${plan.changed.length?`: ${plan.changed.map(match=>`${match.qty} ${match.name}${match.portion?`, ${match.portion}`:""}`).join("; ")}`:""}. ${processed.ask??`Subtotal ${money(cartTotalCents(s.cart))}. Anything else?`}`,state:s,matches:plan.changed};
}
function quantityReadback(matches: Match[]): string {
  return matches.filter(match => match.quantityUncertain).map(match => `Did you mean ${match.qty} ${match.name}? `).join("");
}
function recognitionTurn(s: DialogState, text: string, analysis: ReturnType<typeof analyzeUtterance>): TurnResult | undefined {
  if (!s.recognition) {
    if (!analysis.issues.length || ["ask_name", "ask_type", "closed"].includes(s.phase)) return;
    processMatches(s, analysis.matches);
    s.recognition = { issues: analysis.issues, matches: [], attempts: 0 };
    return { reply: analysis.issues[0].question, state: s, matches: analysis.matches };
  }

  const pending = s.recognition;
  const issue = pending.issues[0];
  const cancel = /^(?:no|nope|nahi|nahin|cancel|never mind)(?: please)?[.!]?$/i.test(text);
  const yes = /^(?:yes|yeah|yep|haan|han|ji|correct|that'?s right)(?=$|[\s,.!])/i.test(text);
  const negated = /\b(?:no|not|don'?t|nahi|nahin|without)\b/i.test(text);
  let selections: Match[] = [];

  if(!cancel&&!negated&&analysis.issues.length){
    const ids=new Set(analysis.issues.flatMap(entry=>entry.candidates.map(candidate=>candidate.itemId)));
    const narrowed=issue.candidates.filter(candidate=>ids.has(candidate.itemId));
    if(narrowed.length&&narrowed.length<issue.candidates.length){
      issue.candidates=narrowed;issue.question=candidateQuestion(narrowed);
      if(narrowed.length===1)selections=[{...narrowed[0],...extractVariantHints(text),requiresConfirmation:false}];
      else return {reply:issue.question,state:s,matches:[]};
    }
  }

  if (!cancel && !negated && !selections.length) {
    const explicit = analysis.matches.filter((match) => issue.candidates.some((candidate) => candidate.itemId === match.itemId));
    if (explicit.length === 1 && !analysis.issues.length) {
      const candidate = issue.candidates.find((entry) => entry.itemId === explicit[0].itemId)!;
      selections = [{ ...candidate, ...explicit[0], qty: explicit[0].quantityExplicit ? explicit[0].qty : candidate.qty,
        spiceLevel: explicit[0].spiceLevel ?? candidate.spiceLevel,
        spiceAmbiguous: explicit[0].spiceAmbiguous ?? candidate.spiceAmbiguous,
        notes: [...(candidate.notes ?? []), ...(explicit[0].notes ?? [])], requiresConfirmation: false }];
    } else if (yes && canAcceptRecognition(s) && issue.candidates.length === 1 && issue.reason !== "quantity") {
      const acknowledgement = text.split(/\b(?:and|aur|plus)\b/i)[0];
      const named=/^(?:yes|yeah|yep|haan)\s+i\s+(?:want|need|would like)\b/i.test(acknowledgement)?analyzeUtterance(acknowledgement):undefined;
      const namedIds=named?[...new Set([...named.matches,...named.issues.flatMap(entry=>entry.candidates)].map(item=>item.itemId))]:[];
      if(recognitionConsent(acknowledgement)||namedIds.length===1&&namedIds[0]===issue.candidates[0].itemId&&!named?.issues.some(entry=>entry.reason==="quantity"))selections = [{ ...issue.candidates[0], ...extractVariantHints(acknowledgement), qty: extractQuantityHint(acknowledgement) ?? issue.candidates[0].qty, requiresConfirmation: false }];
    } else if (!analysis.matches.length && !analysis.issues.length) {
      const hints = extractVariantHints(text);
      let choices = issue.candidates.filter((candidate) => hints.protein && candidate.protein === hints.protein);
      if (choices.length !== 1 && !hints.protein) {
        const fillers = new Set(["a", "an", "the", "one", "two", "three", "please", "i", "want", "would", "like", "that", "just", "me", "get", "for"]);
        const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((word) => word && !fillers.has(word) && extractQuantityHint(word) === undefined);
        choices = issue.candidates.filter((candidate) => {
          const item = getItem(candidate.itemId)!;
          return words.length > 0 && [item.name, ...item.aliases].some((label) => {
            const tokens = label.toLowerCase().split(/\s+/);
            return words.every((word) => tokens.includes(word));
          });
        });
      }
      if (choices.length === 1) selections = [{ ...choices[0], ...hints, qty: extractQuantityHint(text) ?? choices[0].qty, requiresConfirmation: false }];
    }
    if (!issue.candidates.length && analysis.matches.length && !analysis.issues.length) selections = analysis.matches;
  }

  const valid = selections.length > 0 && selections.every((match) => Number.isSafeInteger(match.qty) && match.qty >= 1 && match.qty <= 50);
  if (cancel || valid) {
    const accepted:Match[]=[];
    if (valid) {
      if(pending.replacement){
        const target=pending.replacement;
        if(s.cart[target.index]?.itemId!==target.itemId)return {reply:"Which existing entry should I replace?",state:s,matches:[]};
        s.cart.splice(target.index,1);
        pending.replacement=undefined;
      }
      accepted.push(...selections,...analysis.matches.filter(match=>!selections.some(selection=>selection.itemId===match.itemId)));
      pending.issues.push(...analysis.issues.filter(next=>!next.candidates.some(candidate=>selections.some(selection=>selection.itemId===candidate.itemId))));
    }
    pending.issues.shift();pending.attempts=0;
    const processed=processMatches(s,accepted);
    if(pending.issues.length)return {reply:pending.issues[0].question,state:s,matches:accepted};
    s.recognition=undefined;
    return {reply:`${quantityReadback(accepted)}${processed.added.length?`Added ${processed.added.join(" and ")}. `:"No problem. "}${processed.ask??"Anything else?"}`,state:s,matches:accepted};
  }

  pending.attempts++;
  // A new clear side can be accepted while an unrelated identity is pending.
  const independent=analysis.matches.filter(match=>!issue.candidates.some(candidate=>candidate.itemId===match.itemId));
  const newIssues=analysis.issues.filter(next=>!pending.issues.some(old=>next.candidates.length&&next.candidates.some(candidate=>old.candidates.some(prior=>prior.itemId===candidate.itemId))||next.heard===old.heard));
  if(newIssues.length)pending.issues.push(...newIssues);
  if(independent.length){processMatches(s,independent);pending.attempts=0;return {reply:issue.question,state:s,matches:independent};}
  if (pending.attempts >= 3) {
    s.needsReview = true;
    s.notes.push(`Needs staff review: ${pending.issues.map((entry) => entry.heard).join("; ")}. Deferred items: ${pending.matches.map((match) => `${match.qty} ${match.name}`).join("; ") || "none"}.`);
    s.recognition = undefined;
    if (s.phase === "confirm") s.phase = "open";
    return { reply: `I couldn't confirm that request, so I've marked it for staff review. Menu categories: ${[...new Set(MENU.map(item=>item.category))].join(", ")}. Which category would you like?`, state: s, matches: [] };
  }
  return { reply: issue.question, state: s, matches: [] };
}



function runTurnCore(state: DialogState, rawText: string, providedAnalysis?: RecognitionAnalysis): TurnResult {
  let text = rawText.trim();
  const s: DialogState = JSON.parse(JSON.stringify(state));
  s.turns++;
  const reply = (message: string, matches: Match[] = [], extra: Partial<TurnResult> = {}): TurnResult => ({ reply: message, state: s, matches, ...extra });
  if (s.phase === "closed") return reply("This demo request is closed. Start a new conversation for changes.");
  // Callback data stays only in private state, never in logs, notes or replies.
  if (/\b(?:callback|call ?back|phone|contact|mobile)(?:\s+number)?\b/i.test(text)) {
    if (requiresStaffReview(text)) s.needsReview = true;
    const phone = text.match(/\+?\d(?:[\s().-]*\d){6,}/)?.[0].replace(/[^\d+]/g, "");
    if (!phone || !/^\+?\d{7,15}$/.test(phone)) return reply("What number should the team use to call you back?");
    s.callbackNumber = phone;
    return reply("I've saved your callback number for this demo. Anything else?");
  }
  if (requiresStaffReview(text)) {
    s.needsReview = true;
    s.notes.push(`Staff review required: ${redactPhoneNumbers(text)}`);
    return reply("The team needs to review that before any order is accepted. What callback number should they use?");
  }
  const browsing=menuBrowsing(text,s.browsing??(s.lastReply?.includes("Menu categories:")?{key:"menu",offset:0}:undefined));
  if(browsing){
    s.browsing=browsing.browsing;
    s.menuQuestionMisses=browsing.garbled?(s.menuQuestionMisses??0)+1:0;
    // An unclear menu question is an informational recovery, never a ticket
    // disposition. Even repeated browsing failures must not flag an order.
    return reply(browsing.reply);
  }
  s.browsing=undefined;
  const price=/\b(?:price|prices|cost|total|subtotal|bill|how much)\b/i.test(text)?priceTurn(s,text,providedAnalysis??analyzeUtterance(text)):undefined;
  if(price)return price;
  if(s.removalConfirmation){
    const confirmation=s.removalConfirmation,line=s.cart[confirmation.index],answer=constrainedAnswer(text,"yesno",["yes","no"]).value;
    if(answer==="no"){s.removalConfirmation=undefined;return reply("Kept it. Anything else?");}
    if(answer!=="yes")return reply(`Remove ${line?.name??"that item"}? Please say yes or no.`);
    s.removalConfirmation=undefined;
    if(!line||line.itemId!==confirmation.itemId||line.qty!==confirmation.qty)return reply("The cart changed. Which item should I remove?");
    const qty=extractQuantityHint(confirmation.target);
    text=`remove ${qty===undefined?"":`${qty} `}${line.name}`;providedAnalysis=undefined;
  }
  const done=DONE.test(text)||/^(?:no|nope|nah|nahi)[.!]?$/i.test(text)&&s.phase==="open"&&!!s.cart.length&&!s.recognition&&!s.pendingCorrection;
  if((done||s.phase==="confirm"&&s.closingMode==="anything_else")&&isNoMoreAnswer(text))providedAnalysis={matches:[],issues:[]};
  if(done)providedAnalysis??=analyzeUtterance(text);
  const doneHasFood=!!providedAnalysis&&(providedAnalysis.matches.length>0||providedAnalysis.issues.length>0);
  if(done)s.checkoutRequested=true;
  if(done&&!doneHasFood&&s.recognition)return reply(s.recognition.issues[0].question);
  if(done&&!doneHasFood&&!s.cart.length&&!s.pending&&!s.recognition){s.phase="closed";return reply("Goodbye! Thanks for calling Karahi House.",[],{endCall:true});}
  if(done&&!doneHasFood&&s.phase==="ask_name")return reply("What name for pickup?");
  if(done&&!doneHasFood&&s.phase==="confirm"&&s.closingMode!=="anything_else")return reply("Is the order I read back correct?");
  if(s.phase==="confirm"&&s.closingMode==="anything_else"&&!doneHasFood){
    if(isNoMoreAnswer(text)){
      const complete=!s.needsReview&&!s.pending&&!s.queued?.length&&!s.recognition&&!s.pendingCorrection&&!s.pendingOrderList&&!s.categoryOrder&&!s.removalQuantity&&!s.removalConfirmation&&s.cart.length>0&&!!s.customerName&&s.cart.every(line=>{const item=getItem(line.itemId)!;return (!item.size||!!line.size)&&(!item.spice||!!line.spiceLevel);});
      if(!complete)return reply(modifierQuestion(s)??"This request needs review before it can be submitted.");
      if(s.readbackStamp!==reviewStamp(s)||!state.lastReply?.endsWith("Anything else?"))return reply(reviewOrder(s));
      s.phase="closed";return reply(VOICE_ORDER_GOODBYE,[],{summary:buildSummary(s,"order","Caller declined further items after the current read-back; staff acceptance pending."),endCall:true});
    }
    if(wantsMore(text)){s.phase="open";s.checkoutRequested=false;s.readbackStamp=undefined;return reply("What else would you like?");}
  }
  if(s.phase==="open"&&!s.recognition&&!s.pending&&!s.pendingCorrection&&wantsMore(text)&&/Anything else\?$/.test(state.lastReply??""))return reply("What else would you like?");
  // A finite completion owns the turn before the correction/notes parsers.
  // In particular, the leading "no" in a polite done answer is not a note.
  if(done&&!doneHasFood&&!spiceFrom(text)&&! /\bhot\b/i.test(text)){
    if(s.pendingCorrection||s.removalQuantity||s.removalConfirmation||s.categoryOrder)return reply(pendingQuestion(s)!);
    if(s.needsReview)return reply("This request needs staff review. What callback number should the team use?");
    const question=modifierQuestion(s);if(question)return reply(question);
  }
  // Protein repairs apply only to a pending protein choice, not food orders.
  if(s.recognition&&/^(?:got|got please)[.!]?$/i.test(text)&&s.recognition.issues[0]?.candidates.some(candidate=>candidate.protein==="Goat")){
    text="goat";providedAnalysis={matches:[],issues:[]};
  }
  // Answer matching stays inside the question's finite choice set. A new food
  // request is not coerced into a size or spice answer.
  const yesnoAnswer=constrainedAnswer(text,"yesno",["yes","no"]),yesno=yesnoAnswer.value;
  if(s.answerConfirmation){
    const revised=s.answerConfirmation.kind==="spice"?constrainedAnswer(text,"spice",s.spiceClarification?["Spicy","Extra Spicy"]:spiceOptions).value:s.answerConfirmation.kind==="size"?constrainedAnswer(text,"size",["half","full"]).value:undefined;
    if(revised){text=revised;s.answerConfirmation=undefined;providedAnalysis={matches:[],issues:[]};}
    else if(yesno==="yes"){text=s.answerConfirmation.value;s.answerConfirmation=undefined;providedAnalysis=undefined;}
    else if(yesno==="no"){s.answerConfirmation=undefined;return reply(pendingQuestion(s)??"What would you like instead?");}
    else return reply(`Did you mean ${s.answerConfirmation.value}? Please say yes or no.`);
  }else if((s.phase==="confirm"||s.recognition)&&yesnoAnswer.confirm){s.answerConfirmation={kind:"yesno",value:yesnoAnswer.confirm};return reply(`Did you mean ${yesnoAnswer.confirm}?`);}
  else if((s.phase==="confirm"||s.recognition)&&yesno){text=yesno;providedAnalysis=undefined;}
  if(!s.recognition&&!s.pendingCorrection){
    const kind=s.pending?"size":s.phase==="ask_spice"||s.spiceClarification?"spice":undefined;
    if(kind){
      const choices=kind==="size"?["half","full"]:s.spiceClarification?["Spicy","Extra Spicy"]:spiceOptions;
      const answer=constrainedAnswer(text,kind,choices);
      if(answer.confirm){s.answerConfirmation={kind,value:answer.confirm};return reply(`Did you mean ${answer.confirm}?`);}
      if(answer.value){text=answer.value;providedAnalysis={matches:[],issues:[]};}
      else if(kind==="spice"&&/^(?:spies|spice|spices|price)[.!]?$/i.test(text))return reply(pendingQuestion(s)!);
    }
  }
  if(s.pendingCorrection){
    if(/^(?:no|cancel|never mind)[.!]?$/i.test(text)){s.pendingCorrection=undefined;return reply("No change made. Anything else?");}
    if(!hasCorrectionMarkers(text)){
      const segment=s.pendingCorrection.segment;
      text=segment.action==="remove"?`remove ${text}`:`replace ${text} with ${segment.text}`;
    }
    providedAnalysis=undefined;
  }
  const correction=correctionOperationsTurn(s,text);
  if(correction)return correction;
  const analysis = decorateAnalysis(text,providedAnalysis ?? analyzeUtterance(text));
  if(analysis.matches.length&&!done){s.checkoutRequested=false;if(s.phase==="ask_spice"||s.phase==="ask_name")s.phase="open";}
  // Unsupported Half/Full choices require consent; large/regular on one-size
  // items are acknowledged by the final response without inventing a size.
  for (const match of analysis.matches.slice()) if (match.portion && !getItem(match.itemId)!.size) {
    analysis.matches = analysis.matches.filter(entry => entry !== match);
    analysis.issues.push({ kind: "clarify", reason: "unsupported_size", heard: match.heard, start: match.start, end: match.end,
      candidates: [{ ...match, portion: undefined }], question: `${match.name} has no Half/Full option. Would you like the standard item?` });
  }
  const informational = /\b(?:how much|price|cost|what(?:'s| is) in|describe|ingredients?)\b/i.test(text);
  if (informational && analysis.matches.length && !analysis.issues.length) {
    const item = getItem(analysis.matches[0].itemId)!;
    if (/\b(?:how much|price|cost)\b/i.test(text)) return reply(item.size
      ? `${item.name}: Half ${money(item.price_cents)}, Full ${money(item.price_cents + item.size.Full)}. Menu approved by the restaurant.`
      : `${item.name} is ${money(item.price_cents)} on the menu approved by the restaurant.`, analysis.matches);
    return reply(item.description ? `${item.name}: ${item.description}` : "I don't have a description for that item. The team can confirm.");
  }
  const recognition = recognitionTurn(s, text, analysis);
  if (recognition) return recognition;
  let matches = analysis.matches.slice();
  const spice = spiceFrom(text);
  if (/\bhot\b/i.test(text) && !informational) {
    s.spiceClarification = matches.length ? { itemIds: matches.map(match => match.itemId) } : {};
    for (const match of matches) match.spiceLevel = undefined;
    if (matches.length) processMatches(s, matches);
    return reply(modifierQuestion(s)!, matches);
  }
  if (s.spiceClarification && spice && !matches.length) {
    const ids = s.spiceClarification.itemIds;
    if (ids) {
      for (const line of s.cart) if (ids.includes(line.itemId) && getItem(line.itemId)!.spice) { line.spiceLevel = spice; line.spiceSource = "override"; }
      for (const draft of [s.pending, ...(s.queued ?? [])]) if (draft && ids.includes(draft.itemId)) draft.spiceLevel = spice;
    } else applyOrderSpice(s, spice);
    s.spiceClarification = undefined;
    return reply(`Noted. ${modifierQuestion(s) ?? "Anything else?"}`);
  }
  if (s.pending) {
    const repeated = matches.find(match => match.itemId === s.pending!.itemId);
    const scoped=matches.length?text.split(/\b(?:and|aur|plus)\b/i).filter(part=>!matches.some(match=>speechText(part).includes(speechText(match.heard)))).join(" "):text;
    const hints = repeated?{portion:repeated.portion,protein:repeated.protein}:extractVariantHints(scoped);
    if (hints.portion) {
      s.pending.portion = hints.portion;
      const pendingSpice=repeated?.spiceLevel??spiceFrom(scoped);
      if (pendingSpice) s.pending.spiceLevel = pendingSpice;
      s.pending.notes = [...(s.pending.notes ?? []), ...(repeated?.notes??notesFrom(scoped))];
      if (repeated?.quantityExplicit) s.pending.qty = repeated.qty;
      addDraft(s, s.pending);
      s.pending = s.queued?.shift();
      matches = matches.filter(match => match !== repeated);
      processMatches(s, matches);
      return reply(`Noted. ${modifierQuestion(s) ?? "Anything else?"}`, matches);
    }
    // Restating the item while its size is pending is an answer attempt, not
    // another order line. Explicit "add/another/and" requests still append.
    const repeatedPrefix=repeated?speechTokens(text).slice(0,repeated.start).join(" "):"";
    if(repeated&&!/\b(?:add|another|one more|also|and|aur|plus)\b/i.test(repeatedPrefix)){
      if(repeated.quantityExplicit)s.pending.qty=repeated.qty;
      if(repeated.spiceLevel)s.pending.spiceLevel=repeated.spiceLevel;
      matches=matches.filter(match=>match!==repeated);
    }
    if (/^(?:no|cancel|never mind)[.!]?$/i.test(text)) { s.pending = s.queued?.shift(); return reply(modifierQuestion(s) ?? "No problem. Anything else?"); }
    if (!matches.length) {if(spice){applyOrderSpice(s,spice);s.pending.spiceLevel=spice;}return reply(modifierQuestion(s)!);}
  }
  // Explicit named spice changes update existing lines without adding again.
  if (spice && matches.length && /\b(?:make|change|set|instead|for)\b/i.test(text) && matches.every(match => s.cart.some(line => line.itemId === match.itemId))) {
    for (const match of matches) for (const line of s.cart) if (line.itemId === match.itemId && getItem(line.itemId)!.spice) { line.spiceLevel = spice; line.spiceSource = "override"; }
    if (s.phase === "confirm") s.phase = "open";
    return reply(`Updated the dish spice. ${modifierQuestion(s) ?? "Anything else?"}`);
  }
  if (matches.length && notesFrom(text).length && /\b(?:notes?|special instructions?|make|change|for)\b/i.test(text) && matches.every(match => s.cart.some(line => line.itemId === match.itemId))) {
    for (const match of matches) for (const line of s.cart) if (line.itemId === match.itemId) line.notes.push(...(match.notes ?? notesFrom(text)));
    if (s.phase === "confirm") s.phase = "open";
    return reply(`I've updated those special instructions. ${modifierQuestion(s) ?? "Anything else?"}`);
  }
  if (spice && !matches.length && !/\b(?:how|what|is it|description)\b/i.test(text)) {
    applyOrderSpice(s, spice);
    return reply(`${spice} for the order. ${modifierQuestion(s) ?? "Anything else?"}`);
  }
  if (s.phase === "ask_name") {
    if(isNoMoreAnswer(text)||wantsMore(text))return reply("What name for pickup?");
    const name = text.replace(/^(?:my name is|this is|it'?s|i am|i'm)\s+/i, "").replace(/[^a-zA-Z\s'-]/g, "").trim();
    if (name.length < 2 || name.length > 40 || matches.length) return reply("What name should I put on the pickup request?");
    s.customerName = name; s.orderType = "pickup";
    return reply(reviewOrder(s));
  }
  if (s.phase === "confirm" && s.closingMode!=="anything_else" && YES.test(text) && !matches.length) {
    if (s.needsReview || s.pending || s.cart.some(line => getItem(line.itemId)!.spice && !line.spiceLevel)) return reply("This request needs review before it can be submitted.");
    s.phase = "closed";
    return reply("Your demo request is pending staff acceptance. It has not been accepted by the restaurant.", [],
      { summary: buildSummary(s, "order", "Caller confirmed the read-back; staff acceptance pending."), endCall: true });
  }
  if (s.phase === "confirm") { s.phase = "open"; if (!matches.length) return reply("What would you like to change?"); }
  if (/\b(?:catering|cater|party order|trays?|event|headcount)\b/i.test(text) || s.phase === "catering") {
    s.phase = "catering"; s.catering ??= {};
    const name = text.match(/my name is\s+([a-z '-]+?)(?=,|\bfor\b|\bon\b|$)/i)?.[1]?.trim();
    if (name) s.customerName = name;
    else if (!s.customerName && state.phase === "catering" && /^[a-z '-]{2,40}$/i.test(text)) s.customerName = text;
    const count = text.match(/\b(\d+)\s*(?:people|guests)\b/i)?.[1];
    if (count) s.catering.headcount = Number(count);
    const date = text.match(/\b(?:on|date is)\s+(.+?)(?=,|\bfor\b|$)/i)?.[1]?.trim();
    if (date) s.catering.date = date;
    else if (state.phase === "catering" && s.customerName && s.callbackNumber && !s.catering.date && !count) s.catering.date = text.slice(0,80);
    if (!s.customerName) return reply("I can record a catering inquiry for staff; this is not a booking. What is your name?");
    if (!s.callbackNumber) return reply("What callback number should the team use?");
    if (!s.catering.date) return reply("What date is your event?");
    if (!s.catering.headcount) return reply("How many guests are you expecting?");
    s.notes.push(`Catering inquiry: ${s.catering.date}, ${s.catering.headcount} guests. ${CATERING.note}`);
    s.phase = "open";
    return reply("I've recorded the demo catering inquiry for staff review. No booking has been made.", [], { summary: buildSummary(s, "catering", "Catering inquiry only") });
  }
  if (/\b(?:hours?|open|clos(?:e|ing)|what time)\b/i.test(text) && !matches.length) return reply("Weekly hours need staff verification. The website capture listed a closing time of 11:30 PM; it did not capture the full weekly schedule.");
  if (/\b(?:where|address|located|location)\b/i.test(text) && !matches.length) return reply(`We're at ${RESTAURANT.address}.`);
  if (/\bhalal\b/i.test(text)) return reply("The restaurant is listed as halal. The team can confirm ingredient details.");
  if (/\bdeliver(?:y)?\b/i.test(text) && !matches.length) return reply("This demo takes pickup requests only. The website also lists delivery; staff need to confirm the delivery details.");
  if (/\b(?:is pickup available|pickup available|do you offer pickup|can i pick.?up)\b/i.test(text)) return reply("Yes, this demo takes pickup requests, with payment at pickup.");
  if (/\b(?:ready|wait|prep time|eta|how long)\b/i.test(text) && !matches.length) return reply("The website lists ASAP pickup at about 30 minutes. Staff must confirm the actual time.");
  if (/^(?:my name is|this is|i am|i'm)\s+/i.test(text) && !matches.length) { s.customerName = text.replace(/^(?:my name is|this is|i am|i'm)\s+/i, "").slice(0,40); return reply("Thanks, I've noted your name. What can I get for you?"); }
  if (/^(?:thanks|thank you)(?: very much| so much| a lot)?[.!]?$/i.test(text)) return reply("You're welcome! Anything else?");
  if (/^(?:(?:hi|hello|hey)(?: there)?|salam|salaam|namaste)[.!]?$/i.test(text)) return reply("Hello! Would you like to order or ask about the menu?");
  if (!matches.length && notesFrom(text).length && s.cart.length) {
    s.cart[s.cart.length-1].notes.push(...notesFrom(text));
    return reply(`I've noted that special instruction. ${modifierQuestion(s) ?? "Anything else?"}`);
  }
  if (matches.length) {
    const processed = processMatches(s, matches);
    if (processed.ask) return reply(`${quantityReadback(matches)}${processed.ask}`, matches);
    if (!done) return reply(`Added ${processed.added.join(" and ")}. Anything else?`, matches);
  }
  if (done) {
    const question = modifierQuestion(s);
    if (question) return reply(question);
    if (s.needsReview) return reply("This request needs staff review. What callback number should the team use?");
    if (!s.cart.length) { s.phase = "closed"; return reply("Thanks for trying the demo!", [], { endCall: true }); }
    s.phase = "ask_name";
    return reply("What name should I put on the pickup request?");
  }
  if (/\b(?:menu|options|what do you have|vegetarian|veggie options)\b/i.test(text)) return reply("We have karahis, BBQ, tikka masala, biryani, vegetarian dishes and breads. Which sounds good?");
  if (s.phase === "ask_spice") return reply(modifierQuestion(s)!);
  return reply("Could you say that again? You can order or ask about the menu.", [], { needsLLM: true });
}

function informationTurn(state:DialogState,text:string,intent:TurnIntent):TurnResult{
  const s:DialogState=structuredClone(state);s.turns++;
  const reply=(message:string):TurnResult=>({reply:message,state:s,matches:[]});
  const prep=preparationTimeQuestion(text);
  if(prep)return reply(`${prep==="delivery"?"This demo is pickup only. ":""}Pickup is about 30 minutes; staff must confirm. ${pendingQuestion(s)??"Anything else?"}`);
  if(/\b(?:suitable|serves?|feed|feeding|enough for|people|peoples|guests|persons|portions)\b/i.test(text)&&/\b(?:half|full|size|serves?|feed|portion|enough)\b/i.test(text))return reply(`I can't verify serving sizes. Staff can advise.${s.pending?` Half or Full for ${getItem(s.pending.itemId)!.name}?`:" What else would you like?"}`);
  if(/\b(?:price|prices|cost|total|subtotal|bill|how much)\b/i.test(text)){const price=priceTurn(s,text,analyzeUtterance(text));if(price)return price;}
  if(recipientPreference(text)){
    if(/^no\b/i.test(text)&&s.recognition?.issues[0]?.kind==="unavailable")s.recognition=undefined;
    return reply("Would they prefer vegetarian food, chicken, or something else?");
  }
  if(intent==="complaint"||/\b(?:cart|my order|you added|you put|how many.*(?:have|order))\b/i.test(text)){
    return reply(s.cart.length?`You have ${cartSpoken(s.cart)}. What should I fix?`:`Your cart is empty. ${s.recognition?.issues[0]?.question??"What should I fix?"}`);
  }
  const browsing=menuBrowsing(text,s.browsing??(s.lastReply?.includes("Menu categories:")?{key:"menu",offset:0}:undefined));
  if(browsing){s.browsing=browsing.browsing;return reply(browsing.reply);}
  const analysis=analyzeUtterance(text),price=priceTurn(s,text,analysis);if(price)return price;
  // An information request can describe alternatives, but cannot create a
  // latent order that a later yes would accidentally authorize.
  if(analysis.issues.some(issue=>issue.kind==="unavailable"))return reply(analysis.issues[0].question);
  if(/\b(?:ingredients?|what(?:'s| is) in|describe)\b/i.test(text)&&analysis.matches.length){const item=getItem(analysis.matches[0].itemId)!;return reply(item.description?`${item.name}: ${item.description}`:"The team can confirm ingredients.");}
  if(/\b(?:hours?|open|clos(?:e|ing)|what time)\b/i.test(text))return reply("Weekly hours need staff verification. The website capture listed a closing time of 11:30 PM; it did not capture the full weekly schedule.");
  if(/\b(?:where|address|located|location)\b/i.test(text))return reply(`We're at ${RESTAURANT.address}.`);
  if(/\bhalal\b/i.test(text))return reply("The restaurant is listed as halal. The team can confirm ingredient details.");
  if(/\b(?:ready|wait|prep time|eta|how long)\b/i.test(text))return reply("The website lists ASAP pickup at about 30 minutes. Staff must confirm the actual time.");
  if(/\b(?:pickup|pick.?up)\b/i.test(text))return reply("Yes, this demo takes pickup requests, with payment at pickup.");
  if(/\bdeliver(?:y)?\b/i.test(text))return reply("This demo takes pickup requests only. Staff can confirm delivery details.");
  if(analysis.matches.length||analysis.issues.length){const ids=[...new Set([...analysis.matches.map(match=>match.itemId),...analysis.issues.flatMap(issue=>issue.candidates.map(candidate=>candidate.itemId))])].slice(0,5);if(ids.length)return reply(`${ids.map(id=>{const item=getItem(id)!;return `${item.name}, ${money(item.price_cents)}${item.size?" for Half":""}`;}).join("; ")}. What else would you like?`);}
  return {...reply("Could you say that again? You can order or ask about the menu."),needsLLM:true};
}

function removalTurn(state:DialogState,text:string):TurnResult{
  const s=structuredClone(state);s.turns++;
  if(/^(?:hello|hi|hey|are you there)[.!?]*$/i.test(text.trim()))return {reply:"I'm here. Which item should I remove?",state:s,matches:[]};
  // Negating a removal cannot turn the named dish into an add or a deletion.
  // An explicit later instruction ("don't remove all, remove one ...") wins.
  if(/\b(?:don'?t|do not|never)\s+remove\b/i.test(text)){
    const remaining=text.replace(/\b(?:don'?t|do not|never)\s+remove\b.*?(?=\bremove\b|$)/gi,"").trim();
    if(!/\bremove\b/i.test(remaining)){s.removalQuantity=undefined;s.removalConfirmation=undefined;s.pendingCorrection=undefined;return {reply:"Kept it. Anything else?",state:s,matches:[]};}
    text=remaining;
  }
  if(s.removalQuantity){
    const choice=s.removalQuantity;
    if(/^(?:no|cancel|never mind|keep (?:it|them|both|all))[.!]?$/i.test(text.trim())){s.removalQuantity=undefined;s.pendingCorrection=undefined;return {reply:"Kept it. Anything else?",state:s,matches:[]};}
    const entries:OrderEntry[]=[...s.cart.map(line=>({itemId:line.itemId,qty:line.qty,portion:line.size?.toLowerCase() as "half"|"full"|undefined,spiceLevel:line.spiceLevel,notes:line.notes})),...[s.pending,...(s.queued??[])].filter((entry):entry is PendingItem=>!!entry)];
    const available=entries.filter(entry=>orderEntryKey(entry)===choice.key).reduce((sum,entry)=>sum+entry.qty,0);
    if(available!==choice.available){s.removalQuantity=undefined;s.pendingCorrection=undefined;return {reply:"The cart changed. Which item should I remove?",state:s,matches:[]};}
    const amount=removalAmount(text,available),tokens=speechTokens(text);
    const labels=new Set([getItem(choice.itemId)!.name,...getItem(choice.itemId)!.aliases].flatMap(speechTokens));
    const answerWords=new Set(["remove","only","just","one","two","three","four","five","six","seven","eight","nine","ten","to","too","for","fore","tree","won","wun","ate","ek","aik","ik","ikk","do","teen","tinn","char","chaar","paanch","panj","all","both","of","them","the","a","an","it","that","yes","no","please"]);
    const finite=tokens.every(token=>answerWords.has(token)||labels.has(token)||/^\d+$/.test(token));
    if(amount.invalid||amount.qty===undefined||!finite)return {reply:removalQuantityQuestion(getItem(choice.itemId)!.name,available,true),state:s,matches:[]};
    s.removalQuantity=undefined;s.pendingCorrection=undefined;s.turns--;
    return correctionOperationsTurn(s,`remove ${amount.qty} ${choice.target}`)??{reply:"Which existing item should I remove?",state:s,matches:[]};
  }
  if(s.removalConfirmation){
    const confirmation=s.removalConfirmation,line=s.cart[confirmation.index],answer=constrainedAnswer(text,"yesno",["yes","no"]).value;
    if(answer==="no"){s.removalConfirmation=undefined;s.pendingCorrection=undefined;return {reply:"Kept it. Anything else?",state:s,matches:[]};}
    if(answer!=="yes")return {reply:`Remove ${line?spokenLine(line):"that item"}? Please say yes or no.`,state:s,matches:[]};
    if(!line||line.itemId!==confirmation.itemId||line.qty!==confirmation.qty)return {reply:"The cart changed. Which item should I remove?",state:s,matches:[]};
    const amount=removalAmount(confirmation.target,line.qty),qty=amount.qty??(line.qty===1?1:undefined);
    if(qty===undefined||amount.invalid){s.removalConfirmation=undefined;s.turns--;return correctionOperationsTurn(s,`remove ${confirmation.target}`)??{reply:"How many should I remove?",state:s,matches:[]};}
    if(!Number.isSafeInteger(qty)||qty<1||qty>line.qty)return {reply:"How many of that existing item should I remove?",state:s,matches:[]};
    line.qty-=qty;if(!line.qty)s.cart.splice(confirmation.index,1);
    s.removalConfirmation=undefined;s.pendingCorrection=undefined;
    return {reply:"Anything else?",state:s,matches:[]};
  }
  if(state.pendingCorrection&&/^(?:no|cancel|never mind)[.!]?$/i.test(text.trim())){s.pendingCorrection=undefined;return {reply:"No change made. Anything else?",state:s,matches:[]};}
  // A pending removal owns its answers, including stray STT correction words.
  // Do not hand them to the general add/replace segmenter.
  if(state.pendingCorrection?.segment.action==="remove"&&/\b(?:switch|swap|instead|replace|add|another)\b/i.test(text))return {reply:`You have ${cartSpoken(s.cart)}. Which item should I remove?`,state:s,matches:[]};
  const target=(text.replace(/^.*?\b(?:remove|delete|cancel|scrap|take it off|hata|nikal)\b\s*/i,"").replace(/\s+(?:from|in|off)\s+(?:my|the|this)\s+(?:cart|order)[.!?]*$/i,"").trim()||(/\btake it off\b/i.test(text)?"it":""));
  const absent=analyzeUtterance(target);
  const cartTargets=targetIndexes(s.cart.map(line=>({itemId:line.itemId,qty:line.qty,portion:line.size?.toLowerCase() as "half"|"full"|undefined,spiceLevel:line.spiceLevel,notes:line.notes})),target);
  if(!cartTargets.length&&absent.matches.length&&!absent.issues.length&&absent.matches.every(match=>!s.cart.some(line=>line.itemId===match.itemId)&&![s.pending,...(s.queued??[])].some(line=>line?.itemId===match.itemId))){
    s.pendingCorrection={segment:{action:"remove",text:"",start:0,end:0},attempts:0};
    return {reply:`${[...new Set(absent.matches.map(match=>match.name))].join(" and ")} isn't in your cart. Which item should I remove?`,state:s,matches:[]};
  }
  const result=correctionOperationsTurn(s,`remove ${target}`);
  return result??{reply:`You have ${cartSpoken(s.cart)||"an empty cart"}. Which item should I remove?`,state:s,matches:[]};
}

function totalCorrectionTurn(state:DialogState,text:string):TurnResult|undefined{
  const qty=desiredTotal(text);if(qty===undefined)return;
  const s=structuredClone(state);s.turns++;
  if(!Number.isSafeInteger(qty)||qty<1||qty>50)return {reply:"Please give a quantity from one to fifty.",state:s,matches:[]};
  const entries=s.cart.map(line=>({itemId:line.itemId,qty:line.qty,portion:line.size?.toLowerCase() as "half"|"full"|undefined,spiceLevel:line.spiceLevel,notes:line.notes}));
  const a=analyzeUtterance(text),ids=[...new Set(a.matches.map(match=>match.itemId))];
  let indexes=targetIndexes(entries,text);
  if(!indexes.length&&ids.length===1)indexes=s.cart.flatMap((line,index)=>line.itemId===ids[0]?[index]:[]);
  // "Only one" without a dish refers to the last logical equivalent group.
  if(!ids.length&&/^(?:(?:no|actually|i want|i wanted|make it|make that)[, ]+)*(?:(?:(?:only|just)\s+)?(?:one|two|three|four|five|\d+)|\w+\s+(?:is|will be)\s+enough)[.!]?$/i.test(text.trim())&&s.cart.length){const key=equivalentLine(s.cart[s.cart.length-1]);indexes=s.cart.flatMap((line,index)=>equivalentLine(line)===key?[index]:[]);}
  if(!indexes.length||new Set(indexes.map(index=>equivalentLine(s.cart[index]))).size!==1)return {reply:`You have ${cartSpoken(s.cart)||"an empty cart"}. Which item should have ${qty} total?`,state:s,matches:[]};
  const first=indexes[0];s.cart[first].qty=qty;s.cart=s.cart.filter((_,index)=>index===first||!indexes.includes(index));
  if(s.recognition){s.recognition.issues=s.recognition.issues.filter(issue=>!(issue.reason==="quantity"&&issue.candidates.every(candidate=>candidate.itemId===entries[first].itemId)));if(!s.recognition.issues.length)s.recognition=undefined;}
  s.pendingCorrection=undefined;s.removalConfirmation=undefined;s.phase="open";
  const line=s.cart[first];
  return {reply:`${qty} ${line.name} total. ${pendingQuestion(s)??"Anything else?"}`,state:s,matches:[{itemId:line.itemId,name:line.name,qty,portion:line.size?.toLowerCase() as "half"|"full"|undefined,spiceLevel:line.spiceLevel,notes:line.notes,score:1,start:0,end:1,heard:line.name}]};
}

const FULL_NAME_PATTERNS=MENU.flatMap(item=>[item.name,item.website_name].filter((name):name is string=>!!name).map(name=>({itemId:item.id,tokens:speechTokens(name)})));
function pendingExplicitCorrection(state:DialogState,text:string,intent:TurnIntent):TurnResult|undefined{
  if(!["correction","add_order"].includes(intent))return;
  const tokens=speechTokens(text),negatedAt=(start:number)=>/\b(?:no|not)(?: the| that)?$/.test(tokens.slice(Math.max(0,start-2),start).join(" ")),found=FULL_NAME_PATTERNS.flatMap(label=>tokens.flatMap((_,start)=>label.tokens.every((word,index)=>tokens[start+index]===word)&&!negatedAt(start)?[{...label,start,end:start+label.tokens.length}]:[]));
  if(!state.recognition){
    if(intent!=="correction"||hasCorrectionMarkers(text)||!/^(?:no\b|not\b)/i.test(text.trim()))return;
    const positive=found.filter(match=>!tokens.slice(Math.max(0,match.start-2),match.start).some(word=>['no','not'].includes(word)));
    const ids=[...new Set(positive.map(match=>match.itemId))];
    if(ids.length!==1)return {reply:"Which existing item should I replace, and with what?",state:{...structuredClone(state),turns:state.turns+1},matches:[]};
    const chosen=positive.sort((a,b)=>b.end-a.end)[0],namedTarget=FULL_NAME_PATTERNS.find(label=>tokens.some((_,start)=>label.tokens.every((word,index)=>tokens[start+index]===word)&&tokens.slice(Math.max(0,start-2),start).some(word=>['no','not'].includes(word))));
    const targets=namedTarget?state.cart.filter(line=>line.itemId===namedTarget.itemId):state.cart.slice(-1);
    if(targets.length!==1)return {reply:`You have ${cartSpoken(state.cart)||"an empty cart"}. Which existing item should I replace?`,state:{...structuredClone(state),turns:state.turns+1},matches:[]};
    return runTurnCore(state,`replace ${targets[0].name} with ${tokens.slice(chosen.start).join(" ")}`);
  }
  const ids=[...new Set(found.map(match=>match.itemId))];if(ids.length!==1)return;
  const related=state.recognition.issues.findIndex(issue=>tokens.some(word=>speechTokens(issue.heard).includes(word)&&!['one','two','chicken','goat','lamb','fish'].includes(word)));
  const issueIndex=related>=0?related:0,first=state.recognition.issues[issueIndex],item=getItem(ids[0])!;
  // An unrelated clear addition keeps the old question. A correction, or an
  // explicit name following the old family's word, supersedes that question.
  if(intent!=="correction"&&related<0)return;
  const chosen=found.sort((a,b)=>b.end-a.end)[0],suffix=tokens.slice(chosen.start).join(" ");
  const a=decorateAnalysis(suffix,analyzeUtterance(suffix));
  const exact=a.matches.find(match=>match.itemId===item.id);if(!exact)return;
  const local=tokens.slice(Math.max(0,chosen.start-2),chosen.end+3).join(" ");
  exact.qty=extractQuantityHint(local)??first.candidates[0]?.qty??1;
  exact.portion=extractVariantHints(local).portion??exact.portion;
  const s=structuredClone(state);s.turns++;
  if(s.recognition!.replacement){const target=s.recognition!.replacement;if(s.cart[target.index]?.itemId!==target.itemId)return; s.cart.splice(target.index,1);}
  s.recognition!.issues.splice(issueIndex,1);s.recognition!.attempts=0;
  if(!s.recognition!.issues.length)s.recognition=undefined;
  const processed=processMatches(s,[exact]);
  return {reply:s.recognition?.issues[0].question??processed.ask??"Anything else?",state:s,matches:[exact]};
}

function actionTurn(state:DialogState,text:string,intent:TurnIntent,provided?:RecognitionAnalysis):TurnResult{
  if(intent==="question"||intent==="complaint")return informationTurn(state,text,intent);
  if(intent==="removal")return removalTurn(state,text);
  if(state.pending&&state.recognition){
    const size=constrainedAnswer(text,"size",["half","full"]),confirmation=state.answerConfirmation?.kind==="size"&&constrainedAnswer(text,"yesno",["yes","no"]).value;
    if(size.value||size.confirm||confirmation){
      const draft=structuredClone(state),deferred=draft.recognition;draft.recognition=undefined;draft.recognitionPrompt=undefined;
      const result=runTurnCore(draft,text,{matches:[],issues:[]});result.state.recognition=deferred;
      if(!result.state.pending&&!result.state.answerConfirmation)result.reply=deferred!.issues[0].question;
      return result;
    }
  }
  if(state.recognition&&!state.answerConfirmation&&!canAcceptRecognition(state)&&recognitionConsent(text))return {reply:state.pending?`Half or Full for ${getItem(state.pending.itemId)!.name}?`:state.recognition.issues[0].question,state:{...structuredClone(state),turns:state.turns+1},matches:[]};
  const consent=canAcceptRecognition(state)?recognitionConsent(text):undefined;
  if(consent){
    const result=runTurnCore(state,consent.answer);
    if(consent.information){const price=priceTurn(result.state,consent.information,{matches:[],issues:[]});if(price)result.reply=price.reply;}
    return result;
  }
  if(state.categoryOrder){
    const s=structuredClone(state);s.turns++;
    if(/^(?:no|nope|cancel|never mind)[.!]?$/i.test(text)){s.categoryOrder=undefined;return {reply:"Left those items out. Anything else?",state:s,matches:[]};}
    const countReply=/^(?:one|two|three|four|five|\d+)(?:\s+of)?\s+each(?:\s+please)?[.!]?$/i.test(text);
    if(!/^(?:yes|yeah|yep|haan)(?: please)?[.!]?$/i.test(text)&&!countReply)return {reply:pendingQuestion(s)!,state:s,matches:[]};
    const choice=s.categoryOrder!;s.categoryOrder=undefined;
    if(countReply){const qty=extractQuantityHint(text);if(qty===undefined||qty<1||qty>50){s.categoryOrder=choice;return {reply:"How many of each item, from one to fifty?",state:s,matches:[]};}choice.qtyEach=qty;}
    if(choice.cartStamp!==JSON.stringify(s.cart))return {reply:"The cart changed. Please repeat that category request.",state:s,matches:[]};
    const matches:Match[]=choice.itemIds.map(id=>{const item=getItem(id)!;return {itemId:id,name:item.name,qty:choice.qtyEach,score:1,start:0,end:1,heard:item.name};});
    s.checkoutRequested=false;
    const processed=processMatches(s,decorateAnalysis(choice.text,{matches,issues:[]}).matches);return {reply:processed.ask??"Anything else?",state:s,matches};
  }
  const category=intent==="add_order"?categoryOrderRequest(text):undefined;
  if(category){
    const s=structuredClone(state);s.turns++;
    if(category.mixed)return {reply:"Which category would you like?",state:s,matches:[]};
    const qty=category.qtyText?extractQuantityHint(category.qtyText):1;
    if(qty===undefined||qty<1||qty>50)return {reply:"How many of each item, from one to fifty?",state:s,matches:[]};
    if(!category.qtyText||category.items.length>5){s.categoryOrder={key:category.key,itemIds:category.items.map(item=>item.id),qtyEach:qty,cartStamp:JSON.stringify(s.cart),text};return {reply:pendingQuestion(s)!,state:s,matches:[]};}
    const matches:Match[]=category.items.map(item=>({itemId:item.id,name:item.name,qty,score:1,start:0,end:1,heard:item.name}));
    s.checkoutRequested=false;
    const processed=processMatches(s,decorateAnalysis(text,{matches,issues:[]}).matches);return {reply:s.recognition?.issues[0]?.question??processed.ask??"Anything else?",state:s,matches};
  }
  if(state.pendingOrderList){
    if(/^(?:cancel|never mind|no)[.!]?$/i.test(text))return {reply:"Left those changes out. Anything else?",state:{...structuredClone(state),pendingOrderList:undefined},matches:[]};
    const adding=/^(?:add|add them|extra|extra items|add these|add these items)[.!]?$/i.test(text),replacing=/^(?:replace|replace it|replace the order|replace my order|replace the current order)[.!]?$/i.test(text);
    if(!adding&&!replacing)return {reply:"Add those items, or replace the current order?",state:structuredClone(state),matches:[]};
    if(state.pendingOrderList.cartStamp!==JSON.stringify(state.cart))return {reply:"The cart changed. Please repeat the items you want to add or replace.",state:{...structuredClone(state),pendingOrderList:undefined},matches:[]};
    const draft={...structuredClone(state),pendingOrderList:undefined};
    if(replacing){draft.cart=[];draft.pending=undefined;draft.queued=undefined;draft.recognition=undefined;draft.pendingCorrection=undefined;draft.checkoutRequested=false;draft.phase="open";}
    return runTurnCore(draft,`add ${state.pendingOrderList.text}`);
  }
  const restatement=/^i (?:only )?(?:want|need|would like)\s+/i.test(text)&&!/\b(?:another|also|more|extra)\b/i.test(text)&&state.cart.length?provided??analyzeUtterance(text):undefined;
  if(restatement&&new Set(restatement.matches.map(match=>match.itemId)).size>1&&restatement.matches.some(match=>state.cart.some(line=>line.itemId===match.itemId)))return {reply:"Add those items, or replace the current order?",state:{...structuredClone(state),pendingOrderList:{text,cartStamp:JSON.stringify(state.cart)}},matches:[]};
  const listRestart=text.match(/^(?:actually|i mean)[,\s]+(?:i\s+)?(?:want|need|would like)\s+(.+)$/i)?.[1];
  if(intent==="correction"&&listRestart&&state.cart.length){const a=analyzeUtterance(listRestart);if(a.matches.length+a.issues.length>1)return {reply:"Add those items, or replace the current order?",state:{...structuredClone(state),pendingOrderList:{text:listRestart,cartStamp:JSON.stringify(state.cart)}},matches:[]};}
  // With no committed/drafted line to replace, a leading discourse repair
  // supersedes an unresolved request. It must not manufacture a cart target.
  const restart=!state.cart.length&&!state.pending&&!state.queued?.length&&!state.pendingCorrection&&!state.removalQuantity&&!state.removalConfirmation&&intent==="correction"?text.match(/^(?:the\s+)?(?:actually|i mean)[,\s]+(.+)$/i)?.[1]:undefined;
  if(restart){const analysis=analyzeUtterance(restart);if(analysis.matches.length||analysis.issues.length)return runTurnCore({...structuredClone(state),recognition:undefined},restart,analysis);}
  if(state.phase==="confirm"&&state.closingMode==="anything_else"&&(isNoMoreAnswer(text)||wantsMore(text)))return runTurnCore(state,text,provided);
  if(state.repetition){
    const qty=extractQuantityHint(text),s=structuredClone(state),r=s.repetition!;s.turns++;
    if(/^(?:cancel|no|never mind)[.!]?$/i.test(text)){s.repetition=undefined;return {reply:"Left that item out. Anything else?",state:s,matches:[]};}
    const a=provided??analyzeUtterance(text),bare=/^(?:(?:i mean|make it|only|just|actually|please)\s+)*(?:one|two|three|four|\d+)(?:\s+please)?[.!]?$/i.test(text.trim());
    const namesThis=a.matches.length>0&&a.matches.every(match=>match.itemId===r.itemId)&&!a.issues.length;
    if(qty!==undefined&&r.choices.includes(qty)&&(bare||namesThis)){
      s.repetition=undefined;const item=getItem(r.itemId)!,match:Match={itemId:item.id,name:item.name,qty,portion:r.portion,spiceLevel:r.spiceLevel,notes:r.notes,score:1,start:0,end:1,heard:item.name};
      const processed=processMatches(s,[match]);return {reply:processed.ask??"Anything else?",state:s,matches:[match]};
    }
    if(intent==="done")return {reply:pendingQuestion(s)!,state:s,matches:[]};
    if(a.matches.some(match=>match.itemId!==r.itemId)||a.issues.some(issue=>issue.candidates.some(candidate=>candidate.itemId!==r.itemId))||s.pending){
      const repetition=s.repetition;delete s.repetition;s.turns=state.turns;
      const result=actionTurn(s,text,intent,a);result.state.repetition=repetition;
      if(!result.state.pending&&!result.state.recognition&&!result.state.pendingCorrection)result.reply=pendingQuestion(result.state)!;
      return result;
    }
    return {reply:pendingQuestion(s)!,state:s,matches:[]};
  }
  const total=totalCorrectionTurn(state,text);if(total)return total;
  if(/^(?:no spice|not spicy|mild(?: spice)?|medium(?: spice)?|spicy|extra spicy)[.!]?$/i.test(text.trim()))return runTurnCore(state,text,provided);
  const explicit=pendingExplicitCorrection(state,text,intent);if(explicit)return explicit;
  if(intent==="add_order"){
    const raw=matchUtterance(text).filter(match=>match.score===1),tokens=speechTokens(text);
    const repeated=raw.find(match=>raw.some(other=>other!==match&&other.itemId===match.itemId&&other.start>=match.end&&!tokens.slice(match.end,other.start).some(word=>['and','aur','another','also','plus','more'].includes(word))));
    if(repeated){
      const same=raw.filter(match=>match.itemId===repeated.itemId),a=provided??analyzeUtterance(text);
      const clean={matches:a.matches.filter(match=>match.itemId!==repeated.itemId),issues:a.issues.filter(issue=>!issue.candidates.some(candidate=>candidate.itemId===repeated.itemId))};
      const result=runTurnCore(state,text,clean),choices=[...new Set([repeated.qty,same.reduce((sum,match)=>sum+match.qty,0)])].sort((a,b)=>a-b);
      result.state.repetition={itemId:repeated.itemId,choices,portion:repeated.portion,spiceLevel:repeated.spiceLevel,notes:repeated.notes};
      result.reply=`${choices.map(n=>n===1?"One":n===2?"two":String(n)).join(" or ")} ${repeated.name}?`;return result;
    }
  }
  return runTurnCore(state,text,provided);
}

// Transaction boundary: classify -> propose -> validate -> rewrite -> disclose
// -> verify -> commit. The engine and all audio transports share this path.
export function runTurn(state:DialogState,text:string,analysis?:RecognitionAnalysis):TurnResult{
  const normalized=normalizeCodeSwitch(text,state.phase==="ask_name");
  if(normalized.unsupportedScript&&!requiresStaffReview(normalized.text)){
    if(classifyTurn(state,normalized.text).intent==="add_order"){
      // Keep an unknown word as an explicit unresolved clause. Never silently
      // strip it and extract a nearby one-word side from that same clause.
      text=normalized.text.replace(/[\p{L}\p{M}]+/gu,word=>/[^\x00-\x7F]/.test(word)?"unrecognizedword":word);analysis=undefined;
    }else{
    const reply="I missed part of that. Please repeat the item or choice in English.";
    return {reply,state:{...structuredClone(state),turns:state.turns+1,lastReply:reply},matches:[],operations:[],disclosure:[],intent:classifyTurn(state,normalized.text).intent};
    }
  }
  if(normalized.changed&&!normalized.unsupportedScript){text=normalized.text;analysis=undefined;}
  if(state.phase!=="ask_name"&&!(canAcceptRecognition(state)&&/^(?:yes|yeah|yep|haan)\b/i.test(text))){const explicit=explicitActionText(text);if(explicit!==text){text=explicit;analysis=undefined;}}
  const declined=noChangeCompletion(text);
  const activeState=declined?{...structuredClone(state),pendingCorrection:undefined,removalQuantity:undefined,removalConfirmation:undefined,pendingOrderList:undefined,categoryOrder:undefined}:state;
  if(declined){text=declined;analysis=undefined;}
  const timingCompletion=completionWithTiming(text);
  const deliveryTiming=timingCompletion&&/\bdeliver(?:y)?\b/i.test(text);
  if(timingCompletion){text=timingCompletion;analysis=undefined;}
  const decision=classifyTurn(activeState,text);
  let result=activeState.phase==="closed"?runTurnCore(activeState,text,analysis):requiresStaffReview(text)?runTurnCore(activeState,text,analysis):actionTurn(activeState,text,decision.intent,analysis);
  result.state=JSON.parse(JSON.stringify(result.state));
  if(!permitsCart(decision.intent,state.cart,result.state.cart)){
    result={reply:"No change made. What should I change?",state:{...structuredClone(state),turns:state.turns+1},matches:[],safetyRollback:true};
  }
  result.intent=decision.intent;result.state.lastIntent=decision.intent;
  if(timingCompletion)result.reply=`${deliveryTiming?"This demo is pickup only. ":""}Pickup is about 30 minutes; staff must confirm. ${result.reply}`;
  if(result.state.phase!=="confirm")result.state.readbackStamp=undefined;
  const oneSize=result.matches.filter(match=>!getItem(match.itemId)!.size&&new RegExp(`\\b(?:large|small|regular)\\s+(?:${speechText(match.heard).replace(/[^a-z ]/g,"")})\\b`,"i").test(speechText(text)));
  if(oneSize.length)result.reply=`${[...new Set(oneSize.map(match=>match.name))].join(" and ")} has one size. ${result.reply}`;
  const key=(line:CartLine)=>`${line.itemId}:${line.size??""}`;
  const total=(cart:CartLine[],id:string)=>cart.filter(line=>key(line)===id).reduce((sum,line)=>sum+line.qty,0);
  result.operations=recordCartOperations(state.cart,result.state.cart);
  const removal=isRemovalCommand(text)||state.pendingCorrection?.segment.action==="remove"||!!state.removalConfirmation;
  if(removal){
    const removed=[...new Set(state.cart.map(key))].flatMap(id=>{const qty=total(state.cart,id)-total(result.state.cart,id),line=state.cart.find(line=>key(line)===id)!;return qty>0?[`${qty} ${line.name}${line.size?`, ${line.size}`:""}`]:[];});
    if(removed.length)result.reply=`Removed ${removed.join(" and ")}. ${pendingQuestion(result.state)??"Anything else?"}`;
  }
  const progress=JSON.stringify([state.cart,state.pending,state.orderSpice,state.phase,state.recognition?.issues.map(issue=>issue.heard),state.pendingCorrection?.segment,state.pendingOrderList,state.categoryOrder,state.removalQuantity,state.removalConfirmation])!==JSON.stringify([result.state.cart,result.state.pending,result.state.orderSpice,result.state.phase,result.state.recognition?.issues.map(issue=>issue.heard),result.state.pendingCorrection?.segment,result.state.pendingOrderList,result.state.categoryOrder,result.state.removalQuantity,result.state.removalConfirmation]);
  const browsing=!!menuBrowsing(text,state.browsing??(state.lastReply?.includes("Menu categories:")?{key:"menu",offset:0}:undefined));
  const answeredInformation=["question","complaint"].includes(decision.intent)&&!result.needsLLM;
  const miss=!answeredInformation&&!browsing&&!progress&&(!!pendingQuestion(result.state)||!!result.needsLLM)&&! /^(?:hello|hi|hey|are you there)[.!?]*$/i.test(text)&&!/^\b(?:price|cost|total|subtotal|bill|how much)\b/i.test(text);
  result.state.recoveryMisses=miss?(state.recoveryMisses??0)+1:0;
  if(result.state.recoveryMisses>=2&&!result.state.removalQuantity&&result.state.pendingCorrection?.segment.action!=="remove"&&!result.reply.includes("Menu categories:"))result.reply=`${CATEGORY_LIST} Which category would you like?`;
  if(result.state.recoveryMisses>=3&&!browsing){result.state.needsReview=true;result.reply="I couldn't resolve that. The team can help; what callback number should they use?";}
  if(result.reply===state.lastReply){
    if(result.state.removalQuantity)result.reply=removalQuantityQuestion(getItem(result.state.removalQuantity.itemId)!.name,result.state.removalQuantity.available,result.reply.startsWith("Remove"));
    else if(browsing)result.reply=`${CATEGORY_LIST} Which category would you like next?`;
    else if(result.state.pendingCorrection?.segment.action==="remove")result.reply="Which item should I remove? You can also say cancel.";
    else if(result.state.categoryOrder)result.reply="Please say yes to add those items, or no to leave them out.";
    else if(result.state.pending)result.reply=`For ${getItem(result.state.pending.itemId)!.name}, please choose Half or Full.`;
    else if(result.state.phase==="ask_spice")result.reply=`Please choose ${spiceOptions.join(", ")}.`;
    else if(result.state.recognition?.issues[0]){const issue=result.state.recognition.issues[0];result.reply=issue.candidates.length===1?`Should I add ${issue.candidates[0].qty} ${issue.candidates[0].name}?`:`Please choose: ${issue.question}`;}
    else result.reply=`${CATEGORY_LIST} Which category would you like?`;
    if(result.reply===state.lastReply)result.reply="Could you say that again? You can order or ask about the menu.";
  }
  // This runs AFTER every reply rewrite. No caller-text or LLM string can
  // certify a mutation: disclosure comes solely from the local cart diff.
  const changes=cartChanges(state.cart,result.state.cart);
  const disclosure=changes.map(change=>change.text);
  if(!changes.length&&result.operations.length){
    // Pure regrouping/metadata churn has no caller-visible order effect.
    // Preserve the original lines instead of committing an undisclosed diff.
    result.state.cart=structuredClone(state.cart);result.operations=[];
  }
  if(disclosure.length){
    // Replace stale generic claims with authoritative before/after templates.
    result.reply=result.reply.replace(/^(?:Added [^?]*?\.\s*|Updated[^?]*?\.\s*|Removed [^?]*?\.\s*)+/i,"");
    result.reply=`${disclosure.join(" ")} ${result.reply}`.trim();
  }
  result.disclosure=disclosure;
  if(disclosure.some(fact=>!result.reply.includes(fact))){
    result={reply:"No change made. Please repeat the change.",state:{...structuredClone(state),turns:state.turns+1,lastIntent:decision.intent},matches:[],operations:[],intent:decision.intent,disclosure:[],safetyRollback:true};
  }
  result.state.lastReply=result.reply;
  const issue=result.state.recognition?.issues[0];
  const offered=issue&&(result.reply.endsWith(issue.question)||issue.candidates.length===1&&result.reply.endsWith(`Should I add ${issue.candidates[0].qty} ${issue.candidates[0].name}?`));
  result.state.recognitionPrompt=offered?recognitionKey(result.state):undefined;
  return result;
}
