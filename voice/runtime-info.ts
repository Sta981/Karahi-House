import type { SttModel } from "./contracts";
import type { EndpointSettings } from "./endpointing";
import { adaptiveWait } from "./phrase-completeness";
export interface VoiceRuntimeInfo {
  buildCommit: string;
  buildDirty: boolean;
  sttConfig: { provider: "deepgram"; model: string; language: string; sampleRate: number; keytermCount: number };
  endpointSettings: { mode: "adaptive" | "fixed"; profile: string; completeMs: number; uncertainMs: number; incompleteMs: number; answerMs: number; continuationWindowMs: number; provider: EndpointSettings };
  ttsProvider: string;
  ttsModel: string;
}
export function runtimeInfo(build:{commit:string;dirty:boolean},model:SttModel,profile:EndpointSettings,tts:{provider:string;model:string},keytermCount:number,completeMs:number,mode:"adaptive"|"fixed"):VoiceRuntimeInfo{
  const wait=adaptiveWait(model);
  return {buildCommit:build.commit,buildDirty:build.dirty,sttConfig:{provider:"deepgram",model:model==="flux"?"flux-general-en":"nova-3",language:model==="flux"?"en":model==="nova-3-en-IN"?"en-IN":"multi",sampleRate:16000,keytermCount},endpointSettings:{mode,profile:profile.id,completeMs:mode==="fixed"?1600:completeMs,uncertainMs:mode==="fixed"?1600:wait.uncertainMs,incompleteMs:mode==="fixed"?1600:wait.incompleteMs,answerMs:mode==="fixed"?1600:wait.answerMs??600,continuationWindowMs:2200,provider:{...profile}},ttsProvider:tts.provider,ttsModel:tts.model};
}
