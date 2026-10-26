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
