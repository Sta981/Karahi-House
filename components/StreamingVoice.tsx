"use client";
import { useEffect, useRef, useState } from "react";
import { voiceCsv,type VoiceLogRow } from "@/voice/turn-log";
import { mishearingsCsv } from "@/voice/mishearings";
import { recoverableVoiceError,voiceErrorMessage } from "@/voice/connection-status";
import { BARGE_IN_DEFAULTS,type BargeTrigger } from "@/voice/barge-in";
import { PlaybackLedger } from "@/voice/playback";

type Timing = { totalMs: number; endpointAndUplinkMs: number; engineMs: number; ttsFirstByteMs: number; returnNetworkMs: number; browserRttMs: number; clockUncertaintyMs: number };
function percentiles(values: number[]) { const sorted = [...values].sort((a,b) => a-b); return { n: sorted.length, p50: sorted[Math.max(0, Math.ceil(sorted.length*.5)-1)]?.toFixed(1) ?? "—", p95: sorted[Math.max(0, Math.ceil(sorted.length*.95)-1)]?.toFixed(1) ?? "—" }; }
export default function StreamingVoice() {
  const [model, setModel] = useState(""), [status, setStatus] = useState("Choose a model to compare"), [active, setActive] = useState(false);
  const [accessCode,setAccessCode]=useState(""),[locationLabel,setLocationLabel]=useState("Not measured"),[logs,setLogs]=useState<VoiceLogRow[]>([]);
  const [requiresAccessCode,setRequiresAccessCode]=useState(false),[partial,setPartial]=useState(""),[micLevel,setMicLevel]=useState(0);
  const [intended,setIntended]=useState<Record<string,string>>({});
  const [ignoreInterruptions,setIgnoreInterruptions]=useState(false),[ticket,setTicket]=useState<unknown>(null);
  const [rows, setRows] = useState<{role:string;text:string}[]>([]), [cart, setCart] = useState<any[]>([]), [timings, setTimings] = useState<Timing[]>([]);
  const cleanup = useRef<() => void>(() => {}); const interrupt = useRef<(trigger?:BargeTrigger) => void>(() => {});
  useEffect(() => {
    const abort=new AbortController();
    void fetch("/voice-health",{signal:abort.signal,cache:"no-store"}).then(response=>response.json()).then(health=>{if(!abort.signal.aborted)setRequiresAccessCode(health.requiresAccessCode===true);}).catch(()=>{});
    return ()=>{abort.abort();cleanup.current();};
  }, []);
  async function connect() {
    cleanup.current(); setTicket(null);setTimings([]); setRows([]); setCart([]); setLogs([]);setIntended({});setPartial("");setMicLevel(0);setStatus("Opening microphone…"); setActive(true);
    let context: AudioContext | undefined, stream: MediaStream | undefined, worklet: AudioWorkletNode | undefined, capture: MediaStreamAudioSourceNode | undefined;
    let socket:WebSocket|undefined,pingTimer:ReturnType<typeof setInterval>|undefined,connectTimer:ReturnType<typeof setTimeout>|undefined;
    let stopped = false, ready = false, generation = -1, minGeneration = 0, blocked = false, scheduled = 0, sync = { rtt: Infinity, offset: 0 };
    let lastEnd = NaN, lastEndAudio = NaN, audioStart: any, measuredGeneration = -1, pendingByte: number | undefined;
    const sources = new Set<AudioBufferSourceNode>();
    let endingGeneration:number|undefined;
    const playback=new PlaybackLedger();
    const segmentKinds=new Map<number,"neutral"|"informative">(),speechEnds=new Map<number,number>(),heardTiming=new Map<number,Record<string,number>>();
    const send=(message:Record<string,unknown>)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
    const publishPlayback=(id:number)=>{if(id<0)return;const metrics=playback.metrics(id);send({type:"playback",generation:id,metrics});setLogs(previous=>previous.map(row=>row.turnId.endsWith(`:${id}`)?{...row,playback:metrics}:row));if(id===endingGeneration&&metrics.finished){stopConnection();setStatus("Call ended. Your demo ticket is shown below.");}};
    const stopAudio = (trigger?:BargeTrigger) => {
      if(trigger&&generation>=0){playback.interrupt(generation,trigger);publishPlayback(generation);}
      for (const source of sources) { try { source.stop(); } catch {} } sources.clear(); scheduled = 0; pendingByte = undefined;
    };
    const stopConnection = () => {
      if (stopped) return; stopped = true; ready = false; clearInterval(pingTimer);clearTimeout(connectTimer);stopAudio({source:"server_turn"});
      stream?.getTracks().forEach(track => track.stop()); worklet?.disconnect(); capture?.disconnect(); void context?.close().catch(()=>{});
      send({ type: "stop" });socket?.close();setActive(false);setMicLevel(0);setPartial("");
    };
    cleanup.current=stopConnection;
    const fail=(message:string)=>{if(!stopped){setStatus(message);stopConnection();}};
    interrupt.current = (trigger={source:"manual"}) => { if(stopped||!ready||ignoreInterruptions&&trigger.source==="browser_vad")return;stopAudio(trigger); blocked = true; minGeneration = Math.max(minGeneration, generation+1);send({ type: "barge_in",...trigger }); };
    // Unlock audio in the actual button gesture. Permission/setup finishes
    // before opening billable STT, so a slow permission prompt cannot time out STT.
    try {
      context=new AudioContext({sampleRate:48000});await context.resume();
      if(stopped)return;
      await context.audioWorklet.addModule("/voice-capture.js");
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
      if(stopped){stream.getTracks().forEach(track=>track.stop());return;}
      capture=context.createMediaStreamSource(stream);worklet=new AudioWorkletNode(context,"voice-capture",{numberOfInputs:2,processorOptions:BARGE_IN_DEFAULTS});
      for(const track of stream.getAudioTracks())track.addEventListener("ended",()=>fail("The microphone disconnected. Check your input device and start again."));
    } catch {fail("Microphone permission or audio setup failed. Allow the microphone in this browser and use localhost or HTTPS.");return;}
    if(stopped)return;
    setStatus("Connecting speech recognition…");
    socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/voice`); socket.binaryType = "arraybuffer";
    pingTimer=setInterval(()=>send({type:"ping",sent:performance.now()}),2000);
    connectTimer=setTimeout(()=>fail("Speech connection timed out. Check the server and network, then start again."),25000);
    worklet.port.onmessage = ({ data }) => {
      if (!ready || stopped || socket?.readyState !== WebSocket.OPEN) return;
      if (data.type === "pcm") {
        setMicLevel(Math.min(1,Math.max(0,Number(data.level)||0)));
        if (!Number.isFinite(lastEndAudio)) lastEndAudio = performance.now()-data.audioSeconds*1000;
        if (socket.bufferedAmount > 32000) {fail("Audio upload cannot keep up; reconnect on a steadier network.");return;}
        // Keep the capture clock continuous while demo interruption suppression
        // is active. Zero PCM prevents echo/new turns from cancelling playback.
        socket.send(ignoreInterruptions&&sources.size?new ArrayBuffer(data.pcm.byteLength):data.pcm);
      } else if (data.type === "speech_start") { if(ignoreInterruptions&&sources.size)return;lastEnd = NaN; interrupt.current({source:"browser_vad",energy:data.energy,threshold:data.threshold,speechMs:data.speechMs}); }
      else if (data.type === "speech_end") lastEnd = performance.now()-data.hangoverMs;
    };
    socket.onopen = () => {send({ type: "ping", sent: performance.now() });send({ type: "start", model,accessCode:requiresAccessCode?accessCode:"" });};
    socket.onerror = () => fail("Voice connection failed. Keep npm run dev:voice running and close any other voice-demo tabs.");
    socket.onclose = event => fail(event.code===1000?"Call ended. Start the microphone to begin again.":`Voice connection ended (${event.code}). Start the microphone again to reconnect.`);
    socket.onmessage = async event => {
      if (stopped) return;
      if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data);if(view.byteLength<=4)return;const chunkGeneration=view.getUint32(0,true);
        if (!context || !ready || blocked || chunkGeneration !== generation){playback.drop(chunkGeneration);publishPlayback(chunkGeneration);return;}
        const received = performance.now(),speechEnd=speechEnds.get(generation)??lastEnd;
        if (audioStart && generation > 0 && measuredGeneration !== generation && Number.isFinite(lastEnd) && sync.rtt !== Infinity) {
          const finalBrowser = audioStart.finalAt - sync.offset, firstBrowser = audioStart.firstAt - sync.offset;
          // Greeting is excluded. EOS is an energy-VAD estimate, not manual ground truth.
          const timing: Timing = { totalMs: received-speechEnd, endpointAndUplinkMs: finalBrowser-speechEnd, engineMs: audioStart.engineMs, ttsFirstByteMs: audioStart.ttsFirstByteMs, returnNetworkMs: received-firstBrowser, browserRttMs: sync.rtt, clockUncertaintyMs: sync.rtt/2 };
          if (timing.totalMs >= 0 && timing.endpointAndUplinkMs >= -sync.rtt) {setTimings(prev => [...prev.slice(-199), timing]);send({type:"latency",generation,timing});}
          measuredGeneration = generation;
        }
        const raw = new Uint8Array(event.data, 4);
        const bytes = new Uint8Array(raw.length + (pendingByte === undefined ? 0 : 1)); let offset = 0;
        if (pendingByte !== undefined) { bytes[0] = pendingByte; offset = 1; } bytes.set(raw, offset);
        pendingByte = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
        const count = Math.floor(bytes.length / 2); if (!count) return;
        const buffer = context.createBuffer(1, count, 24000), floats = buffer.getChannelData(0), data = new DataView(bytes.buffer);
        for (let i = 0; i < count; i++) floats[i] = data.getInt16(i * 2, true)/32768;
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
        if(worklet)source.connect(worklet,0,1);
        scheduled = Math.max(scheduled, context.currentTime + .015);const kind=segmentKinds.get(generation)??"informative";
        playback.schedule(generation,bytes.length-(pendingByte===undefined?0:1),scheduled,buffer.duration,kind);
        if(generation>0&&Number.isFinite(speechEnd)){
          const record=heardTiming.get(generation)??{},starts=performance.now()+(scheduled-context.currentTime)*1000;
          record.speechToFirstByteMs??=received-speechEnd;record.speechToFirstPlaybackMs??=starts-speechEnd;
          if(kind==="informative"){record.speechToInformativeByteMs??=received-speechEnd;record.speechToInformativePlaybackMs??=starts-speechEnd;}
          heardTiming.set(generation,record);send({type:"audio_timing",generation,timing:record});
        }
        source.start(scheduled); scheduled += buffer.duration;
        const playingGeneration=generation;
        sources.add(source); source.onended = () => { sources.delete(source); source.disconnect();playback.ended(playingGeneration);if(!stopped)publishPlayback(playingGeneration); }; return;
      }
      let msg: any; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "pong") {
        const now = performance.now(), rtt = now-msg.sent;
        if (rtt < sync.rtt) sync = { rtt, offset: msg.server-(now+msg.sent)/2 }; return;
      }
      if (msg.type === "error") {
        const message=msg.message||voiceErrorMessage(msg.code);
        if(recoverableVoiceError(msg.code)){if(msg.preservePlayback){playback.fail(msg.generation);publishPlayback(msg.generation);}else stopAudio({source:"tts_error"});setStatus(message);return;}
        fail(message);return;
      }
      if(msg.type==="partial"){setPartial(msg.text);return;}
      if(msg.type==="audio_segment"){segmentKinds.set(msg.generation,msg.kind==="neutral"?"neutral":"informative");return;}
      if(msg.type==="tts_telemetry"&&msg.event?.type==="stall"){playback.stall(msg.generation);return;}
      if(msg.type==="cart_revision"){setCart(msg.cart);return;}
      if(msg.type==="call_end"){if(msg.summary)setTicket(msg.summary);endingGeneration=msg.generation;publishPlayback(msg.generation);return;}
      if (msg.type === "interrupt") { stopAudio({source:msg.source==="continuation"?"continuation":"server_turn"}); generation = msg.generation; blocked = true; return; }
      if (msg.type === "audio_start") {
        if (msg.generation < Math.max(generation,minGeneration)) return; generation = msg.generation; blocked = false; audioStart = msg;playback.start(generation,Number(msg.acknowledgementBytes)||0);return;
      }
      if(msg.type==="audio_end"){playback.serverEnd(msg.generation);publishPlayback(msg.generation);return;}
      if (msg.type === "transcript") {
        setPartial("");
        setRows(prev => [...prev.slice(-39), {role:"You",text:msg.text}]);
        // Provider word end refreshes every turn, including answers shorter
        // than the barge-in minimum. Never reuse a previous turn's VAD end.
        if (typeof msg.audioEndSeconds === "number" && Number.isFinite(lastEndAudio)) lastEnd = lastEndAudio + msg.audioEndSeconds*1000;
        if(Number.isFinite(lastEnd))speechEnds.set(msg.generation,lastEnd);
        return;
      }
      if (msg.type === "reply") {playback.reply(msg.generation,msg.text.length);setRows(prev => [...prev.slice(-39), {role:"Agent",text:msg.text}]); setCart(msg.cart);setStatus(`Listening · ${model} · microphone stays on during replies`); return; }
      if(msg.type==="turn_log"){setLogs(prev=>[...prev.filter(row=>row.turnId!==msg.row.turnId),msg.row].slice(-200));return;}
      if (msg.type !== "ready") return;
      clearTimeout(connectTimer);
      setLocationLabel(msg.location||"Lahore local");
      capture!.connect(worklet!);worklet!.connect(context!.destination);ready=true;
      send({ type: "mic_ready" });
      setStatus(`Listening · ${msg.model} · ${msg.tts} · microphone stays on during replies`);
    };
  }
  return <section className="section"><div className="panel">
    <h1>Karahi House streaming voice demo</h1>
    <p>Menu approved by the restaurant. Demo orders are simulated and pending staff acceptance. No caller audio is saved. Redacted turn logs can be exported to CSV.</p>
    <div className="call-controls" style={{marginTop:20}}>
      <label>Recognition <select aria-label="Recognition model" value={model} onChange={e => setModel(e.target.value)} disabled={active}><option value="">Choose a model</option><option value="flux">Flux English</option><option value="nova-3">Nova-3 multilingual</option><option value="nova-3-en-IN">Nova-3 Indian English</option></select></label>
      {requiresAccessCode&&<label>Hosted demo access code <input aria-label="Hosted demo access code" type="password" autoComplete="off" value={accessCode} onChange={e=>setAccessCode(e.target.value)} disabled={active}/></label>}
      <button className="btn btn-primary" disabled={active||!model} onClick={() => void connect()}>Start microphone</button>
      <button className="btn btn-ghost" disabled={!active} onClick={() => interrupt.current()}>Interrupt reply</button>
      <button className="btn btn-danger" disabled={!active} onClick={() => {cleanup.current();setStatus("Ended. Microphone released.");}}>End call</button>
      <label><input type="checkbox" checked={ignoreInterruptions} onChange={event=>setIgnoreInterruptions(event.target.checked)} disabled={active}/> Ignore interruptions (demo)</label>
    </div>
    <p role="status">{status}</p>
    {active&&<p>Microphone level <meter aria-label="Microphone level" min={0} max={0.15} value={micLevel}/> {partial&&<span>Heard so far: {partial}</span>}</p>}
    <p>Use headphones for the first test. Calls end after ten minutes. Text demo: <a href="/">home</a>.</p>
    <p>No final recognition model has been chosen. Compare the three options using the same real-mic script.</p>
    <div aria-live="polite" style={{marginTop:20}}>{rows.map((row,i) => <p key={i}><strong>{row.role}:</strong> {row.text}</p>)}</div>
    <h2 style={{marginTop:20}}>Current cart</h2>
    {cart.length ? cart.map((item,i) => <p key={i}>{item.qty} × {item.name}{item.size ? ` · ${item.size}` : ""}{item.spiceLevel ? ` · ${item.spiceLevel}` : ""}</p>) : <p>No items yet.</p>}
    <h2 style={{marginTop:20}}>Latency on this connection</h2>
    <p><strong>Headline: speech end to first informative audio.</strong> Neutral acknowledgements and stall prompts are excluded. Empty samples mean no informative audio arrived.</p>
    <table style={{width:"100%"}}><thead><tr><th>Informative audio (ms)</th><th>n</th><th>p50</th><th>p95</th></tr></thead><tbody>{([["First informative byte","speechToInformativeByteMs"],["First informative playback","speechToInformativePlaybackMs"]] as const).map(([label,key])=>{const p=percentiles(logs.filter(row=>!row.endpointReason.includes("revised_by_continuation")).flatMap(row=>typeof row.audioTiming?.[key]==="number"?[row.audioTiming[key]!]:[]));return <tr key={key}><td>{label}</td><td>{p.n}</td><td>{p.p50}</td><td>{p.p95}</td></tr>;})}</tbody></table>
    <p>Deployment: <strong>{locationLabel}</strong>. End of speech uses provider word timestamps on the capture clock, with browser VAD as a fallback (80 ms capture frames). STT includes uplink, endpointing and the continuation guard; remote TTS includes its network trip.</p>
    <table style={{width:"100%"}}><thead><tr><th>Stage (ms)</th><th>n</th><th>p50</th><th>p95</th></tr></thead><tbody>
      {([ ["Speech end → first audio byte (may be neutral)", "totalMs"], ["STT endpointing + uplink", "endpointAndUplinkMs"], ["Engine", "engineMs"], ["TTS first transport byte (may be neutral)", "ttsFirstByteMs"], ["Audio return network", "returnNetworkMs"], ["Browser/server RTT", "browserRttMs"], ["Clock uncertainty ±", "clockUncertaintyMs"] ] as const).map(([label,key]) => {const p=percentiles(timings.map(row=>row[key]));return <tr key={key}><td>{label}</td><td>{p.n}</td><td>{p.p50}</td><td>{p.p95}</td></tr>;})}
    </tbody></table>
    <table style={{width:"100%"}}><thead><tr><th>TTS / gap (ms)</th><th>n</th><th>p50</th><th>p95</th></tr></thead><tbody>{([ ["Ack first byte",logs.flatMap(row=>row.ackFirstByteMs===undefined?[]:[row.ackFirstByteMs])],["Content first byte (tts_content_first_byte_ms)",logs.flatMap(row=>row.contentFirstByteMs===undefined?[]:[row.contentFirstByteMs])],["Ack end → content playback gap",logs.flatMap(row=>row.playback?.acknowledgementGapMs==null?[]:[row.playback.acknowledgementGapMs])] ] as [string,number[]][]).map(([label,values])=>{const p=percentiles(values);return <tr key={label}><td>{label}</td><td>{p.n}</td><td>{p.p50}</td><td>{p.p95}</td></tr>;})}</tbody></table>
    <p>Playback times below include the audio queue. Informative audio excludes “Okay” and “One moment”.</p>
    <table style={{width:"100%"}}><thead><tr><th>Speech end → playback (ms)</th><th>n</th><th>p50</th><th>p95</th></tr></thead><tbody>{([ ["First audio","speechToFirstPlaybackMs"],["First informative audio","speechToInformativePlaybackMs"] ] as const).map(([label,key])=>{const p=percentiles(logs.filter(row=>!row.endpointReason.includes("revised_by_continuation")).flatMap(row=>typeof row.audioTiming?.[key]==="number"?[row.audioTiming[key]!]:[]));return <tr key={key}><td>{label}</td><td>{p.n}</td><td>{p.p50}</td><td>{p.p95}</td></tr>;})}</tbody></table>
    {ticket!=null&&<><h2>Final demo ticket</h2><pre>{JSON.stringify(ticket,null,2)}</pre></>}
    <h2 style={{marginTop:20}}>Turn log</h2>
    <p>Callback turns and numbers are redacted. Logs stay in this tab; the server saves no caller audio or transcripts. Export before closing the tab, save privately under .data, and delete exports within thirty days.</p>
    <button className="btn btn-ghost" disabled={!logs.length} onClick={()=>{const url=URL.createObjectURL(new Blob([voiceCsv(logs)],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`karahi-voice-${locationLabel.toLowerCase().replaceAll(" ","-")}-${model}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Export turn log CSV</button>
    <button className="btn btn-ghost" disabled={!Object.values(intended).some(value=>value.trim())} onClick={()=>{const csv=mishearingsCsv(logs.map(row=>({turnId:row.turnId,atUtc:row.atUtc,model:row.model,location:row.location,heard:row.transcript,intended:intended[row.turnId]??""})));const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="karahi-mishearings-private.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Export mishearings CSV</button>
    <p>For a mishearing, type what you meant in your own words. This stays in the tab and your CSV; aliases require manual review.</p>
    <table style={{width:"100%"}}><thead><tr><th>Transcript (redacted)</th><th>What you meant</th><th>Cart</th><th>Endpoint reason</th><th>First informative playback ms</th></tr></thead><tbody>{logs.map(row=><tr key={row.turnId}><td>{row.transcript}</td><td><input aria-label={`Intended words ${row.turnId}`} value={intended[row.turnId]??""} onChange={event=>setIntended(previous=>({...previous,[row.turnId]:event.target.value}))}/></td><td>{row.matchedCart.map(item=>`${item.qty} × ${item.itemId}`).join("; ")}</td><td>{row.endpointReason}</td><td>{row.audioTiming?.speechToInformativePlaybackMs?.toFixed(1)??row.status}</td></tr>)}</tbody></table>
  </div></section>;
}
