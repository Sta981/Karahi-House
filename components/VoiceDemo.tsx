"use client";

// Live "phone call" demo in the browser.
//
// Walkie-talkie design with four visible states. Speech input and speech
// output NEVER run at the same time (running both wedges Chrome's recognizer
// and makes the mic hear the agent's own voice):
//
//   speaking  : agent talks, mic off, a "Tap to interrupt" button cuts it off
//   listening : mic on and kept alive; utterance sent after a short silence
//   thinking  : mic off, animated indicator while the agent decides
//   idle      : no call
//
// A live mic level meter shows the user their microphone is actually working.

import { useCallback, useEffect, useRef, useState } from "react";
import type {DemoTicket} from "@/lib/demo-ticket-types";
import DemoTicketView from "./DemoTicketView";

interface Match {
  itemId: string;
  name: string;
  heard: string;
  score: number;
}

interface CartLine {
  itemId: string;
  name: string;
  variantLabel?: string;
  qty: number;
  unitPrice: number;
  unitPriceCents: number;
  spiceLevel?: string;
  notes: string[];
  sizeVerified?: boolean;
}

interface Turn {
  role: "user" | "agent";
  text: string;
  matches?: Match[];
}

interface Summary {
  kind: string;
  status: string;
  customerName?: string;
  orderType?: string;
  items: { name: string; variant?: string; qty: number; spice?: string; notes: string[]; lineTotal: number; lineTotalCents: number; sizeVerified?: boolean }[];
  subtotal: number;
  subtotalCents: number;
  notes: string[];
}

type Phase = "idle" | "connecting" | "speaking" | "listening" | "thinking";

const ACCENTS = [
  { code: "en-IN", label: "🇮🇳/🇵🇰 South Asian" },
  { code: "en-US", label: "🇺🇸 US" },
  { code: "en-GB", label: "🇬🇧 UK" },
  { code: "en-AU", label: "🇦🇺 AU" },
];

// silence (ms) after your last words before the turn is sent
const SILENCE_MS = 1200;

export default function VoiceDemo() {
  const [supported, setSupported] = useState(true);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [demoTicket,setDemoTicket]=useState<DemoTicket|null>(null);
  const [accent, setAccent] = useState("en-IN");
  const [typed, setTyped] = useState("");
  const [micError, setMicError] = useState("");

  const phaseRef = useRef<Phase>("idle");
  const callActiveRef = useRef(false); // mic conversation loop on/off (typed input works without it)
  const stateRef = useRef<unknown>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; text: string }[]>([]);
  const recogRef = useRef<any>(null);
  const accentRef = useRef(accent);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // mic level meter
  const meterFillRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  useEffect(() => {
    accentRef.current = accent;
  }, [accent]);

  useEffect(() => {
    const w = window as any;
    if (!w.SpeechRecognition && !w.webkitSpeechRecognition) setSupported(false);
    window.speechSynthesis?.getVoices(); // warm up async voice list
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [turns, interim, phase]);

  // ---------- mic level meter (visible proof the mic hears you) ----------

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        if (meterFillRef.current) {
          meterFillRef.current.style.width = `${Math.min(100, Math.round(rms * 350))}%`;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      setMicError("");
      return true;
    } catch {
      setMicError("Microphone not available. Check the browser's mic permission, or just type below.");
      return false;
    }
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (meterFillRef.current) meterFillRef.current.style.width = "0%";
  }, []);

  // ---------- speech in ----------

  const abortRecognition = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    const r = recogRef.current;
    recogRef.current = null; // signals onend that this stop is intentional
    try {
      r?.abort?.();
    } catch {}
  }, []);

  // declared before use in callbacks below
  const handleUtteranceRef = useRef<(text: string) => Promise<void>>(async () => {});

  const flushBuffer = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    const text = bufferRef.current.trim();
    if (!text) return;
    bufferRef.current = "";
    setInterim("");
    abortRecognition();
    void handleUtteranceRef.current(text);
  }, [abortRecognition]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushBuffer, SILENCE_MS);
  }, [flushBuffer]);

  const startListening = useCallback(() => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    abortRecognition();
    window.speechSynthesis?.cancel();
    bufferRef.current = "";
    setInterim("");
    setPhase("listening");

    const spawn = () => {
      if (phaseRef.current !== "listening") return;
      const r = new SR();
      recogRef.current = r;
      r.lang = accentRef.current;
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 1;

      r.onresult = (e: any) => {
        let finalText = "";
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t + " ";
          else interimText += t;
        }
        if (finalText.trim()) {
          bufferRef.current = (bufferRef.current + " " + finalText).trim();
        }
        setInterim(interimText);
        scheduleFlush(); // every event resets the silence clock
      };
      r.onerror = (ev: any) => {
        if (ev.error === "not-allowed") {
          setMicError("Microphone blocked. Allow mic access, or type below.");
          setPhase("listening"); // stays; typed input still works
        }
        // "no-speech" and friends: onend will respawn us
      };
      r.onend = () => {
        // Chrome self-terminates the recognizer regularly; if it's still our
        // turn and this wasn't an intentional stop, respawn IMMEDIATELY so no
        // words are lost (the buffer survives across respawns).
        if (recogRef.current === r && phaseRef.current === "listening") {
          recogRef.current = null;
          spawn();
        }
      };
      try {
        r.start();
      } catch {
        /* already started */
      }
    };
    spawn();
  }, [abortRecognition, scheduleFlush, setPhase]);

  // ---------- speech out ----------

  const speak = useCallback(
    (text: string, onFinished?: () => void) => {
      const synth = window.speechSynthesis;
      abortRecognition(); // mic OFF while the agent talks
      setPhase("speaking");
      if (!synth) {
        onFinished?.();
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => v.lang === "en-US" && /google/i.test(v.name)) ??
        voices.find((v) => v.lang === "en-US" && /samantha|ava|allison|natural|neural/i.test(v.name)) ??
        voices.find((v) => v.lang === "en-US") ??
        voices.find((v) => v.lang.startsWith("en"));
      if (preferred) u.voice = preferred;
      u.rate = 1.06; // slightly brisk; long waits are the enemy
      const finish = () => {
        // if the user tapped interrupt, phase is already "listening" and
        // this late onend must not do anything
        if (phaseRef.current !== "speaking") return;
        onFinished?.();
      };
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
    },
    [abortRecognition, setPhase],
  );

  const interrupt = useCallback(() => {
    window.speechSynthesis?.cancel();
    startListening();
  }, [startListening]);

  // ---------- conversation turn ----------

  const handleUtterance = useCallback(
    async (text: string) => {
      setPhase("thinking");
      setTurns((t) => [...t, { role: "user", text }]);
      historyRef.current.push({ role: "user", text });
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, state: stateRef.current, history: historyRef.current.slice(-10) }),
        });
        const data = await res.json();
        stateRef.current = data.state;
        setCart(data.state?.cart ?? []);
        historyRef.current.push({ role: "assistant", text: data.reply });
        setTurns((t) => {
          const copy = [...t];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "user") {
              copy[i] = { ...copy[i], matches: data.matches };
              break;
            }
          }
          return [...copy, { role: "agent", text: data.reply }];
        });
        if (data.summary) setSummary(data.summary);
        if (data.ticket) setDemoTicket(data.ticket);
        speak(data.reply, () => {
          if (data.endCall) {
            endCallRef.current();
          } else if (callActiveRef.current) {
            startListening();
          } else {
            setPhase("idle"); // typed-only conversation: no mic loop
          }
        });
      } catch {
        setTurns((t) => [...t, { role: "agent", text: "Sorry, something went wrong. Please try again." }]);
        if (callActiveRef.current) startListening();
        else setPhase("idle");
      }
    },
    [speak, startListening, setPhase],
  );
  useEffect(() => {
    handleUtteranceRef.current = handleUtterance;
  }, [handleUtterance]);

  // ---------- call control ----------

  const endCall = useCallback(() => {
    callActiveRef.current = false;
    setPhase("idle");
    setInterim("");
    bufferRef.current = "";
    abortRecognition();
    window.speechSynthesis?.cancel();
    stopMeter();
  }, [abortRecognition, setPhase, stopMeter]);
  const endCallRef = useRef(endCall);
  useEffect(() => {
    endCallRef.current = endCall;
  }, [endCall]);

  const startCall = useCallback(async () => {
    setTurns([]);
    setCart([]);
    setSummary(null);
    setDemoTicket(null);
    stateRef.current = null;
    historyRef.current = [];
    bufferRef.current = "";
    callActiveRef.current = true;
    setPhase("connecting");
    await startMeter(); // permission prompt + visible level meter
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });
      const data = await res.json();
      stateRef.current = data.state;
      historyRef.current.push({ role: "assistant", text: data.reply });
      setTurns([{ role: "agent", text: data.reply }]);
      speak(data.reply, () => startListening());
    } catch {
      setTurns([{ role: "agent", text: "Could not reach the agent. Please refresh and try again." }]);
      setPhase("idle");
      stopMeter();
    }
  }, [speak, startListening, startMeter, stopMeter, setPhase]);

  const submitTyped = useCallback(() => {
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    window.speechSynthesis?.cancel();
    abortRecognition();
    void handleUtterance(t);
  }, [typed, handleUtterance, abortRecognition]);

  const callActive = phase !== "idle";
  const subtotalCents = cart.reduce((s, l) => s + l.unitPriceCents * l.qty, 0);

  const statusLine =
    phase === "connecting"
      ? "Connecting…"
      : phase === "speaking"
        ? "Agent speaking"
        : phase === "listening"
          ? "🎤 Your turn, speak now (take your time)"
          : phase === "thinking"
            ? "Thinking…"
            : "📞 Try a call, no phone needed";

  return (
    <div className="demo-shell" id="demo">
      <div className="panel">
        <h3>
          {phase === "listening" && <span className="listening-dot" />}
          {statusLine}
        </h3>

        <div className="call-controls">
          {!callActive ? (
            <button className="btn btn-primary" onClick={startCall}>
              ▶ Start a call
            </button>
          ) : (
            <>
              <button className="btn btn-danger" onClick={endCall}>
                ✕ Hang up
              </button>
              {phase === "speaking" && (
                <button className="btn btn-primary btn-pulse" onClick={interrupt}>
                  🎤 Tap to interrupt
                </button>
              )}
            </>
          )}
          <div className="accent-picker">
            {ACCENTS.map((a) => (
              <button
                key={a.code}
                className={`accent-chip ${accent === a.code ? "active" : ""}`}
                onClick={() => setAccent(a.code)}
                title="Your accent, for speech recognition"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {callActive && (
          <div className="mic-row" title="Live microphone level">
            <span className="mic-label">mic</span>
            <div className="mic-meter">
              <div className="mic-meter-fill" ref={meterFillRef} />
            </div>
          </div>
        )}

        {!supported && <p className="hint-text">⚠️ Voice needs Chrome or Edge. You can still type below.</p>}
        {micError && <p className="hint-text">⚠️ {micError}</p>}

        <div className="transcript" ref={transcriptRef}>
          {turns.length === 0 && phase === "idle" && (
            <p className="hint-text">
              Press <strong>Start a call</strong>, wait for the greeting, then order like you would on the phone.
              The green bar shows your mic is live. When the agent talks, tap <strong>interrupt</strong> to cut it
              off. Or skip the mic and type below.
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role}`}>
              <div className="who">{t.role === "user" ? "You" : "Karahi House AI"}</div>
              {t.text}
              {t.matches && t.matches.length > 0 && (
                <div className="match-chips">
                  {t.matches.map((m, j) => (
                    <span className="match-chip" key={j}>
                      “{m.heard}”<span className="arrow">→</span>
                      {m.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {interim && <div className="bubble user interim">{interim}…</div>}
          {phase === "thinking" && (
            <div className="bubble agent typing">
              <span className="tdot" />
              <span className="tdot" />
              <span className="tdot" />
            </div>
          )}
        </div>

        <div className="type-row">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitTyped()}
            placeholder="Or type your order here…"
          />
          <button className="btn btn-ghost" onClick={submitTyped}>
            Send
          </button>
        </div>
      </div>

      <div>
        <div className="panel">
          <h3>🧾 Your order, as it hears it</h3>
          {cart.length === 0 ? (
            <p className="cart-empty">Order items show up here the moment the agent understands them.</p>
          ) : (
            <div className="cart-lines">
              {cart.map((l, i) => (
                <div className="cart-line" key={i}>
                  <div>
                    <div>
                      {l.qty > 1 ? `${l.qty} × ` : ""}
                      {l.name}
                    </div>
                    {l.variantLabel && <div className="variant">{l.variantLabel}</div>}
                    {l.spiceLevel && <div className="variant">{l.spiceLevel}</div>}
                    {l.notes?.map((note, at) => <div className="variant" key={at}>Note: {note}</div>)}
                    {l.sizeVerified === false && <div className="variant">Size surcharge unverified</div>}
                  </div>
                  <div>${(l.unitPriceCents * l.qty / 100).toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
          {cart.length > 0 && (
            <div className="cart-total">
              <span>Subtotal</span>
              <span>${(subtotalCents / 100).toFixed(2)}</span>
            </div>
          )}

          {demoTicket&&<DemoTicketView ticket={demoTicket}/>}
          {summary && !demoTicket && (
            <div className="summary-card">
              <h4>Demo request — pending staff acceptance</h4>
              {[
                summary.customerName ? `Name: ${summary.customerName}` : null,
                summary.orderType ? `For: ${summary.orderType}` : null,
                `Status: ${summary.status}. Menu approved by the restaurant.`,
                ...summary.items.map(
                  (it) =>
                    `• ${it.qty} × ${it.name}${it.variant ? ` (${it.variant})` : ""}${it.spice ? `, ${it.spice}` : ""}${it.notes.length ? `, Notes: ${it.notes.join("; ")}` : ""}${it.sizeVerified === false ? ", size surcharge unverified" : ""}: $${(it.lineTotalCents / 100).toFixed(2)}`,
                ),
                summary.items.length ? `Subtotal: $${(summary.subtotalCents / 100).toFixed(2)}; tax not configured` : null,
                ...summary.notes.map((n) => `Note: ${n}`),
              ]
                .filter(Boolean)
                .join("\n")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
