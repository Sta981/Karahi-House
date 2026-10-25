export const BARGE_IN_DEFAULTS={threshold:0.024,playbackThreshold:0.04,minSpeechMs:480,echoCorrelation:0.8};
export type BargeTrigger={source:"browser_vad"|"manual"|"server_turn"|"continuation"|"tts_error";energy?:number;threshold?:number;speechMs?:number};
export function qualifiedBargeIn(trigger:Record<string,unknown>):boolean{
 if(trigger.source==="manual")return true;
 return trigger.source==="browser_vad"&&typeof trigger.energy==="number"&&Number.isFinite(trigger.energy)&&trigger.energy<=1&&
  typeof trigger.threshold==="number"&&trigger.threshold>=BARGE_IN_DEFAULTS.threshold&&trigger.energy>=trigger.threshold&&
  typeof trigger.speechMs==="number"&&trigger.speechMs>=BARGE_IN_DEFAULTS.minSpeechMs;
}
