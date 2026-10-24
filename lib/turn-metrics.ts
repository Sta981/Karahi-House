export interface RoutingEvent {
  route: "local" | "llm_needed";
  outcome: "local" | "disabled" | "ok" | "rejected_reply" | "error";
  candidateCount: number;
}

export function emptyTurnCounts() {
  return { turns: 0, localResolved: 0, llmNeeded: 0, llmAttempted: 0, llmSucceeded: 0, llmUnavailable: 0, llmFailed: 0 };
}

export function countTurn(counts: ReturnType<typeof emptyTurnCounts>, event: RoutingEvent) {
  counts.turns++;
  if (event.route === "local") counts.localResolved++;
  else {
    counts.llmNeeded++;
    if (event.outcome === "disabled") counts.llmUnavailable++;
    else {
      counts.llmAttempted++;
      if (event.outcome === "ok") counts.llmSucceeded++;
      else counts.llmFailed++;
    }
  }
  return counts;
}

// Per-process totals reset on restart; independent instances have separate totals.
// Events contain no utterances, cart contents, identities or credentials.
const processCounts = emptyTurnCounts();
export function recordTurn(event: RoutingEvent) {
  countTurn(processCounts, event);
  console.info(JSON.stringify({ event: "turn_routing", scope: "process", ...event, totals: { ...processCounts } }));
}
