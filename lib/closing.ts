// Conversation signals, not menu aliases. Keep negated requests such as
// "no onions" and "don't finish yet" outside the finite closing answers.
const plain=(text:string)=>text.toLowerCase().replace(/[’]/g,"'").replace(/[,.!?;:]/g," ").replace(/\s+/g," ").trim();
const OLD_DONE=/\b(?:that'?s (?:all|it)|that (?:will|would) be all|nothing else|checkout|check out|bas|khatam|i'?m done|end (?:the |this )?call|goodbye|bye)\b/i;
const COMPLETION=/^(?:(?:no|nah|nahi|nhi|nahin|nai)\s+)?(?:(?:it'?s|it is) (?:(?:done|finished)(?: now)?|over)|(?:all )?done(?: now)?|finished|everything (?:is )?done|(?:the |my )?order (?:is )?(?:complete|completed|done|finished)|(?:i am|i'm|we are|we're) (?:finished|done|all done|all set)|that completes (?:my|the) order|(?:(?:that'?s|it'?s|it is) )?(?:enough|enouh)|no more(?: items|food)?|(?:bas )?(?:yahi|yhi|yehi|yeh hi)(?: mera)? order (?:hai|hain)|mera order (?:complete|khatam) hai|(?:bas )?(?:ehi|eh hi) order (?:aa|ae|hai)|bas (?:ena|inna) hi)(?: (?:please|thanks(?: so much| very much| a lot)?|thank you(?: so much| very much| a lot)?|ji))*$/i;
export function isCompletionSignal(text:string):boolean{const value=plain(text);return OLD_DONE.test(value)||COMPLETION.test(value);}
export function isNoMoreAnswer(text:string):boolean{
 const value=plain(text);
 if(/\b(?:wrong|incorrect|mistake|remove|change|replace|add|another|instead|onions?|spice)\b/.test(value))return false;
 return /^(?:no|nope|nah|nahi|nhi|nahin|nai|bas|khatam|nothing else|no more|that'?s all|that'?s it|that will be all|that would be all|i'?m done|goodbye|bye|all good|correct|that'?s right|it is correct|the order is correct)(?: (?:please|thanks(?: so much| very much| a lot)?|thank you(?: so much| very much| a lot)?|ji))*$/.test(value)||COMPLETION.test(value);
}
export const wantsMore=(text:string)=>/^(?:yes|yeah|yep|haan|han|ji)(?:\s+(?:please|ji))?[.!]?$/i.test(text.trim());

// Only strip courtesies when an explicit action follows. Never erase a
// negation, a complaint, a customer's name or a pending choice.
export function explicitActionText(text:string):string{
 return text.replace(/^(?:(?:thank you(?: so much)?|thanks|hello|hi|okay|ok|yes|yeah|sir|so|please)[,.!\s]+)+(?=(?:i\s+(?:want|need|would like)|add|remove|delete|order|change|replace)\b)/i,"")
  .replace(/^(?:actually\s+)?i want to say\s+(?=(?:add|remove|delete|order|change|replace)\b)/i,"");
}
export function noChangeCompletion(text:string):string|undefined{
 const match=plain(text).match(/^(?:(?:no|okay|ok)\s+)*(?:you\s+)?(?:don't|do not)(?: need(?: to)?)? (?:change|replace|remove) anything\s+(.+)$/);
 return match&&isNoMoreAnswer(match[1])?match[1]:undefined;
}
export function preparationTimeQuestion(text:string):"pickup"|"delivery"|undefined{
 const value=plain(text);
 if(!/^(?:how\b|when\b)/.test(value)||!/\b(?:long|time|takes?|ready|prepare|prep|cook|make|wait|collect)\b/.test(value)||!/\b(?:it|order|orders|pickup|pick up)\b/.test(value))return;
 return /\bdeliver(?:y)?\b/.test(value)?"delivery":"pickup";
}

// Two finite intents in one turn: checkout plus a preparation-time question.
// Do not extract completion from a sentence that also orders or changes food.
export function completionWithTiming(text:string):string|undefined{
 const value=plain(text).replace(/^(?:ok|okay|well)\s+/,""),match=value.match(/^(.+?)\s+(?:and\s+)?(how\b.+|when\b.+)$/);
 if(!match)return;
 const completion=match[1].replace(/\s+now$/," ").trim();
 // Reject merged/garbled tails instead of extracting a convenient substring.
 const allowed=/^(?:how|when|long|much|many|time|it|takes?|to|make|my|the|an|our|order|orders|will|would|does|do|can|i|be|get|wait|for|ready|prepare|prep|cook|collect|pick|up|pickup|deliver|delivery|and|please|is)$/;
 return isNoMoreAnswer(completion)&&preparationTimeQuestion(match[2])&&match[2].split(" ").every(word=>allowed.test(word))?completion:undefined;
}
