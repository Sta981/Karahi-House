import type {DialogState} from "./dialog";

// Consent belongs to the last question actually shown, including its quantity
// and modifiers. A retained candidate is not standing permission to add it.
export function recognitionKey(state:DialogState):string|undefined {
 const issue=state.recognition?.issues[0];
 return issue?JSON.stringify([issue.kind,issue.reason,issue.heard,issue.candidates.map(item=>[item.itemId,item.qty,item.portion,item.spiceLevel,item.notes])]):undefined;
}
export function canAcceptRecognition(state:DialogState):boolean {
 const key=recognitionKey(state);return !!key&&state.recognitionPrompt===key;
}
export function recognitionConsent(text:string):{answer:string;information?:string}|undefined {
 const value=text.toLowerCase().replace(/[,.!?]/g," ").replace(/\s+/g," ").trim();
 const parts=value.split(/\s+and\s+/);if(parts.length>2)return;
 if(parts[1]&&!/^(?:(?:tell|show|give) me (?:the |my )?|what is (?:the |my )?)(?:subtotal|total|bill)(?: please)?$/.test(parts[1]))return;
 const number="(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|\\d+)(?: (?:one|two|three|four|five|six|seven|eight|nine))?";
 const match=parts[0].match(new RegExp(`^(?:yes|yeah|yep|haan|han|ji)(?: (?:please )?(?:add|include) (?:it|that|them))?(?: (${number})(?: times| orders)?)?(?: please)?$`));
 return match?{answer:`yes${match[1]?` ${match[1]}`:""}`,information:parts[1]}:undefined;
}
