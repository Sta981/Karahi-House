// TwiML helpers for the Twilio phone integration.
//
// Accent strategy on the phone side:
//   1. `speechModel="deepgram_nova-2"`: Twilio's most accent-robust STT option.
//   2. `hints`: every dish name and its common mispronunciations are passed as
//      recognition hints, which dramatically boosts recall of domain words.
//   3. Whatever still comes out garbled is repaired by the phonetic matcher
//      before the dialog layer ever sees it.

import { MENU } from "./menu";

export function speechHints(): string {
  const phrases = new Set<string>();
  for (const item of MENU) {
    phrases.add(item.name.replace(/[^a-zA-Z0-9 ]/g, " ").trim());
    // a few top aliases per item; Twilio caps hint list size
    for (const a of item.aliases.slice(0, 4)) phrases.add(a);
  }
  for (const extra of ["half", "full", "goat", "lamb", "chicken", "beef", "pickup", "delivery", "catering", "halal"]) {
    phrases.add(extra);
  }
  return [...phrases].slice(0, 450).join(", ");
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function gatherTwiML(say: string, actionUrl: string, opts?: { hangupAfter?: boolean }): string {
  // Neutral, natural US voice; callers have accents, the agent shouldn't.
  const voice = process.env.TWILIO_TTS_VOICE || "Polly.Joanna-Neural";
  if (opts?.hangupAfter) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${esc(voice)}">${esc(say)}</Say>
  <Hangup/>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${esc(actionUrl)}" method="POST" language="en-IN" speechModel="deepgram_nova-2" speechTimeout="auto" hints="${esc(speechHints())}">
    <Say voice="${esc(voice)}">${esc(say)}</Say>
  </Gather>
  <Say voice="${esc(voice)}">Sorry, I didn't hear anything. Please call back anytime!</Say>
  <Hangup/>
</Response>`;
}
