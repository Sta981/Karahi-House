import { MENU,MODIFIERS } from "../lib/menu";
import { speechText } from "../lib/speech";
import type { SttModel } from "./contracts";
const endings=[...new Set(MENU.flatMap(item=>[item.name,item.website_name,...item.aliases].filter((name):name is string=>!!name).map(speechText)))];
export type Completion="complete"|"incomplete"|"uncertain";
export function phraseCompletion(text:string):Completion{
 const heard=speechText(text).trim();
 if(/\b(?:and|aur|with|plus|the|a|an|one|two|three|four|five|six|seven|eight|nine|ten|aik|ek|do|teen|char|chaar|paanch|\d+)\s*$/.test(heard))return "incomplete";
 if(/\b(?:half|full|haf|fool|that s all|thats all|that will be all|nothing else|yes|no|correct|bas)\s*$/.test(heard))return "complete";
 if(MODIFIERS.spice_level.options.some(option=>heard.endsWith(speechText(option)))||/\b(?:mild|medium|spicy)\s*$/.test(heard))return "complete";
 return endings.some(ending=>heard===ending||heard.endsWith(` ${ending}`))?"complete":"uncertain";
}
export type AdaptiveWait={completeMs:number;incompleteMs:number;uncertainMs:number};
export const DEFAULT_ADAPTIVE:AdaptiveWait={completeMs:1100,incompleteMs:1600,uncertainMs:900};
// Provisional per-model waits selected on the SAME six paired pause scenarios.
// en-IN retains the safe fixed-duration fallback: faster candidates cut off a
// complete prefix before its continued suffix. No accent/model winner implied.
export const COMPLETE_WAIT:Record<SttModel,number>={flux:750,"nova-3":1100,"nova-3-en-IN":1600};
export const adaptiveWait=(model:SttModel):AdaptiveWait=>({...DEFAULT_ADAPTIVE,completeMs:COMPLETE_WAIT[model]});
