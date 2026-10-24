import type { BargeTrigger } from "./barge-in";
export type PlaybackMetrics={replyTextLength:number;finished:boolean;serverAudioEnded:boolean;interruptedByBargeIn:boolean;trigger?:BargeTrigger;receivedChunks:number;droppedChunks:number;lateChunks:number;activeChunks:number;acknowledgementGapMs:number|null;maxGapMs:number;failed:boolean};
type Row=PlaybackMetrics&{ackBytes:number;bytes:number;ackEnd?:number;scheduledEnd?:number};
// Completion means the LAST browser source ended naturally, not that TTS sent EOF.
export class PlaybackLedger {
 private rows=new Map<number,Row>();
 private row(generation:number){let row=this.rows.get(generation);if(!row){row={replyTextLength:0,finished:false,serverAudioEnded:false,interruptedByBargeIn:false,receivedChunks:0,droppedChunks:0,lateChunks:0,activeChunks:0,acknowledgementGapMs:null,maxGapMs:0,failed:false,ackBytes:0,bytes:0};this.rows.set(generation,row);}return row;}
 reply(generation:number,length:number){this.row(generation).replyTextLength=length;}
 start(generation:number,ackBytes:number){this.row(generation).ackBytes=ackBytes;}
 schedule(generation:number,bytes:number,start:number,duration:number){
  const row=this.row(generation);row.receivedChunks++;row.activeChunks++;
  const gap=row.scheduledEnd===undefined?0:Math.max(0,(start-row.scheduledEnd)*1000);row.maxGapMs=Math.max(row.maxGapMs,gap);
  if(row.ackBytes&&row.bytes>=row.ackBytes&&row.acknowledgementGapMs===null&&row.ackEnd!==undefined)row.acknowledgementGapMs=Math.max(0,(start-row.ackEnd)*1000);
  if(row.ackBytes&&row.bytes<row.ackBytes&&row.bytes+bytes>=row.ackBytes)row.ackEnd=start+(row.ackBytes-row.bytes)/48000;
  row.bytes+=bytes;row.scheduledEnd=start+duration;
 }
 drop(generation:number,late=true){const row=this.row(generation);row.droppedChunks++;if(late)row.lateChunks++;}
 ended(generation:number){const row=this.row(generation);row.activeChunks=Math.max(0,row.activeChunks-1);this.finish(row);}
 serverEnd(generation:number){const row=this.row(generation);row.serverAudioEnded=true;this.finish(row);}
 interrupt(generation:number,trigger:BargeTrigger){const row=this.row(generation);if(row.finished)return;row.trigger??=trigger;row.interruptedByBargeIn ||= ["browser_vad","manual"].includes(trigger.source);row.failed ||= trigger.source==="tts_error";row.finished=false;}
 private finish(row:Row){row.finished=row.serverAudioEnded&&row.activeChunks===0&&!row.trigger&&!row.failed&&row.receivedChunks>0;}
 metrics(generation:number):PlaybackMetrics{const {ackBytes,bytes,ackEnd,scheduledEnd,...metrics}=this.row(generation);return structuredClone(metrics);}
}
