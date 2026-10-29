import type { CartLine, DialogState } from "./dialog";
import { hasCorrectionMarkers, isRemovalCommand } from "./order-operations";
import { MENU, MODIFIERS } from "./menu";
import {isCompletionSignal,isNoMoreAnswer,preparationTimeQuestion} from "./closing";
import {recipientPreference} from "./menu-browsing";
const CANONICAL_ORDER_NAMES=MENU.flatMap(item=>[item.name,item.website_name].filter((name):name is string=>!!name).map(name=>name.toLowerCase()));

export type TurnIntent = "add_order" | "correction" | "removal" | "question" | "complaint" | "confirm" | "done" | "chitchat";
export interface IntentDecision { intent: TurnIntent; reason: string }
const FINITE = /^(?:yes|yeah|yep|yeas|yess|haan|han|ji|correct|no|nope|nah|know|nahi|okay|ok|sure)(?: please)?[.!]?$/i;
export const desiredTotal = (text: string): number | undefined => {
  const number = "(one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";
  const match = text.match(new RegExp(`\\b(?:only|just)\\s+${number}\\b`, "i")) ??
    text.match(new RegExp(`\\b${number}\\s+(?:is|will be)\\s+enough\\b`, "i")) ??
    text.match(new RegExp(`\\bmake (?:it|that)\\s+${number}\\b`, "i"));
  if (!match) return;
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return /^\d+$/.test(match[1]) ? Number(match[1]) : words.indexOf(match[1].toLowerCase());
};

// Intent is decided before recognition, segmentation or a mutable order draft.
// Contextual acceptance is an explicit authorization of the pending action,
// not permission for arbitrary dish mentions to become new order lines.
export function classifyTurn(state: DialogState, raw: string): IntentDecision {
  const text = raw.trim();
  const choose = (intent: TurnIntent, reason: string): IntentDecision => ({ intent, reason });
  const cartConcern = /\b(?:why|you (?:have )?added|you put|you charged|you did|didn'?t|did not|wrong|mistake|too many|i (?:already )?(?:said|ordered|asked for))\b/i.test(text);
  const explicitFix = /\b(?:please\s+)?(?:remove|delete|change|replace|make it|make that|set|reduce)\b/i.test(text);
  if(/\b(?:don't|do not|never)\s+(?:add|order|include|give|bring)\b/i.test(text))return choose("complaint","negated addition is read-only");
  if(recipientPreference(text))return choose("question","ask a food preference without inventing a dish");
  if(/^(?:don't|do not|isn't|aren't|haven't)\s+(?:you|there|it)\b/i.test(text))return choose("question","negative question is not an order");
  if (cartConcern && !explicitFix && desiredTotal(text) === undefined) return choose("complaint", "cart concern is read-only");
  if (/^(?:why|how come)\b/i.test(text) && desiredTotal(text) === undefined && !/\b(?:please remove|please change|please set)\b/i.test(text)) return choose("complaint", "explanation requested");
  if (/\b(?:what(?:'s| is)?|how much|how many|how long|do you|does it|is there|are there|is .*in (?:my|the) (?:cart|order)|already have|in (?:that|the|my) cart|cart section|in my order|show (?:me )?(?:my|the) (?:cart|order))\b/i.test(text) &&
      !/^(?:add|remove|delete|replace|change|make|set|i want|i need|can i (?:get|have)|could i (?:get|have))\b/i.test(text)) return choose("question", "information requested");
  if(/^(?:is|are|was|were|does|did|will|would|could|can|do (?:you|we|they|i))\b/i.test(text)&&!/^(?:can|could|would) (?:i (?:get|have)|you (?:add|give|bring|get|remove|change|make))\b/i.test(text))return choose("question","question form");
  if (state.removalQuantity || state.removalConfirmation || state.pendingCorrection?.segment.action === "remove") return choose("removal", "answer bound to pending removal");
  if(state.categoryOrder&&(/^(?:yes|yeah|yep|haan|no|nope|cancel)(?: please)?[.!]?$/i.test(text)||/^(?:one|two|three|four|five|\d+)(?:\s+of)?\s+each(?:\s+please)?[.!]?$/i.test(text)))return choose(/^no|^cancel/i.test(text)?"confirm":"add_order","explicit pending category answer");
  if(preparationTimeQuestion(text))return choose("question","preparation-time question is read-only");
  if(isNoMoreAnswer(text)&&! /^(?:no|nope|nah|nahi|correct|that'?s right)[.!]?$/i.test(text))return choose("done","finite completion before correction parsing");
  if(state.pendingOrderList&&/^(?:add|add them|extra|extra items|add these|add these items|replace|replace it|replace the order|replace my order|replace the current order)[.!]?$/i.test(text))return choose("correction","explicit pending list action");
  if (isRemovalCommand(text)) return choose(/\b(?:and|aur|plus)\s+(?:add|give|bring|get|i want)\b/i.test(text)?"correction":"removal", "explicit removal or mixed action request");
  if (desiredTotal(text) !== undefined || hasCorrectionMarkers(text) || /^(?:no[, ]+|not\b|instead\b)/i.test(text)) return choose("correction", "explicit correction");
  const spice = MODIFIERS.spice_level.options.some(option => text.toLowerCase().includes(option.toLowerCase())) || /\b(?:mild|medium|spicy|teekha|tikha|mirchi|hot)\b/i.test(text);
  if (isCompletionSignal(text)) {
    if(CANONICAL_ORDER_NAMES.some(name=>new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i").test(text)))return choose("add_order","order fragment plus completion");
    return choose(spice&&state.cart.length?"correction":"done", "caller finished");
  }
  if (FINITE.test(text)) {
    if (/^(?:no|nope|nah|nahi)[.!]?$/i.test(text) && !state.recognition && !state.pending && state.phase === "open") return choose("done", "no more items");
    if (state.recognition && !/^(?:no|nope|nah|nahi)/i.test(text)) return choose(state.recognition.replacement ? "correction" : "add_order", "explicit acceptance of proposed item");
    if (state.answerConfirmation?.kind === "size") return choose("add_order", "accepted pending size");
    if (state.answerConfirmation?.kind === "spice") return choose("correction", "accepted modifier");
    return choose("confirm", "finite confirmation");
  }
  if (spice && state.cart.length && !/\b(?:add|another|also|want|need|get|have)\b/i.test(text)) return choose("correction", "explicit modifier answer");
  if (/^(?:hi|hello|hey|salam|salaam|namaste|thanks|thank you|my name is|this is|i am|i'm|callback|call back|phone|contact|mobile)\b/i.test(text) ||
      /\b(?:allerg(?:y|ies|ic)|speak to|talk to|real person|human agent|catering|hours|address|halal|pickup available|prep time)\b/i.test(text)) return choose("chitchat", "business or social turn");
  if (state.phase === "ask_name") return choose("chitchat", "pickup name");
  return choose("add_order", state.pending ? "pending order answer or new request" : "ordering fragment");
}

export const equivalentLine = (line: Pick<CartLine, "itemId" | "size" | "spiceLevel" | "notes">) =>
  JSON.stringify([line.itemId, line.size ?? null, line.spiceLevel ?? null, [...line.notes].sort()]);
export const spokenLine = (line: CartLine, qty = line.qty): string =>
  `${qty} ${line.name}${line.size ? `, ${line.size}` : ""}${line.spiceLevel ? `, ${line.spiceLevel}` : ""}${line.notes.length ? `, notes: ${line.notes.join("; ")}` : ""}`;
export interface DisclosedChange { action: "added" | "removed" | "changed"; before?: CartLine; after?: CartLine; text: string }

// Semantic diff is independent of array positions and the replay journal.
// Removing a first line cannot be mistaken for changing every following line.
export function cartChanges(before: CartLine[], after: CartLine[]): DisclosedChange[] {
  const group = (lines: CartLine[]) => {
    const groups = new Map<string, CartLine>();
    for (const line of lines) { const key = equivalentLine(line), prior = groups.get(key); groups.set(key, { ...line, qty: (prior?.qty ?? 0) + line.qty }); }
    return groups;
  };
  const old = group(before), next = group(after), changes: DisclosedChange[] = [];
  for (const [key, previous] of old) {
    const current = next.get(key); if (!current) continue;
    const delta = current.qty - previous.qty;
    if (delta > 0) changes.push({ action: "added", before: previous, after: current, text: `Added ${spokenLine(current, delta)}; ${current.qty} total.` });
    if (delta < 0) changes.push({ action: "removed", before: previous, after: current, text: `Removed ${spokenLine(previous, -delta)}, ${current.qty} left.` });
    old.delete(key); next.delete(key);
  }
  for (const [key, previous] of old) {
    const replacements = [...next].filter(([, current]) => current.itemId === previous.itemId);
    if (replacements.length === 1 && [...old.values()].filter(line => line.itemId === previous.itemId).length === 1) {
      const [newKey, current] = replacements[0];
      changes.push({ action: "changed", before: previous, after: current, text: `Changed ${spokenLine(previous)} to ${spokenLine(current)}.` });
      old.delete(key); next.delete(newKey);
    }
  }
  for (const previous of old.values()) changes.push({ action: "removed", before: previous, text: `Removed ${spokenLine(previous)}, 0 left.` });
  for (const current of next.values()) changes.push({ action: "added", after: current, text: `Added ${spokenLine(current)}.` });
  return changes;
}

export function permitsCart(intent: TurnIntent, before: CartLine[], after: CartLine[]): boolean {
  if (intent === "add_order" || intent === "correction") return true;
  if (intent !== "removal") return JSON.stringify(before) === JSON.stringify(after);
  // A removal may only subtract from existing equivalent lines, never convert
  // spice/size or manufacture a new identity, even if total count is unchanged.
  const available = new Map<string, number>();
  for (const line of before) available.set(equivalentLine(line), (available.get(equivalentLine(line)) ?? 0) + line.qty);
  for (const line of after) { const key = equivalentLine(line), left = (available.get(key) ?? 0) - line.qty; if (left < 0) return false; available.set(key, left); }
  return true;
}
