// Deterministic order facts. The optional LLM never sets items or modifiers.
import { CATERING, MENU, MODIFIERS, RESTAURANT, MENU_SOURCE_SHA256, getItem, unitPriceCents } from "./menu";
import { Match, RecognitionAnalysis, RecognitionIssue, analyzeUtterance, candidateQuestion, extractQuantityHint, extractVariantHints } from "./matcher";
import { redactPhoneNumbers } from "./privacy";
import { speechText } from "./speech";
import { hasCorrectionMarkers, isRemovalCommand, planLocalCorrection, segmentLocalCorrection, targetIndexes, OrderEntry, OrderSegment } from "./order-operations";
import { CartOperation, recordCartOperations } from "./cart-journal";
import { similarity } from "./phonetic";
import { speechTokens } from "./speech";
import { menuBrowsing, CATEGORY_LIST, MENU_FALLBACK, type BrowseState } from "./menu-browsing";

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
  pendingCorrection?: { segment:OrderSegment; attempts:number };
  orderSpice?: string; spiceClarification?: { itemIds?: string[] };
  needsReview?: boolean; customerName?: string; callbackNumber?: string;
  orderType?: "pickup"; notes: string[]; turns: number;
  catering?: { date?: string; headcount?: number };
  lastReply?:string; recoveryMisses?:number;
  answerConfirmation?:{kind:"size"|"spice"|"yesno";value:string};
  checkoutRequested?:boolean;spiceAsked?:boolean;
  removalConfirmation?:{index:number;itemId:string;qty:number;target:string};
  browsing?:BrowseState; menuQuestionMisses?:number;
}
export interface CallSummary {
  kind: "order" | "inquiry" | "catering"; status: "pending_acceptance" | "needs_review";
  demo: true; menuApproved: boolean; customerName?: string; orderType?: string;
  items: { name: string; variant?: string; qty: number; spice?: string; notes: string[]; lineTotal: number; lineTotalCents: number; sizeVerified?: boolean }[];
  subtotal: number; subtotalCents: number; notes: string[]; transcriptHint: string;
}
export interface TurnResult { reply: string; state: DialogState; matches: Match[]; operations?:CartOperation[]; summary?: CallSummary; needsLLM?: boolean; endCall?: boolean }
export function newState(): DialogState { return { menuHash: MENU_SOURCE_SHA256, phase: "open", cart: [], notes: [], turns: 0 }; }
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
const DONE = /\b(?:that'?s (?:all|it)|that (?:will|would) be all|nothing else|checkout|check out|bas|khatam|i'?m done|end (?:the |this )?call|goodbye|bye)\b/i;
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
  const found = text.match(/(?:\b(?:notes?|special instructions?)\s*[:=]?\s+|\b(?:no (?!spice\b|mirchi\b|wait\b|make\b|actually\b)|without |on the side\b|less (?!spice\b)))(.+)$/i);
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
  if(s.checkoutRequested&&s.cart.length){s.phase="ask_name";return "What name for pickup?";}
  s.phase = "open";
}
function pendingQuestion(s:DialogState):string|undefined{
  if(s.removalConfirmation)return `Remove ${s.cart[s.removalConfirmation.index]?.name??"that item"}?`;
  if(s.answerConfirmation)return `Did you mean ${s.answerConfirmation.value}?`;
  if(s.pendingCorrection)return `You have ${cartSpoken(s.cart)}. Which existing item should I ${s.pendingCorrection.segment.action==="remove"?"remove":"change"}?`;
  if(s.recognition)return s.recognition.issues[0]?.question;
  if(s.pending)return `Half or Full for ${getItem(s.pending.itemId)!.name}?`;
  if(s.spiceClarification)return 'By "hot", do you mean Spicy or Extra Spicy?';
  if(s.checkoutRequested&&s.cart.some(line=>getItem(line.itemId)!.spice&&!line.spiceLevel))return ORDER_SPICE_QUESTION;
  if(s.phase==="ask_name")return "What name should I put on the pickup request?";
  if(s.phase==="confirm")return "Is the order I read back correct?";
}
function priceTurn(s:DialogState,text:string,analysis:RecognitionAnalysis):TurnResult|undefined{
  if(!/\b(?:price|prices|cost|total|subtotal|bill|how much|how much is it)\b/i.test(text))return;
  const resume=pendingQuestion(s);
  let answer:string;
  if(/\b(?:total|subtotal|bill|how much (?:is it|so far|altogether))\b/i.test(text))answer=`Your current subtotal is ${money(cartTotalCents(s.cart))}; tax is not configured.`;
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
    const clause=clauses.find(part=>speechText(part).includes(speechText(match.heard)))??(clauses.length===1?text:"");
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
      const literal=target.toLowerCase().replace(/[^a-z\s]/g," ").split(/\s+/).filter(word=>word&&!['the','now','please','one','two','three','four','a','an'].includes(word)).join(" ");
      const exact=[item.name,item.website_name,...item.aliases].filter(Boolean).some(label=>label!.toLowerCase()===literal);
      if(!exact&&!/^(?:it|that|last(?: item| one)?|everything|whole order|all items|entire order)$/i.test(target.trim())){
        s.removalConfirmation={index,itemId:item.id,qty:s.cart[index].qty,target};
        return {reply:`Remove ${item.name}?`,state:s,matches:[]};
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
  for(let index=0;index<plan.entries.length;index++){const entry=plan.entries[index];const line=s.cart[index];if(line?.itemId===entry.itemId&&entry.spiceSource)line.spiceSource=entry.spiceSource;}
  if(plan.issues.length){
    const target=plan.replaceIndex!==undefined?plan.entries[plan.replaceIndex]:undefined;
    s.recognition={issues:plan.issues,matches:[],attempts:0,...(target?{replacement:{itemId:target.itemId,index:plan.replaceIndex!}}:{})};
    return {reply:plan.issues[0].question,state:s,matches:plan.changed};
  }
  if(plan.question){
    const segment=plan.blockedSegment??plan.segments[plan.segments.length-1];s.pendingCorrection={segment,attempts:0};
    const tied=segment?.action==="remove"&&targetIndexes(initial,segment.text).length>1;
    return {reply:`${tied?`You have ${cartSpoken(s.cart)}. `:""}${plan.question}`,state:s,matches:plan.changed};
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
    } else if (yes && issue.candidates.length === 1 && issue.reason !== "quantity") {
      const acknowledgement = text.split(/\b(?:and|aur|plus)\b/i)[0];
      selections = [{ ...issue.candidates[0], ...extractVariantHints(acknowledgement), qty: extractQuantityHint(acknowledgement) ?? issue.candidates[0].qty, requiresConfirmation: false }];
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
  if(done)s.checkoutRequested=true;
  if(done&&!s.cart.length&&!s.pending&&!s.recognition){s.phase="closed";return reply("Goodbye! Thanks for calling Karahi House.",[],{endCall:true});}
  if(done&&s.phase==="ask_name")return reply("What name for pickup?");
  if(done&&s.phase==="confirm")return reply("Is the order I read back correct?");
  // Protein repairs apply only to a pending protein choice, not food orders.
  if(s.recognition&&/^(?:got|got please)[.!]?$/i.test(text)&&s.recognition.issues[0]?.candidates.some(candidate=>candidate.protein==="Goat")){
    text="goat";providedAnalysis={matches:[],issues:[]};
  }
  // Answer matching stays inside the question's finite choice set. A new food
  // request is not coerced into a size or spice answer.
  const yesnoAnswer=constrainedAnswer(text,"yesno",["yes","no"]),yesno=yesnoAnswer.value;
  if(s.answerConfirmation){
    if(yesno==="yes"){text=s.answerConfirmation.value;s.answerConfirmation=undefined;providedAnalysis=undefined;}
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
    const name = text.replace(/^(?:my name is|this is|it'?s|i am|i'm)\s+/i, "").replace(/[^a-zA-Z\s'-]/g, "").trim();
    if (name.length < 2 || name.length > 40 || matches.length) return reply("What name should I put on the pickup request?");
    s.customerName = name; s.orderType = "pickup"; s.phase = "confirm";
    return reply(`Please check: ${cartSpoken(s.cart)}. Subtotal ${money(cartTotalCents(s.cart))}; tax is not configured. Pickup, payment at pickup. Is that correct?`);
  }
  if (s.phase === "confirm" && YES.test(text) && !matches.length) {
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

// Every public turn includes a replayable, validated cart journal.
export function runTurn(state:DialogState,text:string,analysis?:RecognitionAnalysis):TurnResult{
  const result=runTurnCore(state,text,analysis);
  result.state=JSON.parse(JSON.stringify(result.state));
  result.operations=recordCartOperations(state.cart,result.state.cart);
  const oneSize=result.matches.filter(match=>!getItem(match.itemId)!.size&&new RegExp(`\\b(?:large|small|regular)\\s+(?:${speechText(match.heard).replace(/[^a-z ]/g,"")})\\b`,"i").test(speechText(text)));
  if(oneSize.length)result.reply=`${[...new Set(oneSize.map(match=>match.name))].join(" and ")} has one size. ${result.reply}`;
  const key=(line:CartLine)=>`${line.itemId}:${line.size??""}`;
  const total=(cart:CartLine[],id:string)=>cart.filter(line=>key(line)===id).reduce((sum,line)=>sum+line.qty,0);
  const addedLines=result.operations!.filter(operation=>operation.action==="add").map(operation=>operation.after!);
  const added=addedLines.map(line=>`${line.qty} ${line.name}${line.size?`, ${line.size}`:""}${line.spiceLevel?`, ${line.spiceLevel}`:""}`);
  const removal=isRemovalCommand(text)||state.pendingCorrection?.segment.action==="remove"||!!state.removalConfirmation;
  if(removal){
    const removed=[...new Set(state.cart.map(key))].flatMap(id=>{const qty=total(state.cart,id)-total(result.state.cart,id),line=state.cart.find(line=>key(line)===id)!;return qty>0?[`${qty} ${line.name}${line.size?`, ${line.size}`:""}`]:[];});
    if(removed.length)result.reply=`Removed ${removed.join(" and ")}. ${pendingQuestion(result.state)??"Anything else?"}`;
  }
  const progress=JSON.stringify([state.cart,state.pending,state.orderSpice,state.phase,state.recognition?.issues.map(issue=>issue.heard),state.pendingCorrection?.segment])!==JSON.stringify([result.state.cart,result.state.pending,result.state.orderSpice,result.state.phase,result.state.recognition?.issues.map(issue=>issue.heard),result.state.pendingCorrection?.segment]);
  const browsing=!!menuBrowsing(text,state.browsing??(state.lastReply?.includes("Menu categories:")?{key:"menu",offset:0}:undefined));
  const miss=!browsing&&!progress&&(!!pendingQuestion(result.state)||!!result.needsLLM)&&!/^\b(?:price|cost|total|subtotal|bill|how much)\b/i.test(text);
  result.state.recoveryMisses=miss?(state.recoveryMisses??0)+1:0;
  if(result.state.recoveryMisses>=2&&!result.reply.includes("Menu categories:"))result.reply=`${CATEGORY_LIST} Which category would you like?`;
  if(result.state.recoveryMisses>=3&&!browsing){result.state.needsReview=true;result.reply="I couldn't resolve that. The team can help; what callback number should they use?";}
  if(added.length&&!addedLines.every(line=>result.reply.includes(`${line.qty} ${line.name}`)))result.reply=`Added ${added.join(" and ")}. ${result.reply}`;
  if(result.reply===state.lastReply){
    if(browsing)result.reply=`${CATEGORY_LIST} Which category would you like next?`;
    else if(result.state.pending)result.reply=`For ${getItem(result.state.pending.itemId)!.name}, please choose Half or Full.`;
    else if(result.state.phase==="ask_spice")result.reply=`Please choose ${spiceOptions.join(", ")}.`;
    else result.reply=`${CATEGORY_LIST} Which category would you like?`;
    if(result.reply===state.lastReply)result.reply="Could you say that again? You can order or ask about the menu.";
  }
  result.state.lastReply=result.reply;
  return result;
}
