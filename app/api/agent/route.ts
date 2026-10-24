// POST /api/agent: one conversation turn.
// Body: { text: string, state?: DialogState, history?: {role, text}[] }
// Returns: { reply, state, matches, summary?, endCall }

import { NextRequest, NextResponse } from "next/server";
import { DialogState } from "@/lib/dialog";
import { runSmartTurn } from "@/lib/brain";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: {
    text?: string;
    state?: DialogState;
    history?: { role: "user" | "assistant"; text: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").toString().slice(0, 1000);
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];

  const result = await runSmartTurn(body.state, text, history);

  return NextResponse.json({
    reply: result.reply,
    state: result.state,
    matches: result.matches,
    summary: result.summary ?? null,
    endCall: result.endCall ?? false,
    llm: result.usedLLM,
    routing: result.routing,
  });
}
