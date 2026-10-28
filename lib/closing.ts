// Conversation signals, not menu aliases. Keep negated requests such as
// "no onions" and "don't finish yet" outside the finite closing answers.
const plain=(text:string)=>text.toLowerCase().replace(/[’]/g,"'").replace(/[,.!?;:]/g," ").replace(/\s+/g," ").trim();
const OLD_DONE=/\b(?:that'?s (?:all|it)|that (?:will|would) be all|nothing else|checkout|check out|bas|khatam|i'?m done|end (?:the |this )?call|goodbye|bye)\b/i;
const COMPLETION=/^(?:(?:no|nah|nahi|nhi|nahin|nai)\s+)?(?:(?:it'?s|it is) (?:done(?: now)?|over)|(?:all )?done(?: now)?|finished|(?:the |my )?order (?:is )?(?:complete|completed|done|finished)|(?:i am|i'm|we are|we're) (?:finished|all done|all set)|that completes (?:my|the) order|(?:(?:that'?s|it'?s|it is) )?(?:enough|enouh)|no more(?: items|food)?|(?:bas )?(?:yahi|yhi|yehi|yeh hi)(?: mera)? order (?:hai|hain)|mera order (?:complete|khatam) hai|(?:bas )?(?:ehi|eh hi) order (?:aa|ae|hai)|bas (?:ena|inna) hi)(?: (?:please|thanks|thank you|ji))*$/i;
export function isCompletionSignal(text:string):boolean{const value=plain(text);return OLD_DONE.test(value)||COMPLETION.test(value);}
export function isNoMoreAnswer(text:string):boolean{
 const value=plain(text);
 if(/\b(?:wrong|incorrect|mistake|remove|change|replace|add|another|instead|onions?|spice)\b/.test(value))return false;
 return /^(?:no|nope|nah|nahi|nhi|nahin|nai|bas|khatam|nothing else|no more|that'?s all|that'?s it|that will be all|that would be all|i'?m done|goodbye|bye|all good|correct|that'?s right|it is correct|the order is correct)(?: (?:please|thanks|thank you|ji))*$/.test(value)||COMPLETION.test(value);
}
export const wantsMore=(text:string)=>/^(?:yes|yeah|yep|haan|han|ji)(?:\s+(?:please|ji))?[.!]?$/i.test(text.trim());

// Two finite intents in one turn: checkout plus a preparation-time question.
// Do not extract completion from a sentence that also orders or changes food.
export function completionWithTiming(text:string):string|undefined{
 const value=plain(text).replace(/^(?:ok|okay|well)\s+/,""),parts=value.split(/\s+and\s+/);
 if(parts[0])parts[0]=parts[0].replace(/\s+now$/," ").trim();
 if(parts.length!==2||!isNoMoreAnswer(parts[0]))return;
 return /^(?:how long(?: (?:will|does) (?:it|my order) take)?|how (?:much|many) time (?:(?:can|will|do) i|i (?:can|will)) (?:get|wait for) my order|when (?:will|can) (?:my order be ready|i (?:get|collect) my order))$/.test(parts[1])?parts[0]:undefined;
}
