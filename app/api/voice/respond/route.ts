// Twilio gather callback: receives SpeechResult, runs the smart turn,
// responds with TwiML. Dialog state and a compact conversation history ride
// along in cookies, which Twilio persists for the duration of the call.

import { NextRequest, NextResponse } from "next/server";
import { DialogState, newState } from "@/lib/dialog";
import { runSmartTurn } from "@/lib/brain";
import { gatherTwiML } from "@/lib/twiml";

export const runtime = "nodejs";
export const maxDuration = 30;

type Hist = { role: "user" | "assistant"; text: string }[];

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const speech = (form.get("SpeechResult") ?? "").toString();

  let state: DialogState = newState();
  let history: Hist = [];
  try {
    const cookie = req.cookies.get("kh_state")?.value;
    if (cookie) state = JSON.parse(decodeURIComponent(cookie));
  } catch {
    state = newState();
  }
  try {
    const hist = req.cookies.get("kh_hist")?.value;
    if (hist) history = JSON.parse(decodeURIComponent(hist));
  } catch {
    history = [];
  }

  const result = await runSmartTurn(state, speech, history);

  if (result.summary) {
    // The "gist" of the call; forward to the restaurant (SMS/email/POS).
    console.log("CALL SUMMARY", JSON.stringify({ kind: result.summary.kind, itemLines: result.summary.items.length }));
  }

  // keep the last few turns for conversational context (cookie size limits)
  history.push({ role: "user", text: speech.slice(0, 160) });
  history.push({ role: "assistant", text: result.reply.slice(0, 160) });
  history = history.slice(-8);

  const twiml = gatherTwiML(result.reply, "/api/voice/respond", { hangupAfter: result.endCall });
  const res = new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
  res.cookies.set("kh_state", encodeURIComponent(JSON.stringify(result.state)), { path: "/" });
  res.cookies.set("kh_hist", encodeURIComponent(JSON.stringify(history)), { path: "/" });
  return res;
}
