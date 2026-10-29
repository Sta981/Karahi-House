import { performance } from "node:perf_hooks";
import { runSmartTurn } from "../lib/brain";
import { GREETING, newState } from "../lib/dialog";
import { getItem,MODIFIERS } from "../lib/menu";
import type { Emit, Tts } from "./contracts";
import type { DialogState,CallSummary } from "../lib/dialog";
import type {DemoTicket} from "../lib/demo-ticket-types";
import { rollbackCartOperations,type CartOperation } from "../lib/cart-journal";
import type { BargeTrigger } from "./barge-in";
import {romanTranscript} from "./roman-transcript";
import {isCompletionSignal} from "../lib/closing";
import {canAcceptRecognition} from "../lib/answer-scope";

export class VoiceSession {
  private state = newState({closingMode:"anything_else"});
  private generation = 0;
  private abort?: AbortController;
  private closed = false;
  private checkpoint?:{before:DialogState;text:string;operations:CartOperation[];committed:boolean;generation:number};
  constructor(private tts: Tts, private emit: Emit, private faqEnabled = false,private onConfirmed?:(summary:CallSummary,callbackProvided:boolean,publish:(ticket:DemoTicket)=>void)=>Promise<void>) {}
  endpointAnswers():string[]{
    if(this.state.removalQuantity)return ["one","two","three","all","both","only one","ek","aik","do","dono","sab","no","cancel",...Array.from({length:this.state.removalQuantity.available},(_,index)=>String(index+1))];
    if(this.state.categoryOrder)return ["yes","yeah","no","nope","cancel"];
    if(canAcceptRecognition(this.state))return ["yes","yeah","no","nope",...this.state.recognition!.issues[0].candidates.map(candidate=>candidate.name)];
    if(this.state.pending)return ["Half","Full","have","haf","fool","bot"];
    if(this.state.phase==="ask_spice")return [...MODIFIERS.spice_level.options,"mild","medium","hot"];
    if(this.state.phase==="confirm"||this.state.removalConfirmation||this.state.answerConfirmation||this.state.browsing||/Anything else\?$/.test(this.state.lastReply??""))return ["yes","no","yeah","nope","that's all","that's it","enough","it's over","it's done now","nahi","nhi","yahi order hai"];
    return [];
  }
  recognitionHints():string[]{
    if(this.state.categoryOrder)return ["yes","no",...this.state.categoryOrder.itemIds.map(id=>getItem(id)!.name)];
    if(this.state.removalQuantity)return ["one","both","all",getItem(this.state.removalQuantity.itemId)!.name];
    if(this.state.pendingCorrection)return ["no",...this.state.cart.map(line=>getItem(line.itemId)!.name)];
    if(canAcceptRecognition(this.state))return ["yes","no",...this.state.recognition!.issues[0].candidates.map(candidate=>getItem(candidate.itemId)!.name)];
    if(this.state.pending)return ["Half","Full"];
    if(this.state.phase==="ask_spice")return MODIFIERS.spice_level.options;
    if(this.state.phase==="confirm")return ["yes","no"];
    return [];
  }
  interrupt(trigger:BargeTrigger={source:"server_turn"}) {
    this.abort?.abort(); this.abort = undefined;
    this.generation++;
    this.emit({ type: "interrupt", generation: this.generation,...trigger });
  }
  async greet() { await this.reply(GREETING, 0, performance.now()); }
  async turn(text: string, audioEndSeconds: number | null = null, endpointReason = "manual_final",continuation?:{of:string;fragment:string}) {
    if (this.closed || this.state.phase==="closed" || !text.trim() || text.length > 1000) return;
    let supersedesGeneration:number|undefined;
    if(continuation){
      const previous=this.checkpoint;
      const finite=isCompletionSignal(continuation.fragment)||/^(?:half|full|haf|fool|have|yes|no|chicken|goat|lamb|beef|fish|shrimp|paneer|karahi|naan|spicy|extra spicy|medium(?: spice)?|mild(?: spice)?|no spice)[.!]?$/i.test(continuation.fragment.trim());
      if(previous?.text===continuation.of&&!finite&&!['ask_name','confirm','closed'].includes(this.state.phase)&&!this.state.checkoutRequested){
        const cart=previous.committed?rollbackCartOperations(this.state.cart,previous.operations):structuredClone(previous.before.cart);
        this.state={...structuredClone(previous.before),cart};supersedesGeneration=previous.generation;
        this.emit({type:"cart_revision",supersedesGeneration,cart:this.state.cart,reason:"continuation_rollback"});
      }else text=continuation.fragment;
    }
    this.interrupt();
    const generation = this.generation, finalAt = performance.now();
    this.emit({ type: "transcript", text, displayText:romanTranscript(text), generation, audioEndSeconds, finalAt, endpointReason });
    const start = performance.now(),cpu=process.cpuUsage();let engineProfile:Record<string,unknown>|undefined;
    const checkpoint={before:structuredClone(this.state),text,operations:[] as CartOperation[],committed:false,generation};this.checkpoint=checkpoint;
    // No provider is touched by default, even when Groq credentials exist.
    // Existing brain guards limit the optional FAQ path; it cannot mutate orders.
    const result = await runSmartTurn(this.state, text, [], { provider: this.faqEnabled ? undefined : null, onRouting: () => {},onProfile:value=>{engineProfile=value;} });
    if (this.closed || generation !== this.generation) return;
    this.state = result.state;
    checkpoint.operations=result.operations??[];checkpoint.committed=true;
    const engineMs = performance.now() - start;
    const usedCpu=process.cpuUsage(cpu);
    this.emit({ type: "reply", text: result.reply, cart: this.state.cart, generation, usedLLM: result.usedLLM, engineMs,engineProfile:{...engineProfile,cpuMs:(usedCpu.user+usedCpu.system)/1000,phase:checkpoint.before.phase,cartLinesBefore:checkpoint.before.cart.length},supersedesGeneration, finalAt, endpointReason, speculativeHit:false, preparationMs:0 });
    const notification=result.endCall&&result.summary?.kind==="order"&&this.onConfirmed?
      this.onConfirmed(result.summary,!!this.state.callbackNumber,ticket=>this.emit({type:"demo_ticket",ticket})).catch(()=>{this.emit({type:"notification_error",message:"The DEMO notification failed. The order has not been accepted."});}):undefined;
    const audioCompleted=await this.reply(result.reply, engineMs, finalAt, generation);
    // Email runs alongside speech. Wait only before releasing the final call,
    // so its final receipt can reach the tab; first-audio latency is unaffected.
    if(notification)await notification;
    if(result.endCall&&audioCompleted&&generation===this.generation&&!this.closed)this.emit({type:"call_end",generation,summary:result.summary});
  }
  private async reply(text: string, engineMs: number, finalAt: number, generation = this.generation) {
    if (this.closed) return false;
    const abort = new AbortController(); this.abort = abort;
    const requestedAt = performance.now(); let first = true,contentFirst=true,sentBytes=0,kind:"neutral"|"informative"="informative",hasSegment=false,terminalFailure=false;
    const audioPlan = this.tts.plan?.(text);
    this.emit({ type: "usage", ttsCharacters: audioPlan?.dynamicCharacters ?? text.length, generation, provider: this.tts.name });
    try {
      for await (const chunk of this.tts.speak(text, abort.signal,event=>{
        if(abort.signal.aborted||generation!==this.generation||this.closed)return;
        if(event.type==="segment"){kind=event.kind??"informative";hasSegment=true;this.emit({type:"audio_segment",generation,kind});}
        if(event.type==="terminal_failure"){terminalFailure=true;this.emit({type:"error",code:"tts_failed",reason:event.reason,generation,recoverable:true,preservePlayback:true,message:"Voice output failed. The cached notice will play; read the reply below. Your microphone and order remain active."});}
        this.emit({type:"tts_telemetry",generation,event:{...event,observedMs:performance.now()-requestedAt}});
      })) {
        if (abort.signal.aborted || generation !== this.generation || this.closed) break;
        if (!chunk.length) continue;
        const firstAt = performance.now();
        if (first) {
          this.emit({ type: "audio_start", generation, sampleRate: 24000, finalAt, firstAt, engineMs, ttsFirstByteMs: firstAt - requestedAt, firstByteCached: audioPlan?.firstByteCached ?? false,acknowledgement:!!audioPlan?.acknowledgementBytes,acknowledgementBytes:audioPlan?.acknowledgementBytes??0 });
          first = false;
        }
        if(contentFirst&&(hasSegment?kind==="informative":sentBytes>=(audioPlan?.acknowledgementBytes??0))){contentFirst=false;this.emit({type:"content_start",generation,at:performance.now(),finalAt,contentFirstByteMs:performance.now()-requestedAt});}
        // A generation header on EVERY frame prevents audio from a cancelled reply resurfacing.
        const framed = Buffer.allocUnsafe(chunk.length + 4); framed.writeUInt32LE(generation, 0); chunk.copy(framed, 4);
        this.emit(framed);
        sentBytes+=chunk.length;
      }
      if (!abort.signal.aborted && generation === this.generation){this.emit({ type: "audio_end", generation });return sentBytes>0&&!terminalFailure;}
      return false;
    } catch(error) {
      const reason=error instanceof Error&&/rate limit|timeout|connection|PCM/i.test(error.message)?/rate limit/i.test(error.message)?"rate_limit":/timeout/i.test(error.message)?"timeout":/PCM/i.test(error.message)?"invalid_pcm":"connection":"synthesis";
      if (!abort.signal.aborted && !this.closed) this.emit({ type: "error", code: "tts_failed", reason, recoverable: true, generation, message: "Voice output failed. Read the reply below; your microphone and order are still active. You can keep speaking." });
      return false;
    }
  }
  close() { this.closed = true; this.abort?.abort(); this.state = newState({closingMode:"anything_else"});this.checkpoint=undefined; }
}
