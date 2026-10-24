"use client";
import { useEffect, useRef, useState } from "react";
import { voiceCsv,type VoiceLogRow } from "@/voice/turn-log";
import { mishearingsCsv } from "@/voice/mishearings";

type Timing = { totalMs: number; endpointAndUplinkMs: number; engineMs: number; ttsFirstByteMs: number; returnNetworkMs: number; browserRttMs: number; clockUncertaintyMs: number };
function percentiles(values: number[]) { const sorted = [...values].sort((a,b) => a-b); return { n: sorted.length, p50: sorted[Math.max(0, Math.ceil(sorted.length*.5)-1)]?.toFixed(1) ?? "—", p95: sorted[Math.max(0, Math.ceil(sorted.length*.95)-1)]?.toFixed(1) ?? "—" }; }
export default function StreamingVoice() {
  const [model, setModel] = useState(""), [status, setStatus] = useState("Choose a model to compare"), [active, setActive] = useState(false);
  const [accessCode,setAccessCode]=useState(""),[locationLabel,setLocationLabel]=useState("Not measured"),[logs,setLogs]=useState<VoiceLogRow[]>([]);
  const [intended,setIntended]=useState<Record<string,string>>({});
  const [rows, setRows] = useState<{role:string;text:string}[]>([]), [cart, setCart] = useState<any[]>([]), [timings, setTimings] = useState<Timing[]>([]);
  const cleanup = useRef<() => void>(() => {}); const interrupt = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  async function connect() {
    cleanup.current(); setTimings([]); setRows([]); setCart([]); setLogs([]);setIntended({}); setStatus("Connecting and warming speech…"); setActive(true);
    let context: AudioContext | undefined, stream: MediaStream | undefined, worklet: AudioWorkletNode | undefined, capture: MediaStreamAudioSourceNode | undefined;
    let stopped = false, ready = false, generation = -1, minGeneration = 0, blocked = false, scheduled = 0, sync = { rtt: Infinity, offset: 0 };
    let lastEnd = NaN, lastEndAudio = NaN, audioStart: any, measuredGeneration = -1, pendingByte: number | undefined;
    const sources = new Set<AudioBufferSourceNode>();
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/voice`); socket.binaryType = "arraybuffer";
    const stopAudio = () => { for (const source of sources) { try { source.stop(); } catch {} } sources.clear(); scheduled = 0; pendingByte = undefined; };
    const pingTimer = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping", sent: performance.now() })); }, 2000);
    cleanup.current = () => {
      if (stopped) return; stopped = true; ready = false; clearInterval(pingTimer); stopAudio();
      stream?.getTracks().forEach(track => track.stop()); worklet?.disconnect(); capture?.disconnect(); void context?.close();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" })); socket.close(); setActive(false);
    };
    interrupt.current = () => { stopAudio(); blocked = true; minGeneration = Math.max(minGeneration, generation+1); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "barge_in" })); };
    socket.onopen = () => { socket.send(JSON.stringify({ type: "ping", sent: performance.now() })); socket.send(JSON.stringify({ type: "start", model,accessCode })); };
    socket.onerror = () => { setStatus("Voice socket failed. Start with npm run dev:voice."); cleanup.current(); };
    socket.onclose = () => { if (!stopped) { setStatus("Disconnected. Your session is cleared; reconnect to start again."); cleanup.current(); } };
    socket.onmessage = async event => {
      if (stopped) return;
      if (event.data instanceof ArrayBuffer) {
        if (!context || !ready || blocked) return;
        const view = new DataView(event.data); if (view.byteLength <= 4 || view.getUint32(0, true) !== generation) return;
        const received = performance.now();
        if (audioStart && generation > 0 && measuredGeneration !== generation && Number.isFinite(lastEnd) && sync.rtt !== Infinity) {
          const finalBrowser = audioStart.finalAt - sync.offset, firstBrowser = audioStart.firstAt - sync.offset;
          // Greeting is excluded. EOS is an energy-VAD estimate, not manual ground truth.
          const timing: Timing = { totalMs: received-lastEnd, endpointAndUplinkMs: finalBrowser-lastEnd, engineMs: audioStart.engineMs, ttsFirstByteMs: audioStart.ttsFirstByteMs, returnNetworkMs: received-firstBrowser, browserRttMs: sync.rtt, clockUncertaintyMs: sync.rtt/2 };
          if (timing.totalMs >= 0 && timing.endpointAndUplinkMs >= -sync.rtt) {setTimings(prev => [...prev.slice(-199), timing]);socket.send(JSON.stringify({type:"latency",generation,timing}));}
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
        scheduled = Math.max(scheduled, context.currentTime + .015); source.start(scheduled); scheduled += buffer.duration;
        sources.add(source); source.onended = () => { sources.delete(source); source.disconnect(); }; return;
      }
      let msg: any; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "pong") {
        const now = performance.now(), rtt = now-msg.sent;
        if (rtt < sync.rtt) sync = { rtt, offset: msg.server-(now+msg.sent)/2 }; return;
      }
      if (msg.type === "error") { setStatus(msg.message || `Voice error: ${msg.code}`); cleanup.current(); return; }
      if (msg.type === "interrupt") { stopAudio(); generation = msg.generation; blocked = true; return; }
      if (msg.type === "audio_start") {
        if (msg.generation < Math.max(generation,minGeneration)) return; generation = msg.generation; blocked = false; audioStart = msg; return;
      }
      if (msg.type === "transcript") {
        setRows(prev => [...prev.slice(-39), {role:"You",text:msg.text}]);
        // If VAD has not yet hung over, use provider word end on the capture
        // timeline as a labelled estimate. Never use receipt of final text as EOS.
        if (!Number.isFinite(lastEnd) && typeof msg.audioEndSeconds === "number" && Number.isFinite(lastEndAudio)) lastEnd = lastEndAudio + msg.audioEndSeconds*1000;
        return;
      }
      if (msg.type === "reply") { setRows(prev => [...prev.slice(-39), {role:"Agent",text:msg.text}]); setCart(msg.cart); return; }
      if(msg.type==="turn_log"){setLogs(prev=>[...prev.filter(row=>row.turnId!==msg.row.turnId),msg.row].slice(-200));return;}
      if (msg.type !== "ready") return;
      setLocationLabel(msg.location||"Lahore local");
      try {
        context = new AudioContext({ sampleRate: 48000 }); await context.resume();
        await context.audioWorklet.addModule("/voice-capture.js");
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); void context.close(); return; }
        capture = context.createMediaStreamSource(stream); worklet = new AudioWorkletNode(context, "voice-capture");
        worklet.port.onmessage = ({ data }) => {
          if (!ready || stopped || socket.readyState !== WebSocket.OPEN) return;
          if (data.type === "pcm") {
            if (!Number.isFinite(lastEndAudio)) lastEndAudio = performance.now()-data.audioSeconds*1000;
            if (socket.bufferedAmount > 32000) { setStatus("Audio upload cannot keep up; reconnect on a steadier network."); cleanup.current(); return; }
            socket.send(data.pcm);
          } else if (data.type === "speech_start") { lastEnd = NaN; interrupt.current(); }
          else if (data.type === "speech_end") lastEnd = performance.now()-data.hangoverMs;
        };
        capture.connect(worklet); worklet.connect(context.destination); ready = true;
        socket.send(JSON.stringify({ type: "mic_ready" }));
        setStatus(`Listening · ${msg.model} · ${msg.tts} · microphone stays on during replies`);
      } catch { setStatus("Microphone permission or audio setup failed. Use localhost or HTTPS and allow the mic."); cleanup.current(); }
    };
  }
  return <section className="section"><div className="panel">
    <h1>Karahi House streaming voice demo</h1>
    <p>Menu approved by the restaurant. Demo orders are simulated and pending staff acceptance. No caller audio is saved. Redacted turn logs can be exported to CSV.</p>
    <div className="call-controls" style={{marginTop:20}}>
      <label>Recognition <select aria-label="Recognition model" value={model} onChange={e => setModel(e.target.value)} disabled={active}><option value="">Choose a model</option><option value="flux">Flux English</option><option value="nova-3">Nova-3 multilingual</option><option value="nova-3-en-IN">Nova-3 Indian English</option></select></label>
      <label>Hosted demo access code <input aria-label="Hosted demo access code" type="password" autoComplete="off" value={accessCode} onChange={e=>setAccessCode(e.target.value)} disabled={active}/></label>
      <button className="btn btn-primary" disabled={active||!model} onClick={() => void connect()}>Start microphone</button>
      <button className="btn btn-ghost" disabled={!active} onClick={() => interrupt.current()}>Interrupt reply</button>
      <button className="btn btn-danger" disabled={!active} onClick={() => {cleanup.current();setStatus("Ended. Microphone released.");}}>End call</button>
    </div>
    <p role="status">{status}</p>
    <p>Use headphones for the first test. Calls end after ten minutes. Text demo: <a href="/">home</a>.</p>
    <p>No final STT choice has been made. Compare both using the same real-mic script.</p>
    <div aria-live="polite" style={{marginTop:20}}>{rows.map((row,i) => <p key={i}><strong>{row.role}:</strong> {row.text}</p>)}</div>
    <h2 style={{marginTop:20}}>Current cart</h2>
    {cart.length ? cart.map((item,i) => <p key={i}>{item.qty} × {item.name}{item.size ? ` · ${item.size}` : ""}{item.spiceLevel ? ` · ${item.spiceLevel}` : ""}</p>) : <p>No items yet.</p>}
    <h2 style={{marginTop:20}}>Latency on this connection</h2>
    <p>Deployment: <strong>{locationLabel}</strong>. End of speech is estimated by browser VAD, with provider word timestamps as a fallback. STT includes uplink, endpointing and the continuation guard; remote TTS includes its network trip.</p>
    <table style={{width:"100%"}}><thead><tr><th>Stage (ms)</th><th>n</th><th>p50</th><th>p95</th></tr></thead><tbody>
      {([ ["Speech end → first audio byte", "totalMs"], ["STT endpointing + uplink", "endpointAndUplinkMs"], ["Engine", "engineMs"], ["TTS first byte", "ttsFirstByteMs"], ["Audio return network", "returnNetworkMs"], ["Browser/server RTT", "browserRttMs"], ["Clock uncertainty ±", "clockUncertaintyMs"] ] as const).map(([label,key]) => {const p=percentiles(timings.map(row=>row[key]));return <tr key={key}><td>{label}</td><td>{p.n}</td><td>{p.p50}</td><td>{p.p95}</td></tr>;})}
    </tbody></table>
    <h2 style={{marginTop:20}}>Turn log</h2>
    <p>Callback turns and numbers are redacted. Logs stay in this tab; the server saves no caller audio or transcripts. Export before closing the tab, save privately under .data, and delete exports within thirty days.</p>
    <button className="btn btn-ghost" disabled={!logs.length} onClick={()=>{const url=URL.createObjectURL(new Blob([voiceCsv(logs)],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`karahi-voice-${locationLabel.toLowerCase().replaceAll(" ","-")}-${model}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Export turn log CSV</button>
    <button className="btn btn-ghost" disabled={!Object.values(intended).some(value=>value.trim())} onClick={()=>{const csv=mishearingsCsv(logs.map(row=>({turnId:row.turnId,atUtc:row.atUtc,model:row.model,location:row.location,heard:row.transcript,intended:intended[row.turnId]??""})));const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="karahi-mishearings-private.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Export mishearings CSV</button>
    <p>For a mishearing, type what you meant in your own words. This stays in the tab and your CSV; aliases require manual review.</p>
    <table style={{width:"100%"}}><thead><tr><th>Transcript (redacted)</th><th>What you meant</th><th>Cart</th><th>Endpoint reason</th><th>Total ms</th></tr></thead><tbody>{logs.map(row=><tr key={row.turnId}><td>{row.transcript}</td><td><input aria-label={`Intended words ${row.turnId}`} value={intended[row.turnId]??""} onChange={event=>setIntended(previous=>({...previous,[row.turnId]:event.target.value}))}/></td><td>{row.matchedCart.map(item=>`${item.qty} × ${item.itemId}`).join("; ")}</td><td>{row.endpointReason}</td><td>{row.latency?.totalMs.toFixed(1)??row.status}</td></tr>)}</tbody></table>
  </div></section>;
}
