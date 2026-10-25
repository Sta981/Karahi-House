// POST /api/agent: one conversation turn.
// Body: { text: string, state?: DialogState, history?: {role, text}[] }
// Returns: { reply, state, matches, summary?, endCall }

import { NextRequest, NextResponse } from "next/server";
import { DialogState } from "@/lib/dialog";
import { runSmartTurn } from "@/lib/brain";
import {demoTickets} from "@/lib/demo-tickets";
import {randomUUID} from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 30;
function notificationOrigin(req:NextRequest):boolean{
  try{
    const header=req.headers.get("origin")??"",origin=new URL(header),target=req.nextUrl;
    if(header!==origin.origin)return false;
    // Next normalizes numeric loopback URLs to localhost. Permit only these
    // equivalent direct-local hosts on the same scheme and port.
    const loopback=new Set(["localhost","127.0.0.1","[::1]"]);
    return origin.origin===target.origin||loopback.has(origin.hostname)&&loopback.has(target.hostname)&&origin.protocol===target.protocol&&origin.port===target.port;
  }catch{return false;}
}

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
  const cookie=req.cookies.get("kh_demo_session")?.value;
  const sessionId=body.state?.turns&&cookie&&/^[a-f0-9-]{36}$/.test(cookie)?cookie:randomUUID();
  let ticket=null;
  if(result.endCall&&result.summary?.kind==="order"&&result.summary.status==="pending_acceptance"){
    const submission=demoTickets.submit(result.summary,{key:`text/${sessionId}/${result.state.turns}`,callbackProvided:!!result.state.callbackNumber,allowNotifications:notificationOrigin(req)});
    // This is only the final text turn; streaming voice never awaits email
    // before speech. No caller-controlled recipient or sender is accepted.
    ticket=await submission.settled;
  }

  const response=NextResponse.json({
    reply: result.reply,
    state: result.state,
    matches: result.matches,
    summary: result.summary ?? null,
    endCall: result.endCall ?? false,
    llm: result.usedLLM,
    routing: result.routing,
    ticket,
  });
  response.cookies.set("kh_demo_session",sessionId,{httpOnly:true,sameSite:"strict",secure:req.nextUrl.protocol==="https:",path:"/",maxAge:1800});
  return response;
}
