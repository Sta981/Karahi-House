// Twilio webhook: point your Twilio phone number's "A call comes in" to
//   https://<your-deployment>/api/voice/incoming
// Twilio persists cookies for the duration of a call, so dialog state rides
// along in a compact cookie between webhook hits.

import { NextRequest, NextResponse } from "next/server";
import { GREETING, newState } from "@/lib/dialog";
import { gatherTwiML } from "@/lib/twiml";

export const runtime = "nodejs";

function handler(_req: NextRequest) {
  const twiml = gatherTwiML(GREETING, "/api/voice/respond");
  const res = new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
  res.cookies.set("kh_state", encodeURIComponent(JSON.stringify(newState())), { path: "/" });
  return res;
}

export const GET = handler;
export const POST = handler;
